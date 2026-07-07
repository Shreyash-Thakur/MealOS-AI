/**
 * GET  /api/v1/memory  — full memory state for the authenticated user
 * PATCH /api/v1/memory — edit or delete individual memory facts
 */

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import {
  getFactRowsForUser,
  upsertFactExact,
  deleteFact,
  getFactRowByKey,
} from '@/lib/repositories/memoryFactRepo'
import type { UpsertFactInput } from '@/lib/repositories/memoryFactRepo'
import { PatchMemoryRequestSchema, FactValueSchemas } from '@/lib/schemas/api'
import { FACT_META } from '@/lib/memory/factMeta'
import type { FactKey } from '@/types/memory'
import type { FactConfidence } from '@/types/primitives'

// ── Prisma source → domain source ─────────────────────────────────────────────

const PRISMA_TO_DOMAIN: Record<string, string> = {
  ONBOARDING: 'onboarding',
  CLARIFICATION: 'clarification_answer',
  AGENT_INFERRED: 'behavior_inferred',
  USER_EDITED: 'user_edited',
}

const ONBOARDING_REQUIRED_KEYS: FactKey[] = [
  'dietary.restrictions',
  'budget.daily_food_target',
  'kitchen.skill_level',
  'location.home',
]

// ── GET /api/v1/memory ────────────────────────────────────────────────────────

export async function GET(_request: Request): Promise<Response> {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) {
    return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 })
  }

  const user = await db.user.findUnique({ where: { clerkId: clerkUserId } })
  if (!user) {
    return NextResponse.json({ code: 'USER_NOT_FOUND', message: 'User not found' }, { status: 404 })
  }

  const rows = await getFactRowsForUser(user.id)
  const factMap = new Map(rows.map((r) => [r.factKey, r.factValue]))

  // ── Build structured profile ────────────────────────────────────────────────
  const restrictions = factMap.get('dietary.restrictions') as string[] | undefined
  const profile = {
    diet_type: restrictions?.[0] ?? null,
    allergies: (factMap.get('dietary.allergies') as string[] | undefined) ?? [],
    dietary_notes: null,
    household_size: (factMap.get('household.size') as number | undefined) ?? 1,
    cooking_skill: (factMap.get('kitchen.skill_level') as string | undefined) ?? null,
    kitchen_equipment: (factMap.get('kitchen.equipment') as string[] | undefined) ?? [],
    daily_food_budget: (factMap.get('budget.daily_food_target') as number | undefined) ?? null,
    dining_out_budget: (factMap.get('budget.dining_out_budget') as number | undefined) ?? null,
    daily_protein_target: (factMap.get('fitness.protein_target') as number | undefined) ?? null,
    daily_calorie_target: (factMap.get('fitness.calorie_target') as number | undefined) ?? null,
    gym_days: (factMap.get('fitness.gym_days') as string[] | undefined) ?? [],
    preferred_cuisines: (factMap.get('preference.cuisines.liked') as string[] | undefined) ?? [],
    disliked_cuisines: (factMap.get('preference.cuisines.disliked') as string[] | undefined) ?? [],
    home_address: (factMap.get('location.home') as string | undefined) ?? null,
    work_address: (factMap.get('location.work') as string | undefined) ?? null,
  }

  // ── Map rows to MemoryFactView (snake_case for wire format) ─────────────────
  const facts = rows
    .filter((r) => r.factKey in FACT_META)
    .map((r) => {
      const key = r.factKey as FactKey
      const meta = FACT_META[key]
      return {
        id: r.id,
        key,
        value: r.factValue,
        fact_type: meta.factType,
        source: PRISMA_TO_DOMAIN[r.source] ?? 'behavior_inferred',
        confidence: r.confidence as FactConfidence,
        last_confirmed_at: (r.lastConfirmedAt ?? r.updatedAt).toISOString(),
        expires_at: r.expiresAt?.toISOString() ?? null,
        editable: r.source !== 'AGENT_INFERRED',
        display_label: meta.label,
        display_category: meta.category,
      }
    })

  // ── Computed fields ─────────────────────────────────────────────────────────
  const storedKeys = new Set(rows.map((r) => r.factKey))
  const onboardingComplete = ONBOARDING_REQUIRED_KEYS.every((k) => storedKeys.has(k))
  const lastUpdatedAt = rows.length > 0
    ? new Date(Math.max(...rows.map((r) => r.updatedAt.getTime()))).toISOString()
    : new Date().toISOString()

  return NextResponse.json({
    profile,
    facts,
    last_updated_at: lastUpdatedAt,
    fact_count: rows.length,
    onboarding_complete: onboardingComplete,
  })
}

// ── PATCH /api/v1/memory ──────────────────────────────────────────────────────

export async function PATCH(request: Request): Promise<Response> {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) {
    return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 })
  }

  const user = await db.user.findUnique({ where: { clerkId: clerkUserId } })
  if (!user) {
    return NextResponse.json({ code: 'USER_NOT_FOUND', message: 'User not found' }, { status: 404 })
  }

  const parsed = PatchMemoryRequestSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { code: 'INVALID_UPDATE_PAYLOAD', message: parsed.error.message },
      { status: 400 },
    )
  }

  let updated = 0
  let created = 0
  let deleted = 0
  const failures: { key: string; code: string; message: string }[] = []

  for (const update of parsed.data.updates) {
    const key = update.key as FactKey

    if (update.value === null) {
      // Delete path
      try {
        await deleteFact(user.id, key)
        deleted++
      } catch (err) {
        const code = (err as { code?: string }).code
        if (code === 'P2025') {
          failures.push({ key, code: 'ITEM_NOT_FOUND', message: 'Fact not found' })
        } else {
          failures.push({ key, code: 'SERVICE_UNAVAILABLE', message: 'Failed to delete fact' })
        }
      }
    } else {
      // Update/create path
      const existing = await getFactRowByKey(user.id, key)

      if (existing?.source === 'AGENT_INFERRED') {
        failures.push({ key, code: 'FACT_NOT_EDITABLE', message: 'This fact was inferred and cannot be edited directly' })
        continue
      }

      const validator = FactValueSchemas[key]
      if (validator) {
        const result = validator.safeParse(update.value)
        if (!result.success) {
          failures.push({ key, code: 'INVALID_VALUE_TYPE', message: result.error.message })
          continue
        }
      }

      const input: UpsertFactInput = {
        userId: user.id,
        factKey: key,
        factValue: update.value,
        source: 'USER_EDITED',
        confidence: 1.0,
        timesConfirmed: 1,
      }
      await upsertFactExact(input)
      existing ? updated++ : created++
    }
  }

  return NextResponse.json({ updated, created, deleted, failures })
}
