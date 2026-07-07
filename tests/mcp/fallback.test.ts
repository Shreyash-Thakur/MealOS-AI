/**
 * tests/mcp/fallback.test.ts
 *
 * Tests the fallback chain:
 *   - mode=down → all tools return typed degraded responses
 *   - all-Swiggy-down → isFullyDown() signal for Planning Agent
 *   - individual tool override patterns (as used in integration tests)
 *   - singleton factory reset and mode selection
 *
 * N10 exemption: tests/mcp/ is allowed to import lib/mcp/* directly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MockSwiggyMCPClient, isDegraded } from '@/lib/mcp/mock'
import type { SwiggyRestaurantId, DineoutVenueId } from '@/types/primitives'

// lib/mcp/swiggy.ts statically imports lib/env.ts, which validates ALL boot
// env vars at module load. Stub the full required set BEFORE importing the
// module (dynamic import below), so this suite runs without a real .env.
process.env['DATABASE_URL'] ??= 'postgres://test:test@localhost:5432/test'
process.env['ANTHROPIC_API_KEY'] ??= 'test-key'
process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] ??= 'pk_test'
process.env['CLERK_SECRET_KEY'] ??= 'sk_test'
process.env['YOUTUBE_API_KEY'] ??= 'yt_test'
process.env['SWIGGY_MCP_MODE'] ??= 'mock'

const { getSwiggyClient, _resetSwiggyClientForTests } = await import('@/lib/mcp/swiggy')

const BANDRA = { lat: 19.0596, lng: 72.8295 }

// ── mode=down: full outage simulation ────────────────────────────────────────

describe('Fallback chain — SWIGGY_MCP_MODE=down (outage simulation)', () => {
  let client: MockSwiggyMCPClient

  beforeEach(() => {
    client = new MockSwiggyMCPClient('down')
  })

  it('searchRestaurants returns SWIGGY_DOWN', async () => {
    const r = await client.searchRestaurants({ query: 'biryani', location: BANDRA })
    expect(isDegraded(r)).toBe(true)
    expect((r as { errorCode: string }).errorCode).toBe('SWIGGY_DOWN')
    expect((r as { message: string }).message).toBeTruthy()
  })

  it('getRestaurantMenu returns MENU_UNAVAILABLE', async () => {
    const r = await client.getRestaurantMenu({ restaurantId: 'rms_36291' as SwiggyRestaurantId })
    expect(isDegraded(r)).toBe(true)
    expect((r as { errorCode: string }).errorCode).toBe('MENU_UNAVAILABLE')
  })

  it('createFoodCart returns SWIGGY_DOWN', async () => {
    const r = await client.createFoodCart({
      restaurantId: 'rms_36291' as SwiggyRestaurantId,
      items: [{ menuItemId: 'mi_991023', quantity: 1 }],
    })
    expect(isDegraded(r)).toBe(true)
    expect((r as { errorCode: string }).errorCode).toBe('SWIGGY_DOWN')
  })

  it('searchInstamart returns INSTAMART_DOWN', async () => {
    const r = await client.searchInstamart({ items: ['onion'], location: BANDRA })
    expect(isDegraded(r)).toBe(true)
    expect((r as { errorCode: string }).errorCode).toBe('INSTAMART_DOWN')
  })

  it('createInstamartCart returns INSTAMART_DOWN', async () => {
    const r = await client.createInstamartCart({
      items: [{ itemId: 'im_30012', quantity: 1 }],
      location: BANDRA,
    })
    expect(isDegraded(r)).toBe(true)
    expect((r as { errorCode: string }).errorCode).toBe('INSTAMART_DOWN')
  })

  it('searchDineout returns DINEOUT_DOWN', async () => {
    const r = await client.searchDineout({ location: BANDRA, partySize: 2 })
    expect(isDegraded(r)).toBe(true)
    expect((r as { errorCode: string }).errorCode).toBe('DINEOUT_DOWN')
  })

  it('getDineoutAvailability returns DINEOUT_DOWN', async () => {
    const r = await client.getDineoutAvailability({
      venueId: 'do_88231' as DineoutVenueId,
      date: '2026-07-07',
      partySize: 2,
    })
    expect(isDegraded(r)).toBe(true)
    expect((r as { errorCode: string }).errorCode).toBe('DINEOUT_DOWN')
  })

  it('createDineoutReservation returns DINEOUT_DOWN', async () => {
    const r = await client.createDineoutReservation({
      venueId: 'do_88231' as DineoutVenueId,
      slotId: 'slot_001',
      partySize: 2,
      guest: { name: 'Test', phone: '+91-1234567890' },
    })
    expect(isDegraded(r)).toBe(true)
    expect((r as { errorCode: string }).errorCode).toBe('DINEOUT_DOWN')
  })

  it('isFullyDown() returns true', () => {
    expect(client.isFullyDown()).toBe(true)
  })

  it('all degraded responses have errorCode + message fields', async () => {
    const results = await Promise.all([
      client.searchRestaurants({ query: 'test', location: BANDRA }),
      client.searchInstamart({ items: ['test'], location: BANDRA }),
      client.searchDineout({ location: BANDRA, partySize: 2 }),
    ])

    for (const r of results) {
      expect(isDegraded(r)).toBe(true)
      const d = r as { errorCode: string; message: string; available: false }
      expect(typeof d.errorCode).toBe('string')
      expect(typeof d.message).toBe('string')
      expect(d.available).toBe(false)
    }
  })
})

// ── Singleton factory ────────────────────────────────────────────────────────

describe('getSwiggyClient singleton factory', () => {
  beforeEach(() => {
    _resetSwiggyClientForTests()
  })

  afterEach(() => {
    _resetSwiggyClientForTests()
  })

  it('returns MockSwiggyMCPClient when SWIGGY_MCP_MODE=mock', () => {
    // env.SWIGGY_MCP_MODE is set to 'mock' in test environment (.env.test / vitest)
    // The singleton factory reads from env at call time.
    const client = getSwiggyClient()
    expect(client).toBeInstanceOf(MockSwiggyMCPClient)
  })

  it('returns the same instance on repeated calls (singleton)', () => {
    const a = getSwiggyClient()
    const b = getSwiggyClient()
    expect(a).toBe(b)
  })

  it('_resetSwiggyClientForTests() allows fresh instance', () => {
    getSwiggyClient()
    _resetSwiggyClientForTests()
    const fresh = getSwiggyClient()
    // After reset, a new instance is created
    expect(fresh).toBeDefined()
  })
})

// ── runWithMeta: all-down fallback signal ────────────────────────────────────

describe('runWithMeta all-down → cook-only signal', () => {
  it('when all tools fail, _meta.succeeded is empty and _meta.failed has all keys', async () => {
    const client = new MockSwiggyMCPClient('down')
    const { results, _meta } = await client.runWithMeta({
      restaurants: () => client.searchRestaurants({ query: 'test', location: BANDRA }),
      instamart: () => client.searchInstamart({ items: ['rice'], location: BANDRA }),
      dineout: () => client.searchDineout({ location: BANDRA, partySize: 2 }),
    })

    expect(_meta.succeeded).toHaveLength(0)
    expect(_meta.failed).toContain('restaurants')
    expect(_meta.failed).toContain('instamart')
    expect(_meta.failed).toContain('dineout')

    // isFullyDown() confirms the cook-only signal
    expect(client.isFullyDown()).toBe(true)

    // All results are degraded
    for (const key of Object.keys(results)) {
      expect(isDegraded(results[key as keyof typeof results])).toBe(true)
    }
  })

  it('partial failure: only instamart down, restaurants and dineout succeed', async () => {
    const client = new MockSwiggyMCPClient('mock')

    // Override instamart only
    client.searchInstamart = async () => ({
      available: false, errorCode: 'INSTAMART_DOWN', message: 'down'
    })

    const { _meta } = await client.runWithMeta({
      restaurants: () => client.searchRestaurants({ query: 'test', location: BANDRA }),
      instamart: () => client.searchInstamart({ items: ['rice'], location: BANDRA }),
      dineout: () => client.searchDineout({ location: BANDRA, partySize: 2 }),
    })

    expect(_meta.failed).toEqual(['instamart'])
    expect(_meta.succeeded).toContain('restaurants')
    expect(_meta.succeeded).toContain('dineout')

    // isFullyDown() should still be false — not everything is down
    expect(client.isFullyDown()).toBe(false)
  })
})

// ── Degraded response shape invariants ──────────────────────────────────────

describe('Degraded response shape invariants', () => {
  it('isDegraded() returns true only for {available: false} objects', () => {
    expect(isDegraded({ available: false, errorCode: 'SWIGGY_DOWN', message: 'test' })).toBe(true)
    expect(isDegraded([])).toBe(false)
    expect(isDegraded({ available: true })).toBe(false)
    expect(isDegraded({ name: 'restaurant' })).toBe(false)
  })

  it('degraded response always has available=false', async () => {
    const client = new MockSwiggyMCPClient('down')
    const r = await client.searchRestaurants({ query: 'test', location: BANDRA })
    expect((r as { available: boolean }).available).toBe(false)
  })
})
