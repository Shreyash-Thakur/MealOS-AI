# MealOS AI — Backend Design

**Project:** MealOS AI
**Last Updated:** 2026-07-07
**Status:** Design specification — no implementation exists yet. This document defines the eight logical backend services, their contracts, dependencies, failure behavior, caching, and metrics. It is design, not code: interfaces are given as TypeScript signatures without bodies.
**Related files:** `docs/AGENTS.md` (agent internals), `docs/API.md` (HTTP contracts, error codes), `docs/DECISION_ENGINE.md` (scoring spec), `docs/SWIGGY_MCP.md` (MCP client), `docs/DATABASE.md` (schema), `ARCHITECTURE.md` (system overview)

---

## Table of Contents

1. [Deployment Model](#1-deployment-model)
2. [Service Dependency Diagram](#2-service-dependency-diagram)
3. [API Route Ownership](#3-api-route-ownership)
4. [Conversation Service](#4-conversation-service)
5. [Planning Service](#5-planning-service)
6. [Decision Engine](#6-decision-engine)
7. [Memory Service](#7-memory-service)
8. [Recipe Service](#8-recipe-service)
9. [Swiggy Tool Service](#9-swiggy-tool-service)
10. [Notification Service](#10-notification-service)
11. [Analytics Service](#11-analytics-service)
12. [Service Boundaries — What Each Service Must NEVER Do](#12-service-boundaries--what-each-service-must-never-do)
13. [Cross-Cutting Conventions](#13-cross-cutting-conventions)
14. [Appendix — Known Spec Contradictions](#14-appendix--known-spec-contradictions)

---

## 1. Deployment Model

**These are logical services, not deployed microservices.** In V1, all eight services live inside a single Next.js 16 App Router deployable on Vercel. A "service" is a directory under `lib/` with a public interface module; a "service call" is a TypeScript function call, not a network hop. The boundaries in this document are enforced by import discipline (ESLint `no-restricted-imports` rules per service directory), not by the network.

This matters for three reasons:

1. **Failure semantics.** A service "being down" in V1 means an unhandled exception or an upstream dependency (Neon, Redis, Anthropic, Swiggy MCP) failing — not a network partition between services. Failure handling below is written accordingly.
2. **Extraction path.** Each service's interface is designed so it can be lifted to a standalone Hono/Bun process (per `ARCHITECTURE.md` Phase 3) without changing callers beyond swapping the transport. Interfaces therefore pass plain serializable objects — no shared mutable state, no class instances across boundaries (the Swiggy MCP singleton is internal to the Swiggy Tool Service).
3. **Vercel constraints.** No long-lived background workers in V1. Anything "async" (Memory Agent, analytics flush) runs post-response via `waitUntil` on the same invocation, or on the still-open SSE connection's lifecycle. True queues (BullMQ + Redis) arrive when workers move off Vercel.

Directory layout:

```
lib/
  services/
    conversation/     # Conversation Service (owns the orchestrator)
    planning/         # Planning Service
    memory/           # Memory Service
    recipe/           # Recipe Service
    notification/     # Notification Service
    analytics/        # Analytics Service
  engine/             # Decision Engine (scorer.ts, types.ts) — pure, no I/O
  agents/             # Agent implementations, owned by their host services
    conversation.ts   #   → Conversation Service
    planning.ts       #   → Planning Service
    tool.ts           #   → Swiggy Tool Service
    memory.ts         #   → Memory Service
    orchestrator.ts   #   → Conversation Service
  mcp/
    swiggy.ts         # SwiggyMCPClient singleton — Swiggy Tool Service ONLY
app/api/v1/           # Route handlers: thin — validate, auth, delegate to a service
```

Route handlers contain no business logic. Each handler authenticates via Clerk `auth()`, validates the payload with the route's Zod schema, calls exactly one service method, and maps the service result (or typed error) to the HTTP response shapes defined in `docs/API.md`.

---

## 2. Service Dependency Diagram

Arrows point from caller to callee. LLM = Anthropic API. Every service also calls Analytics (event emission) — those edges are omitted for legibility and listed in §11.

```
                       app/api/v1/* (route handlers — thin)
                            │
     ┌──────────┬───────────┼──────────────┬─────────────────┐
     │          │           │              │                 │
     ▼          ▼           ▼              ▼                 ▼
┌──────────┐ ┌────────┐ ┌────────┐  ┌─────────────┐  ┌───────────┐
│Conversa- │ │Planning│ │ Memory │  │Notification │  │ Analytics │
│tion Svc  │ │  Svc   │ │  Svc   │  │    Svc      │  │    Svc    │
└─┬─┬─┬─┬──┘ └─┬─┬─┬──┘ └─┬───┬──┘  └──────┬──────┘  └──┬─────┬──┘
  │ │ │ │      │ │ │      │   │            │            │     │
  │ │ │ └──────┼─┼─┼──────┘   │            │            │     │
  │ │ │ (memory│ │ │ summary, │(MemoryAgent│            │     │
  │ │ │  facts)│ │ │  facts)  │  → LLM)    │            │     │
  │ │ │        │ │ │          ▼            │            │     │
  │ │ │        │ │ │      Neon (pgvector)  │            │     │
  │ │ │        │ │ └────────────┐          │            │     │
  │ │ ▼        │ ▼              ▼          │            │     │
  │ │ ┌────────┴────┐   ┌──────────────┐   │            │     │
  │ │ │ Decision    │   │ Recipe Svc   │   │            │     │
  │ │ │ Engine      │   │ (pantry match│   │            │     │
  │ │ │ (pure fn,   │   │  + YouTube)  │   │            │     │
  │ │ │  no I/O)    │   └──────┬───────┘   │            │     │
  │ │ └─────────────┘          │           │            │     │
  │ ▼                          ▼           ▼            ▼     ▼
  │ ┌───────────────────┐   YouTube      Redis         Neon  Sentry/
  │ │ Swiggy Tool Svc   │   Data API     (reminders)         Axiom
  │ │ (ToolAgent → LLM, │
  │ │  SwiggyMCPClient) │──→ Swiggy MCP server
  │ └───────────────────┘──→ Redis (result cache)
  │
  └──→ LLM (ConversationAgent)   └──→ Redis (SSE event replay, rate limits)
```

Call-chain summary for one situation (the critical path):

```
Conversation Svc ──[1]──► ConversationAgent (LLM, haiku, ≤3s)
Conversation Svc ──[2]──► Memory Svc.getMemorySummary()          (before [1])
Conversation Svc ──[3]──► ClarificationEngine (in-service, deterministic)
Conversation Svc ──[4a]─► Decision Engine.scoreAll()             (<5ms, sync)
Conversation Svc ──[4b]─► Swiggy Tool Svc.fetchForSituation()    (parallel with 4a, ≤6s)
Conversation Svc ──[4c]─► Recipe Svc.matchPantry() + youtubeSearch()  (feeds 4a/4b inputs)
Conversation Svc ──[5]──► Planning Svc.generatePlan()            (LLM, sonnet, ≤8s)
Conversation Svc ──[6]──► (post-response) Memory Svc.runMemoryAgent()
```

---

## 3. API Route Ownership

Every route from `docs/API.md`, its owning service, and what the handler delegates.

| Route | Owning Service | Delegated call |
|---|---|---|
| `POST /api/v1/situations` | Conversation | `conversationService.createSituation()` |
| `GET /api/v1/situations/:id/stream` | Conversation | `conversationService.openStream()` |
| `POST /api/v1/situations/:id/clarify` | Conversation | `conversationService.submitClarification()` |
| `GET /api/v1/situations/:id` | Conversation | `conversationService.getSituation()` |
| `GET /api/v1/recommendations/:id` | Planning | `planningService.getRecommendation()` |
| `POST /api/v1/recommendations/:id/execute` | Planning | `planningService.executeItem()` (delegates to Swiggy Tool / Recipe) |
| `GET /api/v1/memory` | Memory | `memoryService.getMemoryView()` |
| `PATCH /api/v1/memory` | Memory | `memoryService.patchFacts()` |
| `POST /api/v1/onboarding` | Memory | `memoryService.completeOnboarding()` |
| `GET /api/v1/health` | Analytics | `analyticsService.healthCheck()` |

Rate limiting (per `docs/API.md` limits table) is middleware shared by all routes, backed by Redis, owned by no single service; it emits `RATE_LIMIT_EXCEEDED` before any service code runs.

---

## 4. Conversation Service

### 4.1 Purpose

Owns the situation lifecycle end to end: intake, context extraction, clarification, orchestration of scoring/tools/planning, and the SSE stream that delivers progress to the client. It hosts the Agent Orchestrator (`lib/agents/orchestrator.ts`) and the Conversation Agent (`lib/agents/conversation.ts`). It is the only service that advances `situations.status` through the state machine.

### 4.2 Inputs

```typescript
interface CreateSituationInput {
  userId: string                        // internal UUID (mapped from Clerk userId by handler)
  rawInput: string                      // 1–2000 chars (API layer); truncated to 500 before the agent
  location?: { lat: number; lng: number }
  contextHints?: {
    calendarBusyUntil?: string          // ISO 8601
    currentWeather?: 'hot' | 'cold' | 'rainy'
    pantryLastUpdated?: string
  }
  timestamp: string                     // ISO 8601, user-local
  userTimezone: string                  // IANA
}

interface SubmitClarificationInput {
  userId: string
  situationId: string
  clarificationId: string
  answers: Record<string, string | number | boolean | string[]>
}

interface OpenStreamInput {
  userId: string
  situationId: string
  lastEventId?: string                  // for replay after reconnect
}
```

### 4.3 Outputs

```typescript
interface CreateSituationResult {
  situationId: string
  status: 'intent_extracted'
  streamUrl: string
  situationType: SituationType
  understoodAs: string
  locationUsed: 'request' | 'profile' | 'none'
}

interface SubmitClarificationResult {
  status: 'context_ready' | 'more_clarification_needed'
  message: string
  passNumber: number
  planningStarted?: boolean
  nextPassEventIncoming?: boolean
}

// openStream returns a ReadableStream of SSE frames using the event
// vocabulary from docs/API.md: context_understood, clarification_needed,
// planning_started, agent_progress, plan_ready, error, heartbeat.
type OpenStreamResult = ReadableStream<Uint8Array>

// getSituation returns the SituationResponse shape from docs/API.md verbatim.
```

### 4.4 Public Interface

```typescript
interface ConversationService {
  createSituation(input: CreateSituationInput): Promise<CreateSituationResult>
  openStream(input: OpenStreamInput): Promise<OpenStreamResult>
  submitClarification(input: SubmitClarificationInput): Promise<SubmitClarificationResult>
  getSituation(userId: string, situationId: string): Promise<SituationResponse>

  /** Internal — invoked by createSituation; exposed for tests only. */
  runPipeline(situationId: string): Promise<OrchestratorOutput>
}
```

### 4.5 Dependencies

| Direction | Service / External | Why |
|---|---|---|
| Calls | Memory Service | `getMemorySummary(userId)` before ConversationAgent; `getFactsForUser` for clarification gap analysis |
| Calls | Decision Engine | `scoreAll(context, pathInputs)` — synchronous, in step 4a |
| Calls | Swiggy Tool Service | `fetchForSituation()` — step 4b, parallel with scoring |
| Calls | Recipe Service | `matchPantry()` to build `CookPathInput`; `searchRecipeVideo()` for the cook path |
| Calls | Planning Service | `generatePlan()` — step 5 |
| Calls | Memory Service (async) | `runMemoryAgent()` after stream close |
| Calls | Anthropic API | ConversationAgent (claude-haiku-4-5, 3000ms timeout, per `docs/AGENTS.md` §2) |
| Calls | Redis | SSE event log for replay (situation lifetime, max 10 min); situation state cache |
| Calls | Neon/Prisma | `situations`, `clarifications` tables |
| Called by | Route handlers only | No service calls into Conversation Service |

### 4.6 Failure Handling

| Failure class | Behavior | What the user sees |
|---|---|---|
| ConversationAgent timeout (>3s, after 1 retry) | Use `TIMEOUT_FALLBACK` context (`docs/AGENTS.md` §2.5); proceed to clarification | Broad clarification questions instead of a sharp summary; no error |
| ConversationAgent schema-invalid (after 1 stricter-prompt retry) | Use `SCHEMA_FALLBACK` context, confidence 20 | Same as above; Context Card shows low-confidence phrasing |
| LLM provider unreachable at intake | `createSituation` throws typed `SERVICE_UNAVAILABLE` → handler returns 503 | "Service temporarily degraded" notice, retry after 30s |
| Redis down (SSE replay log unavailable) | Stream still works live; reconnect replay is lost — on reconnect, client falls back to `GET /situations/:id` per API.md reconnection pattern | A reconnecting client may briefly re-fetch state instead of replaying events |
| Pipeline exceeds 15s deadline | Orchestrator emits whatever partial plan exists with degraded marker; `error` SSE event with `fallback_available: true` if nothing plannable | Degraded plan or "we generated a simpler recommendation" |
| Clarification not answered in 5 min | Clarification row marked expired; subsequent clarify calls get `CLARIFICATION_EXPIRED` (409) | Expiry message; prompted to start a new situation |
| Non-food input (`nonFoodInput: true`) | Emit `error`-family redirect event, mark situation terminal; skip all downstream services | Gentle "I plan food, not taxes" redirect |
| Empty results downstream | Not this service's concern — Planning Service handles empty tool results (§5.6) | — |

The orchestrator's overriding rule (per `docs/AGENTS.md` §7.5): **always give the user something.** No failure in steps 1–5 short of database loss produces a blank screen.

### 4.7 Caching

| What | Where | TTL | Invalidation |
|---|---|---|---|
| SSE event log per situation | Redis (`sse:{situationId}` list) | 10 min hard cap | Deleted on terminal state + 2 min grace |
| Situation state (hot read for `GET /situations/:id` during active pipeline) | Redis (`situation:{id}` hash) | Situation lifetime | Write-through on every status transition; Neon is source of truth |
| Memory summary string (input to ConversationAgent) | Not cached here — Memory Service caches it (§7.7) | — | — |

No caching of agent outputs at this layer; the pipeline runs once per situation by construction.

### 4.8 Metrics

| Metric | Type | Labels |
|---|---|---|
| `mealos_conversation_situations_created_total` | counter | `situation_type`, `location_used` |
| `mealos_conversation_pipeline_latency_ms` | histogram | `outcome` (`complete`\|`degraded`\|`failed`), `clarified` (`true`\|`false`) |
| `mealos_conversation_agent_latency_ms` | histogram | `status` (`completed`\|`timeout`\|`schema_failed`\|`failed`) |
| `mealos_conversation_agent_confidence` | histogram | `situation_type` |
| `mealos_conversation_clarification_passes_total` | counter | `pass_number` (`1`\|`2`), `expired` (`true`\|`false`) |
| `mealos_conversation_nonfood_inputs_total` | counter | — |
| `mealos_conversation_sse_connections_active` | gauge | — |
| `mealos_conversation_sse_reconnects_total` | counter | `replay_available` (`true`\|`false`) |
| `mealos_conversation_state_transitions_total` | counter | `from`, `to` |

---

## 5. Planning Service

### 5.1 Purpose

Turns a scored, tool-enriched situation into a persisted, user-facing recommendation, and executes recommendation items when the user acts. Hosts the Planning Agent (`lib/agents/planning.ts`) — the only agent that writes user-facing prose. Owns the `recommendations`, `recommendation_items`, and `user_actions` tables.

### 5.2 Inputs

```typescript
interface GeneratePlanInput {
  situationId: string
  situationContext: SituationContext        // post-clarification, complete
  userMemory: PlanningUserMemory            // shape from docs/AGENTS.md §3.3
  decisionResult: DecisionResult             // full scorer output, docs/DECISION_ENGINE.md §2
  toolResults: ToolAgentOutput               // from Swiggy Tool Service; fields may be null
  youtubeResult: YouTubeRecipeResult | null  // from Recipe Service
  pantryItems: PantryItem[]                  // ≤50, pre-truncated
  isDeadedMode: boolean                      // all Swiggy tools failed
}

interface ExecuteItemInput {
  userId: string
  recommendationId: string
  itemId: string
  executionContext?: {
    modifiedItems?: string[]
    selectedTimeSlot?: string                // ISO 8601 — required for dineout
    partySize?: number
  }
}
```

### 5.3 Outputs

```typescript
interface GeneratePlanResult {
  recommendationId: string
  plan: PlanningAgentOutput                  // docs/AGENTS.md §3.4
  degraded: boolean                          // timeout/schema fallback was used
}

// getRecommendation returns RecommendationResponse from docs/API.md verbatim,
// including the comparison[] block assembled from the persisted DecisionResult.

// executeItem returns ExecuteRecommendationResponse from docs/API.md verbatim
// (execution_type: swiggy_cart | instamart_cart | dineout_booking | cooking_guide).
```

### 5.4 Public Interface

```typescript
interface PlanningService {
  generatePlan(input: GeneratePlanInput): Promise<GeneratePlanResult>
  getRecommendation(userId: string, recommendationId: string): Promise<RecommendationResponse>
  executeItem(input: ExecuteItemInput): Promise<ExecuteRecommendationResponse>
}
```

### 5.5 Dependencies

| Direction | Service / External | Why |
|---|---|---|
| Calls | Anthropic API | PlanningAgent (claude-sonnet-4-6, 8000ms timeout) |
| Calls | Swiggy Tool Service | On execute: `createFoodCart` / `createInstamartCart` / `createDineoutReservation` |
| Calls | Recipe Service | On cook-path execute: `startCookingSession()` |
| Calls | Notification Service | On dineout execute: booking confirmation notice |
| Calls | Redis | Planning output cache (§5.7) |
| Calls | Neon/Prisma | `recommendations`, `recommendation_items`, `user_actions` |
| Called by | Conversation Service | `generatePlan()` in pipeline step 5 |
| Called by | Route handlers | `getRecommendation`, `executeItem` |

### 5.6 Failure Handling

| Failure class | Behavior | What the user sees |
|---|---|---|
| PlanningAgent timeout (>8s, after 1 retry) | Persist the degraded fallback plan (`docs/AGENTS.md` §3.5 FM1) built from `toolResults.restaurants[0]` or pantry | Simplified plan with degraded indicator |
| PlanningAgent schema-invalid (no retry — fail fast) | Persist raw-text plan wrapped with `schema_failed` marker; UI falls back to situationType generic message | Generic recommendation text |
| LLM refusal / empty content | Treat as schema failure; never retried (refusals are deterministic) | Same as above |
| Empty Swiggy results with `order` winner | Override to cook path; prepend explanation notice (`docs/AGENTS.md` §3.5 FM2) | "Swiggy returned no results for your area right now…" |
| `winner: 'NO_WINNER'` from Decision Engine | Low-confidence pantry fallback (`docs/AGENTS.md` §3.5 FM3) | Pantry recipe or honest "no strong options" message |
| Execute: Swiggy MCP unreachable | Typed `SWIGGY_UNAVAILABLE` → handler returns 503 with `retry_after_seconds: 15` | Manual "open Swiggy yourself" fallback with restaurant name |
| Execute: dineout slot taken between plan and booking | Swiggy Tool Service re-checks availability; if gone, return alternatives from the persisted plan | Slot picker refreshed with remaining slots |
| Execute: item not executable | Typed `ITEM_NOT_EXECUTABLE` (400) | Execute button absent/disabled |
| DB write failure on recommendation persist | Retry 3× exponential; on final failure the plan is still emitted over SSE from memory, situation flagged for reconciliation | Plan renders; History may briefly lack the entry |

### 5.7 Caching

| What | Where | TTL | Invalidation |
|---|---|---|---|
| PlanningAgent output keyed by `(contextHash, swiggyHash)` | Redis (`planning:{ctx}:{swiggy}`) | 15 min | TTL only; hash changes are the invalidation (per `docs/AGENTS.md` §8.3 Strategy 1) |
| Recommendation read model | None — Neon read; recommendations are immutable after creation | — | — |
| Deep links for retried executes | None — deterministic from `execution_data`, regenerated per call | — | — |

Expected planning cache hit rate is 5–15%; do not raise the TTL past the Swiggy result TTL (15 min) or the cached plan can reference dead restaurant data.

### 5.8 Metrics

| Metric | Type | Labels |
|---|---|---|
| `mealos_planning_agent_latency_ms` | histogram | `status`, `situation_type` |
| `mealos_planning_agent_tokens` | histogram | `direction` (`input`\|`output`) |
| `mealos_planning_cache_requests_total` | counter | `result` (`hit`\|`miss`) |
| `mealos_planning_degraded_plans_total` | counter | `reason` (`timeout`\|`schema_failed`\|`no_winner`\|`swiggy_empty`) |
| `mealos_planning_primary_path_total` | counter | `path` (`cook`\|`order`\|`dineout`), `situation_type` |
| `mealos_planning_executes_total` | counter | `execution_type`, `outcome` (`ok`\|`swiggy_unavailable`\|`slot_taken`\|`invalid`) |
| `mealos_planning_execute_latency_ms` | histogram | `execution_type` |
| `mealos_planning_cost_usd_total` | counter | — (increments by per-call estimate; the 95%-of-spend agent) |

---

## 6. Decision Engine

### 6.1 Purpose

Pure, deterministic TypeScript scoring of the three paths (COOK / ORDER / DINE_OUT) at `lib/engine/scorer.ts`. Completes in <5ms, makes zero network calls, invokes no LLM, reads no database. It is a library, not a runtime service — it has no persistent state and no failure modes beyond programming errors, which is precisely why it exists (`docs/DECISION_ENGINE.md` §1).

### 6.2 Inputs

```typescript
// All types verbatim from docs/DECISION_ENGINE.md §2 (lib/engine/types.ts)
interface ScoreAllInput {
  context: SituationContext          // scorer-shape context (assembled by Conversation Service)
  cook: CookPathInput
  order: OrderPathInput
  dineOut: DineOutPathInput
}
```

The Conversation Service is responsible for assembling `PathInput`s: `CookPathInput` from Recipe Service pantry matching, `OrderPathInput`/`DineOutPathInput` from Swiggy Tool Service results. When tool data is missing, the assembler sets `available: false` on the affected path — the scorer never sees "null data", only unavailable paths.

### 6.3 Outputs

```typescript
// Verbatim from docs/DECISION_ENGINE.md §2
// DecisionResult: cookScore/orderScore/dineOutScore (PathScore each),
// winner ('COOK'|'ORDER'|'DINE_OUT'|'NO_WINNER'), isSplitRecommendation,
// splitAlternative, confidence (0–100), simulator (PlanSimulatorDeltas),
// weightsUsed, computedAt.
```

### 6.4 Public Interface

```typescript
// lib/engine/scorer.ts
export function scoreAll(input: ScoreAllInput): DecisionResult
export function scorePath(context: SituationContext, path: PathInput, weights: ScoreWeights): PathScore
export function getWeights(situationType: SituationType): ScoreWeights
export function computeSimulatorDeltas(primary: PathScore & BasePathInput, alt: (PathScore & BasePathInput) | null): PlanSimulatorDeltas

// Module-load assertion: every WeightTable row sums to exactly 1.0.
```

### 6.5 Dependencies

| Direction | Service / External | Why |
|---|---|---|
| Calls | Nothing | By definition. No imports outside `lib/engine/` and the standard library |
| Called by | Conversation Service | Pipeline step 4a |
| Called by | Test suites | 30 unit test cases in `docs/DECISION_ENGINE.md` §10 run against it directly |

### 6.6 Failure Handling

| Failure class | Behavior | What the user sees |
|---|---|---|
| Invalid input (weights don't sum to 1.0) | Module-load assertion failure — deploy-time error, never runtime | Nothing; CI blocks the deploy |
| All paths `available: false` | Returns `winner: 'NO_WINNER'` — a valid result, not an error | Planning Service's NO_WINNER fallback (§5.6) |
| Thrown exception (programming bug) | Caller (Conversation Service) catches, logs with full input snapshot, treats as `NO_WINNER` with confidence 0 | Low-confidence pantry fallback |
| Timeout / upstream 5xx / LLM garbage / empty results | Not possible — no I/O, no LLM, and empty inputs are modeled as unavailable paths | — |

### 6.7 Caching

None. The function is cheaper than any cache lookup (<5ms, pure CPU). Callers must not memoize it — `computedAt` and confidence depend on live context.

### 6.8 Metrics

Emitted by the caller (the engine itself has no I/O, including metrics I/O):

| Metric | Type | Labels |
|---|---|---|
| `mealos_engine_score_latency_ms` | histogram | — (alert if p99 > 5ms — indicates a hot-path regression) |
| `mealos_engine_winner_total` | counter | `winner` (`COOK`\|`ORDER`\|`DINE_OUT`\|`NO_WINNER`), `situation_type` |
| `mealos_engine_split_recommendations_total` | counter | `situation_type` |
| `mealos_engine_confidence` | histogram | `situation_type` |
| `mealos_engine_path_unavailable_total` | counter | `path`, `reason` (`cant_cook`\|`swiggy_down`\|`group_too_large`\|`no_data`) |

---

## 7. Memory Service

### 7.1 Purpose

Owns everything the system knows about the user across sessions: profile, structured facts (`user_memory_facts`), semantic embeddings (`user_memory_embeddings`, pgvector), and the async Memory Agent that extracts new facts after each situation. Serves the Memory Panel (read + user corrections) and onboarding. The Memory Agent is the only agent permitted to write persistent user state (`docs/AGENTS.md` §5.2).

### 7.2 Inputs

```typescript
interface PatchFactsInput {
  userId: string
  updates: { key: string; value: unknown }[]   // 1–20; null value = delete
}

interface OnboardingInput {
  userId: string
  dietType: DietType
  allergies?: string[]
  homeAddress: string
  homeLat?: number
  homeLng?: number
  dailyFoodBudget: number
  cookingSkill: CookingSkill
  kitchenEquipment?: string[]
  dailyProteinTarget?: number
  dailyCalorieTarget?: number
  gymDays?: string[]
}

interface RunMemoryAgentInput {
  situationId: string          // service loads completedSituation, clarifications,
  userId: string               // executedPath, rating itself — callers pass IDs only
}
```

### 7.3 Outputs

```typescript
interface MemorySummary {
  /** One-line natural-language summary for ConversationAgent input.
   *  null when the user has no stored facts (first interaction). */
  text: string | null
  factCount: number
}

interface RelevantMemory {
  facts: { factKey: string; factValue: unknown; confidence: number }[]
  similarSituations: {                        // pgvector top-5 by cosine similarity
    content: string
    contentType: 'situation_summary' | 'preference' | 'outcome' | 'correction'
    similarity: number
  }[]
}

// getMemoryView returns MemoryResponse from docs/API.md verbatim.
// patchFacts returns PatchMemoryResponse from docs/API.md verbatim.
// completeOnboarding returns OnboardingResponse from docs/API.md verbatim.
```

### 7.4 Public Interface

```typescript
interface MemoryService {
  getMemorySummary(userId: string): Promise<MemorySummary>
  getRelevantMemory(userId: string, situationText: string): Promise<RelevantMemory>
  getFactsForUser(userId: string): Promise<{ factKey: string; factValue: unknown; confidence: number }[]>
  getPlanningMemory(userId: string): Promise<PlanningUserMemory>   // shape from docs/AGENTS.md §3.3

  getMemoryView(userId: string): Promise<MemoryResponse>
  patchFacts(input: PatchFactsInput): Promise<PatchMemoryResponse>
  completeOnboarding(input: OnboardingInput): Promise<OnboardingResponse>

  /** Async, post-situation. Never throws to callers; failures are logged and swallowed. */
  runMemoryAgent(input: RunMemoryAgentInput): Promise<void>
}
```

### 7.5 Dependencies

| Direction | Service / External | Why |
|---|---|---|
| Calls | Anthropic API | MemoryAgent (claude-haiku-4-5, 5000ms, 2 retries) — only inside `runMemoryAgent` |
| Calls | Neon/Prisma | `user_profiles`, `user_memory_facts`, `user_memory_embeddings`, reads of `situations`/`user_actions` for extraction input |
| Calls | Embedding API | To embed situation summaries for pgvector storage/retrieval |
| Calls | Redis | Memory summary cache (§7.7) |
| Called by | Conversation Service | `getMemorySummary`, `getRelevantMemory`, `runMemoryAgent` |
| Called by | Planning Service (via Conversation Service input assembly) | `getPlanningMemory` |
| Called by | Route handlers | `getMemoryView`, `patchFacts`, `completeOnboarding` |

### 7.6 Failure Handling

| Failure class | Behavior | What the user sees |
|---|---|---|
| Memory read fails during pipeline (Neon error/timeout) | Return `MemorySummary { text: null }` — pipeline proceeds with blank memory, degraded-mode logged | More clarification questions than usual; no error |
| pgvector query timeout (>500ms budget) | Return `similarSituations: []`; structured facts alone | Slightly less personalized plan |
| MemoryAgent LLM timeout | 2 retries; then log, write nothing | Nothing — always silent (`docs/AGENTS.md` §5.6) |
| MemoryAgent schema-invalid output | No writes; log for prompt tuning | Nothing |
| MemoryAgent emits non-canonical fact key | Reject that fact at the validation layer, store the rest | Nothing |
| Fact write DB failure | Retry 3× exponential backoff; log on final failure | Nothing |
| `patchFacts` on `editable: false` fact | Per-key failure in `failures[]` (`FACT_NOT_EDITABLE`), other keys proceed | Inline "cannot edit" note in Memory Panel |
| Onboarding re-submission | Idempotent no-op success per `docs/API.md` | Normal redirect to home |

Design rule: memory is an enhancement, never a dependency. Every read path has a blank-memory fallback; the write path is fully async and silent.

### 7.7 Caching

| What | Where | TTL | Invalidation |
|---|---|---|---|
| Memory summary string per user | Redis (`memsum:{userId}`) | 24 h | Explicitly deleted on any fact write: `patchFacts`, `completeOnboarding`, MemoryAgent commit |
| Planning memory object | Redis (`memplan:{userId}`) | 24 h | Same invalidation hook as above |
| Structured facts | None beyond Prisma/Neon — reads are single-digit ms on `(user_id, fact_key)` index | — | — |
| Embeddings | Never cached (query-time similarity is the point) | — | — |

The single invalidation hook (`invalidateMemoryCaches(userId)`) is called from exactly three write sites. Adding a fourth write site without the hook is the canonical stale-memory bug — lint rule guards the Prisma models.

### 7.8 Metrics

| Metric | Type | Labels |
|---|---|---|
| `mealos_memory_summary_requests_total` | counter | `result` (`hit`\|`miss`\|`empty`\|`error`) |
| `mealos_memory_agent_latency_ms` | histogram | `status` |
| `mealos_memory_facts_written_total` | counter | `source` (`user_stated`\|`clarification_answer`\|`behavior_inferred`\|`action_derived`\|`onboarding`\|`panel_edit`) |
| `mealos_memory_facts_rejected_total` | counter | `reason` (`non_canonical_key`\|`low_confidence`\|`downgrade_blocked`) |
| `mealos_memory_vector_query_latency_ms` | histogram | — |
| `mealos_memory_facts_per_user` | histogram | — (sampled daily; drives ContextEnrichmentAgent extraction signal at >50 avg) |
| `mealos_memory_panel_edits_total` | counter | `action` (`update`\|`create`\|`delete`\|`rejected`) |

---

## 8. Recipe Service

### 8.1 Purpose

Owns the cook path's deterministic groundwork: pantry matching (which recipe candidates the user can actually make), the YouTube Data API client for recipe videos, cooking session tracking, and pantry CRUD. In V1 recipe *generation* (steps, ingredients, prose) lives inside the Planning Agent (`docs/AGENTS.md` §6.3 — RecipeAgent is a future extraction); the Recipe Service supplies the Planning Agent's inputs and handles everything around the LLM, not the LLM itself.

### 8.2 Inputs

```typescript
interface MatchPantryInput {
  userId: string
  craving: string | null
  dietaryRestrictions: DietaryRestriction[]
  allergens: Allergen[]
  timeConstraintMinutes: number | null
  cookingSkill: 'none' | 'beginner' | 'intermediate' | 'advanced'
}

interface SearchRecipeVideoInput {
  recipeName: string                     // specific: "dal khichdi"
  cuisine?: string
  style?: 'quick' | 'detailed' | 'beginner' | 'restaurant-style'
  maxDurationMinutes?: number            // default 20
}

interface StartCookingSessionInput {
  userId: string
  recommendationItemId: string
}
```

### 8.3 Outputs

```typescript
interface PantryMatchResult {
  pantryState: 'empty' | 'partial' | 'stocked'    // feeds scorer's SituationContext
  pantryItems: PantryItem[]                        // ≤50, most-recently-used first
  candidate: {                                     // best deterministic candidate, or null
    recipeName: string
    canMakeFromPantry: boolean
    missingIngredients: string[]                   // searchable Instamart terms
    missingIngredientCount: number
    estimatedCostRupees: number
    estimatedTimeMinutes: number
    difficultyLevel: 'easy' | 'medium' | 'hard'
  } | null
}

// searchRecipeVideo returns YouTubeRecipeResult (docs/AGENTS.md §4.3 Tool 4) or null.

interface CookingSession {
  cookingSessionId: string
  recipeSteps: RecipeStep[]
  shoppingNeeded: boolean
  instamartShortfallUrl?: string
}
```

### 8.4 Public Interface

```typescript
interface RecipeService {
  matchPantry(input: MatchPantryInput): Promise<PantryMatchResult>
  searchRecipeVideo(input: SearchRecipeVideoInput): Promise<YouTubeRecipeResult | null>
  startCookingSession(input: StartCookingSessionInput): Promise<CookingSession>
  completeCookingSession(userId: string, cookingSessionId: string, rating?: number): Promise<void>

  getPantry(userId: string): Promise<PantryItem[]>
  updatePantry(userId: string, changes: { name: string; quantity?: string; remove?: boolean }[]): Promise<void>
}
```

### 8.5 Dependencies

| Direction | Service / External | Why |
|---|---|---|
| Calls | YouTube Data API v3 | Recipe video search (2000ms timeout) |
| Calls | Neon/Prisma | `pantry_items`, cooking session rows, `meal_history` writes on session completion |
| Calls | Redis | YouTube result cache (§8.7) |
| Called by | Conversation Service | `matchPantry` (builds `CookPathInput`), `searchRecipeVideo` |
| Called by | Planning Service | `startCookingSession` on cook-path execute |
| Does NOT call | Swiggy Tool Service | Missing-ingredient Instamart search is orchestrated by Conversation Service: Recipe Service emits the list; Swiggy Tool Service searches it |

### 8.6 Failure Handling

| Failure class | Behavior | What the user sees |
|---|---|---|
| YouTube timeout (>2s) or 5xx | Return `null` — non-critical by contract (`docs/AGENTS.md` §4.3) | Recipe card without a video embed |
| YouTube `QUOTA_EXCEEDED` | Return `null`; set a Redis circuit flag (`yt:quota_exhausted`, TTL to next PT-midnight quota reset) so subsequent calls skip the API entirely | Same; quota not hammered |
| Empty video results | `null`; log query for search-term tuning | Recipe card without video |
| Pantry read DB failure | Return `pantryState: 'partial'` with empty items and `candidate: null` — conservative default that keeps cook viable without promising pantry coverage | Cook path scored without pantry bonus; ingredients all marked missing |
| Cooking session write failure | Retry 3×; on failure return the steps anyway with a synthetic session ID flagged unsaved | Cooking guide works; progress tracking silently absent |
| LLM failures | Not applicable — this service makes no LLM calls in V1 | — |

### 8.7 Caching

| What | Where | TTL | Invalidation |
|---|---|---|---|
| YouTube search results | Redis (`yt:search:{queryHash}`) | 24 h | TTL only — recipe videos don't churn; this is the main defense of the 10k units/day quota |
| Quota circuit flag | Redis (`yt:quota_exhausted`) | Until quota reset | TTL |
| Pantry reads | None — always fresh from Neon (staleness here produces wrong `inPantry` flags in plans) | — | — |

### 8.8 Metrics

| Metric | Type | Labels |
|---|---|---|
| `mealos_recipe_pantry_match_latency_ms` | histogram | — |
| `mealos_recipe_pantry_state_total` | counter | `state` (`empty`\|`partial`\|`stocked`\|`unknown_fallback`) |
| `mealos_recipe_pantry_hit_rate` | histogram | — (fraction of candidate ingredients in pantry; <0.6 is the RecipeAgent extraction signal) |
| `mealos_recipe_youtube_requests_total` | counter | `result` (`ok`\|`cache_hit`\|`no_results`\|`quota`\|`timeout`\|`error`) |
| `mealos_recipe_youtube_quota_units_total` | counter | — (search = 100 units; alert at 80% of daily 10k) |
| `mealos_recipe_cooking_sessions_total` | counter | `outcome` (`started`\|`completed`\|`abandoned`) |

---

## 9. Swiggy Tool Service

### 9.1 Purpose

The sole gateway between MealOS and the Swiggy MCP server. Hosts the Tool Agent (`lib/agents/tool.ts`) and the `SwiggyMCPClient` singleton (`lib/mcp/swiggy.ts`). Fetches and normalizes restaurant, Instamart, and Dineout data during planning; creates carts and reservations during execution. It fetches and normalizes — it never reasons about food (`docs/AGENTS.md` §4.2).

### 9.2 Inputs

```typescript
interface FetchForSituationInput {
  situationContext: SituationContext         // agent derives per-tool queries from this
  location: string                           // "Bandra West, Mumbai" — resolved by caller
  neededTools: {                             // caller pre-computes which tools apply
    restaurants: boolean
    instamart: { items: string[] } | false   // missing-ingredient list from Recipe Service
    dineout: { occasion: string; budget: number; guests: number; date: string } | false
  }
}

interface CreateFoodCartInput  { restaurantId: string; items: { itemId: string; quantity: number }[] }
interface CreateInstamartCartInput { items: { instamartItemId: string; quantity: number }[] }
interface CreateReservationInput   { venueId: string; slot: string; partySize: number; date: string }
```

### 9.3 Outputs

```typescript
// fetchForSituation returns ToolAgentOutput verbatim from docs/AGENTS.md §4.5:
// { restaurants | null, instamartItems | null, dineoutVenues | null, youtube: null,
//   errors[], swiggyError?, _meta }
// Convention: null = tool failed; [] = not called or genuinely zero results.
// Note: the youtube field exists in ToolAgentOutput for schema compatibility but is
// always null here — YouTube is owned by the Recipe Service (§8), not this service.

interface CartResult        { cartId: string; deepLink: string; expiresAt: string; totalCostInr: number }
interface ReservationResult { reservationId: string; venueName: string; dateTime: string; partySize: number; bookingUrl?: string }
```

### 9.4 Public Interface

```typescript
interface SwiggyToolService {
  fetchForSituation(input: FetchForSituationInput): Promise<ToolAgentOutput>

  createFoodCart(input: CreateFoodCartInput): Promise<CartResult>
  createInstamartCart(input: CreateInstamartCartInput): Promise<CartResult>
  createDineoutReservation(input: CreateReservationInput): Promise<ReservationResult>
  getDineoutAvailability(venueId: string, date: string, partySize: number): Promise<string[]>

  /** For GET /health — cheap reachability probe, 500ms budget. */
  ping(): Promise<'ok' | 'degraded' | 'down'>
}
```

### 9.5 Dependencies

| Direction | Service / External | Why |
|---|---|---|
| Calls | Swiggy MCP server | All 8 tools (`docs/SWIGGY_MCP.md` §7 mapping table) |
| Calls | Anthropic API | ToolAgent (claude-haiku-4-5, 6000ms overall; per-tool timeouts 2–4s) for query formulation + normalization |
| Calls | Redis | Search-result caches keyed per `docs/SWIGGY_MCP.md` §6 |
| Called by | Conversation Service | `fetchForSituation` in pipeline step 4b |
| Called by | Planning Service | Cart/reservation creation on execute |
| Called by | Analytics Service | `ping()` in health checks |

### 9.6 Failure Handling

Per-tool independent retries (max 2, 500ms backoff); one tool's failure never aborts the batch.

| Failure class | Behavior | What the user sees |
|---|---|---|
| Single search tool timeout/5xx (after retries) | That field `null`, error appended to `errors[]`, others proceed | Plan built from remaining data; a path may be marked unavailable |
| All Swiggy tools fail | `swiggyError: 'SWIGGY_UNAVAILABLE'`; caller sets `isDeadedMode: true` for Planning | Recipe-only recommendation with degraded-mode notice |
| `LOCATION_NOT_SERVICEABLE` | Not retried (deterministic); order/dineout paths marked unavailable | "Delivery isn't available at your location" note; cook path recommended |
| `RATE_LIMITED` from MCP | Honor per-tool budget; serve stale cache if present (stale-while-revalidate), else `null` | Slightly stale restaurant list, or degraded plan |
| Empty results (valid, zero matches) | `[]` with no error — semantically distinct from `null` | Planning handles per §5.6 |
| ToolAgent LLM garbage (schema-invalid normalization) | No retry (fail fast per the critical rule in `docs/AGENTS.md` §1.2); treat affected tool as failed | Same as tool failure |
| Cart creation: `CART_EXPIRED` | Re-create from `recommendation_items.execution_data` (deterministic), transparent to caller | Fresh deep link; no visible error |
| Reservation: `SLOT_TAKEN` | Re-fetch availability once; return remaining slots in a typed error to Planning Service | Refreshed slot picker |
| Write-op timeout (cart/reservation, 8s) | Typed `SWIGGY_UNAVAILABLE` with `retry_after_seconds: 15` | Manual-Swiggy fallback UI |

### 9.7 Caching

Verbatim from `docs/SWIGGY_MCP.md` §6 — Redis, keys include 3-decimal-place geo rounding:

| Tool | Key pattern | TTL |
|---|---|---|
| `swiggy_search_restaurants` | `swiggy:rest:search:{lat}:{lng}:{queryHash}:{filterHash}` | 15 min (SWR after 10) |
| `swiggy_get_restaurant_menu` | `swiggy:rest:menu:{restaurantId}` | 30 min |
| `swiggy_search_instamart` | `swiggy:instamart:search:{lat}:{lng}:{itemsHash}` | 10 min |
| `swiggy_search_dineout` | `swiggy:dineout:search:{lat}:{lng}:{occasion}:{partySize}:{date}` | 15 min |
| `swiggy_get_dineout_availability` | `swiggy:dineout:avail:{venueId}:{date}:{partySize}` | 5 min |
| Cart/reservation creation | **Never cached** — writes | — |

### 9.8 Metrics

| Metric | Type | Labels |
|---|---|---|
| `mealos_swiggy_tool_calls_total` | counter | `tool` (8 values), `result` (`ok`\|`cache_hit`\|`empty`\|`timeout`\|`error`\|`rate_limited`\|`not_serviceable`) |
| `mealos_swiggy_tool_latency_ms` | histogram | `tool` |
| `mealos_swiggy_batch_latency_ms` | histogram | — (`_meta.totalLatencyMs`) |
| `mealos_swiggy_unavailable_total` | counter | — (all-tools-failed events; alert ≥3 in 5 min) |
| `mealos_swiggy_cache_requests_total` | counter | `tool`, `result` (`hit`\|`miss`\|`stale_served`) |
| `mealos_swiggy_no_results_rate` | histogram | `tool` (>10% on restaurants is the dedicated-SwiggyAgent extraction signal) |
| `mealos_swiggy_carts_created_total` | counter | `type` (`food`\|`instamart`\|`reservation`), `outcome` |
| `mealos_swiggy_mcp_up` | gauge | — (from `ping()`) |

---

## 10. Notification Service

### 10.1 Purpose

Delivers in-app notices and scheduled meal reminders. V1 scope is deliberately small: in-app notification records with client polling/SSE piggyback, plus reminder scheduling for meal-prep plans and the sick-day "check in at 7 PM" pattern. Web push and webhooks are V2 (`docs/API.md` Webhooks section). Designed now so V1 code has a single choke point for anything user-notifying — retrofitting one later means touching every service.

### 10.2 Inputs

```typescript
type NoticeKind = 'booking_confirmed' | 'reminder' | 'plan_followup' | 'system'

interface SendNoticeInput {
  userId: string
  kind: NoticeKind
  title: string                          // ≤80 chars
  body: string                           // ≤240 chars
  deepLink?: string                      // in-app route, e.g. /situations/:id
  dedupeKey?: string                     // same key within 24h = dropped
}

interface ScheduleReminderInput {
  userId: string
  fireAt: string                         // ISO 8601 UTC
  notice: Omit<SendNoticeInput, 'userId'>
  sourceSituationId?: string
}
```

### 10.3 Outputs

```typescript
interface NoticeResult   { noticeId: string; deduped: boolean }
interface ReminderResult { reminderId: string; fireAt: string }
interface NoticeListResult {
  notices: { noticeId: string; kind: NoticeKind; title: string; body: string;
             deepLink?: string; readAt: string | null; createdAt: string }[]
  unreadCount: number
}
```

### 10.4 Public Interface

```typescript
interface NotificationService {
  sendNotice(input: SendNoticeInput): Promise<NoticeResult>
  scheduleReminder(input: ScheduleReminderInput): Promise<ReminderResult>
  cancelReminder(userId: string, reminderId: string): Promise<void>
  listNotices(userId: string, unreadOnly?: boolean): Promise<NoticeListResult>
  markRead(userId: string, noticeIds: string[]): Promise<void>
}
```

### 10.5 Dependencies

| Direction | Service / External | Why |
|---|---|---|
| Calls | Neon/Prisma | Notice and reminder tables |
| Calls | Redis | Sorted-set reminder queue (`reminders:due`, score = fireAt epoch); dedupe keys |
| Calls | Vercel Cron | 1-minute tick invokes the due-reminder drain endpoint (V1 substitute for a worker) |
| Called by | Planning Service | Booking confirmations |
| Called by | Conversation Service | Sick-day check-in reminders, meal-prep schedules |
| Never calls | Any LLM | Notification copy is templated, not generated |

### 10.6 Failure Handling

| Failure class | Behavior | What the user sees |
|---|---|---|
| DB write fails on `sendNotice` | Retry 3×; then drop and log — notices are never worth failing the calling operation | Possibly a missing notice; the triggering action (e.g. booking) still succeeds |
| Reminder fires while Redis is down | Cron drain reads Neon as source of truth (Redis queue is an index, not the record); fires late rather than never | Reminder arrives minutes late |
| Cron tick missed (Vercel hiccup) | Next tick drains everything with `fireAt <= now` — at-least-once delivery | Late reminder |
| Duplicate fire (at-least-once) | `dedupeKey` = `reminder:{reminderId}` suppresses the second insert | Nothing |
| Timeout / upstream 5xx / LLM garbage / empty results | No upstreams beyond DB/Redis; no LLM | — |

Delivery guarantee: at-least-once with dedupe, never exactly-once. Callers must treat `sendNotice` as fire-and-forget — it never throws into the caller's critical path.

### 10.7 Caching

| What | Where | TTL | Invalidation |
|---|---|---|---|
| Unread count per user | Redis (`notif:unread:{userId}`) | 5 min | Deleted on `sendNotice` and `markRead` |
| Dedupe keys | Redis (`notif:dedupe:{userId}:{key}`) | 24 h | TTL only |
| Due-reminder queue | Redis sorted set | Until fired | Removed on fire/cancel; rebuilt from Neon on Redis loss |

### 10.8 Metrics

| Metric | Type | Labels |
|---|---|---|
| `mealos_notification_notices_total` | counter | `kind`, `result` (`sent`\|`deduped`\|`dropped`) |
| `mealos_notification_reminders_scheduled_total` | counter | `source` (`meal_prep`\|`sick_checkin`\|`other`) |
| `mealos_notification_reminder_fire_delay_ms` | histogram | — (scheduled vs actual; alert p95 > 120s) |
| `mealos_notification_reminders_pending` | gauge | — |
| `mealos_notification_read_rate` | histogram | `kind` (read within 24h — the "are notices useful" signal) |

---

## 11. Analytics Service

### 11.1 Purpose

Owns observability data: the `situation_agent_runs` log (every agent run, success or failure — the canonical debugging and cost record per `docs/AGENTS.md` §1.4), product event tracking (funnel: situation → clarified → plan → executed), token/cost accounting, and the `GET /api/v1/health` endpoint. It is a sink: every service writes to it; it calls no service except Swiggy Tool's `ping()` for health.

### 11.2 Inputs

```typescript
interface AgentRunLogInput {           // shape from docs/AGENTS.md §1.4 AgentRunLog
  situationId: string
  agentName: 'ConversationAgent' | 'PlanningAgent' | 'ToolAgent' | 'MemoryAgent'
  modelUsed: string
  status: 'completed' | 'failed' | 'timeout' | 'schema_failed' | 'degraded'
  inputTokens: number
  outputTokens: number
  latencyMs: number
  inputSnapshot: object
  outputSnapshot: object | null
  errorMessage: string | null
  startedAt: string
  completedAt: string
}

type ProductEventName =
  | 'situation_created' | 'clarification_shown' | 'clarification_answered'
  | 'clarification_expired' | 'plan_shown' | 'plan_executed' | 'plan_dismissed'
  | 'situation_abandoned' | 'memory_edited' | 'onboarding_completed'

interface TrackEventInput {
  userId: string
  event: ProductEventName
  situationId?: string
  properties?: Record<string, string | number | boolean>
  ts: string
}
```

### 11.3 Outputs

```typescript
// healthCheck returns HealthResponse from docs/API.md verbatim
// (status, version, timestamp, services{database,redis,llm,swiggy_mcp}, uptime_seconds).

interface DailyCostReport {
  date: string
  byAgent: Record<string, { calls: number; inputTokens: number; outputTokens: number; estUsd: number }>
  totalUsd: number
}
```

### 11.4 Public Interface

```typescript
interface AnalyticsService {
  /** Fire-and-forget: buffers in memory, flushes post-response via waitUntil.
   *  Never throws, never blocks the caller. */
  logAgentRun(input: AgentRunLogInput): void
  track(input: TrackEventInput): void

  healthCheck(): Promise<HealthResponse>
  getDailyCostReport(date: string): Promise<DailyCostReport>
}
```

### 11.5 Dependencies

| Direction | Service / External | Why |
|---|---|---|
| Calls | Neon/Prisma | `situation_agent_runs`, product event table |
| Calls | Redis | Health probe; flush buffer overflow spill |
| Calls | Swiggy Tool Service | `ping()` for the health check's `swiggy_mcp` field |
| Calls | Anthropic API | Health check `llm` probe (cheapest possible: model list / 1-token call, 500ms budget) |
| Calls | Sentry / Axiom | Error and log shipping (side channel, not via interface) |
| Called by | Every service | `logAgentRun` (the four agent hosts), `track` (all) |

### 11.6 Failure Handling

| Failure class | Behavior | What the user sees |
|---|---|---|
| Flush write fails | Retry once next flush; then drop oldest-first and increment a drop counter — analytics never backpressures product code | Nothing |
| Buffer overflow (>500 events pre-flush) | Spill to Redis list; drain on next invocation | Nothing |
| Health probe timeout (500ms per dependency) | That dependency reported `down`/`degraded`; endpoint still returns | Status page shows degraded |
| Neon down | `healthCheck` returns 503 (the one case, per `docs/API.md`); `logAgentRun`/`track` drop with counter | Service-disruption notice |
| LLM / Swiggy probe failure | `status: 'degraded'`, HTTP 200 | Degraded banner if the client surfaces it |

Loss budget: agent-run logs are best-effort with a measured drop rate; if `mealos_analytics_dropped_total` exceeds 0.1% of events, that is an incident (blind cost accounting), not a shrug.

### 11.7 Caching

| What | Where | TTL | Invalidation |
|---|---|---|---|
| Health check result | In-memory per instance | 10 s | TTL (keeps LB probes from hammering dependencies) |
| Daily cost report | Redis (`cost:{date}`) | 1 h for today; 30 d for past dates | TTL (past dates are immutable) |
| Event buffer | In-memory, flush ≤5 s or ≤100 events | — | Flushed |

### 11.8 Metrics

Metrics about the metrics pipeline (exported directly, not via itself):

| Metric | Type | Labels |
|---|---|---|
| `mealos_analytics_events_ingested_total` | counter | `sink` (`agent_runs`\|`product_events`) |
| `mealos_analytics_dropped_total` | counter | `sink`, `reason` (`db_error`\|`overflow`) |
| `mealos_analytics_flush_latency_ms` | histogram | `sink` |
| `mealos_analytics_health_status` | gauge | `dependency` (`database`\|`redis`\|`llm`\|`swiggy_mcp`) — 1 ok / 0.5 degraded / 0 down |
| `mealos_analytics_daily_cost_usd` | gauge | `agent` |

---

## 12. Service Boundaries — What Each Service Must NEVER Do

These are the load-bearing prohibitions. Each one, if violated, silently destroys a property the architecture depends on (determinism, cost control, user trust, or extractability). Enforce with lint rules on imports where possible; the rest is review discipline.

| Service | Must NEVER | Because |
|---|---|---|
| **Decision Engine** | Make a network call, import Prisma/Redis/fetch, invoke an LLM, read the clock beyond `computedAt`, or be memoized | Determinism and <5ms are its entire reason to exist. One `await` in the scorer and the core invariant (same inputs → same scores, always) becomes unverifiable |
| **Planning Service** | Compute, adjust, or override path scores; select a path whose `available` is false; estimate nutrition numbers absent from input data | Scores are the Decision Engine's; the Planning Agent prompt already forbids recalculation (`docs/AGENTS.md` §3.6). Invented nutrition numbers are the fastest way to lose user trust |
| **Swiggy Tool Service** | Reason about food choice, rank restaurants beyond normalization, or write to any table except its own cache bookkeeping | It fetches and normalizes. The moment ranking logic leaks in here, recommendation behavior becomes untestable (split across an LLM and a scorer) |
| **Any service except Swiggy Tool** | Import `lib/mcp/swiggy.ts` or speak to the Swiggy MCP | Single choke point for auth, rate limits, caching, normalization, and Swiggy schema drift — the entire point of the Tool Agent pattern |
| **Conversation Service** | Generate user-facing recommendation prose; call the Anthropic API with any model other than claude-haiku-4-5 | Prose is the Planning Agent's monopoly (one voice, one cost center); model discipline is the cost model's foundation |
| **Memory Service (agents-side)** | Write facts outside the canonical key list; downgrade an existing fact's confidence; store situational states ("sick today") as facts; block any user-visible path | Memory poisoning is cumulative and invisible until recommendations degrade. The async-and-silent contract is what lets every other service treat memory as optional |
| **Any service except Memory** | Write to `user_memory_facts`, `user_profiles`, or `user_memory_embeddings` | One writer = one invalidation hook = no stale-summary bugs |
| **Recipe Service** | Call the Swiggy MCP (even for Instamart ingredient search) or invoke an LLM in V1 | Ingredient search goes through the Tool Service like every other Swiggy call; recipe generation is deliberately inside the Planning Agent until the extraction signals fire (`docs/AGENTS.md` §6.3) |
| **Notification Service** | Call an LLM, or throw into a caller's critical path | Templated copy is free and predictable; a failed notice must never fail a booking |
| **Analytics Service** | Backpressure, block, or throw into product code paths; call any service other than health probes | Observability that can take down the product inverts its purpose |
| **Route handlers** | Contain business logic, call more than one service per request, or touch Prisma directly | Handlers are the future network seam; logic in handlers is logic that can't be extracted |
| **Any service** | Advance `situations.status` except the Conversation Service | One state-machine owner; transitions are one-directional and audited |

---

## 13. Cross-Cutting Conventions

**Typed errors.** Services throw `ServiceError { code, httpStatus, message, details }` where `code` is drawn exclusively from the Error Code Reference in `docs/API.md` (e.g. `SITUATION_NOT_FOUND`, `CLARIFICATION_EXPIRED`, `SWIGGY_UNAVAILABLE`, `LLM_TIMEOUT`). No service invents codes; new codes are added to `docs/API.md` first.

**Metric naming.** `mealos_<service>_<noun>_<unit|total>`; counters end `_total`, histograms carry a unit suffix (`_ms`, `_usd`), gauges are bare nouns. Labels are low-cardinality enums only — never user IDs, situation IDs, or free text.

**Identity.** Clerk `userId` is resolved to the internal `users.id` UUID once, in the route handler; services only ever see internal UUIDs.

**Money and time.** Costs are integer INR (`docs/AGENTS.md` §4.6 normalization rules); durations are integer minutes (integer seconds for video timestamps); wire timestamps are ISO 8601.

**Agent hosting.** Each of the four V1 agents is owned by exactly one service (Conversation → ConversationAgent; Planning → PlanningAgent; Swiggy Tool → ToolAgent; Memory → MemoryAgent). Agent configs (model, timeout, retries, fallbacks) are those in `docs/AGENTS.md` — this document does not restate them and defers on any numeric conflict.

**Extraction order (V2+).** When load justifies splitting the deployable: Swiggy Tool Service first (isolated I/O profile, own rate-limit domain), then Memory Service (async worker fits a queue naturally), then Planning (GPU-adjacent cost isolation). The Decision Engine is never extracted — it ships as a package imported by whoever needs scoring.

---

## 14. Appendix — Known Spec Contradictions

Found while writing this document. Until reconciled, this document follows `docs/AGENTS.md` for agent internals and `docs/API.md` for the client wire contract, per their respective authority claims.

1. **SSE event vocabulary.** `docs/API.md` defines `context_understood`, `planning_started`, `agent_progress`; `docs/AGENTS.md` §7.4 defines `context_extracted`, `context_ready`, `non_food_redirect` for the same stream. This document treats API.md as the wire contract (clients are built against it) and AGENTS.md's names as internal orchestrator stages that must be mapped to wire events. **Action:** align AGENTS.md §7.4 to the API.md vocabulary.
2. **Agent taxonomy in API.md.** `docs/API.md` references "Intent Agent → Context Agent → Clarification Agent" and emits `agent_progress` for agents `swiggy|recipe|budget|nutrition|planning` — the pre-consolidation 10-agent design from `ARCHITECTURE.md` Phase 5. `docs/AGENTS.md` defines four V1 agents. **Action:** API.md's `agent_progress.agent` enum should become `conversation|tool|planning` (plus engine stages) or be marked V2.
3. **Timeout values conflict.** API.md: Intent 6s, Swiggy 8s, Planning 20s, stream max 3 min. AGENTS.md: Conversation 3s, Tool 6s, Planning 8s, pipeline 15s. This document uses AGENTS.md numbers (they are the implementation spec; API.md's are stale upper bounds). **Action:** update API.md's server-side timeout notes.
4. **Situation type vocabulary.** API.md examples use `"unwell"`; AGENTS.md's `SituationType` enum uses `'sick'`. One enum must win — AGENTS.md's is the typed source of truth.
5. **`memory_previews` and `health.last_sick_day`.** API.md's recommendation response previews memory writes and uses a fact key (`health.last_sick_day`) outside AGENTS.md §5.5's canonical key list, which also states the Memory Agent runs only *after* completion (no previews exist at plan time). **Action:** either drop `memory_previews` from V1 or add the key and a preview mechanism to the Memory Agent spec.
6. **Swiggy client path.** `ARCHITECTURE.md`/`README.md` say `lib/mcp/swiggy.ts`; `docs/SWIGGY_MCP.md` says `packages/mcp/src/swiggy/SwiggyMCPClient.ts`. This document uses `lib/mcp/swiggy.ts` (single-deployable V1 layout); the `packages/` path presumes a monorepo split that doesn't exist yet.
7. **Situation `error` status.** API.md's `SituationStatus` includes `'error'`; AGENTS.md §7.2's state machine has no error state. The state machine needs an explicit terminal `error` transition.

---

*Document ends. Implementation must not begin against a contradicted value until the owning document is updated.*
