/**
 * tests/agents/conversation.test.ts
 * Unit tests for the Conversation Agent (lib/agents/conversation.ts)
 *
 * Mocks:
 *   - @/lib/claude runConversationAgent — the LLM transport boundary.
 *     Everything else in lib/claude (fallback constants) stays real via
 *     importOriginal, so fallback-mapping assertions test the REAL constants.
 *   - Prompt loading is NOT mocked — docs/prompts/*.md are read from disk,
 *     so assembly assertions cover the live prompt files (M2 DoD: conversation.md
 *     "wired as the live prompt source").
 *
 * Test focus (docs/AGENTS.md §2 + §2.8 unit test hooks):
 *   1. System message assembly: system.md prefix + conversation section, no
 *      leaked {{variables}}, no user-message-template content
 *   2. User message: raw input verbatim, memory summary/null, previous type,
 *      derived current_date/current_time/day_of_week in the user's timezone
 *   3. Temporal derivation incl. timezone conversion across midnight
 *   4. Timeout → CONVERSATION_TIMEOUT_FALLBACK (confidence 30, 'agent_timeout')
 *   5. schema_failed / failed → transport fallback passthrough (confidence 20)
 *   6. Completed output passthrough, untouched
 *   7. 500-char input handled verbatim (never truncated by the agent)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// lib/claude statically imports lib/env, which validates ALL boot env vars at
// module load. Stub the full required set BEFORE the module graph loads.
process.env['DATABASE_URL'] ??= 'postgres://test:test@localhost:5432/test'
process.env['ANTHROPIC_API_KEY'] ??= 'test-key'
process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] ??= 'pk_test'
process.env['CLERK_SECRET_KEY'] ??= 'sk_test'
process.env['YOUTUBE_API_KEY'] ??= 'yt_test'
process.env['SWIGGY_MCP_MODE'] ??= 'mock'

vi.mock('@/lib/claude', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/claude')>()
  return { ...actual, runConversationAgent: vi.fn() }
})

const { runConversationAgent, buildConversationUserMessage, deriveTemporalContext } =
  await import('@/lib/agents/conversation')
const {
  runConversationAgent: claudeRunConversationAgent,
  CONVERSATION_FALLBACK,
  CONVERSATION_TIMEOUT_FALLBACK,
} = await import('@/lib/claude')

import type { ConversationAgentInput } from '@/types/agents'
import type { ExtractedContextValidated } from '@/lib/schemas/agents'

const mockTransport = vi.mocked(claudeRunConversationAgent)

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<ConversationAgentInput> = {}): ConversationAgentInput {
  return {
    rawInput: "I'm sick and home alone",
    timestamp: '2026-07-07T19:45:00+05:30' as ConversationAgentInput['timestamp'],
    userTimezone: 'Asia/Kolkata' as ConversationAgentInput['userTimezone'],
    userMemorySummary: 'Vegetarian, daily food budget Rs 350, home in Bandra',
    sessionSituationCount: 0,
    ...overrides,
  }
}

const VALID_OUTPUT: ExtractedContextValidated = {
  situationType: 'sick',
  explicit: { sick: true, alone: true },
  inferred: { timeOfDay: 'dinner', isWeekend: false },
  confidence: 85,
  missingRequired: ['canCook'],
  missingSoft: ['craving'],
  ambiguities: [],
  nonFoodInput: false,
}

type TransportResult = Awaited<ReturnType<typeof claudeRunConversationAgent>>

function mockTransportResult(partial: Partial<TransportResult>): void {
  mockTransport.mockResolvedValue({
    output: VALID_OUTPUT,
    status: 'completed',
    latencyMs: 640,
    inputTokens: 300,
    outputTokens: 190,
    attempts: 1,
    ...partial,
  } as TransportResult)
}

function sentSystemMessage(): string {
  return mockTransport.mock.calls[0]?.[0] ?? ''
}

function sentUserMessage(): string {
  return mockTransport.mock.calls[0]?.[1] ?? ''
}

// ── deriveTemporalContext ─────────────────────────────────────────────────────

describe('deriveTemporalContext', () => {
  it('derives date, 24h time, and day name in the given timezone', () => {
    const t = deriveTemporalContext('2026-07-07T19:45:00+05:30', 'Asia/Kolkata')
    expect(t.currentDate).toBe('2026-07-07')
    expect(t.currentTime).toBe('19:45')
    expect(t.dayOfWeek).toBe('Tuesday')
  })

  it('converts a UTC instant into the user-local date across midnight', () => {
    // 18:45 UTC = 00:15 IST the NEXT day
    const t = deriveTemporalContext('2026-07-07T18:45:00Z', 'Asia/Kolkata')
    expect(t.currentDate).toBe('2026-07-08')
    expect(t.currentTime).toBe('00:15')
    expect(t.dayOfWeek).toBe('Wednesday')
  })

  it('identifies a weekend day correctly', () => {
    const t = deriveTemporalContext('2026-07-11T13:00:00+05:30', 'Asia/Kolkata')
    expect(t.dayOfWeek).toBe('Saturday')
  })
})

// ── buildConversationUserMessage ──────────────────────────────────────────────

describe('buildConversationUserMessage', () => {
  it('injects the raw input verbatim — never cleaned or trimmed', () => {
    const raw = '  bhukh lagi hai!!   '
    const msg = buildConversationUserMessage(makeInput({ rawInput: raw }))
    expect(msg).toContain(`USER INPUT: ${raw}`)
  })

  it('injects the memory summary when present', () => {
    const msg = buildConversationUserMessage(makeInput())
    expect(msg).toContain('Vegetarian, daily food budget Rs 350')
  })

  it('injects the literal string null for a first-time user (no memory)', () => {
    const msg = buildConversationUserMessage(makeInput({ userMemorySummary: null }))
    expect(msg).toMatch(/USER MEMORY SUMMARY:\s*\nnull/)
  })

  it('injects the previous situation type when present', () => {
    const msg = buildConversationUserMessage(
      makeInput({ previousSituationType: 'quick_meal' })
    )
    expect(msg).toContain('PREVIOUS SITUATION TYPE (if known): quick_meal')
  })

  it('injects null when there is no previous situation type', () => {
    const msg = buildConversationUserMessage(makeInput())
    expect(msg).toContain('PREVIOUS SITUATION TYPE (if known): null')
  })

  it('injects derived datetime values in the user timezone', () => {
    const msg = buildConversationUserMessage(makeInput())
    expect(msg).toContain('CURRENT DATETIME: 2026-07-07 19:45 Tuesday')
  })

  it('leaves no unreplaced {{variables}}', () => {
    const msg = buildConversationUserMessage(makeInput())
    expect(msg).not.toContain('{{')
  })

  it('handles a 500-character input without truncation', () => {
    const raw = 'x'.repeat(500)
    const msg = buildConversationUserMessage(makeInput({ rawInput: raw }))
    expect(msg).toContain(raw)
  })
})

// ── runConversationAgent — prompt assembly ────────────────────────────────────

describe('runConversationAgent — prompt assembly', () => {
  it('sends a system message assembled from system.md + conversation.md', async () => {
    mockTransportResult({})
    await runConversationAgent(makeInput())

    const system = sentSystemMessage()
    // system.md prefix: the shared identity block
    expect(system).toContain('reasoning core of MealOS')
    // conversation.md system section content
    expect(system).toContain('Situation Types')
  })

  it('system message contains no user-message template content', async () => {
    mockTransportResult({})
    await runConversationAgent(makeInput())

    // The system prompt may MENTION `{{raw_input}}` in prose (extraction rules
    // refer to the user-message field by its variable name) — what must never
    // leak is the template itself or its section.
    const system = sentSystemMessage()
    expect(system).not.toContain('USER INPUT: {{raw_input}}')
    expect(system).not.toContain('USER MESSAGE TEMPLATE')
  })

  it('sends the fully injected user message', async () => {
    mockTransportResult({})
    await runConversationAgent(makeInput())

    const user = sentUserMessage()
    expect(user).toContain("USER INPUT: I'm sick and home alone")
    expect(user).toContain('CURRENT DATETIME: 2026-07-07 19:45 Tuesday')
    expect(user).not.toContain('{{')
  })
})

// ── runConversationAgent — status → fallback mapping ──────────────────────────

describe('runConversationAgent — result handling', () => {
  it('passes a completed output through unchanged', async () => {
    mockTransportResult({})
    const result = await runConversationAgent(makeInput())

    expect(result.status).toBe('completed')
    expect(result.output).toEqual(VALID_OUTPUT)
    expect(result.latencyMs).toBe(640)
    expect(result.attempts).toBe(1)
  })

  it('maps timeout status to the distinct TIMEOUT fallback (confidence 30, agent_timeout)', async () => {
    mockTransportResult({
      output: CONVERSATION_FALLBACK,   // transport returns the generic fallback
      status: 'timeout',
      error: 'Agent call exceeded 3000ms timeout',
    })
    const result = await runConversationAgent(makeInput())

    expect(result.status).toBe('timeout')
    expect(result.output).toEqual(CONVERSATION_TIMEOUT_FALLBACK)
    expect(result.output.confidence).toBe(30)
    expect(result.output.ambiguities).toContain('agent_timeout')
  })

  it('keeps the schema fallback on schema_failed (confidence 20, schema_failure)', async () => {
    mockTransportResult({
      output: CONVERSATION_FALLBACK,
      status: 'schema_failed',
      error: 'invalid JSON',
    })
    const result = await runConversationAgent(makeInput())

    expect(result.status).toBe('schema_failed')
    expect(result.output).toEqual(CONVERSATION_FALLBACK)
    expect(result.output.confidence).toBe(20)
    expect(result.output.ambiguities).toContain('schema_failure')
  })

  it('keeps the schema fallback on failed (model refusal — never retried here)', async () => {
    mockTransportResult({
      output: CONVERSATION_FALLBACK,
      status: 'failed',
      error: 'model_refusal',
    })
    const result = await runConversationAgent(makeInput())

    expect(result.status).toBe('failed')
    expect(result.output).toEqual(CONVERSATION_FALLBACK)
  })

  it('calls the transport exactly once per run (retries live inside lib/claude)', async () => {
    mockTransportResult({})
    await runConversationAgent(makeInput())
    expect(mockTransport).toHaveBeenCalledTimes(1)
  })
})
