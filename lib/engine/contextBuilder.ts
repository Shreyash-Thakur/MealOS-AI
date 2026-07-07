/**
 * lib/engine/contextBuilder.ts
 * MealOS AI — Converts orchestrator runtime data → Decision Engine inputs
 *
 * The Decision Engine is a pure function of (ScoringContext, CookPathInput,
 * OrderPathInput, DineOutPathInput). This module builds those four shapes from:
 *   - SituationContext   (post-clarification, memory-merged)
 *   - ToolAgentOutputValidated (Swiggy + YouTube results)
 *   - PantryItem[]       (from DB, used for pantry-state signal)
 *
 * V1 simplifications (marked V1):
 *   - Nutrition fields (proteinG, caloriesKcal) are always null — not
 *     calculable from the Swiggy/pantry data we have in V1.
 *   - Cook cost/time are heuristic estimates based on pantry state.
 *   - currentHour is always 12 (noon) for scoring; temporal scoring is done
 *     via the `timeOfDay` field from InferredContext, not the actual clock.
 *     (A future version derives it from the ISO timestamp passed in.)
 */

import type {
  SituationContext,
  ScoringContext,
  CookPathInput,
  OrderPathInput,
  DineOutPathInput,
  DietaryRestriction,
  Allergen,
} from '@/types/situation'
import type { ToolAgentOutputValidated } from '@/lib/schemas/agents'
import type { Rupees, Minutes, Grams, Kcal } from '@/types/primitives'

// ── Pantry state ──────────────────────────────────────────────────────────────

/**
 * Maps a pantry item count to the coarse pantry-state enum the scorer consumes.
 * 0 = empty; 1–9 = partial; ≥10 = stocked.
 */
export function pantryStateFromCount(
  count: number,
): 'empty' | 'partial' | 'stocked' {
  if (count === 0) return 'empty'
  if (count < 10) return 'partial'
  return 'stocked'
}

// ── Diet / allergen mapping ───────────────────────────────────────────────────

const DIET_TO_RESTRICTION: Partial<Record<string, DietaryRestriction>> = {
  vegetarian: 'vegetarian',
  vegan: 'vegan',
  jain: 'jain',
  gluten_free: 'gluten_free',
  dairy_free: 'dairy_free',
  halal: 'halal',
  kosher: 'kosher',
}

const KNOWN_ALLERGENS = new Set<string>([
  'shellfish', 'nuts', 'eggs', 'dairy', 'gluten', 'soy', 'fish',
])

function toAllergens(raw: string[] | undefined): Allergen[] {
  if (!raw) return []
  return raw.filter((a): a is Allergen => KNOWN_ALLERGENS.has(a))
}

// ── ScoringContext ────────────────────────────────────────────────────────────

/**
 * Builds the flat ScoringContext the Decision Engine needs from the
 * post-clarification SituationContext and the Tool Agent's results.
 */
export function buildScoringContext(
  ctx: SituationContext,
  tool: ToolAgentOutputValidated,
  pantryItems: { id: string }[],
): ScoringContext {
  const { explicit, inferred, fromMemory } = ctx

  const budgetRupees =
    explicit.budget !== undefined
      ? (explicit.budget as unknown as number)
      : fromMemory.budget !== undefined
        ? (fromMemory.budget as unknown as number)
        : null

  const canCook = explicit.canCook ?? true

  const guests =
    explicit.guests !== undefined
      ? (explicit.guests as unknown as number)
      : explicit.alone
        ? 1
        : 1 // default: alone

  const dietRestriction = fromMemory.dietType
    ? DIET_TO_RESTRICTION[fromMemory.dietType] ?? undefined
    : undefined
  const dietaryRestrictions: DietaryRestriction[] = dietRestriction ? [dietRestriction] : []

  const allergens = toAllergens(fromMemory.allergies)

  const pantryState = pantryStateFromCount(pantryItems.length)

  // Swiggy is "available" when at least one restaurant was returned
  const hasRestaurants = (tool.restaurants?.length ?? 0) > 0
  const hasSwiggyError = tool.swiggyError === 'SWIGGY_UNAVAILABLE'
  const swiggAvailable = !hasSwiggyError && (hasRestaurants || tool.restaurants === null
    ? !hasSwiggyError  // null = tool failed; treat as unavailable
    : false)

  // More precise: available if restaurants were returned successfully
  const swiggAvailableResolved = hasRestaurants

  const hasDineout = (tool.dineoutVenues?.length ?? 0) > 0
  const dineoutAvailable = hasDineout

  const instamartAvailable = tool.instamartItems !== null

  const timeConstraintMinutes =
    explicit.timeConstraintMinutes !== undefined
      ? (explicit.timeConstraintMinutes as unknown as number)
      : null

  const cookingSkillLevel = (() => {
    switch (fromMemory.cookingSkill) {
      case 'beginner':      return 'beginner'
      case 'intermediate':  return 'intermediate'
      case 'advanced':      return 'advanced'
      default:              return 'beginner'
    }
  })()

  const memoryPopulated =
    (fromMemory.dietType !== undefined || fromMemory.budget !== undefined)

  return {
    situationType: ctx.situationType,
    timeConstraintMinutes: timeConstraintMinutes as Minutes | null,
    currentHour: 12, // V1: heuristic (noon); real derivation needs the ISO timestamp
    isWeekend: inferred.isWeekend ?? false,
    budgetRupees: budgetRupees as Rupees | null,
    budgetFlexibility: 'soft',
    canCook,
    cookingSkillLevel,
    pantryState,
    guests,
    occasion: 'none',
    dietaryRestrictions,
    allergens,
    likedCuisines: fromMemory.preferredCuisines ?? [],
    dislikedCuisines: [],
    nutritionGoal: null,
    swiggAvailable: swiggAvailableResolved,
    instamartAvailable,
    dineoutAvailable,
    memoryPopulated,
    pantryDataAvailable: pantryItems.length > 0,
    missingRequiredFields: [],
  }
}

// ── Path inputs ───────────────────────────────────────────────────────────────

const NULL_NUTRITION = { proteinG: null as Grams | null, caloriesKcal: null as Kcal | null }

/**
 * Builds the three PathInput shapes from the tool results and context.
 * The Decision Engine needs all three regardless of availability — unavailable
 * paths receive `available: false` and are zeroed out during scoring.
 */
export function buildPathInputs(
  ctx: SituationContext,
  tool: ToolAgentOutputValidated,
  pantryItems: { id: string }[],
): { cook: CookPathInput; order: OrderPathInput; dineOut: DineOutPathInput } {
  const canCook = ctx.explicit.canCook ?? true
  const pantryState = pantryStateFromCount(pantryItems.length)

  // ── COOK ──────────────────────────────────────────────────────────────────
  const cookCost = pantryState === 'stocked' ? 80 : pantryState === 'partial' ? 150 : 200
  const cook: CookPathInput = {
    path: 'COOK',
    available: canCook,
    estimatedCostRupees: cookCost as Rupees,
    estimatedTimeMinutes: 30 as Minutes,
    ...NULL_NUTRITION,
    recipeId: null,
    recipeName: null,
    canMakeFromPantry: pantryState === 'stocked',
    missingIngredientCount: pantryState === 'stocked' ? 0 : 3,
    instamartCostForMissingRupees: pantryState === 'stocked' ? 0 as Rupees : 120 as Rupees,
    cuisineType: null,
    isVegetarian: ctx.fromMemory.dietType === 'vegetarian' || ctx.fromMemory.dietType === 'vegan',
    isVegan: ctx.fromMemory.dietType === 'vegan',
    containsAllergens: [],
    difficultyLevel: 'easy',
  }

  // ── ORDER ─────────────────────────────────────────────────────────────────
  const topRestaurant = (tool.restaurants && tool.restaurants.length > 0)
    ? tool.restaurants[0]
    : null

  const order: OrderPathInput = topRestaurant
    ? {
        path: 'ORDER',
        available: true,
        estimatedCostRupees: (topRestaurant.minOrderValue ?? 200) as Rupees,
        estimatedTimeMinutes: topRestaurant.deliveryTimeMin as Minutes,
        ...NULL_NUTRITION,
        restaurantId: topRestaurant.restaurantId as never,
        restaurantName: topRestaurant.name,
        cuisineType: topRestaurant.cuisineTypes?.[0] ?? 'general',
        isVegetarianMenuAvailable: true,
        isFullyVegetarian: false,
        isVeganMenuAvailable: false,
        containsAllergens: [],
        deliveryFeeRupees: topRestaurant.deliveryFee as Rupees,
        discountRupees: 0 as Rupees,
        minimumOrderRupees: topRestaurant.minOrderValue as Rupees,
        ratingOutOf5: topRestaurant.rating,
        deliveryTimeMinutes: topRestaurant.deliveryTimeMin as Minutes,
      }
    : {
        path: 'ORDER',
        available: false,
        estimatedCostRupees: 200 as Rupees,
        estimatedTimeMinutes: 30 as Minutes,
        ...NULL_NUTRITION,
        restaurantId: 'none' as never,
        restaurantName: '',
        cuisineType: 'general',
        isVegetarianMenuAvailable: false,
        isFullyVegetarian: false,
        isVeganMenuAvailable: false,
        containsAllergens: [],
        deliveryFeeRupees: 0 as Rupees,
        discountRupees: 0 as Rupees,
        minimumOrderRupees: 0 as Rupees,
        ratingOutOf5: 0,
        deliveryTimeMinutes: 0 as Minutes,
      }

  // ── DINE_OUT ──────────────────────────────────────────────────────────────
  const topVenue = (tool.dineoutVenues && tool.dineoutVenues.length > 0)
    ? tool.dineoutVenues[0]
    : null

  const guests = ctx.explicit.guests !== undefined
    ? (ctx.explicit.guests as unknown as number)
    : ctx.explicit.alone ? 1 : 1

  const dineOut: DineOutPathInput = topVenue
    ? {
        path: 'DINE_OUT',
        available: true,
        estimatedCostRupees: ((topVenue.pricePerPerson as unknown as number) * guests) as Rupees,
        estimatedTimeMinutes: 90 as Minutes,
        ...NULL_NUTRITION,
        restaurantId: topVenue.venueId as never,
        restaurantName: topVenue.name,
        cuisineType: topVenue.cuisineTypes?.[0] ?? 'general',
        isVegetarianMenuAvailable: true,
        isFullyVegetarian: false,
        isVeganMenuAvailable: false,
        containsAllergens: [],
        ambienceScore: 70,
        hasTableAvailableNow: topVenue.availableSlots.length > 0,
        guestCapacity: 6, // V1: DineoutVenue has no maxPartySize; use conservative default
        travelTimeMinutes: Math.round((topVenue.distanceKm ?? 3) * 5) as Minutes,
        mealTimeMinutes: 60 as Minutes,
        pricePerPersonRupees: topVenue.pricePerPerson as Rupees,
        ratingOutOf5: topVenue.rating as unknown as number,
      }
    : {
        path: 'DINE_OUT',
        available: false,
        estimatedCostRupees: 600 as Rupees,
        estimatedTimeMinutes: 90 as Minutes,
        ...NULL_NUTRITION,
        restaurantId: 'none' as never,
        restaurantName: '',
        cuisineType: 'general',
        isVegetarianMenuAvailable: false,
        isFullyVegetarian: false,
        isVeganMenuAvailable: false,
        containsAllergens: [],
        ambienceScore: 0,
        hasTableAvailableNow: false,
        guestCapacity: 0,
        travelTimeMinutes: 0 as Minutes,
        mealTimeMinutes: 0 as Minutes,
        pricePerPersonRupees: 0 as Rupees,
        ratingOutOf5: 0,
      }

  return { cook, order, dineOut }
}
