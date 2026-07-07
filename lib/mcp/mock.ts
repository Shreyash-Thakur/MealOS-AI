/**
 * MealOS AI — MockSwiggyMCPClient
 *
 * Selected when SWIGGY_MCP_MODE=mock (or SWIGGY_MCP_MODE=down for outage sim).
 *
 * Rule N2: the mock defines the internal contract. The real client (swiggy.ts)
 * conforms to this class's method signatures, never the reverse.
 *
 * Every public method on SwiggyMCPClient must have a corresponding override here.
 * Fixtures live in fixtures/{restaurants,instamart,dineout}.ts.
 *
 * 'down' mode: every tool immediately returns a typed degraded response.
 */

import type { Restaurant, InstamartResult, DineoutVenue, DineoutReservation } from '@/types/swiggy'
import type { SwiggyRestaurantId, DineoutVenueId, Rupees, Minutes, ISODateTime } from '@/types/primitives'
import { mockRestaurants, vegOnlyRestaurants } from './fixtures/restaurants'
import { instamartFixtureMap } from './fixtures/instamart'
import { mockDineoutVenues, availableDineoutVenues, mockReservation } from './fixtures/dineout'
import { classifyError, errorMessage } from './errors'
import { normalizeIngredient, simplifyIngredient } from './normalize'

// ── Shared types for method signatures ──────────────────────────────────────

export interface SearchRestaurantsParams {
  query: string
  location: { lat: number; lng: number }
  vegetarianOnly?: boolean
  maxDeliveryMinutes?: number
  maxMinOrderInr?: number
  cuisines?: string[]
  minRating?: number
  limit?: number
}

export interface SearchInstamartParams {
  items: string[]
  location: { lat: number; lng: number }
  maxPricePerItemInr?: number
}

export interface SearchDineoutParams {
  location: { lat: number; lng: number }
  occasion?: 'date' | 'family' | 'business' | 'casual' | 'celebration'
  partySize: number
  budgetPerPersonInr?: number
  cuisines?: string[]
  date?: string
  maxDistanceKm?: number
  limit?: number
}

export interface GetMenuParams {
  restaurantId: SwiggyRestaurantId
  categoryFilter?: string
}

export interface CreateFoodCartParams {
  restaurantId: SwiggyRestaurantId
  items: { menuItemId: string; quantity: number; customizations?: { customizationId: string; selectedOptionIds: string[] }[] }[]
  userId?: string
}

export interface CreateInstamartCartParams {
  items: { itemId: string; quantity: number }[]
  location: { lat: number; lng: number }
  userId?: string
}

export interface GetDineoutAvailabilityParams {
  venueId: DineoutVenueId
  date: string
  partySize: number
}

export interface CreateDineoutReservationParams {
  venueId: DineoutVenueId
  slotId: string
  partySize: number
  guest: { name: string; phone: string; email?: string }
  specialRequests?: string
}

// ── Cart output shapes (not re-exported from types/swiggy.ts) ───────────────

export interface FoodCartOutput {
  cartId: string
  deepLink: string
  webFallbackUrl: string
  summary: {
    itemCount: number
    subtotal: Rupees
    deliveryCost: Rupees
    estimatedTotal: Rupees
    estimatedDeliveryMinutes: Minutes
  }
  expiresAt: ISODateTime
}

export interface InstamartCartOutput {
  cartId: string
  deepLink: string
  webFallbackUrl: string
  summary: {
    itemCount: number
    subtotal: Rupees
    deliveryCost: Rupees
    estimatedTotal: Rupees
    estimatedDeliveryMinutes: Minutes
  }
  unavailableItems: {
    itemId: string
    reason: 'OUT_OF_STOCK' | 'STORE_CLOSED' | 'ITEM_REMOVED'
    substitute?: { itemId: string; name: string; price: Rupees }
  }[]
  expiresAt: ISODateTime
}

export interface MenuOutput {
  restaurantId: SwiggyRestaurantId
  restaurantName: string
  categories: {
    name: string
    items: {
      id: string
      name: string
      priceInr: Rupees
      isVeg: boolean
      isAvailable: boolean
      nutritionEstimate?: { calories?: number; proteinG?: number }
    }[]
  }[]
  lastUpdatedAt: ISODateTime
}

// Degraded tool result shape
export interface Degraded {
  available: false
  errorCode: string
  message: string
}

export type ToolResult<T> = T | Degraded

export function isDegraded(r: ToolResult<unknown>): r is Degraded {
  return (r as Degraded).available === false
}

// ── MockSwiggyMCPClient ──────────────────────────────────────────────────────

/**
 * MockSwiggyMCPClient — selected via SWIGGY_MCP_MODE=mock.
 *
 * All methods are async to be API-compatible with the real client.
 * Methods are public so tests can override individual tools:
 *
 *   const client = new MockSwiggyMCPClient()
 *   client.searchRestaurants = async () => ({ available: false, errorCode: 'SWIGGY_DOWN', message: '…' })
 */
export class MockSwiggyMCPClient {
  private readonly mode: 'mock' | 'down'

  constructor(mode: 'mock' | 'down' = 'mock') {
    this.mode = mode
  }

  /** Lazy connect no-op — mock never connects to a real server. */
  async connect(): Promise<void> {
    // no-op
  }

  // ── Degraded factory ────────────────────────────────────────────────────

  private down(context: 'food' | 'instamart' | 'dineout'): Degraded {
    const code = context === 'instamart' ? 'INSTAMART_DOWN'
               : context === 'dineout'   ? 'DINEOUT_DOWN'
               : 'SWIGGY_DOWN'
    return { available: false, errorCode: code, message: errorMessage(classifyError({ code }, context)) }
  }

  // ── Food Delivery ────────────────────────────────────────────────────────

  async searchRestaurants(params: SearchRestaurantsParams): Promise<ToolResult<Restaurant[]>> {
    if (this.mode === 'down') return this.down('food')

    let results = params.vegetarianOnly
      ? vegOnlyRestaurants
      : mockRestaurants

    if (params.minRating !== undefined) {
      results = results.filter(r => r.rating >= params.minRating!)
    }
    if (params.maxDeliveryMinutes !== undefined) {
      results = results.filter(r => r.deliveryTimeMin <= params.maxDeliveryMinutes!)
    }
    if (params.maxMinOrderInr !== undefined) {
      results = results.filter(r => r.minOrderValue <= params.maxMinOrderInr!)
    }
    if (params.cuisines && params.cuisines.length > 0) {
      const cuisineSet = new Set(params.cuisines.map(c => c.toLowerCase()))
      results = results.filter(r =>
        r.cuisineTypes.some(ct => cuisineSet.has(ct.toLowerCase()))
      )
    }

    const limit = params.limit ?? 10
    return results.slice(0, limit)
  }

  async getRestaurantMenu(params: GetMenuParams): Promise<ToolResult<MenuOutput>> {
    if (this.mode === 'down') {
      return { available: false, errorCode: 'MENU_UNAVAILABLE', message: errorMessage('MENU_UNAVAILABLE') }
    }

    // Return a minimal mock menu for any restaurant ID
    const restaurant = mockRestaurants.find(r => r.restaurantId === params.restaurantId)
    const name = restaurant?.name ?? 'Mock Restaurant'

    return {
      restaurantId: params.restaurantId,
      restaurantName: name,
      categories: [
        {
          name: params.categoryFilter ?? 'Mains',
          items: (restaurant?.topItems ?? []).map((item, i) => ({
            id: `mi_mock_${i}`,
            name: item.name,
            priceInr: item.price,
            isVeg: item.isVeg,
            isAvailable: true,
            nutritionEstimate: item.proteinG !== undefined
              ? { proteinG: item.proteinG, calories: undefined }
              : undefined,
          })),
        },
      ],
      lastUpdatedAt: '2026-07-07T10:00:00+05:30' as ISODateTime,
    }
  }

  async createFoodCart(params: CreateFoodCartParams): Promise<ToolResult<FoodCartOutput>> {
    if (this.mode === 'down') return this.down('food')

    const itemCount = params.items.reduce((n, i) => n + i.quantity, 0)
    const subtotal = 149 as Rupees

    return {
      cartId: 'mock_cart_food_001',
      deepLink: 'swiggy://open?screen=cart&cartId=mock_cart_food_001&source=mealos',
      webFallbackUrl: 'https://www.swiggy.com/open?cartId=mock_cart_food_001&source=mealos',
      summary: {
        itemCount,
        subtotal,
        deliveryCost: 0 as Rupees,
        estimatedTotal: subtotal,
        estimatedDeliveryMinutes: 28 as Minutes,
      },
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() as ISODateTime,
    }
  }

  // ── Instamart ────────────────────────────────────────────────────────────

  async searchInstamart(params: SearchInstamartParams): Promise<ToolResult<{ items: InstamartResult[]; estimatedDeliveryMinutes: Minutes; storeOpen: boolean }>> {
    if (this.mode === 'down') return this.down('instamart')

    const items: InstamartResult[] = params.items.map((rawItem) => {
      const normalized = normalizeIngredient(rawItem)
      const simplified = simplifyIngredient(normalized)

      // Try exact normalized match first, then simplified fallback
      const result = instamartFixtureMap[normalized]
        ?? instamartFixtureMap[simplified]
        ?? { item: rawItem, found: false } as InstamartResult

      // Apply price cap if specified
      if (result.found && params.maxPricePerItemInr !== undefined) {
        if (result.price !== undefined && result.price > params.maxPricePerItemInr) {
          return { item: rawItem, found: false }
        }
      }

      return { ...result, item: rawItem }
    })

    return {
      items,
      estimatedDeliveryMinutes: 15 as Minutes,
      storeOpen: true,
    }
  }

  async createInstamartCart(params: CreateInstamartCartParams): Promise<ToolResult<InstamartCartOutput>> {
    if (this.mode === 'down') return this.down('instamart')

    const itemCount = params.items.length
    const subtotal = (itemCount * 80) as Rupees  // mock average ₹80 per item

    return {
      cartId: 'mock_cart_instamart_001',
      deepLink: 'swiggy://open?screen=instamart&cartId=mock_cart_instamart_001&source=mealos',
      webFallbackUrl: 'https://www.swiggy.com/instamart?cartId=mock_cart_instamart_001&source=mealos',
      summary: {
        itemCount,
        subtotal,
        deliveryCost: 0 as Rupees,
        estimatedTotal: subtotal,
        estimatedDeliveryMinutes: 15 as Minutes,
      },
      unavailableItems: [],
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() as ISODateTime,
    }
  }

  // ── Dineout ──────────────────────────────────────────────────────────────

  async searchDineout(params: SearchDineoutParams): Promise<ToolResult<DineoutVenue[]>> {
    if (this.mode === 'down') return this.down('dineout')

    let results = availableDineoutVenues

    if (params.budgetPerPersonInr !== undefined) {
      results = results.filter(v => v.pricePerPerson <= params.budgetPerPersonInr!)
    }
    if (params.cuisines && params.cuisines.length > 0) {
      const cuisineSet = new Set(params.cuisines.map(c => c.toLowerCase()))
      results = results.filter(v =>
        v.cuisineTypes.some(ct => cuisineSet.has(ct.toLowerCase()))
      )
    }
    if (params.maxDistanceKm !== undefined) {
      results = results.filter(v =>
        v.distanceKm === undefined || v.distanceKm <= params.maxDistanceKm!
      )
    }

    const limit = params.limit ?? 8
    return results.slice(0, limit)
  }

  async getDineoutAvailability(params: GetDineoutAvailabilityParams): Promise<ToolResult<{
    venueId: DineoutVenueId
    date: string
    partySize: number
    slots: { slotId: string; time: string; available: boolean }[]
    lastCheckedAt: ISODateTime
  }>> {
    if (this.mode === 'down') return this.down('dineout')

    const venue = mockDineoutVenues.find(v => v.venueId === params.venueId)

    return {
      venueId: params.venueId,
      date: params.date,
      partySize: params.partySize,
      slots: (venue?.availableSlots ?? []).map((time, i) => ({
        slotId: `slot_${String(i + 1).padStart(3, '0')}`,
        time,
        available: true,
      })),
      lastCheckedAt: new Date().toISOString() as ISODateTime,
    }
  }

  async createDineoutReservation(params: CreateDineoutReservationParams): Promise<ToolResult<DineoutReservation>> {
    if (this.mode === 'down') return this.down('dineout')

    return {
      ...mockReservation,
      venueId: params.venueId,
      partySize: params.partySize,
    }
  }

  // ── Partial failure + fallback ────────────────────────────────────────────

  /**
   * Run multiple tool calls and return results with a `_meta` object indicating
   * which tools succeeded and which failed.
   *
   * This implements the "partial failure: one tool down → others' results
   * returned with _meta.failed" contract (ISSUE-122).
   */
  async runWithMeta<T extends Record<string, () => Promise<ToolResult<unknown>>>>(
    calls: T
  ): Promise<{
    results: { [K in keyof T]: ToolResult<unknown> }
    _meta: { failed: (keyof T)[]; succeeded: (keyof T)[] }
  }> {
    const entries = Object.entries(calls) as [keyof T, () => Promise<ToolResult<unknown>>][]
    const settled = await Promise.allSettled(entries.map(([, fn]) => fn()))

    const results = {} as { [K in keyof T]: ToolResult<unknown> }
    const failed: (keyof T)[] = []
    const succeeded: (keyof T)[] = []

    entries.forEach(([key], i) => {
      const outcome = settled[i]!
      if (outcome.status === 'fulfilled') {
        results[key] = outcome.value
        if (isDegraded(outcome.value)) {
          failed.push(key)
        } else {
          succeeded.push(key)
        }
      } else {
        // Tool threw — convert to degraded
        results[key] = { available: false, errorCode: 'SWIGGY_DOWN', message: String(outcome.reason) }
        failed.push(key)
      }
    })

    return { results, _meta: { failed, succeeded } }
  }

  /**
   * Returns true when ALL Swiggy tools are down — Planning Agent uses this to
   * activate cook-only mode (ISSUE-119).
   */
  isFullyDown(): boolean {
    return this.mode === 'down'
  }
}
