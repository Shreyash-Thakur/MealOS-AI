/**
 * tests/agents/tool.test.ts
 * Unit tests for the Tool Agent (lib/agents/tool.ts, ISSUE-092)
 *
 * The V1 Tool Agent is deterministic orchestration — the MCP layer already
 * returns domain-typed results or typed Degraded objects, so no LLM call is
 * needed. No network, no LLM: tests inject a MockSwiggyMCPClient (method
 * overrides are a designed capability of the mock) and a fake YouTube client.
 *
 * Test focus (docs/AGENTS.md §4 + playbook M6 DoD):
 *   1. Tool selection from path availability (rule 6: skip irrelevant tools)
 *   2. Parallel dispatch, _meta contract (attempted/succeeded/latency)
 *   3. Partial failure: degraded tool → null field + typed error, others continue
 *   4. All-Swiggy-down → swiggyError: 'SWIGGY_UNAVAILABLE'
 *   5. Per-tool retry on THROWN errors (max 2 retries, backoff) — typed
 *      Degraded results are never retried
 *   6. Query formulation per situation type (AGENTS.md §4.3 table)
 *   7. Result caps at schema limits (20 restaurants / 60 items / 20 venues)
 *   8. YouTube via injected client only; absent client → not attempted
 *   9. Output always validates against ToolAgentOutputSchema
 *  10. agent_progress hook fires per attempted tool (ISSUE-103)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env['DATABASE_URL'] ??= 'postgres://test:test@localhost:5432/test'
process.env['ANTHROPIC_API_KEY'] ??= 'test-key'
process.env['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'] ??= 'pk_test'
process.env['CLERK_SECRET_KEY'] ??= 'sk_test'
process.env['YOUTUBE_API_KEY'] ??= 'yt_test'
process.env['SWIGGY_MCP_MODE'] ??= 'mock'

const { runToolAgent, buildRestaurantQuery, DINEOUT_OCCASION_MAP } =
  await import('@/lib/agents/tool')
const { MockSwiggyMCPClient } = await import('@/lib/mcp/mock')
const { ToolAgentOutputSchema } = await import('@/lib/schemas')

import type { ToolAgentInput, YouTubeClient } from '@/lib/agents/tool'
import type { YouTubeRecipeResult } from '@/types/swiggy'

const BANDRA = { lat: 19.0596, lng: 72.8295 }

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<ToolAgentInput> = {}): ToolAgentInput {
  return {
    situationType: 'sick',
    pathAvailability: { cook: true, order: true, dineout: false },
    location: BANDRA,
    ...overrides,
  }
}

const YT_RESULT: YouTubeRecipeResult = {
  videoId: 'dQw4w9WgXcQ' as YouTubeRecipeResult['videoId'],
  title: 'Perfect Dal Khichdi',
  channelName: 'Home Cooking',
  durationSeconds: 720 as YouTubeRecipeResult['durationSeconds'],
  thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  viewCount: 1_200_000,
  publishedAt: '2025-01-15T10:00:00Z' as YouTubeRecipeResult['publishedAt'],
  keyTimestamps: [{ label: 'Add dal', seconds: 120 as YouTubeRecipeResult['keyTimestamps'][number]['seconds'] }],
}

function fakeYouTube(result: 'ok' | 'down' = 'ok'): YouTubeClient {
  return {
    searchRecipe: vi.fn().mockResolvedValue(
      result === 'ok'
        ? YT_RESULT
        : { available: false, errorCode: 'QUOTA_EXCEEDED', message: 'YouTube quota exhausted' }
    ),
  }
}

// ── Tool selection (execution rule 6) ─────────────────────────────────────────

describe('runToolAgent — tool selection', () => {
  it('calls only restaurants when order is the only path and no ingredients given', async () => {
    const swiggy = new MockSwiggyMCPClient('mock')
    const instamartSpy = vi.spyOn(swiggy, 'searchInstamart')
    const dineoutSpy = vi.spyOn(swiggy, 'searchDineout')

    const output = await runToolAgent(
      makeInput({ pathAvailability: { cook: false, order: true, dineout: false } }),
      { swiggy }
    )

    expect(instamartSpy).not.toHaveBeenCalled()
    expect(dineoutSpy).not.toHaveBeenCalled()
    expect(output.restaurants).not.toBeNull()
    expect(output.instamartItems).toEqual([])     // not called → [], not null
    expect(output.dineoutVenues).toEqual([])
    expect(output.youtube).toBeNull()
    expect(output._meta.toolsAttempted).toEqual(['swiggy_search_restaurants'])
  })

  it('calls instamart only when cook path is viable AND ingredients are missing', async () => {
    const swiggy = new MockSwiggyMCPClient('mock')
    const instamartSpy = vi.spyOn(swiggy, 'searchInstamart')

    await runToolAgent(
      makeInput({
        pathAvailability: { cook: true, order: false, dineout: false },
        missingIngredients: ['paneer 200g', 'tomatoes 500g'],
      }),
      { swiggy }
    )

    expect(instamartSpy).toHaveBeenCalledTimes(1)
    expect(instamartSpy.mock.calls[0]?.[0]?.items).toEqual(['paneer 200g', 'tomatoes 500g'])
  })

  it('calls all three Swiggy tools when all paths are viable', async () => {
    const swiggy = new MockSwiggyMCPClient('mock')

    const output = await runToolAgent(
      makeInput({
        situationType: 'date_planning',
        pathAvailability: { cook: true, order: true, dineout: true },
        missingIngredients: ['paneer 200g'],
        guests: 2,
        budget: 2000,
      }),
      { swiggy }
    )

    expect(output._meta.toolsAttempted).toEqual(
      expect.arrayContaining([
        'swiggy_search_restaurants',
        'swiggy_search_instamart',
        'swiggy_search_dineout',
      ])
    )
    expect(output.restaurants?.length).toBeGreaterThan(0)
    expect(output.dineoutVenues?.length).toBeGreaterThan(0)
  })
})

// ── Query formulation (AGENTS.md §4.3) ────────────────────────────────────────

describe('buildRestaurantQuery — situation-specific queries', () => {
  it('sick → comfort-food query', () => {
    expect(buildRestaurantQuery('sick')).toContain('khichdi')
  })

  it('nutrition_goal → protein query', () => {
    expect(buildRestaurantQuery('nutrition_goal')).toContain('protein')
  })

  it('appends the craving when present', () => {
    expect(buildRestaurantQuery('general', 'biryani')).toContain('biryani')
  })

  it('date_planning occasion maps to the dineout "date" occasion', () => {
    expect(DINEOUT_OCCASION_MAP['date_planning']).toBe('date')
    expect(DINEOUT_OCCASION_MAP['party_hosting']).toBe('celebration')
    expect(DINEOUT_OCCASION_MAP['family_dinner']).toBe('family')
  })
})

describe('runToolAgent — parameter passing', () => {
  it('passes vegetarian filter and delivery constraint to restaurant search', async () => {
    const swiggy = new MockSwiggyMCPClient('mock')
    const spy = vi.spyOn(swiggy, 'searchRestaurants')

    await runToolAgent(
      makeInput({
        dietaryFilter: 'vegetarian',
        timeConstraintMinutes: 30,
      }),
      { swiggy }
    )

    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      vegetarianOnly: true,
      maxDeliveryMinutes: 30,
    })
  })

  it('passes party size and per-person budget to dineout search', async () => {
    const swiggy = new MockSwiggyMCPClient('mock')
    const spy = vi.spyOn(swiggy, 'searchDineout')

    await runToolAgent(
      makeInput({
        situationType: 'date_planning',
        pathAvailability: { cook: false, order: false, dineout: true },
        guests: 2,
        budget: 2000,
        date: '2026-07-07',
      }),
      { swiggy }
    )

    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      partySize: 2,
      occasion: 'date',
      budgetPerPersonInr: 1000,     // total budget / guests
      date: '2026-07-07',
    })
  })
})

// ── Partial failure handling (AGENTS.md §4.4) ─────────────────────────────────

describe('runToolAgent — partial failure', () => {
  it('degraded restaurants → null field + typed error, other tools continue', async () => {
    const swiggy = new MockSwiggyMCPClient('mock')
    swiggy.searchRestaurants = async () =>
      ({ available: false, errorCode: 'SWIGGY_DOWN', message: 'Swiggy food delivery unavailable' })

    const output = await runToolAgent(
      makeInput({
        pathAvailability: { cook: true, order: true, dineout: false },
        missingIngredients: ['paneer 200g'],
      }),
      { swiggy }
    )

    expect(output.restaurants).toBeNull()
    expect(output.instamartItems).not.toBeNull()
    expect(output.errors).toContainEqual(
      expect.objectContaining({ tool: 'swiggy_search_restaurants', errorCode: 'SWIGGY_DOWN' })
    )
    expect(output.swiggyError).toBeUndefined()    // instamart succeeded
    expect(output._meta.toolsSucceeded).toContain('swiggy_search_instamart')
    expect(output._meta.toolsSucceeded).not.toContain('swiggy_search_restaurants')
  })

  it('all attempted Swiggy tools fail → swiggyError SWIGGY_UNAVAILABLE', async () => {
    const swiggy = new MockSwiggyMCPClient('down')   // every tool degraded

    const output = await runToolAgent(
      makeInput({
        pathAvailability: { cook: true, order: true, dineout: true },
        missingIngredients: ['paneer 200g'],
        guests: 2,
      }),
      { swiggy }
    )

    expect(output.restaurants).toBeNull()
    expect(output.instamartItems).toBeNull()
    expect(output.dineoutVenues).toBeNull()
    expect(output.swiggyError).toBe('SWIGGY_UNAVAILABLE')
    expect(output.errors.length).toBeGreaterThanOrEqual(3)
  })

  it('YouTube failure is non-critical: youtube null + error, swiggy results intact', async () => {
    const swiggy = new MockSwiggyMCPClient('mock')

    const output = await runToolAgent(
      makeInput({ recipeName: 'dal khichdi' }),
      { swiggy, youtube: fakeYouTube('down') }
    )

    expect(output.youtube).toBeNull()
    expect(output.restaurants).not.toBeNull()
    expect(output.errors).toContainEqual(
      expect.objectContaining({ tool: 'youtube_search_recipe', errorCode: 'QUOTA_EXCEEDED' })
    )
    expect(output.swiggyError).toBeUndefined()
  })
})

// ── Retry semantics ───────────────────────────────────────────────────────────

describe('runToolAgent — retry on thrown errors only', () => {
  it('retries a thrown transport error and succeeds on the second attempt', async () => {
    const swiggy = new MockSwiggyMCPClient('mock')
    const original = swiggy.searchRestaurants.bind(swiggy)
    let calls = 0
    swiggy.searchRestaurants = async (params) => {
      calls++
      if (calls === 1) throw new Error('ECONNRESET')
      return original(params)
    }

    const output = await runToolAgent(makeInput(), { swiggy, backoffMs: 1 })

    expect(calls).toBe(2)
    expect(output.restaurants).not.toBeNull()
    expect(output._meta.toolsSucceeded).toContain('swiggy_search_restaurants')
  })

  it('exhausts retries (3 total attempts) then records a classified error', async () => {
    const swiggy = new MockSwiggyMCPClient('mock')
    let calls = 0
    swiggy.searchRestaurants = async () => {
      calls++
      throw new Error('socket hang up')
    }

    const output = await runToolAgent(makeInput(), { swiggy, backoffMs: 1 })

    expect(calls).toBe(3)     // 1 initial + 2 retries
    expect(output.restaurants).toBeNull()
    expect(output.errors[0]?.tool).toBe('swiggy_search_restaurants')
  })

  it('does NOT retry a typed Degraded result', async () => {
    const swiggy = new MockSwiggyMCPClient('mock')
    let calls = 0
    swiggy.searchRestaurants = async () => {
      calls++
      return { available: false, errorCode: 'SWIGGY_DOWN', message: 'down' }
    }

    await runToolAgent(makeInput(), { swiggy, backoffMs: 1 })

    expect(calls).toBe(1)
  })
})

// ── Result caps ───────────────────────────────────────────────────────────────

describe('runToolAgent — schema result caps', () => {
  it('caps restaurants at 20 (schema limit)', async () => {
    const swiggy = new MockSwiggyMCPClient('mock')
    const original = swiggy.searchRestaurants.bind(swiggy)
    swiggy.searchRestaurants = async (params) => {
      const result = await original({ ...params, limit: 50 })
      if (Array.isArray(result)) {
        // pad to 25 by cloning with distinct ids
        const padded = [...result]
        while (padded.length < 25 && result[0]) {
          padded.push({ ...result[0], restaurantId: `pad-${padded.length}` as never })
        }
        return padded
      }
      return result
    }

    const output = await runToolAgent(makeInput(), { swiggy })

    expect(output.restaurants?.length).toBeLessThanOrEqual(20)
  })
})

// ── YouTube wiring ────────────────────────────────────────────────────────────

describe('runToolAgent — YouTube', () => {
  it('attaches the recipe video when a client is provided and cook is viable', async () => {
    const swiggy = new MockSwiggyMCPClient('mock')
    const youtube = fakeYouTube('ok')

    const output = await runToolAgent(
      makeInput({ recipeName: 'dal khichdi' }),
      { swiggy, youtube }
    )

    expect(vi.mocked(youtube.searchRecipe).mock.calls[0]?.[0]).toMatchObject({
      recipeName: 'dal khichdi',
    })
    expect(output.youtube?.videoId).toBe('dQw4w9WgXcQ')
    expect(output._meta.toolsAttempted).toContain('youtube_search_recipe')
  })

  it('does not attempt YouTube without a client (client lands M7)', async () => {
    const swiggy = new MockSwiggyMCPClient('mock')

    const output = await runToolAgent(makeInput({ recipeName: 'dal khichdi' }), { swiggy })

    expect(output.youtube).toBeNull()
    expect(output._meta.toolsAttempted).not.toContain('youtube_search_recipe')
  })

  it('does not attempt YouTube when cook path is unavailable', async () => {
    const swiggy = new MockSwiggyMCPClient('mock')
    const youtube = fakeYouTube('ok')

    await runToolAgent(
      makeInput({
        pathAvailability: { cook: false, order: true, dineout: false },
        recipeName: 'dal khichdi',
      }),
      { swiggy, youtube }
    )

    expect(youtube.searchRecipe).not.toHaveBeenCalled()
  })
})

// ── Output contract ───────────────────────────────────────────────────────────

describe('runToolAgent — output contract', () => {
  it('output always validates against ToolAgentOutputSchema (success case)', async () => {
    const swiggy = new MockSwiggyMCPClient('mock')

    const output = await runToolAgent(
      makeInput({
        situationType: 'family_dinner',
        pathAvailability: { cook: true, order: true, dineout: true },
        missingIngredients: ['paneer 200g'],
        guests: 4,
      }),
      { swiggy, youtube: fakeYouTube('ok'), backoffMs: 1 }
    )

    const parsed = ToolAgentOutputSchema.safeParse(output)
    expect(parsed.success).toBe(true)
  })

  it('output always validates against ToolAgentOutputSchema (all-down case)', async () => {
    const swiggy = new MockSwiggyMCPClient('down')

    const output = await runToolAgent(
      makeInput({
        pathAvailability: { cook: true, order: true, dineout: true },
        missingIngredients: ['paneer 200g'],
        guests: 2,
      }),
      { swiggy, backoffMs: 1 }
    )

    const parsed = ToolAgentOutputSchema.safeParse(output)
    expect(parsed.success).toBe(true)
  })

  it('_meta.totalLatencyMs is a non-negative number', async () => {
    const swiggy = new MockSwiggyMCPClient('mock')
    const output = await runToolAgent(makeInput(), { swiggy })
    expect(output._meta.totalLatencyMs).toBeGreaterThanOrEqual(0)
  })
})

// ── agent_progress hook (ISSUE-103) ───────────────────────────────────────────

describe('runToolAgent — progress events', () => {
  it('fires onProgress once per attempted tool with terminal status', async () => {
    const swiggy = new MockSwiggyMCPClient('mock')
    swiggy.searchInstamart = async () =>
      ({ available: false, errorCode: 'INSTAMART_DOWN', message: 'down' })
    const events: { tool: string; status: string }[] = []

    await runToolAgent(
      makeInput({
        pathAvailability: { cook: true, order: true, dineout: false },
        missingIngredients: ['paneer 200g'],
      }),
      {
        swiggy,
        onProgress: (e) => events.push({ tool: e.tool, status: e.status }),
      }
    )

    expect(events).toContainEqual({ tool: 'swiggy_search_restaurants', status: 'completed' })
    expect(events).toContainEqual({ tool: 'swiggy_search_instamart', status: 'failed' })
  })
})
