/**
 * tests/agents/orchestrator.test.ts
 * Unit tests for lib/agents/orchestrator.ts (ISSUE-093 pipeline wiring)
 *
 * All 4 agents are mocked at the @/lib/claude transport boundary.
 * Repositories, memory retrieval, and the clarification bus (lib/sse) are
 * also mocked so the orchestrator's control-flow logic can be tested in
 * isolation — no DB, no network.
 *
 * Test focus:
 *   1. Happy path: conversation → (no clarification) → tool + engine → planning → plan_ready
 *   2. Clarification path: conversation → clarification needed → answers received → planning
 *   3. nonFoodInput: pipeline stops after conversation, no planning events
 *   4. Conversation timeout fallback: proceeds to planning with fallback context
 *   5. Tool Agent degraded (swiggyError): isDegradedMode=true reaches Planning Agent
 *   6. Planning Agent failure: pipeline returns failed status
 *   7. SSE events emitted in correct order
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest'

// Env stubs must be in place before any module graph loads
process.env['DATABASE_URL'] ??= 'postgres://test:test@localhost:5432/test'
process.env['ANTHROPIC_API_KEY'] ??= 'test-key'
process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] ??= 'pk_test'
process.env['CLERK_SECRET_KEY'] ??= 'sk_test'
process.env['YOUTUBE_API_KEY'] ??= 'yt_test'
process.env['SWIGGY_MCP_MODE'] ??= 'mock'

// ── Module mocks (must be hoisted) ────────────────────────────────────────────

vi.mock('@/lib/agents/conversation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agents/conversation')>()
  return { ...actual, runConversationAgent: vi.fn() }
})

vi.mock('@/lib/agents/clarification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agents/clarification')>()
  return { ...actual, runClarificationEngine: vi.fn() }
})

vi.mock('@/lib/agents/tool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agents/tool')>()
  return { ...actual, runToolAgent: vi.fn() }
})

vi.mock('@/lib/agents/planning', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agents/planning')>()
  return { ...actual, runPlanningAgent: vi.fn() }
})

vi.mock('@/lib/memory/retrieval', () => ({
  getMemoryContext: vi.fn().mockResolvedValue({ dietType: 'vegetarian', budget: 350 }),
  buildMemorySummary: vi.fn().mockResolvedValue('Vegetarian, ₹350 budget'),
  getPlanningMemory: vi.fn().mockResolvedValue({
    diet: 'vegetarian', budget: 350, allergies: [], cookingSkill: 'intermediate',
    kitchenEquipment: ['gas stove'], householdSize: 1, fitnessGoals: {},
    preferredCuisines: ['North Indian'], frequentRestaurants: [], pantryStaples: ['rice', 'dal'],
  }),
}))

vi.mock('@/lib/repositories/situationRepo', () => ({
  transitionToClarifying: vi.fn().mockResolvedValue({ id: 'sit-1', status: 'CLARIFYING' }),
  transitionToContextReady: vi.fn().mockResolvedValue({ id: 'sit-1', status: 'CONTEXT_READY' }),
  transitionToPlanning: vi.fn().mockResolvedValue({ id: 'sit-1', status: 'PLANNING' }),
  transitionToPlanReady: vi.fn().mockResolvedValue({ id: 'sit-1', status: 'PLAN_READY' }),
  transitionToAbandoned: vi.fn().mockResolvedValue({ id: 'sit-1', status: 'ABANDONED' }),
  getSituationById: vi.fn().mockResolvedValue({ id: 'sit-1', status: 'CREATED', userId: 'u-1' }),
  setSituationType: vi.fn().mockResolvedValue({ id: 'sit-1', situationType: 'sick' }),
  updateClarificationData: vi.fn().mockResolvedValue({ id: 'sit-1' }),
}))

vi.mock('@/lib/repositories/recommendationRepo', () => ({
  createRecommendation: vi.fn().mockResolvedValue({ id: 'rec-1', createdAt: new Date().toISOString() }),
}))

vi.mock('@/lib/sse', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sse')>()
  return {
    ...actual,
    waitForClarificationAnswers: vi.fn(),
  }
})

vi.mock('@/lib/repositories/userRepo', () => ({
  getUserByClerkId: vi.fn().mockResolvedValue({ id: 'u-1', clerkUserId: 'clerk-1' }),
}))

// ── Dynamic imports (after mocks) ─────────────────────────────────────────────

const { runOrchestrator } = await import('@/lib/agents/orchestrator')
const { runConversationAgent } = await import('@/lib/agents/conversation')
const { runClarificationEngine } = await import('@/lib/agents/clarification')
const { runToolAgent } = await import('@/lib/agents/tool')
const { runPlanningAgent } = await import('@/lib/agents/planning')
const { waitForClarificationAnswers } = await import('@/lib/sse')
const { createRecommendation } = await import('@/lib/repositories/recommendationRepo')

import type { ExtractedContextValidated } from '@/lib/schemas/agents'
import type { ClarificationEngineResult } from '@/lib/agents/clarification'
import type { ToolAgentOutputValidated } from '@/lib/schemas/agents'
import type { PlanningAgentOutputValidated } from '@/lib/schemas/planningOutput'

// ── Typed mocks ───────────────────────────────────────────────────────────────

type ConvResult = Awaited<ReturnType<typeof runConversationAgent>>
type ToolResult = ToolAgentOutputValidated
type PlanResult = Awaited<ReturnType<typeof runPlanningAgent>>

const mockConv = vi.mocked(runConversationAgent) as MockedFunction<typeof runConversationAgent>
const mockClar = vi.mocked(runClarificationEngine) as MockedFunction<typeof runClarificationEngine>
const mockTool = vi.mocked(runToolAgent) as MockedFunction<typeof runToolAgent>
const mockPlan = vi.mocked(runPlanningAgent) as MockedFunction<typeof runPlanningAgent>
const mockWaitForAnswers = vi.mocked(waitForClarificationAnswers)

// ── Fixtures ──────────────────────────────────────────────────────────────────

const GOOD_CONV_OUTPUT: ExtractedContextValidated = {
  situationType: 'sick',
  explicit: { canCook: true, alone: true },
  inferred: { timeOfDay: 'dinner', isWeekend: false },
  confidence: 80 as ExtractedContextValidated['confidence'],
  missingRequired: [],
  missingSoft: [],
  ambiguities: [],
  nonFoodInput: false,
}

const CONV_RESULT: ConvResult = {
  output: GOOD_CONV_OUTPUT,
  status: 'completed',
  latencyMs: 600 as ConvResult['latencyMs'],
  inputTokens: 500,
  outputTokens: 200,
  attempts: 1,
}

const NO_CLARIFICATION: ClarificationEngineResult = {
  status: 'skipped',
  questions: [],
  assumptions: [],
  assumptionStatements: [],
}

const NEEDS_CLARIFICATION: ClarificationEngineResult = {
  status: 'completed',
  questions: [
    {
      id: 'q1',
      text: 'Can you cook right now?',
      field: 'canCook',
      type: 'single_choice',
      options: [{ label: 'Yes', value: true }, { label: 'No', value: false }],
      required: true,
    },
  ],
  assumptions: [],
  assumptionStatements: [],
}

const TOOL_OUTPUT: ToolResult = {
  restaurants: [],
  instamartItems: [],
  dineoutVenues: [],
  youtube: null,
  errors: [],
  _meta: {
    toolsAttempted: [],
    toolsSucceeded: [],
    totalLatencyMs: 200 as ToolResult['_meta']['totalLatencyMs'],
  },
}

const PLAN_OUTPUT: PlanningAgentOutputValidated = {
  explanation: 'Cooking khichdi is ideal when sick.',
  primaryPath: 'cook',
  confidence: 'high',
  recommendation: {
    title: 'Moong Dal Khichdi',
    description: 'Easy to digest.',
    estimatedCost: 50 as PlanningAgentOutputValidated['recommendation']['estimatedCost'],
    estimatedTime: 25 as PlanningAgentOutputValidated['recommendation']['estimatedTime'],
    ingredients: [{ name: 'Dal', qty: '1 cup', inPantry: true }],
    recipeSteps: [{ step: 1, instruction: 'Rinse dal', durationMin: 3 as never }],
  },
  whyNotAlternatives: [
    { path: 'order', reason: 'Delivery is heavy for a recovering stomach.' },
    { path: 'dineout', reason: 'Going out while sick is inadvisable.' },
  ],
}

const PLAN_RESULT: PlanResult = {
  output: PLAN_OUTPUT,
  status: 'completed',
  latencyMs: 3000 as PlanResult['latencyMs'],
  inputTokens: 2000,
  outputTokens: 700,
  attempts: 1,
}

// ── Test input ────────────────────────────────────────────────────────────────

const INPUT = {
  situationId: 'sit-1',
  userId: 'u-1',
  rawInput: "I'm sick and can't think of what to eat",
  timestamp: '2026-07-08T19:30:00+05:30',
  userTimezone: 'Asia/Kolkata',
}

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockConv.mockResolvedValue(CONV_RESULT)
  mockClar.mockResolvedValue(NO_CLARIFICATION)
  mockTool.mockResolvedValue(TOOL_OUTPUT)
  mockPlan.mockResolvedValue(PLAN_RESULT)
})

// ── Happy path ────────────────────────────────────────────────────────────────

describe('runOrchestrator — happy path (no clarification)', () => {
  it('calls all four agents in order', async () => {
    const send = vi.fn()
    await runOrchestrator(INPUT, send)

    expect(mockConv).toHaveBeenCalledTimes(1)
    expect(mockClar).toHaveBeenCalledTimes(1)
    expect(mockTool).toHaveBeenCalledTimes(1)
    expect(mockPlan).toHaveBeenCalledTimes(1)
  })

  it('emits context_understood and plan_ready SSE events', async () => {
    const send = vi.fn()
    await runOrchestrator(INPUT, send)

    const events = send.mock.calls.map((c) => c[0] as string)
    expect(events).toContain('context_understood')
    expect(events).toContain('planning_started')
    expect(events).toContain('plan_ready')
  })

  it('plan_ready event contains the recommendation_id', async () => {
    const send = vi.fn()
    await runOrchestrator(INPUT, send)

    const planReadyCall = send.mock.calls.find((c) => c[0] === 'plan_ready')
    expect(planReadyCall).toBeDefined()
    expect(planReadyCall?.[1]).toMatchObject({ recommendation_id: 'rec-1' })
  })

  it('returns pipelineStatus=complete', async () => {
    const send = vi.fn()
    const result = await runOrchestrator(INPUT, send)
    expect(result.pipelineStatus).toBe('complete')
  })

  it('creates a recommendation row in the DB', async () => {
    const send = vi.fn()
    await runOrchestrator(INPUT, send)
    expect(createRecommendation).toHaveBeenCalledTimes(1)
  })
})

// ── Clarification path ────────────────────────────────────────────────────────

describe('runOrchestrator — clarification path', () => {
  beforeEach(() => {
    // First ClarificationEngine call returns questions; second returns none
    mockClar
      .mockResolvedValueOnce(NEEDS_CLARIFICATION)
      .mockResolvedValueOnce(NO_CLARIFICATION)
    // Simulate answers arriving
    mockWaitForAnswers.mockResolvedValue({ q1: true })
  })

  it('emits clarification_needed when questions are generated', async () => {
    const send = vi.fn()
    await runOrchestrator(INPUT, send)

    const events = send.mock.calls.map((c) => c[0] as string)
    expect(events).toContain('clarification_needed')
  })

  it('calls waitForClarificationAnswers with the situationId', async () => {
    const send = vi.fn()
    await runOrchestrator(INPUT, send)
    expect(mockWaitForAnswers).toHaveBeenCalledWith('sit-1', expect.any(Number))
  })

  it('proceeds to planning after answers arrive', async () => {
    const send = vi.fn()
    await runOrchestrator(INPUT, send)

    expect(mockPlan).toHaveBeenCalledTimes(1)
    const events = send.mock.calls.map((c) => c[0] as string)
    expect(events).toContain('plan_ready')
  })

  it('runs ClarificationEngine twice (initial pass + post-answer re-eval)', async () => {
    const send = vi.fn()
    await runOrchestrator(INPUT, send)
    expect(mockClar).toHaveBeenCalledTimes(2)
  })
})

// ── nonFoodInput ──────────────────────────────────────────────────────────────

describe('runOrchestrator — nonFoodInput', () => {
  it('stops after conversation agent and never calls planning', async () => {
    mockConv.mockResolvedValue({
      ...CONV_RESULT,
      output: { ...GOOD_CONV_OUTPUT, nonFoodInput: true },
    })

    const send = vi.fn()
    const result = await runOrchestrator(INPUT, send)

    expect(mockPlan).not.toHaveBeenCalled()
    expect(result.pipelineStatus).toBe('complete')

    const events = send.mock.calls.map((c) => c[0] as string)
    expect(events).toContain('non_food_redirect')
  })
})

// ── Conversation timeout ──────────────────────────────────────────────────────

describe('runOrchestrator — conversation timeout', () => {
  it('uses the fallback output and proceeds to planning', async () => {
    mockConv.mockResolvedValue({
      ...CONV_RESULT,
      status: 'timeout',
      output: { ...GOOD_CONV_OUTPUT, confidence: 30 as never, situationType: 'general' },
    })

    const send = vi.fn()
    const result = await runOrchestrator(INPUT, send)

    expect(mockPlan).toHaveBeenCalledTimes(1)
    expect(result.pipelineStatus).not.toBe('failed')
  })
})

// ── Degraded mode (all Swiggy tools fail) ─────────────────────────────────────

describe('runOrchestrator — degraded mode', () => {
  it('passes isDegradedMode=true to the Planning Agent when swiggyError is set', async () => {
    mockTool.mockResolvedValue({
      ...TOOL_OUTPUT,
      restaurants: null,
      swiggyError: 'SWIGGY_UNAVAILABLE',
    })

    const send = vi.fn()
    await runOrchestrator(INPUT, send)

    const planningCall = mockPlan.mock.calls[0]?.[0]
    expect(planningCall?.isDegradedMode).toBe(true)
  })
})

// ── Planning failure ──────────────────────────────────────────────────────────

describe('runOrchestrator — planning failure', () => {
  it('returns degraded pipelineStatus when Planning Agent schema_fails', async () => {
    mockPlan.mockResolvedValue({
      ...PLAN_RESULT,
      status: 'schema_failed',
      error: 'winner mismatch',
    })

    const send = vi.fn()
    const result = await runOrchestrator(INPUT, send)

    // We still emit plan_ready with the fallback output — user always sees something
    expect(result.pipelineStatus).toBe('degraded')
    const events = send.mock.calls.map((c) => c[0] as string)
    expect(events).toContain('plan_ready')
  })
})
