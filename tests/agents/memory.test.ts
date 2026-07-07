/**
 * tests/agents/memory.test.ts
 * Unit tests for the Memory Agent (lib/agents/memory.ts)
 *
 * Mocks:
 *   - @/lib/claude — the LLM transport boundary (runMemoryAgent convenience helper)
 *   - @/lib/repositories/memoryFactRepo — prevents DB writes; verifies write payloads
 *
 * Test focus (docs/IMPLEMENTATION_PLAYBOOK.md M8 DoD + docs/AGENTS.md §5):
 *   1. Extraction from clarification answers (confidence 0.8)
 *   2. Extraction from executed actions / behavior (confidence 0.4 / 0.6)
 *   3. Registry rejection (invented keys are never written)
 *   4. Schema validation rejection (malformed output → no writes)
 *   5. Silent-failure contract (any failure → no throw, no user impact)
 *   6. Never-downgrade rule (existing higher-confidence fact not downgraded)
 *   7. Expiry date computation from expiresAfterDays
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/claude', () => ({
  runMemoryAgent: vi.fn(),
}))

vi.mock('@/lib/repositories/memoryFactRepo', () => ({
  upsertFactsBatch: vi.fn(),
}))

import { runMemoryAgent } from '@/lib/agents/memory'
import { runMemoryAgent as claudeRunMemoryAgent } from '@/lib/claude'
import { upsertFactsBatch } from '@/lib/repositories/memoryFactRepo'
import type { MemoryAgentInput } from '@/types/agents'
import type { FactConfidence } from '@/types/primitives'

const mockClaude = vi.mocked(claudeRunMemoryAgent)
const mockUpsertBatch = vi.mocked(upsertFactsBatch)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<MemoryAgentInput> = {}): MemoryAgentInput {
  return {
    completedSituation: {
      rawInput: 'I need 150g protein today, I am vegetarian',
      situationType: 'nutrition_goal',
      explicit: { nutritionGoal: { protein: 150 } },
      inferred: { timeOfDay: 'breakfast' },
      recommendation: {
        primaryPath: 'cook',
        title: 'High-Protein Vegetarian Day Plan',
        estimatedCost: 280,
      },
    } as unknown as MemoryAgentInput['completedSituation'],
    clarificationAnswers: [],
    executedPath: 'cook',
    userRating: 5,
    existingFacts: [],
    ...overrides,
  }
}

type ClaudeRunResult = Awaited<ReturnType<typeof claudeRunMemoryAgent>>

/** Mock the claude transport returning a completed run with the given output. */
function mockCompleted(output: unknown) {
  mockClaude.mockResolvedValue({
    output,
    status: 'completed',
    latencyMs: 120,
    inputTokens: 500,
    outputTokens: 150,
    attempts: 1,
  } as unknown as ClaudeRunResult)
}

/** Mock the claude transport returning a failed run (fallback [] output). */
function mockFailed(status: 'timeout' | 'schema_failed' | 'failed', error = 'boom') {
  mockClaude.mockResolvedValue({
    output: [],
    status,
    latencyMs: 5000,
    inputTokens: 0,
    outputTokens: 0,
    attempts: 3,
    error,
  } as unknown as ClaudeRunResult)
}

function firstBatchArg() {
  return mockUpsertBatch.mock.calls[0]?.[0]
}

// ── Extraction from clarification answers ─────────────────────────────────────

describe('extraction from clarification answers (confidence 0.8)', () => {
  it('writes a fact from a clarification answer with source CLARIFICATION', async () => {
    mockCompleted([
      {
        factKey: 'fitness.protein_target',
        factValue: 150,
        confidence: 0.8,
        source: 'clarification_answer',
        expiresAfterDays: 45,
      },
    ])
    mockUpsertBatch.mockResolvedValue([])

    await runMemoryAgent('user-1', makeInput({
      clarificationAnswers: [
        {
          question: 'What is your daily protein goal?',
          answer: '150g',
          fieldAnswered: 'nutritionGoal.protein',
        } as unknown as MemoryAgentInput['clarificationAnswers'][number],
      ],
    }))

    expect(mockUpsertBatch).toHaveBeenCalledOnce()
    const batch = firstBatchArg()
    expect(batch).toHaveLength(1)
    expect(batch?.[0]?.factKey).toBe('fitness.protein_target')
    expect(batch?.[0]?.confidence).toBe(0.8)
    // Domain 'clarification_answer' maps to Prisma 'CLARIFICATION'
    expect(batch?.[0]?.source).toBe('CLARIFICATION')
  })

  it('writes user-stated dietary restriction at confidence 1.0 (source AGENT_INFERRED in DB)', async () => {
    mockCompleted([
      {
        factKey: 'dietary.restrictions',
        factValue: ['vegetarian'],
        confidence: 1.0,
        source: 'user_stated',
        expiresAfterDays: null,
      },
    ])
    mockUpsertBatch.mockResolvedValue([])

    await runMemoryAgent('user-1', makeInput())

    expect(mockUpsertBatch).toHaveBeenCalledOnce()
    const batch = firstBatchArg()
    expect(batch?.[0]?.factKey).toBe('dietary.restrictions')
    expect(batch?.[0]?.confidence).toBe(1.0)
    expect(batch?.[0]?.source).toBe('AGENT_INFERRED')
  })
})

// ── Extraction from executed actions / behavior ───────────────────────────────

describe('extraction from behavior (confidence 0.4 / 0.6)', () => {
  it('writes cooking.can_cook at 0.4 when cook path was dismissed (single data point)', async () => {
    mockCompleted([
      {
        factKey: 'cooking.can_cook',
        factValue: false,
        confidence: 0.4,
        source: 'behavior_inferred',
        expiresAfterDays: 30,
      },
    ])
    mockUpsertBatch.mockResolvedValue([])

    await runMemoryAgent('user-1', makeInput({ executedPath: 'dismissed' }))

    expect(mockUpsertBatch).toHaveBeenCalledOnce()
    const batch = firstBatchArg()
    expect(batch?.[0]?.confidence).toBe(0.4)
    expect(batch?.[0]?.source).toBe('AGENT_INFERRED')
  })

  it('writes a repeated-action preference fact at 0.6', async () => {
    mockCompleted([
      {
        factKey: 'preference.cuisines.liked',
        factValue: ['South Indian'],
        confidence: 0.6,
        source: 'behavior_inferred',
        expiresAfterDays: 90,
      },
    ])
    mockUpsertBatch.mockResolvedValue([])

    await runMemoryAgent('user-1', makeInput())

    const batch = firstBatchArg()
    expect(batch?.[0]?.confidence).toBe(0.6)
  })
})

// ── Empty output ──────────────────────────────────────────────────────────────

describe('empty output', () => {
  it('does not call upsertFactsBatch when the agent returns []', async () => {
    mockCompleted([])
    await runMemoryAgent('user-1', makeInput())
    expect(mockUpsertBatch).not.toHaveBeenCalled()
  })
})

// ── Registry rejection ────────────────────────────────────────────────────────

describe('registry rejection (invented keys)', () => {
  it('writes nothing when output contains a non-canonical key', async () => {
    mockCompleted([
      {
        factKey: 'health.sick_today', // not in the canonical 18-key registry
        factValue: true,
        confidence: 0.4,
        source: 'behavior_inferred',
        expiresAfterDays: 1,
      },
    ])
    await runMemoryAgent('user-1', makeInput())
    expect(mockUpsertBatch).not.toHaveBeenCalled()
  })

  it('writes nothing for an empty-string key', async () => {
    mockCompleted([
      {
        factKey: '',
        factValue: 'anything',
        confidence: 0.4,
        source: 'user_stated',
        expiresAfterDays: null,
      },
    ])
    await runMemoryAgent('user-1', makeInput())
    expect(mockUpsertBatch).not.toHaveBeenCalled()
  })
})

// ── Schema validation rejection ───────────────────────────────────────────────

describe('schema validation rejection', () => {
  it('writes nothing when confidence is not in the closed set (0.85)', async () => {
    mockCompleted([
      {
        factKey: 'fitness.protein_target',
        factValue: 150,
        confidence: 0.85, // invalid — only 0.4 | 0.6 | 0.8 | 1.0 allowed
        source: 'clarification_answer',
        expiresAfterDays: 45,
      },
    ])
    await runMemoryAgent('user-1', makeInput())
    expect(mockUpsertBatch).not.toHaveBeenCalled()
  })

  it('writes nothing when confidence is 0.3 (below write-time minimum)', async () => {
    mockCompleted([
      {
        factKey: 'cooking.can_cook',
        factValue: false,
        confidence: 0.3,
        source: 'behavior_inferred',
        expiresAfterDays: 30,
      },
    ])
    await runMemoryAgent('user-1', makeInput())
    expect(mockUpsertBatch).not.toHaveBeenCalled()
  })

  it('writes nothing when output is an object instead of an array', async () => {
    mockCompleted({
      factKey: 'dietary.restrictions',
      factValue: ['vegetarian'],
      confidence: 1.0,
      source: 'user_stated',
      expiresAfterDays: null,
    })
    await runMemoryAgent('user-1', makeInput())
    expect(mockUpsertBatch).not.toHaveBeenCalled()
  })

  it('writes nothing when output has an unexpected extra field (strict schema)', async () => {
    mockCompleted([
      {
        factKey: 'dietary.restrictions',
        factValue: ['vegetarian'],
        confidence: 1.0,
        source: 'user_stated',
        expiresAfterDays: null,
        invented: 'extra',
      },
    ])
    await runMemoryAgent('user-1', makeInput())
    expect(mockUpsertBatch).not.toHaveBeenCalled()
  })
})

// ── Silent-failure contract ───────────────────────────────────────────────────

describe('silent-failure contract', () => {
  it('does NOT throw and writes nothing when the LLM run times out', async () => {
    mockFailed('timeout', 'AGENT_TIMEOUT')
    await expect(runMemoryAgent('user-1', makeInput())).resolves.toBeUndefined()
    expect(mockUpsertBatch).not.toHaveBeenCalled()
  })

  it('does NOT throw and writes nothing on schema_failed status', async () => {
    mockFailed('schema_failed', 'zod validation failed')
    await expect(runMemoryAgent('user-1', makeInput())).resolves.toBeUndefined()
    expect(mockUpsertBatch).not.toHaveBeenCalled()
  })

  it('does NOT throw and writes nothing on failed status (api_error)', async () => {
    mockFailed('failed', 'Anthropic API 500')
    await expect(runMemoryAgent('user-1', makeInput())).resolves.toBeUndefined()
    expect(mockUpsertBatch).not.toHaveBeenCalled()
  })

  it('does NOT throw even if the claude transport rejects unexpectedly', async () => {
    mockClaude.mockRejectedValue(new Error('unexpected transport crash'))
    await expect(runMemoryAgent('user-1', makeInput())).resolves.toBeUndefined()
    expect(mockUpsertBatch).not.toHaveBeenCalled()
  })

  it('does NOT throw when the DB write fails after all retries', async () => {
    mockCompleted([
      {
        factKey: 'fitness.protein_target',
        factValue: 150,
        confidence: 0.8,
        source: 'clarification_answer',
        expiresAfterDays: 45,
      },
    ])
    mockUpsertBatch.mockRejectedValue(new Error('DB connection failed'))

    await expect(runMemoryAgent('user-1', makeInput())).resolves.toBeUndefined()
    // Write was retried 3 times before giving up silently
    expect(mockUpsertBatch).toHaveBeenCalledTimes(3)
  })
})

// ── Never-downgrade rule ──────────────────────────────────────────────────────

describe('never-downgrade confidence rule', () => {
  it('drops facts where existing confidence is higher than the new one', async () => {
    mockCompleted([
      {
        factKey: 'fitness.protein_target',
        factValue: 120,
        confidence: 0.4,
        source: 'behavior_inferred',
        expiresAfterDays: 45,
      },
    ])
    mockUpsertBatch.mockResolvedValue([])

    await runMemoryAgent('user-1', makeInput({
      existingFacts: [
        {
          factKey: 'fitness.protein_target',
          factValue: 150,
          confidence: 0.8 as FactConfidence, // existing is higher
        },
      ],
    }))

    expect(mockUpsertBatch).not.toHaveBeenCalled()
  })

  it('writes facts where new confidence equals existing', async () => {
    mockCompleted([
      {
        factKey: 'fitness.protein_target',
        factValue: 150,
        confidence: 0.8,
        source: 'clarification_answer',
        expiresAfterDays: 45,
      },
    ])
    mockUpsertBatch.mockResolvedValue([])

    await runMemoryAgent('user-1', makeInput({
      existingFacts: [
        {
          factKey: 'fitness.protein_target',
          factValue: 150,
          confidence: 0.8 as FactConfidence,
        },
      ],
    }))

    expect(mockUpsertBatch).toHaveBeenCalledOnce()
  })

  it('writes facts where new confidence upgrades existing', async () => {
    mockCompleted([
      {
        factKey: 'dietary.restrictions',
        factValue: ['vegetarian'],
        confidence: 1.0,
        source: 'user_stated',
        expiresAfterDays: null,
      },
    ])
    mockUpsertBatch.mockResolvedValue([])

    await runMemoryAgent('user-1', makeInput({
      existingFacts: [
        {
          factKey: 'dietary.restrictions',
          factValue: ['vegetarian'],
          confidence: 0.6 as FactConfidence, // lower — upgrade allowed
        },
      ],
    }))

    expect(mockUpsertBatch).toHaveBeenCalledOnce()
  })
})

// ── expiresAt computation ─────────────────────────────────────────────────────

describe('expiresAt computation', () => {
  it('computes expiresAt ~30 days out when expiresAfterDays is 30', async () => {
    mockCompleted([
      {
        factKey: 'budget.daily_food_target',
        factValue: 350,
        confidence: 1.0,
        source: 'user_stated',
        expiresAfterDays: 30,
      },
    ])
    mockUpsertBatch.mockResolvedValue([])

    await runMemoryAgent('user-1', makeInput())

    const batch = firstBatchArg()
    const expiresAt = batch?.[0]?.expiresAt
    expect(expiresAt).toBeInstanceOf(Date)
    const deltaMs = (expiresAt as Date).getTime() - Date.now()
    const expectedMs = 30 * 24 * 60 * 60 * 1000
    expect(deltaMs).toBeGreaterThan(expectedMs - 5000)
    expect(deltaMs).toBeLessThan(expectedMs + 5000)
  })

  it('sets expiresAt to null for permanent facts (expiresAfterDays null + registry default null)', async () => {
    mockCompleted([
      {
        factKey: 'dietary.restrictions',
        factValue: ['vegetarian'],
        confidence: 1.0,
        source: 'user_stated',
        expiresAfterDays: null,
      },
    ])
    mockUpsertBatch.mockResolvedValue([])

    await runMemoryAgent('user-1', makeInput())

    const batch = firstBatchArg()
    expect(batch?.[0]?.expiresAt).toBeNull()
  })

  it('falls back to the registry default expiry when the agent omits it (null) for an expiring key', async () => {
    mockCompleted([
      {
        factKey: 'budget.daily_food_target',
        factValue: 400,
        confidence: 1.0,
        source: 'user_stated',
        expiresAfterDays: null, // agent said null, but registry default for budget is 30
      },
    ])
    mockUpsertBatch.mockResolvedValue([])

    await runMemoryAgent('user-1', makeInput())

    const batch = firstBatchArg()
    const expiresAt = batch?.[0]?.expiresAt
    expect(expiresAt).toBeInstanceOf(Date)
    const deltaMs = (expiresAt as Date).getTime() - Date.now()
    expect(deltaMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000)
    expect(deltaMs).toBeLessThan(31 * 24 * 60 * 60 * 1000)
  })
})

// ── Batch writes ──────────────────────────────────────────────────────────────

describe('batch writes with multiple valid facts', () => {
  it('writes all valid facts in a single upsert batch', async () => {
    mockCompleted([
      {
        factKey: 'fitness.protein_target',
        factValue: 150,
        confidence: 1.0,
        source: 'user_stated',
        expiresAfterDays: 45,
      },
      {
        factKey: 'dietary.restrictions',
        factValue: ['vegetarian'],
        confidence: 1.0,
        source: 'user_stated',
        expiresAfterDays: null,
      },
      {
        factKey: 'pantry.staples',
        factValue: ['paneer', 'eggs', 'curd'],
        confidence: 0.8,
        source: 'clarification_answer',
        expiresAfterDays: 30,
      },
    ])
    mockUpsertBatch.mockResolvedValue([])

    await runMemoryAgent('user-1', makeInput())

    expect(mockUpsertBatch).toHaveBeenCalledOnce()
    expect(firstBatchArg()).toHaveLength(3)
  })

  it('rejects the whole output when any element has an invented key (strict array schema)', async () => {
    mockCompleted([
      {
        factKey: 'fitness.protein_target',
        factValue: 150,
        confidence: 1.0,
        source: 'user_stated',
        expiresAfterDays: 45,
      },
      {
        factKey: 'mood.current', // invalid key — fails zFactKey, invalidating the array
        factValue: 'happy',
        confidence: 0.4,
        source: 'behavior_inferred',
        expiresAfterDays: null,
      },
    ])

    await runMemoryAgent('user-1', makeInput())
    expect(mockUpsertBatch).not.toHaveBeenCalled()
  })
})

// ── Transport contract ────────────────────────────────────────────────────────

describe('lib/claude transport contract', () => {
  it('calls claudeRunMemoryAgent with a system message and a user message containing the situation', async () => {
    mockCompleted([])

    await runMemoryAgent('user-1', makeInput())

    expect(mockClaude).toHaveBeenCalledOnce()
    const call = mockClaude.mock.calls[0]
    const systemMessage = call?.[0] ?? ''
    const userMessage = call?.[1] ?? ''
    expect(systemMessage).toContain('Memory Agent')
    expect(systemMessage).toContain('dietary.restrictions')
    expect(userMessage).toContain('COMPLETED SITUATION')
    expect(userMessage).toContain('nutrition_goal')
    expect(userMessage).toContain('WHAT WAS EXECUTED')
  })
})
