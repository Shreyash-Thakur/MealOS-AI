/**
 * MealOS AI — Agent and Conversation Types
 * Source: docs/TYPES.md §12 (Agents and Conversation) and §13 (SSE Events/User Actions)
 */

import type {
  SituationId,
  ClarificationId,
  RecommendationId,
  AgentRunId,
  ISODateTime,
  IANATimezone,
  Ms,
  Rupees,
  Minutes,
  Grams,
  Kcal,
  ConfidencePercent,
  SwiggyRestaurantId,
  DineoutVenueId,
  YouTubeVideoId,
} from './primitives'
import type { ConfidenceLevel, FactConfidence } from './primitives'
import type {
  DietType,
  CookingSkill,
  FactKey,
  MemorySource,
} from './memory'
import type {
  SituationType,
  ExtractedContext,
  SituationContext,
  InferredContext,
  ExplicitContext,
  ClarificationAnswerValue,
  ClarificationPass,
  ClarificationQuestion,
  ClarificationExchange,
  ContextAssumption,
  PrimaryPath,
  UserActionType,
} from './situation'
import type {
  PlanType,
  Service,
  RecipeStep,
  Ingredient,
} from './recommendation'
import type {
  Restaurant,
  InstamartResult,
  DineoutVenue,
  YouTubeRecipeResult,
} from './swiggy'
import type { PantryItem as _PantryItem } from './recommendation'

// ── §12.1 Agent contracts (AGENTS.md §1) ─────────────────────────────────────

export type AgentName      = 'ConversationAgent' | 'PlanningAgent' | 'ToolAgent' | 'MemoryAgent'
export type AgentModel     = 'claude-sonnet-4-6' | 'claude-haiku-4-5'
export type RetryTrigger   = 'timeout' | 'schema_invalid' | 'api_error'
export type AgentRunStatus = 'completed' | 'failed' | 'timeout' | 'schema_failed' | 'degraded'

export interface AgentConfig {
  name: AgentName
  model: AgentModel
  maxOutputTokens: number           // hard cap; API parameter, not a suggestion
  timeoutMs: Ms
  retryPolicy: {
    maxRetries: number
    backoffMs: Ms                   // actual wait = backoffMs * 2^attempt
    retryOn: RetryTrigger[]
  }
  fallback: unknown                 // must conform to the agent's output type
}

export interface AgentRunResult<TOutput> {
  output: TOutput
  status: AgentRunStatus
  latencyMs: Ms
  inputTokens: number
  outputTokens: number
  attempts: number                  // 1 = succeeded first try
  error?: string                    // populated when status !== 'completed'
}

/**
 * One row in situation_agent_runs — the canonical observability record.
 */
export interface AgentRun {
  id: AgentRunId
  situationId: SituationId
  agentName: AgentName
  modelUsed: string                 // exact Anthropic model string
  status: AgentRunStatus
  inputTokens: number | null
  outputTokens: number | null
  latencyMs: Ms | null
  inputSnapshot: unknown            // full agent input (JSONB)
  outputSnapshot: unknown | null    // parsed output; null on failure
  errorMessage: string | null
  startedAt: ISODateTime
  completedAt: ISODateTime | null
}

// ── §12.2 Agent I/O ───────────────────────────────────────────────────────────

export interface ConversationAgentInput {
  rawInput: string                  // ≤ 500 chars — truncated by API layer beforehand
  timestamp: ISODateTime            // user-local, with offset: "2026-07-05T19:45:00+05:30"
  userTimezone: IANATimezone
  userMemorySummary: string | null  // natural-language memory digest; null = first run
  previousSituationType?: SituationType  // resolves "same thing", "that again"
  sessionSituationCount: number     // > 5 with short inputs suggests frustration
}

/** The Conversation Agent output type IS ExtractedContext (docs/TYPES.md §12.2) */
export type ConversationAgentOutput = ExtractedContext

export interface PlanningAgentInput {
  situationContext: SituationContext      // post-clarification, memory-merged
  userMemory: {
    diet: DietType | null
    budget: Rupees | null
    allergies: string[]
    cookingSkill: CookingSkill | null
    kitchenEquipment: string[]
    householdSize: number
    fitnessGoals: {
      dailyProteinG?: Grams
      dailyCalorieTarget?: Kcal
      gymDays?: string[]
    }
    preferredCuisines: string[]
    dislikedCuisines: string[]
    frequentRestaurants: string[]
    pantryStaples: string[]
  }
  preCalculatedScores: { cook: number; order: number; dineout: number }  // FINAL — never overridden
  pathAvailability: { cook: boolean; order: boolean; dineout: boolean }
  swiggyResults: {
    restaurants: Restaurant[] | null       // truncated to top 10 by rating upstream
    instamartItems: InstamartResult[] | null
    dineoutVenues: DineoutVenue[] | null
  } | null
  youtubeResult: YouTubeRecipeResult | null
  pantryItems: _PantryItem[]              // truncated to 50 upstream
  isDegradedMode: boolean                 // Swiggy MCP fully unavailable (TYPES.md §14 item 10)
}

export interface PlanningAgentOutput {
  explanation: string               // 1–3 sentences; cites numbers, never the score itself
  primaryPath: PrimaryPath          // must match highest AVAILABLE pre-calculated score
  confidence: ConfidenceLevel
  recommendation: {
    title: string
    description: string
    estimatedCost: Rupees
    estimatedTime: Minutes
    proteinG?: Grams                // only if present in input — never estimated
    calories?: Kcal

    // COOK path
    ingredients?: Ingredient[]
    recipeSteps?: RecipeStep[]
    youtubeVideoId?: YouTubeVideoId

    // ORDER path
    restaurantName?: string
    restaurantId?: SwiggyRestaurantId
    menuItems?: { name: string; price: Rupees }[]
    estimatedDeliveryMin?: Minutes

    // DINEOUT path
    venueName?: string
    venueId?: DineoutVenueId
    availableSlots?: string[]       // "7:30 PM" IST 12-hour
    pricePerPerson?: Rupees
  }
  whyNotAlternatives: {             // exactly 2 — one per rejected path
    path: PrimaryPath
    reason: string                  // one sentence, decisive factor, never blames the user
  }[]
}

export interface MemoryAgentInput {
  completedSituation: {
    rawInput: string
    situationType: SituationType
    explicit: ExplicitContext
    inferred: InferredContext
    recommendation: {
      primaryPath: PrimaryPath
      title: string
      estimatedCost: Rupees
    }
  }
  clarificationAnswers: ClarificationExchange[]
  executedPath: PrimaryPath | 'dismissed' | null   // null = abandoned
  userRating?: 1 | 2 | 3 | 4 | 5 | null
  existingFacts: {
    factKey: FactKey
    factValue: unknown
    confidence: FactConfidence
  }[]
}

export interface ExtractedMemoryFact {
  factKey: FactKey                  // canonical list only — no invented keys
  factValue: string | number | boolean | string[]
  confidence: 0.4 | 0.6 | 0.8 | 1.0
  source: Extract<MemorySource,
    'user_stated' | 'clarification_answer' | 'behavior_inferred' | 'action_derived'>
  expiresAfterDays: number | null   // null = permanent
}

/** [] = nothing worth storing (normal) */
export type MemoryAgentOutput = ExtractedMemoryFact[]

// ── §12.3 Conversation turns ──────────────────────────────────────────────────

export type ConversationTurn =
  | { kind: 'user_input';             at: ISODateTime; text: string }
  | { kind: 'context_card';           at: ISODateTime; context: ExtractedContext }
  | { kind: 'clarification_asked';    at: ISODateTime; pass: ClarificationPass }
  | { kind: 'clarification_answered'; at: ISODateTime; answers: Record<string, ClarificationAnswerValue> }
  | { kind: 'plan_presented';         at: ISODateTime; recommendationId: RecommendationId }
  | { kind: 'user_action';            at: ISODateTime; action: UserActionType }

export interface Conversation {
  situationId: SituationId
  turns: ConversationTurn[]         // strictly time-ordered
}

// ── §13.1 SSE Events ─────────────────────────────────────────────────────────

export interface ContextUnderstoodEvent {
  situationType: SituationType
  understoodAs: string              // human-readable headline
  confidence: ConfidencePercent     // 0–100 (NOT 0–1 — see TYPES.md §14 item 2)
  knownFields: string[]
  assumptions: ContextAssumption[]
}

export interface ClarificationNeededEvent {
  clarificationId: ClarificationId
  passNumber: 1 | 2
  questions: ClarificationQuestion[]    // 1–3
  assumptionsStated: string[]           // assumptions made to avoid asking more
  expiresAt: ISODateTime                // 5 minutes from ask; client shows countdown
}

export interface PlanningStartedEvent {
  agentsRunning: ('swiggy' | 'recipe' | 'budget' | 'nutrition')[]
  estimatedSeconds: number              // progress animation hint, not a deadline
}

export interface AgentProgressEvent {
  agent: 'swiggy' | 'recipe' | 'budget' | 'nutrition' | 'planning'
  status: 'completed' | 'failed' | 'skipped'
  message: string                       // human-readable, rendered progressively
  partialData?: unknown                 // unstable preview shape — never depend on it
}

export interface PlanReadyEvent {
  recommendationId: RecommendationId
  headline: string
  planType: PlanType
  preview: {
    primaryService: Service
    primaryTitle: string
    primaryCost: Rupees
    primaryTime: Minutes
    alternativesCount: number
  }
}

export interface StreamErrorEvent {
  code: string                          // e.g. 'LLM_TIMEOUT', 'SWIGGY_UNAVAILABLE'
  message: string
  fallbackAvailable: boolean
  fallbackType?: 'recipe_only' | 'generic_suggestion'
  situationId: SituationId
}

export interface HeartbeatEvent {
  ts: ISODateTime                       // every 15s idle; clients filter it out
}

export type SSEEvent =
  | { event: 'context_understood';   data: ContextUnderstoodEvent }
  | { event: 'clarification_needed'; data: ClarificationNeededEvent }
  | { event: 'planning_started';     data: PlanningStartedEvent }
  | { event: 'agent_progress';       data: AgentProgressEvent }
  | { event: 'plan_ready';           data: PlanReadyEvent }
  | { event: 'error';                data: StreamErrorEvent }
  | { event: 'heartbeat';            data: HeartbeatEvent }
