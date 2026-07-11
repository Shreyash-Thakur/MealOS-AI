/**
 * tests/youtube/client.test.ts
 * Unit tests for the YouTube Data API v3 client (lib/youtube/client.ts, ISSUE-131)
 *
 * No network: every test injects a fake fetchFn and asserts on the request
 * URL and the mapped output shape. Contract under test:
 *   1. Query construction: "{recipeName} {cuisine} recipe", type=video,
 *      videoDuration=medium (ISSUE-131 AC)
 *   2. Top result only, mapped to YouTubeRecipeResult (ISO 8601 duration →
 *      seconds, viewCount coerced to number, high-res thumbnail)
 *   3. Zero results → typed Degraded NO_RESULTS (never throws)
 *   4. Quota exhaustion (403 quotaExceeded) → QUOTA_EXCEEDED
 *   5. Any other failure (5xx, network throw, malformed body, timeout)
 *      → API_DOWN
 */

import { describe, it, expect, vi } from 'vitest'

process.env['DATABASE_URL'] ??= 'postgres://test:test@localhost:5432/test'
process.env['ANTHROPIC_API_KEY'] ??= 'test-key'
process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] ??= 'pk_test'
process.env['CLERK_SECRET_KEY'] ??= 'sk_test'
process.env['YOUTUBE_API_KEY'] ??= 'yt_test'
process.env['SWIGGY_MCP_MODE'] ??= 'mock'

const { YouTubeDataClient, parseIso8601Duration } = await import('@/lib/youtube/client')
const { isDegraded } = await import('@/lib/mcp/mock')

import type { FetchLike } from '@/lib/youtube/client'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SEARCH_RESPONSE = {
  items: [
    {
      id: { videoId: 'dQw4w9WgXcQ' },
      snippet: {
        title: 'Perfect Paneer Tikka at Home',
        channelTitle: 'Home Cooking',
        publishedAt: '2025-01-15T10:00:00Z',
        thumbnails: {
          high: { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' },
          default: { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg' },
        },
      },
    },
  ],
}

const VIDEOS_RESPONSE = {
  items: [
    {
      contentDetails: { duration: 'PT12M34S' },
      statistics: { viewCount: '1200000' },
    },
  ],
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/** fetchFn that answers search.list then videos.list, recording URLs. */
function happyFetch(): { fetchFn: FetchLike; urls: string[] } {
  const urls: string[] = []
  const fetchFn: FetchLike = async (url) => {
    urls.push(url)
    if (url.includes('/youtube/v3/search')) return jsonResponse(SEARCH_RESPONSE)
    if (url.includes('/youtube/v3/videos')) return jsonResponse(VIDEOS_RESPONSE)
    throw new Error(`unexpected URL: ${url}`)
  }
  return { fetchFn, urls }
}

// ── Query construction ────────────────────────────────────────────────────────

describe('YouTubeDataClient — query construction', () => {
  it('searches "{recipeName} {cuisine} recipe" with type=video and videoDuration=medium', async () => {
    const { fetchFn, urls } = happyFetch()
    const client = new YouTubeDataClient({ apiKey: 'k123', fetchFn })

    await client.searchRecipe({ recipeName: 'paneer tikka', cuisine: 'north indian' })

    const searchUrl = new URL(urls[0]!)
    expect(searchUrl.searchParams.get('q')).toBe('paneer tikka north indian recipe')
    expect(searchUrl.searchParams.get('type')).toBe('video')
    expect(searchUrl.searchParams.get('videoDuration')).toBe('medium')
    expect(searchUrl.searchParams.get('key')).toBe('k123')
  })

  it('omits cuisine from the query when not provided', async () => {
    const { fetchFn, urls } = happyFetch()
    const client = new YouTubeDataClient({ apiKey: 'k123', fetchFn })

    await client.searchRecipe({ recipeName: 'dal khichdi' })

    const searchUrl = new URL(urls[0]!)
    expect(searchUrl.searchParams.get('q')).toBe('dal khichdi recipe')
  })
})

// ── Result mapping ────────────────────────────────────────────────────────────

describe('YouTubeDataClient — result mapping', () => {
  it('returns the top result mapped to YouTubeRecipeResult', async () => {
    const { fetchFn } = happyFetch()
    const client = new YouTubeDataClient({ apiKey: 'k123', fetchFn })

    const result = await client.searchRecipe({ recipeName: 'paneer tikka' })

    expect(isDegraded(result)).toBe(false)
    if (isDegraded(result)) return
    expect(result.videoId).toBe('dQw4w9WgXcQ')
    expect(result.title).toBe('Perfect Paneer Tikka at Home')
    expect(result.channelName).toBe('Home Cooking')
    expect(result.durationSeconds).toBe(12 * 60 + 34)
    expect(result.thumbnailUrl).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
    expect(result.viewCount).toBe(1_200_000)
    expect(result.publishedAt).toBe('2025-01-15T10:00:00Z')
    expect(result.keyTimestamps).toEqual([])
  })

  it('fetches duration and view count from videos.list for the found videoId', async () => {
    const { fetchFn, urls } = happyFetch()
    const client = new YouTubeDataClient({ apiKey: 'k123', fetchFn })

    await client.searchRecipe({ recipeName: 'paneer tikka' })

    expect(urls).toHaveLength(2)
    const videosUrl = new URL(urls[1]!)
    expect(videosUrl.pathname).toContain('/youtube/v3/videos')
    expect(videosUrl.searchParams.get('id')).toBe('dQw4w9WgXcQ')
  })
})

// ── Degraded outcomes (never throws) ─────────────────────────────────────────

describe('YouTubeDataClient — degraded outcomes', () => {
  it('returns NO_RESULTS when the search has zero items', async () => {
    const fetchFn: FetchLike = async () => jsonResponse({ items: [] })
    const client = new YouTubeDataClient({ apiKey: 'k123', fetchFn })

    const result = await client.searchRecipe({ recipeName: 'paneer tikka' })

    expect(result).toMatchObject({ available: false, errorCode: 'NO_RESULTS' })
  })

  it('returns QUOTA_EXCEEDED on 403 quotaExceeded', async () => {
    const fetchFn: FetchLike = async () =>
      jsonResponse({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403)
    const client = new YouTubeDataClient({ apiKey: 'k123', fetchFn })

    const result = await client.searchRecipe({ recipeName: 'paneer tikka' })

    expect(result).toMatchObject({ available: false, errorCode: 'QUOTA_EXCEEDED' })
  })

  it('returns API_DOWN on a non-quota HTTP failure', async () => {
    const fetchFn: FetchLike = async () => jsonResponse({}, 500)
    const client = new YouTubeDataClient({ apiKey: 'k123', fetchFn })

    const result = await client.searchRecipe({ recipeName: 'paneer tikka' })

    expect(result).toMatchObject({ available: false, errorCode: 'API_DOWN' })
  })

  it('returns API_DOWN when fetch throws (network error)', async () => {
    const fetchFn: FetchLike = async () => {
      throw new Error('ECONNREFUSED')
    }
    const client = new YouTubeDataClient({ apiKey: 'k123', fetchFn })

    const result = await client.searchRecipe({ recipeName: 'paneer tikka' })

    expect(result).toMatchObject({ available: false, errorCode: 'API_DOWN' })
  })

  it('returns API_DOWN when the response body is malformed JSON', async () => {
    const fetchFn: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })
    const client = new YouTubeDataClient({ apiKey: 'k123', fetchFn })

    const result = await client.searchRecipe({ recipeName: 'paneer tikka' })

    expect(result).toMatchObject({ available: false, errorCode: 'API_DOWN' })
  })

  it('returns API_DOWN when the request exceeds the timeout', async () => {
    const fetchFn: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        )
      })
    const client = new YouTubeDataClient({ apiKey: 'k123', fetchFn, timeoutMs: 10 })

    const result = await client.searchRecipe({ recipeName: 'paneer tikka' })

    expect(result).toMatchObject({ available: false, errorCode: 'API_DOWN' })
  })

  it('returns NO_RESULTS when videos.list has no item for the videoId', async () => {
    const fetchFn: FetchLike = async (url) =>
      url.includes('/youtube/v3/search')
        ? jsonResponse(SEARCH_RESPONSE)
        : jsonResponse({ items: [] })
    const client = new YouTubeDataClient({ apiKey: 'k123', fetchFn })

    const result = await client.searchRecipe({ recipeName: 'paneer tikka' })

    expect(result).toMatchObject({ available: false, errorCode: 'NO_RESULTS' })
  })
})

// ── ISO 8601 duration parsing ────────────────────────────────────────────────

describe('parseIso8601Duration', () => {
  it.each([
    ['PT12M34S', 754],
    ['PT1H2M3S', 3723],
    ['PT45S', 45],
    ['PT20M', 1200],
    ['PT1H', 3600],
  ])('parses %s to %d seconds', (iso, seconds) => {
    expect(parseIso8601Duration(iso)).toBe(seconds)
  })

  it('returns 0 for an unparseable duration', () => {
    expect(parseIso8601Duration('garbage')).toBe(0)
  })
})

// ── Interface conformance ─────────────────────────────────────────────────────

describe('YouTubeDataClient — tool.ts YouTubeClient conformance', () => {
  it('is assignable to the Tool Agent YouTubeClient boundary', async () => {
    const { fetchFn } = happyFetch()
    // Type-level check: assignment fails compilation if the shapes drift.
    const client: import('@/lib/agents/tool').YouTubeClient = new YouTubeDataClient({
      apiKey: 'k123',
      fetchFn,
    })
    const result = await client.searchRecipe({ recipeName: 'paneer tikka', cuisine: 'punjabi' })
    expect(isDegraded(result)).toBe(false)
  })

  it('accepts style and maxDurationMinutes without failing', async () => {
    const { fetchFn } = happyFetch()
    const client = new YouTubeDataClient({ apiKey: 'k123', fetchFn })
    const result = await client.searchRecipe({
      recipeName: 'paneer tikka',
      style: 'beginner',
      maxDurationMinutes: 25,
    })
    expect(isDegraded(result)).toBe(false)
  })

  it('spied fetch is called with an AbortSignal for timeout enforcement', async () => {
    const { fetchFn } = happyFetch()
    const spy = vi.fn(fetchFn)
    const client = new YouTubeDataClient({ apiKey: 'k123', fetchFn: spy })

    await client.searchRecipe({ recipeName: 'paneer tikka' })

    expect(spy.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })
})
