/**
 * lib/memory/factKeys.ts
 * MealOS AI — FactKey const registry
 *
 * Rule N4 (IMPLEMENTATION_PLAYBOOK.md §4): this registry exists BEFORE any
 * Memory Agent write path. All writes are validated against it at compile time
 * (via FactValueByKey) and at runtime (via isValidFactKey guard).
 *
 * The 18 keys here mirror types/memory.ts FactValueByKey exactly.
 * Do not add keys here without also adding them to FactValueByKey in types/memory.ts.
 */

import type { FactKey } from '@/types/memory'

/**
 * Exhaustive tuple of all valid FactKey values.
 * Aligned 1:1 with FactValueByKey (18 keys).
 * TypeScript will error at compile time if any key is missing from FactValueByKey.
 */
export const FACT_KEYS = [
  'dietary.restrictions',
  'dietary.allergies',
  'budget.daily_food_target',
  'budget.dining_out_budget',
  'location.home',
  'location.work',
  'kitchen.skill_level',
  'kitchen.equipment',
  'household.size',
  'fitness.protein_target',
  'fitness.calorie_target',
  'fitness.gym_days',
  'preference.cuisines.liked',
  'preference.cuisines.disliked',
  'pantry.staples',
  'ordering.frequent_restaurants',
  'cooking.can_cook',
  'health.last_sick_day',
] as const satisfies readonly FactKey[]

/** Set for O(1) runtime lookups. Built once at module load. */
const FACT_KEY_SET: ReadonlySet<string> = new Set(FACT_KEYS)

/**
 * Runtime guard: returns true iff the given string is a canonical FactKey.
 * Use this in the Memory Agent before any write to reject invented keys.
 *
 * @example
 * if (!isValidFactKey(candidate)) {
 *   logger.warn('Memory Agent: unknown fact key rejected', { key: candidate })
 *   return
 * }
 */
export function isValidFactKey(key: string): key is FactKey {
  return FACT_KEY_SET.has(key)
}

/**
 * Expiry in days for each fact category, per docs/prompts/memory.md expiry table
 * and docs/AGENTS.md §5.5. null = permanent (never expires).
 *
 * Usage: pass `expiresAfterDays` from the Memory Agent output into
 * `addDays(new Date(), expiresAfterDays)` when computing the DB `expiresAt` column.
 */
export const FACT_EXPIRY_DAYS: Readonly<Record<FactKey, number | null>> = {
  'dietary.restrictions':          null,  // permanent
  'dietary.allergies':             null,  // permanent
  'budget.daily_food_target':      30,
  'budget.dining_out_budget':      30,
  'location.home':                 null,  // updated on change, not expired
  'location.work':                 null,
  'kitchen.skill_level':           null,
  'kitchen.equipment':             null,
  'household.size':                null,
  'fitness.protein_target':        45,
  'fitness.calorie_target':        45,
  'fitness.gym_days':              45,
  'preference.cuisines.liked':     90,
  'preference.cuisines.disliked':  90,
  'pantry.staples':                30,
  'ordering.frequent_restaurants': 90,
  'cooking.can_cook':              30,    // can change with circumstances
  'health.last_sick_day':          30,    // informational; short-lived
}
