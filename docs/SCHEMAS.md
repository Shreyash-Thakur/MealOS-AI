# MealOS AI — Zod Schema Library

**Project:** MealOS AI
**Last Updated:** 2026-07-07
**Status:** Authoritative validation reference. Schemas only — zero implementation. Every schema validates a type of the same base name in `docs/TYPES.md` (`SituationContextSchema` validates `SituationContext`). Nothing crosses a trust boundary unvalidated: API requests, API responses (in dev/test), LLM structured outputs, and SSE payloads all pass through these.
**Related files:** `docs/TYPES.md` (the types these schemas enforce), `docs/API.md` (route contracts and error codes), `docs/AGENTS.md` (agent output contracts), `docs/DATABASE.md` (persisted shapes)

---

## Table of Contents

1. [Conventions and Validation Policy](#1-conventions-and-validation-policy)
2. [Shared Primitives](#2-shared-primitives)
3. [Error Envelope](#3-error-envelope)
4. [Route: POST /api/v1/situations](#4-route-post-apiv1situations)
5. [Route: GET /api/v1/situations/:id/stream](#5-route-get-apiv1situationsidstream)
6. [Route: POST /api/v1/situations/:id/clarify](#6-route-post-apiv1situationsidclarify)
7. [Route: GET /api/v1/situations/:id](#7-route-get-apiv1situationsid)
8. [Route: GET /api/v1/recommendations/:id](#8-route-get-apiv1recommendationsid)
9. [Route: POST /api/v1/recommendations/:id/execute](#9-route-post-apiv1recommendationsidexecute)
10. [Route: GET /api/v1/memory](#10-route-get-apiv1memory)
11. [Route: PATCH /api/v1/memory](#11-route-patch-apiv1memory)
12. [Route: POST /api/v1/onboarding](#12-route-post-apiv1onboarding)
13. [Route: GET /api/v1/health](#13-route-get-apiv1health)
14. [SSE Event Schemas](#14-sse-event-schemas)
15. [LLM Structured Output Schemas](#15-llm-structured-output-schemas)
16. [Coverage Table](#16-coverage-table)

---

## 1. Conventions and Validation Policy

**One confidence convention per domain, resolved once (same as TYPES.md §1):** pipeline confidence is an **integer 0–100** (`zConfidencePercent`) — Conversation Agent, Decision Engine, recommendation `confidence_score`, and the SSE `context_understood` event all use it. Memory fact confidence is a **decimal 0.0–1.0** (`zFactConfidence`). The `0.91` example in `docs/API.md` predates this resolution; the wire value is `91`.

**Money:** integer whole INR. `zRupees` rejects floats and negatives. Upper bound ₹1,00,000 everywhere (matching the onboarding budget cap in API.md) — a single situation will never legitimately cost more.

**String length caps are a security control, not formatting.** Every free-text field that eventually reaches an LLM prompt has a hard cap here to bound the prompt-injection surface and token cost: situation input 2000, clarification freetext answer 500, memory string values 500, addresses 300. Every LLM-*produced* string also has a cap so a runaway generation cannot flood the DB or the UI.

**Wire casing is snake_case; domain types are camelCase.** Request/response schemas below define the exact snake_case wire shapes from `docs/API.md`. Agent output schemas (§15) validate the camelCase domain types from TYPES.md, because agent JSON never leaves the server. The rename happens in the serializer, not in Zod.

**`.strict()` on every LLM output object.** Models invent fields; unknown keys on agent output are schema failures (which trigger each agent's documented fallback path, per AGENTS.md §1.2). API *request* schemas are also `.strict()` — clients sending unknown fields are bugs. API *response* schemas use `.passthrough()` in client-side validation so old clients tolerate additive V1 changes (API.md versioning policy).

**Imports assumed by every block below** (not repeated per block):

```ts
import { z } from 'zod'
import type * as T from './types'   // docs/TYPES.md library
```

---

## 2. Shared Primitives

```ts
// ── Scalars ──────────────────────────────────────────────────────────────────
export const zUuid = z.string().uuid()

export const zRupees = z.number().int().min(0).max(100_000)
export const zMinutes = z.number().int().min(0).max(24 * 60)
export const zMs = z.number().int().min(0)
export const zSeconds = z.number().int().min(0)
export const zGrams = z.number().int().min(0).max(2000)
export const zKcal = z.number().int().min(0).max(10_000)

export const zConfidencePercent = z.number().int().min(0).max(100)
export const zFactConfidence = z.number().min(0).max(1)
export const zWriteTimeFactConfidence = z.union([
  z.literal(0.4), z.literal(0.6), z.literal(0.8), z.literal(1.0),
]) // Memory Agent may only WRITE these four values (AGENTS.md §5.4)

export const zIsoDateTime = z.string().datetime({ offset: true })
export const zIsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const zRating = z.number().int().min(1).max(5)

export const zLat = z.number().min(-90).max(90)
export const zLng = z.number().min(-180).max(180)

// 12-hour IST slot label: "7:30 PM", "10:00 AM" — no zero-padded hours (AGENTS.md §4.6)
export const zSlotLabel = z.string().regex(/^(1[0-2]|[1-9]):[0-5]\d (AM|PM)$/)

// Memory fact key: dot-notation, lowercase, closed set (TYPES.md FactKey)
export const zFactKey = z.enum([
  'dietary.restrictions', 'dietary.allergies',
  'budget.daily_food_target', 'budget.dining_out_budget',
  'location.home', 'location.work',
  'kitchen.skill_level', 'kitchen.equipment',
  'household.size',
  'fitness.protein_target', 'fitness.calorie_target', 'fitness.gym_days',
  'preference.cuisines.liked', 'preference.cuisines.disliked',
  'pantry.staples', 'ordering.frequent_restaurants',
  'cooking.can_cook', 'health.last_sick_day',
])

// ── Enums ────────────────────────────────────────────────────────────────────
export const zSituationType = z.enum([
  'sick', 'broke', 'date_planning', 'party_hosting', 'nutrition_goal',
  'quick_meal', 'meal_prep', 'office_lunch', 'family_dinner', 'late_night',
  'general',
])

export const zSituationStatus = z.enum([
  'created', 'intent_extracted', 'clarifying', 'context_ready', 'planning',
  'plan_ready', 'executing', 'completed', 'abandoned', 'error',
])

export const zPrimaryPath = z.enum(['cook', 'order', 'dineout'])
export const zEnginePath = z.enum(['COOK', 'ORDER', 'DINE_OUT'])
export const zService = z.enum(['swiggy_food', 'instamart', 'dineout', 'recipe', 'meal_prep'])
export const zPlanType = z.enum(['single', 'sequence', 'multi_service', 'weekly'])
export const zDietType = z.enum(['vegetarian', 'vegan', 'non_vegetarian', 'pescatarian', 'jain'])
export const zCookingSkill = z.enum(['beginner', 'intermediate', 'advanced'])
export const zConfidenceLevel = z.enum(['high', 'medium', 'low'])
export const zMemorySource = z.enum([
  'onboarding', 'user_stated', 'user_edited',
  'clarification_answer', 'behavior_inferred', 'action_derived',
])
export const zFactType = z.enum(['string', 'number', 'boolean', 'array', 'date'])
export const zUserActionType = z.enum([
  'executed_cook', 'executed_order', 'executed_dineout', 'dismissed', 'modified',
])

// ── Composite building blocks ────────────────────────────────────────────────
export const NutritionInfoSchema = z.object({
  calories: zKcal,
  protein_g: zGrams,
  carbs_g: zGrams,
  fat_g: zGrams,
})

export const RecipeStepSchema = z.object({
  step: z.number().int().min(1).max(40),
  instruction: z.string().min(1).max(400),
  duration_min: zMinutes,
  tip: z.string().max(200).optional(),
  youtube_timestamp: z.string().regex(/^\d{1,3}:[0-5]\d$/).optional(), // "MM:SS"
})

export const IngredientLineSchema = z.object({
  name: z.string().min(1).max(120),
  quantity: z.string().min(1).max(60),
  estimated_cost_inr: zRupees,
  swiggy_item_id: z.string().max(80).optional(),
  in_pantry: z.boolean(),
})

export const ClarificationQuestionSchema = z.object({
  id: z.string().regex(/^q[1-3]$/),                    // "q1" | "q2" | "q3"
  text: z.string().min(5).max(300),
  field: z.string().min(1).max(60),                    // ExplicitContext key
  type: z.enum(['single_choice', 'multi_choice', 'freetext', 'number']),
  options: z.array(z.object({
    label: z.string().min(1).max(120),
    value: z.union([z.string().max(200), z.number(), z.boolean()]),
  })).max(6).default([]),
  required: z.boolean(),
})

export const ClarificationAnswerValueSchema = z.union([
  z.string().max(500),                                 // freetext cap — reaches the LLM
  z.number().int().min(0).max(1_000_000),
  z.boolean(),
  z.array(z.string().max(200)).max(10),                // multi_choice
])

export const PathComparisonSchema = z.object({
  score: z.number().int().min(0).max(100),
  estimated_cost_inr: zRupees,
  estimated_time_min: zMinutes,
  feasible: z.boolean(),
  scoring_factors: z.object({
    goal_match: z.number().min(-25).max(25),           // weighted contributions;
    budget_fit: z.number().min(-25).max(25),           // negative = wrong-fit path
    time_fit: z.number().min(-25).max(25),
    preference_match: z.number().min(-25).max(25),
  }),
  reason: z.string().min(1).max(300),
})

export const ComparisonScoresSchema = z.object({
  cook: PathComparisonSchema,
  order: PathComparisonSchema,
  dine_out: PathComparisonSchema,
})
```

---

## 3. Error Envelope

Every non-2xx response body across all routes has exactly this shape (API.md examples). `code` is the closed set from the API.md Error Code Reference.

```ts
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
])

export const ApiErrorSchema = z.object({
  code: zErrorCode,
  message: z.string().min(1).max(500),
  details: z.record(z.unknown()).optional(),  // per-code shape, e.g. retry_after_seconds
})
```

---

## 4. Route: POST /api/v1/situations

Rate limit 10/min/user. Creates the situation, returns 201.

```ts
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
    current_weather: z.enum(['hot', 'cold', 'rainy']).optional(),
    pantry_last_updated: zIsoDate.optional(),
  }).strict().optional(),
}).strict()

export const CreateSituationResponseSchema = z.object({
  situation_id: zUuid,
  status: z.literal('intent_extracted'),
  stream_url: z.string().startsWith('/api/v1/situations/'),
  situation_type: zSituationType,
  understood_as: z.string().max(300),
  location_used: z.enum(['request', 'profile', 'none']),
})
```

Errors: `INVALID_INPUT` 400, `INVALID_LOCATION` 400, `UNAUTHORIZED` 401, `INPUT_UNPARSEABLE` 422, `RATE_LIMIT_EXCEEDED` 429, `AGENT_BOOTSTRAP_FAILED` 500, `SERVICE_UNAVAILABLE` 503 — all via `ApiErrorSchema`.

---

## 5. Route: GET /api/v1/situations/:id/stream

SSE endpoint — no JSON response body; event payloads are validated by §14. Only the path/query need schemas.

```ts
export const StreamParamsSchema = z.object({
  id: zUuid,
}).strict()

export const StreamQuerySchema = z.object({
  // EventSource cannot set headers; the JWT may ride as a query param.
  token: z.string().min(20).max(4096).optional(),
}).strict()
```

Pre-stream errors: `UNAUTHORIZED` 401, `SITUATION_ACCESS_DENIED` 403, `SITUATION_NOT_FOUND` 404, `SITUATION_EXPIRED` 410.

---

## 6. Route: POST /api/v1/situations/:id/clarify

Rate limit 20/min/user. Answer count and types are cross-checked against the stored `ClarificationPass` server-side; Zod enforces shape and caps.

```ts
export const ClarifyParamsSchema = z.object({ id: zUuid }).strict()

export const ClarifyRequestSchema = z.object({
  clarification_id: zUuid,
  answers: z.record(
    z.string().regex(/^q[1-3]$/),          // question IDs
    ClarificationAnswerValueSchema,
  ).refine((a) => Object.keys(a).length >= 1 && Object.keys(a).length <= 3, {
    message: 'between 1 and 3 answers per pass',
  }),
}).strict()

export const ClarifyResponseSchema = z.object({
  status: z.enum(['context_ready', 'more_clarification_needed']),
  message: z.string().max(300),
  pass_number: z.number().int().min(1).max(2),
  planning_started: z.boolean().optional(),           // when context_ready
  next_pass_event_incoming: z.boolean().optional(),   // when more_clarification_needed
})
```

Errors: `MISSING_REQUIRED_ANSWERS` 400, `INVALID_ANSWER_TYPE` 400, `UNAUTHORIZED` 401, `SITUATION_ACCESS_DENIED` 403, `SITUATION_NOT_FOUND` 404, `CLARIFICATION_EXPIRED` 409, `INVALID_SITUATION_STATE` 409, `RATE_LIMIT_EXCEEDED` 429.

---

## 7. Route: GET /api/v1/situations/:id

Reconnection/state endpoint. Pure DB read.

```ts
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

  recommendation_id: zUuid.optional(),        // plan_ready | executing | completed

  error: z.object({                           // present iff status === 'error'
    code: zErrorCode,
    message: z.string().max(500),
    fallback_available: z.boolean(),
    fallback_recommendation_id: zUuid.optional(),
  }).optional(),

  stream_active: z.boolean(),
})
```

Errors: `UNAUTHORIZED` 401, `SITUATION_ACCESS_DENIED` 403, `SITUATION_NOT_FOUND` 404.

---

## 8. Route: GET /api/v1/recommendations/:id

The full plan. Item detail blocks form a discriminated union on `service` — exactly one detail block per item, matching its service.

```ts
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
  items: z.array(PlanItemSchema).min(1).max(5),   // 1 primary + up to 4 alternatives

  timeline: z.array(z.object({
    label: z.string().max(60),
    action: z.string().max(200),
    item_id: zUuid,
    scheduled_for: zIsoDateTime.optional(),
  })).max(28).optional(),                          // weekly plan: ≤ 4/day * 7

  memory_previews: z.array(z.object({
    key: zFactKey,
    value: z.unknown(),
    action: z.enum(['store', 'update']),
    reason: z.string().max(200),
  })).max(10).optional(),
})
```

Errors: `UNAUTHORIZED` 401, `RECOMMENDATION_ACCESS_DENIED` 403, `RECOMMENDATION_NOT_FOUND` 404, `RECOMMENDATION_NOT_READY` 409.

---

## 9. Route: POST /api/v1/recommendations/:id/execute

Rate limit 30/min/user. `MISSING_TIME_SLOT` is enforced server-side (Zod cannot know the item's service from the payload alone).

```ts
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
  execution_type: z.enum(['swiggy_cart', 'instamart_cart', 'dineout_booking', 'cooking_guide']),
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
```

Errors: `ITEM_NOT_EXECUTABLE` 400, `MISSING_TIME_SLOT` 400, `UNAUTHORIZED` 401, `RECOMMENDATION_ACCESS_DENIED` 403, `RECOMMENDATION_NOT_FOUND` 404, `ITEM_NOT_FOUND` 404, `RECOMMENDATION_NOT_READY` 409, `SWIGGY_UNAVAILABLE` 503.

---

## 10. Route: GET /api/v1/memory

No request schema (no body, no params).

```ts
export const MemoryFactViewSchema = z.object({
  id: zUuid,
  key: zFactKey,
  value: z.unknown(),                     // shape enforced per-key by FactValueSchemas below
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
```

Per-key value validation, used by both PATCH /memory and the Memory Agent write path (single source of truth for fact shapes):

```ts
export const FactValueSchemas: Record<T.FactKey, z.ZodTypeAny> = {
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
```

Errors: `UNAUTHORIZED` 401, `USER_NOT_FOUND` 404.

---

## 11. Route: PATCH /api/v1/memory

Rate limit 30/min/user. `value: null` deletes the fact. Per-key value shapes are checked against `FactValueSchemas` after this structural pass.

```ts
export const MemoryUpdateSchema = z.object({
  key: zFactKey,                          // closed set ⇒ INVALID_KEY_FORMAT for anything else
  value: z.unknown().nullable(),          // null = delete; else FactValueSchemas[key]
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
    code: zErrorCode,                     // e.g. FACT_NOT_EDITABLE, INVALID_VALUE_TYPE
    message: z.string().max(300),
  })).max(20),
})
```

Errors: `INVALID_UPDATE_PAYLOAD` 400, `INVALID_KEY_FORMAT` 400, `INVALID_VALUE_TYPE` 400, `UNAUTHORIZED` 401, `RATE_LIMIT_EXCEEDED` 429.

---

## 12. Route: POST /api/v1/onboarding

Lifetime limit 3 calls. Second call is a 200 no-op.

```ts
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
  ])).max(7).optional(),
}).strict()

export const OnboardingResponseSchema = z.object({
  user_id: zUuid,
  onboarding_complete: z.literal(true),
  facts_stored: z.number().int().min(0).max(20),
  profile_complete: z.boolean(),
  next_step: z.literal('home'),
})
```

Errors: `INVALID_ONBOARDING_DATA` 400, `INVALID_DIET_TYPE` 400, `UNAUTHORIZED` 401, `ONBOARDING_LIMIT_EXCEEDED` 429.

---

## 13. Route: GET /api/v1/health

Public, unauthenticated, no request schema.

```ts
export const zServiceStatus = z.enum(['ok', 'degraded', 'down'])

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
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
```

503 (database down) still returns `ApiErrorSchema` with `SERVICE_UNAVAILABLE`.

---

## 14. SSE Event Schemas

One schema per event on `/api/v1/situations/:id/stream`. The server validates before emitting; clients validate after `JSON.parse(e.data)`. Unknown event names are ignored by clients (additive versioning).

```ts
export const ContextUnderstoodEventSchema = z.object({
  situation_type: zSituationType,
  understood_as: z.string().min(1).max(300),
  confidence: zConfidencePercent,             // integer 0–100 (see §1)
  known_fields: z.array(z.string().max(60)).max(30),
  assumptions: z.array(z.object({
    field: z.string().max(60),
    value: z.union([z.string().max(300), z.number(), z.boolean()]),
    source: z.enum(['memory', 'inference', 'time_of_day']),
  })).max(15),
}).strict()

export const ClarificationNeededEventSchema = z.object({
  clarification_id: zUuid,
  pass_number: z.union([z.literal(1), z.literal(2)]),
  questions: z.array(ClarificationQuestionSchema).min(1).max(3),  // HARD cap: 3
  assumptions_stated: z.array(z.string().max(200)).max(10),
  expires_at: zIsoDateTime,
}).strict()

export const PlanningStartedEventSchema = z.object({
  agents_running: z.array(z.enum(['swiggy', 'recipe', 'budget', 'nutrition'])).min(1),
  estimated_seconds: z.number().int().min(1).max(60),
}).strict()

export const AgentProgressEventSchema = z.object({
  agent: z.enum(['swiggy', 'recipe', 'budget', 'nutrition', 'planning']),
  status: z.enum(['completed', 'failed', 'skipped']),
  message: z.string().min(1).max(300),
  partial_data: z.unknown().optional(),       // unstable — clients must not depend on it
}).strict()

export const PlanReadyEventSchema = z.object({
  recommendation_id: zUuid,
  headline: z.string().min(1).max(200),
  plan_type: zPlanType,
  preview: z.object({
    primary_service: zService,
    primary_title: z.string().max(200),
    primary_cost: zRupees,
    primary_time: zMinutes,
    alternatives_count: z.number().int().min(0).max(4),
  }),
}).strict()

export const StreamErrorEventSchema = z.object({
  code: zErrorCode,
  message: z.string().min(1).max(500),
  fallback_available: z.boolean(),
  fallback_type: z.enum(['recipe_only', 'generic_suggestion']).optional(),
  situation_id: zUuid,
}).strict()

export const HeartbeatEventSchema = z.object({
  ts: zIsoDateTime,
}).strict()

/** Envelope keyed by SSE `event:` name — the full stream vocabulary. */
export const SSEEventSchemas = {
  context_understood:   ContextUnderstoodEventSchema,
  clarification_needed: ClarificationNeededEventSchema,
  planning_started:     PlanningStartedEventSchema,
  agent_progress:       AgentProgressEventSchema,
  plan_ready:           PlanReadyEventSchema,
  error:                StreamErrorEventSchema,
  heartbeat:            HeartbeatEventSchema,
} as const
```

---

## 15. LLM Structured Output Schemas

These are the enforcement layer between raw model output and the pipeline (AGENTS.md §1.2 `parseAndValidate`). All are `.strict()` — an invented field is a schema failure and routes to the agent's fallback. They validate camelCase **domain** types (agent JSON never leaves the server unserialized).

### 15.1 Conversation Agent — `ExtractedContextSchema`

Validates `T.ExtractedContext` (the persisted, memory-merged `SituationContextSchema` follows). One retry on schema failure with a stricter prompt; second failure → `SCHEMA_FALLBACK` (AGENTS.md §2.5).

```ts
export const ExplicitContextSchema = z.object({
  sick: z.boolean().optional(),
  budget: zRupees.refine((v) => v >= 1).optional(),
  alone: z.boolean().optional(),
  canCook: z.boolean().optional(),
  guests: z.number().int().min(1).max(100).optional(),
  occasion: z.string().max(100).optional(),
  timeConstraintMinutes: z.number().int().min(1).max(24 * 60).optional(),
  craving: z.string().max(100).optional(),
  nutritionGoal: z.object({
    protein: zGrams.refine((v) => v >= 1).optional(),
    calories: zKcal.refine((v) => v >= 1).optional(),
  }).strict().optional(),
  location: z.string().max(200).optional(),
  timeframe: z.enum(['now', 'tonight', 'week']).optional(),
  indoorOutdoor: z.enum(['indoor', 'outdoor', 'either']).optional(),
  dietaryNote: z.string().max(200).optional(),
}).strict()

export const InferredContextSchema = z.object({
  timeOfDay: z.enum(['breakfast', 'lunch', 'dinner', 'latenight']).optional(),
  isWeekend: z.boolean().optional(),
}).strict()   // ONLY these two fields may be inferred — anything else is a violation

export const ExtractedContextSchema = z.object({
  situationType: zSituationType,
  explicit: ExplicitContextSchema,
  inferred: InferredContextSchema,
  confidence: zConfidencePercent,
  missingRequired: z.array(z.string().max(60)).max(10),
  missingSoft: z.array(z.string().max(60)).max(10),
  ambiguities: z.array(z.string().max(200)).max(10),
  nonFoodInput: z.boolean(),
}).strict()

/** Persisted situations.context — extracted layers + memory merge. */
export const MemoryContextSchema = z.object({
  dietType: zDietType.optional(),
  allergies: z.array(z.string().max(80)).max(20).optional(),
  budget: zRupees.optional(),
  cookingSkill: zCookingSkill.optional(),
  kitchenEquipment: z.array(z.string().max(80)).max(30).optional(),
  homeLoc: z.string().max(300).optional(),
  proteinTarget: zGrams.optional(),
  preferredCuisines: z.array(z.string().max(60)).max(20).optional(),
}).strict()

export const SituationContextSchema = z.object({
  situationType: zSituationType,
  explicit: ExplicitContextSchema,
  inferred: InferredContextSchema,
  fromMemory: MemoryContextSchema,
}).strict()
```

### 15.2 Planning Agent — `PlanningAgentOutputSchema`

No retry on schema failure (fail fast, AGENTS.md §3.1). Path-conditional field presence (`ingredients` only on cook, etc.) is enforced by the superRefine — the model must not emit cross-path fields.

```ts
export const PlanningRecommendationSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  estimatedCost: zRupees,
  estimatedTime: zMinutes,
  proteinG: zGrams.optional(),        // only when present in input — never estimated
  calories: zKcal.optional(),

  // COOK
  ingredients: z.array(z.object({
    name: z.string().min(1).max(120),
    qty: z.string().min(1).max(60),
    inPantry: z.boolean(),
  }).strict()).max(40).optional(),
  recipeSteps: z.array(z.object({
    step: z.number().int().min(1).max(40),
    instruction: z.string().min(1).max(400),
    durationMin: zMinutes,
    youtubeTimestamp: z.string().regex(/^\d{1,3}:[0-5]\d$/).optional(),
  }).strict()).max(40).optional(),
  youtubeVideoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/).optional(),

  // ORDER
  restaurantName: z.string().max(200).optional(),
  restaurantId: z.string().max(80).optional(),
  menuItems: z.array(z.object({
    name: z.string().max(200),
    price: zRupees,
  }).strict()).max(20).optional(),
  estimatedDeliveryMin: zMinutes.optional(),

  // DINEOUT
  venueName: z.string().max(200).optional(),
  venueId: z.string().max(80).optional(),
  availableSlots: z.array(zSlotLabel).max(20).optional(),
  pricePerPerson: zRupees.optional(),
}).strict()

export const PlanningAgentOutputSchema = z.object({
  explanation: z.string().min(10).max(600),
  primaryPath: zPrimaryPath,
  confidence: zConfidenceLevel,
  recommendation: PlanningRecommendationSchema,
  whyNotAlternatives: z.array(z.object({
    path: zPrimaryPath,
    reason: z.string().min(5).max(300),
  }).strict()).length(2),             // exactly 2 — one per rejected path
}).strict().superRefine((out, ctx) => {
  const r = out.recommendation
  const cookFields = [r.ingredients, r.recipeSteps, r.youtubeVideoId]
  const orderFields = [r.restaurantName, r.restaurantId, r.menuItems, r.estimatedDeliveryMin]
  const dineFields = [r.venueName, r.venueId, r.availableSlots, r.pricePerPerson]
  const present = (fs: unknown[]) => fs.some((f) => f !== undefined)

  if (out.primaryPath === 'cook' && (present(orderFields) || present(dineFields)))
    ctx.addIssue({ code: 'custom', message: 'cook path must not carry order/dineout fields' })
  if (out.primaryPath === 'order' && (present(cookFields) || present(dineFields)))
    ctx.addIssue({ code: 'custom', message: 'order path must not carry cook/dineout fields' })
  if (out.primaryPath === 'dineout' && (present(cookFields) || present(orderFields)))
    ctx.addIssue({ code: 'custom', message: 'dineout path must not carry cook/order fields' })
  if (out.whyNotAlternatives.some((a) => a.path === out.primaryPath))
    ctx.addIssue({ code: 'custom', message: 'whyNotAlternatives must not include the winner' })
})
```

### 15.3 Tool Agent — `ToolAgentOutputSchema`

Validates the normalized aggregate. `null` = tool failed; `[]` = not called / no results (AGENTS.md §4.5). Nutrition fields must be absent (not 0, not null) when the API didn't return them — hence `.optional()` without `.nullable()`.

```ts
export const RestaurantSchema = z.object({
  restaurantId: z.string().min(1).max(80),
  name: z.string().min(1).max(200),               // exact Swiggy name, never truncated
  rating: z.number().min(0).max(5),
  deliveryTimeMin: zMinutes,
  deliveryFee: zRupees,
  minOrderValue: zRupees,
  cuisineTypes: z.array(z.string().max(60)).max(10),
  topItems: z.array(z.object({
    name: z.string().max(200),
    price: zRupees,
    isVeg: z.boolean(),
    calories: zKcal.optional(),                   // present iff Swiggy returned it
    proteinG: zGrams.optional(),
  }).strict()).max(10),
}).strict()

export const InstamartResultSchema = z.object({
  item: z.string().min(1).max(120),
  found: z.boolean(),
  price: zRupees.optional(),
  unit: z.string().max(30).optional(),
  brand: z.string().max(80).optional(),
  deliveryTimeMin: zMinutes.optional(),
  instamartItemId: z.string().max(80).optional(),
}).strict().refine((r) => !r.found || r.price !== undefined, {
  message: 'found items must carry a price',
})

export const DineoutVenueSchema = z.object({
  venueId: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  cuisineTypes: z.array(z.string().max(60)).max(10),
  ambience: z.array(z.enum([
    'romantic', 'rooftop', 'candlelit', 'casual', 'fine-dining',
    'outdoor', 'live-music', 'family-friendly', 'sports-bar',
  ])).max(9),
  pricePerPerson: zRupees,
  rating: z.number().min(0).max(5),
  availableSlots: z.array(zSlotLabel).max(20),
  isVegFriendly: z.boolean(),
  distanceKm: z.number().min(0).max(100).optional(),
  bookingUrl: z.string().url().max(2000).optional(),
}).strict()

export const YouTubeRecipeResultSchema = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  title: z.string().max(300),
  channelName: z.string().max(120),
  durationSeconds: zSeconds,
  thumbnailUrl: z.string().url().max(2000),
  viewCount: z.number().int().min(0),
  publishedAt: zIsoDateTime,
  keyTimestamps: z.array(z.object({
    label: z.string().max(60),
    seconds: zSeconds,
  }).strict()).max(20),
}).strict()

export const zToolName = z.enum([
  'swiggy_search_restaurants', 'swiggy_search_instamart',
  'swiggy_search_dineout', 'youtube_search_recipe',
])

export const ToolAgentOutputSchema = z.object({
  restaurants: z.array(RestaurantSchema).max(20).nullable(),
  instamartItems: z.array(InstamartResultSchema).max(60).nullable(),
  dineoutVenues: z.array(DineoutVenueSchema).max(20).nullable(),
  youtube: YouTubeRecipeResultSchema.nullable(),

  errors: z.array(z.object({
    tool: zToolName,
    errorCode: z.enum([
      'LOCATION_NOT_SERVICEABLE', 'NO_RESULTS', 'RATE_LIMITED',
      'SWIGGY_DOWN', 'INSTAMART_DOWN', 'DINEOUT_DOWN', 'NO_AVAILABILITY',
      'QUOTA_EXCEEDED', 'API_DOWN',
    ]),
    message: z.string().max(200),
  }).strict()).max(8),

  swiggyError: z.literal('SWIGGY_UNAVAILABLE').optional(),

  _meta: z.object({
    toolsAttempted: z.array(zToolName).max(4),
    toolsSucceeded: z.array(zToolName).max(4),
    totalLatencyMs: zMs,
  }).strict(),
}).strict()
```

### 15.4 Memory Agent — `MemoryAgentOutputSchema`

Empty array is a normal, successful output. Fact values are cross-checked against `FactValueSchemas[factKey]` (§10) after this structural pass — a well-formed fact with a wrong-shaped value is still rejected, and nothing is written.

```ts
export const ExtractedMemoryFactSchema = z.object({
  factKey: zFactKey,                              // closed set — invented keys fail here
  factValue: z.union([
    z.string().max(500),
    z.number(),
    z.boolean(),
    z.array(z.string().max(200)).max(60),
  ]),
  confidence: zWriteTimeFactConfidence,           // 0.4 | 0.6 | 0.8 | 1.0 only
  source: z.enum([
    'user_stated', 'clarification_answer', 'behavior_inferred', 'action_derived',
  ]),
  expiresAfterDays: z.number().int().min(1).max(365).nullable(),
}).strict()

export const MemoryAgentOutputSchema = z.array(ExtractedMemoryFactSchema).max(10)
```

### 15.5 Decision Engine boundary — `DecisionResultSchema`

The engine is deterministic TypeScript, not an LLM — but its output is persisted and rendered, so it gets the same treatment at the persistence boundary.

```ts
export const PathScoreSchema = z.object({
  path: zEnginePath,
  available: z.boolean(),
  goalMatchScore: z.number().min(0).max(100),
  budgetFitScore: z.number().min(0).max(100),
  timeFitScore: z.number().min(0).max(100),
  prefMatchScore: z.number().min(0).max(100),
  finalScore: z.number().min(0).max(100),
  goalMatchNotes: z.array(z.string().max(120)).max(10),
  budgetNotes: z.array(z.string().max(120)).max(10),
  timeNotes: z.array(z.string().max(120)).max(10),
  prefNotes: z.array(z.string().max(120)).max(10),
  hardBlocks: z.array(z.string().max(120)).max(10),
}).strict()

export const DecisionResultSchema = z.object({
  cookScore: PathScoreSchema,
  orderScore: PathScoreSchema,
  dineOutScore: PathScoreSchema,
  winner: z.union([zEnginePath, z.literal('NO_WINNER')]),
  isSplitRecommendation: z.boolean(),
  splitAlternative: zEnginePath.nullable(),
  confidence: zConfidencePercent,
  simulator: z.object({
    primaryPath: zEnginePath,
    alternativePath: zEnginePath.nullable(),
    deltaCostRupees: z.number().int().nullable(),
    deltaTimeMinutes: z.number().int().nullable(),
    deltaProteinG: z.number().int().nullable(),
    showCostDelta: z.boolean(),
    showTimeDelta: z.boolean(),
    showProteinDelta: z.boolean(),
  }).strict(),
  weightsUsed: z.object({
    goalMatch: z.number().min(0).max(1),
    budgetFit: z.number().min(0).max(1),
    timeFit: z.number().min(0).max(1),
    preferenceMatch: z.number().min(0).max(1),
  }).strict().refine(
    (w) => Math.abs(w.goalMatch + w.budgetFit + w.timeFit + w.preferenceMatch - 1) < 1e-9,
    { message: 'weights must sum to exactly 1.0' },
  ),
  computedAt: zIsoDateTime,
}).strict()
```

---

## 16. Coverage Table

Every route and every LLM boundary, with its schemas. "—" = intentionally none (no body / not applicable).

| Route / Agent | Params / Query | Request Body | Response Body | Notes |
|---|---|---|---|---|
| `POST /api/v1/situations` | — | `CreateSituationRequestSchema` | `CreateSituationResponseSchema` (201) | input 1–2000 chars, non-blank; lat/lng bounded |
| `GET /api/v1/situations/:id/stream` | `StreamParamsSchema` + `StreamQuerySchema` | — | per-event (§14) | SSE; `token` query param for EventSource |
| `POST /api/v1/situations/:id/clarify` | `ClarifyParamsSchema` | `ClarifyRequestSchema` | `ClarifyResponseSchema` | 1–3 answers; q-id format `q1..q3`; freetext ≤ 500 |
| `GET /api/v1/situations/:id` | `GetSituationParamsSchema` | — | `SituationResponseSchema` | reconnection state; conditional blocks by status |
| `GET /api/v1/recommendations/:id` | `GetRecommendationParamsSchema` | — | `RecommendationResponseSchema` | items: discriminated union on `service`, 1–5 items |
| `POST /api/v1/recommendations/:id/execute` | `ExecuteParamsSchema` | `ExecuteRecommendationRequestSchema` | `ExecuteRecommendationResponseSchema` | `MISSING_TIME_SLOT` enforced server-side |
| `GET /api/v1/memory` | — | — | `MemoryResponseSchema` | `FactValueSchemas` = per-key value truth |
| `PATCH /api/v1/memory` | — | `PatchMemoryRequestSchema` | `PatchMemoryResponseSchema` | 1–20 updates; null value = delete; closed key set |
| `POST /api/v1/onboarding` | — | `OnboardingRequestSchema` | `OnboardingResponseSchema` (201/200) | budget 1–100,000; gym days enum |
| `GET /api/v1/health` | — | — | `HealthResponseSchema` | public; 503 only when DB down |
| All error responses | — | — | `ApiErrorSchema` | closed `zErrorCode` set (30 codes) |
| SSE `context_understood` | — | — | `ContextUnderstoodEventSchema` | confidence integer 0–100 |
| SSE `clarification_needed` | — | — | `ClarificationNeededEventSchema` | **max 3 questions, hard** |
| SSE `planning_started` | — | — | `PlanningStartedEventSchema` | |
| SSE `agent_progress` | — | — | `AgentProgressEventSchema` | `partial_data` unstable |
| SSE `plan_ready` | — | — | `PlanReadyEventSchema` | terminal success event |
| SSE `error` | — | — | `StreamErrorEventSchema` | terminal failure event |
| SSE `heartbeat` | — | — | `HeartbeatEventSchema` | every 15s idle |
| Conversation Agent | — | — | `ExtractedContextSchema` | strict; 1 retry then fallback; inferred = 2 fields only |
| (persisted context) | — | — | `SituationContextSchema` | extracted + `fromMemory` merge |
| Planning Agent | — | — | `PlanningAgentOutputSchema` | strict; no retry; path-conditional superRefine; exactly 2 why-nots |
| Tool Agent | — | — | `ToolAgentOutputSchema` | null=failed vs []=empty; nutrition absent-not-null |
| Memory Agent | — | — | `MemoryAgentOutputSchema` | closed key set; quantized confidence; ≤ 10 facts |
| Decision Engine (persistence boundary) | — | — | `DecisionResultSchema` | weights sum to 1.0 invariant |
