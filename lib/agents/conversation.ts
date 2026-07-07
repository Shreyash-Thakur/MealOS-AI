/**
 * lib/agents/conversation.ts
 * MealOS AI — Conversation Agent
 *
 * Identity (docs/AGENTS.md §2.1):
 *   Name:           ConversationAgent
 *   Model:          claude-haiku-4-5
 *   Max output tokens: 800
 *   Timeout:        3000ms
 *   Retry policy:   2 retries max, 200ms base backoff, retry on timeout only
 *   Runs:           Synchronously, FIRST in pipeline, blocks SSE
 *   Prompt file:    docs/prompts/conversation.md (live source via lib/prompts)
 *
 * Responsibility (docs/AGENTS.md §2.2):
 *   Convert raw user text into a structured ExtractedContext. This agent
 *   classifies, extracts, and flags what is missing — it never recommends.
 *   The ConfidenceCard renders directly from this agent's confidence field.
 *
 * LLM transport: lib/claude.ts `runConversationAgent(systemMessage, userMessage)`
 *   owns the retry loop, timeout sentinel, schema validation (with the agent's
 *   single re-ask), and the generic fallback. This module owns everything
 *   prompt-shaped: system-message assembly from the live prompt files, temporal
 *   variable derivation, user-message injection — and the timeout-fallback
 *   distinction (AGENTS.md §2.5 FM1 vs FM2: timeout → confidence 30
 *   'agent_timeout'; schema failure → confidence 20 'schema_failure').
 */

import {
  runConversationAgent as claudeRunConversationAgent,
  CONVERSATION_TIMEOUT_FALLBACK,
} from '@/lib/claude'
import {
  assembleSystemMessage,
  getUserMessageTemplate,
  injectVariables,
} from '@/lib/prompts'
import type { AgentRunResult, ConversationAgentInput } from '@/types/agents'
import type { ExtractedContextValidated } from '@/lib/schemas/agents'

// ── Temporal context derivation ───────────────────────────────────────────────

/** The three datetime values injected into the user message (conversation.md §2). */
export interface TemporalContext {
  /** ISO 8601 date in the user's timezone, e.g. "2026-07-05". */
  currentDate: string
  /** 24-hour local time, e.g. "19:45". */
  currentTime: string
  /** Full English day name in the user's timezone, e.g. "Tuesday". */
  dayOfWeek: string
}

/**
 * Derives the user-local date, time, and day name from an ISO timestamp.
 *
 * The timestamp identifies an instant (it carries an offset or Z); the IANA
 * timezone determines how that instant reads on the user's wall clock. These
 * values ride in the USER message so the system block stays byte-stable for
 * prompt caching (system.md v1.1.0 cache layout note).
 *
 * @param timestamp - ISO 8601 datetime, e.g. "2026-07-05T19:45:00+05:30".
 * @param timeZone - IANA timezone, e.g. "Asia/Kolkata".
 */
export function deriveTemporalContext(
  timestamp: string,
  timeZone: string,
): TemporalContext {
  const instant = new Date(timestamp)

  // en-CA formats as YYYY-MM-DD — the ISO date shape the prompt specifies
  const currentDate = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)

  const currentTime = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant)

  const dayOfWeek = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
  }).format(instant)

  return { currentDate, currentTime, dayOfWeek }
}

// ── User message construction ─────────────────────────────────────────────────

/**
 * Builds the Conversation Agent user message from the live template in
 * docs/prompts/conversation.md §2.
 *
 * Injection rules (conversation.md variable notes):
 * - raw_input is injected EXACTLY as received — never cleaned, trimmed, or
 *   pre-processed (truncation to 500 chars happens at the API layer, upstream).
 * - Absent memory summary / previous situation type become the literal "null".
 */
export function buildConversationUserMessage(input: ConversationAgentInput): string {
  const temporal = deriveTemporalContext(input.timestamp, input.userTimezone)

  return injectVariables(getUserMessageTemplate('conversation'), {
    raw_input: input.rawInput,
    user_memory_summary: input.userMemorySummary ?? 'null',
    previous_situation_type: input.previousSituationType ?? 'null',
    current_date: temporal.currentDate,
    current_time: temporal.currentTime,
    day_of_week: temporal.dayOfWeek,
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Runs the Conversation Agent for one raw user input.
 *
 * Never throws for LLM-level failures — every outcome is a typed
 * AgentRunResult whose output is always a valid ExtractedContext
 * (PROMPT_ENGINEERING_GUIDE §5.2: downstream code never branches on
 * "did the agent succeed").
 *
 * Status → output mapping (AGENTS.md §2.5):
 * - completed     → the model's validated ExtractedContext
 * - timeout       → CONVERSATION_TIMEOUT_FALLBACK (confidence 30, 'agent_timeout')
 * - schema_failed → CONVERSATION_FALLBACK (confidence 20, 'schema_failure')
 * - failed        → CONVERSATION_FALLBACK (model refusal / API error)
 */
export async function runConversationAgent(
  input: ConversationAgentInput,
): Promise<AgentRunResult<ExtractedContextValidated>> {
  const systemMessage = assembleSystemMessage('conversation')
  const userMessage = buildConversationUserMessage(input)

  const result = await claudeRunConversationAgent(systemMessage, userMessage)

  // lib/claude returns the generic (schema) fallback for every failure status;
  // the timeout fallback is distinct by spec — swap it in here.
  if (result.status === 'timeout') {
    return { ...result, output: CONVERSATION_TIMEOUT_FALLBACK }
  }

  return result
}

// ── Exported constants ────────────────────────────────────────────────────────

export const CONVERSATION_AGENT_NAME = 'ConversationAgent' as const
