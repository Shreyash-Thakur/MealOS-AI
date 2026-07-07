/**
 * MealOS AI — Path Availability Rules
 *
 * Source of truth: docs/DECISION_ENGINE.md §5
 *
 * Availability is determined BEFORE scoring begins.
 * Eliminated paths receive available=false and are never scored.
 * Checks run in the listed order; once eliminated, no further checks apply.
 */

import type {
  ScoringContext,
  CookPathInput,
  OrderPathInput,
  DineOutPathInput,
} from '@/types/situation'

export interface AvailabilityResult {
  cook: boolean
  order: boolean
  dineOut: boolean
  cookReason: string | null
  orderReason: string | null
  dineOutReason: string | null
}

/**
 * Determines which paths are available before scoring.
 * Source: docs/DECISION_ENGINE.md §5
 */
export function determineAvailability(
  context: ScoringContext,
  cookInput: CookPathInput,
  orderInput: OrderPathInput,
  dineOutInput: DineOutPathInput
): AvailabilityResult {
  // COOK availability
  let cook: boolean
  let cookReason: string | null = null

  if (!context.canCook) {
    cook = false
    cookReason = 'cannot_cook'
  } else if (context.pantryState === 'empty' && !context.instamartAvailable) {
    cook = false
    cookReason = 'no_ingredients_and_no_instamart'
  } else {
    // Also honor the explicit available flag on the input
    cook = cookInput.available
    if (!cook) cookReason = 'cook_input_unavailable'
  }

  // ORDER availability
  let order: boolean
  let orderReason: string | null = null

  if (!context.swiggAvailable) {
    order = false
    orderReason = 'swiggy_unavailable'
  } else {
    order = orderInput.available
    if (!order) orderReason = 'order_input_unavailable'
  }

  // DINE_OUT availability
  let dineOut: boolean
  let dineOutReason: string | null = null

  if (context.guests > 15) {
    dineOut = false
    dineOutReason = 'group_too_large'
  } else if (
    context.timeConstraintMinutes !== null &&
    context.timeConstraintMinutes < 60
  ) {
    dineOut = false
    dineOutReason = 'insufficient_time'
  } else if (!context.dineoutAvailable) {
    dineOut = false
    dineOutReason = 'dineout_unavailable'
  } else {
    dineOut = dineOutInput.available
    if (!dineOut) dineOutReason = 'dineout_input_unavailable'
  }

  return { cook, order, dineOut, cookReason, orderReason, dineOutReason }
}
