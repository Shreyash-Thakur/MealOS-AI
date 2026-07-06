/**
 * MealOS AI — SSE Event Schemas
 * Source: docs/SCHEMAS.md §14
 *
 * One schema per event on GET /api/v1/situations/:id/stream.
 * All .strict() — models and servers emitting unknown fields is a schema failure.
 * Unknown event names are ignored by clients (additive versioning).
 */

import { z } from 'zod'
import {
  zUuid,
  zIsoDateTime,
  zSituationType,
  zPlanType,
  zService,
  zRupees,
  zMinutes,
  zConfidencePercent,
  ClarificationQuestionSchema,
} from './primitives'
import { zErrorCode } from './api'

// ── Event Schemas ─────────────────────────────────────────────────────────────

export const ContextUnderstoodEventSchema = z.object({
  situation_type: zSituationType,
  understood_as: z.string().min(1).max(300),
  confidence: zConfidencePercent,             // integer 0–100 (SCHEMAS.md §1)
  known_fields: z.array(z.string().max(60)).max(30),
  assumptions: z.array(z.object({
    field: z.string().max(60),
    value: z.union([z.string().max(300), z.number(), z.boolean()]),
    source: z.enum(['memory', 'inference', 'time_of_day'] as const),
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
  agents_running: z.array(z.enum(['swiggy', 'recipe', 'budget', 'nutrition'] as const)).min(1),
  estimated_seconds: z.number().int().min(1).max(60),
}).strict()

export const AgentProgressEventSchema = z.object({
  agent: z.enum(['swiggy', 'recipe', 'budget', 'nutrition', 'planning'] as const),
  status: z.enum(['completed', 'failed', 'skipped'] as const),
  message: z.string().min(1).max(300),
  partial_data: z.unknown().optional(),      // unstable — clients must not depend on it
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
  fallback_type: z.enum(['recipe_only', 'generic_suggestion'] as const).optional(),
  situation_id: zUuid,
}).strict()

export const HeartbeatEventSchema = z.object({
  ts: zIsoDateTime,
}).strict()

/**
 * Envelope keyed by SSE `event:` name — the full stream vocabulary.
 * Use SSEEventSchemas[eventName].parse(JSON.parse(e.data)) to validate.
 */
export const SSEEventSchemas = {
  context_understood:   ContextUnderstoodEventSchema,
  clarification_needed: ClarificationNeededEventSchema,
  planning_started:     PlanningStartedEventSchema,
  agent_progress:       AgentProgressEventSchema,
  plan_ready:           PlanReadyEventSchema,
  error:                StreamErrorEventSchema,
  heartbeat:            HeartbeatEventSchema,
} as const
