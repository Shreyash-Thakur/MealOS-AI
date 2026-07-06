/**
 * MealOS AI — API Route Schemas
 * Source: docs/SCHEMAS.md §3–§13
 *
 * Wire casing: snake_case (matching docs/API.md).
 * Request schemas: .strict() — unknown fields from clients are bugs.
 * Response schemas: .passthrough() — old clients tolerate additive V1 changes.
 */

import { z } from 'zod'
import {
  zUuid,
  zRupees,
  zMinutes,
  zIsoDateTime,
  zIsoDate,
  zLat,
  zLng,
  zFactKey,
  zSituationType,
  zSituationStatus,
  zPrimaryPath,
  zService,
  zPlanType,
  zDietType,
  zCookingSkill,
  zMemorySource,
  zFactType,
  zFactConfidence,
  zGrams,
  zKcal,
  zRating,
  zConfidencePercent,
  NutritionInfoSchema,
  RecipeStepSchema,
  IngredientLineSchema,
  ClarificationQuestionSchema,
  ClarificationAnswerValueSchema,
  ComparisonScoresSchema,
} from './primitives'
import type { FactKey } from '@/types/memory'

// ── §3 Error Envelope ─────────────────────────────────────────────────────────

export const zErrorCode = z.enum([
  'UNAUTHORIZED',
  'SITUATION_ACCESS_DENIED', 'RECOMMENDATION_ACCESS_DENIED',
  'SITUATION_NOT_FOUND', 'RECOMMENDATION_NOT_FOUND', 'USER_NOT_FOUND', 'ITEM_NOT_FOUND',
  'INVALID_INPUT', 'INVALID_LOCATION', 'INPUT_UNPARSEABLE',
  'MISSING_REQUIRED_ANSWERS', 'INVALID_ANSWER_TYPE',
  'CLARIFICATION_EXPIRED', 'INVALID_SITUATION_STATE', 'RECOMMENDATION_NOT_READY',
  'ITEM_NOT_EXECUTABLE', 'MISSING_TIME_SLOT',
  'FACT_NOT_EDITABLE', 'INVALID_UPDATE_PAYLOAD', 'INVALID_KEY_FORMAT', 'INVALID_VALUE_TYPE',
  'INVALID_ONBOARDING_DATA', 'INVALID_DIET_TYPE', 'ONBOARDING_LIMIT_EXCEEDED',
  'RATE_LIMIT_EXCEEDED',
  'LLM_TIMEOUT', 'AGENT_BOOTSTRAP_FAILED',
  'SWIGGY_UNAVAILABLE', 'SERVICE_UNAVAILABLE',
  'SITUATION_EXPIRED',
] as const)

export const ApiErrorSchema = z.object({
  code: zErrorCode,
  message: z.string().min(1).max(500),
  details: z.record(z.unknown()).optional(),  // per-code shape, e.g. retry_after_seconds
})

// ── §4 POST /api/v1/situations ────────────────────────────────────────────────

export const CreateSituationRequestSchema = z.object({
  input: z.string()
    .min(1).max(2000)
    .refine((s) => s.trim().length > 0, { message: 'INVALID_INPUT: blank' }),
  location: z.object({
    lat: zLat,
    lng: zLng,
  }).strict().optional(),
  context_hints: z.object({
    calendar_busy_until: zIsoDateTime.optional(),
    current_weather: z.enum(['hot', 'cold', 'rainy'] as const).optional(),
    pantry_last_updated: zIsoDate.optional(),
  }).strict().optional(),
}).strict()

export const CreateSituationResponseSchema = z.object({
  situation_id: zUuid,
  status: z.literal('intent_extracted'),
  stream_url: z.string().startsWith('/api/v1/situations/'),
  situation_type: zSituationType,
  understood_as: z.string().max(300),
  location_used: z.enum(['request', 'profile', 'none'] as const),
})

// ── §5 GET /api/v1/situations/:id/stream ─────────────────────────────────────

export const StreamParamsSchema = z.object({
  id: zUuid,
}).strict()

export const StreamQuerySchema = z.object({
  // EventSource cannot set headers; the JWT may ride as a query param.
  token: z.string().min(20).max(4096).optional(),
}).strict()

// ── §6 POST /api/v1/situations/:id/clarify ───────────────────────────────────

export const ClarifyParamsSchema = z.object({ id: zUuid }).strict()

export const ClarifyRequestSchema = z.object({
  clarification_id: zUuid,
  answers: z.record(
    z.string().regex(/^q[1-3]$/),        // question IDs
    ClarificationAnswerValueSchema,
  ).refine((a) => Object.keys(a).length >= 1 && Object.keys(a).length <= 3, {
    message: 'between 1 and 3 answers per pass',
  }),
}).strict()

export const ClarifyResponseSchema = z.object({
  status: z.enum(['context_ready', 'more_clarification_needed'] as const),
  message: z.string().max(300),
  pass_number: z.number().int().min(1).max(2),
  planning_started: z.boolean().optional(),           // when context_ready
  next_pass_event_incoming: z.boolean().optional(),   // when more_clarification_needed
})

// ── §7 GET /api/v1/situations/:id ────────────────────────────────────────────

export const GetSituationParamsSchema = z.object({ id: zUuid }).strict()

export const SituationResponseSchema = z.object({
  id: zUuid,
  status: zSituationStatus,
  situation_type: zSituationType.nullable(),
  raw_input: z.string().max(2000),
  understood_as: z.string().max(300).nullable(),
  created_at: zIsoDateTime,
  context_ready_at: zIsoDateTime.nullable(),
  plan_ready_at: zIsoDateTime.nullable(),
  completed_at: zIsoDateTime.nullable(),

  pending_clarification: z.object({          // present iff status === 'clarifying'
    clarification_id: zUuid,
    questions: z.array(ClarificationQuestionSchema).min(1).max(3),
    expires_at: zIsoDateTime,
  }).optional(),

  recommendation_id: zUuid.optional(),       // plan_ready | executing | completed

  error: z.object({                          // present iff status === 'error'
    code: zErrorCode,
    message: z.string().max(500),
    fallback_available: z.boolean(),
    fallback_recommendation_id: zUuid.optional(),
  }).optional(),

  stream_active: z.boolean(),
})

// ── §8 GET /api/v1/recommendations/:id ───────────────────────────────────────

export const GetRecommendationParamsSchema = z.object({ id: zUuid }).strict()

const PlanItemBaseSchema = z.object({
  id: zUuid,
  rank: z.number().int().min(1).max(5),
  is_primary: z.boolean(),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  estimated_cost_inr: zRupees,
  estimated_time_minutes: zMinutes,
  nutrition: NutritionInfoSchema.optional(),
  is_executable: z.boolean(),
})

export const RecipePlanItemSchema = PlanItemBaseSchema.extend({
  service: z.literal('recipe'),
  recipe_detail: z.object({
    difficulty: zCookingSkill,
    serves: z.number().int().min(1).max(30),
    steps: z.array(RecipeStepSchema).min(1).max(40),
    ingredients: z.array(IngredientLineSchema).max(40),
    missing_ingredients: z.array(z.string().max(120)).max(40),
    can_make_now: z.boolean(),
    youtube_search_query: z.string().max(200),
    instamart_cart_ready: z.boolean(),
  }),
})

export const DeliveryPlanItemSchema = PlanItemBaseSchema.extend({
  service: z.literal('swiggy_food'),
  delivery_detail: z.object({
    restaurant_name: z.string().min(1).max(200),
    restaurant_id: z.string().min(1).max(80),
    item_name: z.string().min(1).max(200),
    estimated_delivery_minutes: zMinutes,
    offer_applied: z.string().max(150).optional(),
    deep_link: z.string().url().max(2000),
  }),
})

export const InstamartPlanItemSchema = PlanItemBaseSchema.extend({
  service: z.literal('instamart'),
  instamart_detail: z.object({
    items: z.array(IngredientLineSchema).min(1).max(60),
    total_cost_inr: zRupees,
    estimated_delivery_minutes: zMinutes,
    deep_link: z.string().url().max(2000),
  }),
})

export const DineoutPlanItemSchema = PlanItemBaseSchema.extend({
  service: z.literal('dineout'),
  dineout_detail: z.object({
    venue_name: z.string().min(1).max(200),
    venue_id: z.string().min(1).max(80),
    cuisine: z.string().max(100),
    ambience: z.string().max(200),
    available_slots: z.array(zIsoDateTime).max(20),
    deep_link: z.string().url().max(2000),
  }),
})

export const MealPrepPlanItemSchema = PlanItemBaseSchema.extend({
  service: z.literal('meal_prep'),      // V2: schedule payload TBD
})

export const PlanItemSchema = z.discriminatedUnion('service', [
  RecipePlanItemSchema,
  DeliveryPlanItemSchema,
  InstamartPlanItemSchema,
  DineoutPlanItemSchema,
  MealPrepPlanItemSchema,
])

export const RecommendationResponseSchema = z.object({
  id: zUuid,
  situation_id: zUuid,
  headline: z.string().min(1).max(200),
  reasoning: z.string().min(1).max(600),
  plan_type: zPlanType,
  created_at: zIsoDateTime,

  comparison: ComparisonScoresSchema,
  items: z.array(PlanItemSchema).min(1).max(5),    // 1 primary + up to 4 alternatives

  timeline: z.array(z.object({
    label: z.string().max(60),
    action: z.string().max(200),
    item_id: zUuid,
    scheduled_for: zIsoDateTime.optional(),
  })).max(28).optional(),                           // weekly plan: ≤ 4/day * 7

  memory_previews: z.array(z.object({
    key: zFactKey,
    value: z.unknown(),
    action: z.enum(['store', 'update'] as const),
    reason: z.string().max(200),
  })).max(10).optional(),
})

// ── §9 POST /api/v1/recommendations/:id/execute ──────────────────────────────

export const ExecuteParamsSchema = z.object({ id: zUuid }).strict()

export const ExecuteRecommendationRequestSchema = z.object({
  item_id: zUuid,
  execution_context: z.object({
    modified_items: z.array(z.string().max(80)).max(30).optional(),
    selected_time_slot: zIsoDateTime.optional(),   // required for dineout — server check
    party_size: z.number().int().min(1).max(30).optional(),
  }).strict().optional(),
}).strict()

export const ExecuteRecommendationResponseSchema = z.object({
  action_id: zUuid,
  execution_type: z.enum(['swiggy_cart', 'instamart_cart', 'dineout_booking', 'cooking_guide'] as const),
  confirmation: z.string().min(1).max(300),

  // swiggy_cart | instamart_cart
  redirect_url: z.string().url().max(2000).optional(),
  cart_summary: z.object({
    items: z.array(z.object({
      name: z.string().max(200),
      quantity: z.number().int().min(1).max(50),
      cost_inr: zRupees,
    })).min(1).max(60),
    total_cost_inr: zRupees,
    estimated_delivery_minutes: zMinutes,
  }).optional(),

  // dineout_booking
  booking_url: z.string().url().max(2000).optional(),
  booking_confirmation: z.object({
    venue_name: z.string().max(200),
    date_time: zIsoDateTime,
    party_size: z.number().int().min(1).max(30),
    reservation_id: z.string().max(80).optional(),
  }).optional(),

  // cooking_guide
  cooking_session_id: zUuid.optional(),
  recipe_steps: z.array(RecipeStepSchema).max(40).optional(),
  shopping_needed: z.boolean().optional(),
  instamart_shortfall_url: z.string().url().max(2000).optional(),
})

// ── §10 GET /api/v1/memory ────────────────────────────────────────────────────

export const MemoryFactViewSchema = z.object({
  id: zUuid,
  key: zFactKey,
  value: z.unknown(),                    // shape enforced per-key by FactValueSchemas below
  fact_type: zFactType,
  source: zMemorySource,
  confidence: zFactConfidence,
  last_confirmed_at: zIsoDateTime,
  expires_at: zIsoDateTime.nullable(),
  editable: z.boolean(),
  display_label: z.string().max(80),
  display_category: z.string().max(40),
})

export const UserProfileSchema = z.object({
  diet_type: zDietType.nullable(),
  allergies: z.array(z.string().max(80)).max(20),
  dietary_notes: z.string().max(500).nullable(),
  household_size: z.number().int().min(1).max(30),
  cooking_skill: zCookingSkill.nullable(),
  kitchen_equipment: z.array(z.string().max(80)).max(30),
  daily_food_budget: zRupees.nullable(),
  dining_out_budget: zRupees.nullable(),
  daily_protein_target: zGrams.nullable(),
  daily_calorie_target: zKcal.nullable(),
  gym_days: z.array(z.string().max(12)).max(7),
  preferred_cuisines: z.array(z.string().max(60)).max(20),
  disliked_cuisines: z.array(z.string().max(60)).max(20),
  home_address: z.string().max(300).nullable(),
  work_address: z.string().max(300).nullable(),
})

export const MemoryResponseSchema = z.object({
  profile: UserProfileSchema,
  facts: z.array(MemoryFactViewSchema).max(200),
  last_updated_at: zIsoDateTime,
  fact_count: z.number().int().min(0),
  onboarding_complete: z.boolean(),
})

/**
 * Per-key value validation — single source of truth for fact shapes.
 * Used by PATCH /memory and the Memory Agent write path.
 */
export const FactValueSchemas: Record<FactKey, z.ZodTypeAny> = {
  'dietary.restrictions':          z.array(z.string().max(80)).max(20),
  'dietary.allergies':             z.array(z.string().max(80)).max(20),
  'budget.daily_food_target':      zRupees.refine((v) => v >= 1),
  'budget.dining_out_budget':      zRupees.refine((v) => v >= 1),
  'location.home':                 z.string().min(1).max(300),
  'location.work':                 z.string().min(1).max(300),
  'kitchen.skill_level':           zCookingSkill,
  'kitchen.equipment':             z.array(z.string().max(80)).max(30),
  'household.size':                z.number().int().min(1).max(30),
  'fitness.protein_target':        zGrams.refine((v) => v >= 10),
  'fitness.calorie_target':        zKcal.refine((v) => v >= 500),
  'fitness.gym_days':              z.array(z.string().max(12)).max(7),
  'preference.cuisines.liked':     z.array(z.string().max(60)).max(20),
  'preference.cuisines.disliked':  z.array(z.string().max(60)).max(20),
  'pantry.staples':                z.array(z.string().max(80)).max(60),
  'ordering.frequent_restaurants': z.array(z.string().max(120)).max(20),
  'cooking.can_cook':              z.boolean(),
  'health.last_sick_day':          zIsoDate,
}

// ── §11 PATCH /api/v1/memory ──────────────────────────────────────────────────

export const MemoryUpdateSchema = z.object({
  key: zFactKey,                         // closed set ⇒ INVALID_KEY_FORMAT for anything else
  value: z.unknown().nullable(),         // null = delete; else FactValueSchemas[key]
  source: z.literal('user_stated').optional(),  // ignored — server always sets user_edited
}).strict()

export const PatchMemoryRequestSchema = z.object({
  updates: z.array(MemoryUpdateSchema).min(1).max(20),
}).strict()

export const PatchMemoryResponseSchema = z.object({
  updated: z.number().int().min(0).max(20),
  created: z.number().int().min(0).max(20),
  deleted: z.number().int().min(0).max(20),
  failures: z.array(z.object({
    key: z.string().max(120),
    code: zErrorCode,                    // e.g. FACT_NOT_EDITABLE, INVALID_VALUE_TYPE
    message: z.string().max(300),
  })).max(20),
})

// ── §12 POST /api/v1/onboarding ──────────────────────────────────────────────

export const OnboardingRequestSchema = z.object({
  diet_type: zDietType,
  allergies: z.array(z.string().min(1).max(80)).max(20).optional(),

  home_address: z.string().min(3).max(300),
  home_lat: zLat.optional(),
  home_lng: zLng.optional(),

  daily_food_budget: z.number().int().min(1).max(100_000),

  cooking_skill: zCookingSkill,
  kitchen_equipment: z.array(z.string().min(1).max(80)).max(30).optional(),

  daily_protein_target: zGrams.refine((v) => v >= 10).optional(),
  daily_calorie_target: zKcal.refine((v) => v >= 500).optional(),
  gym_days: z.array(z.enum([
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  ] as const)).max(7).optional(),
}).strict()

export const OnboardingResponseSchema = z.object({
  user_id: zUuid,
  onboarding_complete: z.literal(true),
  facts_stored: z.number().int().min(0).max(20),
  profile_complete: z.boolean(),
  next_step: z.literal('home'),
})

// ── §13 GET /api/v1/health ────────────────────────────────────────────────────

export const zServiceStatus = z.enum(['ok', 'degraded', 'down'] as const)

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded'] as const),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  timestamp: zIsoDateTime,
  services: z.object({
    database: zServiceStatus,
    redis: zServiceStatus,
    llm: zServiceStatus,
    swiggy_mcp: zServiceStatus,
  }),
  uptime_seconds: z.number().int().min(0),
})
