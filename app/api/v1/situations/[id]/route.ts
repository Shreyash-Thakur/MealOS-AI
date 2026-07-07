/**
 * GET /api/v1/situations/:id
 * Returns current situation state — used by the client to recover after an
 * SSE drop (check if the plan already exists before re-streaming).
 */

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const situation = await db.situation.findUnique({ where: { id } })
  if (!situation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const user = await db.user.findUnique({ where: { clerkId: clerkUserId } })
  if (!user || situation.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({
    id: situation.id,
    status: situation.status,
    situation_type: situation.situationType,
    created_at: situation.createdAt,
  })
}
