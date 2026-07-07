/**
 * POST /api/v1/situations/:id/clarify
 * Delivers clarification answers, unblocking the SSE stream.
 *
 * Body: { answers: Record<string, string | number | boolean | string[]> }
 *
 * Returns:
 *   200 — answers delivered, stream will continue
 *   404 — situation not found
 *   409 — no pending clarification on this situation (already answered / timed out)
 */

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { deliverClarificationAnswers, hasPendingClarification } from '@/lib/sse'
import type { ClarificationAnswerValue } from '@/types/situation'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await db.user.findUnique({ where: { clerkId: clerkUserId } })
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const { id } = await params

  const situation = await db.situation.findFirst({ where: { id, userId: user.id } })
  if (!situation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!hasPendingClarification(id)) {
    return NextResponse.json(
      { error: 'No pending clarification — already answered or timed out' },
      { status: 409 },
    )
  }

  const body = await request.json() as { answers?: Record<string, ClarificationAnswerValue> }
  const answers = body.answers ?? {}

  const delivered = deliverClarificationAnswers(id, answers)
  if (!delivered) {
    return NextResponse.json(
      { error: 'No pending clarification — already answered or timed out' },
      { status: 409 },
    )
  }

  return NextResponse.json({ ok: true })
}
