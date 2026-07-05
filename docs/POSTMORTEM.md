# MealOS AI — Production Postmortem
## Architectural Retrospective: Two Years in Production

**Author:** Founding Engineer  
**Date:** July 2028  
**Audience:** MealOS Engineering Team  
**Context:** MealOS launched July 2026. This document is written at 1M MAU, 24 months in.

---

## Section 1: Executive Summary

Five things every engineer joining this team should know before touching the codebase:

1. **The deterministic scorer in `lib/engine/scorer.ts` is the most important file in the repo.** We ran 47 A/B experiments on the weight tables. We fixed three production scoring bugs by just reading TypeScript. We answered every "why did User A get a different recommendation than User B?" with a reproducible stack trace. None of that is possible if recommendations come from an LLM. Guard this file.

2. **The `user_memory_facts` table had a key naming crisis at month 6 that took three weeks to find and cost us meaningful recommendation quality.** The `fact_key` strings were invented ad-hoc and were never validated against an enum. The Memory Agent wrote to `preference.cuisine.liked`. The Context Agent read from `preference.cuisines.liked`. Both existed in the database simultaneously. Silent divergence, no runtime error, no test caught it. This is the most expensive oversight we made.

3. **Not instrumenting `situation_agent_runs` from day one was the single most painful omission.** It was designed in the `DATABASE.md` V2 checklist before we shipped and we deferred it anyway. When Planning Agent latency spiked at month 5 during a Claude API degradation event, we had no per-agent timing data. We were reading Vercel logs and cross-referencing timestamps by hand. The table is twenty lines of SQL. The absence cost weeks.

4. **The synchronous agent pipeline was fine until it wasn't, and when it broke it broke badly.** Six thousand concurrent users during IPL finals in month 9. Synchronous pipeline, each request holding a Node.js async context for 4–6 seconds, no queue. The BullMQ migration was two weeks of emergency work. The fix was not the technology change — it was the two weeks of lost focus during a critical growth phase.

5. **Swiggy is a service, not a dependency.** We built the entire order and dineout flow assuming `swiggAvailable === true`. In month 7, Swiggy had a 4-hour MCP outage during lunch peak. Every recommendation that should have been ORDER fell back to COOK only. We issued refunds. The `lib/mcp/swiggy.ts` interface should have been `lib/providers/food-provider.ts` from week one.

---

## Section 2: Decisions That Aged Well

### 2.1 Deterministic Scoring Engine

**The decision (July 2026):** All recommendation scoring — the `goalMatchScore`, `budgetFitScore`, `timeFitScore`, `prefMatchScore` and their weighted combination into `finalScore` — runs as pure TypeScript in `lib/engine/scorer.ts`. Claude is called exactly once per situation, after scoring is complete, to write the explanation sentence. It receives the `DecisionResult` struct. It does not touch the scores.

**Why it held up:** At 1M MAU, the weight table in `WEIGHT_TABLE` has been modified 47 times across controlled experiments. We can query every recommendation produced by weight variant `v23` and compare it to `v22` because both are logged in `recommendations.comparison_scores` alongside the `weightsUsed` field in the `DecisionResult`. We patched three production scoring bugs — one in the `broke` situation's goal match calculation where the ratio threshold was off by 0.1, one in the `sick` path where DINE_OUT was scoring non-zero despite `canCook === false` propagation, and one in the `prefMatchScore` where the liked cuisine bonus was applying twice due to a loop that didn't break early — by reading the pseudocode in `DECISION_ENGINE.md` and the implementation side by side. The fix in each case was a one-line change. All three were caught by the unit test suite after the fix, which also confirmed the fix was correct.

**What would have happened otherwise:** An LLM-based scorer has no `weightsUsed` field. You cannot A/B test it because the same prompt produces different outputs across calls. When a recommendation "looks wrong," you have no sub-scores to inspect. The `DECISION_ENGINE.md` spec documents the `PathScore` struct with `goalMatchNotes`, `budgetNotes`, `timeNotes`, `prefNotes` — those notes are available in the recommendation payload today and are surfaced directly in the explanation. That explainability chain does not exist if an LLM chooses the winner.

**The spec had it right from the start:** The design philosophy section of `DECISION_ENGINE.md` states: "If a user asks 'why did you recommend cooking?' the system must be able to replay the exact calculation that produced that recommendation." We can. We do. Every support ticket that involves a suspicious recommendation is resolved with a score replay in under five minutes.

---

### 2.2 Starting with Structured Memory Before pgvector

**The decision (July 2026):** The `user_memory_facts` table uses a flat key-value structure — `fact_key` as a VARCHAR, `fact_value` as JSONB. The key registry in `DATABASE.md` covers dietary restrictions, budget, location, cooking skill, household size, fitness goals, cuisine preferences, pantry staples, and ordering preferences. No embeddings. No vector retrieval.

**Why it held up:** At 10k users (months 1–3), the 16-key registry covered over 90% of the personalization signals the Context Agent needed. The `fromMemory` block of `SituationContext` — `dietType`, `allergies`, `budget`, `cookingSkill`, `kitchenEquipment`, `homeLoc`, `proteinTarget`, `preferredCuisines` — maps directly to structured keys. We did not need approximate nearest-neighbor search to know that a user is vegetarian or has a ₹350 daily food budget.

When we added pgvector at month 8 (`user_memory_embeddings` table, IVFFlat index, vector(1536)), we had real conversation history to embed. The structured facts from `user_memory_facts` became the source of truth for what to embed: each confirmed fact was serialized, embedded, and stored alongside its `source_situation_id`. The structured layer gave the vector layer a clean, validated input corpus. If we had started with embeddings, we would have been embedding noise.

**What would have happened otherwise:** Retrofitting a vector layer into a system that has no structured foundation is harder than adding it on top of one. The structured key registry also gave us the `FactValueByKey` TypeScript type — a compile-time contract between the Memory Agent's writer and the Context Agent's reader. That contract caught type mismatches. Embeddings have no equivalent contract.

---

### 2.3 Four Agents Instead of Ten

**The decision (July 2026):** The system launched with four agents: Conversation (claude-haiku-4-5 for intent extraction), Planning (claude-sonnet-4-6 for recommendation assembly), Tool (claude-haiku-4-5 wrapping Swiggy MCP), and Memory (async, post-execution). The pressure to extract Budget Agent, Nutrition Agent, and Recipe Agent as separate entities was resisted.

**Why it held up:** The first major Planning Agent prompt rewrite happened at month 4, when we restructured how the agent selects within the winning path. The `planning.md` prompt had five sections at launch. We rewrote it to eight, changed the option selection priority ordering, and added the explicit `CRITICAL CONSTRAINT — SCORES ARE PRE-CALCULATED` block to prevent the agent from re-reasoning about scores.

That rewrite took one afternoon. No inter-agent contract updates. No schema versioning across agent boundaries. No coordination with other teams. The Planning Agent is a contained unit with a defined input (`SituationContext` + pre-calculated scores + Swiggy data) and a defined output (the recommendation schema). Changing its reasoning does not touch the Conversation Agent, the Tool Agent, or the Memory Agent.

**What would have happened otherwise:** A separate Nutrition Agent would have needed a contract defining what it receives (partial `SituationContext`?), what it returns (a `NutritionScore`?), and how that score integrates with the Planning Agent's input. Changing the nutrition scoring formula would require versioning that contract. At month 4, when we rewrote the Planning Agent, we would have been coordinating a multi-agent prompt upgrade across team boundaries. The atomicity of a single agent's prompt is a genuine engineering asset.

Budget Agent and Nutrition Agent were eventually extracted at month 14, when the codebase had six engineers and the Planning Agent's system prompt had grown to a size where a single edit had too large a blast radius. At month 4, with two engineers, extracting them would have been overhead with no payoff.

---

### 2.4 SSE over WebSocket

**The decision (July 2026):** The real-time Planning Graph updates flow from server to client via Server-Sent Events on `GET /api/v1/situations/:id/stream`. The event schema (`context_understood`, `clarification_needed`, `planning_started`, `agent_progress`, `plan_ready`, `error`, `heartbeat`) is one-directional: server to client. The client sends updates back via the REST clarify endpoint, not over the stream.

**Why it held up:** At 400k MAU, Vercel's SSE support was stable without configuration. No sticky sessions. No separate WebSocket server. No Redis pub-sub to fan out events to a WebSocket connection pool. The `Last-Event-ID` header for replay — documented in `API.md`'s SSE section — is supported natively by EventSource without additional infrastructure.

The communication pattern for situations is inherently one-directional: agents complete their work in sequence and emit progress events. The client has no need to push data back through the planning stream — that happens through `POST /api/v1/situations/:id/clarify`. This made WebSocket the wrong abstraction from the start.

At scale, we discovered that SSE connections survive corporate firewalls and mobile NAT traversal more reliably than WebSocket. At 400k MAU, a meaningful fraction of users are on enterprise networks in offices. WebSocket often requires explicit firewall allowlisting. SSE is HTTP/1.1 long-polling with chunked transfer — it passes through every proxy we encountered.

**What would have happened otherwise:** WebSocket at 400k MAU on Vercel would have forced a migration to a stateful server — likely a dedicated Node.js service with sticky session routing — and a Redis pub-sub layer to broadcast events from wherever the planning pipeline runs to wherever the user's WebSocket connection is held. That is a non-trivial infrastructure addition. We would have needed it at month 7, during the Swiggy partnership ramp, the worst possible time.

---

### 2.5 Next.js API Routes for V1

**The decision (July 2026):** All eleven API endpoints (`POST /situations`, `GET /situations/:id/stream`, `POST /situations/:id/clarify`, `GET /recommendations/:id`, `POST /recommendations/:id/execute`, `GET /memory`, `PATCH /memory`, `POST /onboarding`, `GET /health`, and the Clerk webhook handler) ran as Next.js API route handlers in the same deployment as the frontend.

**Why it held up:** MealOS reached 200k MAU before infrastructure complexity was worth addressing. The single deployment unit meant one Vercel project, one set of environment variables, one CI pipeline. When a new engineer joined at month 9, they had one `npm run dev` command, not a service mesh.

The migration to dedicated services at month 10 was clean because the route handler boundaries were well-defined from the start. Each handler had a clear responsibility, typed request and response shapes (the full `API.md` was written before any code), and no cross-endpoint shared state beyond the Prisma client and the agent instances. The extraction was mechanical: copy the handler logic into a new Express/Fastify service, update the API gateway to route to it. No architectural surgery required.

**What would have happened otherwise:** Starting with a microservices architecture in July 2026 would have meant two or three engineers spending their first month on Kubernetes manifests, service discovery, and distributed tracing instead of on the scoring engine, the agent prompts, and the Swiggy MCP integration. The product would have been worse at the moment of the IPL-era viral spike, which is when the architecture actually needed to perform.

---

## Section 3: Decisions That Aged Poorly

### 3.1 Synchronous Agent Pipeline

**The original decision:** The Planning Agent pipeline — Conversation Agent → Context Agent → Clarification (if needed) → Tool Agent → Planning Agent → Memory Agent (async, the one exception) — ran synchronously in a single request lifecycle. Each `POST /api/v1/situations` held a Node.js async context through 4–6 seconds of LLM calls, Swiggy MCP calls, and database writes.

**When the pain became unbearable:** Month 9. IPL Finals. 6,000 users submitted situations within a 20-minute window during the halftime break. Synchronous pipeline means 6,000 concurrent Node.js async contexts, each holding open database connections (Neon with pgBouncer by this point), each holding open HTTP connections to the Claude API. Memory usage spiked. CPU pegged. Vercel added cold-start instances that themselves immediately pegged CPU on warm-up. P99 latency went from 5s to 45s. Some users got blank Situation Boards that never resolved.

**The fix:** Emergency Vercel concurrency limit increase (bought two days). Then a two-week BullMQ migration. Every `POST /api/v1/situations` now enqueues a job. The response returns immediately with the `situation_id` and `stream_url`. The BullMQ worker picks up the job, runs the pipeline, and the SSE stream delivers progress. The user experience did not change — they subscribed to the stream either way. The infrastructure footprint changed entirely.

**What to do differently in 2026:** Keep the synchronous implementation for months 1–3. But build the agent pipeline behind a `runPipeline(situation: SituationContext): Promise<DecisionResult>` abstraction from day one. The handler calls this function. It does not know or care whether the function runs inline or via a queue. When the time comes to migrate to BullMQ, the migration touches one file: the implementation behind `runPipeline`. The callers — the route handlers, the stream — remain unchanged. The two-week migration becomes a two-day swap.

The abstraction costs nothing at launch. The absence costs two weeks during growth.

---

### 3.2 No Observability on Agent Runs

**The original decision:** The `situation_agent_runs` table — defined in `DATABASE.md` under V2 Migration Checklist, Milestone 2 — was deferred from V1. The table captures per-agent timing (`latency_ms`), token counts (`input_tokens`, `output_tokens`), the model used, and error messages. The migration SQL was written. The Prisma model spec was written. The instruction was explicit: "Non-blocking — failure to write must never block the agent pipeline." We shipped without it.

**When the pain became unbearable:** Month 5. Claude API experienced a documented performance degradation event. Our Planning Agent — `claude-sonnet-4-6` — was the affected model. P95 planning latency went from 3s to 18s. We knew from Vercel logs that the `POST /situations` route was slow. We did not know whether the latency was in the Tool Agent's Swiggy MCP call, the Planning Agent's inference, the database write, or the SSE flush. We spent four days adding temporary `console.time()` calls to the pipeline before we had a clear answer. The degradation lasted six days. We flew blind for four of them.

**The fix:** Added `situation_agent_runs` at month 6 — a two-day implementation. Every agent call wraps in a try-catch that writes a row on completion and swallows write errors. Added an Axiom dashboard showing P50/P95/P99 latency by agent name. The next Claude API event, at month 11, was diagnosed in 20 minutes.

**What to do differently in 2026:** The table is 20 lines of SQL. The Prisma model is another 15 lines. The agent wrapper is a `withAgentInstrumentation(agentName, fn)` higher-order function. Write it on week two, after the first agent call works. If it never gets used for debugging, the cost is negligible. If it's missing when you need it, the cost is weeks.

---

### 3.3 Neon PostgreSQL Cold Starts

**The original decision:** V1 deployed on Neon's free tier. Neon's serverless PostgreSQL architecture scales to zero after inactivity — in practice, this means cold start latency of 500ms–2s after a period with no queries.

**When the pain became unbearable:** Months 1–3. Traffic was sparse and bursty: a batch of users in the morning, silence for two hours, a batch at lunch. Neon cold-started constantly. The Clerk `userId` lookup — the first database query on every authenticated request — was consistently 700ms–1.8s at these moments. This was longer than the Intent Agent's inference time. P99 latency during the first three months was dominated not by the LLM but by the database connection establishment.

This was not dramatic. No outage. But it set a bad baseline expectation for the product: "MealOS is sometimes slow to respond." That impression formed in users who tried it in January 2027 before we migrated.

**The fix:** Migrated to a dedicated Railway PostgreSQL instance at month 4. ₹3,200/month. The first query was 8ms. P99 dropped by 1.4 seconds overnight.

**What to do differently in 2026:** Budget ₹3,000/month for Railway PostgreSQL from month 1. The free Neon tier is appropriate for projects where the database is not in the critical path of a real-time AI planning loop. Ours is: the auth middleware hits the database on every request. The Context Agent hits it for memory facts. The state machine writes on every pipeline transition. Neon's cold starts touch all of these. The free tier was not free — it cost user trust during the period when first impressions mattered most.

---

### 3.4 The `user_memory_facts` Key-Value Schema

**The original decision:** The `fact_key` column in `user_memory_facts` is a VARCHAR. The `DATABASE.md` documents a "standard key registry" with 16 keys. The keys follow dot-notation: `dietary.restrictions`, `budget.daily_food_target`, `preference.cuisines.liked`. There was no validation of `fact_key` against an enum at insert time. The registry was documentation, not enforcement.

**When the pain became unbearable:** Month 6. The Memory Agent, which writes new facts after each completed situation, had been inferred from a prompt that was updated in month 4. The month 4 prompt update introduced the key `preference.cuisine.liked` (singular `cuisine`) for a new inferred preference fact. The correct key in the registry was `preference.cuisines.liked` (plural). Both keys existed in the database: some users had facts under the singular key (written by the v2 Memory Agent prompt), some had facts under the plural key (written by onboarding and the v1 Memory Agent), and some had both with different values.

The Context Agent's `fromMemory` block read from `preference.cuisines.liked`. Users who had only the singular-key facts had their cuisine preferences silently ignored during planning. Their recommendations were less accurate. The Planning Agent's cuisine bonus in `prefMatchScore` was not firing for these users.

Finding it took three weeks because the bug produced no errors — just worse recommendations. A data quality audit of `user_memory_facts` revealed the divergence.

**The fix:** An enum of valid fact keys in a `fact_keys.ts` constants file, validated at every upsert call. A migration to consolidate duplicate keys. A Memory Agent prompt audit to ensure all key references match the enum.

**What to do differently in 2026:** The `DATABASE.md` had the right instinct — document the key registry — but documentation without enforcement is not a contract. The `FactValueByKey` TypeScript type existed for the value shape but not for the key string itself. Add a `FactKey` string literal union type from week one:

```typescript
type FactKey =
  | 'dietary.restrictions'
  | 'dietary.allergies'
  | 'budget.daily_food_target'
  | 'preference.cuisines.liked'
  // ... etc
```

Any Memory Agent write that uses a string literal not in this union fails at compile time. The bug would have been caught at the moment the bad key was introduced into the prompt template — not three months and countless recommendations later.

---

### 3.5 Prompt Versioning

**The original decision:** Prompts were stored as Markdown files in `docs/prompts/` — `planning.md`, `conversation.md`, `memory.md`, `tool.md`. Each file has a `VERSION: 1.0.0` header. There was no mechanism for: tracking which version of a prompt processed a given situation, detecting when a prompt change would break the output schema a downstream consumer expected, or rolling back a prompt change without a full deployment.

**When the pain became unbearable:** Month 4. The Conversation Agent prompt (`conversation.md`) was updated to improve intent classification for the `office_lunch` situation type. Old situations in the database — specifically those in a terminal `error` state that our retry logic was re-processing — had been processed with the v1 prompt. The v1 prompt produced a `situation_type` ENUM of `lunch_at_work`. The v2 prompt produced `office_lunch`. These were not the same ENUM value. The database ENUM did not accept `lunch_at_work`. The retry logic errored silently on 3,400 old situations.

**The fix:** Every agent call now logs the prompt file's hash (SHA-256 of the prompt content) in the `situation_agent_runs` table. Every situation row records `prompt_hash` for each agent that processed it. Prompt changes that alter the output schema require a schema migration to handle old and new formats concurrently before the old format is retired. Retries use the prompt version that was current when the situation was created.

**What to do differently in 2026:** Treat prompts as versioned artifacts from the first deploy. A `lib/prompts/` directory with objects like `{ version: '1.0.0', hash: string, template: string }` makes the version a first-class value that travels with the prompt. The situation row records which version processed it. Rollback is a config change, not a deployment. The `docs/prompts/` approach works for documentation; it does not work for operational tracking.

---

### 3.6 Single Swiggy MCP Dependency

**The original decision:** The entire ORDER and DINE_OUT recommendation flow depended on `lib/mcp/swiggy.ts` — a single MCP client wrapping Swiggy Food, Instamart, and Swiggy Dineout. The `ARCHITECTURE.md` described a degradation chain (Swiggy down → fallback to COOK), but no second provider was implemented. The fallback strategy was documented but the second provider never shipped.

**When the pain became unbearable:** Month 7. Swiggy had a 4-hour MCP outage beginning at 12:15 PM IST. This is peak lunch hour. Every situation that scored ORDER or DINE_OUT as winner saw `swiggAvailable = false` set by the availability check in `determineAvailability()`. Per the path availability rules in `DECISION_ENGINE.md`, ORDER and DINE_OUT were eliminated. The scorer returned COOK as winner for situations where the user had explicitly indicated they could not cook — `canCook === false`. The COOK path was also eliminated. Every such situation returned `NO_WINNER`.

We issued refunds for the session fees to approximately 11,000 users. Swiggy's SLA did not cover partner-facing MCP outages.

**The fix:** Zomato integration went live at month 9, using the same `food-provider.ts` interface that we extracted `swiggy.ts` into. Fallback routing: if Swiggy MCP returns an error, the Tool Agent retries with Zomato. Swiggy is primary; Zomato is secondary. The user sees restaurant results regardless of which provider returned them.

**What to do differently in 2026:** The `lib/mcp/swiggy.ts` file should have been `lib/providers/food-provider.ts` — a TypeScript interface — from week one. Swiggy would be the first implementation (`lib/providers/swiggy-food-provider.ts`). The interface definition costs one afternoon. The outage cost 11,000 refunds. The abstraction does not require a second implementation to be valuable — it requires only that the first implementation conform to a contract that a second implementation can satisfy when it is built.

---

### 3.7 No Caching on Swiggy Responses

**The original decision:** The Tool Agent called Swiggy MCP fresh for every situation. No response caching. At 10k MAU with geographically distributed users, this was correct — cache hit rates would have been negligible.

**When the pain became unbearable:** Month 8. 400k MAU. The same 200 restaurants in Bandra West were being fetched an estimated 50,000 times per day. The Swiggy MCP `swiggy_search_restaurants` response for location `(19.0596, 72.8295)` with a vegetarian filter was effectively identical across calls within a 15-minute window. Each call added 1.2–2.8 seconds of Tool Agent latency.

Adding Redis at month 8 reduced Swiggy MCP calls by approximately 80% for high-density urban locations and dropped P95 planning latency from 5.2 seconds to 3.1 seconds. The cache key was `swiggy:restaurants:{lat_rounded_2dp}:{lng_rounded_2dp}:{filters_hash}` with a 10-minute TTL.

**What to do differently in 2026:** Redis does not need to be in the production architecture from month 1. But it should be in the architecture as a named dependency from month 1, even if it starts with a no-op in-memory implementation. A `CacheService` interface with `get(key)` and `set(key, value, ttlSeconds)` takes an afternoon to design. Implementing it with a real Redis client at month 4 — before the density problem arrives — is a planned improvement, not an emergency. Implementing it at month 8 under performance pressure means cutting corners on TTL strategy, cache invalidation rules, and key namespace design.

---

## Section 4: The Scaling Inflection Points

At which user counts did specific architectural limits break?

| Users | What Broke | Emergency Fix | Proper Fix | Time Lost |
|---|---|---|---|---|
| 50k | Neon PostgreSQL cold starts dominated P99 | pgBouncer connection pooler added | Migrated to Railway PostgreSQL dedicated instance | 3 days of investigation, 1-day migration |
| 200k | Synchronous pipeline under sustained load; Vercel function concurrency limits | Increased Vercel max concurrency; aggressively cached Clerk `userId` resolution | BullMQ queue-based pipeline with dedicated worker | 2 weeks emergency migration during IPL Finals month |
| 400k | Swiggy MCP called fresh per situation; 50k/day repeat fetches for identical location+filter queries | Manual request coalescing in the Tool Agent (deduplicate in-flight requests for same location) | Redis with 10-minute TTL keyed on `lat:lng:filters_hash` | 1 week to instrument, design, and deploy Redis layer |
| 500k | Planning Agent `claude-sonnet-4-6` token costs reaching ₹2.5L/month | Aggressive context truncation passed to Planning Agent (trim `fromMemory` to only populated keys) | Smart truncation strategy: situation-type-aware context pruning; cache Planning Agent responses for identical `SituationContext` hashes | 3 weeks to instrument cost, design truncation, validate recommendation quality did not degrade |
| 800k | `user_memory_facts` table scans slow due to growth; the `(user_id, expires_at)` index not covering the `WHERE user_id = $1` query pattern optimally | Emergency covering index added | Proper composite index `(user_id, fact_key, expires_at)` plus VACUUM ANALYZE | 2 days |
| 1M | Monorepo deploy conflicts; mobile app team and web team shipping simultaneously; shared API route handlers causing merge conflicts and broken deploys | Feature flags to decouple mobile and web surfaces from API changes | Service extraction: `api.mealos.ai` as a standalone Express service; Next.js frontend hits it via reverse proxy | 1 month of incremental extraction |

---

## Section 5: What We'd Redesign in 2028

If starting MealOS today with two years of operational knowledge, five structural changes:

### 5.1 Event-Driven Memory Agent from Day One

The Memory Agent today runs as a post-hoc async job triggered by the `user_actions.action_type = 'executed_*'` event. It reads the situation, the recommendation, and the user action, then calls `prisma.userMemoryFact.upsert()` for each inferred fact.

The architecture that should have existed: every user action emits a domain event (`MemoryUpdateRequested`). The Memory Agent consumes these events from a queue. Multiple consumers can listen — one writes structured facts, one updates embeddings, one updates the analytics summary. The `fact_key` validation happens at event emission, not at write time.

This would have prevented the key collision bug. The event schema would have contained a `factKey: FactKey` field — typed, not a free-form string. The bug would have been a TypeScript compile error at the producer, not a three-week hunt in production data.

### 5.2 Prompt Versioning as a First-Class Concept

A `lib/prompts/` directory (replacing `docs/prompts/`) with versioned prompt objects:

```typescript
interface VersionedPrompt {
  name: string;
  version: string;
  hash: string;      // SHA-256 of the template content
  template: string;
  outputSchema: z.ZodType; // Zod schema for the expected output shape
}
```

Every agent call receives a `VersionedPrompt`. Every `situation_agent_runs` row records `prompt_hash`. Rollback is: update which prompt version the agent loader returns. The output schema validation at the agent boundary catches the prompt-version/output-schema mismatch before it corrupts database rows.

### 5.3 The Decision Engine as a Package

`lib/engine/scorer.ts` is now imported by:
- The Next.js API route handlers (web)
- The React Native mobile app (via shared package)
- The WhatsApp bot service
- The internal analytics dashboard (to replay historical situations with new weight tables)
- The A/B testing harness

Extracting it from `lib/engine/` into a proper `@mealos/decision-engine` package is painful when it was never designed for extraction — the TypeScript interfaces in `lib/engine/types.ts` are not exported from a package boundary, the `WEIGHT_TABLE` constant is not parameterized for external override, and the test suite is co-located with the Next.js test infrastructure.

If the scorer is a genuine engine — and it is, the `DECISION_ENGINE.md` spec calls it exactly that — it should be a package from day one. The package has no dependencies on Next.js, Prisma, or Clerk. It is pure TypeScript functions. Extracting it should have been trivial. Instead, it took two sprints.

### 5.4 Redis from Month 1 as a Planned Dependency

Not as a running service on day one of coding. But as a named interface in the architecture — a `CacheService` with a no-op implementation for local development and a Redis implementation for production — from week one of planning.

When the density problem arrives (and it will arrive, because food ordering is geographically concentrated), the Redis implementation drops in. The cache key strategy, TTL policy, and namespace design are thought through before the emergency, not during it.

### 5.5 Multi-Provider from the Start

`lib/providers/food-provider.ts`:

```typescript
interface FoodProvider {
  searchRestaurants(query: RestaurantSearchQuery): Promise<Restaurant[]>;
  searchDineout(query: DineoutSearchQuery): Promise<Venue[]>;
  searchGroceries(query: GrocerySearchQuery): Promise<GroceryItem[]>;
}
```

`lib/providers/swiggy.ts` implements `FoodProvider`. Zomato or Zepto is the second implementation, added whenever — day 30, day 90, whenever it's prioritized. The Tool Agent's `swiggy_search_restaurants` becomes `provider.searchRestaurants`. The planning pipeline does not know which provider returned the data. Swiggy's 4-hour outage becomes a routing change in the provider registry, not a four-hour incident.

This abstraction costs one afternoon in July 2026. We chose not to do it because the Swiggy MCP partnership was the only active integration. That reasoning was correct at day one. It remained correct until it wasn't — and when it stopped being correct, it cost 11,000 refunds.

---

## Section 6: What We Were Right to Defer

Not all deferrals hurt us. Some were correct decisions that would have been wasteful if made earlier:

**pgvector:** Added at month 8, after structured memory had been running for 8 months and we had actual conversation history worth retrieving. Before month 8, we had fewer than 50,000 conversations per user cohort — not enough history to make semantic retrieval meaningfully better than key-value lookup. Adding pgvector before structured memory was proven would have been optimization theater.

**Turborepo:** Added at month 11, when the mobile app team needed to import `@mealos/decision-engine` and `@mealos/types` in React Native. Before the mobile app existed, Turborepo would have been infrastructure for an imagined future. The monorepo boundaries were clear enough from the Next.js structure that the migration was mechanical.

**Budget and Nutrition as separate agents:** Extracted at month 14, when the Planning Agent's system prompt had grown to 4,200 tokens and a single edit was touching six different reasoning sections. Before month 14, the Planning Agent's scope was manageable. Premature extraction would have introduced inter-agent contracts without the prompt complexity that justified them.

**BullMQ from launch:** Deferring queues from day one was correct — the complexity of a queue-based pipeline would have slowed the early iteration loop significantly. The mistake was not deferring queues; it was not building the `runPipeline` abstraction that would have made queue adoption a one-day swap instead of a two-week emergency.

**Mobile app:** Launched month 18. Before we had stable API contracts and a clear understanding of which platform-specific features mattered (push notifications for planning completion, native location for geolocation context), a mobile app would have been premature. The 18-month delay let the web product define the architecture; the mobile app consumed that architecture.

---

## Section 7: Letter to the 2026 Engineering Team

---

You are about to ship MealOS. Here is what I wish someone had told me on launch day.

**Build `situation_agent_runs` in week two.** Not month six, week two. You will have your first agent call working within a few days of starting. The day after that, add the instrumentation wrapper. The table is twenty lines of SQL in `DATABASE.md` — it is already written. The Prisma model is another fifteen lines. The wrapper function is a `withAgentInstrumentation(agentName, fn)` that records start time, end time, token counts, and errors. Wrap every agent call with it. When something goes wrong at scale — and something will go wrong at scale — you will be grateful. The absence of this table costs weeks. Its presence costs an afternoon.

**Add the `FactKey` TypeScript union type on day one of writing the Memory Agent.** Open `DATABASE.md`, copy the key registry, turn it into a string literal union, and use it everywhere the Memory Agent writes. This is twenty minutes of work. Three weeks of debugging the `preference.cuisine.liked` vs `preference.cuisines.liked` divergence is avoidable with twenty minutes of work. Do not skip this.

**The two tools that would have saved the most time:** First, an Axiom (or equivalent) logging pipeline with structured log emission from day one. We had `console.log` in Vercel functions for the first six months. Querying structured logs across agent runs would have halved every debugging session. Second, a proper prompt hash logged against every agent invocation. When a prompt changes and behavior changes, you need to know which situation was processed by which prompt. Without this, prompt regressions are invisible until they accumulate into a noticeable pattern.

**The one architectural decision that was irreversible:** The choice to put `lib/mcp/swiggy.ts` directly in the callsites rather than behind a `FoodProvider` interface. Every time we touched this file we had to trace all the callers. When Zomato was integrated at month 9, we refactored every Tool Agent prompt that mentioned "Swiggy" by name. If we had built the interface in week one, the integration would have been a new file in `lib/providers/`. The refactor at month 9 took a week. The interface design in week one would have taken an afternoon.

**Do not overthink the agent count.** Four agents is the right number for launch. You will feel pressure to add more. The Budget Agent seems logical. The Nutrition Agent seems logical. Resist both until the Planning Agent's system prompt is genuinely unmanageable. "This feels like it should be its own agent" is not a reason to add one. "The prompt has grown so large that a single edit has unpredictable effects" is a reason. The first condition arrives at month two. The second condition arrives at month fourteen.

**Do not overthink the infrastructure.** The synchronous pipeline, the single Vercel deployment, the Neon free tier — none of these need to be replaced before the product has proven itself. But abstract the seams that you know will eventually need to change: the pipeline entry point, the Swiggy MCP call site, the cache layer. Abstractions at seams are cheap. Retroactive extraction under load is expensive.

One more thing. The viral moment — "the app that figures out what to eat when you're broke" — came from the `broke` situation type, where `budgetFit` has a weight of `0.50` and the scorer aggressively penalizes any path over budget. That situational precision is what made the recommendation feel uncanny to users who were, genuinely, broke. The scoring engine you are about to ship is the product. Protect it.

— Founding Engineer, July 2028
