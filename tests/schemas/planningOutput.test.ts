/**
 * Tests for the Planning Agent output schema (lib/schemas/planningOutput.ts)
 *
 * This is the critical LLM output gate. Tests cover:
 * - Valid outputs for each primary path
 * - Cross-path field pollution (the superRefine)
 * - whyNotAlternatives must contain exactly 2 entries, not the winner
 * - Field caps and types
 * - Edge cases: confidence levels, slot labels, youtube video IDs
 */

import { describe, it, expect } from 'vitest'
import {
  PlanningAgentOutputSchema,
  PlanningRecommendationSchema,
} from '@/lib/schemas/planningOutput'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseRecommendation = {
  title: 'Dal Tadka with Rice',
  description: 'A wholesome home-cooked meal ready in 30 minutes.',
  estimatedCost: 80,
  estimatedTime: 30,
}

/** n valid recipe steps — cook recommendations must carry 6–8 (ISSUE-141). */
function makeSteps(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    step: i + 1,
    instruction: `Step ${i + 1}: do the next thing.`,
    durationMin: 3,
  }))
}

const validCookOutput = {
  explanation: 'Given your budget of ₹150 and a stocked pantry, cooking dal tadka at home saves ₹200 vs ordering.',
  primaryPath: 'cook' as const,
  confidence: 'high' as const,
  recommendation: {
    ...baseRecommendation,
    ingredients: [
      { name: 'Toor Dal', qty: '1 cup', inPantry: true },
      { name: 'Onion', qty: '1 medium', inPantry: true },
    ],
    recipeSteps: [
      { step: 1, instruction: 'Rinse dal until the water runs clear.', durationMin: 2 },
      { step: 2, instruction: 'Pressure cook dal with salt and turmeric.', durationMin: 15 },
      { step: 3, instruction: 'Heat ghee and add mustard seeds.', durationMin: 2 },
      { step: 4, instruction: 'Add onions and sauté until golden.', durationMin: 5 },
      { step: 5, instruction: 'Pour the tempering over the cooked dal.', durationMin: 1 },
      { step: 6, instruction: 'Simmer together and serve with rice.', durationMin: 5 },
    ],
  },
  whyNotAlternatives: [
    { path: 'order' as const, reason: 'Delivery would cost ₹250, exceeding your budget.' },
    { path: 'dineout' as const, reason: 'No nearby restaurants serve simple dal at this price point.' },
  ],
}

const validOrderOutput = {
  explanation: 'Swiggy delivery from Haldiram\'s fits your ₹300 budget with 25-minute ETA.',
  primaryPath: 'order' as const,
  confidence: 'medium' as const,
  recommendation: {
    title: 'Haldiram\'s Dal Makhani + Roti',
    description: 'Classic North Indian comfort food delivered.',
    estimatedCost: 280,
    estimatedTime: 30,
    restaurantName: "Haldiram's",
    restaurantId: 'swg_rest_4821',
    menuItems: [
      { name: 'Dal Makhani', price: 180 },
      { name: 'Roti (4 pcs)', price: 60 },
    ],
    estimatedDeliveryMin: 25,
  },
  whyNotAlternatives: [
    { path: 'cook' as const, reason: 'Missing 4 ingredients and no time to shop.' },
    { path: 'dineout' as const, reason: 'Nearest good restaurant is 3km away — too far tonight.' },
  ],
}

const validDineoutOutput = {
  explanation: 'A romantic dinner at Bayroute fits your ₹1200 budget and is available tonight.',
  primaryPath: 'dineout' as const,
  confidence: 'high' as const,
  recommendation: {
    title: 'Bayroute — Mediterranean dinner for two',
    description: 'Upscale Mediterranean restaurant with stunning views.',
    estimatedCost: 2400,
    estimatedTime: 120,
    venueName: 'Bayroute',
    venueId: 'dinout_venue_001',
    availableSlots: ['7:30 PM', '9:00 PM'],
    pricePerPerson: 1200,
  },
  whyNotAlternatives: [
    { path: 'cook' as const, reason: 'Cannot cook an anniversary-worthy meal in 30 minutes.' },
    { path: 'order' as const, reason: 'Delivery does not match the occasion.' },
  ],
}

// ── Valid fixture tests ───────────────────────────────────────────────────────

describe('PlanningAgentOutputSchema — valid fixtures', () => {
  it('parses a valid COOK path output', () => {
    const result = PlanningAgentOutputSchema.parse(validCookOutput)
    expect(result.primaryPath).toBe('cook')
    expect(result.confidence).toBe('high')
    expect(result.whyNotAlternatives).toHaveLength(2)
  })

  it('parses a valid ORDER path output', () => {
    const result = PlanningAgentOutputSchema.parse(validOrderOutput)
    expect(result.primaryPath).toBe('order')
    expect(result.recommendation.restaurantName).toBe("Haldiram's")
  })

  it('parses a valid DINEOUT path output', () => {
    const result = PlanningAgentOutputSchema.parse(validDineoutOutput)
    expect(result.primaryPath).toBe('dineout')
    expect(result.recommendation.availableSlots).toEqual(['7:30 PM', '9:00 PM'])
  })

  it('accepts optional nutrition fields when present', () => {
    const withNutrition = {
      ...validCookOutput,
      recommendation: {
        ...validCookOutput.recommendation,
        proteinG: 28,
        calories: 450,
      },
    }
    const result = PlanningAgentOutputSchema.parse(withNutrition)
    expect(result.recommendation.proteinG).toBe(28)
    expect(result.recommendation.calories).toBe(450)
  })

  it('accepts a youtubeVideoId in cook path', () => {
    const withYoutube = {
      ...validCookOutput,
      recommendation: {
        ...validCookOutput.recommendation,
        youtubeVideoId: 'dQw4w9WgXcQ',  // 11-char YouTube ID
      },
    }
    const result = PlanningAgentOutputSchema.parse(withYoutube)
    expect(result.recommendation.youtubeVideoId).toBe('dQw4w9WgXcQ')
  })
})

// ── Cross-path pollution tests (superRefine) ──────────────────────────────────

describe('PlanningAgentOutputSchema — cross-path field pollution', () => {
  it('rejects cook path carrying order fields', () => {
    const polluted = {
      ...validCookOutput,
      recommendation: {
        ...validCookOutput.recommendation,
        restaurantName: "Haldiram's",  // order field in cook path
      },
    }
    expect(() => PlanningAgentOutputSchema.parse(polluted)).toThrow(
      /cook path must not carry order\/dineout fields/
    )
  })

  it('rejects cook path carrying dineout fields', () => {
    const polluted = {
      ...validCookOutput,
      recommendation: {
        ...validCookOutput.recommendation,
        venueName: 'Bayroute',  // dineout field in cook path
      },
    }
    expect(() => PlanningAgentOutputSchema.parse(polluted)).toThrow(
      /cook path must not carry order\/dineout fields/
    )
  })

  it('rejects order path carrying cook fields', () => {
    const polluted = {
      ...validOrderOutput,
      recommendation: {
        ...validOrderOutput.recommendation,
        recipeSteps: makeSteps(6),
      },
    }
    expect(() => PlanningAgentOutputSchema.parse(polluted)).toThrow(
      /order path must not carry cook\/dineout fields/
    )
  })

  it('rejects order path carrying dineout fields', () => {
    const polluted = {
      ...validOrderOutput,
      recommendation: {
        ...validOrderOutput.recommendation,
        venueName: 'Bayroute',
      },
    }
    expect(() => PlanningAgentOutputSchema.parse(polluted)).toThrow(
      /order path must not carry cook\/dineout fields/
    )
  })

  it('rejects dineout path carrying cook fields', () => {
    const polluted = {
      ...validDineoutOutput,
      recommendation: {
        ...validDineoutOutput.recommendation,
        ingredients: [{ name: 'Oil', qty: '2 tbsp', inPantry: true }],
      },
    }
    expect(() => PlanningAgentOutputSchema.parse(polluted)).toThrow(
      /dineout path must not carry cook\/order fields/
    )
  })
})

// ── whyNotAlternatives invariants ─────────────────────────────────────────────

describe('PlanningAgentOutputSchema — whyNotAlternatives', () => {
  it('rejects whyNotAlternatives with only 1 entry', () => {
    const oneEntry = {
      ...validCookOutput,
      whyNotAlternatives: [
        { path: 'order' as const, reason: 'Too expensive.' },
      ],
    }
    expect(() => PlanningAgentOutputSchema.parse(oneEntry)).toThrow()
  })

  it('rejects whyNotAlternatives with 3 entries', () => {
    const threeEntries = {
      ...validCookOutput,
      whyNotAlternatives: [
        { path: 'order' as const, reason: 'Too expensive.' },
        { path: 'dineout' as const, reason: 'Too far.' },
        { path: 'order' as const, reason: 'Duplicate.' },
      ],
    }
    expect(() => PlanningAgentOutputSchema.parse(threeEntries)).toThrow()
  })

  it('rejects whyNotAlternatives that include the winner path', () => {
    const winnerIncluded = {
      ...validCookOutput,
      whyNotAlternatives: [
        { path: 'cook' as const, reason: 'This is the winner — invalid.' },
        { path: 'order' as const, reason: 'Too expensive.' },
      ],
    }
    expect(() => PlanningAgentOutputSchema.parse(winnerIncluded)).toThrow(
      /whyNotAlternatives must not include the winner/
    )
  })

  it('rejects empty reason string', () => {
    const emptyReason = {
      ...validCookOutput,
      whyNotAlternatives: [
        { path: 'order' as const, reason: '' },  // min 5 chars
        { path: 'dineout' as const, reason: 'Too far.' },
      ],
    }
    expect(() => PlanningAgentOutputSchema.parse(emptyReason)).toThrow()
  })
})

// ── Field constraint tests ────────────────────────────────────────────────────

describe('PlanningAgentOutputSchema — field constraints', () => {
  it('rejects explanation below 10 chars', () => {
    const short = { ...validCookOutput, explanation: 'Short.' }
    expect(() => PlanningAgentOutputSchema.parse(short)).toThrow()
  })

  it('rejects explanation above 600 chars', () => {
    const long = { ...validCookOutput, explanation: 'x'.repeat(601) }
    expect(() => PlanningAgentOutputSchema.parse(long)).toThrow()
  })

  it('rejects invalid youtubeVideoId format', () => {
    const bad = {
      ...validCookOutput,
      recommendation: {
        ...validCookOutput.recommendation,
        youtubeVideoId: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',  // URL, not ID
      },
    }
    expect(() => PlanningAgentOutputSchema.parse(bad)).toThrow()
  })

  it('rejects youtubeVideoId of wrong length', () => {
    const bad = {
      ...validCookOutput,
      recommendation: {
        ...validCookOutput.recommendation,
        youtubeVideoId: 'short',  // must be exactly 11 chars
      },
    }
    expect(() => PlanningAgentOutputSchema.parse(bad)).toThrow()
  })

  it('rejects invalid slot label (zero-padded hour)', () => {
    const bad = {
      ...validDineoutOutput,
      recommendation: {
        ...validDineoutOutput.recommendation,
        availableSlots: ['07:30 PM'],  // zero-padded — invalid
      },
    }
    expect(() => PlanningAgentOutputSchema.parse(bad)).toThrow()
  })

  it('rejects estimated cost above ₹1,00,000', () => {
    const expensive = {
      ...validCookOutput,
      recommendation: {
        ...validCookOutput.recommendation,
        estimatedCost: 100_001,
      },
    }
    expect(() => PlanningAgentOutputSchema.parse(expensive)).toThrow()
  })

  it('rejects float estimated cost', () => {
    const floatCost = {
      ...validCookOutput,
      recommendation: {
        ...validCookOutput.recommendation,
        estimatedCost: 79.99,
      },
    }
    expect(() => PlanningAgentOutputSchema.parse(floatCost)).toThrow()
  })

  it('rejects unknown top-level fields (strict mode)', () => {
    const withUnknown = {
      ...validCookOutput,
      inventedField: 'should fail',
    }
    expect(() => PlanningAgentOutputSchema.parse(withUnknown)).toThrow()
  })

  it('rejects unknown recommendation fields (strict mode)', () => {
    const withUnknown = {
      ...validCookOutput,
      recommendation: {
        ...validCookOutput.recommendation,
        modelConfidence: 0.92,  // agent inventing fields
      },
    }
    expect(() => PlanningAgentOutputSchema.parse(withUnknown)).toThrow()
  })
})

// ── Confidence level tests ────────────────────────────────────────────────────

describe('PlanningAgentOutputSchema — confidence levels', () => {
  it('accepts all three confidence levels', () => {
    for (const confidence of ['high', 'medium', 'low'] as const) {
      const output = { ...validCookOutput, confidence }
      expect(PlanningAgentOutputSchema.parse(output).confidence).toBe(confidence)
    }
  })

  it('rejects numeric confidence (must be level string, not ConfidencePercent)', () => {
    const numericConf = { ...validCookOutput, confidence: 92 }
    expect(() => PlanningAgentOutputSchema.parse(numericConf)).toThrow()
  })
})

// ── Recipe step sub-schema tests ──────────────────────────────────────────────

describe('PlanningRecommendationSchema — recipe steps', () => {
  it('rejects more than 8 recipe steps (ISSUE-141)', () => {
    const tooManySteps = { ...baseRecommendation, recipeSteps: makeSteps(9) }
    expect(() => PlanningRecommendationSchema.parse(tooManySteps)).toThrow()
  })

  it('rejects fewer than 6 recipe steps (ISSUE-141)', () => {
    const tooFewSteps = { ...baseRecommendation, recipeSteps: makeSteps(5) }
    expect(() => PlanningRecommendationSchema.parse(tooFewSteps)).toThrow()
  })

  it.each([6, 7, 8])('accepts %d recipe steps', (n) => {
    const steps = { ...baseRecommendation, recipeSteps: makeSteps(n) }
    expect(() => PlanningRecommendationSchema.parse(steps)).not.toThrow()
  })

  it('accepts youtube timestamp in recipeSteps', () => {
    const stepWithTimestamp = {
      ...baseRecommendation,
      recipeSteps: [
        { ...makeSteps(6)[0]!, youtubeTimestamp: '1:30' },
        ...makeSteps(6).slice(1),
      ],
    }
    const result = PlanningRecommendationSchema.parse(stepWithTimestamp)
    expect(result.recipeSteps?.[0]?.youtubeTimestamp).toBe('1:30')
  })

  it('accepts null youtubeTimestamp (prompt example emits null for steps without clips)', () => {
    const stepWithNull = {
      ...baseRecommendation,
      recipeSteps: [
        { ...makeSteps(6)[0]!, youtubeTimestamp: null },
        ...makeSteps(6).slice(1),
      ],
    }
    const result = PlanningRecommendationSchema.parse(stepWithNull)
    expect(result.recipeSteps?.[0]?.youtubeTimestamp).toBeUndefined()
  })

  it('rejects a cook plan with no recipeSteps at all (ISSUE-141)', () => {
    const noSteps = {
      ...validCookOutput,
      recommendation: {
        ...validCookOutput.recommendation,
        recipeSteps: undefined,
      },
    }
    expect(() => PlanningAgentOutputSchema.parse(noSteps)).toThrow(
      /cook path requires 6–8 recipe steps/
    )
  })
})

// ── degradedMode (fallback.md §1 schema addition) ────────────────────────────

describe('PlanningAgentOutputSchema — degradedMode', () => {
  it('accepts degradedMode: "swiggy_unavailable" (cook-only degraded output)', () => {
    const result = PlanningAgentOutputSchema.safeParse({
      ...validCookOutput,
      degradedMode: 'swiggy_unavailable',
    })
    expect(result.success).toBe(true)
  })

  it('accepts degradedMode: null and absent degradedMode', () => {
    expect(PlanningAgentOutputSchema.safeParse({
      ...validCookOutput,
      degradedMode: null,
    }).success).toBe(true)
    expect(PlanningAgentOutputSchema.safeParse(validCookOutput).success).toBe(true)
  })

  it('rejects any other degradedMode value', () => {
    const result = PlanningAgentOutputSchema.safeParse({
      ...validCookOutput,
      degradedMode: 'youtube_down',
    })
    expect(result.success).toBe(false)
  })
})
