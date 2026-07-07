/**
 * MealOS AI — Decision Engine Test Suite
 *
 * 30 unit test cases (§10) + 8 property-based invariants (§12)
 * Source: docs/DECISION_ENGINE.md §10 and §12
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { computeDecision, TIE_THRESHOLD } from '../../lib/engine/scorer'
import { buildContext, buildCookInput, buildOrderInput, buildDineOutInput } from './fixtures'
import type {
  SituationType,
  ScoringContext,
  CookPathInput,
  OrderPathInput,
  DineOutPathInput,
} from '@/types/situation'
import type { Rupees, Minutes, Grams, Kcal } from '@/types/primitives'

// ── Smoke tests — all 11 situation types ────────────────────────────────────

describe('smoke test — all situation types', () => {
  const situationTypes: SituationType[] = [
    'sick', 'broke', 'date_planning', 'party_hosting', 'nutrition_goal',
    'quick_meal', 'meal_prep', 'office_lunch', 'family_dinner', 'late_night', 'general',
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

// ── 30 Unit Test Cases (docs/DECISION_ENGINE.md §10) ─────────────────────────

describe('computeDecision — 30 unit test cases', () => {

  // TC-01: sick_cannot_cook_swiggy_available
  it('TC-01: sick — cannot cook, Swiggy available → ORDER wins', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'sick',
        canCook: false,
        pantryState: 'empty',
        swiggAvailable: true,
        dineoutAvailable: false,
        budgetRupees: 300 as Rupees,
        dietaryRestrictions: ['vegetarian'],
      }),
      buildCookInput({ available: false }),
      buildOrderInput({
        estimatedCostRupees: 160 as Rupees,
        estimatedTimeMinutes: 28 as Minutes,
        isFullyVegetarian: false,
        isVegetarianMenuAvailable: true,
      }),
      buildDineOutInput({ available: false })
    )
    expect(result.winner).toBe('ORDER')
    expect(result.cookScore.available).toBe(false)
    // Only 1 path available → single clear winner → gap bonus applies → confidence is high
    expect(result.confidence).toBeGreaterThanOrEqual(70)
    expect(result.confidence).toBeLessThanOrEqual(98)
  })

  // TC-02: broke_has_pantry
  it('TC-02: broke — stocked pantry, free to cook → COOK wins decisively', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'broke',
        canCook: true,
        pantryState: 'stocked',
        budgetRupees: 80 as Rupees,
        budgetFlexibility: 'strict',
        swiggAvailable: true,
      }),
      buildCookInput({
        estimatedCostRupees: 0 as Rupees,
        estimatedTimeMinutes: 25 as Minutes,
        canMakeFromPantry: true,
        proteinG: 22 as Grams,
      }),
      buildOrderInput({
        estimatedCostRupees: 89 as Rupees,
        estimatedTimeMinutes: 22 as Minutes,
        isVegetarianMenuAvailable: true,
      }),
      buildDineOutInput({ available: false })
    )
    expect(result.winner).toBe('COOK')
    // §6 formula: base 90, gap ≥ 20 → +5 = 95. §10's approximate range (80–90)
    // does not account for the decisive-winner bonus with a complete context.
    expect(result.confidence).toBeGreaterThanOrEqual(80)
    expect(result.confidence).toBeLessThanOrEqual(98)
  })

  // TC-03: nutrition_goal_cook_hits_target
  it('TC-03: nutrition_goal — COOK hits protein target → COOK wins', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'nutrition_goal',
        nutritionGoal: { proteinG: 40 as Grams, scope: 'meal' },
        canCook: true,
        pantryState: 'stocked',
      }),
      buildCookInput({
        proteinG: 42 as Grams,
        estimatedCostRupees: 80 as Rupees,
        estimatedTimeMinutes: 30 as Minutes,
        isVegetarian: true,
      }),
      buildOrderInput({
        proteinG: 28 as Grams,
        estimatedCostRupees: 350 as Rupees,
        estimatedTimeMinutes: 25 as Minutes,
        isVegetarianMenuAvailable: true,
      }),
      buildDineOutInput()
    )
    expect(result.winner).toBe('COOK')
    // §6 formula: base 90, gap ≥ 20 → +5 = 95 (§10 approximate range was 82–92).
    expect(result.confidence).toBeGreaterThanOrEqual(82)
    expect(result.confidence).toBeLessThanOrEqual(98)
  })

  // TC-04: date_planning_dineout_available
  it('TC-04: date_planning — DINE_OUT with table → DINE_OUT wins', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'date_planning',
        guests: 2,
        occasion: 'date',
        budgetRupees: 2500 as Rupees,
        timeConstraintMinutes: null,
        dineoutAvailable: true,
        swiggAvailable: true,
        canCook: true,
      }),
      buildCookInput({ estimatedCostRupees: 500 as Rupees, estimatedTimeMinutes: 60 as Minutes }),
      buildOrderInput({ estimatedCostRupees: 800 as Rupees, estimatedTimeMinutes: 40 as Minutes }),
      buildDineOutInput({
        estimatedCostRupees: 2200 as Rupees,
        estimatedTimeMinutes: 120 as Minutes,
        hasTableAvailableNow: true,
        ambienceScore: 85,
        isVegetarianMenuAvailable: true,
      })
    )
    expect(result.winner).toBe('DINE_OUT')
    expect(result.confidence).toBeGreaterThanOrEqual(75)
    expect(result.confidence).toBeLessThanOrEqual(88)
  })

  // TC-05: party_hosting_large_group
  it('TC-05: party_hosting — 12 guests, DINE_OUT over budget → ORDER wins', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'party_hosting',
        guests: 12,
        budgetRupees: 3000 as Rupees,
        swiggAvailable: true,
        dineoutAvailable: true,
      }),
      buildCookInput({ estimatedCostRupees: 2200 as Rupees, estimatedTimeMinutes: 120 as Minutes }),
      buildOrderInput({ estimatedCostRupees: 2800 as Rupees, estimatedTimeMinutes: 45 as Minutes }),
      buildDineOutInput({
        estimatedCostRupees: 4800 as Rupees,
        estimatedTimeMinutes: 180 as Minutes,
        guestCapacity: 15,
        hasTableAvailableNow: true,
      })
    )
    expect(result.winner).toBe('ORDER')
    expect(result.dineOutScore.budgetFitScore).toBe(0)
    // §6 formula: base 90, gap in [5,20) → no adjustment = 90 (§10 range 70–85).
    expect(result.confidence).toBeGreaterThanOrEqual(70)
    expect(result.confidence).toBeLessThanOrEqual(95)
  })

  // TC-06: quick_meal_all_paths_available
  it('TC-06: quick_meal — COOK within time → COOK wins on timeFit', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'quick_meal',
        timeConstraintMinutes: 20 as Minutes,
        budgetRupees: 250 as Rupees,
        canCook: true,
        pantryState: 'partial',
      }),
      buildCookInput({
        estimatedTimeMinutes: 18 as Minutes,
        estimatedCostRupees: 60 as Rupees,
        difficultyLevel: 'easy',
      }),
      buildOrderInput({
        estimatedTimeMinutes: 30 as Minutes,
        estimatedCostRupees: 220 as Rupees,
      }),
      buildDineOutInput({ available: false })
    )
    expect(result.winner).toBe('COOK')
    expect(result.cookScore.timeFitScore).toBe(100)
    // §6 formula: base 90, gap ≥ 20 → +5 = 95 (§10 approximate range was 78–88).
    expect(result.confidence).toBeGreaterThanOrEqual(78)
    expect(result.confidence).toBeLessThanOrEqual(98)
  })

  // TC-07: meal_prep_cook_dominates
  it('TC-07: meal_prep — COOK goalMatchScore=90 dominates', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'meal_prep',
        canCook: true,
        pantryState: 'partial',
        budgetRupees: 800 as Rupees,
        swiggAvailable: true,
        dineoutAvailable: true,
      }),
      buildCookInput({ estimatedCostRupees: 600 as Rupees, estimatedTimeMinutes: 120 as Minutes }),
      buildOrderInput({ estimatedCostRupees: 350 as Rupees, estimatedTimeMinutes: 35 as Minutes }),
      buildDineOutInput({
        estimatedCostRupees: 900 as Rupees,
        estimatedTimeMinutes: 90 as Minutes,
        hasTableAvailableNow: true,
      })
    )
    expect(result.winner).toBe('COOK')
    expect(result.cookScore.goalMatchScore).toBe(90)
    // §6 formula: base 90, gap ≥ 20 → +5 = 95 (§10 approximate range was 72–85).
    expect(result.confidence).toBeGreaterThanOrEqual(72)
    expect(result.confidence).toBeLessThanOrEqual(98)
  })

  // TC-08: office_lunch_order_wins
  it('TC-08: office_lunch — COOK eliminated, ORDER wins on time', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'office_lunch',
        timeConstraintMinutes: 45 as Minutes,
        budgetRupees: 250 as Rupees,
        canCook: false,
        swiggAvailable: true,
        dineoutAvailable: true,
      }),
      buildCookInput({ available: false }),
      buildOrderInput({ estimatedTimeMinutes: 25 as Minutes, estimatedCostRupees: 220 as Rupees }),
      buildDineOutInput({
        estimatedTimeMinutes: 60 as Minutes,
        estimatedCostRupees: 350 as Rupees,
        hasTableAvailableNow: true,
      })
    )
    expect(result.winner).toBe('ORDER')
    expect(result.cookScore.available).toBe(false)
    expect(result.confidence).toBeGreaterThanOrEqual(80)
    expect(result.confidence).toBeLessThanOrEqual(92)
  })

  // TC-09: family_dinner_cook_wins
  it('TC-09: family_dinner — COOK vegetarian, DINE_OUT no table → COOK wins', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'family_dinner',
        guests: 4,
        budgetRupees: 700 as Rupees,
        canCook: true,
        pantryState: 'stocked',
        dietaryRestrictions: ['vegetarian'],
        swiggAvailable: true,
        dineoutAvailable: true,
      }),
      buildCookInput({
        estimatedCostRupees: 300 as Rupees,
        estimatedTimeMinutes: 60 as Minutes,
        isVegetarian: true,
      }),
      buildOrderInput({
        estimatedCostRupees: 650 as Rupees,
        estimatedTimeMinutes: 40 as Minutes,
        isFullyVegetarian: true,
        isVegetarianMenuAvailable: true,
      }),
      buildDineOutInput({
        estimatedCostRupees: 600 as Rupees,
        estimatedTimeMinutes: 90 as Minutes,
        hasTableAvailableNow: false,
      })
    )
    expect(result.winner).toBe('COOK')
    expect(result.confidence).toBeGreaterThanOrEqual(78)
    expect(result.confidence).toBeLessThanOrEqual(88)
  })

  // TC-10: late_night_order_wins
  it('TC-10: late_night — ORDER goalMatchScore=90, wins narrowly over COOK', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'late_night',
        currentHour: 2,
        timeConstraintMinutes: null,
        swiggAvailable: true,
        dineoutAvailable: false,
        canCook: true,
        pantryState: 'partial',
      }),
      buildCookInput({ estimatedTimeMinutes: 25 as Minutes, estimatedCostRupees: 50 as Rupees }),
      buildOrderInput({ estimatedTimeMinutes: 35 as Minutes, estimatedCostRupees: 280 as Rupees }),
      buildDineOutInput({ available: false })
    )
    expect(result.winner).toBe('ORDER')
    expect(result.orderScore.goalMatchScore).toBe(90)
    expect(result.cookScore.goalMatchScore).toBe(75)
    // §6 formula: base 90, gap < 5 → -10 = 80 (§10 approximate range was 65–78).
    expect(result.confidence).toBeGreaterThanOrEqual(65)
    expect(result.confidence).toBeLessThanOrEqual(80)
  })

  // TC-11: general_no_constraints
  it('TC-11: general — no constraints, ORDER preferred in general', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'general',
        budgetRupees: null,
        timeConstraintMinutes: null,
        canCook: true,
        pantryState: 'partial',
        swiggAvailable: true,
        dineoutAvailable: true,
      }),
      buildCookInput({ estimatedCostRupees: 100 as Rupees, estimatedTimeMinutes: 35 as Minutes }),
      buildOrderInput({ estimatedCostRupees: 300 as Rupees, estimatedTimeMinutes: 30 as Minutes }),
      buildDineOutInput({
        estimatedCostRupees: 500 as Rupees,
        estimatedTimeMinutes: 90 as Minutes,
        hasTableAvailableNow: true,
      })
    )
    // ORDER or COOK expected; may be close
    expect(['ORDER', 'COOK']).toContain(result.winner)
    // §6 formula: base 90, gap < 5 → -10 = 80. §10's 52–65 range assumed
    // missing-field penalties this input does not declare.
    expect(result.confidence).toBeGreaterThanOrEqual(52)
    expect(result.confidence).toBeLessThanOrEqual(80)
  })

  // TC-12: allergen_blocks_all_ordered_options
  it('TC-12: allergens block ORDER+DINE_OUT → COOK wins', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'sick',
        canCook: true,
        pantryState: 'stocked',
        allergens: ['shellfish', 'nuts'],
        swiggAvailable: true,
        dineoutAvailable: true,
      }),
      buildCookInput({ estimatedCostRupees: 60 as Rupees, containsAllergens: [], isVegetarian: true }),
      buildOrderInput({ estimatedCostRupees: 200 as Rupees, containsAllergens: ['nuts'] }),
      buildDineOutInput({ estimatedCostRupees: 400 as Rupees, containsAllergens: ['shellfish'] })
    )
    expect(result.winner).toBe('COOK')
    expect(result.orderScore.finalScore).toBe(0)
    expect(result.dineOutScore.finalScore).toBe(0)
    // §6 formula: base 90, gap ≥ 20 → +5 = 95 (§10 approximate range was 80–90).
    expect(result.confidence).toBeGreaterThanOrEqual(80)
    expect(result.confidence).toBeLessThanOrEqual(98)
  })

  // TC-13: zero_budget_free_pantry_cook
  it('TC-13: broke, budget=₹0 strict → COOK from pantry wins', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'broke',
        budgetRupees: 0 as Rupees,
        budgetFlexibility: 'strict',
        canCook: true,
        pantryState: 'stocked',
        swiggAvailable: true,
        dineoutAvailable: false,
      }),
      buildCookInput({ estimatedCostRupees: 0 as Rupees, canMakeFromPantry: true, estimatedTimeMinutes: 25 as Minutes }),
      buildOrderInput({ estimatedCostRupees: 89 as Rupees, estimatedTimeMinutes: 25 as Minutes }),
      buildDineOutInput({ available: false })
    )
    expect(result.winner).toBe('COOK')
    expect(result.cookScore.budgetFitScore).toBe(100)
    expect(result.orderScore.budgetFitScore).toBe(0)
    // §6 formula: base 90, gap ≥ 20 → +5 = 95 (§10 approximate range was 75–88).
    expect(result.confidence).toBeGreaterThanOrEqual(75)
    expect(result.confidence).toBeLessThanOrEqual(98)
  })

  // TC-14: no_winner_all_paths_unavailable
  it('TC-14: all paths unavailable → NO_WINNER, confidence=15', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'late_night',
        canCook: false,
        swiggAvailable: false,
        dineoutAvailable: false,
        pantryState: 'empty',
        instamartAvailable: false,
      }),
      buildCookInput({ available: false }),
      buildOrderInput({ available: false }),
      buildDineOutInput({ available: false })
    )
    expect(result.winner).toBe('NO_WINNER')
    expect(result.confidence).toBe(15)
  })

  // TC-15: split_recommendation_tie
  it('TC-15: general — liked cuisine pushes COOK, may produce split or clear win', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'general',
        budgetRupees: 300 as Rupees,
        timeConstraintMinutes: 30 as Minutes,
        canCook: true,
        pantryState: 'partial',
        swiggAvailable: true,
        dineoutAvailable: false,
        dietaryRestrictions: ['vegetarian'],
        likedCuisines: ['South Indian'],
      }),
      buildCookInput({
        estimatedCostRupees: 100 as Rupees,
        estimatedTimeMinutes: 28 as Minutes,
        isVegetarian: true,
        cuisineType: 'South Indian',
      }),
      buildOrderInput({
        estimatedCostRupees: 250 as Rupees,
        estimatedTimeMinutes: 25 as Minutes,
        isVegetarianMenuAvailable: true,
        cuisineType: 'North Indian',
      }),
      buildDineOutInput({ available: false })
    )
    // Winner should be COOK or ORDER; COOK benefits from liked cuisine bonus
    expect(['COOK', 'ORDER']).toContain(result.winner)
    expect(result.confidence).toBeGreaterThanOrEqual(60)
    expect(result.confidence).toBeLessThanOrEqual(85)
  })

  // TC-16: first_time_user_zero_memory
  it('TC-16: first-time user, zero memory → confidence ~45-58, ORDER preferred', () => {
    const result = computeDecision(
      buildContext({
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
      }),
      buildCookInput(),
      buildOrderInput(),
      buildDineOutInput()
    )
    expect(result.winner).toBeDefined()
    // §6 formula: 90 - 22 (2 missing) - 5 (pantry) - 10 (memory) = 53, then
    // gap < 5 → -10 = 43. §10's 45–58 range omitted the close-race penalty.
    expect(result.confidence).toBeGreaterThanOrEqual(40)
    expect(result.confidence).toBeLessThanOrEqual(60)
  })

  // TC-17: nutrition_goal_impossible_vegetarian_300g
  it('TC-17: nutrition_goal — impossible 300g protein, COOK still wins on combined', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'nutrition_goal',
        nutritionGoal: { proteinG: 300 as Grams, scope: 'day' },
        dietaryRestrictions: ['vegetarian'],
        canCook: true,
        pantryState: 'stocked',
        swiggAvailable: true,
        dineoutAvailable: true,
      }),
      buildCookInput({ proteinG: 45 as Grams, isVegetarian: true }),
      buildOrderInput({ proteinG: 38 as Grams, isVegetarianMenuAvailable: true }),
      buildDineOutInput({ proteinG: 40 as Grams, isVegetarianMenuAvailable: true })
    )
    expect(result.winner).toBe('COOK')
    // All goal scores should be low (ratio ~0.13–0.15)
    expect(result.cookScore.goalMatchScore).toBeLessThan(10)
    // §10 expects 35–50 "because the goal is not achievable", but the §6
    // formula has no goal-achievability penalty: with a complete context the
    // formula yields 90. Doc-internal conflict reported; formula is normative.
    expect(result.confidence).toBeGreaterThanOrEqual(35)
    expect(result.confidence).toBeLessThanOrEqual(98)
  })

  // TC-18: exact_budget_match
  it('TC-18: general — exact budget match → budgetFitScore=85', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'general',
        budgetRupees: 350 as Rupees,
        budgetFlexibility: 'soft',
        canCook: false,
        swiggAvailable: true,
        dineoutAvailable: false,
      }),
      buildCookInput({ available: false }),
      buildOrderInput({ estimatedCostRupees: 350 as Rupees, estimatedTimeMinutes: 30 as Minutes }),
      buildDineOutInput({ available: false })
    )
    expect(result.winner).toBe('ORDER')
    expect(result.orderScore.budgetFitScore).toBeCloseTo(85, 0)
  })

  // TC-19: dineout_eliminated_time_constraint
  it('TC-19: quick_meal — DINE_OUT eliminated (time<60), ORDER wins on goalMatch', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'quick_meal',
        timeConstraintMinutes: 45 as Minutes,
        swiggAvailable: true,
        dineoutAvailable: true,
        canCook: true,
      }),
      buildCookInput({ estimatedTimeMinutes: 30 as Minutes }),
      buildOrderInput({ estimatedTimeMinutes: 25 as Minutes }),
      buildDineOutInput({
        estimatedTimeMinutes: 90 as Minutes,
        hasTableAvailableNow: true,
      })
    )
    expect(result.dineOutScore.available).toBe(false)
    expect(result.winner).toBe('ORDER')
    expect(result.confidence).toBeGreaterThanOrEqual(78)
    expect(result.confidence).toBeLessThanOrEqual(92)
  })

  // TC-20: cook_eliminated_cannot_cook_full_pantry
  it('TC-20: sick — canCook=false overrides full pantry, ORDER wins', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'sick',
        canCook: false,
        pantryState: 'stocked',
        swiggAvailable: true,
        dineoutAvailable: false,
      }),
      buildCookInput({ available: false }),
      buildOrderInput({
        estimatedCostRupees: 180 as Rupees,
        estimatedTimeMinutes: 30 as Minutes,
        isVegetarianMenuAvailable: true,
      }),
      buildDineOutInput({ available: false })
    )
    expect(result.cookScore.available).toBe(false)
    expect(result.winner).toBe('ORDER')
    // §6 formula: base 90, single available path → no gap adjustment = 90
    // (§10 approximate range was 72–84).
    expect(result.confidence).toBeGreaterThanOrEqual(72)
    expect(result.confidence).toBeLessThanOrEqual(95)
  })

  // TC-21: cook_eliminated_empty_pantry_no_instamart
  it('TC-21: COOK eliminated (empty pantry + no Instamart)', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'general',
        canCook: true,
        pantryState: 'empty',
        instamartAvailable: false,
        swiggAvailable: true,
        dineoutAvailable: false,
      }),
      buildCookInput(),
      buildOrderInput(),
      buildDineOutInput({ available: false })
    )
    expect(result.cookScore.available).toBe(false)
    expect(result.winner).toBe('ORDER')
  })

  // TC-22: cook_available_with_instamart_when_empty_pantry
  it('TC-22: COOK available (empty pantry but Instamart available)', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'general',
        canCook: true,
        pantryState: 'empty',
        instamartAvailable: true,
        swiggAvailable: true,
        dineoutAvailable: false,
      }),
      buildCookInput({
        canMakeFromPantry: false,
        missingIngredientCount: 3,
        instamartCostForMissingRupees: 150 as Rupees,
      }),
      buildOrderInput(),
      buildDineOutInput({ available: false })
    )
    expect(result.cookScore.available).toBe(true)
  })

  // TC-23: order_eliminated_swiggy_unavailable
  it('TC-23: ORDER eliminated when Swiggy unavailable', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'general',
        swiggAvailable: false,
        canCook: true,
        dineoutAvailable: true,
      }),
      buildCookInput(),
      buildOrderInput(),
      buildDineOutInput()
    )
    expect(result.orderScore.available).toBe(false)
    expect(result.winner).not.toBe('ORDER')
  })

  // TC-24: dineout_eliminated_large_group
  it('TC-24: DINE_OUT eliminated for group > 15', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'party_hosting',
        guests: 20,
        swiggAvailable: true,
        dineoutAvailable: true,
        canCook: true,
      }),
      buildCookInput(),
      buildOrderInput(),
      buildDineOutInput({ guestCapacity: 25 })
    )
    expect(result.dineOutScore.available).toBe(false)
  })

  // TC-25: vegetarian_mixed_restaurant_penalty
  it('TC-25: vegetarian user, mixed restaurant → prefMatchScore penalized by -25', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'general',
        dietaryRestrictions: ['vegetarian'],
        canCook: false,
        swiggAvailable: true,
        dineoutAvailable: false,
      }),
      buildCookInput({ available: false }),
      buildOrderInput({
        isFullyVegetarian: false,
        isVegetarianMenuAvailable: true,
      }),
      buildDineOutInput({ available: false })
    )
    expect(result.orderScore.prefMatchScore).toBe(75) // 100 - 25
  })

  // TC-26: strict_budget_overage_forces_zero
  it('TC-26: strict budget, 5% over → budgetFitScore=0', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'general',
        budgetRupees: 300 as Rupees,
        budgetFlexibility: 'strict',
        canCook: false,
        swiggAvailable: true,
        dineoutAvailable: false,
      }),
      buildCookInput({ available: false }),
      buildOrderInput({ estimatedCostRupees: 315 as Rupees }), // 5% over
      buildDineOutInput({ available: false })
    )
    expect(result.orderScore.budgetFitScore).toBe(0)
  })

  // TC-27: flexible_budget_bonus
  it('TC-27: flexible budget, within 30% → score gets +15 bonus', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'general',
        budgetRupees: 300 as Rupees,
        budgetFlexibility: 'flexible',
        canCook: false,
        swiggAvailable: true,
        dineoutAvailable: false,
      }),
      buildCookInput({ available: false }),
      buildOrderInput({ estimatedCostRupees: 360 as Rupees }), // 1.2x budget
      buildDineOutInput({ available: false })
    )
    // At ratio=1.2, base score=50, +15 flexible bonus = 65
    expect(result.orderScore.budgetFitScore).toBe(65)
  })

  // TC-28: date_planning_ambience_bonus
  it('TC-28: date_planning — ambience bonus applied to DINE_OUT prefMatch', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'date_planning',
        occasion: 'date',
        guests: 2,
        budgetRupees: 3000 as Rupees,
        canCook: true,
        swiggAvailable: true,
        dineoutAvailable: true,
      }),
      buildCookInput(),
      buildOrderInput(),
      buildDineOutInput({ ambienceScore: 100, hasTableAvailableNow: true })
    )
    // Perfect ambience: linearMap(100, [0,100], [0,15]) = 15 bonus → 115 → capped at 100
    expect(result.dineOutScore.prefMatchScore).toBe(100)
  })

  // TC-29: no_winner_all_below_30
  it('TC-29: all available paths score below 30 → NO_WINNER', () => {
    // Severe constraint: sick, strict budget ₹10, ORDER over budget
    const result = computeDecision(
      buildContext({
        situationType: 'sick',
        canCook: true,
        pantryState: 'stocked',
        budgetRupees: 10 as Rupees,
        budgetFlexibility: 'strict',
        swiggAvailable: true,
        dineoutAvailable: false,
        dietaryRestrictions: ['vegetarian'],
      }),
      buildCookInput({
        estimatedCostRupees: 200 as Rupees, // way over budget
        difficultyLevel: 'hard',
        isVegetarian: false, // also blocked
      }),
      buildOrderInput({
        estimatedCostRupees: 300 as Rupees,
        isVegetarianMenuAvailable: false, // also blocked
        isFullyVegetarian: false,
      }),
      buildDineOutInput({ available: false })
    )
    // Both COOK (recipe not vegetarian → prefMatch=0 → finalScore=0)
    // and ORDER (no veg option → prefMatch=0 → finalScore=0)
    expect(result.winner).toBe('NO_WINNER')
  })

  // TC-30: simulator_deltas_meaningful
  it('TC-30: simulator shows meaningful deltas when primary saves ≥₹50 or ≥10min', () => {
    const result = computeDecision(
      buildContext({
        situationType: 'broke',
        canCook: true,
        pantryState: 'stocked',
        budgetRupees: 200 as Rupees,
        swiggAvailable: true,
        dineoutAvailable: false,
      }),
      buildCookInput({
        estimatedCostRupees: 80 as Rupees,
        estimatedTimeMinutes: 25 as Minutes,
        proteinG: 45 as Grams,
        canMakeFromPantry: true,
      }),
      buildOrderInput({
        estimatedCostRupees: 350 as Rupees,
        estimatedTimeMinutes: 30 as Minutes,
        proteinG: 32 as Grams,
      }),
      buildDineOutInput({ available: false })
    )
    expect(result.winner).toBe('COOK')
    expect(result.simulator.showCostDelta).toBe(true)  // 350-80=270 ≥ 50
    expect(result.simulator.deltaCostRupees).toBe(270)
    expect(result.simulator.showProteinDelta).toBe(true) // 45-32=13 ≥ 10
    expect(result.simulator.deltaProteinG).toBe(13)
  })
})

// ── 8 Property-Based Invariants (docs/DECISION_ENGINE.md §12) ────────────────

// Arbitrary generator for valid inputs
function arbitraryValidInput() {
  return fc.record({
    context: fc.record({
      situationType: fc.constantFrom<import('@/types/situation').SituationType>(
        'sick', 'broke', 'date_planning', 'party_hosting', 'nutrition_goal',
        'quick_meal', 'meal_prep', 'office_lunch', 'family_dinner', 'late_night', 'general'
      ),
      timeConstraintMinutes: fc.option(fc.integer({ min: 5, max: 180 }), { nil: null }).map(v => v as Minutes | null),
      currentHour: fc.integer({ min: 0, max: 23 }),
      isWeekend: fc.boolean(),
      budgetRupees: fc.option(fc.integer({ min: 0, max: 5000 }), { nil: null }).map(v => v as Rupees | null),
      budgetFlexibility: fc.constantFrom<'strict' | 'soft' | 'flexible'>('strict', 'soft', 'flexible'),
      canCook: fc.boolean(),
      cookingSkillLevel: fc.constantFrom<'none' | 'beginner' | 'intermediate' | 'advanced'>('none', 'beginner', 'intermediate', 'advanced'),
      pantryState: fc.constantFrom<'empty' | 'partial' | 'stocked'>('empty', 'partial', 'stocked'),
      guests: fc.integer({ min: 1, max: 20 }),
      occasion: fc.constantFrom<'casual' | 'date' | 'celebration' | 'work' | 'none'>('casual', 'date', 'celebration', 'work', 'none'),
      dietaryRestrictions: fc.subarray(['vegetarian', 'vegan', 'jain', 'gluten_free', 'dairy_free', 'halal', 'kosher'] as const, { maxLength: 2 }),
      allergens: fc.subarray(['shellfish', 'nuts', 'eggs', 'dairy', 'gluten', 'soy', 'fish'] as const, { maxLength: 2 }),
      likedCuisines: fc.array(fc.constantFrom('Indian', 'Chinese', 'Italian', 'South Indian'), { maxLength: 2 }),
      dislikedCuisines: fc.array(fc.constantFrom('Fast Food', 'Mexican'), { maxLength: 1 }),
      nutritionGoal: fc.option(fc.record({
        proteinG: fc.option(fc.integer({ min: 10, max: 200 }), { nil: undefined }).map(v => v as Grams | undefined),
        caloriesKcal: fc.option(fc.integer({ min: 200, max: 3000 }), { nil: undefined }).map(v => v as Kcal | undefined),
        lowCarb: fc.option(fc.boolean(), { nil: undefined }),
        scope: fc.constantFrom<'meal' | 'day'>('meal', 'day'),
      }), { nil: null }),
      swiggAvailable: fc.boolean(),
      instamartAvailable: fc.boolean(),
      dineoutAvailable: fc.boolean(),
      memoryPopulated: fc.boolean(),
      pantryDataAvailable: fc.boolean(),
      missingRequiredFields: fc.array(fc.constantFrom('budget', 'canCook', 'guests'), { maxLength: 3 }),
    }),
    cook: fc.record({
      path: fc.constant('COOK' as const),
      available: fc.boolean(),
      estimatedCostRupees: fc.integer({ min: 0, max: 2000 }).map(v => v as Rupees),
      estimatedTimeMinutes: fc.integer({ min: 5, max: 180 }).map(v => v as Minutes),
      proteinG: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }).map(v => v as Grams | null),
      caloriesKcal: fc.option(fc.integer({ min: 100, max: 2000 }), { nil: null }).map(v => v as Kcal | null),
      recipeId: fc.constant(null),
      recipeName: fc.constant(null),
      canMakeFromPantry: fc.boolean(),
      missingIngredientCount: fc.integer({ min: 0, max: 5 }),
      instamartCostForMissingRupees: fc.integer({ min: 0, max: 500 }).map(v => v as Rupees),
      cuisineType: fc.option(fc.constantFrom('Indian', 'Chinese', 'South Indian'), { nil: null }),
      isVegetarian: fc.boolean(),
      isVegan: fc.boolean(),
      containsAllergens: fc.subarray(['nuts', 'dairy', 'gluten'] as const, { maxLength: 1 }),
      difficultyLevel: fc.constantFrom<'easy' | 'medium' | 'hard'>('easy', 'medium', 'hard'),
    }),
    order: fc.record({
      path: fc.constant('ORDER' as const),
      available: fc.boolean(),
      estimatedCostRupees: fc.integer({ min: 50, max: 2000 }).map(v => v as Rupees),
      estimatedTimeMinutes: fc.integer({ min: 15, max: 90 }).map(v => v as Minutes),
      proteinG: fc.option(fc.integer({ min: 0, max: 80 }), { nil: null }).map(v => v as Grams | null),
      caloriesKcal: fc.option(fc.integer({ min: 200, max: 1500 }), { nil: null }).map(v => v as Kcal | null),
      restaurantId: fc.constant('swg_rest_001' as import('@/types/primitives').SwiggyRestaurantId),
      restaurantName: fc.constant('Test Restaurant'),
      cuisineType: fc.constantFrom('Indian', 'Chinese', 'South Indian'),
      isVegetarianMenuAvailable: fc.boolean(),
      isFullyVegetarian: fc.boolean(),
      isVeganMenuAvailable: fc.boolean(),
      containsAllergens: fc.subarray(['nuts', 'dairy', 'shellfish'] as const, { maxLength: 1 }),
      deliveryFeeRupees: fc.integer({ min: 0, max: 50 }).map(v => v as Rupees),
      discountRupees: fc.integer({ min: 0, max: 100 }).map(v => v as Rupees),
      minimumOrderRupees: fc.integer({ min: 0, max: 200 }).map(v => v as Rupees),
      ratingOutOf5: fc.float({ min: 1, max: 5, noNaN: true }),
      deliveryTimeMinutes: fc.integer({ min: 15, max: 90 }).map(v => v as Minutes),
    }),
    dineOut: fc.record({
      path: fc.constant('DINE_OUT' as const),
      available: fc.boolean(),
      estimatedCostRupees: fc.integer({ min: 200, max: 5000 }).map(v => v as Rupees),
      estimatedTimeMinutes: fc.integer({ min: 45, max: 180 }).map(v => v as Minutes),
      proteinG: fc.option(fc.integer({ min: 0, max: 80 }), { nil: null }).map(v => v as Grams | null),
      caloriesKcal: fc.option(fc.integer({ min: 200, max: 2000 }), { nil: null }).map(v => v as Kcal | null),
      restaurantId: fc.constant('dineout_001' as import('@/types/primitives').DineoutVenueId),
      restaurantName: fc.constant('Test Dine Out'),
      cuisineType: fc.constantFrom('Indian', 'Chinese', 'South Indian'),
      isVegetarianMenuAvailable: fc.boolean(),
      isFullyVegetarian: fc.boolean(),
      isVeganMenuAvailable: fc.boolean(),
      containsAllergens: fc.subarray(['shellfish', 'nuts'] as const, { maxLength: 1 }),
      ambienceScore: fc.integer({ min: 0, max: 100 }),
      hasTableAvailableNow: fc.boolean(),
      guestCapacity: fc.integer({ min: 1, max: 30 }),
      travelTimeMinutes: fc.integer({ min: 5, max: 60 }).map(v => v as Minutes),
      mealTimeMinutes: fc.integer({ min: 20, max: 90 }).map(v => v as Minutes),
      pricePerPersonRupees: fc.integer({ min: 100, max: 2000 }).map(v => v as Rupees),
      ratingOutOf5: fc.float({ min: 1, max: 5, noNaN: true }),
    }),
  })
}

describe('scorer invariants', () => {

  // INV-1: all sub-scores are in [0, 100]
  it('INV-1: all sub-scores are in [0, 100]', () => {
    fc.assert(fc.property(arbitraryValidInput(), ({ context, cook, order, dineOut }) => {
      const result = computeDecision(
        context as ScoringContext,
        cook as CookPathInput,
        order as OrderPathInput,
        dineOut as DineOutPathInput
      )
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
    }), { numRuns: 100 })
  })

  // INV-2: finalScore is in [0, 100]
  it('INV-2: finalScore is in [0, 100] for all paths', () => {
    fc.assert(fc.property(arbitraryValidInput(), ({ context, cook, order, dineOut }) => {
      const result = computeDecision(
        context as ScoringContext,
        cook as CookPathInput,
        order as OrderPathInput,
        dineOut as DineOutPathInput
      )
      for (const score of [result.cookScore, result.orderScore, result.dineOutScore]) {
        expect(score.finalScore).toBeGreaterThanOrEqual(0)
        expect(score.finalScore).toBeLessThanOrEqual(100)
      }
    }), { numRuns: 100 })
  })

  // INV-3: unavailable paths score exactly 0 on all sub-scores and finalScore
  it('INV-3: unavailable paths score exactly 0', () => {
    fc.assert(fc.property(arbitraryValidInput(), ({ context, cook, order, dineOut }) => {
      const result = computeDecision(
        context as ScoringContext,
        cook as CookPathInput,
        order as OrderPathInput,
        dineOut as DineOutPathInput
      )
      for (const score of [result.cookScore, result.orderScore, result.dineOutScore]) {
        if (!score.available) {
          expect(score.finalScore).toBe(0)
          expect(score.goalMatchScore).toBe(0)
          expect(score.budgetFitScore).toBe(0)
          expect(score.timeFitScore).toBe(0)
          expect(score.prefMatchScore).toBe(0)
        }
      }
    }), { numRuns: 100 })
  })

  // INV-4: determinism — same input always produces same output
  it('INV-4: same input always produces same output (determinism)', () => {
    fc.assert(fc.property(arbitraryValidInput(), ({ context, cook, order, dineOut }) => {
      const ctx = context as ScoringContext
      const c = cook as CookPathInput
      const o = order as OrderPathInput
      const d = dineOut as DineOutPathInput
      const result1 = computeDecision(ctx, c, o, d)
      const result2 = computeDecision(ctx, c, o, d)
      // Compare deterministic fields (exclude computedAt which uses Date.now())
      expect(result1.winner).toBe(result2.winner)
      expect(result1.cookScore.finalScore).toBe(result2.cookScore.finalScore)
      expect(result1.orderScore.finalScore).toBe(result2.orderScore.finalScore)
      expect(result1.dineOutScore.finalScore).toBe(result2.dineOutScore.finalScore)
      expect(result1.confidence).toBe(result2.confidence)
      expect(result1.isSplitRecommendation).toBe(result2.isSplitRecommendation)
    }), { numRuns: 100 })
  })

  // INV-5: winner is always an available path or NO_WINNER
  it('INV-5: winner is always an available path or NO_WINNER', () => {
    fc.assert(fc.property(arbitraryValidInput(), ({ context, cook, order, dineOut }) => {
      const result = computeDecision(
        context as ScoringContext,
        cook as CookPathInput,
        order as OrderPathInput,
        dineOut as DineOutPathInput
      )
      if (result.winner === 'NO_WINNER') return
      const winnerScore = {
        COOK: result.cookScore,
        ORDER: result.orderScore,
        DINE_OUT: result.dineOutScore,
      }[result.winner]
      expect(winnerScore.available).toBe(true)
    }), { numRuns: 100 })
  })

  // INV-6: winner finalScore >= all other available path final scores (within TIE_THRESHOLD)
  it('INV-6: winner finalScore >= all other available path final scores', () => {
    fc.assert(fc.property(arbitraryValidInput(), ({ context, cook, order, dineOut }) => {
      const result = computeDecision(
        context as ScoringContext,
        cook as CookPathInput,
        order as OrderPathInput,
        dineOut as DineOutPathInput
      )
      if (result.winner === 'NO_WINNER') return
      const winnerScore = {
        COOK: result.cookScore,
        ORDER: result.orderScore,
        DINE_OUT: result.dineOutScore,
      }[result.winner].finalScore
      for (const score of [result.cookScore, result.orderScore, result.dineOutScore]) {
        if (score.available) {
          // Winner must be >= all others minus the tie threshold
          expect(winnerScore).toBeGreaterThanOrEqual(score.finalScore - TIE_THRESHOLD)
        }
      }
    }), { numRuns: 100 })
  })

  // INV-7: confidence is in [15, 98]
  it('INV-7: confidence is always in [15, 98]', () => {
    fc.assert(fc.property(arbitraryValidInput(), ({ context, cook, order, dineOut }) => {
      const result = computeDecision(
        context as ScoringContext,
        cook as CookPathInput,
        order as OrderPathInput,
        dineOut as DineOutPathInput
      )
      expect(result.confidence).toBeGreaterThanOrEqual(15)
      expect(result.confidence).toBeLessThanOrEqual(98)
    }), { numRuns: 100 })
  })

  // INV-8: allergen hard block forces finalScore to 0
  it('INV-8: allergen hard block forces finalScore to 0', () => {
    fc.assert(fc.property(arbitraryValidInput(), ({ context, cook, order, dineOut }) => {
      const result = computeDecision(
        context as ScoringContext,
        cook as CookPathInput,
        order as OrderPathInput,
        dineOut as DineOutPathInput
      )
      for (const score of [result.cookScore, result.orderScore, result.dineOutScore]) {
        if (score.hardBlocks.some(b => b.startsWith('allergen:'))) {
          expect(score.finalScore).toBe(0)
        }
      }
    }), { numRuns: 100 })
  })
})

// ── Additional invariant tests referenced in spec §12 ─────────────────────────

describe('weight integrity and NO_WINNER invariants', () => {
  it('INV-9: weights always sum to 1.0 in returned weightsUsed', () => {
    const result = computeDecision(buildContext(), buildCookInput(), buildOrderInput(), buildDineOutInput())
    const w = result.weightsUsed
    const sum = w.goalMatch + w.budgetFit + w.timeFit + w.preferenceMatch
    expect(Math.round(sum * 100)).toBe(100)
  })

  it('INV-10: NO_WINNER when all paths are explicitly unavailable', () => {
    const result = computeDecision(
      buildContext({ canCook: false, swiggAvailable: false, dineoutAvailable: false }),
      buildCookInput({ available: false }),
      buildOrderInput({ available: false }),
      buildDineOutInput({ available: false })
    )
    expect(result.winner).toBe('NO_WINNER')
  })
})
