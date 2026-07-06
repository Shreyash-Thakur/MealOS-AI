/**
 * MealOS AI — Situation and Context Types
 * Source: docs/TYPES.md §5 and §6 (Clarification) and §7 (Decision Engine)
 *
 * Three-stage SituationContext lifecycle (TYPES.md §1):
 *   ExtractedContext  → (Memory Service merge) → SituationContext → (flatten) → ScoringContext
 */

import type {
  UserId,
  SituationId,
  ClarificationId,
  RecommendationId,
  ActionId,
  ISODateTime,
  Rupees,
  Minutes,
  Grams,
  Kcal,
  ConfidencePercent,
  ConfidenceLevel,
  SwiggyRestaurantId,
  SwiggyOrderId,
  DineoutVenueId,
} from './primitives'
import type { DietType, CookingSkill } from './memory'

// ── Situation core (§5) ───────────────────────────────────────────────────────

export type SituationStatus =
  | 'created'
  | 'intent_extracted'
  | 'clarifying'
  | 'context_ready'
  | 'planning'
  | 'plan_ready'
  | 'executing'
  | 'completed'
  | 'abandoned'
  | 'error'

export type SituationType =
  | 'sick'
  | 'broke'
  | 'date_planning'
  | 'party_hosting'
  | 'nutrition_goal'
  | 'quick_meal'
  | 'meal_prep'
  | 'office_lunch'
  | 'family_dinner'
  | 'late_night'
  | 'general'   // last resort; Clarification Engine disambiguates

export interface Situation {
  id: SituationId
  userId: UserId
  rawInput: string                                  // 1–2000 chars, never modified
  situationType: SituationType | null               // null until intent extraction completes
  context: SituationContext | null                  // null until Conversation Agent completes
  status: SituationStatus
  clarificationData: ClarificationData | null       // null if no clarification needed
  createdAt: ISODateTime
  updatedAt: ISODateTime
  contextReadyAt: ISODateTime | null
  planReadyAt: ISODateTime | null
  completedAt: ISODateTime | null
  lat: number | null                                // DECIMAL(10,8); geolocation or profile fallback
  lng: number | null                                // DECIMAL(11,8)
}

// ── 5.1 ExtractedContext — Conversation Agent output ─────────────────────────

/**
 * Fields that contain ONLY what the user said in this message.
 * Nothing the model infers from time/calendar belongs here.
 */
export interface ExplicitContext {
  sick?: boolean                      // only if directly stated ("fever", "unwell")
  budget?: Rupees                     // "2k" → 2000, "fifty bucks" → 50
  alone?: boolean
  canCook?: boolean                   // false = physically unable OR unwilling today
  guests?: number                     // includes the user; >= 2 for dates, >= 3 for parties
  occasion?: string                   // free text, always English: "anniversary", "IPL final"
  timeConstraintMinutes?: Minutes     // "half an hour" → 30; vague words → absent
  craving?: string                    // short, concrete, English: "biryani", "comfort food"
  nutritionGoal?: {
    protein?: Grams                   // only if a number was stated
    calories?: Kcal
  }
  location?: string                   // free text: "I'm in Bandra"
  timeframe?: 'now' | 'tonight' | 'week'
  indoorOutdoor?: 'indoor' | 'outdoor' | 'either'
  dietaryNote?: string                // only NEW info not already in memory summary
}

/**
 * Only two fields may be inferred — the SCHEMAS.md .strict() on InferredContextSchema
 * enforces this at the LLM boundary.
 */
export interface InferredContext {
  timeOfDay?: 'breakfast' | 'lunch' | 'dinner' | 'latenight'
  isWeekend?: boolean
}

/**
 * What the Conversation Agent emits (AGENTS.md §2.4, authoritative).
 * This IS the ConversationAgentOutput type (see agents.ts).
 */
export interface ExtractedContext {
  situationType: SituationType
  explicit: ExplicitContext
  inferred: InferredContext
  confidence: ConfidencePercent     // integer 0–100 (NOT 0.0–1.0)
  missingRequired: string[]         // context field names blocking a recommendation
  missingSoft: string[]             // would improve, not blocking
  ambiguities: string[]             // resolved uncertainties, for debugging
  nonFoodInput: boolean             // true → orchestrator redirects, skips planning
}

// ── 5.2 SituationContext — persisted, memory-merged ──────────────────────────

/**
 * Memory-derived fields merged by the Memory Service.
 */
export interface MemoryContext {
  dietType?: DietType
  allergies?: string[]
  budget?: Rupees               // daily food budget default
  cookingSkill?: CookingSkill
  kitchenEquipment?: string[]
  homeLoc?: string
  proteinTarget?: Grams
  preferredCuisines?: string[]
}

/**
 * Persisted in situations.context (JSONB).
 * = ExtractedContext layers + fromMemory added by the Memory Service.
 * Clarification answers are merged into `explicit` as they arrive.
 */
export interface SituationContext {
  situationType: SituationType
  explicit: ExplicitContext       // extracted + clarification answers merged in
  inferred: InferredContext
  fromMemory: MemoryContext
}

// ── 5.3 ScoringContext — Decision Engine input ────────────────────────────────

export type DietaryRestriction =
  | 'vegetarian' | 'vegan' | 'jain' | 'gluten_free'
  | 'dairy_free' | 'halal' | 'kosher'

export type Allergen =
  | 'shellfish' | 'nuts' | 'eggs' | 'dairy' | 'gluten' | 'soy' | 'fish'

export interface NutritionGoal {
  proteinG?: Grams
  caloriesKcal?: Kcal
  lowCarb?: boolean
  scope: 'meal' | 'day'           // per-meal vs full-day target
}

/**
 * The flat shape the deterministic scorer consumes.
 * Built by the orchestrator from SituationContext; no LLM touches it.
 */
export interface ScoringContext {
  situationType: SituationType

  // Time
  timeConstraintMinutes: Minutes | null  // null = no stated constraint
  currentHour: number                    // 0–23, user's local time
  isWeekend: boolean

  // Budget
  budgetRupees: Rupees | null
  budgetFlexibility: 'strict' | 'soft' | 'flexible'

  // Cooking
  canCook: boolean
  cookingSkillLevel: 'none' | 'beginner' | 'intermediate' | 'advanced'
  pantryState: 'empty' | 'partial' | 'stocked'

  // Social
  guests: number                         // 1 = alone
  occasion: 'casual' | 'date' | 'celebration' | 'work' | 'none'

  // Dietary
  dietaryRestrictions: DietaryRestriction[]
  allergens: Allergen[]                  // hard blocks
  likedCuisines: string[]
  dislikedCuisines: string[]

  // Nutrition
  nutritionGoal: NutritionGoal | null

  // Service availability
  swiggAvailable: boolean
  instamartAvailable: boolean
  dineoutAvailable: boolean

  // Memory quality (affects confidence only, never scores)
  memoryPopulated: boolean
  pantryDataAvailable: boolean           // pantry list < 7 days old
  missingRequiredFields: string[]        // assumed rather than known
}

// ── §6 Clarification ──────────────────────────────────────────────────────────

export type ClarificationQuestionType = 'single_choice' | 'multi_choice' | 'freetext' | 'number'

export interface ClarificationOption {
  label: string                          // "Need delivery — I'm wiped out"
  value: string | number | boolean
}

export interface ClarificationQuestion {
  id: string                             // "q1", "q2" — unique within the pass
  text: string                           // contextually phrased, never a form label
  field: keyof ExplicitContext           // which context key this answers
  type: ClarificationQuestionType
  options: ClarificationOption[]         // [] for freetext/number
  required: boolean
}

export type ClarificationAnswerValue = string | number | boolean | string[]
// single_choice → one option value; multi_choice → string[];
// freetext → string; number → integer

export interface ClarificationPass {
  passNumber: 1 | 2
  questions: ClarificationQuestion[]    // length 1–3
  answers: Record<string, ClarificationAnswerValue>  // questionId → answer
  askedAt: ISODateTime
  answeredAt: ISODateTime | null        // null while pending
}

export interface ClarificationData {
  passes: ClarificationPass[]           // length 0–2
}

/**
 * A single Q&A pair as fed to the Memory Agent (AGENTS.md §5.3).
 */
export interface ClarificationExchange {
  question: string                      // text shown to the user
  answer: string                        // user's verbatim answer
  fieldAnswered: keyof ExplicitContext
}

// ── §7 Decision Engine types ──────────────────────────────────────────────────

/**
 * Engine-internal path names (DECISION_ENGINE.md). Uppercase.
 * Maps to PrimaryPath via: COOK ↔ cook, ORDER ↔ order, DINE_OUT ↔ dineout.
 * The mapping is mechanical and happens exactly once, in the orchestrator.
 */
export type EnginePath = 'COOK' | 'ORDER' | 'DINE_OUT'

/**
 * API/DB layer path names (AGENTS.md, authoritative). Lowercase.
 */
export type PrimaryPath = 'cook' | 'order' | 'dineout'

export interface BasePathInput {
  estimatedCostRupees: Rupees
  estimatedTimeMinutes: Minutes       // cook: prep+cook; order: ETA; dine: travel+wait+meal
  proteinG: Grams | null              // null = not calculable — never estimated
  caloriesKcal: Kcal | null
  available: boolean                  // false = eliminated before scoring
}

export interface CookPathInput extends BasePathInput {
  path: 'COOK'
  recipeId: string | null             // null = generic home-cooking estimate
  recipeName: string | null
  canMakeFromPantry: boolean
  missingIngredientCount: number      // 0 iff canMakeFromPantry
  instamartCostForMissingRupees: Rupees
  cuisineType: string | null
  isVegetarian: boolean
  isVegan: boolean
  containsAllergens: Allergen[]
  difficultyLevel: 'easy' | 'medium' | 'hard'
}

export interface OrderPathInput extends BasePathInput {
  path: 'ORDER'
  restaurantId: SwiggyRestaurantId
  restaurantName: string
  cuisineType: string
  isVegetarianMenuAvailable: boolean
  isFullyVegetarian: boolean
  isVeganMenuAvailable: boolean
  containsAllergens: Allergen[]       // allergens in the recommended dish
  deliveryFeeRupees: Rupees
  discountRupees: Rupees
  minimumOrderRupees: Rupees
  ratingOutOf5: number                // 0.0–5.0, one decimal
  deliveryTimeMinutes: Minutes
}

export interface DineOutPathInput extends BasePathInput {
  path: 'DINE_OUT'
  restaurantId: DineoutVenueId
  restaurantName: string
  cuisineType: string
  isVegetarianMenuAvailable: boolean
  isFullyVegetarian: boolean
  isVeganMenuAvailable: boolean
  containsAllergens: Allergen[]
  ambienceScore: number               // 0–100, from Dineout data
  hasTableAvailableNow: boolean
  guestCapacity: number
  travelTimeMinutes: Minutes
  mealTimeMinutes: Minutes
  pricePerPersonRupees: Rupees        // estimatedCostRupees = this * guests
  ratingOutOf5: number
}

export type PathInput = CookPathInput | OrderPathInput | DineOutPathInput

export interface ScoreWeights {
  goalMatch: number          // the four must sum to exactly 1.0
  budgetFit: number
  timeFit: number
  preferenceMatch: number
}

export type WeightTable = Record<SituationType, ScoreWeights>

export interface PathScore {
  path: EnginePath
  available: boolean                 // false → all sub-scores are 0

  goalMatchScore: number             // 0–100
  budgetFitScore: number             // 0–100
  timeFitScore: number               // 0–100
  prefMatchScore: number             // 0–100
  finalScore: number                 // 0–100, weighted

  goalMatchNotes: string[]           // e.g. ["protein target met"]
  budgetNotes: string[]
  timeNotes: string[]
  prefNotes: string[]
  hardBlocks: string[]               // e.g. ["allergen:shellfish present"]
}

/**
 * The complete deterministic output for one situation.
 * Product vocabulary: "Decision". Engine code uses DecisionResult.
 */
export interface DecisionResult {
  cookScore: PathScore
  orderScore: PathScore
  dineOutScore: PathScore

  winner: EnginePath | 'NO_WINNER'   // NO_WINNER: all available paths < 30, or none available
  isSplitRecommendation: boolean      // top two within 5 points
  splitAlternative: EnginePath | null

  confidence: ConfidencePercent

  simulator: PlanSimulatorDeltas
  weightsUsed: ScoreWeights
  computedAt: ISODateTime
}

/** Product alias; use DecisionResult in engine code */
export type Decision = DecisionResult

/**
 * Compact projection consumed by the Planning Agent.
 * Derived from DecisionResult; never computed independently.
 */
export interface ScoreResult {
  cook: number                       // finalScore, 0–100
  order: number
  dineout: number
  winner: PrimaryPath | 'no_winner'
  confidence: ConfidencePercent
}

/** The Confidence Card shape. `level` is derived from `percent`. */
export interface ConfidenceScore {
  percent: ConfidencePercent
  level: ConfidenceLevel
  knownFields: string[]              // resolved from memory or inference
  missingFields: string[]            // assumed instead of known
  assumptions: ContextAssumption[]
}

export interface ContextAssumption {
  field: string
  value: string | number | boolean
  source: 'memory' | 'inference' | 'time_of_day'
}

export interface PlanSimulatorDeltas {
  primaryPath: EnginePath
  alternativePath: EnginePath | null

  deltaCostRupees: Rupees | null     // positive = primary is cheaper
  deltaTimeMinutes: Minutes | null   // positive = primary is faster
  deltaProteinG: Grams | null        // positive = primary has more protein

  showCostDelta: boolean             // "meaningful enough to display"
  showTimeDelta: boolean
  showProteinDelta: boolean
}

// ── SSE Events and User Actions (§13) ─────────────────────────────────────────

export type UserActionType =
  | 'executed_cook'
  | 'executed_order'
  | 'executed_dineout'
  | 'dismissed'
  | 'modified'

export interface UserAction {
  id: ActionId
  userId: UserId
  situationId: SituationId
  recommendationId: RecommendationId
  actionType: UserActionType
  rating: 1 | 2 | 3 | 4 | 5 | null     // null until post-meal feedback
  externalOrderId: SwiggyOrderId | null  // null for cook/dismissed
  createdAt: ISODateTime
  updatedAt: ISODateTime                 // bumped when rating lands
}
