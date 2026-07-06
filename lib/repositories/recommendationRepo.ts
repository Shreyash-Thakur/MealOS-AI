/**
 * lib/repositories/recommendationRepo.ts
 * MealOS AI — Recommendation Repository
 *
 * Typed data-access layer for the `recommendations` table.
 *
 * Immutability contract:
 *   Recommendations are immutable after creation. The Planning Agent writes
 *   exactly one row per situation; no update path exists. All callers that
 *   need to "modify" a recommendation must create a new situation.
 *
 * 1:1 relationship:
 *   Each situation has at most one recommendation (enforced by the UNIQUE
 *   constraint on situation_id). Writes use createRecommendation; reads
 *   use either the situation_id or the recommendation_id as the lookup key.
 */

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { Recommendation, UserAction, PrimaryPath } from "@prisma/client";

/** Shorthand for Prisma's JSON input type. */
type JsonInput = Prisma.InputJsonValue;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Full recommendation row. Returned by detail views. */
export type RecommendationRow = Recommendation;

/** Recommendation with recent user actions. Used by the Situation Board. */
export type RecommendationWithActions = Recommendation & {
  actions: Pick<UserAction, "actionType" | "rating" | "createdAt">[];
};

export interface CreateRecommendationInput {
  situationId: string;
  userId: string;
  comparisonScores: unknown;
  primaryPath: PrimaryPath;
  explanation: string;
  confidenceScore: number;
  title: string;
  estimatedCost: number;
  estimatedTimeMin: number;
  calories?: number | null;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
  youtubeUrl?: string | null;
  recipeSteps?: unknown | null;
  instamartItems?: unknown | null;
  swiggyData?: unknown | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Read operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the recommendation for a given situation (by situation_id).
 * Uses the `recommendations_situation_id_key` UNIQUE index — O(1).
 * Includes the 5 most recent user actions for the board view.
 */
export async function getRecommendationBySituationId(
  situationId: string,
  userId: string
): Promise<RecommendationWithActions | null> {
  return db.recommendation.findFirst({
    where: { situationId, userId },
    include: {
      actions: {
        where: { userId },
        select: { actionType: true, rating: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  }) as Promise<RecommendationWithActions | null>;
}

/**
 * Fetch a recommendation by its own ID.
 * Used by GET /api/v1/recommendations/:id.
 * Includes the 5 most recent user actions for the board view.
 */
export async function getRecommendationById(
  recommendationId: string,
  userId: string
): Promise<RecommendationWithActions | null> {
  return db.recommendation.findFirst({
    where: { id: recommendationId, userId },
    include: {
      actions: {
        where: { userId },
        select: { actionType: true, rating: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  }) as Promise<RecommendationWithActions | null>;
}

/**
 * Fetch a minimal recommendation for history list rendering.
 * Does not include JSONB execution data columns — those are only needed
 * on the full board view.
 */
export async function getRecommendationSummaryById(
  recommendationId: string,
  userId: string
): Promise<Pick<
  Recommendation,
  "id" | "primaryPath" | "title" | "estimatedCost" | "confidenceScore" | "createdAt"
> | null> {
  return db.recommendation.findFirst({
    where: { id: recommendationId, userId },
    select: {
      id: true,
      primaryPath: true,
      title: true,
      estimatedCost: true,
      confidenceScore: true,
      createdAt: true,
    },
  });
}

/**
 * Fetch the user's recent recommendations, ordered by created_at DESC.
 * Uses `recommendations_user_id_created_at_idx`. Used by the history page
 * and Memory Agent behavioral summary.
 */
export async function getRecentRecommendationsForUser(
  userId: string,
  limit = 10
): Promise<Pick<
  Recommendation,
  | "id"
  | "situationId"
  | "primaryPath"
  | "title"
  | "estimatedCost"
  | "confidenceScore"
  | "createdAt"
>[]> {
  return db.recommendation.findMany({
    where: { userId },
    select: {
      id: true,
      situationId: true,
      primaryPath: true,
      title: true,
      estimatedCost: true,
      confidenceScore: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * Aggregate the winning primary path distribution for a user.
 * Uses `recommendations_user_id_primary_path_idx`.
 * Powers the Memory Agent's behavioral summary ("user usually orders").
 */
export async function getPrimaryPathDistribution(
  userId: string
): Promise<{ primaryPath: PrimaryPath; _count: { primaryPath: number } }[]> {
  const rows = await db.recommendation.groupBy({
    by: ["primaryPath"],
    where: { userId },
    _count: { primaryPath: true },
  });
  return rows.sort((a, b) => b._count.primaryPath - a._count.primaryPath);
}

// ─────────────────────────────────────────────────────────────────────────────
// Write operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create the recommendation row produced by the Planning Agent.
 * Called once per situation when the agent pipeline completes.
 * Returns the recommendation ID for the SSE `plan_ready` event payload.
 */
export async function createRecommendation(
  input: CreateRecommendationInput
): Promise<Pick<Recommendation, "id" | "createdAt">> {
  return db.recommendation.create({
    data: {
      situationId: input.situationId,
      userId: input.userId,
      comparisonScores: input.comparisonScores as JsonInput,
      primaryPath: input.primaryPath,
      explanation: input.explanation,
      confidenceScore: input.confidenceScore,
      title: input.title,
      estimatedCost: input.estimatedCost,
      estimatedTimeMin: input.estimatedTimeMin,
      calories: input.calories ?? null,
      proteinG: input.proteinG ?? null,
      carbsG: input.carbsG ?? null,
      fatG: input.fatG ?? null,
      youtubeUrl: input.youtubeUrl ?? null,
      recipeSteps:
        input.recipeSteps != null ? (input.recipeSteps as JsonInput) : Prisma.DbNull,
      instamartItems:
        input.instamartItems != null ? (input.instamartItems as JsonInput) : Prisma.DbNull,
      swiggyData:
        input.swiggyData != null ? (input.swiggyData as JsonInput) : Prisma.DbNull,
    },
    select: { id: true, createdAt: true },
  });
}
