/**
 * MealOS AI — Confidence Calculator
 *
 * Source of truth: docs/DECISION_ENGINE.md §6
 *
 * Computes confidence (15–98) from context quality and score gap.
 * Independent of all path scores — a function of data completeness.
 */

import type { ScoringContext, PathScore } from '@/types/situation'
import { clamp } from './subscores'

interface ConfidenceInput {
  context: ScoringContext
  cookScore: PathScore
  orderScore: PathScore
  dineOutScore: PathScore
  winner: 'COOK' | 'ORDER' | 'DINE_OUT' | 'NO_WINNER'
}

/**
 * Computes the confidence score (integer 15–98).
 * Source: docs/DECISION_ENGINE.md §6
 */
export function computeConfidence(input: ConfidenceInput): number {
  const { context, cookScore, orderScore, dineOutScore, winner } = input
  let base = 90

  // Missing required fields penalty (subtractive)
  const missingCount = context.missingRequiredFields.length
  if (missingCount === 1) {
    base -= 15           // -15 → 75
  } else if (missingCount === 2) {
    base -= Math.floor(15 * 1.5)  // -22 → 68 (doc's worked examples use 22, not 22.5)
  } else if (missingCount >= 3) {
    base -= Math.floor(15 * 2.5)  // -37 → 53
  }

  // Service availability gaps
  if (!context.swiggAvailable) {
    base -= 15  // ORDER eliminated; user may have wanted it
  }
  if (!context.pantryDataAvailable) {
    base -= 5   // pantry state assumed; COOK scores may be inaccurate
  }

  // Memory quality
  if (!context.memoryPopulated) {
    base -= 10  // no user profile; budget/preference scores use defaults
  }

  // Score gap — how decisive is the winner?
  const scores: number[] = [
    cookScore.available ? cookScore.finalScore : -1,
    orderScore.available ? orderScore.finalScore : -1,
    dineOutScore.available ? dineOutScore.finalScore : -1,
  ].filter(s => s >= 0)

  if (scores.length === 0) {
    // No paths available — minimum confidence.
    // Note: DECISION_ENGINE.md §6 pseudocode says RETURN 20 here, but §9 Edge
    // Case 6 and §10 TC no_winner_all_paths_unavailable both state 15 (the
    // clamp minimum). The concrete test cases win; conflict reported.
    return 15
  }

  if (scores.length >= 2) {
    const sorted = [...scores].sort((a, b) => b - a)
    const first = sorted[0]
    const second = sorted[1]
    // noUncheckedIndexedAccess: both exist since scores.length >= 2
    if (first !== undefined && second !== undefined) {
      const gap = first - second
      if (gap >= 20) base += 5    // clear winner
      if (gap < 5) base -= 10    // very close race
    }
  }

  // NO_WINNER case
  if (winner === 'NO_WINNER') {
    base -= 20
  }

  return clamp(base, 15, 98)
}
