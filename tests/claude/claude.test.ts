/**
 * Tests for lib/claude.ts
 *
 * All Anthropic SDK calls are MOCKED (via the _setAnthropicClient test hook) —
 * no live API calls anywhere in this suite.
 *
 * Coverage:
 *  - parseAndValidate: valid JSON, invalid JSON, schema mismatch, intolerant-parser rule
 *  - callWithTimeout: resolves before timeout, sentinel fires (LLM_TIMEOUT)
 *  - callStructured: success, fail-fast schema failure, Conversation re-ask path
 *  - runStructured: completed, schema-failed short-circuit, retry exhaustion
 *  - Per-agent config table matches docs/AGENTS.md §2.1/§3.1/§4.1/§5.1
 *  - makeCacheableSystemBlock: prompt-caching block shape
 *  - Real MealOS schemas: ExtractedContext / MemoryAgentOutput fixtures
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { z } from 'zod'
import type Anthropic from '@anthropic-ai/sdk'

// lib/claude.ts statically imports lib/env.ts, which validates ALL boot env
// vars at module load. Stub the full required set BEFORE importing the module
// (dynamic import below), so this suite runs without a real .env.
process.env['DATABASE_URL'] ??= 'postgres://test:test@localhost:5432/test'
process.env['ANTHROPIC_API_KEY'] ??= 'test-key'
process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] ??= 'pk_test'
process.env['CLERK_SECRET_KEY'] ??= 'sk_test'
process.env['YOUTUBE_API_KEY'] ??= 'yt_test'
process.env['SWIGGY_MCP_MODE'] ??= 'mock'

const {
  parseAndValidate,
  callWithTimeout,
  makeCacheableSystemBlock,
  extractTextContent,
  callStructured,
  runStructured,
  runClarificationEngine,
  CONVERSATION_CONFIG,
  PLANNING_CONFIG,
  TOOL_CONFIG,
  MEMORY_CONFIG,
  CLARIFICATION_CONFIG,
  AGENT_CONFIGS,
  CONVERSATION_FALLBACK,
  CONVERSATION_TIMEOUT_FALLBACK,
  PLANNING_FALLBACK,
  TOOL_FALLBACK,
  MEMORY_FALLBACK,
  _setAnthropicClient,
  _resetAnthropicClient,
} = await import('@/lib/claude')

const {
  ExtractedContextSchema,
  MemoryAgentOutputSchema,
  PlanningAgentOutputSchema,
  ToolAgentOutputSchema,
} = await import('@/lib/schemas')

const { AppError } = await import('@/lib/errors')

// ── Mock Anthropic client factories ───────────────────────────────────────────

/** Mock client that always returns the given text content. */
function makeMockClient(responseText: string): Anthropic {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: responseText }],
        model: 'claude-haiku-4-5',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    },
  } as unknown as Anthropic
}

/** Mock client that returns different text per successive call. */
function makeSequenceClient(texts: string[]): { client: Anthropic; calls: () => number } {
  let callCount = 0
  const client = {
    messages: {
      create: vi.fn().mockImplementation(() => {
        const text = texts[Math.min(callCount, texts.length - 1)] ?? ''
        callCount++
        return Promise.resolve({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text }],
          model: 'claude-haiku-4-5',
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 50 },
        })
      }),
    },
  } as unknown as Anthropic
  return { client, calls: () => callCount }
}

/** Mock client whose create() always rejects with the given error. */
function makeErrorClient(error: Error): Anthropic {
  return {
    messages: {
      create: vi.fn().mockRejectedValue(error),
    },
  } as unknown as Anthropic
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VALID_EXTRACTED_CONTEXT = {
  situationType: 'sick',
  explicit: { sick: true },
  inferred: { timeOfDay: 'dinner', isWeekend: false },
  confidence: 85,
  missingRequired: ['canCook', 'alone'],
  missingSoft: ['craving'],
  ambiguities: [],
  nonFoodInput: false,
}

// ── parseAndValidate ──────────────────────────────────────────────────────────

describe('parseAndValidate', () => {
  const SimpleSchema = z.object({ name: z.string(), age: z.number().int() }).strict()

  it('succeeds with valid JSON matching the schema', () => {
    const result = parseAndValidate('{"name":"Alice","age":30}', SimpleSchema)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.name).toBe('Alice')
      expect(result.data.age).toBe(30)
    }
  })

  it('fails when first character is not { or [ (AP-3 intolerant parser)', () => {
    const result = parseAndValidate('Here is the JSON: {"name":"Bob"}', SimpleSchema)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toContain('json_parse_failed')
  })

  it('fails on markdown-fenced JSON (no fence tolerance)', () => {
    const result = parseAndValidate('```json\n{"name":"Bob","age":1}\n```', SimpleSchema)
    expect(result.success).toBe(false)
  })

  it('fails on malformed JSON', () => {
    const result = parseAndValidate('{"name": "Bob", "age": }', SimpleSchema)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toContain('json_parse_failed')
  })

  it('fails when schema does not match (extra field with .strict())', () => {
    const result = parseAndValidate('{"name":"Carol","age":25,"extra":"x"}', SimpleSchema)
    expect(result.success).toBe(false)
  })

  it('fails when a required field is missing', () => {
    const result = parseAndValidate('{"name":"Dave"}', SimpleSchema)
    expect(result.success).toBe(false)
  })

  it('succeeds with a valid JSON array', () => {
    const ArraySchema = z.array(z.string())
    const result = parseAndValidate('["a","b","c"]', ArraySchema)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toEqual(['a', 'b', 'c'])
  })

  it('succeeds with empty array (MemoryAgent normal output)', () => {
    const result = parseAndValidate('[]', MemoryAgentOutputSchema)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toEqual([])
  })

  it('handles whitespace-padded valid JSON (trim before first-char check)', () => {
    const result = parseAndValidate('  {"name":"Eve","age":22}', SimpleSchema)
    expect(result.success).toBe(true)
  })
})

// ── extractTextContent ────────────────────────────────────────────────────────

describe('extractTextContent', () => {
  it('extracts text from a text block', () => {
    const message = {
      content: [{ type: 'text' as const, text: '{"ok":true}' }],
      stop_reason: 'end_turn',
    } as unknown as Anthropic.Message
    expect(extractTextContent(message)).toBe('{"ok":true}')
  })

  it('throws AppError when no text block is present (model refusal path)', () => {
    const message = {
      content: [],
      stop_reason: 'end_turn',
    } as unknown as Anthropic.Message
    expect(() => extractTextContent(message)).toThrow('no text content block')
  })
})

// ── callWithTimeout ───────────────────────────────────────────────────────────

describe('callWithTimeout', () => {
  it('resolves when the API call completes before the timeout', async () => {
    const result = await callWithTimeout(Promise.resolve(42), 5000)
    expect(result).toBe(42)
  })

  it('rejects with LLM_TIMEOUT AppError when the sentinel fires first', async () => {
    const slowPromise = new Promise<never>(() => { /* never settles */ })
    await expect(callWithTimeout(slowPromise, 10)).rejects.toMatchObject({
      code: 'LLM_TIMEOUT',
    })
  }, 2000)
})

// ── makeCacheableSystemBlock ──────────────────────────────────────────────────

describe('makeCacheableSystemBlock (PROMPT_ENGINEERING_GUIDE §6)', () => {
  it('produces a text block with ephemeral cache_control', () => {
    const block = makeCacheableSystemBlock('System prompt text')
    expect(block.type).toBe('text')
    expect(block.text).toBe('System prompt text')
    expect(block.cache_control).toEqual({ type: 'ephemeral' })
  })
})

// ── callStructured — success path ─────────────────────────────────────────────

describe('callStructured — success path', () => {
  beforeEach(() => _resetAnthropicClient())

  it('returns completed on first attempt with valid output', async () => {
    _setAnthropicClient(makeMockClient(JSON.stringify(VALID_EXTRACTED_CONTEXT)))

    const result = await callStructured({
      agentName: 'ConversationAgent',
      systemMessage: 'system',
      userMessage: 'user',
      schema: ExtractedContextSchema,
      fallbackOutput: CONVERSATION_FALLBACK,
      allowSchemaReAsk: true,
    })

    expect(result.status).toBe('completed')
    expect(result.attempts).toBe(1)
    expect(result.output.situationType).toBe('sick')
    expect(result.inputTokens).toBe(100)
    expect(result.outputTokens).toBe(50)
  })

  it('passes the agent model, max_tokens, and caching block to the SDK', async () => {
    const client = makeMockClient(JSON.stringify(VALID_EXTRACTED_CONTEXT))
    _setAnthropicClient(client)

    await callStructured({
      agentName: 'ConversationAgent',
      systemMessage: 'sys',
      userMessage: 'usr',
      schema: ExtractedContextSchema,
      fallbackOutput: CONVERSATION_FALLBACK,
    })

    const createMock = (client as unknown as { messages: { create: ReturnType<typeof vi.fn> } })
      .messages.create
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5',
        max_tokens: 800,
        system: [expect.objectContaining({ cache_control: { type: 'ephemeral' } })],
      })
    )
  })
})

// ── callStructured — schema failure, fail-fast (non-Conversation agents) ──────

describe('callStructured — schema failure fail-fast (AGENTS.md §1.2)', () => {
  beforeEach(() => _resetAnthropicClient())

  it('returns schema_failed after ONE attempt for Planning Agent (no re-ask)', async () => {
    const { client, calls } = makeSequenceClient(['invalid prose output'])
    _setAnthropicClient(client)

    const result = await callStructured({
      agentName: 'PlanningAgent',
      systemMessage: 'system',
      userMessage: 'user',
      schema: PlanningAgentOutputSchema,
      fallbackOutput: PLANNING_FALLBACK,
      allowSchemaReAsk: false,
    })

    expect(result.status).toBe('schema_failed')
    expect(result.attempts).toBe(1)
    expect(calls()).toBe(1)          // exactly one API call — no silent retries
    expect(result.output).toEqual(PLANNING_FALLBACK)
  })

  it('returns schema_failed for Tool Agent on markdown-wrapped output', async () => {
    _setAnthropicClient(makeMockClient('```json\n{"oops":"wrapped"}\n```'))

    const result = await callStructured({
      agentName: 'ToolAgent',
      systemMessage: 'system',
      userMessage: 'user',
      schema: ToolAgentOutputSchema,
      fallbackOutput: TOOL_FALLBACK,
      allowSchemaReAsk: false,
    })

    expect(result.status).toBe('schema_failed')
    expect(result.output).toEqual(TOOL_FALLBACK)
  })

  it('returns schema_failed for Memory Agent on prose-prefixed output', async () => {
    _setAnthropicClient(makeMockClient('Here are the facts: []'))

    const result = await callStructured({
      agentName: 'MemoryAgent',
      systemMessage: 'system',
      userMessage: 'user',
      schema: MemoryAgentOutputSchema,
      fallbackOutput: MEMORY_FALLBACK,
      allowSchemaReAsk: false,
    })

    expect(result.status).toBe('schema_failed')
    expect(result.output).toEqual([])
  })
})

// ── callStructured — Conversation Agent re-ask path ───────────────────────────

describe('callStructured — Conversation re-ask (AGENTS.md §2.5 FM2)', () => {
  beforeEach(() => _resetAnthropicClient())

  it('succeeds on the re-ask when the first attempt is invalid', async () => {
    const { client, calls } = makeSequenceClient([
      'prose response, not JSON',
      JSON.stringify(VALID_EXTRACTED_CONTEXT),
    ])
    _setAnthropicClient(client)

    const result = await callStructured({
      agentName: 'ConversationAgent',
      systemMessage: 'system',
      userMessage: 'user',
      schema: ExtractedContextSchema,
      fallbackOutput: CONVERSATION_FALLBACK,
      allowSchemaReAsk: true,
    })

    expect(result.status).toBe('completed')
    expect(result.attempts).toBe(2)
    expect(calls()).toBe(2)
    expect(result.output.situationType).toBe('sick')
  })

  it('appends the stricter suffix to the system message on the re-ask', async () => {
    const { client } = makeSequenceClient([
      'not json',
      JSON.stringify(VALID_EXTRACTED_CONTEXT),
    ])
    _setAnthropicClient(client)

    await callStructured({
      agentName: 'ConversationAgent',
      systemMessage: 'BASE_SYSTEM',
      userMessage: 'user',
      schema: ExtractedContextSchema,
      fallbackOutput: CONVERSATION_FALLBACK,
      allowSchemaReAsk: true,
    })

    const createMock = (client as unknown as { messages: { create: ReturnType<typeof vi.fn> } })
      .messages.create
    const secondCallArgs = createMock.mock.calls[1]?.[0] as {
      system: { text: string }[]
    }
    expect(secondCallArgs.system[0]?.text).toContain('BASE_SYSTEM')
    expect(secondCallArgs.system[0]?.text).toContain('was not valid JSON')
  })

  it('returns schema_failed with the fallback after the re-ask also fails', async () => {
    _setAnthropicClient(makeMockClient('never valid json'))

    const result = await callStructured({
      agentName: 'ConversationAgent',
      systemMessage: 'system',
      userMessage: 'user',
      schema: ExtractedContextSchema,
      fallbackOutput: CONVERSATION_FALLBACK,
      allowSchemaReAsk: true,
    })

    expect(result.status).toBe('schema_failed')
    expect(result.attempts).toBe(2)
    expect(result.output).toEqual(CONVERSATION_FALLBACK)
    expect(result.error).toBeDefined()
  })
})

// ── runStructured ─────────────────────────────────────────────────────────────

describe('runStructured — retry loop and AgentRunResult shape', () => {
  beforeEach(() => _resetAnthropicClient())

  it('returns completed AgentRunResult when the API succeeds', async () => {
    _setAnthropicClient(makeMockClient('[]'))

    const result = await runStructured({
      agentName: 'MemoryAgent',
      systemMessage: 'system',
      userMessage: 'user',
      schema: MemoryAgentOutputSchema,
      fallbackOutput: MEMORY_FALLBACK,
      allowSchemaReAsk: false,
    })

    expect(result.status).toBe('completed')
    expect(result.output).toEqual([])
    expect(result.attempts).toBe(1)
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(result.inputTokens).toBe(100)
    expect(result.outputTokens).toBe(50)
  })

  it('short-circuits to fallback on schema failure without retrying', async () => {
    const { client, calls } = makeSequenceClient(['garbage output'])
    _setAnthropicClient(client)

    const result = await runStructured({
      agentName: 'PlanningAgent',
      systemMessage: 'system',
      userMessage: 'user',
      schema: PlanningAgentOutputSchema,
      fallbackOutput: PLANNING_FALLBACK,
      allowSchemaReAsk: false,
    })

    expect(result.status).toBe('schema_failed')
    expect(result.output).toEqual(PLANNING_FALLBACK)
    expect(calls()).toBe(1)          // schema failure is NEVER retried
    expect(result.error).toBeDefined()
  })

  it('retries on timeout and returns timeout status after exhaustion', async () => {
    const timeoutError = new AppError('LLM_TIMEOUT', 'Agent call exceeded timeout')
    const client = makeErrorClient(timeoutError)
    _setAnthropicClient(client)

    const result = await runStructured({
      agentName: 'PlanningAgent',      // maxRetries: 1, retryOn: ['timeout']
      systemMessage: 'system',
      userMessage: 'user',
      schema: PlanningAgentOutputSchema,
      fallbackOutput: PLANNING_FALLBACK,
      allowSchemaReAsk: false,
    })

    expect(result.status).toBe('timeout')
    expect(result.output).toEqual(PLANNING_FALLBACK)
    // 1 initial + 1 retry = 2 total API calls
    const createMock = (client as unknown as { messages: { create: ReturnType<typeof vi.fn> } })
      .messages.create
    expect(createMock).toHaveBeenCalledTimes(2)
  }, 10_000)

  it('returns failed on api_error when the agent does not retry api_error', async () => {
    const apiError = new Error('502 upstream error')
    const client = makeErrorClient(apiError)
    _setAnthropicClient(client)

    const result = await runStructured({
      agentName: 'PlanningAgent',      // retryOn: ['timeout'] — api_error NOT retried
      systemMessage: 'system',
      userMessage: 'user',
      schema: PlanningAgentOutputSchema,
      fallbackOutput: PLANNING_FALLBACK,
      allowSchemaReAsk: false,
    })

    expect(result.status).toBe('failed')
    expect(result.output).toEqual(PLANNING_FALLBACK)
    const createMock = (client as unknown as { messages: { create: ReturnType<typeof vi.fn> } })
      .messages.create
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it('retries api_error for MemoryAgent (async agent — retry freely)', async () => {
    const apiError = new Error('503 overloaded')
    const client = makeErrorClient(apiError)
    _setAnthropicClient(client)

    const result = await runStructured({
      agentName: 'MemoryAgent',        // maxRetries: 2, retryOn includes api_error
      systemMessage: 'system',
      userMessage: 'user',
      schema: MemoryAgentOutputSchema,
      fallbackOutput: MEMORY_FALLBACK,
      allowSchemaReAsk: false,
    })

    expect(result.status).toBe('failed')
    expect(result.output).toEqual([])
    const createMock = (client as unknown as { messages: { create: ReturnType<typeof vi.fn> } })
      .messages.create
    expect(createMock).toHaveBeenCalledTimes(3)   // 1 initial + 2 retries
  }, 10_000)
})

// ── Per-agent config table (docs/AGENTS.md) ───────────────────────────────────

describe('Per-agent config table', () => {
  describe('ConversationAgent (AGENTS.md §2.1)', () => {
    it('uses claude-haiku-4-5', () => {
      expect(CONVERSATION_CONFIG.model).toBe('claude-haiku-4-5')
    })
    it('has maxOutputTokens=800', () => {
      expect(CONVERSATION_CONFIG.maxOutputTokens).toBe(800)
    })
    it('has timeoutMs=3000', () => {
      expect(CONVERSATION_CONFIG.timeoutMs).toBe(3000)
    })
    it('has maxRetries=2, backoffMs=200, retryOn timeout only', () => {
      expect(CONVERSATION_CONFIG.retryPolicy.maxRetries).toBe(2)
      expect(CONVERSATION_CONFIG.retryPolicy.backoffMs).toBe(200)
      expect(CONVERSATION_CONFIG.retryPolicy.retryOn).toEqual(['timeout'])
    })
    it('schema fallback: general / confidence 20 / schema_failure marker', () => {
      expect(CONVERSATION_FALLBACK.situationType).toBe('general')
      expect(CONVERSATION_FALLBACK.confidence).toBe(20)
      expect(CONVERSATION_FALLBACK.ambiguities).toEqual(['schema_failure'])
      expect(CONVERSATION_CONFIG.fallback).toBe(CONVERSATION_FALLBACK)
    })
    it('timeout fallback: general / confidence 30 / agent_timeout marker', () => {
      expect(CONVERSATION_TIMEOUT_FALLBACK.confidence).toBe(30)
      expect(CONVERSATION_TIMEOUT_FALLBACK.ambiguities).toEqual(['agent_timeout'])
    })
    it('both fallbacks validate against ExtractedContextSchema', () => {
      expect(ExtractedContextSchema.safeParse(CONVERSATION_FALLBACK).success).toBe(true)
      expect(ExtractedContextSchema.safeParse(CONVERSATION_TIMEOUT_FALLBACK).success).toBe(true)
    })
  })

  describe('PlanningAgent (AGENTS.md §3.1)', () => {
    it('uses claude-sonnet-4-6', () => {
      expect(PLANNING_CONFIG.model).toBe('claude-sonnet-4-6')
    })
    it('has maxOutputTokens=2000', () => {
      expect(PLANNING_CONFIG.maxOutputTokens).toBe(2000)
    })
    it('has timeoutMs=8000', () => {
      expect(PLANNING_CONFIG.timeoutMs).toBe(8000)
    })
    it('has maxRetries=1, retryOn timeout only (fail fast on schema)', () => {
      expect(PLANNING_CONFIG.retryPolicy.maxRetries).toBe(1)
      expect(PLANNING_CONFIG.retryPolicy.retryOn).toEqual(['timeout'])
    })
    it('fallback has confidence=low and exactly 2 whyNotAlternatives', () => {
      expect(PLANNING_FALLBACK.confidence).toBe('low')
      expect(PLANNING_FALLBACK.whyNotAlternatives).toHaveLength(2)
    })
    it('fallback validates against PlanningAgentOutputSchema', () => {
      expect(PlanningAgentOutputSchema.safeParse(PLANNING_FALLBACK).success).toBe(true)
    })
  })

  describe('ToolAgent (AGENTS.md §4.1)', () => {
    it('uses claude-haiku-4-5', () => {
      expect(TOOL_CONFIG.model).toBe('claude-haiku-4-5')
    })
    it('has maxOutputTokens=1500', () => {
      expect(TOOL_CONFIG.maxOutputTokens).toBe(1500)
    })
    it('has timeoutMs=6000', () => {
      expect(TOOL_CONFIG.timeoutMs).toBe(6000)
    })
    it('has maxRetries=2, backoffMs=500', () => {
      expect(TOOL_CONFIG.retryPolicy.maxRetries).toBe(2)
      expect(TOOL_CONFIG.retryPolicy.backoffMs).toBe(500)
    })
    it('fallback signals SWIGGY_UNAVAILABLE with all-null tool fields', () => {
      expect(TOOL_FALLBACK.swiggyError).toBe('SWIGGY_UNAVAILABLE')
      expect(TOOL_FALLBACK.restaurants).toBeNull()
      expect(TOOL_FALLBACK.instamartItems).toBeNull()
      expect(TOOL_FALLBACK.dineoutVenues).toBeNull()
      expect(TOOL_FALLBACK.youtube).toBeNull()
    })
    it('fallback validates against ToolAgentOutputSchema', () => {
      expect(ToolAgentOutputSchema.safeParse(TOOL_FALLBACK).success).toBe(true)
    })
  })

  describe('MemoryAgent (AGENTS.md §5.1)', () => {
    it('uses claude-haiku-4-5', () => {
      expect(MEMORY_CONFIG.model).toBe('claude-haiku-4-5')
    })
    it('has maxOutputTokens=600', () => {
      expect(MEMORY_CONFIG.maxOutputTokens).toBe(600)
    })
    it('has timeoutMs=5000', () => {
      expect(MEMORY_CONFIG.timeoutMs).toBe(5000)
    })
    it('retries on timeout AND api_error (async, retry freely)', () => {
      expect(MEMORY_CONFIG.retryPolicy.maxRetries).toBe(2)
      expect(MEMORY_CONFIG.retryPolicy.retryOn).toContain('timeout')
      expect(MEMORY_CONFIG.retryPolicy.retryOn).toContain('api_error')
    })
    it('fallback is the empty fact array', () => {
      expect(MEMORY_FALLBACK).toEqual([])
      expect(MemoryAgentOutputSchema.safeParse(MEMORY_FALLBACK).success).toBe(true)
    })
  })

  describe('Clarification Engine (PROMPT_ENGINEERING_GUIDE §2.3 / Appendix 1)', () => {
    it('uses claude-haiku-4-5 (guide resolution over README file index)', () => {
      expect(CLARIFICATION_CONFIG.model).toBe('claude-haiku-4-5')
    })
    it('logs under the ConversationAgent namespace', () => {
      expect(CLARIFICATION_CONFIG.name).toBe('ConversationAgent')
    })
  })

  describe('AGENT_CONFIGS lookup table', () => {
    it('maps every AgentName to its config object', () => {
      expect(AGENT_CONFIGS['ConversationAgent']).toBe(CONVERSATION_CONFIG)
      expect(AGENT_CONFIGS['PlanningAgent']).toBe(PLANNING_CONFIG)
      expect(AGENT_CONFIGS['ToolAgent']).toBe(TOOL_CONFIG)
      expect(AGENT_CONFIGS['MemoryAgent']).toBe(MEMORY_CONFIG)
    })
  })
})

// ── Real schema fixtures through parseAndValidate ─────────────────────────────

describe('parseAndValidate with real MealOS schemas', () => {
  it('validates a fully-populated ExtractedContext', () => {
    const valid = {
      situationType: 'sick',
      explicit: { sick: true, canCook: false, alone: true },
      inferred: { timeOfDay: 'dinner', isWeekend: false },
      confidence: 90,
      missingRequired: [],
      missingSoft: ['craving'],
      ambiguities: [],
      nonFoodInput: false,
    }
    expect(parseAndValidate(JSON.stringify(valid), ExtractedContextSchema).success).toBe(true)
  })

  it('rejects ExtractedContext with an invalid situationType', () => {
    const invalid = { ...VALID_EXTRACTED_CONTEXT, situationType: 'unknown_type' }
    expect(parseAndValidate(JSON.stringify(invalid), ExtractedContextSchema).success).toBe(false)
  })

  it('rejects ExtractedContext with confidence out of range', () => {
    const invalid = { ...VALID_EXTRACTED_CONTEXT, confidence: 150 }
    expect(parseAndValidate(JSON.stringify(invalid), ExtractedContextSchema).success).toBe(false)
  })

  it('rejects ExtractedContext with an inferred field outside the two permitted', () => {
    const invalid = {
      ...VALID_EXTRACTED_CONTEXT,
      inferred: { timeOfDay: 'dinner', isWeekend: false, canCook: true },
    }
    expect(parseAndValidate(JSON.stringify(invalid), ExtractedContextSchema).success).toBe(false)
  })

  it('validates a MemoryAgentOutput with one canonical fact', () => {
    const valid = [{
      factKey: 'dietary.restrictions',
      factValue: ['vegetarian'],
      confidence: 1.0,
      source: 'user_stated',
      expiresAfterDays: null,
    }]
    expect(parseAndValidate(JSON.stringify(valid), MemoryAgentOutputSchema).success).toBe(true)
  })

  it('rejects MemoryAgentOutput with a non-quantized confidence (0.5)', () => {
    const invalid = [{
      factKey: 'dietary.restrictions',
      factValue: ['vegetarian'],
      confidence: 0.5,
      source: 'user_stated',
      expiresAfterDays: null,
    }]
    expect(parseAndValidate(JSON.stringify(invalid), MemoryAgentOutputSchema).success).toBe(false)
  })

  it('rejects MemoryAgentOutput with an invented factKey (closed key list)', () => {
    const invalid = [{
      factKey: 'invented.key',
      factValue: 'x',
      confidence: 1.0,
      source: 'user_stated',
      expiresAfterDays: null,
    }]
    expect(parseAndValidate(JSON.stringify(invalid), MemoryAgentOutputSchema).success).toBe(false)
  })
})

// ── Config override + Clarification Engine transport ──────────────────────────

describe('runStructured — config override (Clarification Engine hosting)', () => {
  const TrivialSchema = z.object({ ok: z.boolean() }).strict()

  it('uses the override config for the API call instead of the AGENT_CONFIGS entry', async () => {
    const client = makeMockClient('{"ok": true}')
    _setAnthropicClient(client)

    await runStructured({
      agentName: 'ConversationAgent',
      systemMessage: 'sys',
      userMessage: 'user',
      schema: TrivialSchema,
      fallbackOutput: { ok: false },
      config: { ...CLARIFICATION_CONFIG, maxOutputTokens: 123 },
    })

    const createMock = vi.mocked(client.messages.create)
    expect(createMock.mock.calls[0]?.[0]).toMatchObject({
      model: 'claude-haiku-4-5',
      max_tokens: 123,
    })
  })

  it('falls back to the AGENT_CONFIGS entry when no override is given', async () => {
    const client = makeMockClient('{"ok": true}')
    _setAnthropicClient(client)

    await runStructured({
      agentName: 'ConversationAgent',
      systemMessage: 'sys',
      userMessage: 'user',
      schema: TrivialSchema,
      fallbackOutput: { ok: false },
    })

    const createMock = vi.mocked(client.messages.create)
    expect(createMock.mock.calls[0]?.[0]).toMatchObject({
      model: CONVERSATION_CONFIG.model,
      max_tokens: CONVERSATION_CONFIG.maxOutputTokens,
    })
  })
})

describe('runClarificationEngine transport helper', () => {
  it('returns a validated ClarificationOutput on success', async () => {
    const valid = {
      questions: [{
        text: 'Feeling up to cooking something simple?',
        field: 'canCook',
        type: 'single_choice',
        options: [
          { label: 'Can manage simple', value: true },
          { label: 'Need delivery', value: false },
          { label: 'Something else', value: 'freetext' },
        ],
        required: true,
        evoi: 'high',
      }],
      assumptions: [],
    }
    _setAnthropicClient(makeMockClient(JSON.stringify(valid)))

    const result = await runClarificationEngine('sys', 'user')
    expect(result.status).toBe('completed')
    expect(result.output.questions).toHaveLength(1)
    expect(result.output.questions[0]?.evoi).toBe('high')
  })

  it('returns the empty fallback on schema failure (fail fast, no re-ask)', async () => {
    const { client, calls } = makeSequenceClient(['not json at all'])
    _setAnthropicClient(client)

    const result = await runClarificationEngine('sys', 'user')
    expect(result.status).toBe('schema_failed')
    expect(result.output).toEqual({ questions: [], assumptions: [] })
    expect(calls()).toBe(1)   // no schema re-ask for the Clarification Engine
  })

  it('uses the CLARIFICATION_CONFIG token cap on the API call', async () => {
    const client = makeMockClient('{"questions": [], "assumptions": []}')
    _setAnthropicClient(client)

    await runClarificationEngine('sys', 'user')

    const createMock = vi.mocked(client.messages.create)
    expect(createMock.mock.calls[0]?.[0]).toMatchObject({
      max_tokens: CLARIFICATION_CONFIG.maxOutputTokens,
    })
  })
})
