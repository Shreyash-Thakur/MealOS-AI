/**
 * MealOS AI — Plan Simulator Delta Calculation
 *
 * Source of truth: docs/DECISION_ENGINE.md §8
 *
 * Shows the user tradeoffs between the recommended path and its best alternative.
 * Positive cost delta = primary is cheaper (user saves money).
 * Positive time delta = primary is faster.
 * Positive protein delta = primary has more protein.
 */

import type { PathInput, PlanSimulatorDeltas } from '@/types/situation'
import type { Rupees, Minutes, Grams } from '@/types/primitives'

// Meaningfulness thresholds (docs/DECISION_ENGINE.md §8)
const COST_DELTA_THRESHOLD = 50     // rupees
const TIME_DELTA_THRESHOLD = 10     // minutes
const PROTEIN_DELTA_THRESHOLD = 10  // grams

/**
 * Computes the simulator deltas between primary and alternative paths.
 * Source: docs/DECISION_ENGINE.md §8
 */
export function computeSimulatorDeltas(
  primary: PathInput,
  alternative: PathInput | null
): PlanSimulatorDeltas {
  if (alternative === null) {
    return {
      primaryPath: primary.path,
      alternativePath: null,
      deltaCostRupees: null,
      deltaTimeMinutes: null,
      deltaProteinG: null,
      showCostDelta: false,
      showTimeDelta: false,
      showProteinDelta: false,
    }
  }

  // positive = primary is cheaper
  const deltaCost = alternative.estimatedCostRupees - primary.estimatedCostRupees
  // positive = primary is faster
  const deltaTime = alternative.estimatedTimeMinutes - primary.estimatedTimeMinutes

  let deltaProtein: number | null = null
  if (primary.proteinG !== null && alternative.proteinG !== null) {
    // positive = primary has more protein
    deltaProtein = primary.proteinG - alternative.proteinG
  }

  return {
    primaryPath: primary.path,
    alternativePath: alternative.path,
    deltaCostRupees: deltaCost as Rupees,
    deltaTimeMinutes: deltaTime as Minutes,
    deltaProteinG: deltaProtein as Grams | null,
    showCostDelta: Math.abs(deltaCost) >= COST_DELTA_THRESHOLD,
    showTimeDelta: Math.abs(deltaTime) >= TIME_DELTA_THRESHOLD,
    showProteinDelta:
      deltaProtein !== null && Math.abs(deltaProtein) >= PROTEIN_DELTA_THRESHOLD,
  }
}
