/**
 * tests/agents/orchestrator-memory.test.ts
 * Tests the Memory Agent fire-and-forget trigger in lib/agents/orchestrator.ts
 *
 * Verifies:
 *   1. runMemoryAgent is called after a successful plan completion
 *   2. getFactsForUser is called to supply existingFacts to the Memory Agent
 *   3. Memory Agent failure does NOT affect the orchestrator's return value
 *   4. Trigger does NOT block the orchestrator (returns before agent finishes)
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest'

process.env['DATABASE_URL'] ??= 'postgres://test:test@localhost:5432/test'
process.env['ANTHROPIC_API_KEY'] ??= 'test-key'
process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] ??= 'pk_test'
process.env['CLERK_SECRET_KEY'] ??= 'sk_test'
process.env['YOUTUBE_API_KEY'] ??= 'yt_test'
process.env['SWIGGY_MCP_MODE'] ??= 'mock'

// ── Module mocks ──────────────────────────────────────────────────────────────

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

vi.mock('@/lib/agents/memory', () => ({
  runMemoryAgent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/memory/retrieval', () => ({
  getMemoryContext: vi.fn().mockResolvedValue({ dietType: 'vegetarian', budget: 350 }),
  buildMemorySummary: vi.fn().mockResolvedValue('Vegetarian, ₹350 budget'),
  getPlanningMemory: vi.fn().mockResolvedValue({
    diet: 'vegetarian', budget: 350, allergies: [], cookingSkill: 'intermediate',
    kitchenEquipment: ['gas stove'], householdSize: 1, fitnessGoals: {},
    preferredCuisines: ['North Indian'], frequentRestaurants: [], pantryStaples: [],
  }),
}))

vi.mock('@/lib/repositories/situationRepo', () => ({
  transitionToClarifying:   vi.fn().mockResolvedValue({}),
  transitionToContextReady: vi.fn().mockResolvedValue({}),
  transitionToPlanning:     vi.fn().mockResolvedValue({}),
  transitionToPlanReady:    vi.fn().mockResolvedValue({}),
  updateClarificationData:  vi.fn().mockResolvedValue({}),
  setSituationType:         vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/repositories/recommendationRepo', () => ({
  createRecommendation: vi.fn().mockResolvedValue({ id: 'rec-1' }),
}))

vi.mock('@/lib/repositories/memoryFactRepo', () => ({
  getFactsForUser: vi.fn().mockResolvedValue([]),
  upsertFactsBatch: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/sse', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sse')>()
  return { ...actual, waitForClarificationAnswers: vi.fn() }
})

// ── Imports (after mocks) ─────────────────────────────────────────────────────

const { runOrchestrator } = await import('@/lib/agents/orchestrator')
const { runConversationAgent } = await import('@/lib/agents/conversation')
const { runClarificationEngine } = await import('@/lib/agents/clarification')
const { runToolAgent } = await import('@/lib/agents/tool')
const { runPlanningAgent } = await import('@/lib/agents/planning')
const { runMemoryAgent } = await import('@/lib/agents/memory')
const { getFactsForUser } = await import('@/lib/repositories/memoryFactRepo')

import type { ExtractedContextValidated, ToolAgentOutputValidated } from '@/lib/schemas/agents'
import type { ClarificationEngineResult } from '@/lib/agents/clarification'
import type { PlanningAgentOutputValidated } from '@/lib/schemas/planningOutput'

// ── Typed mocks ───────────────────────────────────────────────────────────────

type ConvResult = Awaited<ReturnType<typeof runConversationAgent>>
type PlanResult = Awaited<ReturnType<typeof runPlanningAgent>>

const mockConv   = vi.mocked(runConversationAgent) as MockedFunction<typeof runConversationAgent>
const mockClar   = vi.mocked(runClarificationEngine) as MockedFunction<typeof runClarificationEngine>
const mockTool   = vi.mocked(runToolAgent) as MockedFunction<typeof runToolAgent>
const mockPlan   = vi.mocked(runPlanningAgent) as MockedFunction<typeof runPlanningAgent>
const mockMemory = vi.mocked(runMemoryAgent)
const mockGetFacts = vi.mocked(getFactsForUser)

// ── Shared fixtures ───────────────────────────────────────────────────────────

const CONV_OUTPUT: ExtractedContextValidated = {
  situationType: 'quick_meal',
  explicit: { canCook: true, alone: true },
  inferred: { timeOfDay: 'lunch', isWeekend: false },
  confidence: 85 as ExtractedContextValidated['confidence'],
  missingRequired: [],
  missingSoft: [],
  ambiguities: [],
  nonFoodInput: false,
}

const CONV_RESULT: ConvResult = {
  output: CONV_OUTPUT,
  status: 'completed',
  latencyMs: 600 as ConvResult['latencyMs'],
  inputTokens: 400, outputTokens: 150, attempts: 1,
}

const NO_CLAR: ClarificationEngineResult = {
  status: 'skipped',
  questions: [],
  assumptions: [],
  assumptionStatements: [],
}

const TOOL_RESULT: ToolAgentOutputValidated = {
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
}

const PLAN_RESULT: PlanResult = {
  output: {
    primaryPath: 'cook',
    explanation: 'Cook at home',
    recommendation: {
      title: 'Dal Chawal',
      estimatedCost: 80,
      estimatedTime: 25,
      recipeSteps: null,
      restaurantId: null,
      restaurantName: null,
    },
    whyNotAlternatives: [],
  } as unknown as PlanResult['output'],
  status: 'completed',
  latencyMs: 800 as PlanResult['latencyMs'],
  inputTokens: 600, outputTokens: 300, attempts: 1,
}

const ORCHESTRATOR_INPUT = {
  situationId: 'sit-1',
  userId: 'user-1',
  rawInput: 'I want a quick lunch',
  timestamp: '2026-07-08T06:00:00.000Z',
  userTimezone: 'Asia/Kolkata',
}

function makeSend() {
  return vi.fn() as (eventName: string, data: unknown) => void
}

function setupHappyPath() {
  mockConv.mockResolvedValue(CONV_RESULT)
  mockClar.mockResolvedValue(NO_CLAR)
  mockTool.mockResolvedValue(TOOL_RESULT)
  mockPlan.mockResolvedValue(PLAN_RESULT)
  mockMemory.mockResolvedValue(undefined)
  mockGetFacts.mockResolvedValue([])
}

/** Flush pending microtasks and macrotasks so fire-and-forget async IIFEs complete. */
async function flushAsync() {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Memory Agent trigger after plan completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls runMemoryAgent after a successful plan is saved', async () => {
    setupHappyPath()

    await runOrchestrator(ORCHESTRATOR_INPUT, makeSend())
    await flushAsync()

    expect(mockMemory).toHaveBeenCalledOnce()
  })

  it('calls getFactsForUser before triggering the Memory Agent', async () => {
    setupHappyPath()

    await runOrchestrator(ORCHESTRATOR_INPUT, makeSend())
    await flushAsync()

    expect(mockGetFacts).toHaveBeenCalledWith('user-1')
  })

  it('passes completedSituation with correct rawInput and situationType', async () => {
    setupHappyPath()

    await runOrchestrator(ORCHESTRATOR_INPUT, makeSend())
    await flushAsync()

    const [userId, agentInput] = mockMemory.mock.calls[0]!
    expect(userId).toBe('user-1')
    expect(agentInput.completedSituation.rawInput).toBe('I want a quick lunch')
    expect(agentInput.completedSituation.situationType).toBe('quick_meal')
  })

  it('does NOT block the orchestrator — returns before Memory Agent resolves', async () => {
    setupHappyPath()
    // Make Memory Agent very slow
    mockMemory.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 5000)))

    const start = Date.now()
    const result = await runOrchestrator(ORCHESTRATOR_INPUT, makeSend())
    const elapsed = Date.now() - start

    // Orchestrator returns in time (memory agent is non-blocking)
    expect(elapsed).toBeLessThan(1000)
    expect(result.pipelineStatus).toBe('complete')
  })

  it('orchestrator still returns complete when Memory Agent throws', async () => {
    setupHappyPath()
    mockMemory.mockRejectedValue(new Error('Memory Agent crashed'))

    const result = await runOrchestrator(ORCHESTRATOR_INPUT, makeSend())
    await flushAsync()

    expect(result.pipelineStatus).toBe('complete')
    expect(result.recommendationId).toBe('rec-1')
  })

  it('does NOT call runMemoryAgent when nonFoodInput is true', async () => {
    mockConv.mockResolvedValue({
      ...CONV_RESULT,
      output: { ...CONV_OUTPUT, nonFoodInput: true },
    })

    await runOrchestrator(ORCHESTRATOR_INPUT, makeSend())
    await flushAsync()

    expect(mockMemory).not.toHaveBeenCalled()
  })
})
