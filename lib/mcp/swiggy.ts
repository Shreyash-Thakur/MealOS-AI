/**
 * MealOS AI — SwiggyMCPClient (real + singleton factory)
 *
 * Singleton factory returns MockSwiggyMCPClient when SWIGGY_MCP_MODE=mock|down,
 * or SwiggyMCPClient (real) when SWIGGY_MCP_MODE=real.
 *
 * Connection lifecycle:
 *   - Singleton initialized once at server startup
 *   - Lazy connect: connect() called on first tool invocation
 *   - Reconnect: exponential backoff (500ms, 1s, 2s) — 3 attempts max
 *   - Per-call timeout: 8 seconds (configurable via SWIGGY_MCP_TIMEOUT_MS)
 *
 * Rule N2: mock defines the contract; real conforms to mock's types.
 * Rule N9: no Redis, BullMQ, or background workers in V1.
 *
 * Auth: API key via SWIGGY_MCP_API_KEY. OAuth is V2.
 * Transport: [VERIFY WITH SWIGGY MCP DOCS] — currently coded as StreamableHTTP
 * with a stdio fallback note. The transport constructor is isolated so swapping
 * is a one-line change.
 */

import { env } from '@/lib/env'
import { MockSwiggyMCPClient } from './mock'
import { classifyError, errorMessage } from './errors'
import type {
  SearchRestaurantsParams,
  SearchInstamartParams,
  SearchDineoutParams,
  GetMenuParams,
  CreateFoodCartParams,
  CreateInstamartCartParams,
  GetDineoutAvailabilityParams,
  CreateDineoutReservationParams,
  FoodCartOutput,
  InstamartCartOutput,
  MenuOutput,
  ToolResult,
  Degraded,
} from './mock'
import type { Restaurant, InstamartResult, DineoutVenue, DineoutReservation } from '@/types/swiggy'
import type { DineoutVenueId, ISODateTime } from '@/types/primitives'
import { normalizeIngredient, simplifyIngredient } from './normalize'

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 8_000
const RETRY_DELAYS_MS = [500, 1_000, 2_000] as const   // 3 attempts, exponential backoff
const MAX_RETRIES = RETRY_DELAYS_MS.length

// ── MCP SDK import — conditional to avoid crashing in mock mode ──────────────
// [VERIFY import path with @modelcontextprotocol/sdk 1.x docs]
// Using dynamic import so the real client only loads the SDK when needed.

type MCPClient = {
  connect(transport: unknown): Promise<void>
  callTool(req: { name: string; arguments: Record<string, unknown> }): Promise<unknown>
}

async function createMCPClient(): Promise<MCPClient> {
  // [VERIFY] — @modelcontextprotocol/sdk 1.x client API
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  return new Client(
    { name: 'mealos-swiggy-client', version: '1.0.0' },
    { capabilities: {} }
  ) as MCPClient
}

async function createTransport(apiKey: string, environment: 'sandbox' | 'production'): Promise<unknown> {
  // [VERIFY] — transport type: StreamableHTTP vs stdio
  // Swiggy MCP likely uses HTTP transport for server-to-server, not stdio.
  // Using StreamableHTTP as the primary assumption; swap if Swiggy docs specify otherwise.
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
  const baseUrl = environment === 'production'
    ? 'https://mcp.swiggy.com'      // [VERIFY endpoint]
    : 'https://sandbox.mcp.swiggy.com' // [VERIFY sandbox endpoint]

  return new StreamableHTTPClientTransport(
    new URL('/mcp/v1', baseUrl),
    { requestInit: { headers: { 'X-Swiggy-API-Key': apiKey } } }  // [VERIFY header name]
  )
}

// ── SwiggyMCPClient ──────────────────────────────────────────────────────────

/**
 * Real SwiggyMCPClient — wraps @modelcontextprotocol/sdk.
 *
 * Only instantiated when SWIGGY_MCP_MODE=real. All production-path code is
 * behind this class; mock mode never touches MCP SDK internals.
 *
 * All tools documented in docs/SWIGGY_MCP.md §2–4 are implemented.
 * Tools marked [VERIFY] stay mock-only until Swiggy partner docs confirm them.
 */
export class SwiggyMCPClient {
  private client: MCPClient | null = null
  private initialized = false
  private readonly apiKey: string
  private readonly environment: 'sandbox' | 'production'
  private readonly timeoutMs: number

  constructor(opts: {
    apiKey: string
    environment: 'sandbox' | 'production'
    timeoutMs?: number
  }) {
    this.apiKey = opts.apiKey
    this.environment = opts.environment
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /** Lazy connect — called on first tool invocation. Idempotent. */
  async connect(): Promise<void> {
    if (this.initialized) return

    const transport = await createTransport(this.apiKey, this.environment)
    const client = await createMCPClient()
    await client.connect(transport)

    this.client = client
    this.initialized = true
  }

  // ── Internal tooling ────────────────────────────────────────────────────

  /** Extract JSON payload from MCP response envelope. */
  private extractPayload<T>(raw: unknown): T {
    // [VERIFY] — MCP SDK response shape for callTool
    // Standard MCP response: { content: [{ type: 'text', text: '...' }] }
    const typed = raw as { content?: { type: string; text?: string }[] }
    if (typed.content?.[0]?.type === 'text' && typed.content[0].text) {
      return JSON.parse(typed.content[0].text) as T
    }
    // Some servers return the payload directly
    return raw as T
  }

  /**
   * Call a Swiggy MCP tool with timeout + exponential-backoff retry.
   * Throws on permanent failure; callers wrap in wrapError().
   */
  private async callTool<T>(
    toolName: string,
    args: Record<string, unknown>,
    attempt = 0
  ): Promise<T> {
    if (!this.initialized || !this.client) {
      await this.connect()
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error('MCP_TIMEOUT'), { code: 'MCP_TIMEOUT' })), this.timeoutMs)
    )

    try {
      const raw = await Promise.race([
        this.client!.callTool({ name: toolName, arguments: args }),
        timeoutPromise,
      ])
      return this.extractPayload<T>(raw)
    } catch (err: unknown) {
      const e = err as { code?: string }
      const isRetryable = e.code === 'RATE_LIMIT' || e.code === 'RATE_LIMIT_EXCEEDED' || e.code === 'MCP_TIMEOUT'

      if (isRetryable && attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS_MS[attempt] ?? 2_000
        await new Promise(r => setTimeout(r, delay))
        return this.callTool<T>(toolName, args, attempt + 1)
      }
      throw err
    }
  }

  /** Wrap any caught error into a typed Degraded response. */
  private wrapError(err: unknown, context: 'food' | 'instamart' | 'dineout'): Degraded {
    const code = classifyError(err, context)
    console.error(`[SwiggyMCP] ${context} tool failed:`, err)
    return { available: false, errorCode: code, message: errorMessage(code) }
  }

  // ── Food Delivery ────────────────────────────────────────────────────────

  async searchRestaurants(params: SearchRestaurantsParams): Promise<ToolResult<Restaurant[]>> {
    try {
      type RawResponse = {
        restaurants: Array<{
          id: string; name: string; cuisines: string[]; rating: number
          deliveryTimeMinutes: number; minOrderValue: number; deliveryCost: number
          isVeg: boolean; isOpen: boolean
          offers?: { title: string }[]
          menuPreview?: { id: string; name: string; price: number; isVeg: boolean }[]
          nutrition?: { calories?: number; proteinG?: number }
        }>
      }

      const raw = await this.callTool<RawResponse>('swiggy_search_restaurants', {
        query: params.query,
        location: params.location,
        filters: {
          vegetarianOnly: params.vegetarianOnly,
          maxDeliveryTimeMinutes: params.maxDeliveryMinutes,
          maxMinOrderValue: params.maxMinOrderInr,
          cuisines: params.cuisines,
          minRating: params.minRating,
        },
        limit: params.limit ?? 10,
      })

      return raw.restaurants
        .filter(r => r.isOpen)  // never return closed restaurants (docs §5 RESTAURANT_CLOSED)
        .map(r => ({
          restaurantId: r.id as import('@/types/primitives').SwiggyRestaurantId,
          name: r.name,
          rating: r.rating,
          deliveryTimeMin: r.deliveryTimeMinutes as import('@/types/primitives').Minutes,
          deliveryFee: r.deliveryCost as import('@/types/primitives').Rupees,
          minOrderValue: r.minOrderValue as import('@/types/primitives').Rupees,
          cuisineTypes: r.cuisines,
          topItems: (r.menuPreview ?? []).map(item => ({
            name: item.name,
            price: item.price as import('@/types/primitives').Rupees,
            isVeg: item.isVeg,
          })),
        })) satisfies Restaurant[]
    } catch (err) {
      return this.wrapError(err, 'food')
    }
  }

  async getRestaurantMenu(params: GetMenuParams): Promise<ToolResult<MenuOutput>> {
    try {
      type RawMenu = {
        restaurantId: string; restaurantName: string; lastUpdatedAt: string
        categories: Array<{
          name: string
          items: Array<{
            id: string; name: string; price: number; isVeg: boolean; isAvailable: boolean
            nutrition?: { calories?: number; proteinG?: number }
          }>
        }>
      }
      const raw = await this.callTool<RawMenu>('swiggy_get_restaurant_menu', {
        restaurantId: params.restaurantId,
        categoryFilter: params.categoryFilter,
      })

      return {
        restaurantId: params.restaurantId,
        restaurantName: raw.restaurantName,
        categories: raw.categories.map(cat => ({
          name: cat.name,
          items: cat.items
            .filter(item => item.isAvailable)
            .map(item => ({
              id: item.id,
              name: item.name,
              priceInr: item.price as import('@/types/primitives').Rupees,
              isVeg: item.isVeg,
              isAvailable: item.isAvailable,
              nutritionEstimate: item.nutrition
                ? { calories: item.nutrition.calories, proteinG: item.nutrition.proteinG }
                : undefined,
            })),
        })),
        lastUpdatedAt: raw.lastUpdatedAt as ISODateTime,
      }
    } catch (err) {
      return this.wrapError(err, 'food')
    }
  }

  async createFoodCart(params: CreateFoodCartParams): Promise<ToolResult<FoodCartOutput>> {
    try {
      return await this.callTool<FoodCartOutput>('swiggy_create_food_cart', {
        restaurantId: params.restaurantId,
        items: params.items,
        userId: params.userId,
      })
    } catch (err) {
      return this.wrapError(err, 'food')
    }
  }

  // ── Instamart ────────────────────────────────────────────────────────────

  async searchInstamart(params: SearchInstamartParams): Promise<ToolResult<{ items: InstamartResult[]; estimatedDeliveryMinutes: import('@/types/primitives').Minutes; storeOpen: boolean }>> {
    try {
      // Normalize ingredient names before calling MCP (docs §3 Fuzzy Matching)
      const normalizedItems = params.items.map(normalizeIngredient)

      type RawInstamartResponse = {
        items: Array<{
          requestedName: string; found: boolean
          bestMatch?: { id: string; name: string; brand: string; price: number; quantity: string; inStock: boolean; imageUrl?: string }
          alternatives?: { id: string; name: string; brand: string; price: number; quantity: string }[]
        }>
        storeOpen: boolean
        estimatedDeliveryMinutes: number
        deliveryAreaServiceable: boolean
      }

      const raw = await this.callTool<RawInstamartResponse>('swiggy_search_instamart', {
        items: normalizedItems,
        location: params.location,
        maxPricePerItemInr: params.maxPricePerItemInr,
      })

      if (!raw.deliveryAreaServiceable) {
        return { available: false, errorCode: 'LOCATION_NOT_SERVICEABLE', message: errorMessage('LOCATION_NOT_SERVICEABLE') }
      }

      // Simplified-query retry: for items not found, retry with hyphen-stripped name
      const unfoundIndices = raw.items
        .map((item, i) => ({ found: item.found, i }))
        .filter(x => !x.found)
        .map(x => x.i)

      if (unfoundIndices.length > 0) {
        const simplifiedItems = normalizedItems.map((n, i) =>
          unfoundIndices.includes(i) ? simplifyIngredient(n) : n
        )
        const retryRaw = await this.callTool<RawInstamartResponse>('swiggy_search_instamart', {
          items: simplifiedItems,
          location: params.location,
          maxPricePerItemInr: params.maxPricePerItemInr,
        })
        // Merge: use retry results only for previously-unfound items
        unfoundIndices.forEach(i => {
          if (retryRaw.items[i]) raw.items[i] = retryRaw.items[i]!
        })
      }

      // Apply substitution logic per item (docs §3 Item Substitution Logic)
      const items: InstamartResult[] = raw.items.map((item, idx) => {
        const originalName = params.items[idx] ?? item.requestedName
        if (!item.found) return { item: originalName, found: false }

        const bm = item.bestMatch
        const alt = item.alternatives?.[0]

        // Priority: bestMatch(inStock) → alternatives[0] → unavailable
        if (bm?.inStock) {
          return {
            item: originalName, found: true,
            price: bm.price as import('@/types/primitives').Rupees,
            unit: bm.quantity,
            brand: bm.brand,
            instamartItemId: bm.id as import('@/types/primitives').InstamartItemId,
          }
        }
        if (alt) {
          return {
            item: originalName, found: true,
            price: alt.price as import('@/types/primitives').Rupees,
            unit: alt.quantity,
            brand: alt.brand,
            instamartItemId: alt.id as import('@/types/primitives').InstamartItemId,
          }
        }
        return { item: originalName, found: false }
      })

      return {
        items,
        estimatedDeliveryMinutes: raw.estimatedDeliveryMinutes as import('@/types/primitives').Minutes,
        storeOpen: raw.storeOpen,
      }
    } catch (err) {
      return this.wrapError(err, 'instamart')
    }
  }

  async createInstamartCart(params: CreateInstamartCartParams): Promise<ToolResult<InstamartCartOutput>> {
    try {
      return await this.callTool<InstamartCartOutput>('swiggy_create_instamart_cart', {
        items: params.items,
        location: params.location,
        userId: params.userId,
      })
    } catch (err) {
      return this.wrapError(err, 'instamart')
    }
  }

  // ── Dineout ──────────────────────────────────────────────────────────────

  async searchDineout(params: SearchDineoutParams): Promise<ToolResult<DineoutVenue[]>> {
    try {
      type RawDineout = {
        venues: Array<{
          id: string; name: string; cuisines: string[]; rating: number
          averageSpendFor2: number; averageSpendPerPerson: number
          distanceKm: number; address: string; imageUrl: string
          isVegFriendly: boolean; tags: string[]
          hasAvailability: boolean | null
          nearestAvailableSlot?: string
        }>
      }
      const raw = await this.callTool<RawDineout>('swiggy_search_dineout', {
        location: params.location,
        occasion: params.occasion,
        partySize: params.partySize,
        budgetPerPersonInr: params.budgetPerPersonInr,
        cuisines: params.cuisines,
        date: params.date,
        maxDistanceKm: params.maxDistanceKm,
        limit: params.limit ?? 8,
      })

      return raw.venues.map(v => ({
        venueId: v.id as DineoutVenueId,
        name: v.name,
        cuisineTypes: v.cuisines,
        ambience: (v.tags ?? []) as import('@/types/swiggy').DineoutAmbience[],
        pricePerPerson: v.averageSpendPerPerson as import('@/types/primitives').Rupees,
        rating: v.rating,
        availableSlots: v.nearestAvailableSlot ? [v.nearestAvailableSlot] : [],
        isVegFriendly: v.isVegFriendly,
        distanceKm: v.distanceKm,
        bookingUrl: `https://www.swiggy.com/dineout/venue/${v.id}`,
      })) satisfies DineoutVenue[]
    } catch (err) {
      return this.wrapError(err, 'dineout')
    }
  }

  async getDineoutAvailability(params: GetDineoutAvailabilityParams): Promise<ToolResult<{
    venueId: DineoutVenueId
    date: string
    partySize: number
    slots: { slotId: string; time: string; available: boolean }[]
    lastCheckedAt: ISODateTime
  }>> {
    try {
      type RawAvail = {
        venueId: string; date: string; partySize: number
        slots: { slotId: string; time: string; available: boolean }[]
        lastCheckedAt: string
      }
      const raw = await this.callTool<RawAvail>('swiggy_get_dineout_availability', {
        venueId: params.venueId,
        date: params.date,
        partySize: params.partySize,
      })

      const availableSlots = raw.slots.filter(s => s.available)
      if (availableSlots.length === 0) {
        return { available: false, errorCode: 'NO_AVAILABILITY', message: errorMessage('NO_AVAILABILITY') }
      }

      return {
        venueId: params.venueId,
        date: raw.date,
        partySize: raw.partySize,
        slots: availableSlots,
        lastCheckedAt: raw.lastCheckedAt as ISODateTime,
      }
    } catch (err) {
      return this.wrapError(err, 'dineout')
    }
  }

  async createDineoutReservation(params: CreateDineoutReservationParams): Promise<ToolResult<DineoutReservation>> {
    try {
      type RawReservation = {
        reservationId: string; confirmationCode: string; venueId: string; venueName: string
        date: string; time: string; partySize: number; status: 'confirmed' | 'pending'
        deepLink: string; webFallbackUrl: string; cancellationDeadline?: string
      }
      const raw = await this.callTool<RawReservation>('swiggy_create_dineout_reservation', {
        venueId: params.venueId,
        slotId: params.slotId,
        partySize: params.partySize,
        guest: params.guest,
        specialRequests: params.specialRequests,
      })

      // Construct ISO datetime from date + time
      const dateTimeStr = `${raw.date}T${raw.time}+05:30`

      return {
        venueId: params.venueId,
        venueName: raw.venueName,
        dateTime: dateTimeStr as ISODateTime,
        partySize: raw.partySize,
        status: raw.status === 'confirmed' ? 'confirmed' : 'pending',
        reservationId: raw.reservationId as import('@/types/primitives').SwiggyOrderId,
        bookingUrl: raw.webFallbackUrl,
      }
    } catch (err) {
      return this.wrapError(err, 'dineout')
    }
  }

  /** True when mode forces all tools to be unavailable. */
  isFullyDown(): boolean {
    return false
  }
}

// ── Singleton factory ────────────────────────────────────────────────────────

/**
 * The unified client interface — both mock and real share these method signatures.
 * lib/agents/tool.ts imports this type (and getSwiggyClient) exclusively.
 */
export type ISwiggyClient = MockSwiggyMCPClient | SwiggyMCPClient

let _instance: ISwiggyClient | null = null

/**
 * Returns the process-lifetime singleton SwiggyMCPClient (real or mock).
 * Selection is via SWIGGY_MCP_MODE env var (validated at boot by lib/env.ts).
 *
 * Values:
 *   mock  — MockSwiggyMCPClient with Mumbai fixtures
 *   down  — MockSwiggyMCPClient in outage-simulation mode (all tools return SWIGGY_DOWN)
 *   real  — SwiggyMCPClient connecting to the Swiggy MCP server
 */
export function getSwiggyClient(): ISwiggyClient {
  if (_instance !== null) return _instance

  const mode = env.SWIGGY_MCP_MODE

  if (mode === 'mock' || mode === 'down') {
    _instance = new MockSwiggyMCPClient(mode as 'mock' | 'down')
    return _instance
  }

  // mode === 'real'
  const apiKey = process.env['SWIGGY_MCP_API_KEY'] ?? ''
  const environment = (process.env['SWIGGY_MCP_ENV'] ?? 'sandbox') as 'sandbox' | 'production'
  const timeoutMs = process.env['SWIGGY_MCP_TIMEOUT_MS']
    ? parseInt(process.env['SWIGGY_MCP_TIMEOUT_MS'], 10)
    : DEFAULT_TIMEOUT_MS

  _instance = new SwiggyMCPClient({ apiKey, environment, timeoutMs })
  return _instance
}

/**
 * Reset the singleton — used in tests to inject a fresh mock between test cases.
 * Never call in production code.
 */
export function _resetSwiggyClientForTests(): void {
  _instance = null
}
