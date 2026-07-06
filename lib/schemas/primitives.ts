/**
 * MealOS AI — Shared Zod Primitives
 * Source: docs/SCHEMAS.md §2 (Shared Primitives)
 *
 * These are the building blocks used by every other schema file.
 * Import note: callers write `import { zRupees } from '@/lib/schemas/primitives'`
 * or via the barrel: `import { zRupees } from '@/lib/schemas'`
 */

import { z } from 'zod'

// ── Scalars ───────────────────────────────────────────────────────────────────

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
] as const)

// ── Enums ─────────────────────────────────────────────────────────────────────

export const zSituationType = z.enum([
  'sick', 'broke', 'date_planning', 'party_hosting', 'nutrition_goal',
  'quick_meal', 'meal_prep', 'office_lunch', 'family_dinner', 'late_night',
  'general',
] as const)

export const zSituationStatus = z.enum([
  'created', 'intent_extracted', 'clarifying', 'context_ready', 'planning',
  'plan_ready', 'executing', 'completed', 'abandoned', 'error',
] as const)

export const zPrimaryPath = z.enum(['cook', 'order', 'dineout'] as const)
export const zEnginePath = z.enum(['COOK', 'ORDER', 'DINE_OUT'] as const)
export const zService = z.enum(['swiggy_food', 'instamart', 'dineout', 'recipe', 'meal_prep'] as const)
export const zPlanType = z.enum(['single', 'sequence', 'multi_service', 'weekly'] as const)
export const zDietType = z.enum(['vegetarian', 'vegan', 'non_vegetarian', 'pescatarian', 'jain'] as const)
export const zCookingSkill = z.enum(['beginner', 'intermediate', 'advanced'] as const)
export const zConfidenceLevel = z.enum(['high', 'medium', 'low'] as const)
export const zMemorySource = z.enum([
  'onboarding', 'user_stated', 'user_edited',
  'clarification_answer', 'behavior_inferred', 'action_derived',
] as const)
export const zFactType = z.enum(['string', 'number', 'boolean', 'array', 'date'] as const)
export const zUserActionType = z.enum([
  'executed_cook', 'executed_order', 'executed_dineout', 'dismissed', 'modified',
] as const)

// ── Composite building blocks ─────────────────────────────────────────────────

/** Wire-level (snake_case) nutrition shape, used in PlanItem detail blocks. */
export const NutritionInfoSchema = z.object({
  calories: zKcal,
  protein_g: zGrams,
  carbs_g: zGrams,
  fat_g: zGrams,
})

/** Canonical RecipeStep — snake_case wire shape (§2 is the wire schema). */
export const RecipeStepSchema = z.object({
  step: z.number().int().min(1).max(40),
  instruction: z.string().min(1).max(400),
  duration_min: zMinutes,
  tip: z.string().max(200).optional(),
  youtube_timestamp: z.string().regex(/^\d{1,3}:[0-5]\d$/).optional(), // "MM:SS"
})

/** Wire-level ingredient/cart line. */
export const IngredientLineSchema = z.object({
  name: z.string().min(1).max(120),
  quantity: z.string().min(1).max(60),
  estimated_cost_inr: zRupees,
  swiggy_item_id: z.string().max(80).optional(),
  in_pantry: z.boolean(),
})

export const ClarificationQuestionSchema = z.object({
  id: z.string().regex(/^q[1-3]$/),              // "q1" | "q2" | "q3"
  text: z.string().min(5).max(300),
  field: z.string().min(1).max(60),              // ExplicitContext key
  type: z.enum(['single_choice', 'multi_choice', 'freetext', 'number'] as const),
  options: z.array(z.object({
    label: z.string().min(1).max(120),
    value: z.union([z.string().max(200), z.number(), z.boolean()]),
  })).max(6).default([]),
  required: z.boolean(),
})

export const ClarificationAnswerValueSchema = z.union([
  z.string().max(500),                           // freetext cap — reaches the LLM
  z.number().int().min(0).max(1_000_000),
  z.boolean(),
  z.array(z.string().max(200)).max(10),          // multi_choice
])

export const PathComparisonSchema = z.object({
  score: z.number().int().min(0).max(100),
  estimated_cost_inr: zRupees,
  estimated_time_min: zMinutes,
  feasible: z.boolean(),
  scoring_factors: z.object({
    goal_match: z.number().min(-25).max(25),      // weighted contributions;
    budget_fit: z.number().min(-25).max(25),      // negative = wrong-fit path
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
