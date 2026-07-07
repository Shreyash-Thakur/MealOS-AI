/**
 * POST /api/v1/recommendations/:id/execute
 * Returns the deep link for the primary recommendation path.
 *
 * COOK  → YouTube recipe URL (or null)
 * ORDER → Swiggy Food deep link for the recommended restaurant
 * DINE_OUT → Swiggy Dineout reservation link
 *
 * The "deep link" for V1 is a web URL the client opens in a browser or
 * WebView. Native app deep-link schemes (intent://, swiggy://) are a V2 item.
 */

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import { getRecommendationById } from '@/lib/repositories/recommendationRepo'

const SWIGGY_BASE = 'https://www.swiggy.com'
const SWIGGY_DINEOUT_BASE = 'https://www.swiggy.com/dineout'

interface SwiggyOrderData {
  restaurantId?: string
  restaurantName?: string
}

interface SwiggyDineoutData {
  venueId?: string
  venueName?: string
}

function buildDeepLink(
  primaryPath: string,
  youtubeUrl: string | null,
  swiggyData: unknown,
): { url: string | null; label: string } {
  switch (primaryPath) {
    case 'COOK':
      return {
        url: youtubeUrl,
        label: youtubeUrl ? 'Watch recipe on YouTube' : 'Recipe steps in app',
      }
    case 'ORDER': {
      const data = swiggyData as SwiggyOrderData | null
      if (data?.restaurantId) {
        return {
          url: `${SWIGGY_BASE}/restaurant/${data.restaurantId}`,
          label: `Order from ${data.restaurantName ?? 'restaurant'} on Swiggy`,
        }
      }
      return { url: `${SWIGGY_BASE}/food`, label: 'Open Swiggy Food' }
    }
    case 'DINE_OUT': {
      const data = swiggyData as SwiggyDineoutData | null
      if (data?.venueId) {
        return {
          url: `${SWIGGY_DINEOUT_BASE}/restaurant/${data.venueId}`,
          label: `Book a table at ${data.venueName ?? 'venue'} on Swiggy Dineout`,
        }
      }
      return { url: `${SWIGGY_DINEOUT_BASE}`, label: 'Open Swiggy Dineout' }
    }
    default:
      return { url: null, label: 'No deep link available' }
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const user = await db.user.findUnique({ where: { clerkId: clerkUserId } })
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const recommendation = await getRecommendationById(id, user.id)
  if (!recommendation) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const deepLink = buildDeepLink(
    recommendation.primaryPath,
    recommendation.youtubeUrl ?? null,
    recommendation.swiggyData,
  )

  return NextResponse.json({
    recommendation_id: id,
    primary_path: recommendation.primaryPath,
    deep_link: deepLink,
  })
}
