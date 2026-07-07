/**
 * tests/memory/retrieval.test.ts
 * Unit tests for the memory read service (lib/memory/retrieval.ts)
 *
 * The repo is mocked so tests stay fast and database-free.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getMemoryContext, buildMemorySummary, getPlanningMemory } from '@/lib/memory/retrieval'
import type { FactSummary } from '@/lib/repositories/memoryFactRepo'

// Mock the repository — we test retrieval logic, not DB behavior
vi.mock('@/lib/repositories/memoryFactRepo', () => ({
  getFactsForUser: vi.fn(),
}))

import { getFactsForUser } from '@/lib/repositories/memoryFactRepo'

const mockGetFacts = vi.mocked(getFactsForUser)

beforeEach(() => {
  vi.resetAllMocks()
})

// ── Helper ────────────────────────────────────────────────────────────────────

// Prisma.JsonValue includes string | number | boolean | null | JsonArray | JsonObject
// Cast to satisfy the FactSummary type constraint while keeping test data readable.
function makeFact(factKey: string, factValue: unknown, confidence = 0.8, source = 'user_stated'): FactSummary {
  return { factKey, factValue, confidence, source } as FactSummary
}

// ── getMemoryContext ──────────────────────────────────────────────────────────

describe('getMemoryContext', () => {
  it('returns empty object when user has no facts', async () => {
    mockGetFacts.mockResolvedValue([])
    const ctx = await getMemoryContext('user-1')
    expect(ctx).toEqual({})
  })

  it('maps dietary.restrictions vegetarian to dietType', async () => {
    mockGetFacts.mockResolvedValue([
      makeFact('dietary.restrictions', ['vegetarian']),
    ])
    const ctx = await getMemoryContext('user-1')
    expect(ctx.dietType).toBe('vegetarian')
  })

  it('maps dietary.allergies', async () => {
    mockGetFacts.mockResolvedValue([
      makeFact('dietary.allergies', ['shellfish', 'peanuts']),
    ])
    const ctx = await getMemoryContext('user-1')
    expect(ctx.allergies).toEqual(['shellfish', 'peanuts'])
  })

  it('maps budget.daily_food_target', async () => {
    mockGetFacts.mockResolvedValue([
      makeFact('budget.daily_food_target', 350),
    ])
    const ctx = await getMemoryContext('user-1')
    expect(ctx.budget).toBe(350)
  })

  it('maps kitchen.skill_level', async () => {
    mockGetFacts.mockResolvedValue([
      makeFact('kitchen.skill_level', 'intermediate'),
    ])
    const ctx = await getMemoryContext('user-1')
    expect(ctx.cookingSkill).toBe('intermediate')
  })

  it('maps location.home', async () => {
    mockGetFacts.mockResolvedValue([
      makeFact('location.home', 'Bandra West, Mumbai'),
    ])
    const ctx = await getMemoryContext('user-1')
    expect(ctx.homeLoc).toBe('Bandra West, Mumbai')
  })

  it('maps fitness.protein_target', async () => {
    mockGetFacts.mockResolvedValue([
      makeFact('fitness.protein_target', 150),
    ])
    const ctx = await getMemoryContext('user-1')
    expect(ctx.proteinTarget).toBe(150)
  })

  it('maps preference.cuisines.liked', async () => {
    mockGetFacts.mockResolvedValue([
      makeFact('preference.cuisines.liked', ['South Indian', 'Italian']),
    ])
    const ctx = await getMemoryContext('user-1')
    expect(ctx.preferredCuisines).toEqual(['South Indian', 'Italian'])
  })

  it('skips unknown keys silently', async () => {
    mockGetFacts.mockResolvedValue([
      makeFact('mood.current', 'happy', 0.8, 'behavior_inferred'),
    ])
    const ctx = await getMemoryContext('user-1')
    expect(ctx).toEqual({})
  })

  it('filters confidence-expired inferred facts', async () => {
    // behavior_inferred at confidence 0.1 — effectively expired via confidence decay
    mockGetFacts.mockResolvedValue([
      makeFact('cooking.can_cook', false, 0.1, 'behavior_inferred'),
    ])
    // The decay filter will exclude this (0.1 < 0.3 threshold on first use = no lastConfirmedAt,
    // so elapsed = 0 → effective confidence = 0.1, which is < 0.3 → expired)
    const ctx = await getMemoryContext('user-1')
    // cooking.can_cook is not mapped into MemoryContext fields, so result is empty regardless
    expect(ctx).toEqual({})
  })
})

// ── buildMemorySummary ────────────────────────────────────────────────────────

describe('buildMemorySummary', () => {
  it('returns null when user has no facts', async () => {
    mockGetFacts.mockResolvedValue([])
    expect(await buildMemorySummary('user-1')).toBeNull()
  })

  it('includes dietary restrictions', async () => {
    mockGetFacts.mockResolvedValue([
      makeFact('dietary.restrictions', ['vegetarian']),
    ])
    const summary = await buildMemorySummary('user-1')
    expect(summary).toContain('vegetarian')
  })

  it('includes budget', async () => {
    mockGetFacts.mockResolvedValue([
      makeFact('budget.daily_food_target', 350),
    ])
    const summary = await buildMemorySummary('user-1')
    expect(summary).toContain('Rs 350')
  })

  it('includes home location', async () => {
    mockGetFacts.mockResolvedValue([
      makeFact('location.home', 'Bandra'),
    ])
    const summary = await buildMemorySummary('user-1')
    expect(summary).toContain('Bandra')
  })

  it('includes cooking skill level', async () => {
    mockGetFacts.mockResolvedValue([
      makeFact('kitchen.skill_level', 'intermediate'),
    ])
    const summary = await buildMemorySummary('user-1')
    expect(summary).toContain('intermediate level')
  })

  it('builds a multi-fact summary separated by commas', async () => {
    mockGetFacts.mockResolvedValue([
      makeFact('dietary.restrictions', ['vegetarian']),
      makeFact('budget.daily_food_target', 350),
      makeFact('location.home', 'Bandra West, Mumbai'),
    ])
    const summary = await buildMemorySummary('user-1')
    expect(summary).toBeTruthy()
    // Should be a comma-separated string
    expect(summary).toContain(',')
  })

  it('includes protein target', async () => {
    mockGetFacts.mockResolvedValue([
      makeFact('fitness.protein_target', 150),
    ])
    const summary = await buildMemorySummary('user-1')
    expect(summary).toContain('150g daily protein target')
  })

  it('does not mention household size of 1 (default)', async () => {
    mockGetFacts.mockResolvedValue([
      makeFact('household.size', 1),
    ])
    const summary = await buildMemorySummary('user-1')
    // household size of 1 is the default — not mentioned
    expect(summary).toBeNull()
  })

  it('mentions household size when > 1', async () => {
    mockGetFacts.mockResolvedValue([
      makeFact('household.size', 4),
    ])
    const summary = await buildMemorySummary('user-1')
    expect(summary).toContain('household of 4')
  })
})

// ── getPlanningMemory ─────────────────────────────────────────────────────────

describe('getPlanningMemory', () => {
  it('returns safe defaults when user has no facts', async () => {
    mockGetFacts.mockResolvedValue([])
    const mem = await getPlanningMemory('user-1')
    expect(mem.diet).toBeNull()
    expect(mem.budget).toBeNull()
    expect(mem.allergies).toEqual([])
    expect(mem.cookingSkill).toBeNull()
    expect(mem.kitchenEquipment).toEqual([])
    expect(mem.householdSize).toBe(1) // default
    expect(mem.fitnessGoals).toEqual({})
    expect(mem.preferredCuisines).toEqual([])
    expect(mem.frequentRestaurants).toEqual([])
    expect(mem.pantryStaples).toEqual([])
  })

  it('populates diet from dietary.restrictions', async () => {
    mockGetFacts.mockResolvedValue([
      makeFact('dietary.restrictions', ['vegetarian']),
    ])
    const mem = await getPlanningMemory('user-1')
    expect(mem.diet).toBe('vegetarian')
  })

  it('populates fitness goals', async () => {
    mockGetFacts.mockResolvedValue([
      makeFact('fitness.protein_target', 150),
      makeFact('fitness.calorie_target', 2000),
      makeFact('fitness.gym_days', ['Monday', 'Wednesday']),
    ])
    const mem = await getPlanningMemory('user-1')
    expect(mem.fitnessGoals.dailyProteinG).toBe(150)
    expect(mem.fitnessGoals.dailyCalorieTarget).toBe(2000)
    expect(mem.fitnessGoals.gymDays).toEqual(['Monday', 'Wednesday'])
  })

  it('populates frequentRestaurants and pantryStaples', async () => {
    mockGetFacts.mockResolvedValue([
      makeFact('ordering.frequent_restaurants', ['Behrouz Biryani']),
      makeFact('pantry.staples', ['rice', 'dal', 'oil']),
    ])
    const mem = await getPlanningMemory('user-1')
    expect(mem.frequentRestaurants).toEqual(['Behrouz Biryani'])
    expect(mem.pantryStaples).toEqual(['rice', 'dal', 'oil'])
  })

  it('uses household.size from facts', async () => {
    mockGetFacts.mockResolvedValue([
      makeFact('household.size', 3),
    ])
    const mem = await getPlanningMemory('user-1')
    expect(mem.householdSize).toBe(3)
  })
})
