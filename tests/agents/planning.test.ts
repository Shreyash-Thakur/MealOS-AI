/**
 * tests/agents/planning.test.ts
 * Unit tests for the Planning Agent (lib/agents/planning.ts, ISSUE-091/102/104/105)
 *
 * Mocks:
 *   - @/lib/claude runPlanningAgent — the LLM transport boundary (sonnet).
 *     Prompt assembly, truncation, degraded-mode injection, and all
 *     deterministic output guards are tested against real code and the live
 *     prompt files.
 *
 * Test focus (docs/AGENTS.md §3 + playbook M6 DoD):
 *   1. User message assembly from planning.md template; no leaked {{vars}}
 *   2. Context-window truncation: top-10 restaurants by rating, 50 pantry items
 *   3. Degraded mode: fallback.md §1 block injected into the system message
 *   4. Winner guard: primaryPath must be the highest AVAILABLE path that has
 *      data (N1: the scorer is the contract; the narrator never overrides it)
 *   5. FM2: order wins on score but Swiggy empty → cook is the accepted winner
 *   6. FM1: timeout → enriched degraded fallback (top restaurant title / cook)
 *   7. schema_failed passthrough → PLANNING_FALLBACK
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env['DATABASE_URL'] ??= 'postgres://test:test@localhost:5432/test'
process.env['ANTHROPIC_API_KEY'] ??= 'test-key'
process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] ??= 'pk_test'
process.env['CLERK_SECRET_KEY'] ??= 'sk_test'
process.env['YOUTUBE_API_KEY'] ??= 'yt_test'
process.env['SWIGGY_MCP_MODE'] ??= 'mock'

vi.mock('@/lib/claude', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/claude')>()
  return { ...actual, runPlanningAgent: vi.fn() }
})

const { runPlanningAgent } = await import('@/lib/agents/planning')
const { runPlanningAgent: claudeRunPlanningAgent, PLANNING_FALLBACK } =
  await import('@/lib/claude')

import type { PlanningAgentInput } from '@/types/agents'
import type { PlanningAgentOutputValidated } from '@/lib/schemas/planningOutput'
import type { Restaurant } from '@/types/swiggy'

const mockTransport = vi.mocked(claudeRunPlanningAgent)

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRestaurant(name: string, rating: number): Restaurant {
  return {
    restaurantId: `rest-${name}` as Restaurant['restaurantId'],
    name,
    rating,
    deliveryTimeMin: 30 as Restaurant['deliveryTimeMin'],
    deliveryFee: 20 as Restaurant['deliveryFee'],
    minOrderValue: 100 as Restaurant['minOrderValue'],
    cuisineTypes: ['North Indian'],
    topItems: [],
  }
}

function makeInput(overrides: Partial<PlanningAgentInput> = {}): PlanningAgentInput {
  return {
    situationContext: {
      situationType: 'sick',
      explicit: { sick: true, canCook: true, alone: true },
      inferred: { timeOfDay: 'dinner', isWeekend: false },
      fromMemory: { dietType: 'vegetarian', budget: 350 },
    } as PlanningAgentInput['situationContext'],
    userMemory: {
      diet: 'vegetarian',
      budget: 350,
      allergies: [],
      cookingSkill: 'intermediate',
      kitchenEquipment: ['gas stove', 'pressure cooker'],
      householdSize: 1,
      fitnessGoals: {},
      preferredCuisines: ['North Indian'],
      dislikedCuisines: [],
      frequentRestaurants: [],
      pantryStaples: ['rice', 'dal'],
    } as unknown as PlanningAgentInput['userMemory'],
    preCalculatedScores: { cook: 82, order: 61, dineout: 20 },
    pathAvailability: { cook: true, order: true, dineout: false },
    swiggyResults: {
      restaurants: [makeRestaurant('Haldiram\'s', 4.5)],
      instamartItems: [],
      dineoutVenues: [],
    },
    youtubeResult: null,
    pantryItems: [],
    isDegradedMode: false,
    ...overrides,
  }
}

const VALID_COOK_OUTPUT: PlanningAgentOutputValidated = {
  explanation: 'Cooking khichdi at home is gentle on your stomach and uses only pantry staples.',
  primaryPath: 'cook',
  confidence: 'high',
  recommendation: {
    title: 'Moong Dal Khichdi',
    description: 'A light one-pot meal that is easy to digest and ready in 25 minutes.',
    estimatedCost: 40,
    estimatedTime: 25,
    ingredients: [{ name: 'Moong Dal', qty: '1 cup', inPantry: true }],
    recipeSteps: [{ step: 1, instruction: 'Rinse dal and rice.', durationMin: 3 }],
  },
  whyNotAlternatives: [
    { path: 'order', reason: 'Delivery options are heavy for a recovering stomach.' },
    { path: 'dineout', reason: 'Going out while sick is not advisable.' },
  ],
} as PlanningAgentOutputValidated

const VALID_ORDER_OUTPUT: PlanningAgentOutputValidated = {
  explanation: 'Ordering from Haldiram\'s fits your budget with a 25-minute delivery window.',
  primaryPath: 'order',
  confidence: 'medium',
  recommendation: {
    title: 'Haldiram\'s Khichdi Combo',
    description: 'Light comfort food delivered fast.',
    estimatedCost: 220,
    estimatedTime: 30,
    restaurantName: 'Haldiram\'s',
    restaurantId: 'rest-1',
    menuItems: [{ name: 'Khichdi', price: 180 }],
    estimatedDeliveryMin: 25,
  },
  whyNotAlternatives: [
    { path: 'cook', reason: 'You said you cannot cook right now.' },
    { path: 'dineout', reason: 'Not viable while unwell.' },
  ],
} as PlanningAgentOutputValidated

type TransportResult = Awaited<ReturnType<typeof claudeRunPlanningAgent>>

function mockTransportResult(partial: Partial<TransportResult>): void {
  mockTransport.mockResolvedValue({
    output: VALID_COOK_OUTPUT,
    status: 'completed',
    latencyMs: 3200,
    inputTokens: 2400,
    outputTokens: 750,
    attempts: 1,
    ...partial,
  } as unknown as TransportResult)
}

function sentSystemMessage(): string {
  return mockTransport.mock.calls[0]?.[0] ?? ''
}

function sentUserMessage(): string {
  return mockTransport.mock.calls[0]?.[1] ?? ''
}

// ── Prompt assembly ───────────────────────────────────────────────────────────

describe('runPlanningAgent — prompt assembly', () => {
  it('injects context, memory, and scores JSON into the user message', async () => {
    mockTransportResult({})
    await runPlanningAgent(makeInput())

    const user = sentUserMessage()
    expect(user).toContain('"cook": 82')
    expect(user).toContain('"order": 61')
    expect(user).toContain('"situationType": "sick"')
    expect(user).toContain('Known User Preferences')
    expect(user).not.toContain('{{')
  })

  it('system message carries the scores-are-final constraint from planning.md', async () => {
    mockTransportResult({})
    await runPlanningAgent(makeInput())

    const system = sentSystemMessage()
    expect(system).toMatch(/do not recalculate/i)
    expect(system).toContain('reasoning core of MealOS')
  })

  it('does not inject the degraded-mode block in normal mode', async () => {
    mockTransportResult({})
    await runPlanningAgent(makeInput())

    expect(sentSystemMessage()).not.toContain('DEGRADED MODE ACTIVE')
  })

  it('injects the fallback.md cook-only block when isDegradedMode is true', async () => {
    mockTransportResult({})
    await runPlanningAgent(makeInput({
      isDegradedMode: true,
      swiggyResults: null,
      pathAvailability: { cook: true, order: false, dineout: false },
    }))

    const system = sentSystemMessage()
    expect(system).toContain('DEGRADED MODE ACTIVE: SWIGGY_UNAVAILABLE')
    // Injection order: system.md prefix, then degraded block, then agent section
    expect(system.indexOf('reasoning core of MealOS'))
      .toBeLessThan(system.indexOf('DEGRADED MODE ACTIVE'))
  })
})

// ── Context-window truncation (ISSUE-104 / AGENTS.md §3.3) ────────────────────

describe('runPlanningAgent — truncation', () => {
  it('truncates restaurants to the top 10 by rating before prompt assembly', async () => {
    mockTransportResult({})
    const restaurants = Array.from({ length: 15 }, (_, i) =>
      makeRestaurant(`resto-${i}`, 3.0 + i * 0.1)   // resto-14 has the best rating
    )
    await runPlanningAgent(makeInput({
      swiggyResults: { restaurants, instamartItems: [], dineoutVenues: [] },
    }))

    const user = sentUserMessage()
    expect(user).toContain('resto-14')      // highest rated stays
    expect(user).toContain('resto-5')       // 10th best (ratings 3.5..4.4 kept)
    expect(user).not.toContain('resto-4"')  // 11th best is cut
    expect(user).not.toContain('resto-0"')  // lowest is cut
  })

  it('truncates pantry items to 50', async () => {
    mockTransportResult({})
    const pantryItems = Array.from({ length: 60 }, (_, i) => ({
      id: `pi-${i}`,
      userId: 'user-1',
      itemName: `pantry-item-${i}`,
      quantity: '1',
      unit: 'pc',
      isStaple: false,
      addedAt: '2026-07-01T10:00:00Z',
      expiresAt: null,
      lastUsedAt: null,
    })) as unknown as PlanningAgentInput['pantryItems']

    await runPlanningAgent(makeInput({ pantryItems }))

    const user = sentUserMessage()
    expect(user).toContain('pantry-item-0')
    expect(user).toContain('pantry-item-49')
    expect(user).not.toContain('pantry-item-50')
  })

  it('renders null swiggyResults as the literal null', async () => {
    mockTransportResult({})
    await runPlanningAgent(makeInput({
      swiggyResults: null,
      isDegradedMode: true,
      pathAvailability: { cook: true, order: false, dineout: false },
    }))

    expect(sentUserMessage()).toMatch(/SWIGGY RESULTS:\s*\nnull/)
  })
})

// ── Winner guard (N1: scorer is the contract) ─────────────────────────────────

describe('runPlanningAgent — winner guard', () => {
  it('accepts the output when primaryPath is the highest available path with data', async () => {
    mockTransportResult({ output: VALID_COOK_OUTPUT })
    const result = await runPlanningAgent(makeInput())   // cook: 82 is highest

    expect(result.status).toBe('completed')
    expect(result.output).toEqual(VALID_COOK_OUTPUT)
  })

  it('rejects an output whose primaryPath contradicts the scores (falls back, schema_failed)', async () => {
    mockTransportResult({ output: VALID_ORDER_OUTPUT })  // order chosen...
    const result = await runPlanningAgent(makeInput())   // ...but cook: 82 > order: 61

    expect(result.status).toBe('schema_failed')
    expect(result.output).toEqual(PLANNING_FALLBACK)
    expect(result.error).toMatch(/winner/i)
  })

  it('rejects an output whose primaryPath is an unavailable path', async () => {
    mockTransportResult({
      output: { ...VALID_COOK_OUTPUT, primaryPath: 'dineout' } as PlanningAgentOutputValidated,
    })
    const result = await runPlanningAgent(makeInput())   // dineout unavailable

    expect(result.status).toBe('schema_failed')
    expect(result.output).toEqual(PLANNING_FALLBACK)
  })

  it('FM2: accepts cook when order scores highest but Swiggy returned no restaurants', async () => {
    mockTransportResult({ output: VALID_COOK_OUTPUT })
    const result = await runPlanningAgent(makeInput({
      preCalculatedScores: { cook: 55, order: 78, dineout: 20 },
      swiggyResults: { restaurants: [], instamartItems: [], dineoutVenues: [] },
    }))

    expect(result.status).toBe('completed')
    expect(result.output.primaryPath).toBe('cook')
  })
})

// ── Failure modes ─────────────────────────────────────────────────────────────

describe('runPlanningAgent — failure modes', () => {
  it('FM1 timeout: enriches the fallback with the top restaurant title (order viable)', async () => {
    mockTransportResult({
      output: PLANNING_FALLBACK,
      status: 'timeout',
      error: 'Agent call exceeded 8000ms timeout',
    })
    const result = await runPlanningAgent(makeInput())

    expect(result.status).toBe('timeout')
    expect(result.output.primaryPath).toBe('order')
    expect(result.output.confidence).toBe('low')
    expect(result.output.recommendation.title).toBe('Haldiram\'s')
  })

  it('FM1 timeout with no Swiggy data: falls back to cook / home cooking', async () => {
    mockTransportResult({
      output: PLANNING_FALLBACK,
      status: 'timeout',
      error: 'Agent call exceeded 8000ms timeout',
    })
    const result = await runPlanningAgent(makeInput({
      swiggyResults: null,
      isDegradedMode: true,
      pathAvailability: { cook: true, order: false, dineout: false },
    }))

    expect(result.status).toBe('timeout')
    expect(result.output.primaryPath).toBe('cook')
    expect(result.output.recommendation.title).toBe('Home cooking')
  })

  it('schema_failed passes the static fallback through unchanged', async () => {
    mockTransportResult({
      output: PLANNING_FALLBACK,
      status: 'schema_failed',
      error: 'invalid JSON',
    })
    const result = await runPlanningAgent(makeInput())

    expect(result.status).toBe('schema_failed')
    expect(result.output).toEqual(PLANNING_FALLBACK)
  })

  it('calls the transport exactly once per run (retries live inside lib/claude)', async () => {
    mockTransportResult({})
    await runPlanningAgent(makeInput())
    expect(mockTransport).toHaveBeenCalledTimes(1)
  })
})
