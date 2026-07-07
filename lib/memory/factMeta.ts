/**
 * lib/memory/factMeta.ts
 * Display metadata for each canonical FactKey.
 * Used by GET /api/v1/memory to build MemoryFactView display fields.
 */

import type { FactKey, FactType } from '@/types/memory'

export interface FactMeta {
  label: string
  category: string
  factType: FactType
}

export const FACT_META: Record<FactKey, FactMeta> = {
  'dietary.restrictions':          { label: 'Dietary restrictions',    category: 'Dietary',       factType: 'array'   },
  'dietary.allergies':             { label: 'Allergies',               category: 'Dietary',       factType: 'array'   },
  'budget.daily_food_target':      { label: 'Daily food budget',       category: 'Budget',        factType: 'number'  },
  'budget.dining_out_budget':      { label: 'Dining out budget',       category: 'Budget',        factType: 'number'  },
  'location.home':                 { label: 'Home address',            category: 'Location',      factType: 'string'  },
  'location.work':                 { label: 'Work address',            category: 'Location',      factType: 'string'  },
  'kitchen.skill_level':           { label: 'Cooking skill',           category: 'Kitchen',       factType: 'string'  },
  'kitchen.equipment':             { label: 'Kitchen equipment',       category: 'Kitchen',       factType: 'array'   },
  'household.size':                { label: 'Household size',          category: 'Household',     factType: 'number'  },
  'fitness.protein_target':        { label: 'Daily protein target',    category: 'Fitness',       factType: 'number'  },
  'fitness.calorie_target':        { label: 'Daily calorie target',    category: 'Fitness',       factType: 'number'  },
  'fitness.gym_days':              { label: 'Gym days',                category: 'Fitness',       factType: 'array'   },
  'preference.cuisines.liked':     { label: 'Liked cuisines',          category: 'Preferences',   factType: 'array'   },
  'preference.cuisines.disliked':  { label: 'Disliked cuisines',       category: 'Preferences',   factType: 'array'   },
  'pantry.staples':                { label: 'Pantry staples',          category: 'Pantry',        factType: 'array'   },
  'ordering.frequent_restaurants': { label: 'Frequent restaurants',    category: 'Order History', factType: 'array'   },
  'cooking.can_cook':              { label: 'Can cook at home',        category: 'Kitchen',       factType: 'boolean' },
  'health.last_sick_day':          { label: 'Last sick day',           category: 'Health',        factType: 'date'    },
}
