/**
 * POST /api/v1/onboarding
 * Stores the user's initial profile answers as memory facts.
 *
 * Auth:    Clerk (userId required)
 * Body:    OnboardingRequestSchema
 * Returns: 201 OnboardingResponseSchema on success
 */

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { upsertFactsBatch } from '@/lib/repositories/memoryFactRepo'
import type { UpsertFactInput } from '@/lib/repositories/memoryFactRepo'
import { OnboardingRequestSchema } from '@/lib/schemas/api'
import { FACT_EXPIRY_DAYS } from '@/lib/memory/factKeys'
import type { FactKey } from '@/types/memory'

export async function POST(request: Request): Promise<Response> {
  // 1. Auth check
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) {
    return NextResponse.json({ code: 'UNAUTHORIZED', message: 'Authentication required' }, { status: 401 })
  }

  // 2. Validate body
  const parsed = OnboardingRequestSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { code: 'INVALID_ONBOARDING_DATA', message: parsed.error.message },
      { status: 400 },
    )
  }
  const body = parsed.data

  // 3. Resolve internal user
  const user = await db.user.findUnique({ where: { clerkId: clerkUserId } })
  if (!user) {
    return NextResponse.json({ code: 'USER_NOT_FOUND', message: 'User not found' }, { status: 404 })
  }

  // 4. Build fact inputs
  function makeInput(factKey: FactKey, factValue: unknown): UpsertFactInput {
    const expiryDays = FACT_EXPIRY_DAYS[factKey]
    const expiresAt = expiryDays != null ? new Date(Date.now() + expiryDays * 86400000) : null
    return {
      userId: user!.id,
      factKey,
      factValue,
      source: 'ONBOARDING',
      confidence: 1.0,
      timesConfirmed: 1,
      expiresAt,
    }
  }

  const inputs: UpsertFactInput[] = [
    makeInput('dietary.restrictions', [body.diet_type]),
    makeInput('location.home', body.home_address),
    makeInput('budget.daily_food_target', body.daily_food_budget),
    makeInput('kitchen.skill_level', body.cooking_skill),
  ]

  if (body.allergies !== undefined) {
    inputs.push(makeInput('dietary.allergies', body.allergies))
  }
  if (body.kitchen_equipment !== undefined) {
    inputs.push(makeInput('kitchen.equipment', body.kitchen_equipment))
  }
  if (body.daily_protein_target !== undefined) {
    inputs.push(makeInput('fitness.protein_target', body.daily_protein_target))
  }
  if (body.daily_calorie_target !== undefined) {
    inputs.push(makeInput('fitness.calorie_target', body.daily_calorie_target))
  }
  if (body.gym_days !== undefined) {
    inputs.push(makeInput('fitness.gym_days', body.gym_days))
  }

  // 5. Persist — exact=true so confidence is set to 1.0, not incremented
  await upsertFactsBatch(inputs, true)

  // 6. Respond
  return NextResponse.json(
    {
      user_id: user.id,
      onboarding_complete: true,
      facts_stored: inputs.length,
      profile_complete: true,
      next_step: 'home',
    },
    { status: 201 },
  )
}
