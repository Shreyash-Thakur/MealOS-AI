/**
 * MealOS AI — LLM Structured Output Schemas
 * Source: docs/SCHEMAS.md §15
 *
 * These are the enforcement layer between raw model output and the pipeline
 * (AGENTS.md §1.2 parseAndValidate). All are .strict() — an invented field is
 * a schema failure and routes to the agent's fallback.
 * They validate camelCase domain types (agent JSON never leaves the server).
 *
 * Planning Agent schema lives in planningOutput.ts (explicitly named in the playbook).
 * This file covers: Conversation Agent, Tool Agent, Memory Agent, Decision Engine.
 */

import { z } from 'zod'
import {
  zUuid,
  zRupees,
  zMinutes,
  zGrams,
  zKcal,
  zSeconds,
  zMs,
  zIsoDateTime,
  zConfidencePercent,
  zSituationType,
  zDietType,
  zCookingSkill,
  zFactKey,
  zWriteTimeFactConfidence,
  zEnginePath,
} from './primitives'

// ── §15.1 Conversation Agent — ExtractedContextSchema ─────────────────────────

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
  timeframe: z.enum(['now', 'tonight', 'week'] as const).optional(),
  indoorOutdoor: z.enum(['indoor', 'outdoor', 'either'] as const).optional(),
  dietaryNote: z.string().max(200).optional(),
}).strict()

export const InferredContextSchema = z.object({
  timeOfDay: z.enum(['breakfast', 'lunch', 'dinner', 'latenight'] as const).optional(),
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

// ── §15.3 Tool Agent — ToolAgentOutputSchema ──────────────────────────────────

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
    calories: zKcal.optional(),                    // present iff Swiggy returned it
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
  ] as const)).max(9),
  pricePerPerson: zRupees,
  rating: z.number().min(0).max(5),
  availableSlots: z.array(z.string().regex(/^(1[0-2]|[1-9]):[0-5]\d (AM|PM)$/)).max(20),
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
] as const)

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
    ] as const),
    message: z.string().max(200),
  }).strict()).max(8),

  swiggyError: z.literal('SWIGGY_UNAVAILABLE').optional(),

  _meta: z.object({
    toolsAttempted: z.array(zToolName).max(4),
    toolsSucceeded: z.array(zToolName).max(4),
    totalLatencyMs: zMs,
  }).strict(),
}).strict()

// ── Clarification Engine — ClarificationOutputSchema ──────────────────────────
// Source: docs/prompts/clarification.md §3. The Clarification Engine is a
// pipeline stage hosted by the Conversation Service (playbook §9 item 2), but
// its LLM output is validated like any agent output.

export const ClarificationLLMQuestionSchema = z.object({
  text: z.string().min(5).max(300),
  field: z.string().min(1).max(60),
  // number_input is the prompt-file spelling; mapped to domain 'number' downstream
  type: z.enum(['single_choice', 'multi_choice', 'number_input', 'freetext'] as const),
  // 2–4 quick-tap options + exactly one free-text fallback (clarification.md rule 2)
  options: z.array(z.object({
    label: z.string().min(1).max(120),
    value: z.union([z.string().max(200), z.number(), z.boolean()]),
  }).strict()).min(2).max(6),
  required: z.boolean(),
  evoi: z.enum(['high', 'medium', 'low'] as const),
}).strict()

export const AssumptionStatementSchema = z.object({
  text: z.string().min(5).max(300),
  fields: z.array(z.string().max(60)).min(1).max(5),
  values: z.record(z.unknown()),
  confirmable: z.boolean(),
}).strict()

/**
 * Deliberately lenient on question count (max 8, not 3): ISSUE-065 mandates the
 * 3-question cap be enforced by slice(0,3) AFTER Zod parse — an over-generating
 * model is capped, not routed to the fallback.
 */
export const ClarificationOutputSchema = z.object({
  questions: z.array(ClarificationLLMQuestionSchema).max(8),
  assumptions: z.array(AssumptionStatementSchema).max(6),
}).strict()

// ── §15.4 Memory Agent — MemoryAgentOutputSchema ──────────────────────────────

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
  ] as const),
  expiresAfterDays: z.number().int().min(1).max(365).nullable(),
}).strict()

/** Empty array is a normal, successful output. */
export const MemoryAgentOutputSchema = z.array(ExtractedMemoryFactSchema).max(10)

// ── §15.5 Decision Engine — DecisionResultSchema (persistence boundary) ───────

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

// ── Inferred types ────────────────────────────────────────────────────────────

export type ExtractedContextValidated  = z.infer<typeof ExtractedContextSchema>
export type SituationContextValidated  = z.infer<typeof SituationContextSchema>
export type ClarificationLLMQuestionValidated = z.infer<typeof ClarificationLLMQuestionSchema>
export type AssumptionStatementValidated = z.infer<typeof AssumptionStatementSchema>
export type ClarificationOutputValidated = z.infer<typeof ClarificationOutputSchema>
export type ToolAgentOutputValidated   = z.infer<typeof ToolAgentOutputSchema>
export type ExtractedMemoryFactValidated = z.infer<typeof ExtractedMemoryFactSchema>
export type MemoryAgentOutputValidated = z.infer<typeof MemoryAgentOutputSchema>
export type DecisionResultValidated    = z.infer<typeof DecisionResultSchema>
