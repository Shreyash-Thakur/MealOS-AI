/**
 * MealOS AI — Type Library Barrel
 * Re-exports every type from the domain modules.
 * Downstream consumers: import { SituationContext } from '@/types'
 * or the specific module: import { SituationContext } from '@/types/situation'
 */

export * from './primitives'
export * from './memory'
export * from './situation'
export * from './recommendation'
export * from './swiggy'
export * from './agents'
