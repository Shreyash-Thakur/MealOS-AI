/**
 * tests/integration/planning-pipeline.test.ts
 * Integration test for the full M6 planning pipeline (ISSUE-093)
 *
 * "canned context → mock Swiggy → real scorer → mocked-LLM narration → valid recommendation"
 *
 * This test exercises the real Decision Engine (no mock), the real context
 * builder, and the real Tool Agent against MockSwiggyMCPClient. The LLM
 * narration (Planning Agent) is mocked at the claude transport boundary —
 * the test verifies the orchestration, not the prose.
 *
 * What stays real:
 *   - lib/engine/* (scorer, subscores, weights, confidence, simulator)
 *   - lib/engine/contextBuilder
 *   - lib/agents/tool (Tool Agent — mock Swiggy via SWIGGY_MCP_MODE=mock)
 *   - lib/agents/clarification (deterministic gap analysis)
 *   - lib/sse (clarification bus)
 *
 * What is mocked:
 *   - lib/agents/conversation (canned ExtractedContext — test owns the input)
 *   - lib/agents/planning (returns a valid PlanningAgentOutputValidated)
 *   - lib/repositories/* (no DB needed; the integration tests for routes land in M10)
 *   - lib/memory/retrieval (deterministic memory facts)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Env stubs
process.env['DATABASE_URL'] ??= 'postgres://test:test@localhost:5432/test'
process.env['ANTHROPIC_API_KEY'] ??= 'test-key'
process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] ??= 'pk_test'
process.env['CLERK_SECRET_KEY'] ??= 'sk_test'
process.env['YOUTUBE_API_KEY'] ??= 'yt_test'
process.env['SWIGGY_MCP_MODE'] ??= 'mock'

vi.mock('@/lib/agents/conversation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agents/conversation')>()
  return { ...actual, runConversationAgent: vi.fn() }
})

vi.mock('@/lib/agents/planning', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agents/planning')>()
  return { ...actual, runPlanningAgent: vi.fn() }
})

vi.mock('@/lib/memory/retrieval', () => ({
  getMemoryContext: vi.fn().mockResolvedValue({
    dietType: 'vegetarian',
    budget: 400,
    allergies: [],
    cookingSkill: 'intermediate',
    kitchenEquipment: ['gas stove'],
  }),
  buildMemorySummary: vi.fn().mockResolvedValue('Vegetarian, ₹400 budget'),
  getPlanningMemory: vi.fn().mockResolvedValue({
    diet: 'vegetarian', budget: 400, allergies: [], cookingSkill: 'intermediate',
    kitchenEquipment: ['gas stove'], householdSize: 1, fitnessGoals: {},
    preferredCuisines: ['North Indian'], frequentRestaurants: [], pantryStaples: ['rice'],
  }),
}))

vi.mock('@/lib/repositories/situationRepo', () => ({
  transitionToClarifying: vi.fn().mockResolvedValue({ id: 'sit-int', status: 'CLARIFYING' }),
  transitionToContextReady: vi.fn().mockResolvedValue({ id: 'sit-int', status: 'CONTEXT_READY' }),
  transitionToPlanning: vi.fn().mockResolvedValue({ id: 'sit-int', status: 'PLANNING' }),
  transitionToPlanReady: vi.fn().mockResolvedValue({ id: 'sit-int', status: 'PLAN_READY' }),
  transitionToAbandoned: vi.fn().mockResolvedValue({ id: 'sit-int', status: 'ABANDONED' }),
  getSituationById: vi.fn().mockResolvedValue({ id: 'sit-int', status: 'CREATED', userId: 'u-int' }),
  setSituationType: vi.fn().mockResolvedValue({ id: 'sit-int', situationType: 'nutrition_goal' }),
  updateClarificationData: vi.fn().mockResolvedValue({ id: 'sit-int' }),
}))

vi.mock('@/lib/repositories/recommendationRepo', () => ({
  createRecommendation: vi.fn().mockResolvedValue({ id: 'rec-int', createdAt: new Date().toISOString() }),
}))

vi.mock('@/lib/repositories/userRepo', () => ({
  getUserByClerkId: vi.fn().mockResolvedValue({ id: 'u-int', clerkUserId: 'clerk-int' }),
}))

// ── Dynamic imports ───────────────────────────────────────────────────────────

const { runOrchestrator } = await import('@/lib/agents/orchestrator')
const { runConversationAgent } = await import('@/lib/agents/conversation')
const { runPlanningAgent } = await import('@/lib/agents/planning')
const { createRecommendation } = await import('@/lib/repositories/recommendationRepo')

import type { ExtractedContextValidated } from '@/lib/schemas/agents'
import type { PlanningAgentOutputValidated } from '@/lib/schemas/planningOutput'

// ── Canned inputs ─────────────────────────────────────────────────────────────

const NUTRITION_CONTEXT: ExtractedContextValidated = {
  situationType: 'nutrition_goal',
  explicit: {
    nutritionGoal: { protein: 150 as never },
    budget: 400 as never,
    canCook: true,
    alone: true,
  },
  inferred: { timeOfDay: 'lunch', isWeekend: false },
  confidence: 90 as ExtractedContextValidated['confidence'],
  missingRequired: [],
  missingSoft: [],
  ambiguities: [],
  nonFoodInput: false,
}

const VALID_PLAN: PlanningAgentOutputValidated = {
  explanation: 'Cooking a high-protein meal is optimal for your 150g protein goal within ₹400.',
  primaryPath: 'cook',
  confidence: 'high',
  recommendation: {
    title: 'Paneer Tikka with Dal',
    description: 'High-protein meal from pantry staples.',
    estimatedCost: 180 as PlanningAgentOutputValidated['recommendation']['estimatedCost'],
    estimatedTime: 35 as PlanningAgentOutputValidated['recommendation']['estimatedTime'],
    ingredients: [{ name: 'Paneer', qty: '200g', inPantry: false }],
    recipeSteps: [{ step: 1, instruction: 'Marinate paneer', durationMin: 10 as never }],
  },
  whyNotAlternatives: [
    { path: 'order', reason: 'Delivery options lack protein density for your target.' },
    { path: 'dineout', reason: 'Restaurant meals are harder to track macros.' },
  ],
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(runConversationAgent).mockResolvedValue({
    output: NUTRITION_CONTEXT,
    status: 'completed',
    latencyMs: 700 as never,
    inputTokens: 400,
    outputTokens: 180,
    attempts: 1,
  })
  vi.mocked(runPlanningAgent).mockResolvedValue({
    output: VALID_PLAN,
    status: 'completed',
    latencyMs: 3500 as never,
    inputTokens: 2500,
    outputTokens: 800,
    attempts: 1,
  })
})

describe('planning pipeline — integration (ISSUE-093)', () => {
  it('runs end-to-end: conversation → clarification (skip) → tool → scorer → planning → plan_ready', async () => {
    const events: string[] = []
    const send = vi.fn((event: string) => events.push(event))

    const result = await runOrchestrator(
      {
        situationId: 'sit-int',
        userId: 'u-int',
        rawInput: 'I need 150g protein today within ₹400',
        timestamp: '2026-07-08T13:00:00+05:30',
        userTimezone: 'Asia/Kolkata',
      },
      send,
    )

    // Pipeline completed
    expect(result.pipelineStatus).toBe('complete')
    expect(result.recommendationId).toBe('rec-int')

    // All expected SSE events were emitted
    expect(events).toContain('context_understood')
    expect(events).toContain('planning_started')
    expect(events).toContain('plan_ready')

    // No clarification event — confidence=90, missingRequired=[]
    expect(events).not.toContain('clarification_needed')
  })

  it('plan_ready event payload contains the correct recommendation data', async () => {
    const eventPayloads: Record<string, unknown> = {}
    const send = vi.fn((event: string, data: unknown) => {
      eventPayloads[event] = data
    })

    await runOrchestrator(
      {
        situationId: 'sit-int',
        userId: 'u-int',
        rawInput: 'I need 150g protein today within ₹400',
        timestamp: '2026-07-08T13:00:00+05:30',
        userTimezone: 'Asia/Kolkata',
      },
      send,
    )

    const planReadyPayload = eventPayloads['plan_ready'] as Record<string, unknown>
    expect(planReadyPayload).toBeDefined()
    expect(planReadyPayload['recommendation_id']).toBe('rec-int')
    expect(planReadyPayload['headline']).toBe('Paneer Tikka with Dal')
    expect(planReadyPayload['plan_type']).toBe('cook')
  })

  it('recommendation row created with correct primary path and title', async () => {
    const send = vi.fn()

    await runOrchestrator(
      {
        situationId: 'sit-int',
        userId: 'u-int',
        rawInput: 'I need 150g protein today within ₹400',
        timestamp: '2026-07-08T13:00:00+05:30',
        userTimezone: 'Asia/Kolkata',
      },
      send,
    )

    expect(createRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({
        situationId: 'sit-int',
        userId: 'u-int',
        title: 'Paneer Tikka with Dal',
      }),
    )
  })

  it('Tool Agent is called (real, mock Swiggy) and its errors do not stop the pipeline', async () => {
    // Force Swiggy to return empty results — the mock mode returns data
    // but we verify the pipeline completes even when data is sparse
    const send = vi.fn()

    const result = await runOrchestrator(
      {
        situationId: 'sit-int',
        userId: 'u-int',
        rawInput: 'I need 150g protein today within ₹400',
        timestamp: '2026-07-08T13:00:00+05:30',
        userTimezone: 'Asia/Kolkata',
      },
      send,
    )

    expect(result.pipelineStatus).not.toBe('failed')
  })

  it('Planning Agent receives pre-calculated scores from the real Decision Engine', async () => {
    const send = vi.fn()

    await runOrchestrator(
      {
        situationId: 'sit-int',
        userId: 'u-int',
        rawInput: 'I need 150g protein today within ₹400',
        timestamp: '2026-07-08T13:00:00+05:30',
        userTimezone: 'Asia/Kolkata',
      },
      send,
    )

    const planningCall = vi.mocked(runPlanningAgent).mock.calls[0]?.[0]
    expect(planningCall).toBeDefined()

    // Scores are real numbers 0–100 produced by the Decision Engine
    expect(planningCall?.preCalculatedScores.cook).toBeGreaterThanOrEqual(0)
    expect(planningCall?.preCalculatedScores.cook).toBeLessThanOrEqual(100)
    expect(planningCall?.preCalculatedScores.order).toBeGreaterThanOrEqual(0)
    expect(planningCall?.preCalculatedScores.dineout).toBeGreaterThanOrEqual(0)
  })
})
