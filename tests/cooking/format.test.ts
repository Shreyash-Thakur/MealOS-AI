/**
 * tests/cooking/format.test.ts
 * Unit tests for cooking UI formatting helpers (components/cooking/format.ts,
 * ISSUE-132: duration displayed as MM:SS).
 */

import { describe, it, expect } from 'vitest'

const { formatDuration } = await import('@/components/cooking/format')

describe('formatDuration', () => {
  it.each([
    [754, '12:34'],
    [45, '0:45'],
    [600, '10:00'],
    [3723, '62:03'],   // > 1h stays MM:SS per the card spec
    [0, '0:00'],
  ])('formats %d seconds as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected)
  })

  it('clamps negative input to 0:00', () => {
    expect(formatDuration(-5)).toBe('0:00')
  })

  it('floors fractional seconds', () => {
    expect(formatDuration(90.9)).toBe('1:30')
  })
})
