/**
 * MealOS AI — Branded Scalars and Primitive Types
 * Source: docs/TYPES.md §2
 * Rule: brands are compile-time only; all values are plain strings/numbers at runtime.
 */

// ── Brand utility ─────────────────────────────────────────────────────────────
declare const __brand: unique symbol
export type Brand<T, B extends string> = T & { readonly [__brand]: B }

// ── Entity IDs (all UUID v4 strings) ─────────────────────────────────────────
export type UserId               = Brand<string, 'UserId'>
export type ClerkUserId          = Brand<string, 'ClerkUserId'>         // "user_2NNiSlFa..."
export type SituationId          = Brand<string, 'SituationId'>
export type ClarificationId      = Brand<string, 'ClarificationId'>
export type RecommendationId     = Brand<string, 'RecommendationId'>
export type RecommendationItemId = Brand<string, 'RecommendationItemId'>
export type ActionId             = Brand<string, 'ActionId'>
export type MemoryFactId         = Brand<string, 'MemoryFactId'>
export type PantryItemId         = Brand<string, 'PantryItemId'>
export type AgentRunId           = Brand<string, 'AgentRunId'>
export type CookingSessionId     = Brand<string, 'CookingSessionId'>

// ── External IDs (opaque strings owned by other systems) ─────────────────────
export type SwiggyRestaurantId = Brand<string, 'SwiggyRestaurantId'>   // "swg_rest_4821"
export type SwiggyMenuItemId   = Brand<string, 'SwiggyMenuItemId'>
export type InstamartItemId    = Brand<string, 'InstamartItemId'>
export type DineoutVenueId     = Brand<string, 'DineoutVenueId'>
export type SwiggyOrderId      = Brand<string, 'SwiggyOrderId'>        // external_order_id
export type YouTubeVideoId     = Brand<string, 'YouTubeVideoId'>       // ID only, never a URL

// ── Units ─────────────────────────────────────────────────────────────────────
export type Rupees  = Brand<number, 'Rupees'>   // integer whole INR, >= 0
export type Minutes = Brand<number, 'Minutes'>  // integer, >= 0
export type Ms      = Brand<number, 'Ms'>       // integer milliseconds
export type Seconds = Brand<number, 'Seconds'>  // YouTube offsets only
export type Grams   = Brand<number, 'Grams'>    // protein/carbs/fat
export type Kcal    = Brand<number, 'Kcal'>

// ── Confidence (see docs/TYPES.md §1 — two deliberate conventions) ───────────
/** Integer 0–100: pipeline confidence, Conversation Agent, Decision Engine, recommendations */
export type ConfidencePercent = Brand<number, 'ConfidencePercent'>
/** Decimal 0.0–1.0: memory fact confidence. Write-time quantized to 0.4 | 0.6 | 0.8 | 1.0 */
export type FactConfidence    = Brand<number, 'FactConfidence'>

/**
 * UI projection of ConfidencePercent.
 * Mapping: > 70 → 'high', 50–70 → 'medium', < 50 → 'low'  (DECISION_ENGINE.md §6)
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low'

// ── Time ─────────────────────────────────────────────────────────────────────
export type ISODateTime  = Brand<string, 'ISODateTime'>  // "2026-07-06T14:30:00Z" UTC or offset
export type ISODate      = Brand<string, 'ISODate'>      // "2026-07-06"
export type IANATimezone = Brand<string, 'IANATimezone'> // "Asia/Kolkata"
