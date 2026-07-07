/**
 * tests/sse/sse.test.ts
 * Unit tests for lib/sse.ts (ISSUE-046)
 *
 * Covers:
 *   1. formatSseEvent — wire format: event name, JSON data, id, trailing blank line
 *   2. Clarification bus — waitForClarificationAnswers / deliverClarificationAnswers
 *   3. hasPendingClarification — state tracking
 *   4. Second-pass overwrite — registering a new waiter replaces the first
 *   5. Timeout path — empty answers returned after the timeout fires
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  formatSseEvent,
  waitForClarificationAnswers,
  deliverClarificationAnswers,
  hasPendingClarification,
} from '@/lib/sse'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// ── formatSseEvent ────────────────────────────────────────────────────────────

describe('formatSseEvent', () => {
  it('emits event name, JSON data, and a terminal blank line', () => {
    const frame = formatSseEvent('plan_ready', { id: 'abc-123' })
    expect(frame).toContain('event: plan_ready')
    expect(frame).toContain('data: {"id":"abc-123"}')
    // SSE frames must end with a blank line (two consecutive newlines)
    expect(frame).toMatch(/\n\n$/)
  })

  it('includes the id field when provided', () => {
    const frame = formatSseEvent('heartbeat', { ts: '2026-07-08T10:00:00Z' }, '7')
    expect(frame).toContain('id: 7')
    expect(frame.indexOf('id: 7')).toBeLessThan(frame.indexOf('event:'))
  })

  it('omits the id field when not provided', () => {
    const frame = formatSseEvent('heartbeat', {})
    expect(frame).not.toMatch(/^id:/m)
  })

  it('serialises nested objects correctly', () => {
    const frame = formatSseEvent('context_understood', { confidence: 85, knownFields: ['diet'] })
    expect(frame).toContain('"knownFields":["diet"]')
  })

  it('serialises null data correctly', () => {
    const frame = formatSseEvent('error', null)
    expect(frame).toContain('data: null')
  })
})

// ── Clarification bus ─────────────────────────────────────────────────────────

describe('waitForClarificationAnswers + deliverClarificationAnswers', () => {
  it('resolves immediately when answers are delivered before timeout', async () => {
    const promise = waitForClarificationAnswers('sit-happy')
    const delivered = deliverClarificationAnswers('sit-happy', { q1: 'yes' })
    const result = await promise

    expect(delivered).toBe(true)
    expect(result).toEqual({ q1: 'yes' })
  })

  it('answers can be empty (assume-and-proceed)', async () => {
    const promise = waitForClarificationAnswers('sit-empty')
    deliverClarificationAnswers('sit-empty', {})
    const result = await promise
    expect(result).toEqual({})
  })

  it('returns false when no waiter is registered for that situationId', () => {
    expect(deliverClarificationAnswers('sit-nobody', { q1: 'x' })).toBe(false)
  })
})

describe('hasPendingClarification', () => {
  it('returns true while a waiter is registered', () => {
    const promise = waitForClarificationAnswers('sit-pending')
    expect(hasPendingClarification('sit-pending')).toBe(true)
    deliverClarificationAnswers('sit-pending', {})
    return promise
  })

  it('returns false after answers are delivered', async () => {
    const promise = waitForClarificationAnswers('sit-resolved')
    deliverClarificationAnswers('sit-resolved', {})
    await promise
    expect(hasPendingClarification('sit-resolved')).toBe(false)
  })

  it('returns false when no waiter is registered', () => {
    expect(hasPendingClarification('sit-unknown')).toBe(false)
  })
})

describe('second-pass overwrite', () => {
  it('registering a second waiter replaces the first', async () => {
    const first = waitForClarificationAnswers('sit-pass2')
    const second = waitForClarificationAnswers('sit-pass2')

    // Only one waiter active — delivering answers resolves both in practice
    // (the second waiter is the active one)
    deliverClarificationAnswers('sit-pass2', { q1: 'pass-2-answer' })

    const secondResult = await second
    expect(secondResult).toEqual({ q1: 'pass-2-answer' })

    // First promise resolves with the same answers (shared resolver after overwrite)
    // OR it never resolves (we don't care — it's been superseded)
    // The key invariant: the second waiter DOES resolve
    void first
  })
})

describe('timeout path', () => {
  it('resolves with empty answers after the timeout fires', async () => {
    const SHORT_MS = 1000
    const promise = waitForClarificationAnswers('sit-timeout', SHORT_MS)

    expect(hasPendingClarification('sit-timeout')).toBe(true)

    // Advance time past the timeout
    vi.advanceTimersByTime(SHORT_MS + 1)

    const result = await promise
    expect(result).toEqual({})
    expect(hasPendingClarification('sit-timeout')).toBe(false)
  })

  it('no longer accepts delivery after timeout fires', async () => {
    const SHORT_MS = 500
    const promise = waitForClarificationAnswers('sit-late', SHORT_MS)

    vi.advanceTimersByTime(SHORT_MS + 1)
    await promise

    // Attempting to deliver after timeout is a no-op
    expect(deliverClarificationAnswers('sit-late', { q1: 'late' })).toBe(false)
  })
})
