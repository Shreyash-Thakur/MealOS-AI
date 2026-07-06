/**
 * lib/repositories/userRepo.ts
 * MealOS AI — User Repository
 *
 * Typed data-access layer for the `users` table.
 * All writes use the internal UUID (id). The auth middleware resolves
 * clerk_id → internal UUID once; callers downstream only pass internal UUIDs.
 */

import { db } from "@/lib/db";
import type { User } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Read operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a Clerk user ID to the internal user record.
 * Called on every authenticated request by auth middleware.
 * Uses the `users_clerk_id_key` unique index — O(1) lookup.
 */
export async function findUserByClerkId(
  clerkId: string
): Promise<Pick<User, "id" | "email" | "name"> | null> {
  return db.user.findUnique({
    where: { clerkId },
    select: { id: true, email: true, name: true },
  });
}

/**
 * Fetch the full user row by internal UUID.
 * Used by profile endpoints and admin tooling.
 */
export async function findUserById(userId: string): Promise<User | null> {
  return db.user.findUnique({
    where: { id: userId },
  });
}

/**
 * Fetch user by email. Used during sign-up deduplication.
 * Uses the `users_email_key` unique index.
 */
export async function findUserByEmail(
  email: string
): Promise<Pick<User, "id" | "clerkId" | "email"> | null> {
  return db.user.findUnique({
    where: { email },
    select: { id: true, clerkId: true, email: true },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Write operations
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateUserInput {
  id?: string;
  clerkId: string;
  email: string;
  name?: string;
  phone?: string;
}

/**
 * Create a new user row. Called by the Clerk webhook handler (`user.created`)
 * or lazily on the first authenticated API request.
 * Returns the minimal fields needed by downstream middleware.
 */
export async function createUser(
  input: CreateUserInput
): Promise<Pick<User, "id" | "email" | "name">> {
  return db.user.create({
    data: {
      ...(input.id ? { id: input.id } : {}),
      clerkId: input.clerkId,
      email: input.email,
      name: input.name ?? null,
      phone: input.phone ?? null,
    },
    select: { id: true, email: true, name: true },
  });
}

export interface UpsertUserInput {
  clerkId: string;
  email: string;
  name?: string;
  phone?: string;
}

/**
 * Upsert a user by clerk_id. Safe to call from both the webhook handler and
 * the lazy-create path on first request. Idempotent.
 */
export async function upsertUserByClerkId(
  input: UpsertUserInput
): Promise<Pick<User, "id" | "email" | "name">> {
  return db.user.upsert({
    where: { clerkId: input.clerkId },
    create: {
      clerkId: input.clerkId,
      email: input.email,
      name: input.name ?? null,
      phone: input.phone ?? null,
    },
    update: {
      email: input.email,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
    },
    select: { id: true, email: true, name: true },
  });
}

export interface UpdateUserInput {
  name?: string;
  phone?: string;
}

/**
 * Update mutable profile fields (name, phone). Called when the user
 * edits their profile in the MealOS app.
 */
export async function updateUser(
  userId: string,
  input: UpdateUserInput
): Promise<Pick<User, "id" | "email" | "name" | "updatedAt">> {
  return db.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
    },
    select: { id: true, email: true, name: true, updatedAt: true },
  });
}

/**
 * Touch `last_active_at` for DAU/WAU analytics.
 * Called after every successful authenticated request.
 * Fire-and-forget — callers should not await if latency matters.
 */
export async function touchLastActive(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { lastActiveAt: new Date() },
    select: { id: true },
  });
}
