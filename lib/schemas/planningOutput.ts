/**
 * MealOS AI — Planning Agent Output Schema
 * Source: docs/SCHEMAS.md §15.2
 *
 * This file is the gating schema for LLM output from the Planning Agent.
 * No retry on schema failure (fail fast, AGENTS.md §3.1).
 * Path-conditional field presence enforced via superRefine.
 * All objects .strict() — the model must not emit unknown fields.
 *
 * This file is explicitly named in the implementation playbook as a key deliverable
 * that unblocks the engine and Swiggy tracks.
 */

import { z } from 'zod'
import {
  zRupees,
  zMinutes,
  zGrams,
  zKcal,
  zPrimaryPath,
  zConfidenceLevel,
  zSlotLabel,
} from './primitives'

// ── Recommendation sub-object ─────────────────────────────────────────────────

export const PlanningRecommendationSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  estimatedCost: zRupees,
  estimatedTime: zMinutes,
  proteinG: zGrams.optional(),        // only when present in input — never estimated
  calories: zKcal.optional(),

  // COOK path fields
  ingredients: z.array(z.object({
    name: z.string().min(1).max(120),
    qty: z.string().min(1).max(60),
    inPantry: z.boolean(),
  }).strict()).max(40).optional(),
  // 6–8 steps per cook recommendation (ISSUE-141, enforced via min/max)
  recipeSteps: z.array(z.object({
    step: z.number().int().min(1).max(40),
    instruction: z.string().min(1).max(400),
    durationMin: zMinutes,
    // The planning prompt's worked example emits null for steps without a
    // clip — normalize null → undefined so both spellings validate.
    youtubeTimestamp: z.string().regex(/^\d{1,3}:[0-5]\d$/).nullish()
      .transform((v) => v ?? undefined),
  }).strict()).min(6).max(8).optional(),
  youtubeVideoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/).optional(),

  // ORDER path fields
  restaurantName: z.string().max(200).optional(),
  restaurantId: z.string().max(80).optional(),
  menuItems: z.array(z.object({
    name: z.string().max(200),
    price: zRupees,
  }).strict()).max(20).optional(),
  estimatedDeliveryMin: zMinutes.optional(),

  // DINEOUT path fields
  venueName: z.string().max(200).optional(),
  venueId: z.string().max(80).optional(),
  availableSlots: z.array(zSlotLabel).max(20).optional(),
  pricePerPerson: zRupees.optional(),
}).strict()

// ── Top-level Planning Agent output ──────────────────────────────────────────

export const PlanningAgentOutputSchema = z.object({
  explanation: z.string().min(10).max(600),
  primaryPath: zPrimaryPath,
  confidence: zConfidenceLevel,
  recommendation: PlanningRecommendationSchema,
  whyNotAlternatives: z.array(z.object({
    path: zPrimaryPath,
    reason: z.string().min(5).max(300),
  }).strict()).length(2),             // exactly 2 — one per rejected path
  // fallback.md §1 schema addition: present only when the cook-only degraded
  // block was injected into the system prompt (Swiggy MCP fully unavailable)
  degradedMode: z.literal('swiggy_unavailable').nullable().optional(),
}).strict().superRefine((out, ctx) => {
  const r = out.recommendation
  const cookFields = [r.ingredients, r.recipeSteps, r.youtubeVideoId]
  const orderFields = [r.restaurantName, r.restaurantId, r.menuItems, r.estimatedDeliveryMin]
  const dineFields = [r.venueName, r.venueId, r.availableSlots, r.pricePerPerson]
  const present = (fs: unknown[]) => fs.some((f) => f !== undefined)

  if (out.primaryPath === 'cook' && (present(orderFields) || present(dineFields))) {
    ctx.addIssue({ code: 'custom', message: 'cook path must not carry order/dineout fields' })
  }
  if (out.primaryPath === 'cook' && r.recipeSteps === undefined) {
    ctx.addIssue({ code: 'custom', message: 'cook path requires 6–8 recipe steps (ISSUE-141)' })
  }
  if (out.primaryPath === 'order' && (present(cookFields) || present(dineFields))) {
    ctx.addIssue({ code: 'custom', message: 'order path must not carry cook/dineout fields' })
  }
  if (out.primaryPath === 'dineout' && (present(cookFields) || present(orderFields))) {
    ctx.addIssue({ code: 'custom', message: 'dineout path must not carry cook/order fields' })
  }
  if (out.whyNotAlternatives.some((a) => a.path === out.primaryPath)) {
    ctx.addIssue({ code: 'custom', message: 'whyNotAlternatives must not include the winner' })
  }
})

/** Inferred TypeScript type for the validated output */
export type PlanningAgentOutputValidated = z.infer<typeof PlanningAgentOutputSchema>
export type PlanningRecommendationValidated = z.infer<typeof PlanningRecommendationSchema>
