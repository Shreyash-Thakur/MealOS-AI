/**
 * POST /api/v1/situations
 * Creates a new Situation row and returns {situation_id, stream_url}.
 * The client immediately connects to stream_url to begin the pipeline.
 */

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { createSituation } from '@/lib/repositories/situationRepo'

export async function POST(request: Request) {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json() as { raw_input?: string; timezone?: string }
  const { raw_input, timezone = 'Asia/Kolkata' } = body

  if (!raw_input || typeof raw_input !== 'string' || raw_input.trim().length === 0) {
    return NextResponse.json({ error: 'raw_input is required' }, { status: 400 })
  }

  const user = await db.user.findUnique({ where: { clerkId: clerkUserId } })
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const situation = await createSituation({ userId: user.id, rawInput: raw_input.trim() })

  return NextResponse.json(
    {
      situation_id: situation.id,
      stream_url: `/api/v1/situations/${situation.id}/stream?tz=${encodeURIComponent(timezone)}`,
    },
    { status: 201 },
  )
}
