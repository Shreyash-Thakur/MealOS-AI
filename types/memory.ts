/**
 * MealOS AI — Memory Domain Types
 * Source: docs/TYPES.md §3 (Identity/Profile) and §4 (Memory)
 */

import type {
  UserId,
  MemoryFactId,
  SituationId,
  ISODateTime,
  ISODate,
  Rupees,
  Grams,
  Kcal,
  FactConfidence,
} from './primitives'

// ── Identity and Profile (§3) ─────────────────────────────────────────────────

export type DietType     = 'vegetarian' | 'vegan' | 'non_vegetarian' | 'pescatarian' | 'jain'
export type CookingSkill = 'beginner' | 'intermediate' | 'advanced'

/**
 * Extension table for Clerk identity. Clerk owns auth; this row anchors all product data.
 * `lastActiveAt` is null until the first authenticated request after signup.
 */
export interface User {
  id: UserId
  clerkId: import('./primitives').ClerkUserId  // DB column: clerk_id (UNIQUE)
  email: string                                // UNIQUE; format validated by Zod, not the DB
  name: string | null
  phone: string | null                         // E.164; SMS notifications are V2
  createdAt: ISODateTime
  updatedAt: ISODateTime
  lastActiveAt: ISODateTime | null
}

/**
 * Structured-preferences projection returned by GET /api/v1/memory.
 * V1: no user_profiles table — every field derived from user_memory_facts rows
 * by the Memory Service. Nullable fields mean "the user never told us."
 */
export interface UserProfile {
  dietType: DietType | null
  allergies: string[]                    // [] = none known; free text ("shellfish")
  dietaryNotes: string | null            // complex restrictions, free text
  householdSize: number                  // integer >= 1; defaults to 1
  cookingSkill: CookingSkill | null
  kitchenEquipment: string[]             // ["gas stove", "mixer", "pressure cooker"]
  dailyFoodBudget: Rupees | null
  diningOutBudget: Rupees | null         // per outing
  dailyProteinTarget: Grams | null
  dailyCalorieTarget: Kcal | null
  gymDays: string[]                      // English weekday names, e.g. ["Monday"]
  preferredCuisines: string[]
  dislikedCuisines: string[]
  homeAddress: string | null             // free text: "Bandra West, Mumbai 400050"
  workAddress: string | null
}

// ── Memory Facts (§4) ─────────────────────────────────────────────────────────

/**
 * Six sources — the DB enum must contain all six (docs/TYPES.md §14 item 7).
 */
export type MemorySource =
  | 'onboarding'           // stored by POST /api/v1/onboarding
  | 'user_stated'          // explicitly stated in raw situation input
  | 'user_edited'          // edited via PATCH /api/v1/memory (Memory Panel)
  | 'clarification_answer' // confirmed via a clarification answer
  | 'behavior_inferred'    // pattern across 3+ situations
  | 'action_derived'       // derived from executed orders/bookings

export type FactType = 'string' | 'number' | 'boolean' | 'array' | 'date'

/**
 * Per-key value shapes for every memory fact.
 * TYPES.md: "single source of truth for per-key value shapes."
 * The Memory Agent is forbidden from inventing keys (AGENTS.md §5.5).
 */
export type FactValueByKey = {
  'dietary.restrictions':           string[]
  'dietary.allergies':              string[]
  'budget.daily_food_target':       number          // Rupees
  'budget.dining_out_budget':       number          // Rupees, per outing
  'location.home':                  string
  'location.work':                  string
  'kitchen.skill_level':            CookingSkill
  'kitchen.equipment':              string[]
  'household.size':                 number
  'fitness.protein_target':         number          // grams/day
  'fitness.calorie_target':         number          // kcal/day
  'fitness.gym_days':               string[]
  'preference.cuisines.liked':      string[]
  'preference.cuisines.disliked':   string[]
  'pantry.staples':                 string[]
  'ordering.frequent_restaurants':  string[]
  'cooking.can_cook':               boolean
  'health.last_sick_day':           string          // ISODate
}

export type FactKey = keyof FactValueByKey

/**
 * One row per atomic fact per user; upserted on (userId, factKey).
 */
export interface MemoryFact<K extends FactKey = FactKey> {
  id: MemoryFactId
  userId: UserId
  factKey: K
  factValue: FactValueByKey[K]
  factType: FactType
  source: MemorySource
  confidence: FactConfidence     // 0.0–1.0; write-time values are 0.4|0.6|0.8|1.0
  timesConfirmed: number         // integer >= 1
  lastConfirmedAt: ISODateTime | null
  expiresAt: ISODateTime | null  // null = permanent (allergies, location, skill)
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export type MemoryContentType = 'situation_summary' | 'preference' | 'outcome' | 'correction'

/**
 * Semantic layer (V2, pgvector).
 * `embedding` never crosses the API boundary — DB and Memory Service only.
 */
export interface MemoryEmbeddingRecord {
  id: string
  userId: UserId
  content: string                       // the text that was embedded
  embedding: number[]                   // vector(1536)
  contentType: MemoryContentType
  sourceSituationId: SituationId | null
  createdAt: ISODateTime
}

/**
 * Memory Panel view row (GET /api/v1/memory response, domain shape).
 * `lastConfirmedAt` is NOT nullable in the view (unlike MemoryFact) — panel always
 * has a confirmed-at date to display.
 */
export interface MemoryFactView {
  id: MemoryFactId
  key: FactKey
  value: unknown               // FactValueByKey[key]; unknown at the aggregate level
  factType: FactType
  source: MemorySource
  confidence: FactConfidence
  lastConfirmedAt: ISODateTime
  expiresAt: ISODateTime | null
  editable: boolean            // action_derived facts are read-only in the Panel
  displayLabel: string         // "Daily food budget"
  displayCategory: string      // "Budget", "Preferences", "Order History"
}

/**
 * GET /api/v1/memory response aggregate.
 */
export interface Memory {
  profile: UserProfile
  facts: MemoryFactView[]
  lastUpdatedAt: ISODateTime
  factCount: number
  onboardingComplete: boolean
}

// ISODate is available from @/types/primitives directly — not re-exported here to avoid
// duplicate export conflicts in the barrel (types/index.ts).
