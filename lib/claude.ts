/**
 * MealOS AI — Anthropic Client Wrapper
 *
 * Single file that every agent imports to interact with the Anthropic API.
 * Encapsulates:
 *  - Per-agent config table (model, max_tokens, timeout, retry policy, fallback)
 *  - Prompt-caching-aware message construction (PROMPT_ENGINEERING_GUIDE §6)
 *  - Structured-output call helper with Zod validation + one re-ask on schema failure
 *    (Conversation Agent only — all others fail-fast per AGENTS.md §1.2)
 *  - Timeout enforcement via Promise.race (AGENTS.md §1.2)
 *  - Typed errors via AppError
 *
 * Model assignments (docs/AGENTS.md §2.1/§3.1/§4.1/§5.1 + prompts/README.md §1):
 *  - ConversationAgent  → claude-haiku-4-5    (3000ms timeout, 800 tokens)
 *  - PlanningAgent      → claude-sonnet-4-6   (8000ms timeout, 2000 tokens)
 *  - ToolAgent          → claude-haiku-4-5    (6000ms timeout, 1500 tokens)
 *  - MemoryAgent        → claude-haiku-4-5    (5000ms timeout, 600 tokens)
 *  - Clarification      → claude-haiku-4-5    (3000ms timeout — PROMPT_ENGINEERING_GUIDE
 *    §2.3 / Appendix item 1 resolution: Haiku for templated question selection)
 *
 * @module lib/claude
 */

import Anthropic from '@anthropic-ai/sdk'
import type { ZodSchema } from 'zod'
import { env } from '@/lib/env'
import { AppError } from '@/lib/errors'
import type { AgentConfig, AgentName, AgentRunResult } from '@/types/agents'
import type { Ms } from '@/types/primitives'
import {
  ExtractedContextSchema,
  PlanningAgentOutputSchema,
  ToolAgentOutputSchema,
  MemoryAgentOutputSchema,
} from '@/lib/schemas'
import type {
  ExtractedContextValidated,
  ToolAgentOutputValidated,
  MemoryAgentOutputValidated,
} from '@/lib/schemas/agents'
import type { PlanningAgentOutputValidated } from '@/lib/schemas/planningOutput'

// ── Singleton Anthropic client ─────────────────────────────────────────────────

/**
 * Module-level singleton. Created once on first use.
 * All agent calls share this instance (connection pooling handled by SDK).
 */
let _anthropicClient: Anthropic | null = null

/**
 * Returns the shared Anthropic client instance, creating it on first call.
 * Reads the API key from the validated `env` object — no raw process.env access.
 */
export function getAnthropicClient(): Anthropic {
  if (_anthropicClient === null) {
    _anthropicClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  }
  return _anthropicClient
}

// ── Typed fallback outputs ────────────────────────────────────────────────────
// Every fallback conforms to the agent's output type (PROMPT_ENGINEERING_GUIDE §5.2:
// "downstream code never branches on 'did the agent succeed'").

/**
 * Conversation Agent schema fallback (AGENTS.md §2.5 Failure Mode 2).
 * Valid low-confidence SituationContext; Clarification Engine asks broad questions.
 */
export const CONVERSATION_FALLBACK: ExtractedContextValidated = {
  situationType: 'general',
  explicit: {},
  inferred: {},
  confidence: 20,
  missingRequired: ['craving', 'budget', 'canCook'],
  missingSoft: [],
  ambiguities: ['schema_failure'],
  nonFoodInput: false,
}

/**
 * Conversation Agent timeout fallback (AGENTS.md §2.5 Failure Mode 1).
 * Distinct from the schema fallback: confidence 30, ambiguity marker 'agent_timeout'.
 */
export const CONVERSATION_TIMEOUT_FALLBACK: ExtractedContextValidated = {
  situationType: 'general',
  explicit: {},
  inferred: {},
  confidence: 30,
  missingRequired: ['craving', 'budget', 'canCook'],
  missingSoft: [],
  ambiguities: ['agent_timeout'],
  nonFoodInput: false,
}

/**
 * Planning Agent degraded fallback (AGENTS.md §3.5 Failure Mode 1).
 * A simplified degraded recommendation; UI shows it with a degraded indicator.
 */
export const PLANNING_FALLBACK: PlanningAgentOutputValidated = {
  explanation: "Taking longer than expected. Here's the top match based on your situation.",
  primaryPath: 'order',
  confidence: 'low',
  recommendation: {
    title: 'Home cooking',
    description: 'Selected based on your situation type.',
    estimatedCost: 0,
    estimatedTime: 30,
  },
  whyNotAlternatives: [
    { path: 'cook', reason: 'Plan generation timed out — showing fastest available option.' },
    { path: 'dineout', reason: 'Plan generation timed out.' },
  ],
}

/**
 * Tool Agent fallback (AGENTS.md §4.4: all tools failed).
 * All fields null + SWIGGY_UNAVAILABLE signal; orchestrator sets degraded mode.
 */
export const TOOL_FALLBACK: ToolAgentOutputValidated = {
  restaurants: null,
  instamartItems: null,
  dineoutVenues: null,
  youtube: null,
  errors: [],
  swiggyError: 'SWIGGY_UNAVAILABLE',
  _meta: {
    toolsAttempted: [],
    toolsSucceeded: [],
    totalLatencyMs: 0,
  },
}

/**
 * Memory Agent fallback (AGENTS.md §5.6): empty fact array — no writes, silent.
 */
export const MEMORY_FALLBACK: MemoryAgentOutputValidated = []

// ── Per-agent config table ────────────────────────────────────────────────────
// Source: docs/AGENTS.md §2.1, §3.1, §4.1, §5.1.
// Retry policies per AGENTS.md §1.2 (schema_invalid NOT retried except Conversation
// via the one re-ask mechanism in callStructured).
// Note: Ms is a compile-time brand over number (types/primitives.ts) — casts are
// the codebase convention (see lib/engine/simulator.ts).

/**
 * ConversationAgent config.
 * AGENTS.md §2.1: haiku-4-5, 800 max_tokens, 3000ms timeout,
 * 2 retries max / 200ms base backoff / retry on timeout only.
 * schema_invalid gets ONE re-ask with a stricter suffix (handled in callStructured).
 */
export const CONVERSATION_CONFIG: AgentConfig = {
  name: 'ConversationAgent',
  model: 'claude-haiku-4-5',
  maxOutputTokens: 800,
  timeoutMs: 3000 as Ms,
  retryPolicy: {
    maxRetries: 2,
    backoffMs: 200 as Ms,
    retryOn: ['timeout'],   // schema_invalid handled via re-ask, not retry loop
  },
  fallback: CONVERSATION_FALLBACK,
}

/**
 * PlanningAgent config.
 * AGENTS.md §3.1: sonnet-4-6, 2000 max_tokens, 8000ms timeout,
 * 1 retry on timeout only; no retry on schema_invalid (fail fast).
 */
export const PLANNING_CONFIG: AgentConfig = {
  name: 'PlanningAgent',
  model: 'claude-sonnet-4-6',
  maxOutputTokens: 2000,
  timeoutMs: 8000 as Ms,
  retryPolicy: {
    maxRetries: 1,
    backoffMs: 500 as Ms,
    retryOn: ['timeout'],
  },
  fallback: PLANNING_FALLBACK,
}

/**
 * ToolAgent config.
 * AGENTS.md §4.1: haiku-4-5, 1500 max_tokens, 6000ms timeout
 * (must allow for multiple parallel MCP calls).
 * Per-tool retries (max 2, 500ms backoff) are the tool agent's job — this
 * config covers the LLM call itself.
 */
export const TOOL_CONFIG: AgentConfig = {
  name: 'ToolAgent',
  model: 'claude-haiku-4-5',
  maxOutputTokens: 1500,
  timeoutMs: 6000 as Ms,
  retryPolicy: {
    maxRetries: 2,
    backoffMs: 500 as Ms,
    retryOn: ['timeout', 'api_error'],
  },
  fallback: TOOL_FALLBACK,
}

/**
 * MemoryAgent config.
 * AGENTS.md §5.1: haiku-4-5, 600 max_tokens, 5000ms timeout,
 * 2 retries / 500ms base backoff / retry on timeout AND api_error
 * (async agent — retry freely, nothing is waiting).
 */
export const MEMORY_CONFIG: AgentConfig = {
  name: 'MemoryAgent',
  model: 'claude-haiku-4-5',
  maxOutputTokens: 600,
  timeoutMs: 5000 as Ms,
  retryPolicy: {
    maxRetries: 2,
    backoffMs: 500 as Ms,
    retryOn: ['timeout', 'api_error'],
  },
  fallback: MEMORY_FALLBACK,
}

/**
 * Clarification Engine config.
 * Model: claude-haiku-4-5 per PROMPT_ENGINEERING_GUIDE §2.3 and Appendix item 1
 * resolution ("Haiku — templated selection task; upgrade only on observed quality
 * failure"). Note prompts/README.md §7 file index says sonnet-4-6 — this is the
 * documented inconsistency; the guide's resolution wins.
 * The Clarification Engine is hosted by the Conversation Service and logged under
 * the ConversationAgent namespace (AgentName has no Clarification entry).
 */
export const CLARIFICATION_CONFIG: AgentConfig = {
  name: 'ConversationAgent',
  model: 'claude-haiku-4-5',
  maxOutputTokens: 800,
  timeoutMs: 3000 as Ms,
  retryPolicy: {
    maxRetries: 1,
    backoffMs: 200 as Ms,
    retryOn: ['timeout'],
  },
  fallback: { questions: [], assumptions: [] },
}

/** Lookup table by AgentName. */
export const AGENT_CONFIGS: Record<AgentName, AgentConfig> = {
  ConversationAgent: CONVERSATION_CONFIG,
  PlanningAgent: PLANNING_CONFIG,
  ToolAgent: TOOL_CONFIG,
  MemoryAgent: MEMORY_CONFIG,
}

// ── Message-block construction ────────────────────────────────────────────────
// Per PROMPT_ENGINEERING_GUIDE §6.1: the cache breakpoint sits exactly where
// stability ends — after [system.md + agent prompt], before the volatile user message.

/** Anthropic content block type for caching-aware system messages. */
export interface CacheableSystemBlock {
  type: 'text'
  text: string
  cache_control: { type: 'ephemeral' }
}

/**
 * Wraps a system-message string in a prompt-caching-aware content block.
 *
 * PROMPT_ENGINEERING_GUIDE §6.2: Planning Agent prefix (~1,500+ tokens) and
 * Tool Agent tool definitions (~1,200 tokens) exceed the 1024-token cache minimum.
 * Conversation/Memory are smaller but cache as part of the combined system block.
 * cache_control is always attached — the API only creates cache entries for
 * blocks above the minimum, so attaching it unconditionally is safe.
 *
 * @param text - The assembled system message text (system.md + agent prompt).
 */
export function makeCacheableSystemBlock(text: string): CacheableSystemBlock {
  return { type: 'text', text, cache_control: { type: 'ephemeral' } }
}

// ── Timeout helper ────────────────────────────────────────────────────────────
// AGENTS.md §1.2 Timeout Handling: Promise.race with a timeout sentinel.
// When the sentinel fires, the in-flight API call is abandoned (not cancelled).

/**
 * Races an API call against a timeout sentinel.
 *
 * @param apiCall - The in-flight Anthropic SDK promise.
 * @param timeoutMs - Milliseconds before the sentinel rejects.
 * @returns The API result if it resolves first.
 * @throws `AppError('LLM_TIMEOUT', ...)` if the sentinel fires first.
 */
export function callWithTimeout<T>(
  apiCall: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const sentinel = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new AppError('LLM_TIMEOUT', `Agent call exceeded ${timeoutMs}ms timeout`)),
      timeoutMs,
    )
  })
  return Promise.race([apiCall, sentinel]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

// ── Response text extraction ──────────────────────────────────────────────────

/**
 * Extracts raw text content from an Anthropic message response.
 * Expects a text content block (all MealOS agents output JSON, no tool_use blocks
 * in the final response).
 *
 * @param message - Anthropic API message response.
 * @returns The text content of the first text block.
 * @throws `AppError('INTERNAL_ERROR')` if no text block is found (model refusal /
 *   empty content — treated as schema failure by callers, never retried per
 *   AGENTS.md §2.5 Failure Mode 3).
 */
export function extractTextContent(message: Anthropic.Message): string {
  for (const block of message.content) {
    if (block.type === 'text') return block.text
  }
  throw new AppError(
    'INTERNAL_ERROR',
    'Anthropic response contained no text content block',
    { stopReason: message.stop_reason, contentTypes: message.content.map((b) => b.type) },
  )
}

// ── parseAndValidate ──────────────────────────────────────────────────────────
// AGENTS.md §1.2 Structured Output Enforcement.

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

/**
 * JSON.parse → Zod safeParse. The double gate between raw LLM output and types.
 *
 * PROMPT_ENGINEERING_GUIDE §5: "The pipeline trusts schemas, not models."
 * PROMPT_ENGINEERING_GUIDE §8 AP-3: the parser is INTOLERANT — first char must
 * be `{` or `[`. No markdown-fence stripping, no preamble tolerance. Robustness
 * lives in the retry-then-fallback path, which is logged.
 *
 * @param rawOutput - Raw text from the model.
 * @param schema - Zod schema to validate against.
 * @returns Success with typed data, or failure with an error string.
 */
export function parseAndValidate<T>(
  rawOutput: string,
  schema: ZodSchema<T>,
): ParseResult<T> {
  const trimmed = rawOutput.trim()

  // AP-3: intolerant parser — first char must be { or [
  if (trimmed[0] !== '{' && trimmed[0] !== '[') {
    return {
      success: false,
      error: `json_parse_failed: response does not start with { or [. Got: "${trimmed.slice(0, 40)}"`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (err) {
    return {
      success: false,
      error: `json_parse_failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    return { success: false, error: result.error.message }
  }

  return { success: true, data: result.data }
}

// ── Structured-output call ────────────────────────────────────────────────────

/** Parameters for a structured Anthropic call. */
export interface StructuredCallParams<T> {
  /** Agent name — used to look up config (model, tokens, timeout). */
  agentName: AgentName
  /** Fully assembled system message (system.md + agent section — see lib/prompts). */
  systemMessage: string
  /** User message with all {{variables}} already injected. */
  userMessage: string
  /** Zod schema to validate the model output against. */
  schema: ZodSchema<T>
  /** Fallback returned with status 'schema_failed' when validation cannot recover. */
  fallbackOutput: T
  /**
   * If true (Conversation Agent only): one re-ask with a stricter suffix on
   * schema failure (AGENTS.md §1.2 + §2.5 FM2). All other agents fail fast —
   * the re-ask is only justified when the retry CHANGES the prompt (AP-8).
   */
  allowSchemaReAsk?: boolean
  /** 1-based attempt number supplied by the outer retry loop (for reporting). */
  attemptNumber?: number
}

/** Result of a single structured call (no retry-loop bookkeeping). */
export interface StructuredCallResult<T> {
  output: T
  status: 'completed' | 'schema_failed'
  /** Total API calls made inside this invocation (2 when the re-ask fired). */
  attempts: number
  /** Token usage from the Anthropic response (last successful API call). */
  inputTokens: number
  outputTokens: number
  error?: string
}

/**
 * Makes one structured Anthropic call (plus at most one schema re-ask).
 *
 * Flow:
 *  1. Call the API with the agent's model/max_tokens/timeout.
 *  2. Parse + validate via `parseAndValidate`.
 *  3a. Valid → `{ status: 'completed' }`.
 *  3b. Invalid AND `allowSchemaReAsk` → ONE re-ask with the stricter suffix
 *      appended to the system message, then fallback if still invalid.
 *  3c. Invalid, no re-ask → `{ status: 'schema_failed' }` with the fallback.
 *
 * Timeout errors (`AppError` code LLM_TIMEOUT) propagate to the caller — the
 * outer retry loop in `runStructured` applies the per-agent timeout retry policy.
 *
 * @param params - Structured call parameters.
 */
export async function callStructured<T>(
  params: StructuredCallParams<T>,
): Promise<StructuredCallResult<T>> {
  const config = AGENT_CONFIGS[params.agentName]
  const client = getAnthropicClient()

  let inputTokens = 0
  let outputTokens = 0

  /** Make one API call, record usage, parse, and validate. */
  async function attempt(systemText: string): Promise<ParseResult<T>> {
    const systemBlock = makeCacheableSystemBlock(systemText)

    const messagePromise = client.messages.create({
      model: config.model,
      max_tokens: config.maxOutputTokens,
      system: [systemBlock],
      messages: [{ role: 'user', content: params.userMessage }],
    })

    const message = await callWithTimeout(messagePromise, config.timeoutMs)
    inputTokens = message.usage?.input_tokens ?? 0
    outputTokens = message.usage?.output_tokens ?? 0
    const rawText = extractTextContent(message)
    return parseAndValidate(rawText, params.schema)
  }

  const baseAttempts = params.attemptNumber ?? 1

  // Attempt 1
  const firstResult = await attempt(params.systemMessage)
  if (firstResult.success) {
    return {
      output: firstResult.data,
      status: 'completed',
      attempts: baseAttempts,
      inputTokens,
      outputTokens,
    }
  }

  // Schema failure: re-ask only when the retry changes the prompt (Conversation).
  if (params.allowSchemaReAsk) {
    const stricterSystem =
      params.systemMessage +
      '\n\nYour previous response was not valid JSON. ' +
      'Output ONLY the raw JSON object starting with `{`. No markdown. No prose.'

    const secondResult = await attempt(stricterSystem)
    if (secondResult.success) {
      return {
        output: secondResult.data,
        status: 'completed',
        attempts: baseAttempts + 1,
        inputTokens,
        outputTokens,
      }
    }

    return {
      output: params.fallbackOutput,
      status: 'schema_failed',
      attempts: baseAttempts + 1,
      inputTokens,
      outputTokens,
      error: secondResult.error,
    }
  }

  // All other agents: fail fast on schema failure (AGENTS.md §1.2, AP-8).
  return {
    output: params.fallbackOutput,
    status: 'schema_failed',
    attempts: baseAttempts,
    inputTokens,
    outputTokens,
    error: firstResult.error,
  }
}

// ── Retry wrapper ─────────────────────────────────────────────────────────────
// AGENTS.md §1.2: retry logic lives inside the agent's run(), not the orchestrator.

/** Parameters for a full agent run (structured call + retry policy + timing). */
export type RunStructuredParams<T> = StructuredCallParams<T>

/**
 * Runs a structured Anthropic call under the agent's configured retry policy
 * and returns a full `AgentRunResult<T>`.
 *
 * Retry semantics per AGENTS.md §1.2:
 * - Retries only on triggers listed in `config.retryPolicy.retryOn`
 *   ('timeout' and/or 'api_error' — never 'schema_invalid').
 * - Schema failures short-circuit to the fallback immediately (fail fast);
 *   the Conversation Agent's single re-ask happens inside `callStructured`.
 * - Backoff = `backoffMs * 2^(attempt-1)` (exponential).
 * - `latencyMs` covers the entire run including retries and backoff.
 *
 * @param params - Full run parameters including the typed fallback output.
 */
export async function runStructured<T>(
  params: RunStructuredParams<T>,
): Promise<AgentRunResult<T>> {
  const config = AGENT_CONFIGS[params.agentName]
  const startMs = Date.now()

  let lastStatus: AgentRunResult<T>['status'] = 'failed'
  let lastError: string | undefined
  let totalAttempts = 0

  for (let attempt = 0; attempt <= config.retryPolicy.maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(config.retryPolicy.backoffMs * Math.pow(2, attempt - 1))
    }

    try {
      const result = await callStructured({ ...params, attemptNumber: attempt + 1 })
      totalAttempts = result.attempts

      if (result.status === 'completed') {
        return {
          output: result.output,
          status: 'completed',
          latencyMs: (Date.now() - startMs) as Ms,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          attempts: totalAttempts,
        }
      }

      // schema_failed — never retried (fail-fast rule, AGENTS.md §1.2)
      return {
        output: params.fallbackOutput,
        status: 'schema_failed',
        latencyMs: (Date.now() - startMs) as Ms,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        attempts: totalAttempts,
        error: result.error,
      }
    } catch (err) {
      totalAttempts = attempt + 1

      if (err instanceof AppError && err.code === 'LLM_TIMEOUT') {
        lastStatus = 'timeout'
        lastError = err.message
        if (!config.retryPolicy.retryOn.includes('timeout')) break
        continue
      }

      // Anything else from the SDK is an api_error
      lastStatus = 'failed'
      lastError = err instanceof Error ? err.message : String(err)
      if (!config.retryPolicy.retryOn.includes('api_error')) break
    }
  }

  return {
    output: params.fallbackOutput,
    status: lastStatus,
    latencyMs: (Date.now() - startMs) as Ms,
    inputTokens: 0,
    outputTokens: 0,
    attempts: totalAttempts,
    error: lastError,
  }
}

// ── Typed convenience helpers ─────────────────────────────────────────────────
// One per agent — the Wave-3 import surface. Each pins the schema, the re-ask
// flag, and the typed fallback so callers only supply the two message strings.

/**
 * Runs the Conversation Agent (haiku, 3s, one schema re-ask enabled).
 * Validates with `ExtractedContextSchema`.
 */
export function runConversationAgent(
  systemMessage: string,
  userMessage: string,
): Promise<AgentRunResult<ExtractedContextValidated>> {
  return runStructured<ExtractedContextValidated>({
    agentName: 'ConversationAgent',
    systemMessage,
    userMessage,
    schema: ExtractedContextSchema,
    allowSchemaReAsk: true,
    fallbackOutput: CONVERSATION_FALLBACK,
  })
}

/**
 * Runs the Planning Agent (sonnet, 8s, no schema re-ask — fail fast).
 * Validates with `PlanningAgentOutputSchema`.
 */
export function runPlanningAgent(
  systemMessage: string,
  userMessage: string,
): Promise<AgentRunResult<PlanningAgentOutputValidated>> {
  return runStructured<PlanningAgentOutputValidated>({
    agentName: 'PlanningAgent',
    systemMessage,
    userMessage,
    schema: PlanningAgentOutputSchema,
    allowSchemaReAsk: false,
    fallbackOutput: PLANNING_FALLBACK,
  })
}

/**
 * Runs the Tool Agent (haiku, 6s, no schema re-ask — fail fast).
 * Validates with `ToolAgentOutputSchema`.
 */
export function runToolAgent(
  systemMessage: string,
  userMessage: string,
): Promise<AgentRunResult<ToolAgentOutputValidated>> {
  return runStructured<ToolAgentOutputValidated>({
    agentName: 'ToolAgent',
    systemMessage,
    userMessage,
    schema: ToolAgentOutputSchema,
    allowSchemaReAsk: false,
    fallbackOutput: TOOL_FALLBACK,
  })
}

/**
 * Runs the Memory Agent (haiku, 5s, no schema re-ask — silent failure).
 * Validates with `MemoryAgentOutputSchema`.
 */
export function runMemoryAgent(
  systemMessage: string,
  userMessage: string,
): Promise<AgentRunResult<MemoryAgentOutputValidated>> {
  return runStructured<MemoryAgentOutputValidated>({
    agentName: 'MemoryAgent',
    systemMessage,
    userMessage,
    schema: MemoryAgentOutputSchema,
    allowSchemaReAsk: false,
    fallbackOutput: MEMORY_FALLBACK,
  })
}

// ── Internal utilities ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Test injection hooks ──────────────────────────────────────────────────────

/**
 * Replaces the singleton client with a mock.
 * ONLY for use in tests — never call from application code.
 * @internal
 */
export function _setAnthropicClient(client: Anthropic): void {
  _anthropicClient = client
}

/**
 * Resets the singleton client to null (forces re-creation on next access).
 * ONLY for use in tests — never call from application code.
 * @internal
 */
export function _resetAnthropicClient(): void {
  _anthropicClient = null
}
