/**
 * tests/cooking/pantryCheck.test.ts
 * Unit tests for the pantry gap check (lib/cooking/pantry.ts, ISSUE-134)
 *
 * Contract under test (issue AC + playbook M7 DoD):
 *   1. Reads only the pantry fact key ('pantry.staples') from user memory
 *   2. Returns {have, missing}; never throws — empty/absent/corrupt pantry
 *      means everything is missing
 *   3. Case-insensitive partial match: "Basmati Rice" matches the stored
 *      pantry label "basmati rice 1kg"
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env['DATABASE_URL'] ??= 'postgres://test:test@localhost:5432/test'
process.env['ANTHROPIC_API_KEY'] ??= 'test-key'
process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] ??= 'pk_test'
process.env['CLERK_SECRET_KEY'] ??= 'sk_test'
process.env['YOUTUBE_API_KEY'] ??= 'yt_test'
process.env['SWIGGY_MCP_MODE'] ??= 'mock'

vi.mock('@/lib/repositories/memoryFactRepo', () => ({
  getFactByKey: vi.fn(),
}))

const { checkPantryGaps } = await import('@/lib/cooking/pantry')
const { getFactByKey } = await import('@/lib/repositories/memoryFactRepo')

const mockGetFactByKey = vi.mocked(getFactByKey)

function pantryFact(staples: unknown) {
  return {
    factKey: 'pantry.staples',
    factValue: staples as never,
    confidence: 1,
    source: 'ONBOARDING' as never,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('checkPantryGaps', () => {
  it('reads only the pantry.staples fact key', async () => {
    mockGetFactByKey.mockResolvedValue(pantryFact(['rice']))

    await checkPantryGaps(['rice'], 'u-1')

    expect(mockGetFactByKey).toHaveBeenCalledExactlyOnceWith('u-1', 'pantry.staples')
  })

  it('splits ingredients into have/missing against the pantry', async () => {
    mockGetFactByKey.mockResolvedValue(pantryFact(['basmati rice', 'toor dal', 'ghee']))

    const result = await checkPantryGaps(['basmati rice', 'toor dal', 'paneer'], 'u-1')

    expect(result.have).toEqual(['basmati rice', 'toor dal'])
    expect(result.missing).toEqual(['paneer'])
  })

  it('matches case-insensitively and on partial labels ("Basmati Rice" vs "basmati rice 1kg")', async () => {
    mockGetFactByKey.mockResolvedValue(pantryFact(['basmati rice 1kg', 'GHEE (Amul)']))

    const result = await checkPantryGaps(['Basmati Rice', 'ghee', 'onion'], 'u-1')

    expect(result.have).toEqual(['Basmati Rice', 'ghee'])
    expect(result.missing).toEqual(['onion'])
  })

  it('returns everything as missing on an empty pantry (never throws)', async () => {
    mockGetFactByKey.mockResolvedValue(pantryFact([]))

    const result = await checkPantryGaps(['rice', 'dal'], 'u-1')

    expect(result.have).toEqual([])
    expect(result.missing).toEqual(['rice', 'dal'])
  })

  it('returns everything as missing when no pantry fact exists', async () => {
    mockGetFactByKey.mockResolvedValue(null)

    const result = await checkPantryGaps(['rice'], 'u-1')

    expect(result).toEqual({ have: [], missing: ['rice'] })
  })

  it('treats a corrupt (non-array) pantry value as empty', async () => {
    mockGetFactByKey.mockResolvedValue(pantryFact('not-an-array'))

    const result = await checkPantryGaps(['rice'], 'u-1')

    expect(result).toEqual({ have: [], missing: ['rice'] })
  })

  it('ignores non-string entries inside the pantry array', async () => {
    mockGetFactByKey.mockResolvedValue(pantryFact(['rice', 42, null]))

    const result = await checkPantryGaps(['rice', 'dal'], 'u-1')

    expect(result).toEqual({ have: ['rice'], missing: ['dal'] })
  })

  it('returns everything as missing when the fact read fails (never throws)', async () => {
    mockGetFactByKey.mockRejectedValue(new Error('db down'))

    const result = await checkPantryGaps(['rice'], 'u-1')

    expect(result).toEqual({ have: [], missing: ['rice'] })
  })

  it('handles an empty ingredient list', async () => {
    mockGetFactByKey.mockResolvedValue(pantryFact(['rice']))

    const result = await checkPantryGaps([], 'u-1')

    expect(result).toEqual({ have: [], missing: [] })
  })
})
