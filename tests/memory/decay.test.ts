/**
 * tests/memory/decay.test.ts
 * Unit tests for confidence decay and expiry logic (lib/memory/decay.ts)
 */

import { describe, it, expect } from 'vitest'
import {
  decayConfidence,
  isExpiredByConfidence,
  filterExpiredByConfidence,
  getEffectiveConfidence,
  isInferredSource,
  DECAY_RATE_PER_WEEK,
  CONFIDENCE_EXPIRY_THRESHOLD,
} from '@/lib/memory/decay'
import type { MemorySource } from '@/types/memory'

const NOW = new Date('2026-07-07T12:00:00Z')

function weeksAgo(weeks: number): Date {
  return new Date(NOW.getTime() - weeks * 7 * 24 * 60 * 60 * 1000)
}

// ── Constants ─────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('DECAY_RATE_PER_WEEK is 0.05', () => {
    expect(DECAY_RATE_PER_WEEK).toBe(0.05)
  })

  it('CONFIDENCE_EXPIRY_THRESHOLD is 0.3', () => {
    expect(CONFIDENCE_EXPIRY_THRESHOLD).toBe(0.3)
  })
})

// ── isInferredSource ──────────────────────────────────────────────────────────

describe('isInferredSource', () => {
  const inferred: MemorySource[] = ['behavior_inferred', 'action_derived']
  const stated: MemorySource[] = ['user_stated', 'clarification_answer', 'onboarding', 'user_edited']

  it('returns true for inferred sources', () => {
    for (const src of inferred) {
      expect(isInferredSource(src)).toBe(true)
    }
  })

  it('returns false for stated/confirmed sources', () => {
    for (const src of stated) {
      expect(isInferredSource(src)).toBe(false)
    }
  })
})

// ── decayConfidence ───────────────────────────────────────────────────────────

describe('decayConfidence', () => {
  it('returns original confidence when lastConfirmedAt is now (0 weeks elapsed)', () => {
    const result = decayConfidence(0.6, NOW, NOW)
    expect(result).toBeCloseTo(0.6)
  })

  it('decays by 0.05 per week (1 week)', () => {
    const result = decayConfidence(0.6, weeksAgo(1), NOW)
    expect(result).toBeCloseTo(0.6 - 0.05 * 1)
  })

  it('decays by 0.05 per week (3 weeks)', () => {
    const result = decayConfidence(0.6, weeksAgo(3), NOW)
    expect(result).toBeCloseTo(0.6 - 0.05 * 3) // 0.45
  })

  it('decays 0.6 confidence to exactly below threshold after 7 weeks', () => {
    // 0.6 - 0.05*7 = 0.25 < 0.3
    const result = decayConfidence(0.6, weeksAgo(7), NOW)
    expect(result).toBeCloseTo(0.25)
    expect(result).toBeLessThan(0.3)
  })

  it('clamps to 0 when fully decayed', () => {
    const result = decayConfidence(0.4, weeksAgo(20), NOW)
    expect(result).toBe(0)
  })

  it('never goes below 0', () => {
    const result = decayConfidence(0.1, weeksAgo(100), NOW)
    expect(result).toBeGreaterThanOrEqual(0)
  })

  it('never exceeds 1 (edge case: negative elapsed time)', () => {
    const future = new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000)
    const result = decayConfidence(0.8, future, NOW)
    expect(result).toBeLessThanOrEqual(1)
  })

  it('uses now as reference when lastConfirmedAt is null', () => {
    // null means we have no info — conservative: treat as 0 weeks elapsed
    const result = decayConfidence(0.6, null, NOW)
    expect(result).toBeCloseTo(0.6) // 0 weeks elapsed → no decay
  })

  it('correctly handles partial weeks (0.5 weeks)', () => {
    const halfWeekAgo = new Date(NOW.getTime() - 0.5 * 7 * 24 * 60 * 60 * 1000)
    const result = decayConfidence(0.8, halfWeekAgo, NOW)
    expect(result).toBeCloseTo(0.8 - 0.05 * 0.5) // 0.775
  })
})

// ── isExpiredByConfidence ─────────────────────────────────────────────────────

describe('isExpiredByConfidence', () => {
  it('returns false for user_stated regardless of confidence', () => {
    expect(isExpiredByConfidence('user_stated', 0.1, null, NOW)).toBe(false)
    expect(isExpiredByConfidence('user_stated', 0.0, weeksAgo(100), NOW)).toBe(false)
  })

  it('returns false for clarification_answer regardless of confidence', () => {
    expect(isExpiredByConfidence('clarification_answer', 0.1, null, NOW)).toBe(false)
  })

  it('returns false for onboarding source', () => {
    expect(isExpiredByConfidence('onboarding', 0.05, null, NOW)).toBe(false)
  })

  it('returns false when inferred confidence is still above threshold', () => {
    // 0.6 - 0.05*3 = 0.45 > 0.3
    expect(isExpiredByConfidence('behavior_inferred', 0.6, weeksAgo(3), NOW)).toBe(false)
  })

  it('returns true when inferred confidence decays below 0.3', () => {
    // 0.4 - 0.05*3 = 0.25 < 0.3
    expect(isExpiredByConfidence('behavior_inferred', 0.4, weeksAgo(3), NOW)).toBe(true)
  })

  it('returns true for action_derived facts that have decayed below threshold', () => {
    // 0.4 - 0.05*5 = 0.15 < 0.3
    expect(isExpiredByConfidence('action_derived', 0.4, weeksAgo(5), NOW)).toBe(true)
  })

  it('boundary: floating-point 0.6 - 0.05*6 evaluates to < 0.3 (expired)', () => {
    // IEEE 754: 0.6 - 0.05*6 = 0.29999999999999993, which IS < 0.3 → expired
    // This is the correct behavior from the implementation's perspective.
    const result = isExpiredByConfidence('behavior_inferred', 0.6, weeksAgo(6), NOW)
    expect(result).toBe(true)
  })

  it('boundary: 5 weeks of decay from 0.6 leaves 0.35 — NOT expired', () => {
    // 0.6 - 0.05*5 = 0.35 > 0.3 → not expired
    const result = isExpiredByConfidence('behavior_inferred', 0.6, weeksAgo(5), NOW)
    expect(result).toBe(false)
  })
})

// ── filterExpiredByConfidence ─────────────────────────────────────────────────

describe('filterExpiredByConfidence', () => {
  it('returns all facts when none are expired', () => {
    const facts = [
      { source: 'user_stated' as MemorySource, confidence: 1.0, lastConfirmedAt: null },
      { source: 'behavior_inferred' as MemorySource, confidence: 0.6, lastConfirmedAt: null },
    ]
    expect(filterExpiredByConfidence(facts, NOW)).toHaveLength(2)
  })

  it('filters out inferred facts whose confidence decayed below 0.3', () => {
    const expired = weeksAgo(10)
    const facts = [
      { source: 'user_stated' as MemorySource, confidence: 0.8, lastConfirmedAt: null },
      { source: 'behavior_inferred' as MemorySource, confidence: 0.6, lastConfirmedAt: expired },
      // 0.6 - 0.05*10 = 0.1 < 0.3 → expired
    ]
    const result = filterExpiredByConfidence(facts, NOW)
    expect(result).toHaveLength(1)
    expect(result[0]?.source).toBe('user_stated')
  })

  it('keeps user_stated facts even with low confidence', () => {
    const facts = [
      { source: 'user_stated' as MemorySource, confidence: 0.1, lastConfirmedAt: null },
    ]
    expect(filterExpiredByConfidence(facts, NOW)).toHaveLength(1)
  })

  it('handles empty array', () => {
    expect(filterExpiredByConfidence([], NOW)).toHaveLength(0)
  })

  it('accepts string lastConfirmedAt (ISO date string)', () => {
    const facts = [
      {
        source: 'behavior_inferred' as MemorySource,
        confidence: 0.6,
        lastConfirmedAt: weeksAgo(1).toISOString(),
      },
    ]
    // 0.6 - 0.05*1 = 0.55 > 0.3 → not expired
    expect(filterExpiredByConfidence(facts, NOW)).toHaveLength(1)
  })
})

// ── getEffectiveConfidence ────────────────────────────────────────────────────

describe('getEffectiveConfidence', () => {
  it('returns original confidence for user_stated (no decay)', () => {
    expect(getEffectiveConfidence('user_stated', 0.8, weeksAgo(10), NOW)).toBe(0.8)
  })

  it('returns decayed confidence for behavior_inferred', () => {
    const result = getEffectiveConfidence('behavior_inferred', 0.6, weeksAgo(2), NOW)
    expect(result).toBeCloseTo(0.6 - 0.05 * 2) // 0.50
  })

  it('returns decayed confidence for action_derived', () => {
    const result = getEffectiveConfidence('action_derived', 0.4, weeksAgo(1), NOW)
    expect(result).toBeCloseTo(0.4 - 0.05) // 0.35
  })
})
