/**
 * lib/repositories/situationRepo.ts
 * MealOS AI — Situation Repository
 *
 * Typed data-access layer for the `situations` table.
 *
 * State-machine contract:
 *   Only the Conversation Service may advance situations.status.
 *   Every status transition writes the corresponding timestamp column atomically.
 *   All status-update functions enforce this by accepting only the columns
 *   appropriate for that specific transition — callers cannot skip timestamps.
 *
 * State machine:
 *   CREATED → CLARIFYING → CONTEXT_READY → PLANNING → PLAN_READY → EXECUTING → COMPLETED
 *                        ↗                                                    ↘
 *              (skip CLARIFYING if no clarification needed)                 ABANDONED
 */

import { db } from "@/lib/db";
import { SituationStatus, Prisma } from "@prisma/client";
import type { Situation, SituationType, Recommendation } from "@prisma/client";

/** Shorthand for Prisma's JSON input type. */
type JsonInput = Prisma.InputJsonValue;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal fields returned after creating a situation. Feeds the SSE stream URL. */
export type SituationCreated = Pick<Situation, "id" | "createdAt">;

/** Situation row with its nested recommendation. Used by history and board views. */
export type SituationWithRecommendation = Situation & {
  recommendation: Pick<
    Recommendation,
    "primaryPath" | "title" | "estimatedCost" | "confidenceScore"
  > | null;
};

/** Pagination cursor for keyset pagination on the history page. */
export interface SituationHistoryCursor {
  id: string;
}

export interface CreateSituationInput {
  userId: string;
  rawInput: string;
  lat?: number | null;
  lng?: number | null;
}

export interface TransitionToClarifyingInput {
  clarificationData: unknown;
}

export interface TransitionToContextReadyInput {
  context: unknown;
  clarificationData?: unknown | null;
  situationType?: SituationType | null;
}

export interface TransitionToPlanningInput {
  situationType?: SituationType | null;
}

export interface TransitionToPlanReadyInput {
  situationType?: SituationType | null;
}

/** No additional fields beyond status + completedAt. */
export type TransitionToCompletedInput = Record<string, never>;

// ─────────────────────────────────────────────────────────────────────────────
// Read operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a full situation row by ID, scoped to the owner.
 * Used by GET /api/v1/situations/:id and SSE stream setup.
 */
export async function getSituationById(
  situationId: string,
  userId: string
): Promise<Situation | null> {
  return db.situation.findFirst({
    where: { id: situationId, userId },
  });
}

/**
 * Fetch a situation with its nested recommendation for the Situation Board.
 * Uses the `recommendations_situation_id_key` unique index via the Prisma relation.
 */
export async function getSituationWithRecommendation(
  situationId: string,
  userId: string
): Promise<SituationWithRecommendation | null> {
  return db.situation.findFirst({
    where: { id: situationId, userId },
    include: {
      recommendation: {
        select: {
          primaryPath: true,
          title: true,
          estimatedCost: true,
          confidenceScore: true,
        },
      },
    },
  });
}

/**
 * Fetch the user's active situation (any status that is not COMPLETED or ABANDONED).
 * Used by auth middleware on every app load to determine whether to resume a situation.
 * Uses the `situations_user_id_status_idx` composite index.
 */
export async function getActiveSituation(
  userId: string
): Promise<Pick<Situation, "id" | "status" | "situationType"> | null> {
  return db.situation.findFirst({
    where: {
      userId,
      status: {
        notIn: [SituationStatus.COMPLETED, SituationStatus.ABANDONED],
      },
    },
    select: { id: true, status: true, situationType: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Paginated history of completed and abandoned situations for a user.
 * Uses `situations_user_id_created_at_idx` for the filter+sort in one scan.
 * Cursor-based pagination avoids OFFSET performance degradation.
 */
export async function getSituationHistory(
  userId: string,
  limit = 20,
  cursor?: SituationHistoryCursor
): Promise<SituationWithRecommendation[]> {
  return db.situation.findMany({
    where: {
      userId,
      status: { in: [SituationStatus.COMPLETED, SituationStatus.ABANDONED] },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor.id } : undefined,
    select: {
      id: true,
      userId: true,
      rawInput: true,
      situationType: true,
      context: true,
      status: true,
      clarificationData: true,
      createdAt: true,
      updatedAt: true,
      contextReadyAt: true,
      planReadyAt: true,
      completedAt: true,
      lat: true,
      lng: true,
      recommendation: {
        select: {
          primaryPath: true,
          title: true,
          estimatedCost: true,
          confidenceScore: true,
        },
      },
    },
  }) as Promise<SituationWithRecommendation[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Write operations — state machine transitions
// Each function advances the state exactly one step and writes the matching timestamp.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new situation row immediately on POST /api/v1/situations.
 * Status defaults to CREATED.
 */
export async function createSituation(
  input: CreateSituationInput
): Promise<SituationCreated> {
  return db.situation.create({
    data: {
      userId: input.userId,
      rawInput: input.rawInput.trim(),
      status: SituationStatus.CREATED,
      lat: input.lat != null ? input.lat : null,
      lng: input.lng != null ? input.lng : null,
    },
    select: { id: true, createdAt: true },
  });
}

/**
 * CREATED → CLARIFYING
 * Records the clarification questions sent to the user in the first pass.
 */
export async function transitionToClarifying(
  situationId: string,
  input: TransitionToClarifyingInput
): Promise<Pick<Situation, "id" | "status">> {
  return db.situation.update({
    where: { id: situationId },
    data: {
      status: SituationStatus.CLARIFYING,
      clarificationData: input.clarificationData as JsonInput,
    },
    select: { id: true, status: true },
  });
}

/**
 * CLARIFYING → CONTEXT_READY  (or CREATED → CONTEXT_READY if no clarification needed)
 * Persists the fully resolved SituationContext and marks the timestamp.
 */
export async function transitionToContextReady(
  situationId: string,
  input: TransitionToContextReadyInput
): Promise<Pick<Situation, "id" | "status">> {
  return db.situation.update({
    where: { id: situationId },
    data: {
      status: SituationStatus.CONTEXT_READY,
      context: input.context as JsonInput,
      ...(input.clarificationData !== undefined
        ? {
            clarificationData:
              input.clarificationData === null
                ? Prisma.DbNull
                : (input.clarificationData as JsonInput),
          }
        : {}),
      ...(input.situationType !== undefined
        ? { situationType: input.situationType }
        : {}),
      contextReadyAt: new Date(),
    },
    select: { id: true, status: true },
  });
}

/**
 * CONTEXT_READY → PLANNING
 * Marks the situation as entering the planning phase.
 */
export async function transitionToPlanning(
  situationId: string,
  input: TransitionToPlanningInput = {}
): Promise<Pick<Situation, "id" | "status">> {
  return db.situation.update({
    where: { id: situationId },
    data: {
      status: SituationStatus.PLANNING,
      ...(input.situationType !== undefined
        ? { situationType: input.situationType }
        : {}),
    },
    select: { id: true, status: true },
  });
}

/**
 * PLANNING → PLAN_READY
 * Records that the Planning Agent has completed and written the recommendation row.
 */
export async function transitionToPlanReady(
  situationId: string,
  input: TransitionToPlanReadyInput = {}
): Promise<Pick<Situation, "id" | "status">> {
  return db.situation.update({
    where: { id: situationId },
    data: {
      status: SituationStatus.PLAN_READY,
      planReadyAt: new Date(),
      ...(input.situationType !== undefined
        ? { situationType: input.situationType }
        : {}),
    },
    select: { id: true, status: true },
  });
}

/**
 * PLAN_READY → EXECUTING
 * Marks the situation as in progress of execution (user tapped an action button).
 */
export async function transitionToExecuting(
  situationId: string
): Promise<Pick<Situation, "id" | "status">> {
  return db.situation.update({
    where: { id: situationId },
    data: { status: SituationStatus.EXECUTING },
    select: { id: true, status: true },
  });
}

/**
 * EXECUTING → COMPLETED
 * Terminal success state. Records completedAt.
 * Called atomically alongside userActionRepo.createAction (see userActionRepo.ts).
 */
export async function transitionToCompleted(
  situationId: string
): Promise<Pick<Situation, "id" | "status">> {
  return db.situation.update({
    where: { id: situationId },
    data: {
      status: SituationStatus.COMPLETED,
      completedAt: new Date(),
    },
    select: { id: true, status: true },
  });
}

/**
 * Any non-terminal state → ABANDONED
 * Terminal failure/timeout state. Used when the user navigates away,
 * when a clarification expires, or when the pipeline fails unrecoverably.
 */
export async function transitionToAbandoned(
  situationId: string
): Promise<Pick<Situation, "id" | "status">> {
  return db.situation.update({
    where: { id: situationId },
    data: { status: SituationStatus.ABANDONED },
    select: { id: true, status: true },
  });
}

/**
 * Update the situation's clarification_data in place.
 * Called when the second clarification pass is appended to an existing passes array.
 */
export async function updateClarificationData(
  situationId: string,
  clarificationData: unknown
): Promise<Pick<Situation, "id">> {
  return db.situation.update({
    where: { id: situationId },
    data: {
      clarificationData: clarificationData as JsonInput,
    },
    select: { id: true },
  });
}

/**
 * Set the situationType on a situation row.
 * Called by the Conversation Agent after intent extraction completes.
 */
export async function setSituationType(
  situationId: string,
  situationType: SituationType
): Promise<Pick<Situation, "id" | "situationType">> {
  return db.situation.update({
    where: { id: situationId },
    data: { situationType },
    select: { id: true, situationType: true },
  });
}
