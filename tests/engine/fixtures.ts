/**
 * MealOS AI — Engine Test Fixtures
 *
 * Builder functions with sensible defaults and Partial<> overrides.
 * Source: docs/DECISION_ENGINE.md §12
 */

import type {
  ScoringContext,
  CookPathInput,
  OrderPathInput,
  DineOutPathInput,
} from '@/types/situation'
import type { Rupees, Minutes, Grams, Kcal } from '@/types/primitives'
import type { SwiggyRestaurantId, DineoutVenueId } from '@/types/primitives'

export function buildContext(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return {
    situationType: 'general',
    timeConstraintMinutes: null,
    currentHour: 12,
    isWeekend: false,
    budgetRupees: 300 as Rupees,
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

export function buildCookInput(overrides: Partial<CookPathInput> = {}): CookPathInput {
  return {
    path: 'COOK',
    available: true,
    estimatedCostRupees: 100 as Rupees,
    estimatedTimeMinutes: 30 as Minutes,
    proteinG: 25 as Grams,
    caloriesKcal: 450 as Kcal,
    recipeId: null,
    recipeName: null,
    canMakeFromPantry: true,
    missingIngredientCount: 0,
    instamartCostForMissingRupees: 0 as Rupees,
    cuisineType: 'Indian',
    isVegetarian: true,
    isVegan: false,
    containsAllergens: [],
    difficultyLevel: 'easy',
    ...overrides,
  }
}

export function buildOrderInput(overrides: Partial<OrderPathInput> = {}): OrderPathInput {
  return {
    path: 'ORDER',
    available: true,
    estimatedCostRupees: 280 as Rupees,
    estimatedTimeMinutes: 35 as Minutes,
    proteinG: 22 as Grams,
    caloriesKcal: 520 as Kcal,
    restaurantId: 'swg_rest_001' as SwiggyRestaurantId,
    restaurantName: 'Test Restaurant',
    cuisineType: 'Indian',
    isVegetarianMenuAvailable: true,
    isFullyVegetarian: false,
    isVeganMenuAvailable: false,
    containsAllergens: [],
    deliveryFeeRupees: 30 as Rupees,
    discountRupees: 0 as Rupees,
    minimumOrderRupees: 149 as Rupees,
    ratingOutOf5: 4.2,
    deliveryTimeMinutes: 35 as Minutes,
    ...overrides,
  }
}

export function buildDineOutInput(overrides: Partial<DineOutPathInput> = {}): DineOutPathInput {
  return {
    path: 'DINE_OUT',
    available: true,
    estimatedCostRupees: 600 as Rupees,
    estimatedTimeMinutes: 90 as Minutes,
    proteinG: 30 as Grams,
    caloriesKcal: 600 as Kcal,
    restaurantId: 'dineout_001' as DineoutVenueId,
    restaurantName: 'Test Dine-Out Restaurant',
    cuisineType: 'Indian',
    isVegetarianMenuAvailable: true,
    isFullyVegetarian: false,
    isVeganMenuAvailable: false,
    containsAllergens: [],
    ambienceScore: 70,
    hasTableAvailableNow: true,
    guestCapacity: 20,
    travelTimeMinutes: 20 as Minutes,
    mealTimeMinutes: 55 as Minutes,
    pricePerPersonRupees: 600 as Rupees,
    ratingOutOf5: 4.0,
    ...overrides,
  }
}
