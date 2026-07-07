/**
 * lib/sse.ts
 * MealOS AI — Server-Sent Events infrastructure (ISSUE-046)
 *
 * Two concerns:
 *   1. Wire helpers: format SSE events and create streaming Next.js responses.
 *   2. Clarification bus: lets POST /situations/:id/clarify unblock the SSE
 *      pipeline handler that is waiting for clarification answers.
 *
 * ⚠ V1 limitation — in-process Map:
 *   Works on `pnpm dev` (single Node.js process). On Vercel's serverless
 *   runtime, the clarify route and the stream handler run in different
 *   function instances and cannot share this Map. M11 (or earlier) must
 *   replace the bus with a Redis pub/sub channel keyed by situationId.
 */

import type { ClarificationAnswerValue } from '@/types/situation'

// ── SSE wire format ───────────────────────────────────────────────────────────

/**
 * Renders one SSE frame in the text/event-stream wire format.
 * Every frame ends with a blank line (two consecutive newlines) which is the
 * SSE spec's event terminator.
 *
 * @param eventName - The SSE `event:` field.
 * @param data      - Serialised as JSON for the `data:` field.
 * @param id        - Optional monotonic ID for reconnect recovery.
 */
export function formatSseEvent(
  eventName: string,
  data: unknown,
  id?: string,
): string {
  const lines: string[] = []
  if (id !== undefined) lines.push(`id: ${id}`)
  lines.push(`event: ${eventName}`)
  lines.push(`data: ${JSON.stringify(data)}`)
  lines.push('')  // blank line = event terminator
  return lines.join('\n') + '\n'
}

/** A function the orchestrator calls to emit one SSE event. */
export type SseSend = (eventName: string, data: unknown) => void

/**
 * Creates a streaming Next.js Response for an SSE endpoint.
 *
 * The `handler` runs asynchronously inside the stream. Calling `send` at any
 * point (including across awaits) enqueues one formatted SSE frame. The stream
 * closes automatically when the handler resolves or rejects.
 */
export function createSseResponse(
  handler: (send: SseSend) => Promise<void>,
): Response {
  const encoder = new TextEncoder()
  let eventId = 0
  let controller!: ReadableStreamDefaultController<Uint8Array>

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl
    },
    cancel() {
      // Client disconnected — handler's awaits will settle naturally.
    },
  })

  const send: SseSend = (eventName, data) => {
    const id = String(++eventId)
    try {
      controller.enqueue(encoder.encode(formatSseEvent(eventName, data, id)))
    } catch {
      // Controller may be closed if the client disconnected.
    }
  }

  handler(send)
    .catch(() => {
      // Errors are surfaced via `error` events before the promise rejects.
    })
    .finally(() => {
      try { controller.close() } catch { /* already closed */ }
    })

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',  // disable Nginx buffering for SSE
    },
  })
}

// ── Clarification answer bus ──────────────────────────────────────────────────

type AnswerMap = Record<string, ClarificationAnswerValue>
type Waiter = { resolve: (answers: AnswerMap) => void; timer: ReturnType<typeof setTimeout> }

/** Active waiters keyed by situationId. One SSE stream per situation. */
const pending = new Map<string, Waiter>()

/** Default clarification timeout: 5 minutes. Client shows a countdown. */
const DEFAULT_CLARIFICATION_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Returns a promise that resolves once POST /clarify delivers answers for this
 * situation. Resolves with `{}` (assume-and-proceed) if no answers arrive
 * within `timeoutMs`.
 *
 * Calling this a second time for the same situationId (pass 2) replaces the
 * first waiter — the first promise is superseded and may never settle.
 */
export function waitForClarificationAnswers(
  situationId: string,
  timeoutMs = DEFAULT_CLARIFICATION_TIMEOUT_MS,
): Promise<AnswerMap> {
  return new Promise((resolve) => {
    // Cancel any existing waiter (second-pass scenario).
    const existing = pending.get(situationId)
    if (existing !== undefined) clearTimeout(existing.timer)

    const timer = setTimeout(() => {
      pending.delete(situationId)
      resolve({})
    }, timeoutMs)

    pending.set(situationId, { resolve, timer })
  })
}

/**
 * Called by POST /situations/:id/clarify to unblock the waiting SSE handler.
 *
 * @returns `true` when a waiter was found and notified, `false` when no stream
 *          was waiting for this situation (client disconnected, already timed out,
 *          or the situationId is wrong).
 */
export function deliverClarificationAnswers(
  situationId: string,
  answers: AnswerMap,
): boolean {
  const waiter = pending.get(situationId)
  if (waiter === undefined) return false
  clearTimeout(waiter.timer)
  pending.delete(situationId)
  waiter.resolve(answers)
  return true
}

/**
 * Returns `true` if there is an active waiter for the given situation.
 * POST /clarify uses this to distinguish "stream is waiting" from "stream is gone".
 */
export function hasPendingClarification(situationId: string): boolean {
  return pending.has(situationId)
}
