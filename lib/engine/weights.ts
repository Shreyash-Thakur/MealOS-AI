/**
 * MealOS AI — Decision Engine Weight Tables
 *
 * Source of truth: docs/DECISION_ENGINE.md §3
 * All weights per situation type; each row must sum to exactly 1.0.
 * assertWeightIntegrity() is called at module load time and will throw
 * if any row violates the invariant.
 */

import type { ScoreWeights, WeightTable } from '@/types/situation'

export const WEIGHT_TABLE: WeightTable = {
  nutrition_goal: { goalMatch: 0.50, budgetFit: 0.15, timeFit: 0.20, preferenceMatch: 0.15 },
  broke:          { goalMatch: 0.25, budgetFit: 0.50, timeFit: 0.15, preferenceMatch: 0.10 },
  quick_meal:     { goalMatch: 0.20, budgetFit: 0.20, timeFit: 0.45, preferenceMatch: 0.15 },
  date_planning:  { goalMatch: 0.15, budgetFit: 0.20, timeFit: 0.10, preferenceMatch: 0.55 },
  sick:           { goalMatch: 0.45, budgetFit: 0.20, timeFit: 0.20, preferenceMatch: 0.15 },
  party_hosting:  { goalMatch: 0.25, budgetFit: 0.45, timeFit: 0.15, preferenceMatch: 0.15 },
  meal_prep:      { goalMatch: 0.45, budgetFit: 0.30, timeFit: 0.15, preferenceMatch: 0.10 },
  office_lunch:   { goalMatch: 0.20, budgetFit: 0.25, timeFit: 0.40, preferenceMatch: 0.15 },
  family_dinner:  { goalMatch: 0.20, budgetFit: 0.25, timeFit: 0.20, preferenceMatch: 0.35 },
  late_night:     { goalMatch: 0.15, budgetFit: 0.20, timeFit: 0.50, preferenceMatch: 0.15 },
  general:        { goalMatch: 0.35, budgetFit: 0.25, timeFit: 0.25, preferenceMatch: 0.15 },
}

/**
 * Validates that every row in the weight table sums to 1.0 (within floating-point rounding).
 * Throws an Error at module load time if any row fails.
 */
export function assertWeightIntegrity(table: WeightTable): void {
  for (const [type, w] of Object.entries(table)) {
    const sum = w.goalMatch + w.budgetFit + w.timeFit + w.preferenceMatch
    const rounded = Math.round(sum * 100) / 100
    if (rounded !== 1.0) {
      throw new Error(
        `Weight integrity violation for '${type}': sum=${sum} (expected 1.0)`
      )
    }
  }
}

// Invariant check runs once at module load time
assertWeightIntegrity(WEIGHT_TABLE)

/**
 * Returns the ScoreWeights for the given situation type.
 * Always returns a valid row (WEIGHT_TABLE is exhaustive over SituationType).
 */
export function getWeights(situationType: string): ScoreWeights {
  const w = (WEIGHT_TABLE as Record<string, ScoreWeights>)[situationType]
  if (w === undefined) {
    // Fallback for any unexpected type — should never happen if types are correct
    return WEIGHT_TABLE.general
  }
  return w
}
