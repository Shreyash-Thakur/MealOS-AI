/**
 * lib/memory/formatter.ts
 * Formats a PlanningMemory struct into a human-readable "Known User Preferences"
 * block for injection into the Planning Agent prompt.
 *
 * Design choices:
 *   - Null / empty fields are silently omitted (no token waste on absent data)
 *   - Arrays are capped to keep the planning prompt token-bounded
 *   - Fitness-specific details (gym days, calorie target) only appear for
 *     nutrition_goal situations — they are irrelevant noise otherwise
 *   - Returns null when the user has no stored preferences, so the caller
 *     can fall back to a "No user memory available" placeholder
 */

import type { PlanningMemory } from './retrieval'

// ── Array caps ────────────────────────────────────────────────────────────────

const MAX_CUISINES    = 5
const MAX_PANTRY      = 10
const MAX_RESTAURANTS = 3
const MAX_EQUIPMENT   = 5

// Situation types where gym/calorie details are actually relevant
const FITNESS_SITUATIONS = new Set(['nutrition_goal'])

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a structured human-readable preferences block for the Planning Agent.
 *
 * @param memory        - PlanningMemory returned by getPlanningMemory()
 * @param situationType - Optional SituationType to filter fitness-specific facts
 * @returns             - Formatted string, or null when memory is entirely empty
 */
export function formatMemoryForPlanning(
  memory: PlanningMemory,
  situationType?: string,
): string | null {
  const isFitnessSituation = FITNESS_SITUATIONS.has(situationType ?? '')
  const lines: string[] = []

  // ── Diet / restrictions ─────────────────────────────────────────────────────
  if (memory.diet && memory.diet !== 'non_vegetarian') {
    const label = memory.diet.charAt(0).toUpperCase() + memory.diet.slice(1).replace('_', ' ')
    lines.push(`- ${label} diet`)
  }

  if (memory.allergies.length > 0) {
    lines.push(`- Allergic to: ${memory.allergies.join(', ')}`)
  }

  // ── Budget ──────────────────────────────────────────────────────────────────
  if (memory.budget !== null) {
    lines.push(`- Daily food budget: ₹${memory.budget}`)
  }

  // ── Fitness goals ───────────────────────────────────────────────────────────
  // Protein target is universally useful (affects path scoring)
  if (memory.fitnessGoals.dailyProteinG !== undefined) {
    lines.push(`- Protein target: ${memory.fitnessGoals.dailyProteinG}g/day`)
  }
  // Calorie target and gym days only shown for nutrition-focused situations
  if (isFitnessSituation) {
    if (memory.fitnessGoals.dailyCalorieTarget !== undefined) {
      lines.push(`- Calorie target: ${memory.fitnessGoals.dailyCalorieTarget} kcal/day`)
    }
    if (memory.fitnessGoals.gymDays && memory.fitnessGoals.gymDays.length > 0) {
      lines.push(`- Gym days: ${memory.fitnessGoals.gymDays.join(', ')}`)
    }
  }

  // ── Cuisine preferences ─────────────────────────────────────────────────────
  if (memory.preferredCuisines.length > 0) {
    const cuisines = memory.preferredCuisines.slice(0, MAX_CUISINES)
    lines.push(`- Preferred cuisines: ${cuisines.join(', ')}`)
  }

  if (memory.dislikedCuisines.length > 0) {
    lines.push(`- Avoid cuisines: ${memory.dislikedCuisines.slice(0, MAX_CUISINES).join(', ')}`)
  }

  // ── Kitchen ─────────────────────────────────────────────────────────────────
  if (memory.cookingSkill) {
    lines.push(`- Cooking skill: ${memory.cookingSkill}`)
  }

  if (memory.kitchenEquipment.length > 0) {
    const equipment = memory.kitchenEquipment.slice(0, MAX_EQUIPMENT)
    lines.push(`- Kitchen equipment: ${equipment.join(', ')}`)
  }

  // ── Household ───────────────────────────────────────────────────────────────
  if (memory.householdSize > 1) {
    lines.push(`- Cooking for: ${memory.householdSize} people`)
  }

  // ── Pantry ──────────────────────────────────────────────────────────────────
  if (memory.pantryStaples.length > 0) {
    const staples = memory.pantryStaples.slice(0, MAX_PANTRY)
    const suffix = memory.pantryStaples.length > MAX_PANTRY ? ', …' : ''
    lines.push(`- Pantry staples: ${staples.join(', ')}${suffix}`)
  }

  // ── Ordering history ────────────────────────────────────────────────────────
  if (memory.frequentRestaurants.length > 0) {
    const restaurants = memory.frequentRestaurants.slice(0, MAX_RESTAURANTS)
    lines.push(`- Frequent restaurants: ${restaurants.join(', ')}`)
  }

  if (lines.length === 0) return null
  return `Known User Preferences\n${lines.join('\n')}`
}
