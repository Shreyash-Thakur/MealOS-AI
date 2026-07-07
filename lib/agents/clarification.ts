/**
 * lib/agents/clarification.ts
 * MealOS AI — Clarification Engine
 *
 * NOT a fifth agent (IMPLEMENTATION_PLAYBOOK §9 item 2): a pipeline stage
 * hosted by the Conversation Service. Deterministic gap analysis against the
 * required-fields registry decides WHAT to ask; a Haiku call decides only HOW
 * to phrase it. Model: claude-haiku-4-5 (PROMPT_ENGINEERING_GUIDE §2.3).
 *
 * The deterministic guarantees live HERE, in code, never in the prompt:
 *   - Memory-known fields are never asked (ISSUE-067, product thesis)
 *   - Confidence bands cap the question count (M3 DoD):
 *       100 → 0 · 75–99 → 1 · 50–74 → 2 · <50 → 3, then assume
 *   - Hard cap of 3 questions via slice after Zod parse (ISSUE-065)
 *   - Registry order defines field priority (REQUIRED_FIELDS, rule N3)
 *   - Max 2 passes; pass 2 covers required fields only (ISSUE-068)
 *   - LLM failure → zero questions, assumptions preserved (assume-and-go)
 *
 * LLM transport: lib/claude.ts `runClarificationEngine(systemMessage, userMessage)`
 * (CLARIFICATION_CONFIG: 3000ms, 1 retry, no schema re-ask, empty fallback).
 */

import { runClarificationEngine as claudeRunClarificationEngine } from '@/lib/claude'
import {
  assembleSystemMessage,
  getUserMessageTemplate,
  injectVariables,
} from '@/lib/prompts'
import { REQUIRED_FIELDS } from '@/lib/engine/requiredFields'
import type { AgentRunStatus } from '@/types/agents'
import type {
  SituationType,
  ClarificationQuestion,
  ClarificationQuestionType,
  ContextAssumption,
  ExplicitContext,
} from '@/types/situation'
import type { FactKey } from '@/types/memory'
import type {
  AssumptionStatementValidated,
  ClarificationLLMQuestionValidated,
} from '@/lib/schemas/agents'

// ── Memory → context field mapping (ISSUE-067) ────────────────────────────────

/**
 * Which missing context fields a stored memory fact can resolve.
 * Situational fields (alone, timeframe, indoorOutdoor, craving, occasion,
 * guests) are deliberately absent — memory can never answer "right now"
 * questions, only stable preferences.
 */
export const MEMORY_TO_CONTEXT_MAP: Readonly<Partial<Record<string, FactKey>>> = {
  budget: 'budget.daily_food_target',
  canCook: 'cooking.can_cook',
  location: 'location.home',
  'nutritionGoal.protein': 'fitness.protein_target',
  'nutritionGoal.calories': 'fitness.calorie_target',
}

/** Result of the memory check: what still needs asking, what memory answered. */
export interface MemoryResolution {
  stillMissing: string[]
  resolved: ContextAssumption[]
}

/**
 * Removes every missing field that a memory fact can resolve, converting each
 * resolution into a ContextAssumption (source 'memory') the UI can surface.
 *
 * @param missingFields - Field names from the Conversation Agent's gap output.
 * @param memoryFacts - Active (non-expired) fact map for the user.
 */
export function resolveFromMemory(
  missingFields: ReadonlyArray<string>,
  memoryFacts: Partial<Record<FactKey, unknown>>,
): MemoryResolution {
  const stillMissing: string[] = []
  const resolved: ContextAssumption[] = []

  for (const field of missingFields) {
    const factKey = MEMORY_TO_CONTEXT_MAP[field]
    const factValue = factKey !== undefined ? memoryFacts[factKey] : undefined

    if (
      factValue !== undefined &&
      (typeof factValue === 'string' ||
        typeof factValue === 'number' ||
        typeof factValue === 'boolean')
    ) {
      resolved.push({ field, value: factValue, source: 'memory' })
    } else {
      stillMissing.push(field)
    }
  }

  return { stillMissing, resolved }
}

// ── Confidence bands (M3 DoD) ─────────────────────────────────────────────────

/**
 * Maps Conversation Agent confidence to the maximum number of clarification
 * questions this pass may ask. Below 50 the engine asks its 3-question maximum
 * and then assumes — it never blocks planning on a fourth question.
 */
export function questionBudget(confidence: number): 0 | 1 | 2 | 3 {
  if (confidence >= 100) return 0
  if (confidence >= 75) return 1
  if (confidence >= 50) return 2
  return 3
}

// ── Field priority (ISSUE-065) ────────────────────────────────────────────────

/**
 * Orders fields by their position in the REQUIRED_FIELDS registry for the
 * situation type (first = highest priority). Fields not in the registry
 * (soft fields) follow, in their given order.
 */
export function prioritizeFields(
  situationType: SituationType,
  fields: ReadonlyArray<string>,
): string[] {
  const registry = REQUIRED_FIELDS[situationType]
  const rank = (field: string): number => {
    const idx = registry.indexOf(field)
    return idx === -1 ? registry.length : idx
  }
  // Stable sort: registry fields by registry order, soft fields keep input order
  return [...fields].sort((a, b) => rank(a) - rank(b))
}

// ── Pass-2 exhaustion defaults (ISSUE-068) ────────────────────────────────────

/**
 * Reasonable defaults for required fields still empty after the second pass.
 * The pipeline proceeds regardless, storing these as assumptions the user can
 * correct. Fields with no sane default (nutrition targets — inventing a macro
 * goal would be worse than a generic plan) are omitted.
 */
const FIELD_DEFAULTS: Readonly<Partial<Record<string, string | number | boolean>>> = {
  budget: 300,
  canCook: true,
  alone: true,
  guests: 4,          // party_hosting minimum is 3; 4 covers the common case
  indoorOutdoor: 'either',
  timeframe: 'tonight',
}

/**
 * Returns default-value assumptions (source 'inference') for the given fields.
 * Fields without an entry in FIELD_DEFAULTS are skipped.
 */
export function getAssumedDefaults(
  fields: ReadonlyArray<string>,
): ContextAssumption[] {
  const assumptions: ContextAssumption[] = []
  for (const field of fields) {
    const value = FIELD_DEFAULTS[field]
    if (value !== undefined) {
      assumptions.push({ field, value, source: 'inference' })
    }
  }
  return assumptions
}

// ── Engine input / result ─────────────────────────────────────────────────────

export interface ClarificationEngineInput {
  situationType: SituationType
  /** Field names missing per the Conversation Agent (post-extraction gap). */
  missingRequired: string[]
  /** Soft fields that would improve the recommendation (asked only if budget allows). */
  missingSoft: string[]
  /** Everything already known (explicit + inferred + memory-merged) — the do-not-ask list. */
  knownContext: Record<string, unknown>
  /** Active fact map for the user; resolves fields without asking (ISSUE-067). */
  memoryFacts: Partial<Record<FactKey, unknown>>
  /** Natural-language memory digest for prompt context; null = first session. */
  userMemorySummary: string | null
  /** Conversation Agent confidence 0–100 — sets the question budget. */
  confidence: number
  /** 1 or 2. Pass 2 asks only remaining REQUIRED fields (ISSUE-068). */
  passNumber: 1 | 2
}

export interface ClarificationEngineResult {
  /** Domain questions, ids q1..qN, sorted by EVOI, capped at min(3, budget). */
  questions: ClarificationQuestion[]
  /** Mechanical assumptions from memory resolution (source 'memory'). */
  assumptions: ContextAssumption[]
  /** LLM-phrased assumption banners for the UI (may be empty). */
  assumptionStatements: AssumptionStatementValidated[]
  /** 'skipped' = no LLM call was needed; otherwise the transport run status. */
  status: AgentRunStatus | 'skipped'
}

// ── LLM output → domain mapping ───────────────────────────────────────────────

const EVOI_RANK: Record<ClarificationLLMQuestionValidated['evoi'], number> = {
  high: 0,
  medium: 1,
  low: 2,
}

const TYPE_TO_DOMAIN: Record<
  ClarificationLLMQuestionValidated['type'],
  ClarificationQuestionType
> = {
  single_choice: 'single_choice',
  multi_choice: 'multi_choice',
  number_input: 'number',
  freetext: 'freetext',
}

/**
 * Post-processes validated LLM questions into domain ClarificationQuestions:
 * drop questions about fields we did not ask for (belt-and-suspenders on the
 * never-ask-known rule), sort by EVOI descending, cap, assign ids.
 */
function toDomainQuestions(
  llmQuestions: ClarificationLLMQuestionValidated[],
  askableFields: ReadonlySet<string>,
  cap: number,
): ClarificationQuestion[] {
  return llmQuestions
    .filter((q) => askableFields.has(q.field))
    .sort((a, b) => EVOI_RANK[a.evoi] - EVOI_RANK[b.evoi])
    .slice(0, cap)
    .map((q, i) => ({
      id: `q${i + 1}`,
      text: q.text,
      // Dotted registry paths ('nutritionGoal.protein') are the field-name
      // convention; the domain type nominally narrows to keyof ExplicitContext
      field: q.field as keyof ExplicitContext,
      type: TYPE_TO_DOMAIN[q.type],
      options: q.options.map((o) => ({ label: o.label, value: o.value })),
      required: q.required,
    }))
}

// ── User message construction ─────────────────────────────────────────────────

function buildClarificationUserMessage(
  input: ClarificationEngineInput,
  askRequired: string[],
  askSoft: string[],
): string {
  return injectVariables(getUserMessageTemplate('clarification'), {
    situation_type: input.situationType,
    missing_fields_json: JSON.stringify(
      askRequired.map((field) => ({ field, priority: 'required' })),
    ),
    missing_soft_fields_json: JSON.stringify(
      askSoft.map((field) => ({ field, priority: 'soft' })),
    ),
    known_context_json: JSON.stringify(input.knownContext, null, 2),
    user_memory_summary: input.userMemorySummary ?? 'null',
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Runs one clarification pass for a situation.
 *
 * Deterministic flow:
 *  1. Guard: passNumber must be 1 or 2 (max-2-passes contract).
 *  2. Memory check: strip memory-resolvable fields, emit assumptions.
 *  3. Budget: confidence band caps the question count. Budget 0 or nothing
 *     left to ask → return without any LLM call (status 'skipped').
 *  4. Priority: registry order picks which fields fit the budget; pass 2
 *     considers required fields only.
 *  5. Haiku phrases the questions; output is validated, filtered to the asked
 *     fields, EVOI-sorted, capped, and id-stamped.
 *
 * Never throws for LLM-level failures: a failed phrasing call yields zero
 * questions with assumptions intact, and the pipeline assumes-and-goes.
 */
export async function runClarificationEngine(
  input: ClarificationEngineInput,
): Promise<ClarificationEngineResult> {
  if (input.passNumber !== 1 && input.passNumber !== 2) {
    throw new Error(
      `[ClarificationEngine] invalid passNumber ${String(input.passNumber)} — max 2 passes per situation`,
    )
  }

  // Memory check (ISSUE-067) — required and soft gaps resolved independently
  const requiredResolution = resolveFromMemory(input.missingRequired, input.memoryFacts)
  const softResolution = resolveFromMemory(input.missingSoft, input.memoryFacts)
  const assumptions = [...requiredResolution.resolved, ...softResolution.resolved]

  // Question budget from confidence bands; ISSUE-065 hard cap is 3 by band design
  const budget = questionBudget(input.confidence)

  // Pass 2 covers only remaining required fields (ISSUE-068)
  const askRequired = prioritizeFields(input.situationType, requiredResolution.stillMissing)
  const askSoft = input.passNumber === 2 ? [] : softResolution.stillMissing

  // Soft fields ride along only when the required set leaves budget headroom
  const askableRequired = askRequired.slice(0, budget)
  const askableSoft = askSoft.slice(0, Math.max(0, budget - askableRequired.length))

  if (budget === 0 || askableRequired.length + askableSoft.length === 0) {
    return { questions: [], assumptions, assumptionStatements: [], status: 'skipped' }
  }

  const systemMessage = assembleSystemMessage('clarification')
  const userMessage = buildClarificationUserMessage(input, askableRequired, askableSoft)

  const result = await claudeRunClarificationEngine(systemMessage, userMessage)

  if (result.status !== 'completed') {
    // Assume-and-go: zero questions, keep what memory already resolved
    return { questions: [], assumptions, assumptionStatements: [], status: result.status }
  }

  const askableFields = new Set([...askableRequired, ...askableSoft])
  const questions = toDomainQuestions(result.output.questions, askableFields, budget)

  return {
    questions,
    assumptions,
    assumptionStatements: result.output.assumptions,
    status: result.status,
  }
}
