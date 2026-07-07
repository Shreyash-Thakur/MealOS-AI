/**
 * GET /api/v1/situations/:id/stream
 * SSE stream — starts the agent pipeline and emits events as it progresses.
 *
 * Query params:
 *   tz  — IANA timezone string (e.g. "Asia/Kolkata"); defaults to UTC
 */

import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { createSseResponse } from '@/lib/sse'
import { runOrchestrator } from '@/lib/agents/orchestrator'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) {
    return new Response('Unauthorized', { status: 401 })
  }

  const user = await db.user.findUnique({ where: { clerkId: clerkUserId } })
  if (!user) {
    return new Response('User not found', { status: 404 })
  }

  const { id } = await params
  const url = new URL(request.url)
  const timezone = url.searchParams.get('tz') ?? 'UTC'

  const situation = await db.situation.findFirst({ where: { id, userId: user.id } })
  if (!situation) {
    return new Response('Not found', { status: 404 })
  }

  return createSseResponse(async (send) => {
    await runOrchestrator(
      {
        situationId: id,
        userId: user.id,
        rawInput: situation.rawInput,
        timestamp: new Date().toISOString(),
        userTimezone: timezone,
      },
      send,
    )
  })
}
