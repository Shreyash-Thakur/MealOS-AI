# MealOS AI — TypeScript Domain Type Library

**Project:** MealOS AI
**Last Updated:** 2026-07-07
**Status:** Authoritative type reference. Interfaces only — zero implementation. Every type here round-trips to the Prisma schema in `docs/DATABASE.md`; deliberate divergences are listed in §14.
**Related files:** `docs/SCHEMAS.md` (Zod validation for every type that crosses a trust boundary), `docs/DATABASE.md` (persisted shapes), `docs/API.md` (wire contracts), `docs/AGENTS.md` (agent I/O), `docs/DECISION_ENGINE.md` (scoring types)

---

## Table of Contents

1. [Conventions](#1-conventions)
2. [Branded Scalars and Primitives](#2-branded-scalars-and-primitives)
3. [Identity and Profile](#3-identity-and-profile)
4. [Memory](#4-memory)
5. [Situation and Context](#5-situation-and-context)
6. [Clarification](#6-clarification)
7. [Decision Engine](#7-decision-engine)
8. [Plan and Recommendation](#8-plan-and-recommendation)
9. [Recipe and Pantry](#9-recipe-and-pantry)
10. [Swiggy Domain](#10-swiggy-domain)
11. [Tool Responses](#11-tool-responses)
12. [Agents and Conversation](#12-agents-and-conversation)
13. [SSE Events and User Actions](#13-sse-events-and-user-actions)
14. [Deliberate Divergences from Source Documents](#14-deliberate-divergences-from-source-documents)

---

## 1. Conventions

These rules apply to every type in this document. A future implementer must not deviate from them without amending this section first.

**Money is integer whole rupees (INR), never paise, never floats.** `docs/DATABASE.md` stores `estimated_cost INT` in INR; all API examples use whole-rupee integers (`160`, `2500`). The branded `Rupees` type enforces this at the type level. Anything sub-rupee is rounded to the nearest integer at the normalization boundary (Tool Agent rule: "159.99" → 160).

**Durations state their unit in the type name.** `Minutes` for user-facing durations (cook time, delivery ETA), `Ms` for internal timeouts and latencies, `Seconds` only for YouTube timestamps. A bare `number` duration is a review-blocking error.

**Two confidence conventions exist, deliberately, in different domains:**
- **Pipeline confidence is an integer 0–100** (`ConfidencePercent`): Conversation Agent classification confidence, Decision Engine confidence, `recommendations.confidence_score`. This is what the Confidence Card renders.
- **Memory fact confidence is a decimal 0.0–1.0** (`FactConfidence`), quantized to `0.4 | 0.6 | 0.8 | 1.0` at write time by the Memory Agent, but stored as `FLOAT` (confirmation increments of +0.05 produce intermediate values like `0.85`).

Never convert between them implicitly. The SSE `context_understood` event carries pipeline confidence and therefore uses 0–100 (this is a documented correction of the 0.91 example in `docs/API.md` — see §14).

**IDs are branded strings.** The brand pattern is declared once in §2 and applied to every entity. Brands are erased at runtime (they are plain strings in JSON and in Prisma) but prevent cross-entity ID mix-ups at compile time — passing a `RecommendationId` where a `SituationId` is expected is a type error.

**Path naming:** the API/DB layer uses lowercase `'cook' | 'order' | 'dineout'` (`PrimaryPath`, per `docs/AGENTS.md`, which is authoritative over ARCHITECTURE.md). The Decision Engine internally uses uppercase `'COOK' | 'ORDER' | 'DINE_OUT'` (`EnginePath`, per `docs/DECISION_ENGINE.md`). The mapping is mechanical (`COOK` ↔ `cook`, `DINE_OUT` ↔ `dineout`) and happens exactly once, in the orchestrator, when engine output is persisted.

**Wire casing:** API request/response bodies use `snake_case` (matching `docs/API.md`); in-process domain types use `camelCase`. Types in this document are the in-process shapes; `docs/SCHEMAS.md` defines the snake_case wire schemas and the correspondence is 1:1 by name.

**`null` vs `undefined`/absent:** `null` means "known to be absent / not applicable" and appears in persisted rows and wire payloads. Optional (`?`) means "may be omitted"; used for fields that are conditionally present (e.g. path-specific recommendation fields). Tool results follow the Tool Agent rule: failed tool → `null`, successful tool with no results → `[]`.

**SituationContext has a three-stage lifecycle** (§5). The three source documents describe three different shapes because they describe three different stages. This document names all three so no future reader conflates them.

```
ExtractedContext            (Conversation Agent output — AGENTS.md §2.4)
      │  + memory facts merged by Memory Service
      ▼
SituationContext            (persisted in situations.context — DATABASE.md §2.3)
      │  + clarification answers applied, flattened for scoring
      ▼
ScoringContext              (Decision Engine input — DECISION_ENGINE.md §2)
```

---

## 2. Branded Scalars and Primitives

The brand pattern, declared once. Every branded type is a plain `string`/`number` at runtime.

```ts
// ── Brand utility ────────────────────────────────────────────────────────────
declare const __brand: unique symbol
type Brand<T, B extends string> = T & { readonly [__brand]: B }

// ── Entity IDs (all UUID v4 strings) ─────────────────────────────────────────
type UserId             = Brand<string, 'UserId'>
type ClerkUserId        = Brand<string, 'ClerkUserId'>        // "user_2NNiSlFa..."
type SituationId        = Brand<string, 'SituationId'>
type ClarificationId    = Brand<string, 'ClarificationId'>
type RecommendationId   = Brand<string, 'RecommendationId'>
type RecommendationItemId = Brand<string, 'RecommendationItemId'>
type ActionId           = Brand<string, 'ActionId'>
type MemoryFactId       = Brand<string, 'MemoryFactId'>
type PantryItemId       = Brand<string, 'PantryItemId'>
type AgentRunId         = Brand<string, 'AgentRunId'>
type CookingSessionId   = Brand<string, 'CookingSessionId'>

// ── External IDs (opaque strings owned by other systems) ─────────────────────
type SwiggyRestaurantId = Brand<string, 'SwiggyRestaurantId'> // "swg_rest_4821"
type SwiggyMenuItemId   = Brand<string, 'SwiggyMenuItemId'>
type InstamartItemId    = Brand<string, 'InstamartItemId'>
type DineoutVenueId     = Brand<string, 'DineoutVenueId'>
type SwiggyOrderId      = Brand<string, 'SwiggyOrderId'>      // external_order_id
type YouTubeVideoId     = Brand<string, 'YouTubeVideoId'>     // ID only, never a URL

// ── Units ─────────────────────────────────────────────────────────────────────
type Rupees            = Brand<number, 'Rupees'>              // integer whole INR, >= 0
type Minutes           = Brand<number, 'Minutes'>             // integer, >= 0
type Ms                = Brand<number, 'Ms'>                  // integer milliseconds
type Seconds           = Brand<number, 'Seconds'>             // YouTube offsets only
type Grams             = Brand<number, 'Grams'>               // protein/carbs/fat
type Kcal              = Brand<number, 'Kcal'>

// ── Confidence (see §1 — two deliberate conventions) ─────────────────────────
type ConfidencePercent = Brand<number, 'ConfidencePercent'>   // integer 0–100
type FactConfidence    = Brand<number, 'FactConfidence'>      // decimal 0.0–1.0

// ── Time ─────────────────────────────────────────────────────────────────────
type ISODateTime = Brand<string, 'ISODateTime'>  // "2026-07-06T14:30:00Z" (UTC unless offset given)
type ISODate     = Brand<string, 'ISODate'>      // "2026-07-06"
type IANATimezone = Brand<string, 'IANATimezone'> // "Asia/Kolkata"
```

`ConfidencePercent` also has a UI projection used by the Planning Agent output; the mapping is fixed and lives in one place:

```ts
type ConfidenceLevel = 'high' | 'medium' | 'low'
// score > 70 → 'high', 50–70 → 'medium', < 50 → 'low'  (DECISION_ENGINE.md §6)
```

---

## 3. Identity and Profile

`User` is the extension table for Clerk identity (`users` in DATABASE.md). Clerk owns auth; this row anchors all product data. `lastActiveAt` is null until the first authenticated request after signup.

```ts
interface User {
  id: UserId
  clerkId: ClerkUserId       // DB column: clerk_id (UNIQUE)
  email: string              // UNIQUE; format validated by Zod, not the DB
  name: string | null
  phone: string | null       // E.164; SMS notifications are V2
  createdAt: ISODateTime
  updatedAt: ISODateTime
  lastActiveAt: ISODateTime | null
}
```

`UserProfile` is the structured-preferences projection returned by `GET /api/v1/memory`. In V1 there is **no** `user_profiles` table — every field here is derived from `user_memory_facts` rows by the Memory Service (see §14). Nullable fields mean "the user never told us."

```ts
type DietType     = 'vegetarian' | 'vegan' | 'non_vegetarian' | 'pescatarian' | 'jain'
type CookingSkill = 'beginner' | 'intermediate' | 'advanced'

interface UserProfile {
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
```

---

## 4. Memory

One row per atomic fact per user, upserted on `(userId, factKey)`. `MemorySource` is the union of every value used across the docs — the DB enum must contain all six (see §14 for the reconciliation).

```ts
type MemorySource =
  | 'onboarding'            // stored by POST /api/v1/onboarding
  | 'user_stated'           // explicitly stated in raw situation input
  | 'user_edited'           // edited via PATCH /api/v1/memory (Memory Panel)
  | 'clarification_answer'  // confirmed via a clarification answer
  | 'behavior_inferred'     // pattern across 3+ situations
  | 'action_derived'        // derived from executed orders/bookings

type FactType = 'string' | 'number' | 'boolean' | 'array' | 'date'
```

`FactKey` is a closed set — the Memory Agent is forbidden from inventing keys (`AGENTS.md §5.5`). `FactValueByKey` is the single source of truth for per-key value shapes; `MemoryFact.factValue` is typed by lookup.

```ts
type FactKey = keyof FactValueByKey

type FactValueByKey = {
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

interface MemoryFact<K extends FactKey = FactKey> {
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
```

The semantic layer (V2, pgvector). `embedding` never crosses the API boundary — it exists only in the DB and the Memory Service.

```ts
type MemoryContentType = 'situation_summary' | 'preference' | 'outcome' | 'correction'

interface MemoryEmbeddingRecord {
  id: string
  userId: UserId
  content: string                       // the text that was embedded
  embedding: number[]                   // vector(1536)
  contentType: MemoryContentType
  sourceSituationId: SituationId | null
  createdAt: ISODateTime
}
```

The Memory Panel aggregate (`GET /api/v1/memory` response, domain shape):

```ts
interface MemoryFactView {
  id: MemoryFactId
  key: FactKey
  value: unknown                 // FactValueByKey[key]; unknown at the aggregate level
  factType: FactType
  source: MemorySource
  confidence: FactConfidence
  lastConfirmedAt: ISODateTime
  expiresAt: ISODateTime | null
  editable: boolean              // action_derived facts are read-only in the Panel
  displayLabel: string           // "Daily food budget"
  displayCategory: string        // "Budget", "Preferences", "Order History"
}

interface Memory {
  profile: UserProfile
  facts: MemoryFactView[]
  lastUpdatedAt: ISODateTime
  factCount: number
  onboardingComplete: boolean
}
```

---

## 5. Situation and Context

The core event. One row per submission; owns the pipeline state machine. `rawInput` is verbatim and immutable — the API layer caps it at 2000 chars, and truncates to 500 chars before the Conversation Agent sees it (both limits are real; see SCHEMAS.md).

```ts
type SituationStatus =
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

type SituationType =
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
  | 'general'            // last resort; Clarification Engine disambiguates

interface Situation {
  id: SituationId
  userId: UserId
  rawInput: string                       // 1–2000 chars, never modified
  situationType: SituationType | null    // null until intent extraction completes
  context: SituationContext | null       // null until Conversation Agent completes
  status: SituationStatus
  clarificationData: ClarificationData | null  // null if no clarification needed
  createdAt: ISODateTime
  updatedAt: ISODateTime
  contextReadyAt: ISODateTime | null
  planReadyAt: ISODateTime | null
  completedAt: ISODateTime | null
  lat: number | null                     // DECIMAL(10,8); geolocation or profile fallback
  lng: number | null                     // DECIMAL(11,8)
}
```

### 5.1 ExtractedContext — Conversation Agent output

What the Conversation Agent emits (AGENTS.md §2.4, authoritative). `explicit` contains **only** what the user said in this message; `inferred` may contain only the two time-derived fields. Everything else the model claims to know is a schema violation.

```ts
interface ExplicitContext {
  sick?: boolean                 // only if directly stated ("fever", "unwell")
  budget?: Rupees                // "2k" → 2000, "fifty bucks" → 50
  alone?: boolean
  canCook?: boolean              // false = physically unable OR unwilling today
  guests?: number                // includes the user; >= 2 for dates, >= 3 for parties
  occasion?: string              // free text, always English: "anniversary", "IPL final"
  timeConstraintMinutes?: Minutes  // "half an hour" → 30; vague words → absent
  craving?: string               // short, concrete, English: "biryani", "comfort food"
  nutritionGoal?: {
    protein?: Grams              // only if a number was stated
    calories?: Kcal
  }
  location?: string              // free text: "I'm in Bandra"
  timeframe?: 'now' | 'tonight' | 'week'
  indoorOutdoor?: 'indoor' | 'outdoor' | 'either'
  dietaryNote?: string           // only NEW info not already in memory summary
}

interface InferredContext {
  timeOfDay?: 'breakfast' | 'lunch' | 'dinner' | 'latenight'
  isWeekend?: boolean
}

interface ExtractedContext {
  situationType: SituationType
  explicit: ExplicitContext
  inferred: InferredContext
  confidence: ConfidencePercent    // integer 0–100
  missingRequired: string[]        // context field names blocking a recommendation
  missingSoft: string[]            // would improve, not blocking
  ambiguities: string[]            // resolved uncertainties, for debugging
  nonFoodInput: boolean            // true → orchestrator redirects, skips planning
}
```

### 5.2 SituationContext — persisted, memory-merged

What lands in `situations.context` (DATABASE.md §2.3): the extracted layers plus a `fromMemory` layer added by the Memory Service. Clarification answers are merged into `explicit` as they arrive (the answer becomes an explicitly-known fact).

```ts
interface MemoryContext {
  dietType?: DietType
  allergies?: string[]
  budget?: Rupees                  // daily food budget default
  cookingSkill?: CookingSkill
  kitchenEquipment?: string[]
  homeLoc?: string
  proteinTarget?: Grams
  preferredCuisines?: string[]
}

interface SituationContext {
  situationType: SituationType
  explicit: ExplicitContext        // extracted + clarification answers merged in
  inferred: InferredContext
  fromMemory: MemoryContext
}
```

### 5.3 ScoringContext — Decision Engine input

The flat shape the deterministic scorer consumes (DECISION_ENGINE.md §2, verbatim semantics). Built by the orchestrator from `SituationContext`; no LLM touches it. Field-level notes live in DECISION_ENGINE.md — reproduced here only where a unit or invariant matters.

```ts
type DietaryRestriction =
  | 'vegetarian' | 'vegan' | 'jain' | 'gluten_free'
  | 'dairy_free' | 'halal' | 'kosher'

type Allergen =
  | 'shellfish' | 'nuts' | 'eggs' | 'dairy' | 'gluten' | 'soy' | 'fish'

interface NutritionGoal {
  proteinG?: Grams
  caloriesKcal?: Kcal
  lowCarb?: boolean
  scope: 'meal' | 'day'            // per-meal vs full-day target
}

interface ScoringContext {
  situationType: SituationType

  // Time
  timeConstraintMinutes: Minutes | null   // null = no stated constraint
  currentHour: number                     // 0–23, user's local time
  isWeekend: boolean

  // Budget
  budgetRupees: Rupees | null
  budgetFlexibility: 'strict' | 'soft' | 'flexible'

  // Cooking
  canCook: boolean
  cookingSkillLevel: 'none' | 'beginner' | 'intermediate' | 'advanced'
  pantryState: 'empty' | 'partial' | 'stocked'

  // Social
  guests: number                          // 1 = alone
  occasion: 'casual' | 'date' | 'celebration' | 'work' | 'none'

  // Dietary
  dietaryRestrictions: DietaryRestriction[]
  allergens: Allergen[]                   // hard blocks
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
  pantryDataAvailable: boolean            // pantry list < 7 days old
  missingRequiredFields: string[]         // assumed rather than known
}
```

---

## 6. Clarification

Max 3 questions per pass, max 2 passes per situation, 5-minute answer expiry. `field` names a key of `ExplicitContext` — the answer is merged there.

```ts
type ClarificationQuestionType = 'single_choice' | 'multi_choice' | 'freetext' | 'number'

interface ClarificationOption {
  label: string                            // "Need delivery — I'm wiped out"
  value: string | number | boolean
}

interface ClarificationQuestion {
  id: string                               // "q1", "q2" — unique within the pass
  text: string                             // contextually phrased, never a form label
  field: keyof ExplicitContext             // which context key this answers
  type: ClarificationQuestionType
  options: ClarificationOption[]           // [] for freetext/number
  required: boolean
}

type ClarificationAnswerValue = string | number | boolean | string[]
// single_choice → one option value; multi_choice → string[];
// freetext → string; number → integer

interface ClarificationPass {
  passNumber: 1 | 2
  questions: ClarificationQuestion[]       // length 1–3
  answers: Record<string, ClarificationAnswerValue>  // questionId → answer
  askedAt: ISODateTime
  answeredAt: ISODateTime | null           // null while pending
}

interface ClarificationData {
  passes: ClarificationPass[]              // length 0–2
}

/** A single Q&A pair as fed to the Memory Agent (AGENTS.md §5.3). */
interface ClarificationExchange {
  question: string                         // text shown to the user
  answer: string                           // user's verbatim answer
  fieldAnswered: keyof ExplicitContext
}
```

---

## 7. Decision Engine

All scoring types are `docs/DECISION_ENGINE.md` verbatim (it is the authority for engine internals). Reproduced here so this document is a complete library; units branded.

### 7.1 Path inputs

```ts
type EnginePath = 'COOK' | 'ORDER' | 'DINE_OUT'

interface BasePathInput {
  estimatedCostRupees: Rupees
  estimatedTimeMinutes: Minutes      // cook: prep+cook; order: ETA; dine: travel+wait+meal
  proteinG: Grams | null             // null = not calculable — never estimated
  caloriesKcal: Kcal | null
  available: boolean                 // false = eliminated before scoring
}

interface CookPathInput extends BasePathInput {
  path: 'COOK'
  recipeId: string | null            // null = generic home-cooking estimate
  recipeName: string | null
  canMakeFromPantry: boolean
  missingIngredientCount: number     // 0 iff canMakeFromPantry
  instamartCostForMissingRupees: Rupees
  cuisineType: string | null
  isVegetarian: boolean
  isVegan: boolean
  containsAllergens: Allergen[]
  difficultyLevel: 'easy' | 'medium' | 'hard'
}

interface OrderPathInput extends BasePathInput {
  path: 'ORDER'
  restaurantId: SwiggyRestaurantId
  restaurantName: string
  cuisineType: string
  isVegetarianMenuAvailable: boolean
  isFullyVegetarian: boolean
  isVeganMenuAvailable: boolean
  containsAllergens: Allergen[]      // allergens in the recommended dish
  deliveryFeeRupees: Rupees
  discountRupees: Rupees
  minimumOrderRupees: Rupees
  ratingOutOf5: number               // 0.0–5.0, one decimal
  deliveryTimeMinutes: Minutes
}

interface DineOutPathInput extends BasePathInput {
  path: 'DINE_OUT'
  restaurantId: DineoutVenueId
  restaurantName: string
  cuisineType: string
  isVegetarianMenuAvailable: boolean
  isFullyVegetarian: boolean
  isVeganMenuAvailable: boolean
  containsAllergens: Allergen[]
  ambienceScore: number              // 0–100, from Dineout data
  hasTableAvailableNow: boolean
  guestCapacity: number
  travelTimeMinutes: Minutes
  mealTimeMinutes: Minutes
  pricePerPersonRupees: Rupees       // estimatedCostRupees = this * guests
  ratingOutOf5: number
}

type PathInput = CookPathInput | OrderPathInput | DineOutPathInput
```

### 7.2 Scores and result

```ts
interface ScoreWeights {
  goalMatch: number          // the four must sum to exactly 1.0
  budgetFit: number
  timeFit: number
  preferenceMatch: number
}

type WeightTable = Record<SituationType, ScoreWeights>

interface PathScore {
  path: EnginePath
  available: boolean               // false → all sub-scores are 0

  goalMatchScore: number           // 0–100
  budgetFitScore: number           // 0–100
  timeFitScore: number             // 0–100
  prefMatchScore: number           // 0–100
  finalScore: number               // 0–100, weighted

  goalMatchNotes: string[]         // e.g. ["protein target met"]
  budgetNotes: string[]
  timeNotes: string[]
  prefNotes: string[]
  hardBlocks: string[]             // e.g. ["allergen:shellfish present"]
}

/** `Decision` in product vocabulary. The complete deterministic output for one situation. */
interface DecisionResult {
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

type Decision = DecisionResult   // product alias; use DecisionResult in engine code

/** Compact projection consumed by the Planning Agent and the README example.
 *  Derived from DecisionResult; never computed independently. */
interface ScoreResult {
  cook: number                     // finalScore, 0–100
  order: number
  dineout: number
  winner: PrimaryPath | 'no_winner'
  confidence: ConfidencePercent
}

/** The Confidence Card shape. `level` is derived from `percent` (see §2). */
interface ConfidenceScore {
  percent: ConfidencePercent
  level: ConfidenceLevel
  knownFields: string[]            // resolved from memory or inference
  missingFields: string[]          // assumed instead of known
  assumptions: ContextAssumption[]
}

interface ContextAssumption {
  field: string
  value: string | number | boolean
  source: 'memory' | 'inference' | 'time_of_day'
}

interface PlanSimulatorDeltas {
  primaryPath: EnginePath
  alternativePath: EnginePath | null

  deltaCostRupees: Rupees | null    // positive = primary is cheaper
  deltaTimeMinutes: Minutes | null  // positive = primary is faster
  deltaProteinG: Grams | null       // positive = primary has more protein

  showCostDelta: boolean            // "meaningful enough to display"
  showTimeDelta: boolean
  showProteinDelta: boolean
}
```

---

## 8. Plan and Recommendation

### 8.1 Comparison (the Cook / Order / Dine table)

The persisted `recommendations.comparison_scores` JSONB. `scoringFactors` are **weighted contributions** (0–25 each, can be negative for wrong-fit paths) — not the engine's 0–100 sub-scores. Key names follow the engine's four dimensions (see §14 for the rename from DATABASE.md's `contextFit`/`nutritionFit`).

```ts
interface PathComparison {
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

interface ComparisonScores {
  cook: PathComparison
  order: PathComparison
  dineOut: PathComparison
}

type Comparison = ComparisonScores   // product vocabulary alias
```

### 8.2 Recommendation (persisted, 1:1 with Situation)

```ts
type PrimaryPath = 'cook' | 'order' | 'dineout'
type PlanType = 'single' | 'sequence' | 'multi_service' | 'weekly'

interface NutritionInfo {
  calories: Kcal
  proteinG: Grams
  carbsG: Grams
  fatG: Grams
}

interface Recommendation {
  id: RecommendationId
  situationId: SituationId          // UNIQUE — enforces 1:1
  userId: UserId                    // denormalized for user-scoped queries

  comparisonScores: ComparisonScores
  primaryPath: PrimaryPath
  explanation: string               // Claude's 2–4 sentences; the only LLM prose stored
  confidenceScore: ConfidencePercent

  title: string                     // "Khichdi from Haldiram's" — specific, never generic
  estimatedCost: Rupees             // primary recommendation total
  estimatedTimeMin: Minutes

  calories: Kcal | null             // null when nutrition data unavailable — never estimated
  proteinG: Grams | null
  carbsG: Grams | null
  fatG: Grams | null

  youtubeUrl: string | null         // COOK path only
  recipeSteps: RecipeStep[] | null  // COOK path only
  instamartItems: InstamartItem[] | null  // when missing ingredients are sourceable
  swiggyData: SwiggyData | null     // ORDER and DINE_OUT paths

  createdAt: ISODateTime
}
```

`SwiggyData` — mutually exclusive sub-shapes by path, kept as one JSONB column:

```ts
interface SwiggyData {
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

interface DineoutSlot {
  date: ISODate
  time: string                      // "HH:MM" 24h
  tableSize: number
}
```

### 8.3 Plan and PlanItem (wire/UI aggregate)

The Situation Board renders a `Plan` — the API-level aggregate assembled from `Recommendation` + item rows (`GET /api/v1/recommendations/:id`). `PlanItem` is a discriminated union on `service`: the detail block is present exactly when its discriminant matches.

```ts
type Service = 'swiggy_food' | 'instamart' | 'dineout' | 'recipe' | 'meal_prep'

interface PlanItemBase {
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

interface RecipePlanItem extends PlanItemBase {
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

interface DeliveryPlanItem extends PlanItemBase {
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

interface InstamartPlanItem extends PlanItemBase {
  service: 'instamart'
  instamartDetail: {
    items: IngredientLine[]
    totalCostInr: Rupees
    estimatedDeliveryMinutes: Minutes
    deepLink: string
  }
}

interface DineoutPlanItem extends PlanItemBase {
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

interface MealPrepPlanItem extends PlanItemBase {
  service: 'meal_prep'
  // V2: weekly schedule payload; no detail block in V1
}

type PlanItem =
  | RecipePlanItem
  | DeliveryPlanItem
  | InstamartPlanItem
  | DineoutPlanItem
  | MealPrepPlanItem

interface TimelineEntry {
  label: string                     // "Now", "At 6:30 PM", "Tomorrow"
  action: string
  itemId: RecommendationItemId
  scheduledFor?: ISODateTime
}

interface MemoryPreview {
  key: FactKey
  value: unknown
  action: 'store' | 'update'
  reason: string
}

interface Plan {
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
```

`RecommendationItem` (persisted row backing `PlanItem`; V2 table — V1 embeds items in the `recommendations` JSONB columns, see §14):

```ts
interface RecommendationItem {
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
```

---

## 9. Recipe and Pantry

`RecipeStep` is the single canonical step shape (unified across the three source variants — see §14). `durationMin` is realistic, not optimistic: chopping = 3, sauté = 4–6, boil = 5.

```ts
interface RecipeStep {
  step: number                      // 1-based, contiguous
  instruction: string               // action-first: "Heat oil in a pan over medium flame."
  durationMin: Minutes
  tip?: string                      // optional pro tip shown in the UI
  youtubeTimestamp?: string         // "MM:SS" — only when keyTimestamps exist for the video
}

interface Ingredient {
  name: string
  qty: string                       // standard units: "1 cup", "2 tbsp", "200g", "½ cup"
  inPantry: boolean                 // derived from PantryItem rows at plan time
  swiggyItemId?: InstamartItemId    // present iff orderable on Instamart
}

/** Wire-level ingredient/cart line used inside PlanItem detail blocks (API.md). */
interface IngredientLine {
  name: string
  quantity: string
  estimatedCostInr: Rupees
  swiggyItemId?: InstamartItemId    // absent = not available on Instamart
  inPantry: boolean
}

interface IngredientSubstitution {
  missing: string                   // the ingredient not in pantry
  substitute: string                // what to use instead
  ratio: string                     // "1:1", "use half the quantity"
  qualityNote?: string              // "slightly less creamy result"
}

interface Recipe {
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
```

Pantry (`pantry_items` table, V2 Milestone 1; V1 approximates with the `pantry.staples` memory fact):

```ts
interface PantryItem {
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

interface Pantry {
  userId: UserId
  items: PantryItem[]
  state: 'empty' | 'partial' | 'stocked'   // computed; feeds ScoringContext.pantryState
  lastUpdatedAt: ISODateTime | null         // stale after 7 days (pantryDataAvailable)
}
```

---

## 10. Swiggy Domain

Normalized shapes owned by MealOS. Raw Swiggy MCP payloads never leave `lib/mcp/swiggy.ts` — these are the post-normalization types (Tool Agent rules: integer rupees, exact restaurant names, nutrition only if returned, never estimated).

```ts
interface MenuItem {
  name: string
  price: Rupees
  isVeg: boolean
  calories?: Kcal                   // only if Swiggy returned it — omit, never 0/null
  proteinG?: Grams
}

interface Restaurant {
  restaurantId: SwiggyRestaurantId
  name: string                      // exact Swiggy display name, never truncated
  rating: number                    // 0.0–5.0, one decimal
  deliveryTimeMin: Minutes
  deliveryFee: Rupees
  minOrderValue: Rupees
  cuisineTypes: string[]
  topItems: MenuItem[]
}

/** One Instamart search result (Tool Agent output). found:false = searched, unavailable. */
interface InstamartResult {
  item: string                      // the search term passed in
  found: boolean
  price?: Rupees                    // present iff found
  unit?: string                     // "200g", "1kg", "500ml"
  brand?: string
  deliveryTimeMin?: Minutes         // typically 15–30
  instamartItemId?: InstamartItemId
}

/** One confirmed cart line (persisted in recommendations.instamart_items). */
interface InstamartItem {
  itemId: InstamartItemId
  name: string
  quantityNeeded: number
  unit: string                      // "pack", "kg", "g", "L", "piece"
  pricePerUnit: Rupees
  imageUrl?: string
  inStockConfirmed: boolean
}

interface InstamartCart {
  items: InstamartItem[]
  totalCostInr: Rupees              // sum of quantityNeeded * pricePerUnit
  estimatedDeliveryMinutes: Minutes
  deepLink: string                  // Instamart cart deep link
}

interface DineoutVenue {
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

type DineoutAmbience =
  | 'romantic' | 'rooftop' | 'candlelit' | 'casual' | 'fine-dining'
  | 'outdoor' | 'live-music' | 'family-friendly' | 'sports-bar'

type ReservationStatus = 'pending' | 'confirmed' | 'failed' | 'cancelled'

interface DineoutReservation {
  venueId: DineoutVenueId
  venueName: string
  dateTime: ISODateTime             // selected slot with offset (+05:30)
  partySize: number
  status: ReservationStatus
  reservationId?: SwiggyOrderId     // Swiggy Dineout reference, once confirmed
  bookingUrl: string                // fallback manual-booking link
}
```

---

## 11. Tool Responses

`ToolResponse` is a discriminated union over every external tool the Tool Agent can call. `ok: true` carries normalized data; `ok: false` carries a tool-scoped error code. This is the shape stored per-tool inside `ToolAgentOutput` snapshots.

```ts
type ToolName =
  | 'swiggy_search_restaurants'
  | 'swiggy_search_instamart'
  | 'swiggy_search_dineout'
  | 'youtube_search_recipe'

type SwiggyToolErrorCode =
  | 'LOCATION_NOT_SERVICEABLE' | 'NO_RESULTS' | 'RATE_LIMITED'
  | 'SWIGGY_DOWN' | 'INSTAMART_DOWN' | 'DINEOUT_DOWN' | 'NO_AVAILABILITY'

type YouTubeToolErrorCode = 'NO_RESULTS' | 'QUOTA_EXCEEDED' | 'API_DOWN'

interface YouTubeRecipeResult {
  videoId: YouTubeVideoId
  title: string
  channelName: string
  durationSeconds: Seconds
  thumbnailUrl: string
  viewCount: number
  publishedAt: ISODateTime
  keyTimestamps: {
    label: string                   // "Add dal", "Start tempering"
    seconds: Seconds
  }[]
}

type ToolResponse =
  | { tool: 'swiggy_search_restaurants'; ok: true;  data: Restaurant[] }
  | { tool: 'swiggy_search_restaurants'; ok: false; errorCode: SwiggyToolErrorCode; message: string }
  | { tool: 'swiggy_search_instamart';   ok: true;  data: InstamartResult[] }
  | { tool: 'swiggy_search_instamart';   ok: false; errorCode: SwiggyToolErrorCode; message: string }
  | { tool: 'swiggy_search_dineout';     ok: true;  data: DineoutVenue[] }
  | { tool: 'swiggy_search_dineout';     ok: false; errorCode: SwiggyToolErrorCode; message: string }
  | { tool: 'youtube_search_recipe';     ok: true;  data: YouTubeRecipeResult }
  | { tool: 'youtube_search_recipe';     ok: false; errorCode: YouTubeToolErrorCode; message: string }

/** Aggregate the Tool Agent returns to the orchestrator (AGENTS.md §4.5).
 *  null = tool failed; [] = not called, or called with no results. */
interface ToolAgentOutput {
  restaurants: Restaurant[] | null
  instamartItems: InstamartResult[] | null
  dineoutVenues: DineoutVenue[] | null
  youtube: YouTubeRecipeResult | null

  errors: {
    tool: ToolName
    errorCode: SwiggyToolErrorCode | YouTubeToolErrorCode
    message: string                 // one sentence
  }[]

  swiggyError?: 'SWIGGY_UNAVAILABLE'  // set only when ALL Swiggy tools failed

  _meta: {
    toolsAttempted: ToolName[]
    toolsSucceeded: ToolName[]
    totalLatencyMs: Ms
  }
}
```

---

## 12. Agents and Conversation

### 12.1 Agent contracts (AGENTS.md §1)

```ts
type AgentName = 'ConversationAgent' | 'PlanningAgent' | 'ToolAgent' | 'MemoryAgent'
type AgentModel = 'claude-sonnet-4-6' | 'claude-haiku-4-5'
type RetryTrigger = 'timeout' | 'schema_invalid' | 'api_error'
type AgentRunStatus = 'completed' | 'failed' | 'timeout' | 'schema_failed' | 'degraded'

interface AgentConfig {
  name: AgentName
  model: AgentModel
  maxOutputTokens: number           // hard cap; API parameter, not a suggestion
  timeoutMs: Ms
  retryPolicy: {
    maxRetries: number
    backoffMs: Ms                   // actual wait = backoffMs * 2^attempt
    retryOn: RetryTrigger[]
  }
  fallback: unknown                 // must conform to the agent's output type
}

interface AgentRunResult<TOutput> {
  output: TOutput
  status: AgentRunStatus
  latencyMs: Ms
  inputTokens: number
  outputTokens: number
  attempts: number                  // 1 = succeeded first try
  error?: string                    // populated when status !== 'completed'
}

/** One row in situation_agent_runs — the canonical observability record. */
interface AgentRun {
  id: AgentRunId
  situationId: SituationId
  agentName: AgentName
  modelUsed: string                 // exact Anthropic model string
  status: AgentRunStatus
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: Ms | null
  inputSnapshot: unknown            // full agent input (JSONB)
  outputSnapshot: unknown | null    // parsed output; null on failure
  errorMessage: string | null
  startedAt: ISODateTime
  completedAt: ISODateTime | null
}
```

### 12.2 Agent I/O

Inputs/outputs for the four V1 agents. `ExtractedContext` (§5.1) **is** the Conversation Agent output type. Planning and Memory I/O:

```ts
interface ConversationAgentInput {
  rawInput: string                  // ≤ 500 chars — truncated by API layer beforehand
  timestamp: ISODateTime            // user-local, with offset: "2026-07-05T19:45:00+05:30"
  userTimezone: IANATimezone
  userMemorySummary: string | null  // natural-language memory digest; null = first run
  previousSituationType?: SituationType  // resolves "same thing", "that again"
  sessionSituationCount: number     // > 5 with short inputs suggests frustration
}

type ConversationAgentOutput = ExtractedContext

interface PlanningAgentInput {
  situationContext: SituationContext      // post-clarification, memory-merged
  userMemory: {
    diet: DietType | null
    budget: Rupees | null
    allergies: string[]
    cookingSkill: CookingSkill | null
    kitchenEquipment: string[]
    householdSize: number
    fitnessGoals: {
      dailyProteinG?: Grams
      dailyCalorieTarget?: Kcal
      gymDays?: string[]
    }
    preferredCuisines: string[]
    frequentRestaurants: string[]
    pantryStaples: string[]
  }
  preCalculatedScores: { cook: number; order: number; dineout: number }  // FINAL — never overridden
  pathAvailability: { cook: boolean; order: boolean; dineout: boolean }
  swiggyResults: {
    restaurants: Restaurant[] | null       // truncated to top 10 by rating upstream
    instamartItems: InstamartResult[] | null
    dineoutVenues: DineoutVenue[] | null
  } | null
  youtubeResult: YouTubeRecipeResult | null
  pantryItems: PantryItem[]                // truncated to 50 upstream
  isDegradedMode: boolean                  // Swiggy MCP fully unavailable
}

interface PlanningAgentOutput {
  explanation: string               // 1–3 sentences; cites numbers, never the score itself
  primaryPath: PrimaryPath          // must match highest AVAILABLE pre-calculated score
  confidence: ConfidenceLevel
  recommendation: {
    title: string
    description: string
    estimatedCost: Rupees
    estimatedTime: Minutes
    proteinG?: Grams                // only if present in input — never estimated
    calories?: Kcal

    // COOK path
    ingredients?: Ingredient[]
    recipeSteps?: RecipeStep[]
    youtubeVideoId?: YouTubeVideoId

    // ORDER path
    restaurantName?: string
    restaurantId?: SwiggyRestaurantId
    menuItems?: { name: string; price: Rupees }[]
    estimatedDeliveryMin?: Minutes

    // DINEOUT path
    venueName?: string
    venueId?: DineoutVenueId
    availableSlots?: string[]       // "7:30 PM" IST 12-hour
    pricePerPerson?: Rupees
  }
  whyNotAlternatives: {             // exactly 2 — one per rejected path
    path: PrimaryPath
    reason: string                  // one sentence, decisive factor, never blames the user
  }[]
}

interface MemoryAgentInput {
  completedSituation: {
    rawInput: string
    situationType: SituationType
    explicit: ExplicitContext
    inferred: InferredContext
    recommendation: {
      primaryPath: PrimaryPath
      title: string
      estimatedCost: Rupees
    }
  }
  clarificationAnswers: ClarificationExchange[]
  executedPath: PrimaryPath | 'dismissed' | null   // null = abandoned
  userRating?: 1 | 2 | 3 | 4 | 5 | null
  existingFacts: {
    factKey: FactKey
    factValue: unknown
    confidence: FactConfidence
  }[]
}

interface ExtractedMemoryFact {
  factKey: FactKey                  // canonical list only — no invented keys
  factValue: string | number | boolean | string[]
  confidence: 0.4 | 0.6 | 0.8 | 1.0
  source: Extract<MemorySource,
    'user_stated' | 'clarification_answer' | 'behavior_inferred' | 'action_derived'>
  expiresAfterDays: number | null   // null = permanent
}

type MemoryAgentOutput = ExtractedMemoryFact[]   // [] = nothing worth storing (normal)
```

### 12.3 Conversation turns

MealOS is not a chat product, but each situation is a bounded conversation: input → context card → clarifications → plan. These types model that transcript for history, debugging, and the Memory Agent.

```ts
type ConversationTurn =
  | { kind: 'user_input';           at: ISODateTime; text: string }              // rawInput
  | { kind: 'context_card';         at: ISODateTime; context: ExtractedContext } // what the AI understood
  | { kind: 'clarification_asked';  at: ISODateTime; pass: ClarificationPass }
  | { kind: 'clarification_answered'; at: ISODateTime
      answers: Record<string, ClarificationAnswerValue> }
  | { kind: 'plan_presented';       at: ISODateTime; recommendationId: RecommendationId }
  | { kind: 'user_action';          at: ISODateTime; action: UserActionType }

interface Conversation {
  situationId: SituationId
  turns: ConversationTurn[]         // strictly time-ordered
}
```

---

## 13. SSE Events and User Actions

### 13.1 SSE event union

Every event on `GET /api/v1/situations/:id/stream`, as a discriminated union on `event`. The `id:` SSE field is a monotonically increasing sequence number used for `Last-Event-ID` replay. Unknown event types must be ignored by clients (forward compatibility).

```ts
type SSEEvent =
  | { event: 'context_understood';   data: ContextUnderstoodEvent }
  | { event: 'clarification_needed'; data: ClarificationNeededEvent }
  | { event: 'planning_started';     data: PlanningStartedEvent }
  | { event: 'agent_progress';       data: AgentProgressEvent }
  | { event: 'plan_ready';           data: PlanReadyEvent }
  | { event: 'error';                data: StreamErrorEvent }
  | { event: 'heartbeat';            data: HeartbeatEvent }

interface ContextUnderstoodEvent {
  situationType: SituationType
  understoodAs: string              // human-readable headline
  confidence: ConfidencePercent     // 0–100 (see §14 — corrected from API.md's 0–1 example)
  knownFields: string[]
  assumptions: ContextAssumption[]
}

interface ClarificationNeededEvent {
  clarificationId: ClarificationId
  passNumber: 1 | 2
  questions: ClarificationQuestion[]     // 1–3
  assumptionsStated: string[]            // assumptions made to avoid asking more
  expiresAt: ISODateTime                 // 5 minutes from ask; client shows countdown
}

interface PlanningStartedEvent {
  agentsRunning: ('swiggy' | 'recipe' | 'budget' | 'nutrition')[]
  estimatedSeconds: number               // progress animation hint, not a deadline
}

interface AgentProgressEvent {
  agent: 'swiggy' | 'recipe' | 'budget' | 'nutrition' | 'planning'
  status: 'completed' | 'failed' | 'skipped'
  message: string                        // human-readable, rendered progressively
  partialData?: unknown                  // unstable preview shape — never depend on it
}

interface PlanReadyEvent {
  recommendationId: RecommendationId
  headline: string
  planType: PlanType
  preview: {
    primaryService: Service
    primaryTitle: string
    primaryCost: Rupees
    primaryTime: Minutes
    alternativesCount: number
  }
}

interface StreamErrorEvent {
  code: string                           // e.g. 'LLM_TIMEOUT', 'SWIGGY_UNAVAILABLE'
  message: string
  fallbackAvailable: boolean
  fallbackType?: 'recipe_only' | 'generic_suggestion'
  situationId: SituationId
}

interface HeartbeatEvent {
  ts: ISODateTime                        // every 15s idle; clients filter it out
}
```

### 13.2 User actions

```ts
type UserActionType =
  | 'executed_cook'
  | 'executed_order'
  | 'executed_dineout'
  | 'dismissed'
  | 'modified'

interface UserAction {
  id: ActionId
  userId: UserId
  situationId: SituationId
  recommendationId: RecommendationId
  actionType: UserActionType
  rating: 1 | 2 | 3 | 4 | 5 | null     // null until post-meal feedback
  externalOrderId: SwiggyOrderId | null // null for executed_cook and dismissed
  createdAt: ISODateTime
  updatedAt: ISODateTime               // bumped when rating lands
}
```

---

## 14. Deliberate Divergences from Source Documents

Resolution rule applied throughout: **`docs/AGENTS.md` wins over `ARCHITECTURE.md`; `docs/DECISION_ENGINE.md` wins for engine internals; `docs/DATABASE.md` wins for persisted column names.** Each divergence below is intentional and should be back-ported to the older document when it is next revised.

| # | Topic | Sources in conflict | Resolution here |
|---|---|---|---|
| 1 | `SituationContext` shape | ARCHITECTURE.md (layered + `fromMemory`), AGENTS.md §2.4 (layers + confidence/missing fields), DECISION_ENGINE.md (flat) | Split into three named stages: `ExtractedContext` (agent output), `SituationContext` (persisted, +`fromMemory`), `ScoringContext` (engine input). They are different types; conflating them was the source of the conflict. |
| 2 | Pipeline confidence 0–1 vs 0–100 | API.md `context_understood` example uses `0.91`; AGENTS.md and DATABASE.md use integer 0–100 | **Integer 0–100 everywhere in the pipeline** (`ConfidencePercent`). The API.md SSE example should be regenerated with `91`. Memory fact confidence stays 0.0–1.0 (`FactConfidence`) — different domain, matches the DB `FLOAT`. |
| 3 | Score breakdown keys | DATABASE.md `scoringFactors: budgetFit/timeFit/contextFit/nutritionFit`; API.md `score_breakdown: budget_fit/time_fit/nutrition_fit/preference_fit`; DECISION_ENGINE.md weights `goalMatch/budgetFit/timeFit/preferenceMatch` | Engine dimension names win: `goalMatch / budgetFit / timeFit / preferenceMatch` in `PathComparison.scoringFactors`. `contextFit` and `nutritionFit` are both really `goalMatch` in disguise. |
| 4 | Path name casing | DECISION_ENGINE.md `'COOK'|'ORDER'|'DINE_OUT'`; AGENTS.md/DB `'cook'|'order'|'dineout'` | Both kept, as `EnginePath` and `PrimaryPath`, with a single mechanical mapping in the orchestrator. Neither document changes. |
| 5 | `RecipeStep` shape | DATABASE.md `{step, instruction, durationMin, tip?}`; AGENTS.md adds `youtubeTimestamp?`; API.md uses `{step_number, title, detail, time_minutes}` | One canonical `RecipeStep` = DATABASE ∪ AGENTS (`step, instruction, durationMin, tip?, youtubeTimestamp?`). API.md's `title/detail` split is dropped — a `title` per step was never produced by any agent. Wire schema uses the canonical shape. |
| 6 | Instamart item shapes | DATABASE.md `InstamartItem` (cart line), API.md ingredient rows, AGENTS.md `InstamartResult` (search result) | Three distinct roles, three distinct types: `InstamartItem` (persisted cart line), `IngredientLine` (wire ingredient row), `InstamartResult` (tool search result). No merging — they genuinely differ. |
| 7 | `MemorySource` enum | API.md: 3 values; AGENTS.md: 4 values; DATABASE.md examples: `onboarding` | Union of all six: `onboarding, user_stated, user_edited, clarification_answer, behavior_inferred, action_derived`. The DB enum must be created with all six from migration 0001. |
| 8 | `UserProfile` storage | ARCHITECTURE.md Phase 8 defines a `user_profiles` table; DATABASE.md V1 has only 5 tables | `UserProfile` is a **derived projection over `user_memory_facts`** in V1, not a table. The type is the API contract; a physical table is a V2 option. |
| 9 | `recommendation_items` table | ARCHITECTURE.md Phase 8 has the table; DATABASE.md V1 embeds items in `recommendations` JSONB | `RecommendationItem`/`PlanItem` are typed now; V1 serializes them inside the recommendation row. The V2 migration extracts the table without a type change. |
| 10 | Planning input flag typo | AGENTS.md §3.3 `isDeadedMode` | Corrected to `isDegradedMode`. |
| 11 | Situation status enums | DATABASE.md state machine omits `error`; API.md `SituationStatus` includes `'error'` and `'intent_extracted'` | API.md's 10-value union is canonical (`SituationStatus` in §5) — the DB enum must include all 10. |
| 12 | Money unit | (none conflicted, stated for the record) | Integer whole INR everywhere (`Rupees`), matching DATABASE.md `INT` columns. Paise never appear. |
