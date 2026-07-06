/**
 * lib/repositories/userActionRepo.ts
 * MealOS AI — User Action Repository
 *
 * Typed data-access layer for the `user_actions` table.
 *
 * Action trail contract:
 *   One recommendation can have multiple user_actions (dismiss → modify → execute).
 *   The full action trail is preserved — no deduplication or overwrite on the action row.
 *   Rating is a separate update, applied asynchronously after the post-meal feedback flow.
 *
 * Atomicity pattern:
 *   logAction and completeActionWithSituationTransition both involve writing an action
 *   AND updating the parent situation. The transactional variant must be preferred when
 *   strict consistency between the action row and the situation's COMPLETED state is required.
 */

import { db } from "@/lib/db";
import { SituationStatus } from "@prisma/client";
import type { UserAction, ActionType } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type UserActionRow = UserAction;

export interface CreateActionInput {
  userId: string;
  situationId: string;
  recommendationId: string;
  actionType: ActionType;
  externalOrderId?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Read operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a user's action history, ordered by created_at DESC.
 * Uses `user_actions_user_id_created_at_idx`.
 * Used by the history page and Memory Agent extraction input.
 */
export async function getActionsForUser(
  userId: string,
  limit = 20
): Promise<Pick<UserAction, "id" | "situationId" | "recommendationId" | "actionType" | "rating" | "createdAt">[]> {
  return db.userAction.findMany({
    where: { userId },
    select: {
      id: true,
      situationId: true,
      recommendationId: true,
      actionType: true,
      rating: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * Fetch all actions for a given recommendation.
 * Uses `user_actions_recommendation_id_idx`.
 * Used by the recommendation detail view and the Memory Agent.
 */
export async function getActionsForRecommendation(
  recommendationId: string,
  userId: string
): Promise<Pick<UserAction, "id" | "actionType" | "rating" | "createdAt">[]> {
  return db.userAction.findMany({
    where: { recommendationId, userId },
    select: { id: true, actionType: true, rating: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Fetch actions grouped by action type for a user.
 * Uses `user_actions_user_id_action_type_idx`.
 * Used by the Memory Agent to aggregate execution history by type
 * (e.g., "user executes cook 70% of the time").
 */
export async function getActionTypeDistribution(
  userId: string
): Promise<{ actionType: ActionType; _count: { actionType: number } }[]> {
  const rows = await db.userAction.groupBy({
    by: ["actionType"],
    where: { userId },
    _count: { actionType: true },
  });
  return rows.sort((a, b) => b._count.actionType - a._count.actionType);
}

/**
 * Fetch a single action row by ID.
 */
export async function getActionById(
  actionId: string,
  userId: string
): Promise<UserActionRow | null> {
  return db.userAction.findFirst({
    where: { id: actionId, userId },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Write operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Log a user action (non-transactional).
 * Called when the user taps an action button on the Situation Board.
 * Does NOT mark the situation as COMPLETED — use logActionAndComplete for that.
 */
export async function logAction(
  input: CreateActionInput
): Promise<Pick<UserAction, "id">> {
  return db.userAction.create({
    data: {
      userId: input.userId,
      situationId: input.situationId,
      recommendationId: input.recommendationId,
      actionType: input.actionType,
      externalOrderId: input.externalOrderId ?? null,
    },
    select: { id: true },
  });
}

/**
 * Atomically log a user action AND transition the situation to COMPLETED.
 *
 * This is the recommended write path for terminal actions (EXECUTED_COOK,
 * EXECUTED_ORDER, EXECUTED_DINEOUT). A Prisma interactive transaction ensures
 * the action row and the situation's COMPLETED status are written atomically —
 * neither can succeed without the other.
 *
 * For DISMISSED and MODIFIED actions use logAction() directly; those do not
 * necessarily terminate the situation.
 */
export async function logActionAndComplete(
  input: CreateActionInput
): Promise<{ actionId: string }> {
  const [action] = await db.$transaction([
    db.userAction.create({
      data: {
        userId: input.userId,
        situationId: input.situationId,
        recommendationId: input.recommendationId,
        actionType: input.actionType,
        externalOrderId: input.externalOrderId ?? null,
      },
      select: { id: true },
    }),
    db.situation.update({
      where: { id: input.situationId },
      data: {
        status: SituationStatus.COMPLETED,
        completedAt: new Date(),
      },
      select: { id: true },
    }),
  ]);

  return { actionId: action.id };
}

/**
 * Update the rating on an existing action row.
 * Called asynchronously after the post-meal feedback flow (not in the
 * critical path of the execute request).
 *
 * Application layer must validate 1 ≤ rating ≤ 5 before calling this.
 */
export async function updateActionRating(
  actionId: string,
  userId: string,
  rating: number
): Promise<Pick<UserAction, "id" | "rating" | "updatedAt">> {
  // userId is used for ownership verification via the where clause, not as a data field
  return db.userAction.update({
    where: { id: actionId, userId },
    data: { rating },
    select: { id: true, rating: true, updatedAt: true },
  });
}
