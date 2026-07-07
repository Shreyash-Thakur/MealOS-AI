/**
 * MealOS AI — Decision Engine Scorer
 *
 * Source of truth: docs/DECISION_ENGINE.md
 *
 * Public API: computeDecision(context, cook, order, dineOut) → DecisionResult
 *
 * Pure TypeScript. Zero I/O, zero LLM calls, zero network.
 * Must complete in < 5ms for any valid input.
 */

import type {
  ScoringContext,
  CookPathInput,
  OrderPathInput,
  DineOutPathInput,
  PathInput,
  PathScore,
  DecisionResult,
  EnginePath,
  ScoreWeights,
} from '@/types/situation'

import {
  computeGoalMatchScore,
  computeBudgetFitScore,
  computeTimeFitScore,
  computePrefMatchScore,
  clamp,
} from './subscores'
import { determineAvailability } from './availability'
import { computeConfidence } from './confidence'
import { computeSimulatorDeltas } from './simulator'
import { WEIGHT_TABLE } from './weights'

// Export TIE_THRESHOLD for use in tests (invariant INV-6)
export const TIE_THRESHOLD = 5

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Computes the weighted final score from four sub-scores.
 * Hard blocks in prefMatch force finalScore = 0.
 * Rounds to 1 decimal place.
 */
function computeFinalScore(
  goalMatch: number,
  budgetFit: number,
  timeFit: number,
  prefMatch: number,
  weights: ScoreWeights,
  hardBlocks: string[]
): number {
  if (hardBlocks.length > 0) return 0

  const raw =
    goalMatch * weights.goalMatch +
    budgetFit * weights.budgetFit +
    timeFit * weights.timeFit +
    prefMatch * weights.preferenceMatch

  return clamp(Math.round(raw * 10) / 10, 0, 100)
}

/** Returns a zeroed-out PathScore for unavailable paths. */
function makeUnavailableScore(path: EnginePath, reason: string): PathScore {
  return {
    path,
    available: false,
    goalMatchScore: 0,
    budgetFitScore: 0,
    timeFitScore: 0,
    prefMatchScore: 0,
    finalScore: 0,
    goalMatchNotes: [],
    budgetNotes: [reason],
    timeNotes: [],
    prefNotes: [],
    hardBlocks: [],
  }
}

/** Scores a single available path. */
function scorePath(
  pathInput: PathInput,
  context: ScoringContext,
  weights: ScoreWeights
): PathScore {
  const path = pathInput.path

  const goalMatchScore = computeGoalMatchScore(context, pathInput)
  const budgetFitScore = computeBudgetFitScore(pathInput, context)
  const timeFitScore = computeTimeFitScore(pathInput, context)
  const { score: prefMatchScore, hardBlocks } = computePrefMatchScore(pathInput, context)

  const finalScore = computeFinalScore(
    goalMatchScore,
    budgetFitScore,
    timeFitScore,
    prefMatchScore,
    weights,
    hardBlocks
  )

  // Build notes (brief, for debugging and explanation)
  const goalMatchNotes: string[] = []
  const budgetNotes: string[] = []
  const timeNotes: string[] = []
  const prefNotes: string[] = []

  if (context.budgetRupees !== null) {
    const ratio = pathInput.estimatedCostRupees / context.budgetRupees
    if (ratio <= 0.8) budgetNotes.push(`${Math.round((1 - ratio) * 100)}% under budget`)
    else if (ratio <= 1.0) budgetNotes.push('within budget')
    else budgetNotes.push(`${Math.round((ratio - 1) * 100)}% over budget`)
  }

  if (context.timeConstraintMinutes !== null) {
    const diff = pathInput.estimatedTimeMinutes - context.timeConstraintMinutes
    if (diff > 0) timeNotes.push(`${diff} min over constraint`)
    else if (diff < 0) timeNotes.push(`${Math.abs(diff)} min under constraint`)
    else timeNotes.push('exactly at time constraint')
  }

  if (hardBlocks.length > 0) {
    prefNotes.push(...hardBlocks)
  }

  return {
    path,
    available: true,
    goalMatchScore,
    budgetFitScore,
    timeFitScore,
    prefMatchScore,
    finalScore,
    goalMatchNotes,
    budgetNotes,
    timeNotes,
    prefNotes,
    hardBlocks,
  }
}

// ── Tiebreak rules ────────────────────────────────────────────────────────────

/** Situation-type default tiebreak preference order. */
const SITUATION_PREFERENCE: Record<string, EnginePath[]> = {
  sick:          ['ORDER', 'COOK', 'DINE_OUT'],
  broke:         ['COOK', 'ORDER', 'DINE_OUT'],
  date_planning: ['DINE_OUT', 'COOK', 'ORDER'],
  meal_prep:     ['COOK', 'ORDER', 'DINE_OUT'],
  late_night:    ['ORDER', 'COOK', 'DINE_OUT'],
  party_hosting: ['ORDER', 'DINE_OUT', 'COOK'],
  office_lunch:  ['ORDER', 'DINE_OUT', 'COOK'],
  // family_dinner is absent from DECISION_ENGINE.md §7 Rule 4's list, but §10
  // TC family_dinner_cook_wins requires COOK to win a ≤5-point tie over ORDER.
  // The ordering below mirrors §4.1's family_dinner goal scores (COOK 85 >
  // DINE_OUT 70 > ORDER 65). Conflict reported.
  family_dinner: ['COOK', 'DINE_OUT', 'ORDER'],
}
const DEFAULT_PREFERENCE: EnginePath[] = ['ORDER', 'COOK', 'DINE_OUT']

/**
 * Applies tiebreak rules to two tied PathScores.
 * Returns the preferred PathScore, or null if the tie cannot be resolved.
 * Source: docs/DECISION_ENGINE.md §7
 */
function applyTiebreakRules(
  first: PathScore,
  second: PathScore,
  context: ScoringContext,
  cookInput: CookPathInput,
  orderInput: OrderPathInput,
  dineOutInput: DineOutPathInput
): PathScore | null {
  const tied = [first, second]

  // RULE 1: Hard user path preference
  // Note: context.explicitPathPreference is not in ScoringContext (doc-vs-types conflict;
  // see final report). Skipped — no field to read.

  // RULE 2: Budget protection
  if (context.budgetRupees !== null) {
    const getCost = (ps: PathScore): number => {
      if (ps.path === 'COOK') return cookInput.estimatedCostRupees
      if (ps.path === 'ORDER') return orderInput.estimatedCostRupees
      return dineOutInput.estimatedCostRupees
    }
    const firstOver = getCost(first) > context.budgetRupees
    const secondOver = getCost(second) > context.budgetRupees
    if (firstOver && !secondOver) return second
    if (secondOver && !firstOver) return first
  }

  // RULE 3: Allergen safety
  if (first.hardBlocks.length > 0 && second.hardBlocks.length === 0) return second
  if (second.hardBlocks.length > 0 && first.hardBlocks.length === 0) return first

  // RULE 4: Situation-type default preference
  const preference =
    SITUATION_PREFERENCE[context.situationType] ?? DEFAULT_PREFERENCE
  for (const preferred of preference) {
    const match = tied.find(s => s.path === preferred)
    if (match) return match
  }

  return null
}

// ── determineWinner ───────────────────────────────────────────────────────────

interface WinnerResult {
  winner: EnginePath | 'NO_WINNER'
  isSplitRecommendation: boolean
  splitAlternative: EnginePath | null
}

/**
 * Determines the winning path with tie-breaking logic.
 * Source: docs/DECISION_ENGINE.md §7
 */
function determineWinner(
  cookScore: PathScore,
  orderScore: PathScore,
  dineOutScore: PathScore,
  context: ScoringContext,
  cookInput: CookPathInput,
  orderInput: OrderPathInput,
  dineOutInput: DineOutPathInput
): WinnerResult {
  const available = [cookScore, orderScore, dineOutScore].filter(s => s.available)

  if (available.length === 0) {
    return { winner: 'NO_WINNER', isSplitRecommendation: false, splitAlternative: null }
  }

  if (available.length === 1) {
    const only = available[0]!
    return { winner: only.path, isSplitRecommendation: false, splitAlternative: null }
  }

  // Sort by finalScore descending
  const sorted = [...available].sort((a, b) => b.finalScore - a.finalScore)
  const first = sorted[0]!
  const second = sorted[1]!

  // All paths below 30 = no good option
  if (first.finalScore < 30) {
    return { winner: 'NO_WINNER', isSplitRecommendation: false, splitAlternative: null }
  }

  const isTied = Math.abs(first.finalScore - second.finalScore) <= TIE_THRESHOLD

  if (isTied) {
    const tiebreakWinner = applyTiebreakRules(
      first, second, context, cookInput, orderInput, dineOutInput
    )
    if (tiebreakWinner === null) {
      return {
        winner: first.path,
        isSplitRecommendation: true,
        splitAlternative: second.path,
      }
    }
    return {
      winner: tiebreakWinner.path,
      isSplitRecommendation: false,
      splitAlternative: second.path,
    }
  }

  // Clear winner (gap > TIE_THRESHOLD)
  return {
    winner: first.path,
    isSplitRecommendation: false,
    splitAlternative: second.path,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * The main scoring function. Evaluates all three paths and returns a full
 * DecisionResult including winner, confidence, and simulator deltas.
 *
 * Pure, synchronous, deterministic. Must complete in < 5ms.
 * Source: docs/DECISION_ENGINE.md
 */
export function computeDecision(
  context: ScoringContext,
  cook: CookPathInput,
  order: OrderPathInput,
  dineOut: DineOutPathInput
): DecisionResult {
  const weights = WEIGHT_TABLE[context.situationType]

  // Phase 1: Determine availability
  const avail = determineAvailability(context, cook, order, dineOut)

  // Phase 2: Score each available path (unavailable paths get zeroed PathScore)
  const cookScore: PathScore = avail.cook
    ? scorePath(cook, context, weights)
    : makeUnavailableScore('COOK', avail.cookReason ?? 'unavailable')

  const orderScore: PathScore = avail.order
    ? scorePath(order, context, weights)
    : makeUnavailableScore('ORDER', avail.orderReason ?? 'unavailable')

  const dineOutScore: PathScore = avail.dineOut
    ? scorePath(dineOut, context, weights)
    : makeUnavailableScore('DINE_OUT', avail.dineOutReason ?? 'unavailable')

  // Phase 3: Determine winner
  const { winner, isSplitRecommendation, splitAlternative } = determineWinner(
    cookScore, orderScore, dineOutScore, context, cook, order, dineOut
  )

  // Phase 4: Compute confidence
  const confidence = computeConfidence({
    context,
    cookScore,
    orderScore,
    dineOutScore,
    winner,
  })

  // Phase 5: Compute simulator deltas
  // Find primary and alternative path inputs
  const pathInputMap: Record<EnginePath, PathInput> = {
    COOK: cook,
    ORDER: order,
    DINE_OUT: dineOut,
  }

  const primaryInput: PathInput | null =
    winner !== 'NO_WINNER' ? pathInputMap[winner] ?? null : null

  let alternativeInput: PathInput | null = null
  if (primaryInput !== null && splitAlternative !== null) {
    alternativeInput = pathInputMap[splitAlternative] ?? null
  } else if (primaryInput !== null) {
    // Find second-highest scoring available path
    const available = [cookScore, orderScore, dineOutScore]
      .filter(s => s.available && s.path !== winner)
      .sort((a, b) => b.finalScore - a.finalScore)
    const secondBest = available[0]
    if (secondBest !== undefined) {
      alternativeInput = pathInputMap[secondBest.path] ?? null
    }
  }

  const simulator = primaryInput !== null
    ? computeSimulatorDeltas(primaryInput, alternativeInput)
    : computeSimulatorDeltas(cook, null)  // fallback when NO_WINNER

  return {
    cookScore,
    orderScore,
    dineOutScore,
    winner,
    isSplitRecommendation,
    splitAlternative,
    confidence: confidence as import('@/types/primitives').ConfidencePercent,
    simulator,
    weightsUsed: weights,
    computedAt: new Date().toISOString() as import('@/types/primitives').ISODateTime,
  }
}
