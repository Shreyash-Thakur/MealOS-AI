/**
 * Tests for agent-related schemas (lib/schemas/agents.ts)
 * Covers: Conversation Agent, Tool Agent, Memory Agent, Decision Engine.
 */

import { describe, it, expect } from 'vitest'
import {
  ExtractedContextSchema,
  InferredContextSchema,
  ExplicitContextSchema,
  SituationContextSchema,
  MemoryContextSchema,
  RestaurantSchema,
  InstamartResultSchema,
  DineoutVenueSchema,
  YouTubeRecipeResultSchema,
  ToolAgentOutputSchema,
  ExtractedMemoryFactSchema,
  MemoryAgentOutputSchema,
  PathScoreSchema,
  DecisionResultSchema,
} from '@/lib/schemas/agents'

// ── Conversation Agent ────────────────────────────────────────────────────────

describe('ExplicitContextSchema', () => {
  it('accepts empty object (all fields optional)', () => {
    expect(ExplicitContextSchema.parse({})).toEqual({})
  })

  it('accepts all valid explicit fields', () => {
    const ctx = {
      sick: true,
      budget: 500,
      alone: false,
      canCook: true,
      guests: 2,
      occasion: 'anniversary',
      timeConstraintMinutes: 30,
      craving: 'biryani',
      nutritionGoal: { protein: 150, calories: 2000 },
      location: 'Bandra West',
      timeframe: 'tonight',
      indoorOutdoor: 'indoor',
      dietaryNote: 'No onion garlic today',
    }
    const result = ExplicitContextSchema.parse(ctx)
    expect(result.sick).toBe(true)
    expect(result.budget).toBe(500)
  })

  it('rejects unknown fields (strict mode — agent must not invent fields)', () => {
    expect(() => ExplicitContextSchema.parse({ inventedField: 'value' })).toThrow()
  })

  it('rejects budget of 0 (must be >= 1)', () => {
    expect(() => ExplicitContextSchema.parse({ budget: 0 })).toThrow()
  })

  it('rejects float budget', () => {
    expect(() => ExplicitContextSchema.parse({ budget: 199.99 })).toThrow()
  })
})

describe('InferredContextSchema', () => {
  it('accepts only the two allowed inferred fields', () => {
    const result = InferredContextSchema.parse({ timeOfDay: 'dinner', isWeekend: false })
    expect(result.timeOfDay).toBe('dinner')
    expect(result.isWeekend).toBe(false)
  })

  it('rejects any extra inferred fields (strict enforcement)', () => {
    expect(() => InferredContextSchema.parse({ timeOfDay: 'dinner', weather: 'rainy' })).toThrow()
  })

  it('accepts partial (only one field)', () => {
    expect(InferredContextSchema.parse({ timeOfDay: 'latenight' }).timeOfDay).toBe('latenight')
  })
})

describe('ExtractedContextSchema', () => {
  const validExtracted = {
    situationType: 'sick',
    explicit: { sick: true, alone: true },
    inferred: { timeOfDay: 'dinner' },
    confidence: 85,
    missingRequired: ['canCook'],
    missingSoft: ['budget'],
    ambiguities: ['unclear if fever or cold'],
    nonFoodInput: false,
  }

  it('parses a valid extracted context', () => {
    const result = ExtractedContextSchema.parse(validExtracted)
    expect(result.situationType).toBe('sick')
    expect(result.confidence).toBe(85)
    expect(result.nonFoodInput).toBe(false)
  })

  it('rejects float confidence (must be integer 0–100)', () => {
    expect(() => ExtractedContextSchema.parse({ ...validExtracted, confidence: 0.85 })).toThrow()
  })

  it('rejects confidence above 100', () => {
    expect(() => ExtractedContextSchema.parse({ ...validExtracted, confidence: 101 })).toThrow()
  })

  it('rejects unknown top-level fields', () => {
    expect(() => ExtractedContextSchema.parse({ ...validExtracted, extraField: 'bad' })).toThrow()
  })
})

describe('SituationContextSchema', () => {
  it('accepts valid situation context with fromMemory', () => {
    const ctx = {
      situationType: 'sick',
      explicit: { sick: true },
      inferred: { timeOfDay: 'dinner' },
      fromMemory: {
        dietType: 'vegetarian',
        allergies: ['shellfish'],
        budget: 200,
        cookingSkill: 'beginner',
      },
    }
    const result = SituationContextSchema.parse(ctx)
    expect(result.fromMemory.dietType).toBe('vegetarian')
  })

  it('accepts empty fromMemory (memory not available)', () => {
    const ctx = {
      situationType: 'general',
      explicit: {},
      inferred: {},
      fromMemory: {},
    }
    expect(SituationContextSchema.parse(ctx).fromMemory).toEqual({})
  })
})

// ── Tool Agent ────────────────────────────────────────────────────────────────

describe('RestaurantSchema', () => {
  const validRestaurant = {
    restaurantId: 'swg_rest_4821',
    name: "Haldiram's",
    rating: 4.3,
    deliveryTimeMin: 25,
    deliveryFee: 40,
    minOrderValue: 149,
    cuisineTypes: ['North Indian', 'Sweets'],
    topItems: [
      { name: 'Dal Makhani', price: 180, isVeg: true },
      { name: 'Paneer Tikka', price: 220, isVeg: true },
    ],
  }

  it('parses a valid restaurant', () => {
    const result = RestaurantSchema.parse(validRestaurant)
    expect(result.name).toBe("Haldiram's")
    expect(result.rating).toBe(4.3)
  })

  it('accepts optional nutrition fields on topItems', () => {
    const withNutrition = {
      ...validRestaurant,
      topItems: [
        { name: 'Dal Makhani', price: 180, isVeg: true, calories: 450, proteinG: 18 },
      ],
    }
    const result = RestaurantSchema.parse(withNutrition)
    expect(result.topItems[0]?.calories).toBe(450)
  })

  it('rejects extra fields on topItems (strict)', () => {
    expect(() => RestaurantSchema.parse({
      ...validRestaurant,
      topItems: [{ name: 'Test', price: 100, isVeg: true, description: 'forbidden field' }],
    })).toThrow()
  })
})

describe('InstamartResultSchema', () => {
  it('parses a found item', () => {
    const result = InstamartResultSchema.parse({
      item: 'ginger garlic paste',
      found: true,
      price: 45,
      unit: '200g',
      brand: 'Patanjali',
      deliveryTimeMin: 15,
      instamartItemId: 'im_item_123',
    })
    expect(result.found).toBe(true)
    expect(result.price).toBe(45)
  })

  it('parses an unfound item', () => {
    const result = InstamartResultSchema.parse({ item: 'saffron', found: false })
    expect(result.found).toBe(false)
    expect(result.price).toBeUndefined()
  })

  it('rejects found item without price', () => {
    expect(() => InstamartResultSchema.parse({
      item: 'tomato',
      found: true,
      // missing price
    })).toThrow(/found items must carry a price/)
  })
})

describe('DineoutVenueSchema', () => {
  it('parses a valid dineout venue', () => {
    const venue = {
      venueId: 'dinout_venue_001',
      name: 'Bayroute',
      cuisineTypes: ['Mediterranean', 'Lebanese'],
      ambience: ['romantic', 'rooftop'],
      pricePerPerson: 1200,
      rating: 4.6,
      availableSlots: ['7:30 PM', '9:00 PM'],
      isVegFriendly: true,
      distanceKm: 2.4,
      bookingUrl: 'https://swiggy.com/dineout/bayroute',
    }
    const result = DineoutVenueSchema.parse(venue)
    expect(result.venueId).toBe('dinout_venue_001')
    expect(result.ambience).toContain('romantic')
  })

  it('rejects invalid ambience value', () => {
    expect(() => DineoutVenueSchema.parse({
      venueId: 'v1', name: 'Test', cuisineTypes: [], ambience: ['pet-friendly'],
      pricePerPerson: 500, rating: 4.0, availableSlots: [], isVegFriendly: true,
    })).toThrow()
  })

  it('rejects zero-padded slot labels', () => {
    expect(() => DineoutVenueSchema.parse({
      venueId: 'v1', name: 'Test', cuisineTypes: [], ambience: [],
      pricePerPerson: 500, rating: 4.0, availableSlots: ['07:30 PM'],
      isVegFriendly: true,
    })).toThrow()
  })
})

describe('YouTubeRecipeResultSchema', () => {
  it('parses valid YouTube result', () => {
    const ytResult = {
      videoId: 'dQw4w9WgXcQ',
      title: 'Dal Tadka Recipe by Hebbar\'s Kitchen',
      channelName: "Hebbar's Kitchen",
      durationSeconds: 480,
      thumbnailUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
      viewCount: 2_500_000,
      publishedAt: '2024-03-15T10:00:00Z',
      keyTimestamps: [
        { label: 'Start tempering', seconds: 120 },
        { label: 'Add dal', seconds: 240 },
      ],
    }
    const result = YouTubeRecipeResultSchema.parse(ytResult)
    expect(result.videoId).toBe('dQw4w9WgXcQ')
    expect(result.keyTimestamps).toHaveLength(2)
  })

  it('rejects video ID of wrong length', () => {
    expect(() => YouTubeRecipeResultSchema.parse({
      videoId: 'short',
      title: 'Test',
      channelName: 'Test',
      durationSeconds: 300,
      thumbnailUrl: 'https://example.com/img.jpg',
      viewCount: 100,
      publishedAt: '2024-03-15T10:00:00Z',
      keyTimestamps: [],
    })).toThrow()
  })
})

describe('ToolAgentOutputSchema', () => {
  const validOutput = {
    restaurants: null,
    instamartItems: null,
    dineoutVenues: null,
    youtube: null,
    errors: [],
    _meta: {
      toolsAttempted: ['youtube_search_recipe'],
      toolsSucceeded: [],
      totalLatencyMs: 1500,
    },
  }

  it('parses a minimal output (all nulls = all tools failed)', () => {
    const result = ToolAgentOutputSchema.parse(validOutput)
    expect(result.restaurants).toBeNull()
    expect(result._meta.totalLatencyMs).toBe(1500)
  })

  it('null means tool failed, [] means not called', () => {
    const withEmpty = { ...validOutput, restaurants: [] }
    const result = ToolAgentOutputSchema.parse(withEmpty)
    expect(result.restaurants).toEqual([])
  })

  it('rejects extra top-level fields (strict mode)', () => {
    expect(() => ToolAgentOutputSchema.parse({
      ...validOutput,
      inventedField: 'bad',
    })).toThrow()
  })

  it('parses SWIGGY_UNAVAILABLE sentinel', () => {
    const result = ToolAgentOutputSchema.parse({
      ...validOutput,
      swiggyError: 'SWIGGY_UNAVAILABLE',
    })
    expect(result.swiggyError).toBe('SWIGGY_UNAVAILABLE')
  })

  it('rejects invalid error codes', () => {
    expect(() => ToolAgentOutputSchema.parse({
      ...validOutput,
      errors: [{
        tool: 'swiggy_search_restaurants',
        errorCode: 'INVENTED_ERROR',
        message: 'Something went wrong.',
      }],
    })).toThrow()
  })
})

// ── Memory Agent ──────────────────────────────────────────────────────────────

describe('ExtractedMemoryFactSchema', () => {
  it('accepts a valid memory fact', () => {
    const fact = {
      factKey: 'dietary.restrictions',
      factValue: ['vegetarian'],
      confidence: 0.8,
      source: 'user_stated',
      expiresAfterDays: null,
    }
    const result = ExtractedMemoryFactSchema.parse(fact)
    expect(result.factKey).toBe('dietary.restrictions')
    expect(result.confidence).toBe(0.8)
  })

  it('rejects invented fact keys', () => {
    expect(() => ExtractedMemoryFactSchema.parse({
      factKey: 'user.favorite_color',
      factValue: 'blue',
      confidence: 0.8,
      source: 'user_stated',
      expiresAfterDays: null,
    })).toThrow()
  })

  it('rejects intermediate confidence values (not quantized)', () => {
    expect(() => ExtractedMemoryFactSchema.parse({
      factKey: 'dietary.restrictions',
      factValue: ['vegetarian'],
      confidence: 0.7,  // not 0.4|0.6|0.8|1.0
      source: 'user_stated',
      expiresAfterDays: null,
    })).toThrow()
  })

  it('accepts all four quantized confidence values', () => {
    for (const confidence of [0.4, 0.6, 0.8, 1.0] as const) {
      expect(ExtractedMemoryFactSchema.parse({
        factKey: 'cooking.can_cook',
        factValue: true,
        confidence,
        source: 'clarification_answer',
        expiresAfterDays: null,
      }).confidence).toBe(confidence)
    }
  })

  it('rejects "onboarding" source (Memory Agent cannot use this)', () => {
    // Memory Agent may only use: user_stated, clarification_answer, behavior_inferred, action_derived
    expect(() => ExtractedMemoryFactSchema.parse({
      factKey: 'dietary.restrictions',
      factValue: ['vegetarian'],
      confidence: 0.8,
      source: 'onboarding',  // forbidden for Memory Agent output
      expiresAfterDays: null,
    })).toThrow()
  })

  it('rejects "user_edited" source (only for PATCH /memory, not agent output)', () => {
    expect(() => ExtractedMemoryFactSchema.parse({
      factKey: 'dietary.restrictions',
      factValue: ['vegetarian'],
      confidence: 0.8,
      source: 'user_edited',
      expiresAfterDays: null,
    })).toThrow()
  })
})

describe('MemoryAgentOutputSchema', () => {
  it('accepts empty array (normal — nothing worth storing)', () => {
    expect(MemoryAgentOutputSchema.parse([])).toEqual([])
  })

  it('accepts array of valid facts', () => {
    const facts = [
      {
        factKey: 'dietary.restrictions',
        factValue: ['vegetarian'],
        confidence: 0.8,
        source: 'user_stated',
        expiresAfterDays: null,
      },
      {
        factKey: 'fitness.protein_target',
        factValue: 150,
        confidence: 1.0,
        source: 'clarification_answer',
        expiresAfterDays: 30,
      },
    ]
    const result = MemoryAgentOutputSchema.parse(facts)
    expect(result).toHaveLength(2)
  })

  it('rejects more than 10 facts', () => {
    const tooMany = Array.from({ length: 11 }, () => ({
      factKey: 'cooking.can_cook',
      factValue: true,
      confidence: 0.6,
      source: 'behavior_inferred',
      expiresAfterDays: 90,
    }))
    expect(() => MemoryAgentOutputSchema.parse(tooMany)).toThrow()
  })
})

// ── Decision Engine ───────────────────────────────────────────────────────────

describe('PathScoreSchema', () => {
  const validScore = {
    path: 'COOK',
    available: true,
    goalMatchScore: 80,
    budgetFitScore: 90,
    timeFitScore: 70,
    prefMatchScore: 85,
    finalScore: 82,
    goalMatchNotes: ['protein target met'],
    budgetNotes: ['within budget'],
    timeNotes: ['30 min fits constraint'],
    prefNotes: ['preferred cuisine'],
    hardBlocks: [],
  }

  it('parses a valid path score', () => {
    const result = PathScoreSchema.parse(validScore)
    expect(result.finalScore).toBe(82)
    expect(result.hardBlocks).toHaveLength(0)
  })

  it('rejects scores outside 0–100', () => {
    expect(() => PathScoreSchema.parse({ ...validScore, finalScore: 101 })).toThrow()
    expect(() => PathScoreSchema.parse({ ...validScore, goalMatchScore: -1 })).toThrow()
  })
})

describe('DecisionResultSchema', () => {
  const makeScore = (path: string, available = true) => ({
    path,
    available,
    goalMatchScore: 80,
    budgetFitScore: 75,
    timeFitScore: 85,
    prefMatchScore: 70,
    finalScore: 78,
    goalMatchNotes: [],
    budgetNotes: [],
    timeNotes: [],
    prefNotes: [],
    hardBlocks: [],
  })

  const validDecision = {
    cookScore: makeScore('COOK'),
    orderScore: makeScore('ORDER'),
    dineOutScore: makeScore('DINE_OUT'),
    winner: 'COOK',
    isSplitRecommendation: false,
    splitAlternative: null,
    confidence: 85,
    simulator: {
      primaryPath: 'COOK',
      alternativePath: 'ORDER',
      deltaCostRupees: 200,
      deltaTimeMinutes: -5,
      deltaProteinG: null,
      showCostDelta: true,
      showTimeDelta: false,
      showProteinDelta: false,
    },
    weightsUsed: {
      goalMatch: 0.35,
      budgetFit: 0.25,
      timeFit: 0.25,
      preferenceMatch: 0.15,
    },
    computedAt: '2026-07-07T12:00:00Z',
  }

  it('parses a valid decision result', () => {
    const result = DecisionResultSchema.parse(validDecision)
    expect(result.winner).toBe('COOK')
    expect(result.confidence).toBe(85)
  })

  it('accepts NO_WINNER when all paths score below 30', () => {
    const result = DecisionResultSchema.parse({ ...validDecision, winner: 'NO_WINNER' })
    expect(result.winner).toBe('NO_WINNER')
  })

  it('enforces weights sum to exactly 1.0', () => {
    const badWeights = { ...validDecision, weightsUsed: { goalMatch: 0.3, budgetFit: 0.3, timeFit: 0.3, preferenceMatch: 0.3 } }
    expect(() => DecisionResultSchema.parse(badWeights)).toThrow(/weights must sum to exactly 1.0/)
  })

  it('accepts weights that sum to 1.0 within floating point tolerance', () => {
    // 0.25 + 0.25 + 0.25 + 0.25 = 1.0 exactly
    const evenWeights = { ...validDecision, weightsUsed: { goalMatch: 0.25, budgetFit: 0.25, timeFit: 0.25, preferenceMatch: 0.25 } }
    expect(() => DecisionResultSchema.parse(evenWeights)).not.toThrow()
  })

  it('rejects extra fields on simulator (strict mode)', () => {
    expect(() => DecisionResultSchema.parse({
      ...validDecision,
      simulator: { ...validDecision.simulator, inventedField: 'bad' },
    })).toThrow()
  })
})
