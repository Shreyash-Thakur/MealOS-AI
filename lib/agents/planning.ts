/**
 * lib/agents/planning.ts
 * MealOS AI — Planning Agent
 *
 * Identity (docs/AGENTS.md §3.1):
 *   Name:           PlanningAgent
 *   Model:          claude-sonnet-4-6
 *   Max output tokens: 2000
 *   Timeout:        8000ms
 *   Retry policy:   1 retry on timeout only; schema failures never retried
 *   Runs:           synchronously, after Tool Agent, blocks the plan_ready SSE
 *   Prompt file:    docs/prompts/planning.md (live source via lib/prompts)
 *
 * The only agent that generates user-facing prose. It NARRATES the Decision
 * Engine's verdict — it never computes one (rule N1: the scorer is the
 * contract). The winner guard below enforces that mechanically: an output
 * whose primaryPath contradicts the highest available-and-backed-by-data score
 * is rejected to the fallback, no matter how fluent the prose.
 *
 * LLM transport: lib/claude.ts `runPlanningAgent(systemMessage, userMessage)`
 * owns retries, the 8s timeout, and Zod validation against
 * PlanningAgentOutputSchema. This module owns prompt assembly (with the
 * fallback.md degraded block when Swiggy is down), input truncation
 * (ISSUE-104), the winner guard, and timeout-fallback enrichment (FM1).
 */

import {
  runPlanningAgent as claudeRunPlanningAgent,
  PLANNING_FALLBACK,
} from '@/lib/claude'
import {
  assembleSystemMessage,
  getFallbackPrompt,
  getUserMessageTemplate,
  injectVariables,
} from '@/lib/prompts'
import type { AgentRunResult, PlanningAgentInput } from '@/types/agents'
import type { PrimaryPath } from '@/types/situation'
import type { PlanningAgentOutputValidated } from '@/lib/schemas/planningOutput'

// ── Context-window truncation (AGENTS.md §3.3 / ISSUE-104) ────────────────────

const MAX_PROMPT_RESTAURANTS = 10
const MAX_PROMPT_PANTRY_ITEMS = 50

/**
 * Applies the orchestrator-side truncation rules before prompt assembly:
 * restaurants → top 10 by rating; pantry → first 50 items. Prevents context
 * overflow without losing the most relevant data.
 */
export function truncateForPrompt(input: PlanningAgentInput): PlanningAgentInput {
  const swiggyResults = input.swiggyResults
    ? {
        ...input.swiggyResults,
        restaurants: input.swiggyResults.restaurants
          ? [...input.swiggyResults.restaurants]
              .sort((a, b) => b.rating - a.rating)
              .slice(0, MAX_PROMPT_RESTAURANTS)
          : null,
      }
    : null

  return {
    ...input,
    swiggyResults,
    pantryItems: input.pantryItems.slice(0, MAX_PROMPT_PANTRY_ITEMS),
  }
}

// ── Degraded-mode block extraction (fallback.md §1) ───────────────────────────

/**
 * Extracts the SWIGGY_UNAVAILABLE injection block from fallback.md §1 — the
 * first fenced block in the "SWIGGY UNAVAILABLE" h2 section. Injected between
 * system.md and the planning section when isDegradedMode is set (AP-6:
 * conditional injection, never a permanent prompt fixture).
 */
function getDegradedModeBlock(): string {
  const { content } = getFallbackPrompt()
  const headingMatch = content.match(/^##[^\n]*SWIGGY UNAVAILABLE[^\n]*$/im)
  if (headingMatch === null || headingMatch.index === undefined) {
    // Defensive: degrade to a one-line instruction rather than fail the run
    return 'DEGRADED MODE ACTIVE: SWIGGY_UNAVAILABLE\n\nSwiggy is unavailable; recommend the cook path using pantry data.'
  }
  const rest = content.slice(headingMatch.index + headingMatch[0].length)
  const nextH2 = rest.search(/\n## /)
  const section = nextH2 === -1 ? rest : rest.slice(0, nextH2)
  const fence = section.match(/```\n([\s\S]*?)\n```/)
  return (fence?.[1] ?? '').trim() || 'DEGRADED MODE ACTIVE: SWIGGY_UNAVAILABLE'
}

// ── User message construction ─────────────────────────────────────────────────

/**
 * Builds the Planning Agent user message from the live template in
 * docs/prompts/planning.md. All JSON payloads are pre-stringified; null
 * sections become the literal "null" (loader convention).
 */
export function buildPlanningUserMessage(input: PlanningAgentInput): string {
  const truncated = truncateForPrompt(input)

  return injectVariables(getUserMessageTemplate('planning'), {
    situation_context_json: JSON.stringify(truncated.situationContext, null, 2),
    user_memory_json: JSON.stringify(truncated.userMemory, null, 2),
    pre_calculated_scores_json: JSON.stringify(truncated.preCalculatedScores, null, 2),
    swiggy_results_json:
      truncated.swiggyResults === null
        ? 'null'
        : JSON.stringify(truncated.swiggyResults, null, 2),
    youtube_result_json:
      truncated.youtubeResult === null
        ? 'null'
        : JSON.stringify(truncated.youtubeResult, null, 2),
    pantry_items_json: JSON.stringify(truncated.pantryItems, null, 2),
  })
}

// ── Winner guard (rule N1) ────────────────────────────────────────────────────

/**
 * Computes the set of primaryPath values the narrator is allowed to output:
 * available paths ranked by pre-calculated score, where order/dineout only
 * count when the Tool Agent actually returned data for them (FM2: an empty
 * Swiggy result makes cook the legitimate winner regardless of scores).
 * Cook always has data (pantry-based generic plans exist by definition).
 */
export function acceptablePrimaryPaths(input: PlanningAgentInput): Set<PrimaryPath> {
  const hasData: Record<PrimaryPath, boolean> = {
    cook: true,
    order: (input.swiggyResults?.restaurants?.length ?? 0) > 0,
    dineout: (input.swiggyResults?.dineoutVenues?.length ?? 0) > 0,
  }

  const candidates = (['cook', 'order', 'dineout'] as const).filter(
    (path) => input.pathAvailability[path] && hasData[path],
  )
  if (candidates.length === 0) {
    // Nothing viable — cook is the terminal fallback (FM3 pantry fallback)
    return new Set<PrimaryPath>(['cook'])
  }

  const best = candidates.reduce((a, b) =>
    input.preCalculatedScores[b] > input.preCalculatedScores[a] ? b : a,
  )
  const bestScore = input.preCalculatedScores[best]

  // Ties are legitimate either way — accept every candidate at the top score
  return new Set<PrimaryPath>(
    candidates.filter((path) => input.preCalculatedScores[path] === bestScore),
  )
}

// ── Timeout-fallback enrichment (FM1) ─────────────────────────────────────────

/**
 * AGENTS.md §3.5 FM1: on timeout, the degraded recommendation names the top
 * Swiggy restaurant when ordering is viable, else falls back to home cooking.
 */
function enrichTimeoutFallback(input: PlanningAgentInput): PlanningAgentOutputValidated {
  const topRestaurant = input.swiggyResults?.restaurants?.[0]
  const orderViable = input.pathAvailability.order && topRestaurant !== undefined

  return {
    ...PLANNING_FALLBACK,
    primaryPath: orderViable ? 'order' : 'cook',
    recommendation: {
      ...PLANNING_FALLBACK.recommendation,
      title: orderViable ? topRestaurant.name : 'Home cooking',
    },
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Runs the Planning Agent for one fully-clarified situation.
 *
 * Never throws for LLM-level failures — every outcome is a typed
 * AgentRunResult whose output is always a valid PlanningAgentOutput:
 * - completed + winner guard pass → the model's narration
 * - completed + winner guard FAIL → PLANNING_FALLBACK, status 'schema_failed'
 *   (a contradicted scorer is a contract violation, not a stylistic choice)
 * - timeout → enriched degraded fallback (FM1)
 * - schema_failed / failed → PLANNING_FALLBACK passthrough
 */
export async function runPlanningAgent(
  input: PlanningAgentInput,
): Promise<AgentRunResult<PlanningAgentOutputValidated>> {
  const systemMessage = assembleSystemMessage(
    'planning',
    input.isDegradedMode ? getDegradedModeBlock() : undefined,
  )
  const userMessage = buildPlanningUserMessage(input)

  const result = await claudeRunPlanningAgent(systemMessage, userMessage)

  if (result.status === 'timeout') {
    return { ...result, output: enrichTimeoutFallback(input) }
  }

  if (result.status !== 'completed') {
    return result
  }

  // Winner guard (N1): the narrator must not contradict the scorer
  const acceptable = acceptablePrimaryPaths(input)
  if (!acceptable.has(result.output.primaryPath)) {
    return {
      ...result,
      output: PLANNING_FALLBACK,
      status: 'schema_failed',
      error:
        `winner mismatch: model chose '${result.output.primaryPath}' but the ` +
        `highest available scored path is '${[...acceptable].join("' or '")}'`,
    }
  }

  return result
}

// ── Exported constants ────────────────────────────────────────────────────────

export const PLANNING_AGENT_NAME = 'PlanningAgent' as const
