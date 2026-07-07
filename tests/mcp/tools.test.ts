/**
 * tests/mcp/tools.test.ts
 *
 * Tests every tool on MockSwiggyMCPClient:
 *   - searchRestaurants (food delivery)
 *   - getRestaurantMenu
 *   - createFoodCart
 *   - searchInstamart
 *   - createInstamartCart
 *   - searchDineout
 *   - getDineoutAvailability
 *   - createDineoutReservation
 *
 * Also verifies the 8-code error taxonomy and partial-failure _meta contract.
 *
 * N10 exemption: tests/mcp/ is allowed to import lib/mcp/* directly (see
 * eslint.config.mjs — "Exempt MCP unit tests").
 */

import { describe, it, expect } from 'vitest'
import { MockSwiggyMCPClient, isDegraded } from '@/lib/mcp/mock'
import type { SwiggyRestaurantId, DineoutVenueId } from '@/types/primitives'

// ── Helpers ─────────────────────────────────────────────────────────────────

const BANDRA = { lat: 19.0596, lng: 72.8295 }

function mockClient(): MockSwiggyMCPClient {
  return new MockSwiggyMCPClient('mock')
}

// ── searchRestaurants ────────────────────────────────────────────────────────

describe('MockSwiggyMCPClient.searchRestaurants', () => {
  it('returns typed Restaurant[] for a general query', async () => {
    const client = mockClient()
    const result = await client.searchRestaurants({
      query: 'comfort food',
      location: BANDRA,
    })

    expect(isDegraded(result)).toBe(false)
    const restaurants = result as Awaited<ReturnType<MockSwiggyMCPClient['searchRestaurants']>> & unknown[]
    expect(Array.isArray(restaurants)).toBe(true)
    expect(restaurants.length).toBeGreaterThan(0)
    // All results have required Restaurant fields
    const r = restaurants[0]!
    expect(r).toHaveProperty('restaurantId')
    expect(r).toHaveProperty('name')
    expect(r).toHaveProperty('rating')
    expect(r).toHaveProperty('deliveryTimeMin')
    expect(r).toHaveProperty('cuisineTypes')
    expect(r).toHaveProperty('topItems')
  })

  it('filters to vegetarian-only restaurants when vegetarianOnly=true', async () => {
    const client = mockClient()
    const result = await client.searchRestaurants({
      query: 'vegetarian',
      location: BANDRA,
      vegetarianOnly: true,
    })

    expect(isDegraded(result)).toBe(false)
    const restaurants = result as ReturnType<typeof Array.prototype.filter>
    // All returned restaurants must be in the veg-only fixture set
    const vegIds = new Set(['rms_36291', 'rms_66123'])
    for (const r of restaurants as { restaurantId: string }[]) {
      expect(vegIds.has(r.restaurantId)).toBe(true)
    }
  })

  it('applies minRating filter', async () => {
    const client = mockClient()
    const result = await client.searchRestaurants({
      query: 'anything',
      location: BANDRA,
      minRating: 4.4,
    })

    expect(isDegraded(result)).toBe(false)
    for (const r of result as { rating: number }[]) {
      expect(r.rating).toBeGreaterThanOrEqual(4.4)
    }
  })

  it('applies maxDeliveryMinutes filter', async () => {
    const client = mockClient()
    const result = await client.searchRestaurants({
      query: 'quick',
      location: BANDRA,
      maxDeliveryMinutes: 30,
    })

    expect(isDegraded(result)).toBe(false)
    for (const r of result as { deliveryTimeMin: number }[]) {
      expect(r.deliveryTimeMin).toBeLessThanOrEqual(30)
    }
  })

  it('applies limit', async () => {
    const client = mockClient()
    const result = await client.searchRestaurants({
      query: 'anything',
      location: BANDRA,
      limit: 2,
    })

    expect(isDegraded(result)).toBe(false)
    expect((result as unknown[]).length).toBeLessThanOrEqual(2)
  })

  it('returns SWIGGY_DOWN when mode=down', async () => {
    const client = new MockSwiggyMCPClient('down')
    const result = await client.searchRestaurants({ query: 'biryani', location: BANDRA })

    expect(isDegraded(result)).toBe(true)
    expect((result as { errorCode: string }).errorCode).toBe('SWIGGY_DOWN')
  })

  it('filters by cuisine types', async () => {
    const client = mockClient()
    const result = await client.searchRestaurants({
      query: 'biryani',
      location: BANDRA,
      cuisines: ['Biryani'],
    })

    expect(isDegraded(result)).toBe(false)
    const restaurants = result as { cuisineTypes: string[] }[]
    for (const r of restaurants) {
      expect(r.cuisineTypes).toContain('Biryani')
    }
  })
})

// ── getRestaurantMenu ────────────────────────────────────────────────────────

describe('MockSwiggyMCPClient.getRestaurantMenu', () => {
  it('returns MenuOutput for a known restaurant ID', async () => {
    const client = mockClient()
    const result = await client.getRestaurantMenu({
      restaurantId: 'rms_36291' as SwiggyRestaurantId,
    })

    expect(isDegraded(result)).toBe(false)
    const menu = result as { restaurantId: string; categories: unknown[] }
    expect(menu.restaurantId).toBe('rms_36291')
    expect(menu.categories.length).toBeGreaterThan(0)
  })

  it('returns MENU_UNAVAILABLE when mode=down', async () => {
    const client = new MockSwiggyMCPClient('down')
    const result = await client.getRestaurantMenu({
      restaurantId: 'rms_36291' as SwiggyRestaurantId,
    })

    expect(isDegraded(result)).toBe(true)
    expect((result as { errorCode: string }).errorCode).toBe('MENU_UNAVAILABLE')
  })

  it('has lastUpdatedAt timestamp', async () => {
    const client = mockClient()
    const result = await client.getRestaurantMenu({
      restaurantId: 'rms_44102' as SwiggyRestaurantId,
    })

    expect(isDegraded(result)).toBe(false)
    expect((result as { lastUpdatedAt: string }).lastUpdatedAt).toBeTruthy()
  })
})

// ── createFoodCart ───────────────────────────────────────────────────────────

describe('MockSwiggyMCPClient.createFoodCart', () => {
  it('returns a valid cart with deepLink and webFallbackUrl', async () => {
    const client = mockClient()
    const result = await client.createFoodCart({
      restaurantId: 'rms_36291' as SwiggyRestaurantId,
      items: [{ menuItemId: 'mi_991023', quantity: 1 }],
    })

    expect(isDegraded(result)).toBe(false)
    const cart = result as { cartId: string; deepLink: string; webFallbackUrl: string; expiresAt: string; summary: object }
    expect(cart.cartId).toBeTruthy()
    expect(cart.deepLink).toContain('swiggy://')
    expect(cart.webFallbackUrl).toContain('https://')
    expect(cart.expiresAt).toBeTruthy()
    expect(cart.summary).toBeDefined()
  })

  it('includes itemCount in summary', async () => {
    const client = mockClient()
    const result = await client.createFoodCart({
      restaurantId: 'rms_36291' as SwiggyRestaurantId,
      items: [
        { menuItemId: 'mi_991023', quantity: 2 },
        { menuItemId: 'mi_991024', quantity: 1 },
      ],
    })

    expect(isDegraded(result)).toBe(false)
    const cart = result as { summary: { itemCount: number } }
    expect(cart.summary.itemCount).toBe(3)  // 2 + 1
  })

  it('returns SWIGGY_DOWN when mode=down', async () => {
    const client = new MockSwiggyMCPClient('down')
    const result = await client.createFoodCart({
      restaurantId: 'rms_36291' as SwiggyRestaurantId,
      items: [{ menuItemId: 'mi_991023', quantity: 1 }],
    })
    expect(isDegraded(result)).toBe(true)
    expect((result as { errorCode: string }).errorCode).toBe('SWIGGY_DOWN')
  })
})

// ── searchInstamart ──────────────────────────────────────────────────────────

describe('MockSwiggyMCPClient.searchInstamart', () => {
  it('returns found=true for known ingredients', async () => {
    const client = mockClient()
    const result = await client.searchInstamart({
      items: ['ginger-garlic paste', 'basmati rice'],
      location: BANDRA,
    })

    expect(isDegraded(result)).toBe(false)
    const r = result as { items: { found: boolean; item: string }[]; storeOpen: boolean; estimatedDeliveryMinutes: number }
    expect(r.storeOpen).toBe(true)
    expect(r.estimatedDeliveryMinutes).toBeGreaterThan(0)
    expect(r.items.length).toBe(2)
    expect(r.items[0]!.found).toBe(true)
    expect(r.items[1]!.found).toBe(true)
  })

  it('normalizes compound ingredient names (hyphen → space lookup)', async () => {
    const client = mockClient()
    // "ginger-garlic paste" normalizes to "ginger-garlic paste" (normalized)
    // fixture map also has "ginger garlic paste" (simplified)
    const result = await client.searchInstamart({
      items: ['ginger-garlic paste'],
      location: BANDRA,
    })
    expect(isDegraded(result)).toBe(false)
    const r = result as { items: { found: boolean }[] }
    expect(r.items[0]!.found).toBe(true)
  })

  it('returns found=false for unknown ingredients', async () => {
    const client = mockClient()
    const result = await client.searchInstamart({
      items: ['saffron'],
      location: BANDRA,
    })

    expect(isDegraded(result)).toBe(false)
    const r = result as { items: { found: boolean; item: string }[] }
    expect(r.items[0]!.found).toBe(false)
    expect(r.items[0]!.item).toBe('saffron')
  })

  it('applies maxPricePerItemInr — expensive items return found=false', async () => {
    const client = mockClient()
    // basmati rice costs ₹189 in fixture
    const result = await client.searchInstamart({
      items: ['basmati rice'],
      location: BANDRA,
      maxPricePerItemInr: 100,  // below ₹189
    })

    expect(isDegraded(result)).toBe(false)
    const r = result as { items: { found: boolean }[] }
    expect(r.items[0]!.found).toBe(false)
  })

  it('returns INSTAMART_DOWN when mode=down', async () => {
    const client = new MockSwiggyMCPClient('down')
    const result = await client.searchInstamart({
      items: ['onion'],
      location: BANDRA,
    })
    expect(isDegraded(result)).toBe(true)
    expect((result as { errorCode: string }).errorCode).toBe('INSTAMART_DOWN')
  })

  it('handles mixed found/unfound items', async () => {
    const client = mockClient()
    const result = await client.searchInstamart({
      items: ['basmati rice', 'saffron', 'onion'],
      location: BANDRA,
    })
    expect(isDegraded(result)).toBe(false)
    const r = result as { items: { found: boolean; item: string }[] }
    expect(r.items.length).toBe(3)
    const foundMap = Object.fromEntries(r.items.map(i => [i.item, i.found]))
    expect(foundMap['basmati rice']).toBe(true)
    expect(foundMap['saffron']).toBe(false)
    expect(foundMap['onion']).toBe(true)
  })
})

// ── createInstamartCart ──────────────────────────────────────────────────────

describe('MockSwiggyMCPClient.createInstamartCart', () => {
  it('returns a valid Instamart cart', async () => {
    const client = mockClient()
    const result = await client.createInstamartCart({
      items: [
        { itemId: 'im_30012', quantity: 1 },
        { itemId: 'im_10023', quantity: 1 },
      ],
      location: BANDRA,
    })

    expect(isDegraded(result)).toBe(false)
    const cart = result as {
      cartId: string; deepLink: string; webFallbackUrl: string
      unavailableItems: unknown[]; expiresAt: string
      summary: { itemCount: number }
    }
    expect(cart.cartId).toBeTruthy()
    expect(cart.deepLink).toContain('instamart')
    expect(cart.webFallbackUrl).toContain('instamart')
    expect(cart.unavailableItems).toEqual([])
    expect(cart.expiresAt).toBeTruthy()
    expect(cart.summary.itemCount).toBe(2)
  })

  it('returns INSTAMART_DOWN when mode=down', async () => {
    const client = new MockSwiggyMCPClient('down')
    const result = await client.createInstamartCart({
      items: [{ itemId: 'im_30012', quantity: 1 }],
      location: BANDRA,
    })
    expect(isDegraded(result)).toBe(true)
    expect((result as { errorCode: string }).errorCode).toBe('INSTAMART_DOWN')
  })
})

// ── searchDineout ────────────────────────────────────────────────────────────

describe('MockSwiggyMCPClient.searchDineout', () => {
  it('returns DineoutVenue[] for date occasion', async () => {
    const client = mockClient()
    const result = await client.searchDineout({
      location: BANDRA,
      occasion: 'date',
      partySize: 2,
    })

    expect(isDegraded(result)).toBe(false)
    const venues = result as { venueId: string; name: string; availableSlots: string[] }[]
    expect(venues.length).toBeGreaterThan(0)
    const v = venues[0]!
    expect(v).toHaveProperty('venueId')
    expect(v).toHaveProperty('name')
    expect(Array.isArray(v.availableSlots)).toBe(true)
  })

  it('filters by budgetPerPersonInr', async () => {
    const client = mockClient()
    const result = await client.searchDineout({
      location: BANDRA,
      partySize: 2,
      budgetPerPersonInr: 900,  // below Bastian (₹1400) and Trattoria (₹1200)
    })

    expect(isDegraded(result)).toBe(false)
    const venues = result as { pricePerPerson: number }[]
    for (const v of venues) {
      expect(v.pricePerPerson).toBeLessThanOrEqual(900)
    }
  })

  it('applies limit', async () => {
    const client = mockClient()
    const result = await client.searchDineout({
      location: BANDRA,
      partySize: 2,
      limit: 1,
    })
    expect(isDegraded(result)).toBe(false)
    expect((result as unknown[]).length).toBeLessThanOrEqual(1)
  })

  it('returns DINEOUT_DOWN when mode=down', async () => {
    const client = new MockSwiggyMCPClient('down')
    const result = await client.searchDineout({ location: BANDRA, partySize: 2 })
    expect(isDegraded(result)).toBe(true)
    expect((result as { errorCode: string }).errorCode).toBe('DINEOUT_DOWN')
  })
})

// ── getDineoutAvailability ───────────────────────────────────────────────────

describe('MockSwiggyMCPClient.getDineoutAvailability', () => {
  it('returns available slots for a known venue', async () => {
    const client = mockClient()
    const result = await client.getDineoutAvailability({
      venueId: 'do_88231' as DineoutVenueId,  // Trattoria Cielo
      date: '2026-07-07',
      partySize: 2,
    })

    expect(isDegraded(result)).toBe(false)
    const avail = result as { slots: { slotId: string; time: string; available: boolean }[]; lastCheckedAt: string }
    expect(avail.slots.length).toBeGreaterThan(0)
    for (const slot of avail.slots) {
      expect(slot.available).toBe(true)
      expect(slot.slotId).toBeTruthy()
      expect(slot.time).toBeTruthy()
    }
    expect(avail.lastCheckedAt).toBeTruthy()
  })

  it('returns 0 slots for a fully-booked venue', async () => {
    const client = mockClient()
    const result = await client.getDineoutAvailability({
      venueId: 'do_60321' as DineoutVenueId,  // Trishna — 0 availableSlots in fixture
      date: '2026-07-07',
      partySize: 2,
    })

    // Mock returns empty slots list for Trishna
    expect(isDegraded(result)).toBe(false)
    const avail = result as { slots: unknown[] }
    expect(avail.slots.length).toBe(0)
  })

  it('returns DINEOUT_DOWN when mode=down', async () => {
    const client = new MockSwiggyMCPClient('down')
    const result = await client.getDineoutAvailability({
      venueId: 'do_88231' as DineoutVenueId,
      date: '2026-07-07',
      partySize: 2,
    })
    expect(isDegraded(result)).toBe(true)
    expect((result as { errorCode: string }).errorCode).toBe('DINEOUT_DOWN')
  })
})

// ── createDineoutReservation ─────────────────────────────────────────────────

describe('MockSwiggyMCPClient.createDineoutReservation', () => {
  it('returns a confirmed DineoutReservation', async () => {
    const client = mockClient()
    const result = await client.createDineoutReservation({
      venueId: 'do_88231' as DineoutVenueId,
      slotId: 'slot_001',
      partySize: 2,
      guest: { name: 'Shreyash', phone: '+91-9999999999' },
    })

    expect(isDegraded(result)).toBe(false)
    const reservation = result as {
      venueId: string; venueName: string; partySize: number
      status: string; reservationId: string; bookingUrl: string; dateTime: string
    }
    expect(reservation.venueId).toBe('do_88231')
    expect(reservation.partySize).toBe(2)
    expect(reservation.status).toBe('confirmed')
    expect(reservation.reservationId).toBeTruthy()
    expect(reservation.bookingUrl).toBeTruthy()
    expect(reservation.dateTime).toBeTruthy()
  })

  it('returns DINEOUT_DOWN when mode=down', async () => {
    const client = new MockSwiggyMCPClient('down')
    const result = await client.createDineoutReservation({
      venueId: 'do_88231' as DineoutVenueId,
      slotId: 'slot_001',
      partySize: 2,
      guest: { name: 'Test', phone: '+91-1234567890' },
    })
    expect(isDegraded(result)).toBe(true)
    expect((result as { errorCode: string }).errorCode).toBe('DINEOUT_DOWN')
  })
})

// ── Error taxonomy: all 8 codes are reachable ────────────────────────────────

describe('Error taxonomy — 8 codes are reachable from mock', () => {
  it('SWIGGY_DOWN via mode=down food', async () => {
    const client = new MockSwiggyMCPClient('down')
    const r = await client.searchRestaurants({ query: 'test', location: BANDRA })
    expect(isDegraded(r)).toBe(true)
    expect((r as { errorCode: string }).errorCode).toBe('SWIGGY_DOWN')
  })

  it('INSTAMART_DOWN via mode=down instamart', async () => {
    const client = new MockSwiggyMCPClient('down')
    const r = await client.searchInstamart({ items: ['rice'], location: BANDRA })
    expect(isDegraded(r)).toBe(true)
    expect((r as { errorCode: string }).errorCode).toBe('INSTAMART_DOWN')
  })

  it('DINEOUT_DOWN via mode=down dineout', async () => {
    const client = new MockSwiggyMCPClient('down')
    const r = await client.searchDineout({ location: BANDRA, partySize: 2 })
    expect(isDegraded(r)).toBe(true)
    expect((r as { errorCode: string }).errorCode).toBe('DINEOUT_DOWN')
  })

  it('MENU_UNAVAILABLE via mode=down getRestaurantMenu', async () => {
    const client = new MockSwiggyMCPClient('down')
    const r = await client.getRestaurantMenu({ restaurantId: 'rms_36291' as SwiggyRestaurantId })
    expect(isDegraded(r)).toBe(true)
    expect((r as { errorCode: string }).errorCode).toBe('MENU_UNAVAILABLE')
  })

  it('tool override to simulate SWIGGY_DOWN on searchRestaurants', async () => {
    const client = mockClient()
    // Simulate SWIGGY_DOWN by method override (as shown in docs §9)
    client.searchRestaurants = async () => ({
      available: false,
      errorCode: 'SWIGGY_DOWN',
      message: 'Swiggy is temporarily unavailable.',
    })
    const r = await client.searchRestaurants({ query: 'test', location: BANDRA })
    expect(isDegraded(r)).toBe(true)
    expect((r as { errorCode: string }).errorCode).toBe('SWIGGY_DOWN')
  })

  it('tool override to simulate RATE_LIMITED', async () => {
    const client = mockClient()
    client.searchRestaurants = async () => ({
      available: false,
      errorCode: 'RATE_LIMITED',
      message: 'Too many requests.',
    })
    const r = await client.searchRestaurants({ query: 'test', location: BANDRA })
    expect(isDegraded(r)).toBe(true)
    expect((r as { errorCode: string }).errorCode).toBe('RATE_LIMITED')
  })

  it('tool override to simulate NO_RESULTS', async () => {
    const client = mockClient()
    client.searchRestaurants = async () => ({
      available: false,
      errorCode: 'NO_RESULTS',
      message: 'No results.',
    })
    const r = await client.searchRestaurants({ query: 'test', location: BANDRA })
    expect(isDegraded(r)).toBe(true)
    expect((r as { errorCode: string }).errorCode).toBe('NO_RESULTS')
  })

  it('tool override to simulate LOCATION_NOT_SERVICEABLE', async () => {
    const client = mockClient()
    client.searchInstamart = async () => ({
      available: false,
      errorCode: 'LOCATION_NOT_SERVICEABLE',
      message: 'Not serviceable.',
    })
    const r = await client.searchInstamart({ items: ['rice'], location: { lat: 0, lng: 0 } })
    expect(isDegraded(r)).toBe(true)
    expect((r as { errorCode: string }).errorCode).toBe('LOCATION_NOT_SERVICEABLE')
  })

  it('tool override to simulate NO_AVAILABILITY', async () => {
    const client = mockClient()
    client.getDineoutAvailability = async () => ({
      available: false,
      errorCode: 'NO_AVAILABILITY',
      message: 'No slots.',
    })
    const r = await client.getDineoutAvailability({
      venueId: 'do_60321' as DineoutVenueId,
      date: '2026-07-07',
      partySize: 10,
    })
    expect(isDegraded(r)).toBe(true)
    expect((r as { errorCode: string }).errorCode).toBe('NO_AVAILABILITY')
  })
})

// ── Partial failure _meta contract ───────────────────────────────────────────

describe('Partial failure _meta contract (ISSUE-122)', () => {
  it('runWithMeta: all succeed → _meta.succeeded has all keys', async () => {
    const client = mockClient()
    const { results, _meta } = await client.runWithMeta({
      restaurants: () => client.searchRestaurants({ query: 'comfort food', location: BANDRA }),
      instamart: () => client.searchInstamart({ items: ['rice'], location: BANDRA }),
    })

    expect(_meta.succeeded).toContain('restaurants')
    expect(_meta.succeeded).toContain('instamart')
    expect(_meta.failed).toHaveLength(0)
    expect(isDegraded(results.restaurants)).toBe(false)
    expect(isDegraded(results.instamart)).toBe(false)
  })

  it('runWithMeta: one degraded → _meta.failed contains its key, others succeed', async () => {
    const client = mockClient()

    // Make instamart return degraded
    const originalInstamart = client.searchInstamart.bind(client)
    client.searchInstamart = async () => ({
      available: false, errorCode: 'INSTAMART_DOWN', message: 'down'
    })

    const { results, _meta } = await client.runWithMeta({
      restaurants: () => client.searchRestaurants({ query: 'food', location: BANDRA }),
      instamart: () => client.searchInstamart({ items: ['rice'], location: BANDRA }),
    })

    expect(_meta.failed).toContain('instamart')
    expect(_meta.succeeded).toContain('restaurants')
    expect(isDegraded(results.restaurants)).toBe(false)
    expect(isDegraded(results.instamart)).toBe(true)

    // Restore
    client.searchInstamart = originalInstamart
  })

  it('isFullyDown()=true when mode=down', () => {
    const client = new MockSwiggyMCPClient('down')
    expect(client.isFullyDown()).toBe(true)
  })

  it('isFullyDown()=false when mode=mock', () => {
    const client = mockClient()
    expect(client.isFullyDown()).toBe(false)
  })
})
