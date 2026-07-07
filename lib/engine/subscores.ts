/**
 * MealOS AI — Decision Engine Sub-Score Functions
 *
 * Source of truth: docs/DECISION_ENGINE.md §4
 *
 * Four pure, synchronous sub-score functions:
 *   computeGoalMatchScore   — §4.1
 *   computeBudgetFitScore   — §4.2
 *   computeTimeFitScore     — §4.3
 *   computePrefMatchScore   — §4.4
 *
 * All scores are in [0, 100]. No I/O, no LLM calls, no side effects.
 */

import type {
  ScoringContext,
  CookPathInput,
  OrderPathInput,
  DineOutPathInput,
  PathInput,
} from '@/types/situation'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Clamps value to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Linear interpolation between two output values given an input range.
 * Maps value from [x0,x1] to [y0,y1]. Clamps t to [0,1].
 */
export function linearMap(
  value: number,
  inputRange: [number, number],
  outputRange: [number, number]
): number {
  const [x0, x1] = inputRange
  const [y0, y1] = outputRange
  const t = clamp((value - x0) / (x1 - x0), 0, 1)
  return y0 + t * (y1 - y0)
}

/**
 * Converts a protein/calorie ratio (path.nutrient / goal.target) to a score.
 * Piecewise linear with peak at ratio [1.1, 1.3].
 * Source: docs/DECISION_ENGINE.md §4.1
 */
export function goalMatchFromNutritionRatio(ratio: number): number {
  if (ratio >= 1.1 && ratio <= 1.3) return 100
  if (ratio >= 0.0 && ratio < 0.5) return linearMap(ratio, [0.0, 0.5], [0, 30])
  if (ratio >= 0.5 && ratio < 0.8) return linearMap(ratio, [0.5, 0.8], [30, 65])
  if (ratio >= 0.8 && ratio < 1.0) return linearMap(ratio, [0.8, 1.0], [65, 95])
  if (ratio >= 1.0 && ratio < 1.1) return linearMap(ratio, [1.0, 1.1], [95, 100])
  if (ratio >= 1.3 && ratio < 1.5) return linearMap(ratio, [1.3, 1.5], [100, 70])
  if (ratio >= 1.5 && ratio < 2.0) return linearMap(ratio, [1.5, 2.0], [70, 40])
  if (ratio >= 2.0) return 40
  return 0
}

// ── 4.1 goalMatchScore ────────────────────────────────────────────────────────

/**
 * Computes goalMatchScore (0–100) for a single path.
 * Source: docs/DECISION_ENGINE.md §4.1
 */
export function computeGoalMatchScore(
  context: ScoringContext,
  path: PathInput
): number {
  const { situationType } = context

  // Hard block: cannot cook
  if (path.path === 'COOK' && !context.canCook) return 0

  // Hard block: 50% over budget is goal failure for budget-conscious contexts
  if (
    context.budgetRupees !== null &&
    path.estimatedCostRupees > context.budgetRupees * 1.5
  ) {
    return 0
  }

  switch (situationType) {
    case 'nutrition_goal': {
      if (context.nutritionGoal === null) return 50
      let score = 0
      let hasScore = false

      if (context.nutritionGoal.proteinG !== undefined) {
        const target = context.nutritionGoal.proteinG
        if (path.proteinG === null) return 10
        const ratio = path.proteinG / target
        score = goalMatchFromNutritionRatio(ratio)
        hasScore = true
      }

      if (context.nutritionGoal.caloriesKcal !== undefined) {
        const calTarget = context.nutritionGoal.caloriesKcal
        if (path.caloriesKcal !== null) {
          const calRatio = path.caloriesKcal / calTarget
          const calScore = goalMatchFromNutritionRatio(calRatio)
          score = hasScore ? (score + calScore) / 2 : calScore
        }
      }

      return clamp(score, 0, 100)
    }

    case 'broke': {
      if (path.estimatedCostRupees === 0) return 100
      if (context.budgetRupees === null) return 50
      const ratio = path.estimatedCostRupees / context.budgetRupees
      // Piecewise: 0→100, 0.5→95, 0.8→80, 1.0→60, 1.2→0
      if (ratio <= 0) return 100
      if (ratio <= 0.5) return linearMap(ratio, [0, 0.5], [100, 95])
      if (ratio <= 0.8) return linearMap(ratio, [0.5, 0.8], [95, 80])
      if (ratio <= 1.0) return linearMap(ratio, [0.8, 1.0], [80, 60])
      if (ratio <= 1.2) return linearMap(ratio, [1.0, 1.2], [60, 0])
      return 0
    }

    case 'sick': {
      if (path.path === 'DINE_OUT') return 10
      if (path.path === 'COOK') {
        const cook = path as CookPathInput
        if (cook.difficultyLevel === 'easy' && cook.canMakeFromPantry) return 90
        if (cook.difficultyLevel === 'easy') return 70
        if (cook.difficultyLevel === 'medium' && cook.canMakeFromPantry) return 55
        return 30
      }
      if (path.path === 'ORDER') return 80
      return 50
    }

    case 'date_planning': {
      if (path.path === 'DINE_OUT') {
        const dineOut = path as DineOutPathInput
        if (dineOut.hasTableAvailableNow) return 90
        return 40
      }
      if (path.path === 'COOK') return 55
      if (path.path === 'ORDER') return 20
      return 50
    }

    case 'party_hosting': {
      // Check if path can serve the group
      if (path.path === 'DINE_OUT') {
        const dineOut = path as DineOutPathInput
        if (context.guests > dineOut.guestCapacity) return 0
        if (context.guests > 12) return 30
        return 70
      }
      if (path.path === 'COOK') {
        if (context.guests <= 4) return 80
        if (context.guests <= 8) return 60
        if (context.guests <= 12) return 40
        return 20
      }
      if (path.path === 'ORDER') return 85
      return 50
    }

    case 'meal_prep': {
      if (path.path === 'COOK') return 90
      if (path.path === 'ORDER') return 20
      if (path.path === 'DINE_OUT') return 5
      return 50
    }

    case 'quick_meal': {
      if (path.path === 'COOK') {
        const cook = path as CookPathInput
        if (cook.difficultyLevel === 'easy') return 80
        if (cook.difficultyLevel === 'medium') return 55
        return 30
      }
      if (path.path === 'ORDER') return 85
      if (path.path === 'DINE_OUT') return 40
      return 50
    }

    case 'office_lunch': {
      if (path.path === 'COOK') return 20
      if (path.path === 'ORDER') return 80
      if (path.path === 'DINE_OUT') return 70
      return 50
    }

    case 'family_dinner': {
      if (path.path === 'COOK') return 85
      if (path.path === 'ORDER') return 65
      if (path.path === 'DINE_OUT') return 70
      return 50
    }

    case 'late_night': {
      if (path.path === 'ORDER') {
        return context.swiggAvailable ? 90 : 0
      }
      if (path.path === 'COOK') return 75
      if (path.path === 'DINE_OUT') return 15
      return 50
    }

    case 'general': {
      if (path.path === 'COOK') return 70
      if (path.path === 'ORDER') return 75
      if (path.path === 'DINE_OUT') return 65
      return 50
    }

    default:
      return 50
  }
}

// ── 4.2 budgetFitScore ────────────────────────────────────────────────────────

/**
 * Fallback: scores cost against median Indian urban food spend thresholds.
 * Used when no budget is known.
 * Source: docs/DECISION_ENGINE.md §4.2
 */
function budgetScoreFromAbsoluteCost(cost: number, situationType: string): number {
  let score: number
  if (cost === 0) score = 100
  else if (cost <= 100) score = 90
  else if (cost <= 200) score = 80
  else if (cost <= 350) score = 70
  else if (cost <= 600) score = 55
  else if (cost <= 1000) score = 40
  else score = 25

  // Date planning: higher absolute cost is expected
  if (situationType === 'date_planning') {
    if (cost <= 3000) score = Math.max(score, 70)
  }

  return score
}

/**
 * Computes budgetFitScore (0–100).
 * Source: docs/DECISION_ENGINE.md §4.2
 */
export function computeBudgetFitScore(
  path: PathInput,
  context: ScoringContext
): number {
  const cost = path.estimatedCostRupees
  const budget = context.budgetRupees

  if (budget === null) {
    return budgetScoreFromAbsoluteCost(cost, context.situationType)
  }

  // Hard block: zero budget
  if (budget === 0) {
    return cost === 0 ? 100 : 0
  }

  const ratio = cost / budget

  // Base piecewise score
  let score: number
  if (ratio <= 0.8) {
    score = 100
  } else if (ratio <= 1.0) {
    score = linearMap(ratio, [0.8, 1.0], [100, 85])
  } else if (ratio <= 1.2) {
    score = linearMap(ratio, [1.0, 1.2], [85, 50])
  } else if (ratio <= 1.5) {
    score = linearMap(ratio, [1.2, 1.5], [50, 10])
  } else {
    score = 0
  }

  // Apply flexibility modifier
  if (context.budgetFlexibility === 'strict') {
    if (ratio > 1.0) return 0
  } else if (context.budgetFlexibility === 'flexible') {
    if (ratio <= 1.3) score = Math.min(score + 15, 100)
  }

  return score
}

// ── 4.3 timeFitScore ──────────────────────────────────────────────────────────

/**
 * Fallback: scores time against reference durations when no constraint given.
 * Source: docs/DECISION_ENGINE.md §4.3
 */
function timeFitFromAbsoluteTime(minutes: number, situationType: string): number {
  let score: number
  if (minutes <= 15) score = 100
  else if (minutes <= 30) score = linearMap(minutes, [15, 30], [100, 85])
  else if (minutes <= 60) score = linearMap(minutes, [30, 60], [85, 65])
  else if (minutes <= 90) score = linearMap(minutes, [60, 90], [65, 40])
  else if (minutes <= 120) score = linearMap(minutes, [90, 120], [40, 20])
  else score = 10

  // Date planning and family dinner: leisurely meals are normal
  if (situationType === 'date_planning' || situationType === 'family_dinner') {
    if (minutes <= 90) score = Math.max(score, 70)
    else if (minutes <= 150) score = Math.max(score, 55)
  }

  return score
}

/**
 * Computes timeFitScore (0–100).
 * Source: docs/DECISION_ENGINE.md §4.3
 */
export function computeTimeFitScore(
  path: PathInput,
  context: ScoringContext
): number {
  const actualMinutes = path.estimatedTimeMinutes
  const constraint = context.timeConstraintMinutes

  if (constraint === null) {
    return timeFitFromAbsoluteTime(actualMinutes, context.situationType)
  }

  const ratio = actualMinutes / constraint

  if (ratio <= 0.9) return 100
  if (ratio <= 1.0) return linearMap(ratio, [0.9, 1.0], [100, 90])
  if (ratio <= 1.1) return linearMap(ratio, [1.0, 1.1], [90, 75])
  if (ratio <= 1.25) return linearMap(ratio, [1.1, 1.25], [75, 50])
  if (ratio <= 1.5) return linearMap(ratio, [1.25, 1.5], [50, 20])
  if (ratio <= 2.0) return linearMap(ratio, [1.5, 2.0], [20, 0])
  return 0
}

// ── 4.4 prefMatchScore ────────────────────────────────────────────────────────

export interface PrefMatchResult {
  score: number
  hardBlocks: string[]
}

/**
 * Computes prefMatchScore (0–100) and collects hard blocks.
 * Source: docs/DECISION_ENGINE.md §4.4
 */
export function computePrefMatchScore(
  path: PathInput,
  context: ScoringContext
): PrefMatchResult {
  const hardBlocks: string[] = []
  let score = 100

  // STEP 1: Allergen hard block
  for (const allergen of path.containsAllergens) {
    if (context.allergens.includes(allergen)) {
      hardBlocks.push(`allergen:${allergen}`)
    }
  }
  if (hardBlocks.length > 0) {
    return { score: 0, hardBlocks }
  }

  // STEP 2: Dietary restriction matching
  for (const restriction of context.dietaryRestrictions) {
    switch (restriction) {
      case 'vegetarian': {
        if (path.path === 'ORDER' || path.path === 'DINE_OUT') {
          const p = path as OrderPathInput | DineOutPathInput
          if (p.isFullyVegetarian) {
            // No penalty
          } else if (p.isVegetarianMenuAvailable) {
            score -= 25
          } else {
            return { score: 0, hardBlocks: ['no_vegetarian_option'] }
          }
        } else if (path.path === 'COOK') {
          const cook = path as CookPathInput
          if (!cook.isVegetarian) {
            return { score: 0, hardBlocks: ['recipe_not_vegetarian'] }
          }
        }
        break
      }

      case 'vegan': {
        if (path.path === 'ORDER' || path.path === 'DINE_OUT') {
          const p = path as OrderPathInput | DineOutPathInput
          if (!p.isVeganMenuAvailable) {
            return { score: 0, hardBlocks: ['no_vegan_option'] }
          }
          score -= 5
        } else if (path.path === 'COOK') {
          const cook = path as CookPathInput
          if (!cook.isVegan) {
            return { score: 0, hardBlocks: ['recipe_not_vegan'] }
          }
        }
        break
      }

      case 'jain': {
        if (path.path === 'ORDER' || path.path === 'DINE_OUT') {
          const p = path as OrderPathInput | DineOutPathInput
          if (!p.isFullyVegetarian) {
            return { score: 0, hardBlocks: ['jain_restriction'] }
          }
        } else if (path.path === 'COOK') {
          const cook = path as CookPathInput
          if (!cook.isVegetarian) {
            return { score: 0, hardBlocks: ['recipe_not_jain'] }
          }
        }
        break
      }

      case 'gluten_free': {
        if (path.containsAllergens.includes('gluten')) {
          return { score: 0, hardBlocks: ['allergen:gluten'] }
        }
        score -= 5
        break
      }

      case 'dairy_free': {
        if (path.containsAllergens.includes('dairy')) {
          return { score: 0, hardBlocks: ['allergen:dairy'] }
        }
        break
      }

      case 'halal': {
        if (path.path === 'ORDER' || path.path === 'DINE_OUT') {
          score -= 20
        }
        break
      }

      case 'kosher':
        // No specific handling defined in spec; apply no extra penalty
        break
    }
  }

  // STEP 3: Cuisine preference bonus/penalty
  const pathCuisine = (path as { cuisineType?: string | null }).cuisineType?.toLowerCase() ?? null

  if (pathCuisine !== null) {
    let likedApplied = false
    for (const liked of context.likedCuisines) {
      if (pathCuisine.includes(liked.toLowerCase())) {
        score += 20
        likedApplied = true
        break // apply once
      }
    }

    if (!likedApplied) {
      // Only apply dislike penalty if no like bonus was applied
    }

    for (const disliked of context.dislikedCuisines) {
      if (pathCuisine.includes(disliked.toLowerCase())) {
        score -= 30
        break // apply once
      }
    }
  }

  // STEP 4: Date planning ambience bonus (DINE_OUT only)
  if (context.occasion === 'date' && path.path === 'DINE_OUT') {
    const dineOut = path as DineOutPathInput
    const ambienceBonus = linearMap(dineOut.ambienceScore, [0, 100], [0, 15])
    score += ambienceBonus
  }

  // STEP 5: Clamp to [0, 100]
  return { score: clamp(score, 0, 100), hardBlocks }
}
