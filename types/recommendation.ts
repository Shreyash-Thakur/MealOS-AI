/**
 * MealOS AI — Plan and Recommendation Types
 * Source: docs/TYPES.md §8 (Plan/Recommendation) and §9 (Recipe/Pantry)
 */

import type {
  UserId,
  SituationId,
  RecommendationId,
  RecommendationItemId,
  PantryItemId,
  SwiggyRestaurantId,
  SwiggyMenuItemId,
  InstamartItemId,
  DineoutVenueId,
  YouTubeVideoId,
  Rupees,
  Minutes,
  Grams,
  Kcal,
  ISODateTime,
  ISODate,
  ConfidencePercent,
} from './primitives'
import type { CookingSkill } from './memory'
import type { FactKey } from './memory'
import type { PrimaryPath, Allergen } from './situation'

// ── §8.1 Comparison (the Cook / Order / Dine table) ─────────────────────────

/**
 * One path's breakdown in the persisted recommendations.comparison_scores JSONB.
 * scoringFactors are weighted contributions (0–25 each, can be negative).
 * Key names follow the engine's four dimensions (TYPES.md §14 item 3).
 */
export interface PathComparison {
  score: number                    // 0–100, = PathScore.finalScore
  estimatedCostInr: Rupees
  estimatedTimeMin: Minutes
  feasible: boolean                // = PathScore.available
  scoringFactors: {
    goalMatch: number              // weighted contribution, nominally 0–25
    budgetFit: number              // may be negative
    timeFit: number
    preferenceMatch: number
  }
  reason: string                   // one sentence, human-readable
}

export interface ComparisonScores {
  cook: PathComparison
  order: PathComparison
  dineOut: PathComparison
}

/** Product vocabulary alias */
export type Comparison = ComparisonScores

// ── §8.2 Recommendation (persisted, 1:1 with Situation) ─────────────────────

export type PlanType = 'single' | 'sequence' | 'multi_service' | 'weekly'

export interface NutritionInfo {
  calories: Kcal
  proteinG: Grams
  carbsG: Grams
  fatG: Grams
}

export interface Recommendation {
  id: RecommendationId
  situationId: SituationId         // UNIQUE — enforces 1:1
  userId: UserId                   // denormalized for user-scoped queries

  comparisonScores: ComparisonScores
  primaryPath: PrimaryPath
  explanation: string              // Claude's 2–4 sentences; the only LLM prose stored
  confidenceScore: ConfidencePercent

  title: string                    // "Khichdi from Haldiram's" — specific, never generic
  estimatedCost: Rupees            // primary recommendation total
  estimatedTimeMin: Minutes

  calories: Kcal | null            // null when nutrition data unavailable — never estimated
  proteinG: Grams | null
  carbsG: Grams | null
  fatG: Grams | null

  youtubeUrl: string | null        // COOK path only
  recipeSteps: RecipeStep[] | null // COOK path only
  instamartItems: InstamartItem[] | null  // when missing ingredients are sourceable
  swiggyData: SwiggyData | null    // ORDER and DINE_OUT paths

  createdAt: ISODateTime
}

/**
 * SwiggyData JSONB column — mutually exclusive sub-shapes by path.
 */
export interface SwiggyData {
  // ORDER path
  restaurantId?: SwiggyRestaurantId
  restaurantName?: string
  menuItemId?: SwiggyMenuItemId
  menuItemName?: string
  deliveryEstimateMin?: Minutes
  deliveryCostInr?: Rupees
  deepLinkUrl?: string              // pre-filled cart deep link

  // DINE_OUT path
  dineoutPlaceId?: DineoutVenueId
  dineoutPlaceName?: string
  availableSlots?: DineoutSlot[]
  bookingUrl?: string
}

export interface DineoutSlot {
  date: ISODate
  time: string                      // "HH:MM" 24h
  tableSize: number
}

// ── §8.3 Plan and PlanItem (wire/UI aggregate) ───────────────────────────────

export type Service = 'swiggy_food' | 'instamart' | 'dineout' | 'recipe' | 'meal_prep'

export interface PlanItemBase {
  id: RecommendationItemId
  rank: number                      // 1 = primary
  isPrimary: boolean
  title: string
  description: string
  estimatedCostInr: Rupees
  estimatedTimeMinutes: Minutes
  nutrition?: NutritionInfo
  isExecutable: boolean             // false → info-only card, no execute button
}

export interface RecipePlanItem extends PlanItemBase {
  service: 'recipe'
  recipeDetail: {
    difficulty: CookingSkill
    serves: number
    steps: RecipeStep[]
    ingredients: IngredientLine[]
    missingIngredients: string[]
    canMakeNow: boolean
    youtubeSearchQuery: string
    instamartCartReady: boolean     // all missing items available on Instamart
  }
}

export interface DeliveryPlanItem extends PlanItemBase {
  service: 'swiggy_food'
  deliveryDetail: {
    restaurantName: string
    restaurantId: SwiggyRestaurantId
    itemName: string
    estimatedDeliveryMinutes: Minutes
    offerApplied?: string           // "30% off up to Rs 100"
    deepLink: string
  }
}

export interface InstamartPlanItem extends PlanItemBase {
  service: 'instamart'
  instamartDetail: {
    items: IngredientLine[]
    totalCostInr: Rupees
    estimatedDeliveryMinutes: Minutes
    deepLink: string
  }
}

export interface DineoutPlanItem extends PlanItemBase {
  service: 'dineout'
  dineoutDetail: {
    venueName: string
    venueId: DineoutVenueId
    cuisine: string
    ambience: string
    availableSlots: ISODateTime[]
    deepLink: string
  }
}

export interface MealPrepPlanItem extends PlanItemBase {
  service: 'meal_prep'
  // V2: weekly schedule payload; no detail block in V1
}

export type PlanItem =
  | RecipePlanItem
  | DeliveryPlanItem
  | InstamartPlanItem
  | DineoutPlanItem
  | MealPrepPlanItem

export interface TimelineEntry {
  label: string                     // "Now", "At 6:30 PM", "Tomorrow"
  action: string
  itemId: RecommendationItemId
  scheduledFor?: ISODateTime
}

export interface MemoryPreview {
  key: FactKey
  value: unknown
  action: 'store' | 'update'
  reason: string
}

export interface Plan {
  id: RecommendationId
  situationId: SituationId
  headline: string
  reasoning: string
  planType: PlanType
  createdAt: ISODateTime
  comparison: ComparisonScores
  items: PlanItem[]                 // primary first (rank 1), then alternatives
  timeline?: TimelineEntry[]        // sequence / multi_service / weekly plans only
  memoryPreviews?: MemoryPreview[]  // facts to persist after the user acts
}

/**
 * Persisted row backing PlanItem (V2 table — V1 embeds in recommendations JSONB columns).
 */
export interface RecommendationItem {
  id: RecommendationItemId
  recommendationId: RecommendationId
  rank: number
  isPrimary: boolean
  service: Service
  title: string
  description: string
  estimatedCost: Rupees
  estimatedTime: Minutes
  calories: Kcal | null
  proteinG: Grams | null
  carbsG: Grams | null
  fatG: Grams | null
  executionData: unknown            // service-specific JSONB (deep links, IDs)
  isExecutable: boolean
  createdAt: ISODateTime
}

// ── §9 Recipe and Pantry ──────────────────────────────────────────────────────

/**
 * Canonical recipe step shape (unified across three source variants, TYPES.md §14 item 5).
 * `durationMin` is realistic, not optimistic.
 */
export interface RecipeStep {
  step: number                      // 1-based, contiguous
  instruction: string               // action-first: "Heat oil in a pan over medium flame."
  durationMin: Minutes
  tip?: string                      // optional pro tip shown in the UI
  youtubeTimestamp?: string         // "MM:SS" — only when keyTimestamps exist for the video
}

export interface Ingredient {
  name: string
  qty: string                       // standard units: "1 cup", "2 tbsp", "200g", "½ cup"
  inPantry: boolean                 // derived from PantryItem rows at plan time
  swiggyItemId?: InstamartItemId    // present iff orderable on Instamart
}

/**
 * Wire-level ingredient/cart line used inside PlanItem detail blocks (API.md).
 */
export interface IngredientLine {
  name: string
  quantity: string
  estimatedCostInr: Rupees
  swiggyItemId?: InstamartItemId    // absent = not available on Instamart
  inPantry: boolean
}

export interface IngredientSubstitution {
  missing: string                   // the ingredient not in pantry
  substitute: string                // what to use instead
  ratio: string                     // "1:1", "use half the quantity"
  qualityNote?: string              // "slightly less creamy result"
}

export interface Recipe {
  id: string
  name: string
  description: string
  cuisineType: string
  difficulty: CookingSkill
  serves: number
  cookingTimeMin: Minutes           // prep + cook, realistic
  ingredients: Ingredient[]
  missingIngredients: string[]      // names of ingredients with inPantry: false
  substitutions: IngredientSubstitution[]
  canMakeNow: boolean               // all ingredients present or substitutable
  nutrition: NutritionInfo | null
  steps: RecipeStep[]
  youtubeVideoId: YouTubeVideoId | null
  instamartShoppingList: InstamartItem[] | null  // missing items, if orderable
  isVegetarian: boolean
  isVegan: boolean
  containsAllergens: Allergen[]
}

// ── Pantry (V2 Milestone 1) ───────────────────────────────────────────────────

export interface PantryItem {
  id: PantryItemId
  userId: UserId
  itemName: string
  quantity: string | null           // "500", "2" — free text with unit alongside
  unit: string | null               // "g", "kg", "pieces", "packets"
  isStaple: boolean                 // staples never expire (salt, oil, rice)
  addedAt: ISODateTime
  expiresAt: ISODateTime | null     // non-staples expire after 30 days unless restated
  lastUsedAt: ISODateTime | null
}

export interface Pantry {
  userId: UserId
  items: PantryItem[]
  state: 'empty' | 'partial' | 'stocked'  // computed; feeds ScoringContext.pantryState
  lastUpdatedAt: ISODateTime | null        // stale after 7 days (pantryDataAvailable)
}

// ── Instamart cart (also used in Recommendation) ─────────────────────────────

/**
 * One confirmed cart line (persisted in recommendations.instamart_items).
 */
export interface InstamartItem {
  itemId: InstamartItemId
  name: string
  quantityNeeded: number
  unit: string                      // "pack", "kg", "g", "L", "piece"
  pricePerUnit: Rupees
  imageUrl?: string
  inStockConfirmed: boolean
}

// MemoryFactId, FactKey are exported from @/types/memory (source of truth).
// Allergen, EnginePath, PrimaryPath are exported from @/types/situation (source of truth).
// They are imported here for use within this file but not re-exported
// to avoid duplicate export conflicts in the barrel (types/index.ts).
