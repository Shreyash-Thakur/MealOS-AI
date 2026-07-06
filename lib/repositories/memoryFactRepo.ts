/**
 * lib/repositories/memoryFactRepo.ts
 * MealOS AI — User Memory Facts Repository
 *
 * Typed data-access layer for the `user_memory_facts` table.
 *
 * Concurrency contract:
 *   All writes use UPSERT ON CONFLICT (user_id, fact_key). This is the only
 *   correct write pattern — direct INSERT without upsert will violate the
 *   @@unique([userId, factKey]) constraint and must not be used.
 *
 * Write authority:
 *   Only the Memory Service may call write functions in this module.
 *   (lib/services/memory/ is the sole authorized writer per BACKEND_DESIGN.md §12.)
 */

import { db } from "@/lib/db";
import type { UserMemoryFact, MemorySource, Prisma } from "@prisma/client";

/** Shorthand for Prisma's JSON input type — avoids verbose cast repetition. */
type JsonInput = Prisma.InputJsonValue;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal fact shape returned by most read paths. */
export type FactSummary = Pick<
  UserMemoryFact,
  "factKey" | "factValue" | "confidence" | "source"
>;

/** Full fact row including audit fields. Returned by detailed reads. */
export type FactRow = UserMemoryFact;

export interface UpsertFactInput {
  userId: string;
  factKey: string;
  factValue: unknown;
  source: MemorySource;
  confidence: number;
  timesConfirmed: number;
  lastConfirmedAt?: Date | null;
  expiresAt?: Date | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Read operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all non-expired memory facts for a user.
 * Called by the Context Agent before every planning pass to build
 * `SituationContext.fromMemory`. Uses the `(user_id, expires_at)` index.
 *
 * Returns facts ordered by confidence desc so highest-confidence facts
 * are consumed first when the caller builds the context object.
 */
export async function getFactsForUser(userId: string): Promise<FactSummary[]> {
  return db.userMemoryFact.findMany({
    where: {
      userId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: {
      factKey: true,
      factValue: true,
      confidence: true,
      source: true,
    },
    orderBy: { confidence: "desc" },
  });
}

/**
 * Fetch all non-expired memory facts for a user — full rows including audit fields.
 * Used by the Memory Panel view endpoint.
 */
export async function getFactRowsForUser(userId: string): Promise<FactRow[]> {
  return db.userMemoryFact.findMany({
    where: {
      userId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { confidence: "desc" },
  });
}

/**
 * Fetch a single memory fact by the composite key (user_id, fact_key).
 * Called by the Clarification Engine to check whether a question can be
 * skipped because the answer is already known with sufficient confidence.
 * Uses the `@@unique([userId, factKey])` index — O(1), < 1 ms.
 */
export async function getFactByKey(
  userId: string,
  factKey: string
): Promise<FactSummary | null> {
  return db.userMemoryFact.findUnique({
    where: {
      userId_factKey: { userId, factKey },
    },
    select: {
      factKey: true,
      factValue: true,
      confidence: true,
      source: true,
    },
  });
}

/**
 * Fetch a single fact's full row. Used when the caller needs audit fields
 * (timesConfirmed, lastConfirmedAt, expiresAt) in addition to the value.
 */
export async function getFactRowByKey(
  userId: string,
  factKey: string
): Promise<FactRow | null> {
  return db.userMemoryFact.findUnique({
    where: {
      userId_factKey: { userId, factKey },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Write operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upsert a single memory fact.
 *
 * Create path: inserts the full row with the provided confidence and timesConfirmed.
 * Update path: updates the value and increments timesConfirmed by 1;
 *   confidence is incremented by 0.05 (AGENT_INFERRED increment rule) —
 *   callers that want exact control should pass a pre-computed confidence delta
 *   by calling upsertFactRaw instead.
 *
 * Compiles to a single `INSERT ... ON CONFLICT DO UPDATE` (Prisma upsert).
 */
export async function upsertFact(input: UpsertFactInput): Promise<FactRow> {
  return db.userMemoryFact.upsert({
    where: {
      userId_factKey: { userId: input.userId, factKey: input.factKey },
    },
    create: {
      userId: input.userId,
      factKey: input.factKey,
      factValue: input.factValue as JsonInput,
      source: input.source,
      confidence: input.confidence,
      timesConfirmed: input.timesConfirmed,
      lastConfirmedAt: input.lastConfirmedAt ?? null,
      expiresAt: input.expiresAt ?? null,
    },
    update: {
      factValue: input.factValue as JsonInput,
      source: input.source,
      timesConfirmed: { increment: 1 },
      confidence: { increment: 0.05 },
      lastConfirmedAt: input.lastConfirmedAt ?? new Date(),
      expiresAt: input.expiresAt ?? null,
    },
  });
}

/**
 * Upsert a memory fact with full control over the update expression.
 * Used by the onboarding flow and user-edit paths where confidence must
 * be set to an exact value (1.0) rather than incremented.
 */
export async function upsertFactExact(input: UpsertFactInput): Promise<FactRow> {
  return db.userMemoryFact.upsert({
    where: {
      userId_factKey: { userId: input.userId, factKey: input.factKey },
    },
    create: {
      userId: input.userId,
      factKey: input.factKey,
      factValue: input.factValue as JsonInput,
      source: input.source,
      confidence: input.confidence,
      timesConfirmed: input.timesConfirmed,
      lastConfirmedAt: input.lastConfirmedAt ?? null,
      expiresAt: input.expiresAt ?? null,
    },
    update: {
      factValue: input.factValue as JsonInput,
      source: input.source,
      confidence: input.confidence,
      timesConfirmed: input.timesConfirmed,
      lastConfirmedAt: input.lastConfirmedAt ?? new Date(),
      expiresAt: input.expiresAt ?? null,
    },
  });
}

/**
 * Upsert multiple facts in a single Prisma interactive transaction.
 * Used by the onboarding write path and Memory Agent post-execution batch.
 *
 * Transactional: all-or-nothing. If any upsert fails the entire batch rolls back.
 * Each individual upsert is idempotent on the (userId, factKey) pair.
 */
export async function upsertFactsBatch(
  inputs: UpsertFactInput[],
  exact = false
): Promise<FactRow[]> {
  return db.$transaction(
    inputs.map((input) =>
      db.userMemoryFact.upsert({
        where: {
          userId_factKey: { userId: input.userId, factKey: input.factKey },
        },
        create: {
          userId: input.userId,
          factKey: input.factKey,
          factValue: input.factValue as JsonInput,
          source: input.source,
          confidence: input.confidence,
          timesConfirmed: input.timesConfirmed,
          lastConfirmedAt: input.lastConfirmedAt ?? null,
          expiresAt: input.expiresAt ?? null,
        },
        update: exact
          ? {
              factValue: input.factValue as JsonInput,
              source: input.source,
              confidence: input.confidence,
              timesConfirmed: input.timesConfirmed,
              lastConfirmedAt: input.lastConfirmedAt ?? new Date(),
              expiresAt: input.expiresAt ?? null,
            }
          : {
              factValue: input.factValue as JsonInput,
              source: input.source,
              timesConfirmed: { increment: 1 },
              confidence: { increment: 0.05 },
              lastConfirmedAt: input.lastConfirmedAt ?? new Date(),
              expiresAt: input.expiresAt ?? null,
            },
      })
    )
  );
}

/**
 * Delete a specific memory fact by key. Used by the Memory Panel when the
 * user explicitly removes a fact (DELETE action on an editable fact).
 */
export async function deleteFact(
  userId: string,
  factKey: string
): Promise<void> {
  await db.userMemoryFact.delete({
    where: {
      userId_factKey: { userId, factKey },
    },
  });
}

/**
 * Hard-delete all expired facts globally. Used by the nightly background job.
 * Targets the `(user_id, expires_at)` index for an efficient bulk scan.
 * Returns the count of deleted rows for logging.
 */
export async function deleteExpiredFacts(): Promise<number> {
  const { count } = await db.userMemoryFact.deleteMany({
    where: {
      expiresAt: { lte: new Date() },
    },
  });
  return count;
}

/**
 * Delete all memory facts for a user. Used in tests and admin tooling.
 * Cascade deletes on the `users` table handle this automatically for
 * production user deletion flows — this is for explicit fact-clearing.
 */
export async function deleteAllFactsForUser(userId: string): Promise<number> {
  const { count } = await db.userMemoryFact.deleteMany({
    where: { userId },
  });
  return count;
}
