# MealOS AI — Decision Engine Specification

**File:** `lib/engine/scorer.ts`  
**Version:** 1.0  
**Status:** Specification — not yet implemented  
**Author:** MealOS AI Engineering  
**Date:** 2026-07-06

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [TypeScript Interfaces](#2-typescript-interfaces)
3. [Weight Tables](#3-weight-tables)
4. [Sub-Score Algorithms](#4-sub-score-algorithms)
5. [Path Availability Rules](#5-path-availability-rules)
6. [Confidence Calculation](#6-confidence-calculation)
7. [Tie-Breaking Rules](#7-tie-breaking-rules)
8. [The Plan Simulator Calculation](#8-the-plan-simulator-calculation)
9. [Edge Cases](#9-edge-cases)
10. [Unit Test Cases](#10-unit-test-cases)
11. [Performance Targets and Constraints](#11-performance-targets-and-constraints)
12. [Testing Strategy](#12-testing-strategy)

---

## 1. Design Philosophy

### Why Deterministic Code, Not an LLM

The scoring engine at the heart of MealOS AI evaluates three food paths — COOK, ORDER, and DINE_OUT — and assigns each a numeric score from 0 to 100. This scoring is performed by **pure, deterministic TypeScript functions**. Claude is never invoked during scoring.

This is the most consequential architectural decision in the system. The reasoning is:

**Reproducibility.** Given identical inputs, the scorer must always produce identical outputs. An LLM cannot satisfy this invariant. Floating-point sampling, temperature, and prompt variation introduce non-determinism that makes debugging impossible and user trust fragile. If a user asks "why did you recommend cooking?" the system must be able to replay the exact calculation that produced that recommendation.

**Unit testability.** Deterministic functions have no dependencies to mock. A test suite can assert that `score(input) === expectedScore` with zero ambiguity. This enables regression detection: if a weight is changed or a formula is updated, the test suite will catch any unintended consequence across all 20+ unit test cases. An LLM-based scorer cannot be unit tested — only sampled.

**Explainability.** The scoring formula produces sub-scores (`goalMatchScore`, `budgetFitScore`, `timeFitScore`, `prefMatchScore`) for each path. These sub-scores are available as structured data that the explanation layer can surface directly. There is no black box.

**Debugging.** When a recommendation looks wrong, the engineer can inspect the exact sub-scores and intermediate values that produced it. There is no need to guess what the model "thought."

**Speed.** The scorer must complete in under 5 milliseconds for any input. An LLM call at minimum adds ~300ms of network latency plus inference time. Deterministic TypeScript adds ~0ms.

**Cost.** Scoring runs on every situation, potentially multiple times during clarification. At 1,000 daily active users with 3 situations each, that is 3,000 scoring invocations per day. LLM-based scoring would cost ~$30–60/day for a feature that a `switch` statement can handle for free.

### What Claude Does (and Only Does)

Claude is called **exactly once** per situation, **after** scoring is complete, to write the explanation sentence shown in the Reasoning Card:

```
"Cooking is your best option today — it fits your budget, uses what you have, and you have 45 minutes to spare."
```

Claude receives the final `DecisionResult` (all scores, the winner, the confidence) as structured input and writes one to two sentences in natural language. It does not invent the scores. It does not pick the winner. It translates the numbers into human language.

### The Core Invariant

> Same inputs → same winner → same scores → same sub-scores, always.

If this invariant is violated, the spec has been violated.

---

## 2. TypeScript Interfaces

All interfaces should be placed in `lib/engine/types.ts` and imported by the scorer.

### SituationType

```typescript
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
  | 'general'
```

### NutritionGoal

```typescript
interface NutritionGoal {
  proteinG?: number       // grams per meal or per day — clarified from context
  caloriesKcal?: number
  lowCarb?: boolean
  scope: 'meal' | 'day'  // whether the target is per-meal or for the full day
}
```

### SituationContext

The full structured context object assembled from user input, memory, inference, and clarification answers. This is the primary input to the scorer.

```typescript
interface SituationContext {
  // Classification
  situationType: SituationType

  // Time
  timeConstraintMinutes: number | null   // null = no stated constraint
  currentHour: number                    // 0–23, used for late_night inference
  isWeekend: boolean

  // Budget
  budgetRupees: number | null            // null = unknown/not stated
  budgetFlexibility: 'strict' | 'soft' | 'flexible'
  // strict  = will not spend even ₹1 over
  // soft    = 10–15% over is tolerable
  // flexible = budget is a guideline, not a hard cap

  // Cooking
  canCook: boolean                       // false means physically unable or unwilling today
  cookingSkillLevel: 'none' | 'beginner' | 'intermediate' | 'advanced'
  pantryState: 'empty' | 'partial' | 'stocked'
  // empty   = no usable ingredients
  // partial = has staples (rice, dal, oil, salt) but not full meal components
  // stocked = has ingredients for at least one complete meal

  // Social context
  guests: number                         // 1 = alone, 2 = couple, 3+ = group
  occasion: 'casual' | 'date' | 'celebration' | 'work' | 'none'

  // Dietary
  dietaryRestrictions: DietaryRestriction[]
  allergens: Allergen[]                  // hard blocks — any presence = score 0 for prefMatch
  likedCuisines: string[]
  dislikedCuisines: string[]

  // Nutrition
  nutritionGoal: NutritionGoal | null

  // Service availability
  swiggAvailable: boolean
  instamartAvailable: boolean
  dineoutAvailable: boolean

  // Memory quality (affects confidence, not scores)
  memoryPopulated: boolean               // true if user has profile data stored
  pantryDataAvailable: boolean           // true if pantry list is current (< 7 days old)
  missingRequiredFields: string[]        // field names that were assumed rather than known
}

type DietaryRestriction =
  | 'vegetarian'
  | 'vegan'
  | 'jain'
  | 'gluten_free'
  | 'dairy_free'
  | 'halal'
  | 'kosher'

type Allergen =
  | 'shellfish'
  | 'nuts'
  | 'eggs'
  | 'dairy'
  | 'gluten'
  | 'soy'
  | 'fish'
```

### PathInput

Each path receives its own input object with fields specific to that service. The scorer receives all three simultaneously.

```typescript
// Shared fields across all paths
interface BasePathInput {
  estimatedCostRupees: number
  estimatedTimeMinutes: number         // total time (cook: prep+cook; order: delivery ETA; dine: travel+wait+meal)
  proteinG: number | null              // null = not calculable
  caloriesKcal: number | null
  available: boolean                   // false = path is eliminated before scoring
}

interface CookPathInput extends BasePathInput {
  path: 'COOK'
  recipeId: string | null              // null = generic home cooking estimate
  recipeName: string | null
  canMakeFromPantry: boolean           // true = all ingredients present
  missingIngredientCount: number       // 0 if canMakeFromPantry = true
  instamartCostForMissingRupees: number // cost to buy missing ingredients; 0 if canMakeFromPantry
  cuisineType: string | null
  isVegetarian: boolean
  isVegan: boolean
  containsAllergens: Allergen[]
  difficultyLevel: 'easy' | 'medium' | 'hard'
}

interface OrderPathInput extends BasePathInput {
  path: 'ORDER'
  restaurantId: string
  restaurantName: string
  cuisineType: string
  isVegetarianMenuAvailable: boolean
  isFullyVegetarian: boolean           // true = restaurant serves no meat
  isVeganMenuAvailable: boolean
  containsAllergens: Allergen[]        // allergens present in recommended dish
  deliveryFeeRupees: number
  discountRupees: number               // active discount/coupon value
  minimumOrderRupees: number
  ratingOutOf5: number
  deliveryTimeMinutes: number          // same as estimatedTimeMinutes for ORDER
}

interface DineOutPathInput extends BasePathInput {
  path: 'DINE_OUT'
  restaurantId: string
  restaurantName: string
  cuisineType: string
  isVegetarianMenuAvailable: boolean
  isFullyVegetarian: boolean
  isVeganMenuAvailable: boolean
  containsAllergens: Allergen[]
  ambienceScore: number                // 0–100, sourced from Dineout data
  hasTableAvailableNow: boolean
  guestCapacity: number                // max guests the restaurant can seat same-day
  travelTimeMinutes: number            // from user's stored location to restaurant
  mealTimeMinutes: number              // estimated time for the meal itself
  // estimatedTimeMinutes = travelTimeMinutes + 15 (wait/order) + mealTimeMinutes
  pricePerPersonRupees: number
  // estimatedCostRupees = pricePerPersonRupees * context.guests
  ratingOutOf5: number
}

type PathInput = CookPathInput | OrderPathInput | DineOutPathInput
```

### PathScore

The intermediate scoring result for a single path. This object is computed separately for COOK, ORDER, and DINE_OUT.

```typescript
interface PathScore {
  path: 'COOK' | 'ORDER' | 'DINE_OUT'
  available: boolean                   // false = eliminated before scoring, all scores = 0

  // Sub-scores (0–100 each)
  goalMatchScore: number
  budgetFitScore: number
  timeFitScore: number
  prefMatchScore: number

  // Final weighted score (0–100)
  finalScore: number

  // Metadata for explanation and debugging
  goalMatchNotes: string[]             // e.g., ["protein target met", "can cook from pantry"]
  budgetNotes: string[]                // e.g., ["15% under budget"]
  timeNotes: string[]                  // e.g., ["5 min over constraint"]
  prefNotes: string[]                  // e.g., ["vegetarian restriction met", "+20 liked cuisine"]

  // Hard blocks that were triggered (for explanation)
  hardBlocks: string[]                 // e.g., ["allergen:shellfish present"]
}
```

### DecisionResult

The complete output of the scoring engine for one situation.

```typescript
interface DecisionResult {
  // All three path scores
  cookScore: PathScore
  orderScore: PathScore
  dineOutScore: PathScore

  // The winner
  winner: 'COOK' | 'ORDER' | 'DINE_OUT' | 'NO_WINNER'
  // NO_WINNER when all available paths score below 30, or when all paths are unavailable

  // Whether this is a split recommendation (two paths within 5 points of each other)
  isSplitRecommendation: boolean
  splitAlternative: 'COOK' | 'ORDER' | 'DINE_OUT' | null
  // Non-null when the top two paths are within 5 points of each other

  // Confidence in the recommendation (0–100)
  confidence: number

  // Plan Simulator deltas (primary vs. best alternative)
  simulator: PlanSimulatorDeltas

  // Weights used (for debugging and transparency)
  weightsUsed: ScoreWeights

  // ISO timestamp
  computedAt: string
}
```

### PlanSimulatorDeltas

```typescript
interface PlanSimulatorDeltas {
  primaryPath: 'COOK' | 'ORDER' | 'DINE_OUT'
  alternativePath: 'COOK' | 'ORDER' | 'DINE_OUT' | null

  deltaCostRupees: number | null        // positive = primary is cheaper
  deltaTimeMinutes: number | null       // positive = primary is faster
  deltaProteinG: number | null          // positive = primary has more protein

  // Whether each delta is "meaningful" enough to display in the UI
  showCostDelta: boolean
  showTimeDelta: boolean
  showProteinDelta: boolean
}
```

### ScoreWeights

```typescript
interface ScoreWeights {
  goalMatch: number        // must sum with the other three to exactly 1.0
  budgetFit: number
  timeFit: number
  preferenceMatch: number
}

// The full weight table, keyed by SituationType
type WeightTable = Record<SituationType, ScoreWeights>
```

---

## 3. Weight Tables

### Formula Reminder

```
finalScore = (goalMatchScore × w.goalMatch)
           + (budgetFitScore × w.budgetFit)
           + (timeFitScore × w.timeFit)
           + (prefMatchScore × w.preferenceMatch)
```

All weights sum to 1.0. The TypeScript implementation must validate this with an assertion at module load time.

---

### `nutrition_goal`

```
goalMatch=0.50, budgetFit=0.15, timeFit=0.20, preferenceMatch=0.15
Sum: 0.50 + 0.15 + 0.20 + 0.15 = 1.00 ✓
```

**Rationale:** When the user has a specific protein or calorie target, whether a path actually hits that target is the dominant question — it outweighs everything else. Budget and preference matter, but a path that misses the nutritional goal by 50g of protein should not win even if it is cheap and fast. Time is included at 0.20 because meal prep for nutrition goals often happens on a schedule (post-gym, specific meal time).

---

### `broke`

```
goalMatch=0.25, budgetFit=0.50, timeFit=0.15, preferenceMatch=0.10
Sum: 0.25 + 0.50 + 0.15 + 0.10 = 1.00 ✓
```

**Rationale:** Budget is the explicit constraint in this situation — it dominates at 0.50. A path that exceeds the user's stated (or implied) budget should not win, full stop. Goal match is secondary at 0.25 because the user's primary goal is to eat within their means. Preference at 0.10 is minimal — when broke, you eat what you can afford, not what you prefer.

---

### `quick_meal`

```
goalMatch=0.20, budgetFit=0.20, timeFit=0.45, preferenceMatch=0.15
Sum: 0.20 + 0.20 + 0.45 + 0.15 = 1.00 ✓
```

**Rationale:** Speed is the stated constraint. A path that takes 45 minutes when the user has 20 minutes should not win regardless of how good the food is. Goal match and budget are at equal 0.20, ensuring that a fast but nutritionally empty or financially ruinous option still loses on combined score.

---

### `date_planning`

```
goalMatch=0.15, budgetFit=0.20, timeFit=0.10, preferenceMatch=0.55
Sum: 0.15 + 0.20 + 0.10 + 0.55 = 1.00 ✓
```

**Rationale:** Ambience, cuisine fit, and the overall dining experience dominate date planning. The preference score for DINE_OUT incorporates ambience data and cuisine match, making it the primary discriminator. Budget matters (most date nights have a target spend) but is not the primary concern. Time constraint is minimal — date nights are rarely rushed. Goal match at 0.15 reflects that there is rarely a specific nutritional goal on a date.

---

### `sick`

```
goalMatch=0.45, budgetFit=0.20, timeFit=0.20, preferenceMatch=0.15
Sum: 0.45 + 0.20 + 0.20 + 0.15 = 1.00 ✓
```

**Rationale:** A sick user's primary goal is to receive food that helps them recover: light, easily digestible, warm, and appropriate. Whether a path can deliver comfort food that matches this goal is the dominant question. Budget and time both matter at 0.20 — a sick person does not want to wait long or overspend, but comfort is the first priority.

---

### `party_hosting`

```
goalMatch=0.25, budgetFit=0.45, timeFit=0.15, preferenceMatch=0.15
Sum: 0.25 + 0.45 + 0.15 + 0.15 = 1.00 ✓
```

**Rationale:** Hosting a party has a group size and a total budget. The per-person cost efficiency of each path is the most critical factor — a party that costs ₹500/person instead of ₹250/person is a budget failure, even if the food is excellent. Goal match at 0.25 captures whether a path can serve the full group. Time is secondary.

---

### `meal_prep`

```
goalMatch=0.45, budgetFit=0.30, timeFit=0.15, preferenceMatch=0.10
Sum: 0.45 + 0.30 + 0.15 + 0.10 = 1.00 ✓
```

**Rationale:** Meal prep is typically driven by nutritional goals (protein targets, calorie control) and cost efficiency across multiple days. Goal match leads at 0.45 because the user is solving a specific planning problem, not just satisfying immediate hunger. Budget at 0.30 is elevated because prep economics matter — cooking at home for the week should be meaningfully cheaper than ordering. DINE_OUT will score low here regardless of weights, as you cannot meal prep at a restaurant.

---

### `office_lunch`

```
goalMatch=0.20, budgetFit=0.25, timeFit=0.40, preferenceMatch=0.15
Sum: 0.20 + 0.25 + 0.40 + 0.15 = 1.00 ✓
```

**Rationale:** Office lunch is constrained by a fixed break window — typically 30–60 minutes. Time dominates at 0.40 because a path that takes 90 minutes fails categorically. Budget is elevated at 0.25 because office lunches are a recurring daily expense. DINE_OUT almost always scores poorly here due to total time required.

---

### `family_dinner`

```
goalMatch=0.20, budgetFit=0.25, timeFit=0.20, preferenceMatch=0.35
Sum: 0.20 + 0.25 + 0.20 + 0.35 = 1.00 ✓
```

**Rationale:** Family dinners prioritize everyone's dietary preferences and restrictions — when multiple people with different needs are present, cuisine and restriction compatibility dominates. Budget matters at 0.25 because family portions cost more. Time at 0.20 captures that family dinners should not be excessively rushed or excessively delayed, but it is not the primary driver.

---

### `late_night`

```
goalMatch=0.15, budgetFit=0.20, timeFit=0.50, preferenceMatch=0.15
Sum: 0.15 + 0.20 + 0.50 + 0.15 = 1.00 ✓
```

**Rationale:** After midnight, path availability and speed are the primary concerns. Most restaurants are closed (DINE_OUT scores near 0 due to availability rules). The user needs food that can actually be delivered or cooked quickly. Time dominates at 0.50. Nutritional goals at 0.15 reflect that late-night eating is rarely nutrition-focused.

---

### `general`

```
goalMatch=0.35, budgetFit=0.25, timeFit=0.25, preferenceMatch=0.15
Sum: 0.35 + 0.25 + 0.25 + 0.15 = 1.00 ✓
```

**Rationale:** When no specific situation type is identified, a balanced weight distribution is used. Goal match is slightly elevated at 0.35 because even a general request has an implicit goal (satisfy hunger, get a meal). Budget and time are equal at 0.25 each, reflecting that both matter roughly equally in the absence of specific constraints.

---

### Weight Table (TypeScript Implementation)

```typescript
export const WEIGHT_TABLE: WeightTable = {
  nutrition_goal: { goalMatch: 0.50, budgetFit: 0.15, timeFit: 0.20, preferenceMatch: 0.15 },
  broke:          { goalMatch: 0.25, budgetFit: 0.50, timeFit: 0.15, preferenceMatch: 0.10 },
  quick_meal:     { goalMatch: 0.20, budgetFit: 0.20, timeFit: 0.45, preferenceMatch: 0.15 },
  date_planning:  { goalMatch: 0.15, budgetFit: 0.20, timeFit: 0.10, preferenceMatch: 0.55 },
  sick:           { goalMatch: 0.45, budgetFit: 0.20, timeFit: 0.20, preferenceMatch: 0.15 },
  party_hosting:  { goalMatch: 0.25, budgetFit: 0.45, timeFit: 0.15, preferenceMatch: 0.15 },
  meal_prep:      { goalMatch: 0.45, budgetFit: 0.30, timeFit: 0.15, preferenceMatch: 0.10 },
  office_lunch:   { goalMatch: 0.20, budgetFit: 0.25, timeFit: 0.40, preferenceMatch: 0.15 },
  family_dinner:  { goalMatch: 0.20, budgetFit: 0.25, timeFit: 0.20, preferenceMatch: 0.35 },
  late_night:     { goalMatch: 0.15, budgetFit: 0.20, timeFit: 0.50, preferenceMatch: 0.15 },
  general:        { goalMatch: 0.35, budgetFit: 0.25, timeFit: 0.25, preferenceMatch: 0.15 },
}
```

### Invariant Check (must run at module load time)

```typescript
function assertWeightIntegrity(table: WeightTable): void {
  for (const [type, w] of Object.entries(table)) {
    const sum = w.goalMatch + w.budgetFit + w.timeFit + w.preferenceMatch
    const rounded = Math.round(sum * 100) / 100
    if (rounded !== 1.0) {
      throw new Error(
        `Weight integrity violation for '${type}': sum=${sum} (expected 1.0)`
      )
    }
  }
}

// Called once at module initialization:
assertWeightIntegrity(WEIGHT_TABLE)
```

---

## 4. Sub-Score Algorithms

All sub-scores are in the range [0, 100] inclusive. Fractional values are allowed (do not round to integer during calculation; round only when emitting `PathScore`). All functions are pure — no side effects, no I/O, no async.

---

### 4.1 goalMatchScore (0–100)

**Purpose:** How well does this path achieve the user's stated goal given the situation type?

The goal match algorithm is situation-aware. Different situation types have different goal definitions.

#### Algorithm by SituationType

```
FUNCTION computeGoalMatchScore(
  situationType: SituationType,
  path: PathInput,
  context: SituationContext
) -> number

  // Hard blocks — these return 0 immediately, before any other logic
  IF path is COOK AND context.canCook === false:
    RETURN 0  // note: COOK should already be eliminated by availability rules

  IF situationType === 'broke' OR context.budgetRupees is not null:
    IF path.estimatedCostRupees > context.budgetRupees * 1.5:
      RETURN 0  // 50% over budget is goal failure for budget-conscious situations

  SWITCH situationType:

    CASE 'nutrition_goal':
      // Goal = hit the protein/calorie target
      IF context.nutritionGoal is null: RETURN 50  // no target, score neutral
      score = 0
      IF context.nutritionGoal.proteinG is set:
        target = context.nutritionGoal.proteinG
        IF path.proteinG is null: RETURN 10  // cannot verify protein, low confidence
        ratio = path.proteinG / target          // values: 0.0 → 2.0+
        score = goalMatchFromNutritionRatio(ratio)
      IF context.nutritionGoal.caloriesKcal is set:
        calTarget = context.nutritionGoal.caloriesKcal
        IF path.caloriesKcal is not null:
          calRatio = path.caloriesKcal / calTarget
          calScore = goalMatchFromNutritionRatio(calRatio)
          score = (score + calScore) / 2   // average if both goals set
      RETURN clamp(score, 0, 100)

    CASE 'broke':
      // Goal = eat within the tightest possible budget
      IF path.estimatedCostRupees === 0: RETURN 100
      IF context.budgetRupees is null: RETURN 50
      ratio = path.estimatedCostRupees / context.budgetRupees
      RETURN clamp(linearMap(ratio, [0, 0.5, 0.8, 1.0, 1.2], [100, 95, 80, 60, 0]), 0, 100)
      // At 0 cost: 100
      // At 50% of budget: 95
      // At 80% of budget: 80
      // At 100% of budget: 60
      // At 120% of budget: 0

    CASE 'sick':
      // Goal = receive comfort food appropriate for illness
      // COOK: good if easy recipe (difficulty=easy) or from pantry
      // ORDER: good if restaurant specializes in light food
      // DINE_OUT: always low (sick users should not go out)
      IF path is DINE_OUT: RETURN 10
      IF path is COOK:
        IF path.difficultyLevel === 'easy' AND path.canMakeFromPantry: RETURN 90
        IF path.difficultyLevel === 'easy': RETURN 70
        IF path.difficultyLevel === 'medium' AND path.canMakeFromPantry: RETURN 55
        RETURN 30
      IF path is ORDER: RETURN 80  // delivery is the natural sick-day solution
      RETURN 50

    CASE 'date_planning':
      // Goal = create a positive dining experience for a romantic occasion
      // DINE_OUT is the natural winner
      // COOK can work but is more stressful
      // ORDER is low (not romantic)
      IF path is DINE_OUT:
        IF path.hasTableAvailableNow: RETURN 90
        RETURN 40  // no availability = goal not achievable
      IF path is COOK: RETURN 55   // cooking together can be romantic, but uncertain
      IF path is ORDER: RETURN 20  // delivery is rarely a good date

    CASE 'party_hosting':
      // Goal = feed N guests within budget
      IF context.guests > path available capacity:
        RETURN 0  // cannot serve the group
      IF path is COOK:
        // Cooking for 8+ is high effort; scale score by inverse of guests
        IF context.guests <= 4: RETURN 80
        IF context.guests <= 8: RETURN 60
        IF context.guests <= 12: RETURN 40
        RETURN 20
      IF path is ORDER: RETURN 85  // multi-restaurant ordering works well for parties
      IF path is DINE_OUT:
        IF context.guests > 12: RETURN 30  // too many guests for most restaurants
        RETURN 70

    CASE 'meal_prep':
      // Goal = prepare meals that cover multiple days
      // COOK dominates; ORDER and DINE_OUT cannot serve this goal
      IF path is COOK: RETURN 90
      IF path is ORDER: RETURN 20  // ordering covers one meal, not a prep plan
      IF path is DINE_OUT: RETURN 5  // dining out cannot serve meal prep

    CASE 'quick_meal':
      // Goal = be eating within a short window
      // Primarily handled by timeFitScore; goalMatch is about whether the path
      // can produce a complete, satisfying meal
      IF path is COOK:
        IF path.difficultyLevel === 'easy': RETURN 80
        IF path.difficultyLevel === 'medium': RETURN 55
        RETURN 30
      IF path is ORDER: RETURN 85   // delivery is purpose-built for this
      IF path is DINE_OUT: RETURN 40  // getting to and from adds time

    CASE 'office_lunch':
      // Goal = get a complete meal within a lunch break (typically 30–60 min)
      // DINE_OUT near office is viable; ORDER to office is common; COOK is unlikely
      IF path is COOK: RETURN 20    // cooking at the office is not realistic
      IF path is ORDER: RETURN 80
      IF path is DINE_OUT: RETURN 70  // nearby restaurant is fine

    CASE 'family_dinner':
      // Goal = produce a meal that satisfies all household members
      IF path is COOK: RETURN 85    // home-cooked family dinner is the archetype
      IF path is ORDER: RETURN 65   // family-size delivery is feasible but impersonal
      IF path is DINE_OUT: RETURN 70  // family restaurant is a valid option

    CASE 'late_night':
      // Goal = obtain food when most services are closed
      // ORDER is the primary option; COOK is viable; DINE_OUT is almost never available
      IF path is ORDER:
        IF context.swiggAvailable: RETURN 90
        RETURN 0
      IF path is COOK: RETURN 75
      IF path is DINE_OUT: RETURN 15  // most restaurants are closed late

    CASE 'general':
      // No specific goal — score based on completeness of the solution
      IF path is COOK: RETURN 70
      IF path is ORDER: RETURN 75
      IF path is DINE_OUT: RETURN 65

  RETURN 50   // fallback for any unhandled case
```

#### Nutrition Ratio Helper

```
FUNCTION goalMatchFromNutritionRatio(ratio: number) -> number
  // ratio = path.nutrient / goal.target
  // Piecewise linear:
  // ratio 0.0 → score 0
  // ratio 0.5 → score 30   (50% of goal is poor)
  // ratio 0.8 → score 65   (80% of goal is acceptable)
  // ratio 0.9 → score 80   (near-target)
  // ratio 1.0 → score 95   (hitting the target exactly)
  // ratio 1.1 → score 100  (slightly over is fine — bonus)
  // ratio 1.3 → score 90   (30% over is slightly wasteful)
  // ratio 1.5 → score 70   (50% over is excess)
  // ratio 2.0+ → score 40  (double the target is a poor fit)

  IF ratio >= 1.1 AND ratio <= 1.3: RETURN 100
  IF ratio >= 0.0 AND ratio < 0.5: RETURN linearMap(ratio, [0.0, 0.5], [0, 30])
  IF ratio >= 0.5 AND ratio < 0.8: RETURN linearMap(ratio, [0.5, 0.8], [30, 65])
  IF ratio >= 0.8 AND ratio < 1.0: RETURN linearMap(ratio, [0.8, 1.0], [65, 95])
  IF ratio >= 1.0 AND ratio < 1.1: RETURN linearMap(ratio, [1.0, 1.1], [95, 100])
  IF ratio >= 1.3 AND ratio < 1.5: RETURN linearMap(ratio, [1.3, 1.5], [100, 70])
  IF ratio >= 1.5 AND ratio < 2.0: RETURN linearMap(ratio, [1.5, 2.0], [70, 40])
  IF ratio >= 2.0: RETURN 40
  RETURN 0
```

#### linearMap Helper

```
FUNCTION linearMap(
  value: number,
  inputRange: [number, number],
  outputRange: [number, number]
) -> number
  [x0, x1] = inputRange
  [y0, y1] = outputRange
  t = (value - x0) / (x1 - x0)
  t = clamp(t, 0, 1)
  RETURN y0 + t * (y1 - y0)
```

#### clamp Helper

```
FUNCTION clamp(value: number, min: number, max: number) -> number
  RETURN Math.max(min, Math.min(max, value))
```

#### Worked Examples

| Scenario | Path | Calculation | Score |
|---|---|---|---|
| `nutrition_goal`, protein target=150g, COOK delivers 152g | COOK | ratio=1.013, in range [1.0,1.1] → linearMap→96 | 96 |
| `nutrition_goal`, protein target=150g, ORDER delivers 98g | ORDER | ratio=0.653, linearMap([0.5,0.8],[30,65])→46 | 46 |
| `sick`, canCook=false | COOK | hard block: canCook=false → 0 | 0 |
| `broke`, budget=₹50, ORDER costs ₹89 | ORDER | ratio=89/50=1.78, >1.5 → 0 | 0 |
| `date_planning`, DINE_OUT has table | DINE_OUT | hasTableAvailableNow=true → 90 | 90 |
| `meal_prep`, COOK | COOK | meal_prep + COOK → 90 | 90 |

---

### 4.2 budgetFitScore (0–100)

**Purpose:** How well does the estimated cost fit the user's budget?

```
FUNCTION computeBudgetFitScore(
  path: PathInput,
  context: SituationContext
) -> number

  cost = path.estimatedCostRupees
  budget = context.budgetRupees

  // If budget is unknown, score based on absolute cost thresholds
  IF budget is null:
    RETURN budgetScoreFromAbsoluteCost(cost, context.situationType)

  ratio = cost / budget   // < 1.0 = under budget; > 1.0 = over budget

  // Hard block: 0 budget means only free options are acceptable
  IF budget === 0:
    IF cost === 0: RETURN 100
    RETURN 0

  // Piecewise scoring:
  // ratio ≤ 0.0 (free): 100
  // ratio 0.5 (50% under): 100
  // ratio 0.8 (20% under): 100
  // ratio 1.0 (at budget): 85
  // ratio 1.2 (20% over): 50
  // ratio 1.5 (50% over): 10
  // ratio > 1.5: 0

  IF ratio <= 0.8: RETURN 100
  IF ratio <= 1.0: RETURN linearMap(ratio, [0.8, 1.0], [100, 85])
  IF ratio <= 1.2: RETURN linearMap(ratio, [1.0, 1.2], [85, 50])
  IF ratio <= 1.5: RETURN linearMap(ratio, [1.2, 1.5], [50, 10])
  RETURN 0   // > 1.5x budget = budget failure

  // Apply flexibility modifier
  IF context.budgetFlexibility === 'strict':
    IF ratio > 1.0: RETURN 0   // strict budget: any overage is failure
  IF context.budgetFlexibility === 'flexible':
    IF ratio <= 1.3: score = min(score + 15, 100)   // flexible: bonus for being close
```

#### budgetScoreFromAbsoluteCost (when budget unknown)

```
FUNCTION budgetScoreFromAbsoluteCost(cost: number, situationType: SituationType) -> number
  // Use median Indian urban food spend per meal as reference
  // Thresholds: ₹0 = great, ₹150 = average, ₹300 = decent, ₹600 = expensive, ₹1000+ = luxury

  IF cost === 0: RETURN 100
  IF cost <= 100: RETURN 90
  IF cost <= 200: RETURN 80
  IF cost <= 350: RETURN 70
  IF cost <= 600: RETURN 55
  IF cost <= 1000: RETURN 40
  RETURN 25

  // For 'date_planning', adjust: higher cost is expected
  IF situationType === 'date_planning':
    IF cost <= 3000: RETURN max(score, 70)
```

#### Worked Examples

| Scenario | Cost | Budget | Ratio | Score |
|---|---|---|---|---|
| At exactly budget | ₹300 | ₹300 | 1.00 | 85 |
| 20% under budget | ₹240 | ₹300 | 0.80 | 100 |
| 20% over budget | ₹360 | ₹300 | 1.20 | 50 |
| 50% over budget | ₹450 | ₹300 | 1.50 | 10 |
| 60% over budget | ₹480 | ₹300 | 1.60 | 0 |
| Strict budget, 5% over | ₹315 | ₹300 | 1.05 | 0 (strict) |
| Budget = ₹0, cost = ₹0 | ₹0 | ₹0 | — | 100 |
| Budget = ₹0, cost = ₹50 | ₹50 | ₹0 | — | 0 |

---

### 4.3 timeFitScore (0–100)

**Purpose:** How well does the time required fit the user's stated time constraint?

```
FUNCTION computeTimeFitScore(
  path: PathInput,
  context: SituationContext
) -> number

  actualMinutes = path.estimatedTimeMinutes
  constraint = context.timeConstraintMinutes

  // No constraint stated — score based on absolute time
  IF constraint is null:
    RETURN timeFitFromAbsoluteTime(actualMinutes, context.situationType)

  ratio = actualMinutes / constraint

  // Piecewise scoring:
  // ratio ≤ 0.5 (half the time or less): 100
  // ratio 0.9 (10% under): 100
  // ratio 1.0 (exactly at constraint): 90
  // ratio 1.1 (10% over): 75
  // ratio 1.25 (25% over): 50
  // ratio 1.5 (50% over): 20
  // ratio 2.0 (double the time): 0

  IF ratio <= 0.9: RETURN 100
  IF ratio <= 1.0: RETURN linearMap(ratio, [0.9, 1.0], [100, 90])
  IF ratio <= 1.1: RETURN linearMap(ratio, [1.0, 1.1], [90, 75])
  IF ratio <= 1.25: RETURN linearMap(ratio, [1.1, 1.25], [75, 50])
  IF ratio <= 1.5: RETURN linearMap(ratio, [1.25, 1.5], [50, 20])
  IF ratio <= 2.0: RETURN linearMap(ratio, [1.5, 2.0], [20, 0])
  RETURN 0
```

#### timeFitFromAbsoluteTime (when no constraint)

```
FUNCTION timeFitFromAbsoluteTime(minutes: number, situationType: SituationType) -> number
  // General scale: faster is better, but not at any cost
  // Reference: 15 min = excellent, 30 min = good, 60 min = acceptable, 90 min = poor

  IF minutes <= 15: RETURN 100
  IF minutes <= 30: RETURN linearMap(minutes, [15, 30], [100, 85])
  IF minutes <= 60: RETURN linearMap(minutes, [30, 60], [85, 65])
  IF minutes <= 90: RETURN linearMap(minutes, [60, 90], [65, 40])
  IF minutes <= 120: RETURN linearMap(minutes, [90, 120], [40, 20])
  RETURN 10

  // For 'date_planning' and 'family_dinner', a leisurely 90-minute meal is normal:
  IF situationType in ['date_planning', 'family_dinner']:
    IF minutes <= 90: RETURN max(score, 70)
    IF minutes <= 150: RETURN max(score, 55)
```

#### Worked Examples

| Scenario | Time | Constraint | Ratio | Score |
|---|---|---|---|---|
| 18 min vs. 20 min constraint | 18 | 20 | 0.90 | 100 |
| 25 min vs. 20 min constraint | 25 | 20 | 1.25 | 50 |
| 45 min vs. 20 min constraint | 45 | 20 | 2.25 | 0 |
| No constraint, 15 min | 15 | null | — | 100 |
| No constraint, 45 min | 45 | null | — | ~72 |
| No constraint, 90 min date | 90 | null (date) | — | 70 (floor) |

---

### 4.4 prefMatchScore (0–100)

**Purpose:** How well does the path match dietary restrictions and cuisine preferences?

This is the only sub-score with hard blocks that trigger on allergen presence. An allergen hit forces 0 on this sub-score, and because the overall final score must be 0 when a hard allergen block is triggered, the scorer additionally forces `finalScore = 0` and marks the path `hardBlocks = ['allergen:${allergen}']`.

```
FUNCTION computePrefMatchScore(
  path: PathInput,
  context: SituationContext
) -> { score: number, hardBlocks: string[] }

  hardBlocks: string[] = []
  score = 100  // start at 100 and subtract; add bonus at end

  // STEP 1: Allergen hard block
  // Any intersection between path's allergens and user's allergen list → score 0
  FOR EACH allergen IN path.containsAllergens:
    IF allergen IN context.allergens:
      hardBlocks.push(`allergen:${allergen}`)

  IF hardBlocks.length > 0:
    RETURN { score: 0, hardBlocks }

  // STEP 2: Dietary restriction matching
  FOR EACH restriction IN context.dietaryRestrictions:
    SWITCH restriction:

      CASE 'vegetarian':
        IF path is ORDER or DINE_OUT:
          IF path.isFullyVegetarian: score = score  // no penalty
          ELSE IF path.isVegetarianMenuAvailable: score -= 25
          // (there are also non-veg items present; risk of cross-contamination or wrong order)
          ELSE: RETURN { score: 0, hardBlocks: ['no_vegetarian_option'] }
        IF path is COOK:
          // We trust the recipe — if it's a vegetarian recipe, it scores full
          // (COOK inherits isVegetarian from the recipe)
          IF NOT path.isVegetarian: RETURN { score: 0, hardBlocks: ['recipe_not_vegetarian'] }

      CASE 'vegan':
        IF path is ORDER or DINE_OUT:
          IF NOT path.isVeganMenuAvailable: RETURN { score: 0, hardBlocks: ['no_vegan_option'] }
          score -= 5   // small penalty: verify items carefully
        IF path is COOK:
          IF NOT path.isVegan: RETURN { score: 0, hardBlocks: ['recipe_not_vegan'] }

      CASE 'jain':
        // Jain restrictions (no root vegetables, no meat) are a subset of vegetarian
        // Apply same vegetarian rule, plus trust that the recipe/restaurant is Jain-certified
        IF path is ORDER or DINE_OUT:
          IF NOT path.isFullyVegetarian: RETURN { score: 0, hardBlocks: ['jain_restriction'] }
        IF path is COOK:
          IF NOT path.isVegetarian: RETURN { score: 0, hardBlocks: ['recipe_not_jain'] }

      CASE 'gluten_free':
        IF 'gluten' IN path.containsAllergens: RETURN { score: 0, hardBlocks: ['allergen:gluten'] }
        score -= 5   // minor penalty: contamination risk is always possible

      CASE 'dairy_free':
        IF 'dairy' IN path.containsAllergens: RETURN { score: 0, hardBlocks: ['allergen:dairy'] }

      CASE 'halal':
        // Cannot verify halal compliance from Swiggy data alone
        // Apply a flat penalty for ORDER and DINE_OUT unless restaurant is halal-certified
        IF path is ORDER or DINE_OUT:
          score -= 20  // uncertainty penalty; implementer can add halal_certified flag later

  // STEP 3: Cuisine preference bonus/penalty
  pathCuisine = path.cuisineType?.toLowerCase() ?? null

  IF pathCuisine is not null:
    FOR EACH liked IN context.likedCuisines:
      IF pathCuisine includes liked.toLowerCase():
        score += 20   // liked cuisine bonus
        BREAK  // apply bonus once

    FOR EACH disliked IN context.dislikedCuisines:
      IF pathCuisine includes disliked.toLowerCase():
        score -= 30   // disliked cuisine penalty
        BREAK  // apply penalty once

  // STEP 4: Date planning ambience bonus (only for DINE_OUT)
  IF context.occasion === 'date' AND path is DINE_OUT:
    ambienceBonus = linearMap(path.ambienceScore, [0, 100], [0, 15])
    score += ambienceBonus

  // STEP 5: Clamp to [0, 100]
  RETURN { score: clamp(score, 0, 100), hardBlocks }
```

#### Worked Examples

| Scenario | Path | Calculation | Score |
|---|---|---|---|
| Vegetarian user, fully veg restaurant | ORDER | isFullyVegetarian=true, no penalty, no allergens | 100 |
| Vegetarian user, mixed restaurant | ORDER | isVegetarianMenuAvailable=true, isFullyVegetarian=false → -25 | 75 |
| Vegetarian user, non-veg only | ORDER | no veg option → 0, hardBlock | 0 |
| Shellfish allergy, dish has shellfish | ORDER | allergen match → 0, hardBlock | 0 |
| User likes South Indian, ORDER is South Indian | ORDER | liked cuisine +20 → 100 (capped) | 100 |
| User dislikes bland food, ORDER is noted as bland | ORDER | disliked -30 → 70 | 70 |
| Date night, DINE_OUT ambience=80 | DINE_OUT | ambienceBonus=linearMap(80,[0,100],[0,15])=12 → 112 → capped | 100 |

---

### 4.5 Final Score Calculation

```
FUNCTION computeFinalScore(
  goalMatch: number,
  budgetFit: number,
  timeFit: number,
  prefMatch: number,
  weights: ScoreWeights,
  hardBlocks: string[]
) -> number

  // Any hard block in prefMatch forces finalScore to 0
  IF hardBlocks.length > 0:
    RETURN 0

  raw = (goalMatch * weights.goalMatch)
      + (budgetFit * weights.budgetFit)
      + (timeFit * weights.timeFit)
      + (prefMatch * weights.preferenceMatch)

  RETURN clamp(Math.round(raw * 10) / 10, 0, 100)
  // Round to 1 decimal place to avoid floating-point noise
```

---

## 5. Path Availability Rules

Path availability is determined **before scoring begins**. Eliminated paths receive `available: false`, all four sub-scores = 0, and `finalScore = 0`. They are never presented as the winner but may appear in the `DecisionResult` for transparency.

These checks run in the order listed. Once a path is eliminated, no further checks apply to it.

### COOK Elimination Rules

```
IF context.canCook === false:
  COOK is eliminated
  reason: 'cannot_cook'

ELSE IF context.pantryState === 'empty' AND context.instamartAvailable === false:
  COOK is eliminated
  reason: 'no_ingredients_and_no_instamart'
  // If Instamart IS available, COOK is not eliminated — the missing ingredients
  // can be purchased, and estimatedCostRupees will include Instamart cost
```

### ORDER Elimination Rules

```
IF context.swiggAvailable === false:
  ORDER is eliminated
  reason: 'swiggy_unavailable'
```

### DINE_OUT Elimination Rules

```
IF context.guests > 15:
  DINE_OUT is eliminated
  reason: 'group_too_large'
  // Groups larger than 15 cannot be accommodated same-day by most Indian restaurants

ELSE IF context.timeConstraintMinutes is not null AND context.timeConstraintMinutes < 60:
  DINE_OUT is eliminated
  reason: 'insufficient_time'
  // You cannot dine out in under 60 minutes
  // (travel 15 min each way + wait + meal = minimum 60–75 min)

ELSE IF context.dineoutAvailable === false:
  DINE_OUT is eliminated
  reason: 'dineout_unavailable'
  // Swiggy Dineout service is offline or the user is offline
```

### Implementation

```typescript
function determineAvailability(
  context: SituationContext,
  cookInput: CookPathInput,
  orderInput: OrderPathInput,
  dineOutInput: DineOutPathInput
): { cook: boolean; order: boolean; dineOut: boolean } {
  const cook =
    context.canCook &&
    !(context.pantryState === 'empty' && !context.instamartAvailable)

  const order = context.swiggAvailable

  const dineOut =
    context.guests <= 15 &&
    (context.timeConstraintMinutes === null || context.timeConstraintMinutes >= 60) &&
    context.dineoutAvailable

  return { cook, order, dineOut }
}
```

---

## 6. Confidence Calculation

The confidence score (0–100) answers the question: *How certain are we that this recommendation is the right one?* It is independent of all path scores. High confidence means the system had complete, verified information. Low confidence means it was forced to assume values for required fields.

### Formula

```
FUNCTION computeConfidence(context: SituationContext, result: { winner, cookScore, orderScore, dineOutScore }) -> number

  base = 90

  // Adjustments for missing context (subtractive)

  // Each missing required field that was assumed (not known)
  penaltyPerMissingRequired = 15
  IF context.missingRequiredFields.length === 1:
    base -= penaltyPerMissingRequired               // -15 → 75
  IF context.missingRequiredFields.length === 2:
    base -= penaltyPerMissingRequired * 1.5         // -22 → 68
  IF context.missingRequiredFields.length >= 3:
    base -= penaltyPerMissingRequired * 2.5         // -37 → 53

  // Service availability gaps
  IF NOT context.swiggAvailable:
    base -= 15  // ORDER is eliminated; if user wanted to order, we can't help
  IF NOT context.pantryDataAvailable:
    base -= 5   // pantry state was assumed; COOK scores may be inaccurate

  // Memory quality
  IF NOT context.memoryPopulated:
    base -= 10  // no user profile; budget/preference scores use defaults

  // Score gap — how decisive is the winner?
  scores = [
    result.cookScore.available ? result.cookScore.finalScore : -1,
    result.orderScore.available ? result.orderScore.finalScore : -1,
    result.dineOutScore.available ? result.dineOutScore.finalScore : -1,
  ].filter(s => s >= 0)

  IF scores.length === 0:
    RETURN 20   // no paths available — very low confidence

  topScore = max(scores)
  IF scores.length >= 2:
    sortedScores = scores.sort(descending)
    gap = sortedScores[0] - sortedScores[1]
    IF gap >= 20: base += 5    // clear winner — confidence bump
    IF gap < 5:  base -= 10   // very close race — lower confidence

  // NO_WINNER case
  IF result.winner === 'NO_WINNER':
    base -= 20

  RETURN clamp(base, 15, 98)
  // 15: minimum (something very wrong; but never 0 — we still have a recommendation)
  // 98: maximum (never 100 — there is always some uncertainty)
```

### Confidence Level Interpretation (for UI)

| Range | Label | UI Behavior |
|---|---|---|
| 85–98 | High | Show recommendation without caveat |
| 70–84 | Good | Show recommendation with one soft caveat |
| 55–69 | Medium | Show recommendation with "Based on assumed budget/preferences" note |
| 40–54 | Low | Show recommendation with "We're making some assumptions — verify these" |
| 15–39 | Very Low | Show recommendation with warning; offer to ask more questions |

---

## 7. Tie-Breaking Rules

### Definition of a Tie

Two paths are considered tied when their final scores are within 5 points of each other.

```
CONSTANT TIE_THRESHOLD = 5   // points

IS_TIE(scoreA, scoreB) = Math.abs(scoreA - scoreB) <= TIE_THRESHOLD
```

### Tiebreak Algorithm

```
FUNCTION determinWinner(
  cookScore: PathScore,
  orderScore: PathScore,
  dineOutScore: PathScore,
  context: SituationContext
) -> { winner, isSplitRecommendation, splitAlternative }

  // Collect only available paths
  available = [cookScore, orderScore, dineOutScore].filter(s => s.available)

  IF available.length === 0:
    RETURN { winner: 'NO_WINNER', isSplitRecommendation: false, splitAlternative: null }

  IF available.length === 1:
    RETURN { winner: available[0].path, isSplitRecommendation: false, splitAlternative: null }

  // Sort by finalScore descending
  sorted = available.sort((a, b) => b.finalScore - a.finalScore)
  first = sorted[0]
  second = sorted[1]

  // Check if all available paths score below 30 (no good option)
  IF first.finalScore < 30:
    RETURN { winner: 'NO_WINNER', isSplitRecommendation: false, splitAlternative: null }

  // Check for tie between top two
  IF IS_TIE(first.finalScore, second.finalScore):
    // Apply tiebreak priority rules (see below)
    tiebreakWinner = applyTiebreakRules(first, second, context)
    IF tiebreakWinner is null:
      // Present as split recommendation
      RETURN {
        winner: first.path,            // first by score is still primary
        isSplitRecommendation: true,
        splitAlternative: second.path,
      }
    RETURN {
      winner: tiebreakWinner.path,
      isSplitRecommendation: false,
      splitAlternative: second.path,   // still show as alternative, but not co-primary
    }

  // Clear winner (gap > 5)
  RETURN { winner: first.path, isSplitRecommendation: false, splitAlternative: second.path }
```

### Tiebreak Priority Rules

Applied in order. The first rule that resolves the tie wins. If no rule resolves it, return `null` (present as split recommendation).

```
FUNCTION applyTiebreakRules(
  first: PathScore,
  second: PathScore,
  context: SituationContext
) -> PathScore | null

  RULE 1: Hard user preference
  // If the user has explicitly stated preference for a service type
  // (e.g., "I feel like ordering", "I want to cook tonight"), honor it
  // This must be passed via context.explicitPathPreference field
  IF context.explicitPathPreference is set:
    preferred = [first, second].find(s => s.path === context.explicitPathPreference)
    IF preferred: RETURN preferred

  RULE 2: Budget protection
  // If one path is over budget and the other is not, prefer the one within budget
  IF context.budgetRupees is not null:
    firstOver = first path cost > context.budgetRupees
    secondOver = second path cost > context.budgetRupees
    IF firstOver AND NOT secondOver: RETURN second
    IF secondOver AND NOT firstOver: RETURN first

  RULE 3: Allergen safety
  // If one path has allergen warnings and the other does not, prefer the safe one
  IF first.hardBlocks.length > 0 AND second.hardBlocks.length === 0: RETURN second
  IF second.hardBlocks.length > 0 AND first.hardBlocks.length === 0: RETURN first

  RULE 4: Situation-type default preference
  // Some situations have a "natural" winner when scores are tied
  SWITCH context.situationType:
    CASE 'sick': prefer ORDER > COOK > DINE_OUT
    CASE 'broke': prefer COOK > ORDER > DINE_OUT
    CASE 'date_planning': prefer DINE_OUT > COOK > ORDER
    CASE 'meal_prep': prefer COOK > ORDER > DINE_OUT
    CASE 'late_night': prefer ORDER > COOK > DINE_OUT
    CASE 'party_hosting': prefer ORDER > DINE_OUT > COOK
    CASE 'office_lunch': prefer ORDER > DINE_OUT > COOK
    DEFAULT: prefer ORDER > COOK > DINE_OUT   // ORDER wins neutral ties

  preferred = [first, second].find following the situation preference order
  IF preferred exists in the tied pair: RETURN preferred

  // No rule resolved the tie
  RETURN null
```

### Minimum Gap for a Clear Winner

| Gap | Behavior |
|---|---|
| ≥ 20 points | Decisive winner — high confidence |
| 10–19 points | Clear winner — normal confidence |
| 5–9 points | Marginal winner — apply tiebreak rules; if unresolved, present as co-primary |
| < 5 points | Tie — always apply tiebreak rules; if unresolved, present as split recommendation |

### Split Recommendation UI Behavior

When `isSplitRecommendation === true`, the UI presents both paths side by side as co-primary options with a label like "Either works — here's the difference:" and shows the Plan Simulator deltas.

---

## 8. The Plan Simulator Calculation

The Plan Simulator shows the user the tradeoffs between the recommended path and its best alternative. It answers: "What do you get or give up by choosing the primary recommendation over the runner-up?"

### Primary vs. Alternative Identification

```
primaryPath = winner path input (CookPathInput | OrderPathInput | DineOutPathInput)

alternativePath =
  IF isSplitRecommendation: splitAlternative path input
  ELSE: second-highest scoring available path input
  // If only one path is available, alternativePath = null
```

### Delta Computation

```
FUNCTION computeSimulatorDeltas(
  primary: PathInput,
  alternative: PathInput | null
) -> PlanSimulatorDeltas

  IF alternative is null:
    RETURN {
      primaryPath: primary.path,
      alternativePath: null,
      deltaCostRupees: null,
      deltaTimeMinutes: null,
      deltaProteinG: null,
      showCostDelta: false,
      showTimeDelta: false,
      showProteinDelta: false,
    }

  deltaCost = alternative.estimatedCostRupees - primary.estimatedCostRupees
  // Positive = primary is cheaper (you save money by choosing primary)
  // Negative = primary is more expensive

  deltaTime = alternative.estimatedTimeMinutes - primary.estimatedTimeMinutes
  // Positive = primary is faster
  // Negative = primary is slower

  deltaProtein = null
  IF primary.proteinG is not null AND alternative.proteinG is not null:
    deltaProtein = primary.proteinG - alternative.proteinG
    // Positive = primary has more protein

  RETURN {
    primaryPath: primary.path,
    alternativePath: alternative.path,
    deltaCostRupees: deltaCost,
    deltaTimeMinutes: deltaTime,
    deltaProteinG: deltaProtein,
    showCostDelta: Math.abs(deltaCost) >= COST_DELTA_THRESHOLD,
    showTimeDelta: Math.abs(deltaTime) >= TIME_DELTA_THRESHOLD,
    showProteinDelta: deltaProtein is not null AND Math.abs(deltaProtein) >= PROTEIN_DELTA_THRESHOLD,
  }
```

### Meaningfulness Thresholds

```typescript
const COST_DELTA_THRESHOLD = 50        // rupees — deltas below ₹50 are not worth showing
const TIME_DELTA_THRESHOLD = 10        // minutes — deltas below 10 minutes are not shown
const PROTEIN_DELTA_THRESHOLD = 10     // grams — deltas below 10g are not shown
```

### Example

Primary: COOK (cost ₹80, time 25 min, protein 45g)  
Alternative: ORDER (cost ₹350, time 30 min, protein 32g)

```
deltaCost    = 350 - 80   = ₹270 saved    → showCostDelta = true   (270 ≥ 50)
deltaTime    = 30 - 25    = 5 min faster  → showTimeDelta = false  (5 < 10)
deltaProtein = 45 - 32    = +13g protein  → showProteinDelta = true (13 ≥ 10)
```

UI: "Cooking saves ₹270 and gives you 13g more protein."

### Display Format

Positive cost delta: "Save ₹{amount}" (green)  
Negative cost delta: "Costs ₹{amount} more" (amber)  
Positive time delta: "{n} min faster" (green)  
Negative time delta: "{n} min more" (grey)  
Positive protein delta: "+{n}g protein" (green)  
Negative protein delta: "{n}g less protein" (grey)

---

## 9. Edge Cases

### Edge Case 1: User is Offline

**Scenario:** The user submits a situation, but their device has no internet connection.

**Inputs:**
```
context.swiggAvailable = false
context.dineoutAvailable = false
context.instamartAvailable = false
```

**Engine Behavior:**
- ORDER is eliminated (swiggy unavailable)
- DINE_OUT is eliminated (dineout unavailable)
- COOK is evaluated; if `context.pantryState === 'empty'` → also eliminated
- If pantry has food, COOK wins by default (only available path)

**Expected Winner:** COOK (if pantry not empty), NO_WINNER (if pantry empty and offline)

**Confidence:** Low (40–55). Confidence penalized -15 for Swiggy unavailability and -10 for missing memory (likely first session if offline).

---

### Edge Case 2: Budget is ₹0

**Scenario:** User explicitly states they have no money to spend on food.

**Inputs:**
```
context.budgetRupees = 0
context.budgetFlexibility = 'strict'
```

**Engine Behavior:**
- `budgetFitScore` for any path with `cost > 0` = 0 (strict budget, any overage is failure)
- `budgetFitScore` for COOK with `canMakeFromPantry = true` and `estimatedCostRupees = 0` = 100
- ORDER and DINE_OUT will have non-zero cost → budgetFitScore = 0
- Since `budgetFit` is heavily weighted in 'broke' situations, COOK wins decisively if pantry allows

**Expected Winner:** COOK (only viable path at zero budget)

**Notes:** The engine should surface a `hardBlocks: ['zero_budget']` note in the order/dineout path explanation to make the reasoning clear.

---

### Edge Case 3: Budget Undefined

**Scenario:** First-time user, no budget stored in memory, none stated in situation.

**Inputs:**
```
context.budgetRupees = null
context.memoryPopulated = false
```

**Engine Behavior:**
- `budgetFitScore` uses `budgetScoreFromAbsoluteCost()` for all paths
- Absolute cost thresholds apply: ₹0–100 = 90, ₹100–200 = 80, etc.
- No path is penalized for being "over budget" because no budget exists
- Confidence is reduced by 10 (no memory) and possibly by 15 (budgetRupees is a required field for many situations)

**Expected Winner:** Path with best combination of goal match, time fit, and lower absolute cost.

---

### Edge Case 4: Time Constraint Under 10 Minutes

**Scenario:** User says "I need food in 5 minutes."

**Inputs:**
```
context.timeConstraintMinutes = 5
```

**Engine Behavior:**
- DINE_OUT is eliminated (< 60 minutes required)
- COOK: fastest possible (instant noodles, reheating) = ~10 minutes → ratio = 10/5 = 2.0 → timeFitScore = 0
- ORDER: minimum delivery time ~15–20 minutes → ratio ≥ 3.0 → timeFitScore = 0

**Result:** All paths score 0 on timeFitScore. Since `timeFit` is weighted at 0.45 in `quick_meal`, both COOK and ORDER will score very low. Winner is determined by other sub-scores.

**Expected Winner:** ORDER (if Swiggy available), because goalMatchScore for quick_meal is higher for ORDER. But `isSplitRecommendation` is likely; the reasoning card should explain that the constraint is not achievable.

**Notes:** The confidence score will be low. Claude's explanation should explicitly state that the 5-minute target is not achievable and offer the fastest available option.

---

### Edge Case 5: Nutrition Goal Impossible on All Paths

**Scenario:** Vegetarian user targets 300g protein per day, but no path can come close.

**Inputs:**
```
context.situationType = 'nutrition_goal'
context.nutritionGoal = { proteinG: 300, scope: 'day' }
context.dietaryRestrictions = ['vegetarian']
cookInput.proteinG = 45    // best possible vegetarian single meal
orderInput.proteinG = 38
dineOutInput.proteinG = 40
```

**Engine Behavior:**
- All paths: ratio ≈ 0.13–0.15 for a single meal goal
- If scope = 'day': these are per-meal protein values, not per-day. Engine should not score 45g against a 300g daily target without knowing how many meals are planned.
- If the engine treats these as per-meal contributions: ratio = 45/300 = 0.15 → goalMatchScore ≈ 0
- All paths will score very low on goalMatchScore, which is weighted 0.50 for nutrition_goal
- Winner: highest remaining score combination

**Expected Winner:** COOK (typically best protein control), but with very low final score.

**Notes:** Claude's explanation must explicitly state the nutritional target is not achievable in a single meal and suggest a multi-meal plan.

---

### Edge Case 6: All Paths Score Below 30

**Scenario:** Severe constraint combination — sick user, ₹30 budget, no pantry, Swiggy offline.

**Inputs:**
```
context.canCook = true
context.pantryState = 'empty'
context.instamartAvailable = false
context.swiggAvailable = false
context.dineoutAvailable = false
context.budgetRupees = 30
```

**Engine Behavior:**
- COOK: eliminated (pantry empty + no Instamart)
- ORDER: eliminated (Swiggy unavailable)
- DINE_OUT: eliminated (dineout unavailable)

**Result:** All paths unavailable → winner = 'NO_WINNER'

**Expected Winner:** NO_WINNER

**Confidence:** 15 (minimum). The UI should show a "We can't help right now" card rather than a recommendation, with suggestions to check connectivity or add pantry items.

---

### Edge Case 7: Swiggy MCP Timeout Mid-Scoring

**Scenario:** The Swiggy MCP call times out and returns no data. The scorer receives an ORDER path input with all values at defaults.

**Input handling:**
This edge case is handled **before** the scorer is called. The scorer is a pure function — it does not call Swiggy. The MCP timeout should be handled in the calling service layer:

**Protocol:**
1. If Swiggy MCP times out, set `context.swiggAvailable = false`
2. ORDER path input should have `available = false`
3. Scorer eliminates ORDER path
4. `DecisionResult.orderScore.available = false`, `orderScore.finalScore = 0`
5. Confidence penalty: -15 for Swiggy unavailability

**Expected Winner:** COOK or DINE_OUT, depending on context.

**Notes:** The scorer must never be called with partial ORDER data (e.g., `restaurantId` set but `estimatedCostRupees = 0`). The data layer must set `available = false` and pass a zeroed-out `OrderPathInput` when the MCP fails.

---

### Edge Case 8: Severe Dietary Restriction Eliminates All Restaurant Options

**Scenario:** Jain user with shellfish and nut allergies looking to order or dine out. No Jain-friendly restaurants are available via Swiggy in the area.

**Inputs:**
```
context.dietaryRestrictions = ['jain', 'vegetarian']
context.allergens = ['shellfish', 'nuts']
orderInput.isFullyVegetarian = false
orderInput.containsAllergens = ['nuts']
dineOutInput.isFullyVegetarian = false
```

**Engine Behavior:**
- ORDER: dietary restriction check → jain requires fully vegetarian → not met → prefMatchScore = 0, hardBlocks = ['jain_restriction']
- DINE_OUT: same dietary restriction issue → prefMatchScore = 0, hardBlocks = ['jain_restriction']
- Both ORDER and DINE_OUT have prefMatchScore = 0, which forces finalScore = 0 due to allergen hard block
- COOK: vegetarian jain recipe, no allergens → prefMatchScore = 100, proceeds normally

**Expected Winner:** COOK

---

### Edge Case 9: Late Night, Only Delivery Available

**Scenario:** 1:30 AM, user is hungry. Most restaurants are closed.

**Inputs:**
```
context.currentHour = 1
context.situationType = 'late_night'
context.dineoutAvailable = false   // late night: dineout service shows no availability
```

**Engine Behavior:**
- DINE_OUT: eliminated (dineout unavailable)
- ORDER: if Swiggy late-night partners are active, goalMatchScore = 90 (late_night + ORDER)
- COOK: goalMatchScore = 75 (late_night + COOK)
- timeFit weight = 0.50 in late_night → ORDER wins if delivery time is reasonable

**Expected Winner:** ORDER (delivery is the dominant late-night solution)

---

### Edge Case 10: User Said They Cannot Cook But Has a Full Pantry

**Scenario:** User says "I can't cook today" but their pantry is fully stocked.

**Inputs:**
```
context.canCook = false
context.pantryState = 'stocked'
```

**Engine Behavior:**
- COOK is eliminated immediately by availability rule (`canCook === false`)
- The pantry state is irrelevant — the user cannot cook regardless of ingredients
- ORDER and DINE_OUT are scored normally
- The pantry data does not affect the pantry score penalty (pantryDataAvailable is still true)

**Expected Winner:** ORDER or DINE_OUT depending on situation type

**Notes:** This is correct behavior. The system respects the user's stated inability. It should NOT override `canCook = false` based on pantry state.

---

### Edge Case 11: Exact Budget Match

**Scenario:** Path costs exactly the user's stated budget to the rupee.

**Inputs:**
```
context.budgetRupees = 350
orderInput.estimatedCostRupees = 350
```

**Engine Behavior:**
- ratio = 350 / 350 = 1.0
- `budgetFitScore` = 85 (at-budget score — see section 4.2)
- NOT 100 (being at budget is fine but not optimal — 20% under would score 100)
- If `budgetFlexibility === 'strict'`, score remains 85 (ratio = 1.0, not > 1.0, so no penalty)

**Expected `budgetFitScore`:** 85

**Notes:** An exact match scores 85, not 100. This is by design — the system slightly favors options under budget to leave the user with spending headroom.

---

### Edge Case 12: First-Time User With Zero Memory

**Scenario:** A brand-new user has just signed up. No preferences, no budget, no location, no pantry data in profile.

**Inputs:**
```
context.memoryPopulated = false
context.pantryDataAvailable = false
context.budgetRupees = null
context.dietaryRestrictions = []
context.allergens = []
context.likedCuisines = []
context.dislikedCuisines = []
context.pantryState = 'empty'   // default when no pantry data
context.missingRequiredFields = ['budgetRupees', 'dietaryRestrictions']
```

**Engine Behavior:**
- COOK: pantryState = 'empty'; if Instamart is available, COOK is not eliminated but has higher cost (Instamart delivery)
- ORDER and DINE_OUT scored with neutral preference (no liked/disliked cuisines, no restrictions)
- budgetFitScore uses absolute cost thresholds for all paths
- Confidence: base 90 - 10 (no memory) - 5 (no pantry data) - 22 (2 missing required fields) = 53 → Medium confidence

**Expected Winner:** ORDER (most reliable path when constraints are unknown)

**Confidence:** ~50–58 (Medium/Low)

**Notes:** The system should prompt the user to complete their profile after the first situation, and mention the assumptions made in the Reasoning Card.

---

## 10. Unit Test Cases

Format:

```
TEST: [name]
INPUT: { situationType, key context fields, path data }
EXPECTED_WINNER: COOK | ORDER | DINE_OUT | NO_WINNER
EXPECTED_CONFIDENCE: approximate range
NOTES: why this is the expected result
```

---

```
TEST: sick_cannot_cook_swiggy_available
INPUT: {
  situationType: 'sick',
  canCook: false,
  pantryState: 'empty',
  swiggAvailable: true,
  dineoutAvailable: false,
  budgetRupees: 300,
  dietaryRestrictions: ['vegetarian'],
  orderInput: { estimatedCostRupees: 160, estimatedTimeMinutes: 28, isFullyVegetarian: false, isVegetarianMenuAvailable: true },
}
EXPECTED_WINNER: ORDER
EXPECTED_CONFIDENCE: 70–82
NOTES: COOK is eliminated (canCook=false). DINE_OUT is eliminated (dineoutAvailable=false). ORDER is the only viable path. Confidence is good; one soft field assumed (alone=true).
```

---

```
TEST: broke_has_pantry
INPUT: {
  situationType: 'broke',
  canCook: true,
  pantryState: 'stocked',
  budgetRupees: 80,
  budgetFlexibility: 'strict',
  swiggAvailable: true,
  cookInput: { estimatedCostRupees: 0, estimatedTimeMinutes: 25, canMakeFromPantry: true, proteinG: 22 },
  orderInput: { estimatedCostRupees: 89, estimatedTimeMinutes: 22, isVegetarianMenuAvailable: true },
}
EXPECTED_WINNER: COOK
EXPECTED_CONFIDENCE: 80–90
NOTES: Budget = ₹80, ORDER costs ₹89 (11% over). With strict budget, ORDER budgetFitScore = 0. COOK is free (from pantry) → budgetFitScore = 100. COOK wins decisively with budgetFit weighted 0.50.
```

---

```
TEST: nutrition_goal_cook_hits_target
INPUT: {
  situationType: 'nutrition_goal',
  nutritionGoal: { proteinG: 40, scope: 'meal' },
  canCook: true,
  pantryState: 'stocked',
  cookInput: { proteinG: 42, estimatedCostRupees: 80, estimatedTimeMinutes: 30, isVegetarian: true },
  orderInput: { proteinG: 28, estimatedCostRupees: 350, estimatedTimeMinutes: 25, isVegetarianMenuAvailable: true },
}
EXPECTED_WINNER: COOK
EXPECTED_CONFIDENCE: 82–92
NOTES: COOK protein ratio = 42/40 = 1.05 → goalMatchScore ≈ 97. ORDER ratio = 28/40 = 0.70 → goalMatchScore ≈ 55. With goalMatch weighted 0.50, COOK wins clearly.
```

---

```
TEST: date_planning_dineout_available
INPUT: {
  situationType: 'date_planning',
  guests: 2,
  occasion: 'date',
  budgetRupees: 2500,
  timeConstraintMinutes: null,
  dineoutAvailable: true,
  swiggAvailable: true,
  canCook: true,
  dineOutInput: { estimatedCostRupees: 2200, estimatedTimeMinutes: 120, hasTableAvailableNow: true, ambienceScore: 85, isVegetarianMenuAvailable: true },
  cookInput: { estimatedCostRupees: 500, estimatedTimeMinutes: 60 },
  orderInput: { estimatedCostRupees: 800, estimatedTimeMinutes: 40 },
}
EXPECTED_WINNER: DINE_OUT
EXPECTED_CONFIDENCE: 75–88
NOTES: date_planning has preferenceMatch weight 0.55. DINE_OUT ambience=85, goalMatchScore=90 (table available). Even though COOK is cheaper, the preference/ambience score for DINE_OUT dominates.
```

---

```
TEST: party_hosting_large_group
INPUT: {
  situationType: 'party_hosting',
  guests: 12,
  budgetRupees: 3000,
  swiggAvailable: true,
  dineoutAvailable: true,
  cookInput: { estimatedCostRupees: 2200, estimatedTimeMinutes: 120 },
  orderInput: { estimatedCostRupees: 2800, estimatedTimeMinutes: 45 },
  dineOutInput: { estimatedCostRupees: 4800, estimatedTimeMinutes: 180, guestCapacity: 15, hasTableAvailableNow: true },
}
EXPECTED_WINNER: ORDER
EXPECTED_CONFIDENCE: 70–85
NOTES: DINE_OUT costs ₹4800 → 60% over budget → budgetFitScore = 0 → finalScore ≈ 0. COOK goalMatchScore = 40 (12 guests). ORDER goalMatchScore = 85 + budgetFitScore high (₹2800 vs ₹3000 budget). ORDER wins.
```

---

```
TEST: quick_meal_all_paths_available
INPUT: {
  situationType: 'quick_meal',
  timeConstraintMinutes: 20,
  budgetRupees: 250,
  canCook: true,
  pantryState: 'partial',
  cookInput: { estimatedTimeMinutes: 18, estimatedCostRupees: 60, difficultyLevel: 'easy' },
  orderInput: { estimatedTimeMinutes: 30, estimatedCostRupees: 220 },
}
EXPECTED_WINNER: COOK
EXPECTED_CONFIDENCE: 78–88
NOTES: COOK time ratio = 18/20 = 0.9 → timeFitScore = 100. ORDER time ratio = 30/20 = 1.5 → timeFitScore = 20. With timeFit weighted 0.45, COOK wins despite ORDER being the typical quick option.
```

---

```
TEST: meal_prep_cook_dominates
INPUT: {
  situationType: 'meal_prep',
  canCook: true,
  pantryState: 'partial',
  budgetRupees: 800,
  cookInput: { estimatedCostRupees: 600, estimatedTimeMinutes: 120 },
  orderInput: { estimatedCostRupees: 350, estimatedTimeMinutes: 35 },
  dineOutInput: { estimatedCostRupees: 900, estimatedTimeMinutes: 90, hasTableAvailableNow: true },
}
EXPECTED_WINNER: COOK
EXPECTED_CONFIDENCE: 72–85
NOTES: meal_prep situationType gives COOK goalMatchScore = 90, ORDER = 20, DINE_OUT = 5. Even with DINE_OUT over budget, COOK's dominant goalMatch at 0.45 weight wins clearly.
```

---

```
TEST: office_lunch_order_wins
INPUT: {
  situationType: 'office_lunch',
  timeConstraintMinutes: 45,
  budgetRupees: 250,
  canCook: false,
  swiggAvailable: true,
  dineoutAvailable: true,
  orderInput: { estimatedTimeMinutes: 25, estimatedCostRupees: 220 },
  dineOutInput: { estimatedTimeMinutes: 60, estimatedCostRupees: 350, hasTableAvailableNow: true },
}
EXPECTED_WINNER: ORDER
EXPECTED_CONFIDENCE: 80–92
NOTES: COOK eliminated (canCook=false). DINE_OUT: time ratio 60/45=1.33 → timeFitScore≈50; also over budget. ORDER: time 25/45=0.56 → timeFitScore=100; within budget. With timeFit at 0.40, ORDER wins.
```

---

```
TEST: family_dinner_cook_wins
INPUT: {
  situationType: 'family_dinner',
  guests: 4,
  budgetRupees: 700,
  canCook: true,
  pantryState: 'stocked',
  dietaryRestrictions: ['vegetarian'],
  cookInput: { estimatedCostRupees: 300, estimatedTimeMinutes: 60, isVegetarian: true },
  orderInput: { estimatedCostRupees: 650, estimatedTimeMinutes: 40, isFullyVegetarian: true },
  dineOutInput: { estimatedCostRupees: 600, estimatedTimeMinutes: 90, hasTableAvailableNow: false },
}
EXPECTED_WINNER: COOK
EXPECTED_CONFIDENCE: 78–88
NOTES: DINE_OUT has no table → goalMatchScore = 40. COOK prefMatchScore=100 (fully veg recipe), budgetFitScore=100 (57% under budget). ORDER prefMatchScore=100 but higher cost. COOK wins on combined score.
```

---

```
TEST: late_night_order_wins
INPUT: {
  situationType: 'late_night',
  currentHour: 2,
  timeConstraintMinutes: null,
  swiggAvailable: true,
  dineoutAvailable: false,
  canCook: true,
  pantryState: 'partial',
  orderInput: { estimatedTimeMinutes: 35, estimatedCostRupees: 280 },
  cookInput: { estimatedTimeMinutes: 25, estimatedCostRupees: 50 },
}
EXPECTED_WINNER: ORDER
EXPECTED_CONFIDENCE: 65–78
NOTES: DINE_OUT eliminated. late_night goalMatchScore: ORDER=90, COOK=75. Both compete. timeFit weight=0.50: COOK (25 min) → timeFitScore=100; ORDER (35 min) → timeFitScore=83. COOK has better time but lower goalMatch. Combined: COOK final≈84, ORDER final≈88 → ORDER wins narrowly.
```

---

```
TEST: general_no_constraints
INPUT: {
  situationType: 'general',
  budgetRupees: null,
  timeConstraintMinutes: null,
  canCook: true,
  pantryState: 'partial',
  swiggAvailable: true,
  dineoutAvailable: true,
  cookInput: { estimatedCostRupees: 100, estimatedTimeMinutes: 35 },
  orderInput: { estimatedCostRupees: 300, estimatedTimeMinutes: 30 },
  dineOutInput: { estimatedCostRupees: 500, estimatedTimeMinutes: 90, hasTableAvailableNow: true },
}
EXPECTED_WINNER: ORDER
EXPECTED_CONFIDENCE: 52–65
NOTES: No constraints → budget uses absolute thresholds. General weights are balanced. ORDER goalMatchScore=75 (general), budgetFitScore=70 (₹300 absolute), timeFitScore=85. COOK goalMatchScore=70, budgetFitScore=90 (₹100). Close race likely → split recommendation possible if within 5 points.
```

---

```
TEST: allergen_blocks_all_ordered_options
INPUT: {
  situationType: 'sick',
  canCook: true,
  pantryState: 'stocked',
  allergens: ['shellfish', 'nuts'],
  cookInput: { estimatedCostRupees: 60, containsAllergens: [], isVegetarian: true },
  orderInput: { estimatedCostRupees: 200, containsAllergens: ['nuts'] },
  dineOutInput: { estimatedCostRupees: 400, containsAllergens: ['shellfish'] },
}
EXPECTED_WINNER: COOK
EXPECTED_CONFIDENCE: 80–90
NOTES: ORDER has nuts allergen → prefMatchScore=0 → finalScore=0. DINE_OUT has shellfish → prefMatchScore=0 → finalScore=0. COOK has no allergens → full prefMatchScore. COOK wins by elimination.
```

---

```
TEST: zero_budget_free_pantry_cook
INPUT: {
  situationType: 'broke',
  budgetRupees: 0,
  budgetFlexibility: 'strict',
  canCook: true,
  pantryState: 'stocked',
  cookInput: { estimatedCostRupees: 0, canMakeFromPantry: true, estimatedTimeMinutes: 25 },
  orderInput: { estimatedCostRupees: 89, estimatedTimeMinutes: 25 },
}
EXPECTED_WINNER: COOK
EXPECTED_CONFIDENCE: 75–88
NOTES: Budget=₹0, strict. ORDER cost=₹89 > 0 → budgetFitScore=0 (strict mode, any overage=0). COOK cost=₹0 → budgetFitScore=100. With budgetFit=0.50 in broke, COOK wins.
```

---

```
TEST: no_winner_all_paths_unavailable
INPUT: {
  situationType: 'late_night',
  canCook: false,
  swiggAvailable: false,
  dineoutAvailable: false,
  pantryState: 'empty',
  instamartAvailable: false,
}
EXPECTED_WINNER: NO_WINNER
EXPECTED_CONFIDENCE: 15
NOTES: COOK eliminated (canCook=false). ORDER eliminated (swiggAvailable=false). DINE_OUT eliminated (dineoutAvailable=false). No paths available. winner=NO_WINNER, confidence=15 (minimum).
```

---

```
TEST: split_recommendation_tie
INPUT: {
  situationType: 'general',
  budgetRupees: 300,
  timeConstraintMinutes: 30,
  canCook: true,
  pantryState: 'partial',
  swiggAvailable: true,
  dineoutAvailable: false,
  cookInput: { estimatedCostRupees: 100, estimatedTimeMinutes: 28, isVegetarian: true },
  orderInput: { estimatedCostRupees: 250, estimatedTimeMinutes: 25, isVegetarianMenuAvailable: true },
  dietaryRestrictions: ['vegetarian'],
  likedCuisines: ['South Indian'],
  cookInput.cuisineType: 'South Indian',
  orderInput.cuisineType: 'North Indian',
}
EXPECTED_WINNER: COOK (with ORDER as splitAlternative)
EXPECTED_CONFIDENCE: 60–72
NOTES: COOK gets +20 liked cuisine bonus in prefMatch. Both paths may end up within 5 points. Tiebreak rule: 'general' prefers ORDER, but liked cuisine pushes COOK ahead. Check if gap > 5 → if so, clear winner; otherwise split.
```

---

```
TEST: first_time_user_zero_memory
INPUT: {
  situationType: 'general',
  memoryPopulated: false,
  pantryDataAvailable: false,
  budgetRupees: null,
  dietaryRestrictions: [],
  allergens: [],
  pantryState: 'empty',
  canCook: true,
  instamartAvailable: true,
  swiggAvailable: true,
  missingRequiredFields: ['budgetRupees', 'dietaryRestrictions'],
}
EXPECTED_WINNER: ORDER
EXPECTED_CONFIDENCE: 45–58
NOTES: Missing 2 required fields → -22 confidence. No memory → -10. No pantry data → -5. Base=90-37=53. ORDER wins in general with no constraints (default preference). Confidence is medium-low.
```

---

```
TEST: nutrition_goal_impossible_vegetarian_300g
INPUT: {
  situationType: 'nutrition_goal',
  nutritionGoal: { proteinG: 300, scope: 'day' },
  dietaryRestrictions: ['vegetarian'],
  cookInput: { proteinG: 45 },
  orderInput: { proteinG: 38 },
  dineOutInput: { proteinG: 40 },
}
EXPECTED_WINNER: COOK
EXPECTED_CONFIDENCE: 35–50
NOTES: All paths score very low on goalMatchScore (ratios 0.13–0.15). COOK still has the highest combined score. Confidence is low because the goal is not achievable. Claude's explanation must flag this.
```

---

```
TEST: exact_budget_match
INPUT: {
  situationType: 'general',
  budgetRupees: 350,
  budgetFlexibility: 'soft',
  orderInput: { estimatedCostRupees: 350, estimatedTimeMinutes: 30 },
}
EXPECTED_WINNER: ORDER (assuming only viable path in context)
EXPECTED_CONFIDENCE: 72–85
NOTES: ratio=1.0 → budgetFitScore=85 (not 100). At-budget is scored 85, 20% under scores 100. This is correct per specification.
```

---

```
TEST: dineout_eliminated_time_constraint
INPUT: {
  situationType: 'quick_meal',
  timeConstraintMinutes: 45,
  swiggAvailable: true,
  dineoutAvailable: true,
  canCook: true,
  cookInput: { estimatedTimeMinutes: 30 },
  orderInput: { estimatedTimeMinutes: 25 },
  dineOutInput: { estimatedTimeMinutes: 90, hasTableAvailableNow: true },
}
EXPECTED_WINNER: ORDER
EXPECTED_CONFIDENCE: 78–88
NOTES: DINE_OUT eliminated by availability rule (timeConstraintMinutes=45 < 60). ORDER timeFitScore: 25/45=0.56 → 100. COOK: 30/45=0.67 → 100. Tie on time. ORDER goalMatchScore=85 (quick_meal + ORDER). COOK goalMatchScore=80. ORDER wins.
```

---

```
TEST: cook_eliminated_cannot_cook_full_pantry
INPUT: {
  situationType: 'sick',
  canCook: false,
  pantryState: 'stocked',   // pantry is full but user cannot cook
  swiggAvailable: true,
  dineoutAvailable: false,
  orderInput: { estimatedCostRupees: 180, estimatedTimeMinutes: 30, isVegetarianMenuAvailable: true },
}
EXPECTED_WINNER: ORDER
EXPECTED_CONFIDENCE: 72–84
NOTES: COOK is eliminated despite full pantry (canCook=false takes precedence). ORDER is the only available path.
```

---

## 11. Performance Targets and Constraints

### Latency Budget

| Operation | Maximum Time |
|---|---|
| Full scoring (all 3 paths) | < 5ms |
| Single path scoring | < 2ms |
| Confidence calculation | < 1ms |
| Tie-breaking resolution | < 0.5ms |
| Simulator delta computation | < 0.5ms |

The 5ms budget assumes all inputs are pre-fetched (Swiggy data, memory, pantry). The scorer never waits for I/O. If the calling service needs to fetch data, that latency is not counted against the scorer.

### Purity Constraints

The scorer is a **pure function module**. This is not a suggestion; it is an architectural requirement.

1. **No async operations.** The scorer contains zero `async` functions, zero `await` expressions, zero Promises. Every function is synchronous.

2. **No LLM calls.** The scorer never calls Anthropic, OpenAI, or any AI service. Claude is called by the calling service after `computeDecision()` returns.

3. **No network calls.** No HTTP, no database queries, no file system access.

4. **No global mutable state.** The scorer does not modify any variable outside its call stack. No module-level counters, no caches, no singletons that mutate.

5. **No side effects.** Calling `computeDecision(input)` twice with the same input must produce identical output and must not change any external state.

6. **No randomness.** `Math.random()` is never called. All outputs are deterministic from inputs.

### Memory Footprint

All scorer operations run on plain JavaScript objects passed by value (or reference, but never mutated). No large data structures are allocated. Memory usage per call is negligible (< 1KB of allocations).

### Input Validation

The scorer does not validate its inputs. Input validation is the responsibility of the calling service. If the scorer receives malformed input (e.g., `budgetRupees = -50`), behavior is undefined. The calling service must validate via Zod schemas before calling the scorer.

### Module Interface

```typescript
// lib/engine/scorer.ts — the only public export
export function computeDecision(
  context: SituationContext,
  cook: CookPathInput,
  order: OrderPathInput,
  dineOut: DineOutPathInput
): DecisionResult

// All helper functions are private (not exported)
// Only computeDecision() is part of the public contract
```

---

## 12. Testing Strategy

### Framework

Use **Vitest** (co-located with the Next.js project). Tests live at `lib/engine/__tests__/scorer.test.ts`.

### Unit Test Structure

```typescript
import { describe, it, expect } from 'vitest'
import { computeDecision } from '../scorer'
import { buildContext, buildCookInput, buildOrderInput, buildDineOutInput } from './fixtures'

describe('computeDecision', () => {
  describe('sick situation', () => {
    it('recommends ORDER when user cannot cook and Swiggy is available', () => {
      const result = computeDecision(
        buildContext({ situationType: 'sick', canCook: false, swiggAvailable: true }),
        buildCookInput({ available: false }),
        buildOrderInput({ estimatedCostRupees: 180, estimatedTimeMinutes: 28 }),
        buildDineOutInput({ available: false })
      )
      expect(result.winner).toBe('ORDER')
      expect(result.cookScore.available).toBe(false)
      expect(result.confidence).toBeGreaterThanOrEqual(65)
    })
  })
})
```

### Fixtures

Create a `fixtures.ts` file with builder functions that return valid, sensible defaults and accept partial overrides via TypeScript `Partial<>`:

```typescript
// lib/engine/__tests__/fixtures.ts

export function buildContext(overrides: Partial<SituationContext> = {}): SituationContext {
  return {
    situationType: 'general',
    timeConstraintMinutes: null,
    currentHour: 12,
    isWeekend: false,
    budgetRupees: 300,
    budgetFlexibility: 'soft',
    canCook: true,
    cookingSkillLevel: 'intermediate',
    pantryState: 'partial',
    guests: 1,
    occasion: 'none',
    dietaryRestrictions: [],
    allergens: [],
    likedCuisines: [],
    dislikedCuisines: [],
    nutritionGoal: null,
    swiggAvailable: true,
    instamartAvailable: true,
    dineoutAvailable: true,
    memoryPopulated: true,
    pantryDataAvailable: true,
    missingRequiredFields: [],
    ...overrides,
  }
}
```

### Property-Based Testing (Invariants)

These invariants must always hold for any valid input. Add them as a property-based test suite using `fast-check`:

```typescript
import * as fc from 'fast-check'

describe('scorer invariants', () => {

  it('INV-1: all sub-scores are in [0, 100]', () => {
    fc.assert(fc.property(arbitraryValidInput(), ({ context, cook, order, dineOut }) => {
      const result = computeDecision(context, cook, order, dineOut)
      for (const score of [result.cookScore, result.orderScore, result.dineOutScore]) {
        expect(score.goalMatchScore).toBeGreaterThanOrEqual(0)
        expect(score.goalMatchScore).toBeLessThanOrEqual(100)
        expect(score.budgetFitScore).toBeGreaterThanOrEqual(0)
        expect(score.budgetFitScore).toBeLessThanOrEqual(100)
        expect(score.timeFitScore).toBeGreaterThanOrEqual(0)
        expect(score.timeFitScore).toBeLessThanOrEqual(100)
        expect(score.prefMatchScore).toBeGreaterThanOrEqual(0)
        expect(score.prefMatchScore).toBeLessThanOrEqual(100)
      }
    }))
  })

  it('INV-2: finalScore is in [0, 100]', () => {
    fc.assert(fc.property(arbitraryValidInput(), (inputs) => {
      const result = computeDecision(...Object.values(inputs))
      expect(result.cookScore.finalScore).toBeGreaterThanOrEqual(0)
      expect(result.cookScore.finalScore).toBeLessThanOrEqual(100)
    }))
  })

  it('INV-3: unavailable paths score exactly 0', () => {
    fc.assert(fc.property(arbitraryValidInput(), (inputs) => {
      const result = computeDecision(...Object.values(inputs))
      for (const score of [result.cookScore, result.orderScore, result.dineOutScore]) {
        if (!score.available) {
          expect(score.finalScore).toBe(0)
          expect(score.goalMatchScore).toBe(0)
          expect(score.budgetFitScore).toBe(0)
          expect(score.timeFitScore).toBe(0)
          expect(score.prefMatchScore).toBe(0)
        }
      }
    }))
  })

  it('INV-4: determinism — same input always produces same output', () => {
    fc.assert(fc.property(arbitraryValidInput(), (inputs) => {
      const result1 = computeDecision(...Object.values(inputs))
      const result2 = computeDecision(...Object.values(inputs))
      expect(result1).toEqual(result2)
    }))
  })

  it('INV-5: winner is always an available path or NO_WINNER', () => {
    fc.assert(fc.property(arbitraryValidInput(), (inputs) => {
      const result = computeDecision(...Object.values(inputs))
      if (result.winner === 'NO_WINNER') return
      const winnerScore = {
        COOK: result.cookScore,
        ORDER: result.orderScore,
        DINE_OUT: result.dineOutScore,
      }[result.winner]
      expect(winnerScore.available).toBe(true)
    }))
  })

  it('INV-6: winner finalScore >= all other available path final scores', () => {
    fc.assert(fc.property(arbitraryValidInput(), (inputs) => {
      const result = computeDecision(...Object.values(inputs))
      if (result.winner === 'NO_WINNER') return
      const winnerScore = {
        COOK: result.cookScore,
        ORDER: result.orderScore,
        DINE_OUT: result.dineOutScore,
      }[result.winner].finalScore
      for (const score of [result.cookScore, result.orderScore, result.dineOutScore]) {
        if (score.available) {
          expect(winnerScore).toBeGreaterThanOrEqual(score.finalScore - TIE_THRESHOLD)
        }
      }
    }))
  })

  it('INV-7: confidence is in [15, 98]', () => {
    fc.assert(fc.property(arbitraryValidInput(), (inputs) => {
      const result = computeDecision(...Object.values(inputs))
      expect(result.confidence).toBeGreaterThanOrEqual(15)
      expect(result.confidence).toBeLessThanOrEqual(98)
    }))
  })

  it('INV-8: allergen hard block forces finalScore to 0', () => {
    fc.assert(fc.property(arbitraryValidInput(), (inputs) => {
      const result = computeDecision(...Object.values(inputs))
      for (const score of [result.cookScore, result.orderScore, result.dineOutScore]) {
        if (score.hardBlocks.some(b => b.startsWith('allergen:'))) {
          expect(score.finalScore).toBe(0)
        }
      }
    }))
  })

  it('INV-9: weights always sum to 1.0', () => {
    const result = computeDecision(buildContext(), buildCookInput(), buildOrderInput(), buildDineOutInput())
    const w = result.weightsUsed
    const sum = w.goalMatch + w.budgetFit + w.timeFit + w.preferenceMatch
    expect(Math.round(sum * 100)).toBe(100)
  })

  it('INV-10: NO_WINNER when all paths are unavailable', () => {
    const result = computeDecision(
      buildContext({ canCook: false, swiggAvailable: false, dineoutAvailable: false }),
      buildCookInput({ available: false }),
      buildOrderInput({ available: false }),
      buildDineOutInput({ available: false })
    )
    expect(result.winner).toBe('NO_WINNER')
  })
})
```

### Regression Testing

When any of the following change, the unit test suite is the regression guard:
- A weight in the weight table
- A formula breakpoint or slope
- A hard block condition
- A situation-type tiebreak preference order
- A confidence penalty amount

**Protocol:** When changing a weight or formula, run the full test suite. If a test fails, either the change is incorrect and should be reverted, or the test expectation needs deliberate review and update with a documented reason. No silent test skips.

### The Smoke Test

One test that exercises every situation type. If all 11 pass, the scorer is at minimum functional across all types.

```typescript
describe('smoke test — all situation types', () => {
  const situationTypes: SituationType[] = [
    'sick', 'broke', 'date_planning', 'party_hosting', 'nutrition_goal',
    'quick_meal', 'meal_prep', 'office_lunch', 'family_dinner', 'late_night', 'general'
  ]

  for (const type of situationTypes) {
    it(`does not throw for situationType=${type}`, () => {
      expect(() =>
        computeDecision(
          buildContext({ situationType: type }),
          buildCookInput(),
          buildOrderInput(),
          buildDineOutInput()
        )
      ).not.toThrow()
    })

    it(`returns a valid DecisionResult for situationType=${type}`, () => {
      const result = computeDecision(
        buildContext({ situationType: type }),
        buildCookInput(),
        buildOrderInput(),
        buildDineOutInput()
      )
      expect(result.winner).toBeDefined()
      expect(['COOK', 'ORDER', 'DINE_OUT', 'NO_WINNER']).toContain(result.winner)
      expect(result.confidence).toBeGreaterThanOrEqual(15)
      expect(result.confidence).toBeLessThanOrEqual(98)
    })
  }
})
```

### Coverage Target

Line coverage: 90% minimum for `lib/engine/scorer.ts`  
Branch coverage: 85% minimum  
All hard block conditions must have at least one test that triggers them.

---

*End of Decision Engine Specification*  
*Implementer: refer to `lib/engine/types.ts` for all interfaces, `lib/engine/scorer.ts` for all logic.*  
*Do not modify this spec without updating the unit test suite to match.*
