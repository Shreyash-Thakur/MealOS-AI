/**
 * tests/agents/clarification.test.ts
 * Unit tests for the Clarification Engine (lib/agents/clarification.ts)
 *
 * The Clarification Engine is a pipeline stage, not a fifth agent
 * (IMPLEMENTATION_PLAYBOOK §9 item 2): deterministic gap analysis against the
 * required-fields registry + a Haiku call for question PHRASING only.
 *
 * Mocks:
 *   - @/lib/claude runClarificationEngine — the LLM transport boundary.
 *     All deterministic logic (memory resolution, budget bands, priority
 *     capping, evoi sorting, id assignment) is tested against real code.
 *
 * Test focus (M3 DoD + ISSUE-062/065/066/067/068):
 *   1. Confidence bands: 100 → 0 questions; 75–99 → 1; 50–74 → 2; <50 → 3
 *   2. Memory check: memory-known fields never asked (ISSUE-067)
 *   3. Max-3 cap with registry-priority ordering (ISSUE-065)
 *   4. Second-pass semantics + defaults for exhausted fields (ISSUE-068)
 *   5. Assumption generation for memory-resolved fields (ISSUE-066)
 *   6. LLM post-processing: evoi sort, id assignment, known-field filtering
 *   7. LLM failure → empty questions, assumptions preserved (assume-and-go)
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
  return { ...actual, runClarificationEngine: vi.fn() }
})

const {
  runClarificationEngine,
  resolveFromMemory,
  questionBudget,
  prioritizeFields,
  getAssumedDefaults,
  MEMORY_TO_CONTEXT_MAP,
} = await import('@/lib/agents/clarification')
const { runClarificationEngine: claudeRunClarificationEngine } =
  await import('@/lib/claude')

import type { ClarificationEngineInput } from '@/lib/agents/clarification'

const mockTransport = vi.mocked(claudeRunClarificationEngine)

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<ClarificationEngineInput> = {}): ClarificationEngineInput {
  return {
    situationType: 'sick',
    missingRequired: ['canCook', 'alone'],
    missingSoft: ['craving'],
    knownContext: { sick: true },
    memoryFacts: {},
    userMemorySummary: null,
    confidence: 60,
    passNumber: 1,
    ...overrides,
  }
}

type TransportResult = Awaited<ReturnType<typeof claudeRunClarificationEngine>>

function llmQuestion(field: string, evoi: 'high' | 'medium' | 'low', text?: string) {
  return {
    text: text ?? `Question about ${field} for your situation?`,
    field,
    type: 'single_choice' as const,
    options: [
      { label: 'Option one', value: true },
      { label: 'Option two', value: false },
      { label: 'Something else', value: 'freetext' },
    ],
    required: true,
    evoi,
  }
}

function mockLLM(questions: unknown[], assumptions: unknown[] = []): void {
  mockTransport.mockResolvedValue({
    output: { questions, assumptions },
    status: 'completed',
    latencyMs: 420,
    inputTokens: 350,
    outputTokens: 180,
    attempts: 1,
  } as unknown as TransportResult)
}

function mockLLMFailure(status: 'schema_failed' | 'timeout' | 'failed'): void {
  mockTransport.mockResolvedValue({
    output: { questions: [], assumptions: [] },
    status,
    latencyMs: 3000,
    inputTokens: 0,
    outputTokens: 0,
    attempts: 1,
    error: 'boom',
  } as unknown as TransportResult)
}

// ── questionBudget — confidence bands (M3 DoD) ────────────────────────────────

describe('questionBudget — confidence bands', () => {
  it('100% confidence → 0 questions', () => {
    expect(questionBudget(100)).toBe(0)
  })

  it('75–99 → 1 question', () => {
    expect(questionBudget(99)).toBe(1)
    expect(questionBudget(75)).toBe(1)
  })

  it('50–74 → 2 questions', () => {
    expect(questionBudget(74)).toBe(2)
    expect(questionBudget(50)).toBe(2)
  })

  it('below 50 → 3 questions, then assume', () => {
    expect(questionBudget(49)).toBe(3)
    expect(questionBudget(0)).toBe(3)
  })
})

// ── resolveFromMemory (ISSUE-067) ─────────────────────────────────────────────

describe('resolveFromMemory — memory check before question generation', () => {
  it('resolves budget from budget.daily_food_target', () => {
    const { stillMissing, resolved } = resolveFromMemory(
      ['budget', 'canCook'],
      { 'budget.daily_food_target': 350 }
    )
    expect(stillMissing).toEqual(['canCook'])
    expect(resolved).toEqual([
      { field: 'budget', value: 350, source: 'memory' },
    ])
  })

  it('resolves canCook from cooking.can_cook', () => {
    const { stillMissing, resolved } = resolveFromMemory(
      ['canCook', 'alone'],
      { 'cooking.can_cook': true }
    )
    expect(stillMissing).toEqual(['alone'])
    expect(resolved[0]).toMatchObject({ field: 'canCook', value: true })
  })

  it('resolves nutritionGoal.protein from fitness.protein_target', () => {
    const { stillMissing, resolved } = resolveFromMemory(
      ['nutritionGoal.protein'],
      { 'fitness.protein_target': 150 }
    )
    expect(stillMissing).toEqual([])
    expect(resolved[0]).toMatchObject({ field: 'nutritionGoal.protein', value: 150 })
  })

  it('never resolves situational fields (alone) from memory', () => {
    expect(MEMORY_TO_CONTEXT_MAP).not.toHaveProperty('alone')
    const { stillMissing, resolved } = resolveFromMemory(
      ['alone'],
      { 'household.size': 3 }
    )
    expect(stillMissing).toEqual(['alone'])
    expect(resolved).toEqual([])
  })

  it('returns everything as missing when no facts exist', () => {
    const { stillMissing, resolved } = resolveFromMemory(['budget', 'canCook'], {})
    expect(stillMissing).toEqual(['budget', 'canCook'])
    expect(resolved).toEqual([])
  })
})

// ── prioritizeFields (ISSUE-065) ──────────────────────────────────────────────

describe('prioritizeFields — registry-order priority', () => {
  it('orders fields by their position in the REQUIRED_FIELDS registry', () => {
    // sick registry order: canCook, alone
    expect(prioritizeFields('sick', ['alone', 'canCook'])).toEqual(['canCook', 'alone'])
  })

  it('appends non-registry (soft) fields after registry fields, stable', () => {
    expect(prioritizeFields('sick', ['craving', 'alone', 'location'])).toEqual([
      'alone', 'craving', 'location',
    ])
  })
})

// ── getAssumedDefaults (ISSUE-068) ────────────────────────────────────────────

describe('getAssumedDefaults — pass-2 exhaustion defaults', () => {
  it('provides a default assumption for every defaultable required field', () => {
    const defaults = getAssumedDefaults(['budget', 'canCook'])
    expect(defaults).toHaveLength(2)
    const budget = defaults.find((a) => a.field === 'budget')
    expect(budget?.source).toBe('inference')
    expect(typeof budget?.value).toBe('number')
  })

  it('skips fields with no sane default (nutrition targets)', () => {
    const defaults = getAssumedDefaults(['nutritionGoal.protein'])
    expect(defaults).toEqual([])
  })
})

// ── runClarificationEngine — skip paths ───────────────────────────────────────

describe('runClarificationEngine — skip paths (no LLM call)', () => {
  it('skips entirely when all required fields resolve from memory (ISSUE-067)', async () => {
    const result = await runClarificationEngine(makeInput({
      situationType: 'broke',
      missingRequired: ['budget', 'canCook'],
      missingSoft: [],
      memoryFacts: { 'budget.daily_food_target': 250, 'cooking.can_cook': true },
    }))

    expect(mockTransport).not.toHaveBeenCalled()
    expect(result.status).toBe('skipped')
    expect(result.questions).toEqual([])
    expect(result.assumptions).toHaveLength(2)
    expect(result.assumptions.map((a) => a.field).sort()).toEqual(['budget', 'canCook'])
  })

  it('asks zero questions at 100% confidence regardless of soft gaps', async () => {
    const result = await runClarificationEngine(makeInput({
      confidence: 100,
      missingRequired: [],
      missingSoft: ['craving', 'location'],
    }))

    expect(mockTransport).not.toHaveBeenCalled()
    expect(result.status).toBe('skipped')
    expect(result.questions).toEqual([])
  })

  it('skips when nothing is missing at all', async () => {
    const result = await runClarificationEngine(makeInput({
      missingRequired: [],
      missingSoft: [],
      confidence: 85,
    }))

    expect(mockTransport).not.toHaveBeenCalled()
    expect(result.questions).toEqual([])
  })
})

// ── runClarificationEngine — question generation ──────────────────────────────

describe('runClarificationEngine — question generation', () => {
  it('asks the LLM only about fields that survived the memory check', async () => {
    mockLLM([llmQuestion('alone', 'high')])

    await runClarificationEngine(makeInput({
      memoryFacts: { 'cooking.can_cook': true },   // resolves canCook
      confidence: 60,
    }))

    expect(mockTransport).toHaveBeenCalledTimes(1)
    const userMessage = mockTransport.mock.calls[0]?.[1] ?? ''
    expect(userMessage).toContain('alone')
    expect(userMessage).not.toMatch(/"field":\s*"canCook"/)
  })

  it('injects situation type, known context, and memory summary into the user message', async () => {
    mockLLM([llmQuestion('canCook', 'high')])

    await runClarificationEngine(makeInput({
      userMemorySummary: 'Vegetarian, budget Rs 350',
      confidence: 60,
    }))

    const userMessage = mockTransport.mock.calls[0]?.[1] ?? ''
    expect(userMessage).toContain('SITUATION TYPE: sick')
    expect(userMessage).toContain('Vegetarian, budget Rs 350')
    expect(userMessage).toContain('"sick": true')
    expect(userMessage).not.toContain('{{')
  })

  it('caps questions at the confidence-band budget (confidence 80 → 1 question)', async () => {
    mockLLM([llmQuestion('canCook', 'high'), llmQuestion('alone', 'medium')])

    const result = await runClarificationEngine(makeInput({ confidence: 80 }))

    expect(result.questions).toHaveLength(1)
    expect(result.questions[0]?.field).toBe('canCook')
  })

  it('never returns more than 3 questions even when the LLM over-generates (ISSUE-065)', async () => {
    mockLLM([
      llmQuestion('guests', 'high'),
      llmQuestion('budget', 'high'),
      llmQuestion('occasion', 'medium'),
      llmQuestion('craving', 'medium'),
      llmQuestion('location', 'low'),
    ])

    const result = await runClarificationEngine(makeInput({
      situationType: 'party_hosting',
      missingRequired: ['guests', 'budget'],
      missingSoft: ['occasion', 'craving', 'location'],
      confidence: 20,
    }))

    expect(result.questions.length).toBeLessThanOrEqual(3)
  })

  it('sorts questions by EVOI descending before capping', async () => {
    mockLLM([
      llmQuestion('craving', 'low'),
      llmQuestion('canCook', 'high'),
      llmQuestion('alone', 'medium'),
    ])

    const result = await runClarificationEngine(makeInput({ confidence: 30 }))

    expect(result.questions.map((q) => q.field)).toEqual(['canCook', 'alone', 'craving'])
  })

  it('assigns sequential ids q1..qN after sorting', async () => {
    mockLLM([
      llmQuestion('craving', 'low'),
      llmQuestion('canCook', 'high'),
    ])

    const result = await runClarificationEngine(makeInput({ confidence: 30 }))

    expect(result.questions.map((q) => q.id)).toEqual(['q1', 'q2'])
    expect(result.questions[0]?.field).toBe('canCook')
  })

  it('maps the LLM number_input type to the domain number type', async () => {
    mockLLM([{
      ...llmQuestion('budget', 'high'),
      type: 'number_input',
      options: [
        { label: 'Under Rs 150', value: 150 },
        { label: 'Rs 150-300', value: 300 },
        { label: 'Something else', value: 'freetext' },
      ],
    }])

    const result = await runClarificationEngine(makeInput({
      situationType: 'broke',
      missingRequired: ['budget', 'canCook'],
      confidence: 60,
    }))

    expect(result.questions[0]?.type).toBe('number')
  })

  it('drops LLM questions about fields already known or memory-resolved', async () => {
    mockLLM([
      llmQuestion('canCook', 'high'),
      llmQuestion('sick', 'medium'),        // already in knownContext — must drop
    ])

    const result = await runClarificationEngine(makeInput({ confidence: 30 }))

    expect(result.questions.map((q) => q.field)).toEqual(['canCook'])
  })

  it('passes through LLM assumption statements', async () => {
    mockLLM(
      [llmQuestion('canCook', 'high')],
      [{
        text: 'Assuming your usual budget of around Rs 350 — is that right?',
        fields: ['budget'],
        values: { budget: 350 },
        confirmable: true,
      }]
    )

    const result = await runClarificationEngine(makeInput({
      memoryFacts: { 'budget.daily_food_target': 350 },
      missingRequired: ['canCook'],
      missingSoft: ['budget'],
      confidence: 60,
    }))

    expect(result.assumptionStatements).toHaveLength(1)
    expect(result.assumptionStatements[0]?.text).toContain('Rs 350')
  })
})

// ── runClarificationEngine — second pass (ISSUE-068) ──────────────────────────

describe('runClarificationEngine — second pass', () => {
  it('pass 2 asks only remaining required fields, never soft fields', async () => {
    mockLLM([llmQuestion('alone', 'high')])

    await runClarificationEngine(makeInput({
      passNumber: 2,
      missingRequired: ['alone'],
      missingSoft: ['craving', 'location'],
      confidence: 40,
    }))

    const userMessage = mockTransport.mock.calls[0]?.[1] ?? ''
    expect(userMessage).not.toMatch(/"field":\s*"craving"/)
    expect(userMessage).not.toMatch(/"field":\s*"location"/)
  })

  it('rejects a pass number greater than 2 (max-2-passes contract)', async () => {
    await expect(
      runClarificationEngine(makeInput({ passNumber: 3 as never }))
    ).rejects.toThrow(/pass/i)
  })
})

// ── runClarificationEngine — LLM failure (assume-and-go) ─────────────────────

describe('runClarificationEngine — LLM failure handling', () => {
  it('returns empty questions but keeps memory assumptions on schema failure', async () => {
    mockLLMFailure('schema_failed')

    const result = await runClarificationEngine(makeInput({
      memoryFacts: { 'budget.daily_food_target': 300 },
      missingRequired: ['budget', 'canCook'],
      confidence: 60,
    }))

    expect(result.status).toBe('schema_failed')
    expect(result.questions).toEqual([])
    expect(result.assumptions).toHaveLength(1)
    expect(result.assumptions[0]?.field).toBe('budget')
  })

  it('never throws on transport failure', async () => {
    mockLLMFailure('timeout')
    await expect(runClarificationEngine(makeInput())).resolves.toBeDefined()
  })
})
