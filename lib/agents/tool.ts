/**
 * lib/agents/tool.ts
 * MealOS AI — Tool Agent
 *
 * Identity (docs/AGENTS.md §4.1):
 *   Name:           ToolAgent
 *   File:           lib/agents/tool.ts — the SOLE intermediary to external
 *                   services (rule N10; enforced by ESLint no-restricted-imports)
 *   Timeout:        per-tool (restaurants/instamart 3000ms, dineout 4000ms,
 *                   youtube 2000ms) — enforced by the MCP client layer
 *   Retry policy:   per tool, max 2 retries, 500ms backoff (AGENTS.md §4.1)
 *   Runs:           parallel with Decision Engine scoring, before Planning
 *
 * DESIGN NOTE — deterministic, no LLM call in V1:
 *   AGENTS.md §4 assigns this agent claude-haiku-4-5, but its stated contract
 *   ("does not reason about food — it fetches, normalizes, and returns") is
 *   fully mechanical against the V1 MCP layer, which already returns
 *   domain-typed results or typed Degraded objects (lib/mcp/mock.ts), with
 *   ingredient fuzzy-matching handled deterministically in lib/mcp/normalize.ts.
 *   Query formulation follows the AGENTS.md §4.3 table as data. Skipping the
 *   LLM removes ~600ms latency and the schema-failure mode from the hot path.
 *   The lib/claude runToolAgent transport stays available for a future real-MCP
 *   response that needs semantic normalization.
 *
 * Retry semantics: thrown (transport-level) errors are retried up to 2 times
 * with exponential backoff. Typed Degraded results are NEVER retried — the MCP
 * layer has already applied its own retry/fallback policy (tool.md rule 3).
 */

import { getSwiggyClient, type ISwiggyClient } from '@/lib/mcp/swiggy'
import { isDegraded, type Degraded, type ToolResult } from '@/lib/mcp/mock'
import { classifyError, errorMessage, type McpErrorCode } from '@/lib/mcp/errors'
import type { SituationType } from '@/types/situation'
import type {
  Restaurant,
  InstamartResult,
  DineoutVenue,
  YouTubeRecipeResult,
} from '@/types/swiggy'
import type { ToolAgentOutputValidated } from '@/lib/schemas/agents'
import type { Ms } from '@/types/primitives'

// ── Tool names and error codes (schema-frozen) ────────────────────────────────

export type ToolName =
  | 'swiggy_search_restaurants'
  | 'swiggy_search_instamart'
  | 'swiggy_search_dineout'
  | 'youtube_search_recipe'

type ToolErrorCode = ToolAgentOutputValidated['errors'][number]['errorCode']

const VALID_ERROR_CODES: ReadonlySet<string> = new Set([
  'LOCATION_NOT_SERVICEABLE', 'NO_RESULTS', 'RATE_LIMITED',
  'SWIGGY_DOWN', 'INSTAMART_DOWN', 'DINEOUT_DOWN', 'NO_AVAILABILITY',
  'QUOTA_EXCEEDED', 'API_DOWN',
])

/** Schema result caps (lib/schemas/agents.ts ToolAgentOutputSchema). */
const MAX_RESTAURANTS = 20
const MAX_INSTAMART_ITEMS = 60
const MAX_DINEOUT_VENUES = 20

// ── Query formulation (AGENTS.md §4.3 table, as data) ─────────────────────────

const RESTAURANT_QUERY_BY_TYPE: Readonly<Record<SituationType, string>> = {
  sick: 'khichdi soup comfort food',
  broke: 'cheap meals under Rs 150',
  date_planning: 'romantic dinner fine dining',
  party_hosting: 'party platters group orders',
  nutrition_goal: 'high protein chicken paneer',
  quick_meal: 'fast delivery quick meals',
  meal_prep: 'family packs bulk meals',
  office_lunch: 'office lunch thali combos',
  family_dinner: 'family dinner combos',
  late_night: 'late night delivery',
  general: 'popular meals',
}

/**
 * Builds the situation-specific restaurant search query. A stated craving is
 * the strongest signal and leads the query.
 */
export function buildRestaurantQuery(
  situationType: SituationType,
  craving?: string,
): string {
  const base = RESTAURANT_QUERY_BY_TYPE[situationType]
  return craving ? `${craving} ${base}` : base
}

/** SituationType → Swiggy Dineout occasion (SearchDineoutParams.occasion). */
export const DINEOUT_OCCASION_MAP: Readonly<
  Partial<Record<SituationType, 'date' | 'family' | 'business' | 'casual' | 'celebration'>>
> = {
  date_planning: 'date',
  party_hosting: 'celebration',
  family_dinner: 'family',
  office_lunch: 'business',
}

// ── Input / dependency contracts ──────────────────────────────────────────────

export interface ToolAgentInput {
  situationType: SituationType
  /** Which paths survived availability rules — decides which tools to call. */
  pathAvailability: { cook: boolean; order: boolean; dineout: boolean }
  /** User coordinates (from memory/home location; Mumbai default upstream). */
  location: { lat: number; lng: number }
  /** Total budget in INR (dineout: for the whole table). */
  budget?: number
  guests?: number
  /** ISO date for dineout booking; today for tonight bookings. */
  date?: string
  dietaryFilter?: 'vegetarian' | 'vegan' | 'non-vegetarian' | 'none'
  timeConstraintMinutes?: number
  craving?: string
  /** Cook-path items NOT in the pantry — instamart is called only when non-empty. */
  missingIngredients?: string[]
  /** Identified recipe for the cook path — youtube is called only when present. */
  recipeName?: string
  cuisine?: string
  cookingSkill?: 'beginner' | 'intermediate' | 'advanced'
}

/**
 * Injectable YouTube client boundary. The concrete client lands with M7
 * (ISSUE-131); until then callers simply omit it and youtube stays null.
 */
export interface YouTubeClient {
  searchRecipe(params: {
    recipeName: string
    cuisine?: string
    style?: 'quick' | 'detailed' | 'beginner' | 'restaurant-style'
    maxDurationMinutes?: number
  }): Promise<ToolResult<YouTubeRecipeResult>>
}

/** Progress event consumed by the SSE layer as agent_progress (ISSUE-103). */
export interface ToolProgressEvent {
  tool: ToolName
  status: 'completed' | 'failed'
  message: string
}

export interface ToolAgentDeps {
  /** Swiggy client override; defaults to getSwiggyClient() (env-selected). */
  swiggy?: ISwiggyClient
  /** YouTube client; absent until M7 — youtube is then never attempted. */
  youtube?: YouTubeClient
  /** Retry backoff base override (tests use 1ms). Default 500ms per spec. */
  backoffMs?: number
  /** Called once per attempted tool when it reaches a terminal state. */
  onProgress?: (event: ToolProgressEvent) => void
}

// ── Per-tool retry-on-throw wrapper ───────────────────────────────────────────

const MAX_TOOL_RETRIES = 2

/**
 * Runs one tool call, retrying THROWN errors up to MAX_TOOL_RETRIES with
 * exponential backoff. A typed Degraded return is a terminal result — the MCP
 * layer already applied its own retry policy, so retrying it only adds latency.
 * After retry exhaustion the thrown error is classified into a Degraded shape.
 */
async function callWithRetry<T>(
  call: () => Promise<ToolResult<T>>,
  context: 'food' | 'instamart' | 'dineout',
  backoffMs: number,
): Promise<ToolResult<T>> {
  let lastError: unknown
  for (let attempt = 0; attempt <= MAX_TOOL_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, backoffMs * Math.pow(2, attempt - 1)))
    }
    try {
      return await call()
    } catch (err) {
      lastError = err
    }
  }
  const code: McpErrorCode = classifyError(lastError, context)
  return { available: false, errorCode: code, message: errorMessage(code) }
}

// ── Error assembly ────────────────────────────────────────────────────────────

/**
 * Maps a Degraded result to the schema's frozen error-code enum. Unknown codes
 * collapse to the sub-service DOWN code so the output always validates.
 */
function toToolError(tool: ToolName, degraded: Degraded): ToolAgentOutputValidated['errors'][number] {
  let errorCode: ToolErrorCode
  if (VALID_ERROR_CODES.has(degraded.errorCode)) {
    errorCode = degraded.errorCode as ToolErrorCode
  } else if (tool === 'swiggy_search_instamart') {
    errorCode = 'INSTAMART_DOWN'
  } else if (tool === 'swiggy_search_dineout') {
    errorCode = 'DINEOUT_DOWN'
  } else if (tool === 'youtube_search_recipe') {
    errorCode = 'API_DOWN'
  } else {
    errorCode = 'SWIGGY_DOWN'
  }
  return { tool, errorCode, message: degraded.message.slice(0, 200) }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Runs the Tool Agent for one situation: dispatches every relevant external
 * call in parallel, waits for all to settle, and assembles the typed
 * ToolAgentOutput with the §4.4 partial-failure contract.
 *
 * Field semantics (AGENTS.md §4.5):
 *   null = tool attempted and failed · [] = not called or genuinely no results
 *
 * Never throws: every failure mode lands in errors[] / swiggyError, and the
 * output always conforms to ToolAgentOutputSchema.
 */
export async function runToolAgent(
  input: ToolAgentInput,
  deps: ToolAgentDeps = {},
): Promise<ToolAgentOutputValidated> {
  const swiggy = deps.swiggy ?? getSwiggyClient()
  const backoffMs = deps.backoffMs ?? 500
  const startMs = Date.now()

  const toolsAttempted: ToolName[] = []
  const toolsSucceeded: ToolName[] = []
  const errors: ToolAgentOutputValidated['errors'] = []

  // Tool selection (tool.md execution rule 6)
  const callRestaurants = input.pathAvailability.order
  const callInstamart =
    input.pathAvailability.cook && (input.missingIngredients?.length ?? 0) > 0
  const callDineout = input.pathAvailability.dineout
  const callYouTube =
    input.pathAvailability.cook && input.recipeName !== undefined && deps.youtube !== undefined

  // Not-called defaults: [] for lists, null for youtube (§4.5)
  let restaurants: Restaurant[] | null = []
  let instamartItems: InstamartResult[] | null = []
  let dineoutVenues: DineoutVenue[] | null = []
  let youtube: YouTubeRecipeResult | null = null

  /** Settle one tool: record _meta, errors, and fire the progress hook. */
  function settle<T>(tool: ToolName, result: ToolResult<T>): T | null {
    if (isDegraded(result)) {
      errors.push(toToolError(tool, result))
      deps.onProgress?.({ tool, status: 'failed', message: result.message })
      return null
    }
    toolsSucceeded.push(tool)
    deps.onProgress?.({ tool, status: 'completed', message: `${tool} returned results` })
    return result
  }

  const work: Promise<void>[] = []

  if (callRestaurants) {
    toolsAttempted.push('swiggy_search_restaurants')
    work.push(
      callWithRetry(
        () =>
          swiggy.searchRestaurants({
            query: buildRestaurantQuery(input.situationType, input.craving),
            location: input.location,
            ...(input.dietaryFilter === 'vegetarian' || input.dietaryFilter === 'vegan'
              ? { vegetarianOnly: true }
              : {}),
            ...(input.timeConstraintMinutes !== undefined
              ? { maxDeliveryMinutes: input.timeConstraintMinutes }
              : {}),
            ...(input.budget !== undefined ? { maxMinOrderInr: input.budget } : {}),
          }),
        'food',
        backoffMs,
      ).then((result) => {
        const data = settle('swiggy_search_restaurants', result)
        restaurants = data === null ? null : data.slice(0, MAX_RESTAURANTS)
      }),
    )
  }

  if (callInstamart) {
    toolsAttempted.push('swiggy_search_instamart')
    work.push(
      callWithRetry(
        () =>
          swiggy.searchInstamart({
            items: input.missingIngredients ?? [],
            location: input.location,
          }),
        'instamart',
        backoffMs,
      ).then((result) => {
        const data = settle('swiggy_search_instamart', result)
        instamartItems = data === null ? null : data.items.slice(0, MAX_INSTAMART_ITEMS)
      }),
    )
  }

  if (callDineout) {
    toolsAttempted.push('swiggy_search_dineout')
    const guests = input.guests ?? 2
    work.push(
      callWithRetry(
        () =>
          swiggy.searchDineout({
            location: input.location,
            partySize: guests,
            ...(DINEOUT_OCCASION_MAP[input.situationType] !== undefined
              ? { occasion: DINEOUT_OCCASION_MAP[input.situationType] }
              : {}),
            ...(input.budget !== undefined
              ? { budgetPerPersonInr: Math.round(input.budget / guests) }
              : {}),
            ...(input.date !== undefined ? { date: input.date } : {}),
          }),
        'dineout',
        backoffMs,
      ).then((result) => {
        const data = settle('swiggy_search_dineout', result)
        dineoutVenues = data === null ? null : data.slice(0, MAX_DINEOUT_VENUES)
      }),
    )
  }

  if (callYouTube && deps.youtube && input.recipeName !== undefined) {
    toolsAttempted.push('youtube_search_recipe')
    const style =
      input.cookingSkill === 'beginner'
        ? ('beginner' as const)
        : input.timeConstraintMinutes !== undefined && input.timeConstraintMinutes < 30
          ? ('quick' as const)
          : undefined
    const youtubeClient = deps.youtube
    const recipeName = input.recipeName
    work.push(
      callWithRetry(
        () =>
          youtubeClient.searchRecipe({
            recipeName,
            ...(input.cuisine !== undefined ? { cuisine: input.cuisine } : {}),
            ...(style !== undefined ? { style } : {}),
            maxDurationMinutes:
              input.timeConstraintMinutes !== undefined
                ? Math.max(5, input.timeConstraintMinutes - 5)
                : 20,
          }),
        'food',
        backoffMs,
      ).then((result) => {
        youtube = settle('youtube_search_recipe', result)
      }),
    )
  }

  // Parallel dispatch; settle() handles every outcome, so this never rejects
  await Promise.all(work)

  // All-Swiggy-down signal (§4.4): every ATTEMPTED Swiggy tool failed
  const swiggyAttempted = toolsAttempted.filter((t) => t !== 'youtube_search_recipe')
  const swiggySucceeded = toolsSucceeded.filter((t) => t !== 'youtube_search_recipe')
  const allSwiggyFailed = swiggyAttempted.length > 0 && swiggySucceeded.length === 0

  return {
    restaurants,
    instamartItems,
    dineoutVenues,
    youtube,
    errors,
    ...(allSwiggyFailed ? { swiggyError: 'SWIGGY_UNAVAILABLE' as const } : {}),
    _meta: {
      toolsAttempted,
      toolsSucceeded,
      totalLatencyMs: (Date.now() - startMs) as Ms,
    },
  }
}

// ── Exported constants ────────────────────────────────────────────────────────

export const TOOL_AGENT_NAME = 'ToolAgent' as const
