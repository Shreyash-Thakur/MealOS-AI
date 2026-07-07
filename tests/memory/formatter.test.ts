/**
 * tests/memory/formatter.test.ts
 * Unit tests for lib/memory/formatter.ts
 *
 * Test focus:
 *   1. Full memory produces a formatted "Known User Preferences" block
 *   2. Null / empty fields are omitted (irrelevant memory ignored)
 *   3. Completely empty memory returns null
 *   4. Array caps keep the token budget bounded
 *   5. dislikedCuisines appear as "Avoid cuisines"
 *   6. nutrition_goal situation includes gym/calorie details
 *   7. Non-fitness situations omit gym_days and calorie_target
 *   8. householdSize=1 is omitted; >1 is shown
 */

import { describe, it, expect } from 'vitest'
import { formatMemoryForPlanning } from '@/lib/memory/formatter'
import type { PlanningMemory } from '@/lib/memory/retrieval'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function emptyMemory(): PlanningMemory {
  return {
    diet: null,
    budget: null,
    allergies: [],
    cookingSkill: null,
    kitchenEquipment: [],
    householdSize: 1,
    fitnessGoals: {},
    preferredCuisines: [],
    dislikedCuisines: [],
    frequentRestaurants: [],
    pantryStaples: [],
  }
}

function fullMemory(): PlanningMemory {
  return {
    diet: 'vegetarian',
    budget: 400,
    allergies: ['nuts', 'dairy'],
    cookingSkill: 'intermediate',
    kitchenEquipment: ['gas stove', 'mixer', 'pressure cooker'],
    householdSize: 2,
    fitnessGoals: { dailyProteinG: 150, dailyCalorieTarget: 2000, gymDays: ['Monday', 'Wednesday'] },
    preferredCuisines: ['North Indian', 'South Indian'],
    dislikedCuisines: ['Chinese'],
    frequentRestaurants: ['Swiggy Instamart', "McDonald's"],
    pantryStaples: ['rice', 'dal', 'onions', 'tomatoes', 'turmeric'],
  }
}

// ── Empty / null memory ───────────────────────────────────────────────────────

describe('empty memory', () => {
  it('returns null when all fields are empty/null', () => {
    expect(formatMemoryForPlanning(emptyMemory())).toBeNull()
  })

  it('returns null when memory has only default householdSize=1', () => {
    const mem = emptyMemory()
    mem.householdSize = 1
    expect(formatMemoryForPlanning(mem)).toBeNull()
  })
})

// ── Header ────────────────────────────────────────────────────────────────────

describe('header', () => {
  it('starts with "Known User Preferences" when memory is non-empty', () => {
    const mem = emptyMemory()
    mem.diet = 'vegetarian'
    const result = formatMemoryForPlanning(mem)
    expect(result).toMatch(/^Known User Preferences/)
  })
})

// ── Diet ─────────────────────────────────────────────────────────────────────

describe('diet field', () => {
  it('shows vegetarian diet', () => {
    const mem = emptyMemory()
    mem.diet = 'vegetarian'
    expect(formatMemoryForPlanning(mem)).toContain('Vegetarian')
  })

  it('shows vegan diet', () => {
    const mem = emptyMemory()
    mem.diet = 'vegan'
    expect(formatMemoryForPlanning(mem)).toContain('Vegan')
  })

  it('omits non_vegetarian diet (not a restriction)', () => {
    const mem = emptyMemory()
    mem.diet = 'non_vegetarian'
    expect(formatMemoryForPlanning(mem)).toBeNull()
  })

  it('omits diet when null', () => {
    const mem = fullMemory()
    mem.diet = null
    expect(formatMemoryForPlanning(mem)).not.toContain('diet')
  })
})

// ── Allergies ─────────────────────────────────────────────────────────────────

describe('allergies', () => {
  it('shows "Allergic to" when allergies present', () => {
    const mem = emptyMemory()
    mem.allergies = ['nuts']
    expect(formatMemoryForPlanning(mem)).toContain('Allergic to: nuts')
  })

  it('omits allergies when empty array', () => {
    const mem = fullMemory()
    mem.allergies = []
    expect(formatMemoryForPlanning(mem)).not.toContain('Allergic')
  })
})

// ── Budget ────────────────────────────────────────────────────────────────────

describe('budget', () => {
  it('shows budget with ₹ symbol', () => {
    const mem = emptyMemory()
    mem.budget = 350
    expect(formatMemoryForPlanning(mem)).toContain('₹350')
  })

  it('omits budget when null', () => {
    const mem = fullMemory()
    mem.budget = null
    expect(formatMemoryForPlanning(mem)).not.toContain('budget')
  })
})

// ── Cuisine preferences ───────────────────────────────────────────────────────

describe('cuisine preferences', () => {
  it('shows preferred cuisines', () => {
    const mem = emptyMemory()
    mem.preferredCuisines = ['North Indian']
    expect(formatMemoryForPlanning(mem)).toContain('North Indian')
  })

  it('shows disliked cuisines as "Avoid"', () => {
    const mem = emptyMemory()
    mem.budget = 300 // need at least one other field to get a non-null result
    mem.dislikedCuisines = ['Chinese']
    expect(formatMemoryForPlanning(mem)).toContain('Avoid')
    expect(formatMemoryForPlanning(mem)).toContain('Chinese')
  })

  it('omits preferred cuisines when empty', () => {
    const mem = fullMemory()
    mem.preferredCuisines = []
    expect(formatMemoryForPlanning(mem)).not.toContain('Preferred cuisines')
  })

  it('caps preferred cuisines at 5 items', () => {
    const mem = emptyMemory()
    mem.preferredCuisines = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
    const result = formatMemoryForPlanning(mem) ?? ''
    // Should contain at most 5 items
    const cuisinesLine = result.split('\n').find((l) => l.includes('Preferred'))
    expect(cuisinesLine).toBeDefined()
    const items = cuisinesLine!.split(':')[1]!.split(',')
    expect(items.length).toBeLessThanOrEqual(5)
  })
})

// ── Fitness goals ─────────────────────────────────────────────────────────────

describe('fitness goals', () => {
  it('shows protein target', () => {
    const mem = emptyMemory()
    mem.fitnessGoals = { dailyProteinG: 150 }
    expect(formatMemoryForPlanning(mem)).toContain('150g')
  })

  it('shows calorie target for nutrition_goal situation', () => {
    const mem = emptyMemory()
    mem.fitnessGoals = { dailyCalorieTarget: 2000 }
    const result = formatMemoryForPlanning(mem, 'nutrition_goal')
    expect(result).toContain('2000')
  })

  it('omits calorie target for non-fitness situations (irrelevant memory ignored)', () => {
    const mem = emptyMemory()
    mem.budget = 300
    mem.fitnessGoals = { dailyCalorieTarget: 2000 }
    const result = formatMemoryForPlanning(mem, 'sick')
    expect(result).not.toContain('Calorie')
  })

  it('shows gym_days for nutrition_goal situation', () => {
    const mem = emptyMemory()
    mem.fitnessGoals = { gymDays: ['Monday', 'Wednesday'] }
    const result = formatMemoryForPlanning(mem, 'nutrition_goal')
    expect(result).toContain('Monday')
  })

  it('omits gym_days for non-fitness situations (irrelevant memory ignored)', () => {
    const mem = emptyMemory()
    mem.budget = 300
    mem.fitnessGoals = { gymDays: ['Monday', 'Wednesday'] }
    const result = formatMemoryForPlanning(mem, 'sick')
    expect(result).not.toContain('Gym')
  })
})

// ── Pantry ────────────────────────────────────────────────────────────────────

describe('pantry bounds', () => {
  it('shows pantry staples', () => {
    const mem = emptyMemory()
    mem.pantryStaples = ['rice', 'dal']
    expect(formatMemoryForPlanning(mem)).toContain('rice')
  })

  it('caps pantry at 10 items and adds ellipsis', () => {
    const mem = emptyMemory()
    mem.pantryStaples = Array.from({ length: 15 }, (_, i) => `item${i}`)
    const result = formatMemoryForPlanning(mem) ?? ''
    const pantryLine = result.split('\n').find((l) => l.includes('Pantry'))
    expect(pantryLine).toBeDefined()
    // Should have ≤ 10 items listed plus ellipsis indicator
    const itemCount = pantryLine!.split(',').length
    expect(itemCount).toBeLessThanOrEqual(11) // 10 items + possible ellipsis
    expect(pantryLine).toContain('…')
  })

  it('omits pantry when empty', () => {
    const mem = fullMemory()
    mem.pantryStaples = []
    expect(formatMemoryForPlanning(mem)).not.toContain('Pantry')
  })
})

// ── Household size ────────────────────────────────────────────────────────────

describe('household size', () => {
  it('shows household size when > 1', () => {
    const mem = emptyMemory()
    mem.budget = 500
    mem.householdSize = 3
    expect(formatMemoryForPlanning(mem)).toContain('3')
  })

  it('omits household size when 1 (default / irrelevant)', () => {
    const mem = fullMemory()
    mem.householdSize = 1
    expect(formatMemoryForPlanning(mem)).not.toContain('people')
  })
})

// ── Full memory round-trip ────────────────────────────────────────────────────

describe('full memory', () => {
  it('includes all populated fields from a full PlanningMemory', () => {
    const result = formatMemoryForPlanning(fullMemory(), 'nutrition_goal')
    expect(result).toBeTruthy()
    expect(result).toContain('Vegetarian')
    expect(result).toContain('Allergic to: nuts, dairy')
    expect(result).toContain('₹400')
    expect(result).toContain('150g')
    expect(result).toContain('North Indian')
    expect(result).toContain('Avoid')
    expect(result).toContain('Chinese')
    expect(result).toContain('intermediate')
    expect(result).toContain('rice')
  })

  it('result is a string under 1 500 characters for a fully populated memory', () => {
    const result = formatMemoryForPlanning(fullMemory(), 'nutrition_goal') ?? ''
    expect(result.length).toBeLessThan(1500)
  })
})
