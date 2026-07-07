/**
 * lib/agents/memory.ts
 * MealOS AI — Memory Agent
 *
 * Identity (docs/AGENTS.md §5.1):
 *   Name:           MemoryAgent
 *   Model:          claude-haiku-4-5
 *   Max output tokens: 600
 *   Timeout:        5000ms
 *   Retry policy:   2 retries, 500ms base backoff, retry on timeout + api_error
 *   Runs:           ASYNC, after situation completes; NEVER blocks user
 *   Prompt file:    docs/prompts/memory.md
 *
 * Silent-failure contract (docs/AGENTS.md §5.6):
 *   Any failure — LLM timeout, schema invalid, DB write failure — is caught,
 *   logged, and swallowed. The user is NEVER impacted. runMemoryAgent NEVER
 *   throws to its caller (the orchestrator's post-stream callback).
 *
 * LLM transport: lib/claude.ts `runMemoryAgent(systemMessage, userMessage)`
 *   handles the MemoryAgent config (model, timeout, retries per AGENTS.md §5.1),
 *   schema validation via MemoryAgentOutputSchema, and returns the fallback []
 *   on any failure. This module re-validates output and applies write rules
 *   (registry check, never-downgrade) before persisting.
 *
 * KNOWN SPEC CONFLICT (reported, not forked):
 *   types/memory.ts MemorySource has 6 domain values; prisma/schema.prisma's
 *   memory_source enum has 4 (ONBOARDING, CLARIFICATION, AGENT_INFERRED,
 *   USER_EDITED). The write boundary below maps domain → Prisma:
 *     clarification_answer → CLARIFICATION
 *     user_stated | behavior_inferred | action_derived → AGENT_INFERRED
 */

import { runMemoryAgent as claudeRunMemoryAgent } from '@/lib/claude'
import { MemoryAgentOutputSchema } from '@/lib/schemas/agents'
import { isValidFactKey, FACT_EXPIRY_DAYS } from '@/lib/memory/factKeys'
import { upsertFactsBatch, type UpsertFactInput } from '@/lib/repositories/memoryFactRepo'
import type { MemorySource as PrismaMemorySource } from '@prisma/client'
import type { MemoryAgentInput, ExtractedMemoryFact } from '@/types/agents'
import type { FactKey } from '@/types/memory'

// ── System prompt (from docs/prompts/memory.md) ───────────────────────────────

const SYSTEM_PROMPT = `You are the Memory Agent for MealOS AI. You run after every completed situation — not during. Your job: extract facts from this interaction that should persist to the user's long-term memory. Output only a JSON array of fact objects matching the schema below.

You are not a conversational agent. You produce no prose, no explanation, no wrapper text. You output a raw JSON array and nothing else. If there are no facts worth storing, output an empty array: []

CONFIDENCE SCORING RULES — use exactly these four values:
1.0 = User explicitly stated this fact in their raw input
0.8 = User confirmed this fact in a direct clarification answer
0.6 = Strongly inferred from behavior — executed same path 3+ times across sessions
0.4 = Weakly inferred — single data point

Any fact below 0.3 confidence must NOT be stored. Output [] if nothing meets the 0.4 threshold.

CANONICAL FACT KEYS (dot-notation only — never invent new keys):
dietary.restrictions   → string[]   (e.g. ["vegetarian"])
dietary.allergies      → string[]
budget.daily_food_target → number   (INR)
budget.dining_out_budget → number   (INR per outing)
kitchen.skill_level    → string     ("beginner"|"intermediate"|"advanced")
kitchen.equipment      → string[]
location.home          → string
location.work          → string
fitness.protein_target → number     (grams/day)
fitness.calorie_target → number     (kcal/day)
fitness.gym_days       → string[]   (e.g. ["Monday","Wednesday"])
pantry.staples         → string[]
preference.cuisines.liked    → string[]
preference.cuisines.disliked → string[]
ordering.frequent_restaurants → string[]
household.size         → number
cooking.can_cook       → boolean
health.last_sick_day   → string     (ISO date "YYYY-MM-DD")

DO NOT STORE:
- Situational one-offs ("sick today", "tired tonight")
- Moods or cravings ("feel like biryani")
- Negative-space inferences (dismissal ≠ dislike)
- Inferred location from a single session
- The situation type itself
- Single restaurant orders (one ≠ "frequent")
- Time-of-day preferences from one session

OUTPUT SCHEMA (JSON array, nothing else):
[
  {
    "factKey": "<one of the canonical keys above>",
    "factValue": <string|number|boolean|string[]>,
    "confidence": <0.4|0.6|0.8|1.0>,
    "source": <"user_stated"|"clarification_answer"|"behavior_inferred"|"action_derived">,
    "expiresAfterDays": <number|null>
  }
]`

// ── Domain → Prisma source mapping ────────────────────────────────────────────

/**
 * Maps the domain MemorySource values the agent emits to the Prisma
 * memory_source enum values the repository accepts.
 * See the KNOWN SPEC CONFLICT note in the module header.
 */
const SOURCE_TO_DB: Record<ExtractedMemoryFact['source'], PrismaMemorySource> = {
  user_stated: 'AGENT_INFERRED',
  clarification_answer: 'CLARIFICATION',
  behavior_inferred: 'AGENT_INFERRED',
  action_derived: 'AGENT_INFERRED',
}

// ── User message builder ──────────────────────────────────────────────────────

function buildUserMessage(input: MemoryAgentInput): string {
  return `COMPLETED SITUATION:
${JSON.stringify(input.completedSituation, null, 2)}

CLARIFICATION ANSWERS (what user said in response to questions):
${JSON.stringify(input.clarificationAnswers, null, 2)}

WHAT WAS EXECUTED:
${input.executedPath ?? 'null'}

USER RATING (1-5, null if not provided):
${input.userRating ?? 'null'}`
}

// ── Output validation and filtering ──────────────────────────────────────────

/**
 * Re-validate the agent output and apply write rules.
 * - Validates against MemoryAgentOutputSchema (belt-and-suspenders — lib/claude
 *   already validates, but this module owns the write path and must not trust
 *   its transport blindly)
 * - Rejects facts with non-canonical keys (registry check, rule N4)
 * - Enforces the never-downgrade rule: a new fact whose confidence is lower
 *   than the existing stored confidence for the same key is dropped
 *
 * Returns [] on any validation failure (silent-failure contract).
 */
function validateAndFilter(
  rawOutput: unknown,
  existingFacts: MemoryAgentInput['existingFacts']
): ExtractedMemoryFact[] {
  const result = MemoryAgentOutputSchema.safeParse(rawOutput)
  if (!result.success) return []

  const existingConfidence = new Map<string, number>()
  for (const ef of existingFacts) {
    existingConfidence.set(ef.factKey, ef.confidence)
  }

  return (result.data as ExtractedMemoryFact[]).filter((fact) => {
    // Registry check (runtime half of rule N4; compile-time half is FactKey typing)
    if (!isValidFactKey(fact.factKey)) return false

    // Never downgrade (docs/AGENTS.md §5.5)
    const existing = existingConfidence.get(fact.factKey)
    if (existing !== undefined && existing > fact.confidence) return false

    return true
  })
}

// ── DB write with retry ───────────────────────────────────────────────────────

/**
 * Write validated facts via memoryFactRepo batch upsert
 * (compiles to INSERT ... ON CONFLICT DO UPDATE — rule from repo header).
 * Retries 3× with exponential backoff on failure (docs/AGENTS.md §5.6).
 * Throws only after all retries are exhausted — caller catches and logs silently.
 */
async function writeFacts(userId: string, facts: ExtractedMemoryFact[]): Promise<void> {
  if (facts.length === 0) return

  const inputs: UpsertFactInput[] = facts.map((fact) => {
    const key = fact.factKey as FactKey
    const expiresAfterDays = fact.expiresAfterDays ?? FACT_EXPIRY_DAYS[key]
    const expiresAt = expiresAfterDays !== null
      ? new Date(Date.now() + expiresAfterDays * 24 * 60 * 60 * 1000)
      : null

    return {
      userId,
      factKey: key,
      factValue: fact.factValue,
      source: SOURCE_TO_DB[fact.source],
      confidence: fact.confidence,
      timesConfirmed: 1,
      lastConfirmedAt: new Date(),
      expiresAt,
    }
  })

  const MAX_DB_RETRIES = 3
  for (let attempt = 0; attempt < MAX_DB_RETRIES; attempt++) {
    try {
      await upsertFactsBatch(inputs)
      return
    } catch (err) {
      if (attempt === MAX_DB_RETRIES - 1) throw err
      await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt)))
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run the Memory Agent for one completed situation.
 *
 * IMPORTANT: This function NEVER throws (silent-failure contract,
 * docs/AGENTS.md §5.6). All failures are caught, logged via console.error,
 * and swallowed. The situation is marked completed regardless.
 *
 * @param userId - Internal user UUID (not Clerk ID)
 * @param input - Completed situation + clarification answers + execution result
 */
export async function runMemoryAgent(userId: string, input: MemoryAgentInput): Promise<void> {
  try {
    const userMessage = buildUserMessage(input)

    // lib/claude runMemoryAgent: retries + timeout + schema validation internal;
    // returns fallback [] with a non-'completed' status instead of throwing
    const result = await claudeRunMemoryAgent(SYSTEM_PROMPT, userMessage)

    if (result.status !== 'completed') {
      console.error('[MemoryAgent] LLM run did not complete — no facts written', {
        userId,
        status: result.status,
        error: result.error,
      })
      return
    }

    const facts = validateAndFilter(result.output, input.existingFacts)
    await writeFacts(userId, facts)
  } catch (err) {
    // Silent-failure contract: log for debugging, never surface to user
    console.error('[MemoryAgent] silent failure', {
      userId,
      situationType: input.completedSituation.situationType,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ── Exported constants ────────────────────────────────────────────────────────

export const MEMORY_AGENT_NAME = 'MemoryAgent' as const
