/**
 * tests/engine/contextBuilder.test.ts
 * Unit tests for lib/engine/contextBuilder.ts
 *
 * buildScoringContext: converts SituationContext → ScoringContext
 * buildPathInputs: converts ToolAgentOutputValidated → {cook, order, dineOut}
 *
 * Test focus:
 *   1. ScoringContext derives situationType, budget, canCook, guests, isWeekend
 *   2. Pantry state mapping (empty / partial / stocked) from pantry item count
 *   3. Dietary restrictions and allergen extraction from memory
 *   4. Path availability signals (swiggAvailable, dineoutAvailable)
 *   5. CookPathInput defaults when no tool results
 *   6. OrderPathInput built from top Swiggy restaurant
 *   7. DineOutPathInput built from top dineout venue
 *   8. Degraded mode: all swiggy paths unavailable when swiggyError present
 */

import { describe, it, expect } from 'vitest'
import {
  buildScoringContext,
  buildPathInputs,
  pantryStateFromCount,
} from '@/lib/engine/contextBuilder'
import type { SituationContext } from '@/types/situation'
import type { ToolAgentOutputValidated } from '@/lib/schemas/agents'
import type { Restaurant, DineoutVenue } from '@/types/swiggy'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<SituationContext> = {}): SituationContext {
  return {
    situationType: 'sick',
    explicit: {
      canCook: true,
      budget: 300 as SituationContext['explicit']['budget'],
      alone: true,
    },
    inferred: { timeOfDay: 'dinner', isWeekend: false },
    fromMemory: {
      dietType: 'vegetarian',
      allergies: ['nuts'],
      cookingSkill: 'intermediate',
      kitchenEquipment: ['gas stove'],
      budget: 350 as SituationContext['fromMemory']['budget'],
      preferredCuisines: ['North Indian'],
    },
    ...overrides,
  }
}

function makeToolOutput(overrides: Partial<ToolAgentOutputValidated> = {}): ToolAgentOutputValidated {
  return {
    restaurants: [],
    instamartItems: [],
    dineoutVenues: [],
    youtube: null,
    errors: [],
    _meta: {
      toolsAttempted: [],
      toolsSucceeded: [],
      totalLatencyMs: 100 as ToolAgentOutputValidated['_meta']['totalLatencyMs'],
    },
    ...overrides,
  }
}

function makeRestaurant(name: string, rating = 4.2): Restaurant {
  return {
    restaurantId: `r-${name}` as Restaurant['restaurantId'],
    name,
    rating,
    deliveryTimeMin: 30 as Restaurant['deliveryTimeMin'],
    deliveryFee: 25 as Restaurant['deliveryFee'],
    minOrderValue: 100 as Restaurant['minOrderValue'],
    cuisineTypes: ['North Indian'],
    topItems: [],
  }
}

function makeVenue(name: string): DineoutVenue {
  return {
    venueId: `v-${name}` as DineoutVenue['venueId'],
    name,
    rating: 4.0 as DineoutVenue['rating'],
    pricePerPerson: 500 as DineoutVenue['pricePerPerson'],
    cuisineTypes: ['North Indian'],
    ambience: ['casual'],
    availableSlots: ['7:30 PM', '8:00 PM'],
    isVegFriendly: true,
    distanceKm: 2.5,
  }
}

// ── pantryStateFromCount ──────────────────────────────────────────────────────

describe('pantryStateFromCount', () => {
  it('returns "empty" when count is 0', () => {
    expect(pantryStateFromCount(0)).toBe('empty')
  })

  it('returns "partial" when count is 1–9', () => {
    expect(pantryStateFromCount(1)).toBe('partial')
    expect(pantryStateFromCount(9)).toBe('partial')
  })

  it('returns "stocked" when count is 10 or more', () => {
    expect(pantryStateFromCount(10)).toBe('stocked')
    expect(pantryStateFromCount(50)).toBe('stocked')
  })
})

// ── buildScoringContext ───────────────────────────────────────────────────────

describe('buildScoringContext — situation fields', () => {
  it('copies situationType from the context', () => {
    const ctx = makeContext({ situationType: 'nutrition_goal' })
    const result = buildScoringContext(ctx, makeToolOutput(), [])
    expect(result.situationType).toBe('nutrition_goal')
  })

  it('uses explicit budget when present', () => {
    const ctx = makeContext()
    const result = buildScoringContext(ctx, makeToolOutput(), [])
    expect(result.budgetRupees).toBe(300) // explicit.budget wins over fromMemory
  })

  it('falls back to fromMemory.budget when explicit.budget is absent', () => {
    const ctx = makeContext({ explicit: { canCook: true, alone: true } })
    const result = buildScoringContext(ctx, makeToolOutput(), [])
    expect(result.budgetRupees).toBe(350)
  })

  it('sets canCook from explicit.canCook', () => {
    const ctx = makeContext({ explicit: { canCook: false } })
    const result = buildScoringContext(ctx, makeToolOutput(), [])
    expect(result.canCook).toBe(false)
  })

  it('defaults canCook to true when not stated', () => {
    const ctx = makeContext({ explicit: {} })
    const result = buildScoringContext(ctx, makeToolOutput(), [])
    expect(result.canCook).toBe(true)
  })

  it('derives guests=1 when alone=true', () => {
    const ctx = makeContext({ explicit: { alone: true } })
    const result = buildScoringContext(ctx, makeToolOutput(), [])
    expect(result.guests).toBe(1)
  })

  it('uses explicit.guests when provided', () => {
    const ctx = makeContext({ explicit: { guests: 4 as SituationContext['explicit']['guests'] } })
    const result = buildScoringContext(ctx, makeToolOutput(), [])
    expect(result.guests).toBe(4)
  })

  it('reads isWeekend from inferred context', () => {
    const ctx = makeContext({ inferred: { isWeekend: true } })
    const result = buildScoringContext(ctx, makeToolOutput(), [])
    expect(result.isWeekend).toBe(true)
  })
})

describe('buildScoringContext — dietary', () => {
  it('maps vegetarian dietType to dietaryRestrictions', () => {
    const result = buildScoringContext(makeContext(), makeToolOutput(), [])
    expect(result.dietaryRestrictions).toContain('vegetarian')
  })

  it('extracts allergens from fromMemory.allergies', () => {
    const ctx = makeContext()
    const result = buildScoringContext(ctx, makeToolOutput(), [])
    expect(result.allergens).toContain('nuts')
  })

  it('returns empty allergens when memory has none', () => {
    const ctx = makeContext({ fromMemory: {} })
    const result = buildScoringContext(ctx, makeToolOutput(), [])
    expect(result.allergens).toEqual([])
  })
})

describe('buildScoringContext — availability signals', () => {
  it('sets swiggAvailable=true when tool returned restaurants', () => {
    const tool = makeToolOutput({ restaurants: [makeRestaurant('R')] })
    const result = buildScoringContext(makeContext(), tool, [])
    expect(result.swiggAvailable).toBe(true)
  })

  it('sets swiggAvailable=false when swiggyError is SWIGGY_UNAVAILABLE', () => {
    const tool = makeToolOutput({
      restaurants: null,
      swiggyError: 'SWIGGY_UNAVAILABLE',
    })
    const result = buildScoringContext(makeContext(), tool, [])
    expect(result.swiggAvailable).toBe(false)
  })

  it('sets dineoutAvailable=true when dineout venues exist', () => {
    const tool = makeToolOutput({ dineoutVenues: [makeVenue('V')] })
    const result = buildScoringContext(makeContext(), tool, [])
    expect(result.dineoutAvailable).toBe(true)
  })

  it('pantryDataAvailable=true when pantryItems are non-empty', () => {
    const result = buildScoringContext(makeContext(), makeToolOutput(), [{ id: 'p1' } as never])
    expect(result.pantryDataAvailable).toBe(true)
  })
})

// ── buildPathInputs ───────────────────────────────────────────────────────────

describe('buildPathInputs', () => {
  it('cook path is available when canCook is true', () => {
    const { cook } = buildPathInputs(makeContext(), makeToolOutput(), [])
    expect(cook.available).toBe(true)
  })

  it('cook path is unavailable when canCook is false', () => {
    const ctx = makeContext({ explicit: { canCook: false } })
    const { cook } = buildPathInputs(ctx, makeToolOutput(), [])
    expect(cook.available).toBe(false)
  })

  it('order path uses top restaurant when restaurants are present', () => {
    const top = makeRestaurant('Haldirams', 4.8)
    const tool = makeToolOutput({ restaurants: [top, makeRestaurant('Other', 3.5)] })
    const { order } = buildPathInputs(makeContext(), tool, [])
    expect(order.available).toBe(true)
    expect(order.restaurantName).toBe('Haldirams')
    expect(order.deliveryTimeMinutes).toBe(30)
  })

  it('order path is unavailable when restaurants is empty', () => {
    const { order } = buildPathInputs(makeContext(), makeToolOutput(), [])
    expect(order.available).toBe(false)
  })

  it('order path is unavailable when restaurants is null (failed tool)', () => {
    const tool = makeToolOutput({ restaurants: null })
    const { order } = buildPathInputs(makeContext(), tool, [])
    expect(order.available).toBe(false)
  })

  it('dineout path uses top venue when venues are present', () => {
    const venue = makeVenue('Barbeque Nation')
    const tool = makeToolOutput({ dineoutVenues: [venue] })
    const { dineOut } = buildPathInputs(makeContext(), tool, [])
    expect(dineOut.available).toBe(true)
    expect(dineOut.restaurantName).toBe('Barbeque Nation')
  })

  it('dineout path is unavailable when venues is empty', () => {
    const { dineOut } = buildPathInputs(makeContext(), makeToolOutput(), [])
    expect(dineOut.available).toBe(false)
  })
})
