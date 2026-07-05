# Architecture Decision Records

This document is a permanent log of significant technical decisions made for MealOS AI. Each record captures what was decided and, more importantly, why — so future engineers do not unknowingly undo decisions that were made deliberately.

ADRs are append-only. If a decision is reversed, a new ADR supersedes the old one rather than modifying it.

---

## ADR-001: Deterministic TypeScript Scoring Instead of LLM for Recommendations

**Date:** 2026-07-06
**Status:** Accepted
**Deciders:** Engineering team

### Context

MealOS AI recommends meal options to users based on their situation (time of day, energy level, dietary constraints, budget, etc.). An obvious early approach was to feed the situation to Claude and ask it to rank options. This would require no scoring code and would feel "smart" immediately.

### Decision

Recommendation scoring is implemented as deterministic TypeScript in `lib/engine/scorer.ts`. Claude agents handle natural language understanding and generation (parsing user input, generating plan explanations), but the numerical scoring and ranking of options is pure code.

### Rationale

- **Reproducibility.** The same situation must produce the same ranking every time. LLM outputs are non-deterministic. Users notice inconsistency and lose trust quickly in a recommendation product.
- **Debuggability.** When a user gets a bad recommendation, we need to understand why. With a deterministic scorer we can inspect the exact weights and scores. With an LLM we get an explanation but not a traceable computation.
- **Cost.** Scoring runs on every request. At scale, running claude-sonnet-4-6 on every scoring operation would cost orders of magnitude more than a TypeScript function. The scorer runs for free.
- **Testability.** Pure functions are trivially unit-testable. We can specify expected scores for known inputs and catch regressions in CI. LLM outputs require probabilistic evaluation.
- **Latency.** A synchronous TypeScript function takes microseconds. An LLM call takes 1–5 seconds and requires network I/O.

### Alternatives Considered

- **Full LLM scoring:** Claude ranks options by reasoning about them. Rejected for non-determinism, cost, and latency reasons above.
- **Hybrid: LLM sets weights, code scores:** Claude interprets the situation and outputs a weight vector, then code applies it. Closer but still adds LLM latency on every request and introduces non-determinism in the weight assignment. Deferred to a future ADR if situational weight adaptation proves necessary.

### Consequences

- **Easier:** Scoring is fast, cheap, testable, and reproducible. Product decisions about what matters in each situation are explicit and reviewable in code.
- **Harder:** Adding new scoring dimensions requires writing and testing code, not just prompting. The weight values encode product opinions that engineers must be intentional about.
- **Constraint:** The scorer must remain pure (no side effects, no async). Any dimension that requires an API call (e.g., checking real-time availability) belongs in a pre-processing step that enriches the option before it reaches the scorer.

### Revisit Trigger

Revisit if users report that recommendations feel rigid or miss obvious personal preferences that cannot be expressed through the current weight table structure. The next step would be personalised weight tables per user, still deterministic but learned from feedback.

---

## ADR-002: 4 Agents Instead of 10 for V1

**Date:** 2026-07-06
**Status:** Accepted
**Deciders:** Engineering team

### Context

Early system design decomposed meal planning into many specialised agents: a Budget Agent, a Nutrition Agent, a Recipe Agent, a Cuisine Preference Agent, a Scheduling Agent, a Memory Retrieval Agent, a Constraint Checker Agent, etc. This felt thorough but raised immediate engineering concerns.

### Decision

V1 ships with exactly four agents:
1. **Planning Agent** — the primary agent; handles situation analysis, recommendation reasoning, and plan assembly. Budget, nutrition, and cuisine preference are inputs the Decision Engine processes, not separate agents.
2. **Memory Agent** — reads and writes user memory facts (preferences, constraints, history).
3. **Recipe Agent** — fetches and summarises cooking instructions from YouTube.
4. **Scheduler Agent** — handles reminder timing and schedule-related reasoning.

### Rationale

- **Coordination cost.** Each agent-to-agent boundary requires a handoff: serialising output, passing it as input, handling failures at each step. With 10 agents, a full pipeline has 9 handoff points that can each fail. With 4, there are 3. Coordination bugs are hard to debug.
- **Latency.** More agents means more sequential LLM calls. The Planning Agent doing what 4 micro-agents would do is significantly faster because it uses a single context window rather than making 4 round-trips.
- **V1 scope.** Budget, nutrition, and cuisine preference are deterministic inputs to the scorer. They do not benefit from LLM reasoning in V1 — they are structured fields. Wrapping them in agents would add cost and latency with no benefit.
- **Testing surface.** Four agents have four prompt golden sets to maintain. Ten agents would have ten. The team is small; fewer surfaces means more thorough coverage.

### Alternatives Considered

- **10+ micro-agents:** Maximum modularity, each agent has a single responsibility. Rejected for V1 due to coordination complexity and latency multiplication.
- **1 mega-agent:** One agent handles everything. Rejected because the memory, recipe, and scheduler concerns are genuinely separable and have different latency profiles (Memory and Scheduler use claude-haiku-4-5; Planning uses claude-sonnet-4-6).

### Consequences

- **Easier:** Simpler pipeline, fewer failure modes, easier to trace a request end-to-end.
- **Harder:** The Planning Agent prompt is complex — it handles more responsibilities. Changes to that prompt need careful regression testing.
- **Constraint:** When a new concern genuinely requires LLM reasoning (e.g., an Allergy Safety Agent that reasons about ingredient combinations), it warrants a new agent. The bar for adding an agent is: "this cannot be done deterministically and the Planning Agent is not the right scope for it."

### Revisit Trigger

Revisit if the Planning Agent prompt exceeds ~2,000 tokens of instructions, if its golden set failure rate increases, or if a new V2 feature (e.g., group meal planning, dietary medical integration) requires reasoning that clearly belongs in a separate agent.

---

## ADR-003: Synchronous Agent Pipeline for V1 (No BullMQ)

**Date:** 2026-07-06
**Status:** Accepted
**Deciders:** Engineering team

### Context

Agent pipelines are slow (multiple LLM calls, external API calls to Swiggy MCP and YouTube). A natural engineering instinct is to put them in a background queue (BullMQ, Inngest, etc.) immediately to avoid blocking HTTP responses.

### Decision

The V1 agent pipeline is synchronous: the API route awaits the full pipeline and returns the result in the HTTP response. No job queue is introduced in V1. SSE is used to stream progress updates to the client while the pipeline runs.

### Rationale

- **Simplicity over premature optimisation.** A queue adds infrastructure (Redis), operational complexity (job failures, retries, dead-letter queues), and a new async contract between the API and the client. This is significant complexity before we know if it is needed.
- **SSE solves the user-experience problem.** The reason to use a queue is usually "the request takes too long." SSE lets us stream planning steps to the client as they complete, so the user sees progress without waiting for a complete response. The request can run for 10–15 seconds and still feel responsive.
- **V1 use cases don't require it.** Queues become necessary when you need: background jobs that run without a user waiting (e.g., scheduled reminders), retries after failures without user involvement, or fan-out to many workers. V1 has none of these. Reminders and scheduled plans are V2 features.
- **Request timeout is acceptable.** The current pipeline completes in 8–12 seconds on average. Vercel's function timeout is 60 seconds. There is headroom.

### Alternatives Considered

- **BullMQ from day one:** Proper job queue backed by Redis. Rejected for V1 — requires Redis infrastructure, adds a complex new async pattern, and solves a problem we don't yet have.
- **Inngest:** Managed background job platform. Better DX than BullMQ but still adds an external service dependency and changes the programming model. Deferred to V2.

### Consequences

- **Easier:** No Redis to run locally or manage in production. The entire request lifecycle is a single traceable async function. Errors surface immediately in the HTTP response.
- **Harder:** If the pipeline exceeds Vercel's timeout, the whole request fails. No automatic retry on transient agent failures — the user must refresh.
- **Constraint:** When V2 introduces scheduled reminders or plan generation that runs without a user waiting, a queue will be required. The code should be written so that the pipeline function can be called from either a route handler or a job worker without changes.

### Revisit Trigger

Revisit when V2 adds scheduled reminders, when users report planning timeouts, or when the average pipeline latency exceeds 20 seconds.

---

## ADR-004: SSE Over WebSocket for Real-Time Planning Graph

**Date:** 2026-07-06
**Status:** Accepted
**Deciders:** Engineering team

### Context

The Planning Graph UI shows live progress as the agent pipeline runs: situation analysis → memory retrieval → option scoring → plan assembly. This requires real-time updates pushed from the server to the client.

The two standard options for this in web development are WebSocket (full-duplex) and Server-Sent Events (server-to-client unidirectional).

### Decision

Server-Sent Events (SSE) via the `lib/sse.ts` helper. The API route writes events to a `ReadableStream` and the client connects via the browser's native `EventSource` API.

### Rationale

- **The communication is inherently unidirectional.** The server pushes progress events; the client only listens. WebSocket provides bidirectional communication that is simply not used here. SSE is the correct tool for a server-push pattern.
- **SSE works natively in Next.js App Router.** Route handlers can return a `ReadableStream` with the right headers; no additional server infrastructure needed. WebSocket requires a separate WS server or a library with its own lifecycle.
- **SSE uses HTTP.** It works through proxies, load balancers, and CDN edges that are already configured for HTTP/2. WebSocket upgrades can be blocked by corporate proxies and require special handling in some hosting environments.
- **SSE has automatic reconnection.** The browser's `EventSource` reconnects automatically if the connection drops. Implementing equivalent reliability in a WebSocket client requires more code.
- **Vercel supports streaming responses.** Vercel's edge and serverless functions can stream SSE responses natively. WebSocket on Vercel requires a separate service.

### Alternatives Considered

- **WebSocket:** Full-duplex, lower overhead at scale. Rejected because bidirectionality is not needed and the infrastructure overhead is higher.
- **Long polling:** Simpler but chatty. Rejected because it creates unnecessary load and adds latency between events.
- **Third-party real-time service (Pusher, Ably):** Solves the problem but adds an external dependency and cost. Not warranted at V1 scale.

### Consequences

- **Easier:** SSE is implemented with standard web APIs (`ReadableStream`, `EventSource`). No special libraries needed. Works naturally with Next.js streaming.
- **Harder:** SSE is HTTP/1.1 limited to 6 connections per origin in older browsers (not an issue for modern browsers using HTTP/2). SSE cannot send data from client to server — any user interaction during planning goes through a separate API call.
- **Constraint:** If a future feature requires bidirectional real-time communication (e.g., collaborative planning with multiple users editing simultaneously), WebSocket or a similar protocol will need to be introduced.

### Revisit Trigger

Revisit if a feature requires client-to-server streaming, if SSE connection limits become a problem at scale, or if a collaborative real-time editing feature is planned.

---

## ADR-005: Structured Memory Only for V1 (No pgvector)

**Date:** 2026-07-06
**Status:** Accepted
**Deciders:** Engineering team

### Context

Personalisation requires remembering facts about users: dietary restrictions, preferred cuisines, budget ranges, past reactions to recommendations, household size, etc. Two broad approaches exist: structured key-value facts stored in relational tables, and semantic vector embeddings that allow fuzzy similarity search (pgvector, Pinecone, etc.).

### Decision

V1 stores user memory as structured key-value facts in PostgreSQL. Each fact has a type, value, and confidence score. The Memory Agent reads and writes these facts as structured records. No vector embeddings are used in V1.

### Rationale

- **The facts we need are crisply defined.** "User is vegetarian," "user's budget is under ₹300," "user dislikes spicy food" — these are structured facts, not fuzzy semantic knowledge. A key-value store represents them perfectly. Vector search is optimised for "find facts similar to this query," which is not the retrieval pattern V1 needs.
- **pgvector adds operational complexity.** It requires the `pgvector` extension on the database, embedding generation (another LLM call) on write, and a different query pattern. This is significant added complexity for a benefit we cannot yet demonstrate is needed.
- **Cost.** Generating and storing embeddings for every memory fact adds API cost on every write. In V1, the number of facts per user is small (tens, not thousands) — exhaustive retrieval is perfectly fast.
- **The Memory Agent can structure facts effectively.** Claude is good at extracting structured facts from conversation. We do not need semantic search if the extraction is structured.

### Alternatives Considered

- **pgvector from day one:** Enables semantic memory retrieval — "remember anything similar to what the user just said." Rejected for V1 due to added infrastructure complexity, embedding cost, and the fact that our use cases do not require fuzzy retrieval yet.
- **External vector DB (Pinecone, Weaviate):** More powerful semantic search, fully managed. Rejected for same reasons as pgvector, plus adds an external service dependency.

### Consequences

- **Easier:** Memory storage is standard PostgreSQL. Facts are readable and editable directly in Prisma Studio. The Memory Agent returns typed structured data.
- **Harder:** If a user says "something like what I ordered last Thursday" the system cannot fuzzy-match that to a past situation. Retrieval is exact-match on fact type, not semantic.
- **Constraint:** Fact types must be defined explicitly in the schema. The Memory Agent cannot invent new fact types at runtime — it must map observations to known types.

### Revisit Trigger

Revisit when user memory grows beyond ~200 facts per user (performance concern), when users report that the system "forgot" something it should have known (semantic retrieval gap), or when a personalisation feature requires fuzzy similarity matching.

---

## ADR-006: Single Next.js App Over Monorepo for V1

**Date:** 2026-07-06
**Status:** Accepted
**Deciders:** Engineering team

### Context

Modern full-stack projects often use a monorepo (Turborepo, Nx) to share code between a web app, mobile app, API package, and shared type packages. This enables code sharing but adds tooling complexity.

### Decision

V1 is a single Next.js application with no monorepo tooling. All code — frontend, API routes, agent logic, DB access, types — lives in one Next.js project.

### Rationale

- **No separate frontend/backend split in V1.** Next.js App Router collocates server and client code in one project naturally. There is no mobile app in V1. There is no separate API service. A monorepo would create boundaries between packages that do not yet exist as separate concerns.
- **Turborepo overhead.** Monorepos require configuring build pipelines, understanding package graph caching, and thinking about which packages are affected by which changes. This is meaningful overhead for a team in early-stage development where rapid iteration matters most.
- **Vercel deploys single Next.js apps natively.** Adding Turborepo does not meaningfully change what Vercel can do with a single app. The benefit would only appear if multiple deployable units existed.
- **Refactoring into a monorepo is well-understood.** Moving from a single app to a monorepo later is a mechanical, low-risk migration. The reverse (collapsing a premature monorepo) is much harder.

### Alternatives Considered

- **Turborepo from day one:** Separate packages for `apps/web`, `packages/types`, `packages/engine`, etc. Rejected for V1 — the overhead is real and the benefit is speculative until there is actually something to share across build targets.
- **Separate frontend (Next.js) and backend (Express/Fastify API):** Classic frontend/backend split. Rejected because Next.js App Router handles both well, and splitting now would require managing two deployments, two CORS configurations, and two sets of env vars.

### Consequences

- **Easier:** One repo, one deployment, one `package.json`, one set of TypeScript config. New engineers can understand the full project quickly. `pnpm install` installs everything.
- **Harder:** As the project grows, `lib/` may become large and hard to navigate without clear internal boundaries. Importing server-only code in client components becomes easier to do accidentally (mitigated by Next.js's `server-only` package).
- **Constraint:** The `lib/` directory is server-only by convention. Components import only from `types/`, `hooks/`, and `stores/`. This boundary must be maintained manually until a monorepo enforces it structurally.

### Revisit Trigger

Revisit when a mobile app is planned (requiring shared types package), when the `lib/` directory becomes unwieldy, or when a separate backend service is needed for a reason Next.js cannot serve (e.g., a long-running WebSocket server, a Python ML service).

---

## ADR-007: Clerk for Authentication Over NextAuth

**Date:** 2026-07-06
**Status:** Accepted
**Deciders:** Engineering team

### Context

MealOS AI requires user authentication: sign up, sign in, session management, and associating data with specific users. Two main options were evaluated: NextAuth (now Auth.js), a widely-used open-source auth library for Next.js, and Clerk, a managed auth-as-a-service platform.

### Decision

Clerk is used for all authentication. Clerk's SDK handles sign-up, sign-in, session management, and user object access. The `userId` from Clerk's session is the foreign key that associates all application data with users.

### Rationale

- **Time to working auth is minutes, not days.** Clerk provides pre-built UI components (sign-in, sign-up, user profile) that are customisable to match the design system. NextAuth requires building all UI from scratch or using unstyled primitives.
- **Managed complexity.** Clerk handles email verification, password hashing, session security, token rotation, and OAuth provider management. Getting all of this right with NextAuth requires significant implementation time and ongoing maintenance.
- **Social login without configuration.** Adding Google or Apple sign-in with Clerk is a dashboard toggle. With NextAuth it requires setting up OAuth credentials for each provider, handling callback URLs, and writing provider config.
- **Clerk has first-class Next.js App Router support.** The Clerk middleware and server-side helpers work natively with Next.js 16. NextAuth's App Router support was immature when this decision was made.
- **Free tier is sufficient.** Clerk's free tier covers the scale we expect in V1 and early V2.

### Alternatives Considered

- **NextAuth (Auth.js):** Open-source, no vendor dependency, deeply integrated with the Next.js ecosystem. Rejected because the App Router support was incomplete, UI must be built from scratch, and the implementation time cost was high for a feature that is infrastructure, not product differentiation.
- **Supabase Auth:** Managed auth bundled with a Postgres host. Rejected because we use Vercel Postgres + Prisma for the database, not Supabase, and mixing two Postgres providers would add unnecessary complexity.
- **Rolling our own:** JWT-based auth with session tokens stored in the DB. Rejected firmly — auth is not a competitive advantage and DIY auth has a long history of security vulnerabilities.

### Consequences

- **Easier:** Auth is fully working with minimal code. OAuth providers can be added without code changes. Security vulnerabilities in the auth layer are Clerk's problem.
- **Harder:** Clerk is a vendor dependency. If Clerk's pricing changes significantly or the service is discontinued, migration is a meaningful effort. User data (email, name, profile) lives in Clerk, not our DB — any query that needs user details must call the Clerk API or rely on the session data.
- **Constraint:** The `userId` from Clerk's session is treated as the canonical user identifier throughout the app. It is stored as a string foreign key in all user-associated tables. This is consistent with Clerk's model and should not change.

### Revisit Trigger

Revisit if Clerk's pricing makes it cost-prohibitive at scale, if a compliance requirement demands hosting user credentials ourselves (e.g., HIPAA), or if Clerk's API reliability becomes a concern.

---

## ADR-008: claude-sonnet-4-6 for Planning Agent, claude-haiku-4-5 for All Others

**Date:** 2026-07-06
**Status:** Accepted
**Deciders:** Engineering team

### Context

MealOS AI uses four agents. Each agent call has a cost (tokens × price/token) and a latency profile. The Anthropic API offers multiple model tiers with different capability/cost/speed trade-offs. Assigning the right model to each agent role materially affects both the user experience and the per-request cost.

### Decision

- **Planning Agent:** `claude-sonnet-4-6` — the highest-capability model in use.
- **Memory Agent:** `claude-haiku-4-5` — fast, cheap, structured task.
- **Recipe Agent:** `claude-haiku-4-5` — fast, cheap, structured task.
- **Scheduler Agent:** `claude-haiku-4-5` — fast, cheap, structured task.

### Rationale

**Planning Agent on claude-sonnet-4-6:**
The Planning Agent performs the most complex reasoning in the pipeline: it interprets ambiguous natural language situations, reasons about multiple competing constraints, and synthesises a coherent meal plan with natural language explanations. This is the task where capability differences between model tiers are most visible to users. Using the most capable available model here produces meaningfully better plans and explanations. The cost premium is justified by the quality delta.

**Memory, Recipe, and Scheduler on claude-haiku-4-5:**
- Memory Agent: extracts structured facts from conversation and retrieves matching facts. This is a structured extraction task with a well-defined schema. Claude Haiku performs this reliably and at significantly lower cost and latency.
- Recipe Agent: fetches YouTube metadata and summarises cooking steps. This is a straightforward summarisation task with short, structured output. Claude Haiku handles this well.
- Scheduler Agent: interprets time expressions and reasons about reminder schedules. This is structured reasoning with a small, well-defined output space. Claude Haiku is sufficient.

**Cost impact:**
The full pipeline costs approximately $0.03 per situation at current usage. Upgrading Memory, Recipe, and Scheduler to claude-sonnet-4-6 would increase per-request cost by approximately 4–5x for those calls with no measurable quality improvement on those specific tasks.

### Alternatives Considered

- **All agents on claude-sonnet-4-6:** Maximum quality across the board. Rejected on cost grounds — the improvement in Memory and Scheduler tasks does not justify the cost increase.
- **All agents on claude-haiku-4-5:** Minimum cost. Rejected because the Planning Agent quality degradation is user-visible and significant — plan explanations became noticeably less coherent in evaluation.
- **claude-sonnet-4-6 for Planning + Memory, claude-haiku-4-5 for Recipe + Scheduler:** Evaluated but Memory Agent output quality on Haiku was acceptable; moving it to Sonnet added cost without observable improvement.

### Consequences

- **Easier:** Cost-per-request stays low (~$0.03), which keeps MealOS viable at scale without requiring aggressive caching or rate limiting.
- **Harder:** If task complexity in Memory or Scheduler increases (e.g., complex multi-turn memory reasoning), Haiku may hit its limits. Upgrading will require prompt regression testing.
- **Constraint:** Model assignments are configuration, not hard-coded. The agent file reads the model name from a constant in `lib/claude.ts`. Changing the model for any agent is a one-line edit, making it easy to run comparative evaluations.

### Revisit Trigger

Revisit if Anthropic releases a new model tier that changes the capability/cost frontier, if Memory Agent output quality degrades as fact schemas grow more complex, or if Planning Agent costs grow to the point where a cheaper model is worth evaluating.
