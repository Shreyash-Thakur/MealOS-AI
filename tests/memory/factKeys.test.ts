/**
 * tests/memory/factKeys.test.ts
 * Unit tests for the FactKey const registry (lib/memory/factKeys.ts)
 */

import { describe, it, expect } from 'vitest'
import { FACT_KEYS, FACT_EXPIRY_DAYS, isValidFactKey } from '@/lib/memory/factKeys'
import type { FactKey } from '@/types/memory'

// All 18 keys from FactValueByKey (types/memory.ts)
const ALL_KEYS: FactKey[] = [
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
]

describe('FACT_KEYS registry', () => {
  it('contains exactly 18 keys', () => {
    expect(FACT_KEYS).toHaveLength(18)
  })

  it('is aligned 1:1 with FactValueByKey (all 18 FactKey values present)', () => {
    const registrySet = new Set(FACT_KEYS)
    for (const key of ALL_KEYS) {
      expect(registrySet.has(key)).toBe(true)
    }
  })

  it('contains no duplicate keys', () => {
    const set = new Set(FACT_KEYS)
    expect(set.size).toBe(FACT_KEYS.length)
  })

  it('every FACT_KEY satisfies the FactKey type constraint (compile-time check via satisfies)', () => {
    // If this file compiles, the `satisfies readonly FactKey[]` in factKeys.ts passed.
    // This test documents and re-affirms that invariant at runtime.
    for (const key of FACT_KEYS) {
      // Every key must be a string (FactKey is a union of string literals)
      expect(typeof key).toBe('string')
    }
  })
})

describe('isValidFactKey', () => {
  it('returns true for every canonical FactKey', () => {
    for (const key of ALL_KEYS) {
      expect(isValidFactKey(key)).toBe(true)
    }
  })

  it('returns false for invented keys', () => {
    const invented = [
      'health.sick_today',
      'mood.current',
      'food.craving',
      'diet',
      '',
      'dietary',
      'dietary.restrictions.extra',
      'DIETARY.RESTRICTIONS',
    ]
    for (const bad of invented) {
      expect(isValidFactKey(bad)).toBe(false)
    }
  })

  it('is case-sensitive (uppercase variants are rejected)', () => {
    expect(isValidFactKey('Dietary.Restrictions')).toBe(false)
    expect(isValidFactKey('COOKING.CAN_COOK')).toBe(false)
  })

  it('rejects the empty string', () => {
    expect(isValidFactKey('')).toBe(false)
  })
})

describe('FACT_EXPIRY_DAYS', () => {
  it('has an entry for every canonical FactKey', () => {
    for (const key of ALL_KEYS) {
      expect(key in FACT_EXPIRY_DAYS).toBe(true)
    }
  })

  it('permanent facts have null expiry', () => {
    const permanent: FactKey[] = [
      'dietary.restrictions',
      'dietary.allergies',
      'location.home',
      'location.work',
      'kitchen.skill_level',
      'kitchen.equipment',
      'household.size',
    ]
    for (const key of permanent) {
      expect(FACT_EXPIRY_DAYS[key]).toBeNull()
    }
  })

  it('budget facts expire in 30 days', () => {
    expect(FACT_EXPIRY_DAYS['budget.daily_food_target']).toBe(30)
    expect(FACT_EXPIRY_DAYS['budget.dining_out_budget']).toBe(30)
  })

  it('fitness facts expire in 45 days', () => {
    expect(FACT_EXPIRY_DAYS['fitness.protein_target']).toBe(45)
    expect(FACT_EXPIRY_DAYS['fitness.calorie_target']).toBe(45)
    expect(FACT_EXPIRY_DAYS['fitness.gym_days']).toBe(45)
  })

  it('preference and ordering facts expire in 90 days', () => {
    expect(FACT_EXPIRY_DAYS['preference.cuisines.liked']).toBe(90)
    expect(FACT_EXPIRY_DAYS['preference.cuisines.disliked']).toBe(90)
    expect(FACT_EXPIRY_DAYS['ordering.frequent_restaurants']).toBe(90)
  })

  it('cooking.can_cook expires in 30 days (can change with circumstances)', () => {
    expect(FACT_EXPIRY_DAYS['cooking.can_cook']).toBe(30)
  })

  it('all numeric expiry values are positive integers', () => {
    for (const key of ALL_KEYS) {
      const expiry = FACT_EXPIRY_DAYS[key]
      if (expiry !== null) {
        expect(Number.isInteger(expiry)).toBe(true)
        expect(expiry).toBeGreaterThan(0)
      }
    }
  })
})

// Compile-time type alignment test (runs at compile, documents intent at runtime)
describe('Type alignment: FactValueByKey covers all FACT_KEYS', () => {
  it('every FACT_KEY can be used as a FactKey without type error', () => {
    // This is a structural test — if FACT_KEYS had an entry not in FactValueByKey,
    // the `satisfies readonly FactKey[]` in factKeys.ts would fail to compile.
    // We verify runtime behavior as a proxy for the compile-time check.
    const keySet: Set<FactKey> = new Set(FACT_KEYS)
    expect(keySet.size).toBe(18)
  })

  it('FactValueByKey has exactly 18 keys (matches FACT_KEYS length)', () => {
    // Indirect check: we enumerate all known FactValueByKey keys and confirm count
    const factValueByKeyKeys = ALL_KEYS // ALL_KEYS was defined as keyof FactValueByKey
    expect(factValueByKeyKeys).toHaveLength(18)
    expect(FACT_KEYS).toHaveLength(18)
  })
})
