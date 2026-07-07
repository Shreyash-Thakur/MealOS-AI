/**
 * MealOS AI — Required Fields Registry (MCR Table)
 *
 * Source of truth: docs/AGENTS.md §2.4 "Required fields by situation type"
 *
 * N3 rule: Questions are derived from the gap between SituationContext and the
 * per-situation-type required fields. This registry is data-driven — field lists
 * are never embedded in prompts or hardcoded in agent logic.
 *
 * Usage:
 *   import { REQUIRED_FIELDS, getRequiredFields, isMissingRequiredFields } from './requiredFields'
 */

import type { SituationType } from '@/types/situation'

/**
 * Per-situation-type required fields.
 * Each entry lists the ExplicitContext field names that MUST be known to produce
 * a recommendation. Absent fields drive mandatory clarification questions.
 *
 * Source: docs/AGENTS.md §2.4 table
 */
export const REQUIRED_FIELDS: Record<SituationType, ReadonlyArray<string>> = {
  // Both determine cook vs. order routing
  sick: ['canCook', 'alone'],

  // Budget confirms constraint severity
  broke: ['budget', 'canCook'],

  // guests assumed 2 — never ask; indoorOutdoor needed for venue selection
  date_planning: ['budget', 'indoorOutdoor'],

  // Both needed for multi-restaurant planning
  party_hosting: ['guests', 'budget'],

  // At least one nutrition target required
  nutrition_goal: ['nutritionGoal.protein', 'nutritionGoal.calories'],

  // Time is implied; craving is soft
  quick_meal: [],

  // Week vs. tonight determines scope
  meal_prep: ['timeframe'],

  // Location defaults to "office"
  office_lunch: [],

  // alone is false by definition; guests from memory
  family_dinner: [],

  // Determines delivery vs. fridge
  late_night: ['canCook'],

  // No required fields; Clarification Engine handles
  general: [],
}

/**
 * Returns the list of required field names for the given situation type.
 */
export function getRequiredFields(situationType: SituationType): ReadonlyArray<string> {
  return REQUIRED_FIELDS[situationType]
}

/**
 * Returns the required fields that are missing from the provided set of known fields.
 *
 * @param situationType - The detected situation type
 * @param knownFields - Set of field names that are currently populated
 * @returns Array of field names that are required but not yet known
 *
 * Special rule for nutrition_goal: at least ONE of the two nutrition targets
 * (protein OR calories) must be present — not both.
 */
export function getMissingRequiredFields(
  situationType: SituationType,
  knownFields: ReadonlyArray<string>
): string[] {
  const required = REQUIRED_FIELDS[situationType]

  // Special handling for nutrition_goal: either protein OR calories suffices
  if (situationType === 'nutrition_goal') {
    const hasProtein = knownFields.includes('nutritionGoal.protein')
    const hasCalories = knownFields.includes('nutritionGoal.calories')
    if (hasProtein || hasCalories) return []
    return ['nutritionGoal.protein'] // prompt for protein as the primary target
  }

  return required.filter(field => !knownFields.includes(field))
}

/**
 * Returns true if any required fields are missing for the given situation type.
 */
export function isMissingRequiredFields(
  situationType: SituationType,
  knownFields: ReadonlyArray<string>
): boolean {
  return getMissingRequiredFields(situationType, knownFields).length > 0
}
