/**
 * MealOS AI — Swiggy Domain Types
 * Source: docs/TYPES.md §10 (Swiggy Domain) and §11 (Tool Responses)
 *
 * Normalized shapes owned by MealOS. Raw Swiggy MCP payloads never leave
 * lib/mcp/swiggy.ts — these are the post-normalization types.
 * Tool Agent rules: integer rupees, exact restaurant names, nutrition only if
 * returned, never estimated.
 */

import type {
  SwiggyRestaurantId,
  InstamartItemId,
  DineoutVenueId,
  SwiggyOrderId,
  YouTubeVideoId,
  Rupees,
  Minutes,
  Grams,
  Kcal,
  Seconds,
  ISODateTime,
  Ms,
} from './primitives'
import type { InstamartItem } from './recommendation'

// ── §10 Swiggy Domain ─────────────────────────────────────────────────────────

export interface MenuItem {
  name: string
  price: Rupees
  isVeg: boolean
  calories?: Kcal    // only if Swiggy returned it — omit, never 0/null
  proteinG?: Grams
}

export interface Restaurant {
  restaurantId: SwiggyRestaurantId
  name: string              // exact Swiggy display name, never truncated
  rating: number            // 0.0–5.0, one decimal
  deliveryTimeMin: Minutes
  deliveryFee: Rupees
  minOrderValue: Rupees
  cuisineTypes: string[]
  topItems: MenuItem[]
}

/**
 * One Instamart search result (Tool Agent output).
 * found: false = searched, unavailable.
 */
export interface InstamartResult {
  item: string              // the search term passed in
  found: boolean
  price?: Rupees            // present iff found
  unit?: string             // "200g", "1kg", "500ml"
  brand?: string
  deliveryTimeMin?: Minutes // typically 15–30
  instamartItemId?: InstamartItemId
}

export interface InstamartCart {
  items: InstamartItem[]
  totalCostInr: Rupees              // sum of quantityNeeded * pricePerUnit
  estimatedDeliveryMinutes: Minutes
  deepLink: string                  // Instamart cart deep link
}

export type DineoutAmbience =
  | 'romantic' | 'rooftop' | 'candlelit' | 'casual' | 'fine-dining'
  | 'outdoor' | 'live-music' | 'family-friendly' | 'sports-bar'

export interface DineoutVenue {
  venueId: DineoutVenueId
  name: string
  cuisineTypes: string[]
  ambience: DineoutAmbience[]
  pricePerPerson: Rupees
  rating: number                    // 0.0–5.0
  availableSlots: string[]          // "7:30 PM" — IST 12-hour, no zero-padded hours
  isVegFriendly: boolean
  distanceKm?: number
  bookingUrl?: string
}

export type ReservationStatus = 'pending' | 'confirmed' | 'failed' | 'cancelled'

export interface DineoutReservation {
  venueId: DineoutVenueId
  venueName: string
  dateTime: ISODateTime             // selected slot with offset (+05:30)
  partySize: number
  status: ReservationStatus
  reservationId?: SwiggyOrderId     // Swiggy Dineout reference, once confirmed
  bookingUrl: string                // fallback manual-booking link
}

// ── §11 Tool Responses ────────────────────────────────────────────────────────

export type ToolName =
  | 'swiggy_search_restaurants'
  | 'swiggy_search_instamart'
  | 'swiggy_search_dineout'
  | 'youtube_search_recipe'

export type SwiggyToolErrorCode =
  | 'LOCATION_NOT_SERVICEABLE' | 'NO_RESULTS' | 'RATE_LIMITED'
  | 'SWIGGY_DOWN' | 'INSTAMART_DOWN' | 'DINEOUT_DOWN' | 'NO_AVAILABILITY'

export type YouTubeToolErrorCode = 'NO_RESULTS' | 'QUOTA_EXCEEDED' | 'API_DOWN'

export interface YouTubeRecipeResult {
  videoId: YouTubeVideoId
  title: string
  channelName: string
  durationSeconds: Seconds
  thumbnailUrl: string
  viewCount: number
  publishedAt: ISODateTime
  keyTimestamps: {
    label: string       // "Add dal", "Start tempering"
    seconds: Seconds
  }[]
}

/**
 * Discriminated union over every external tool the Tool Agent can call.
 * ok: true carries normalized data; ok: false carries a tool-scoped error code.
 */
export type ToolResponse =
  | { tool: 'swiggy_search_restaurants'; ok: true;  data: Restaurant[] }
  | { tool: 'swiggy_search_restaurants'; ok: false; errorCode: SwiggyToolErrorCode; message: string }
  | { tool: 'swiggy_search_instamart';   ok: true;  data: InstamartResult[] }
  | { tool: 'swiggy_search_instamart';   ok: false; errorCode: SwiggyToolErrorCode; message: string }
  | { tool: 'swiggy_search_dineout';     ok: true;  data: DineoutVenue[] }
  | { tool: 'swiggy_search_dineout';     ok: false; errorCode: SwiggyToolErrorCode; message: string }
  | { tool: 'youtube_search_recipe';     ok: true;  data: YouTubeRecipeResult }
  | { tool: 'youtube_search_recipe';     ok: false; errorCode: YouTubeToolErrorCode; message: string }

/**
 * Aggregate the Tool Agent returns to the orchestrator (AGENTS.md §4.5).
 * null = tool failed; [] = not called, or called with no results.
 */
export interface ToolAgentOutput {
  restaurants: Restaurant[] | null
  instamartItems: InstamartResult[] | null
  dineoutVenues: DineoutVenue[] | null
  youtube: YouTubeRecipeResult | null

  errors: {
    tool: ToolName
    errorCode: SwiggyToolErrorCode | YouTubeToolErrorCode
    message: string         // one sentence
  }[]

  swiggyError?: 'SWIGGY_UNAVAILABLE'  // set only when ALL Swiggy tools failed

  _meta: {
    toolsAttempted: ToolName[]
    toolsSucceeded: ToolName[]
    totalLatencyMs: Ms
  }
}

// SwiggyMenuItemId and SwiggyOrderId are exported from @/types/primitives (source of truth).
// They are imported here for use within this file but not re-exported
// to avoid duplicate export conflicts in the barrel (types/index.ts).
