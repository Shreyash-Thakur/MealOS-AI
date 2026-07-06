# MealOS AI — Implementation Playbook

**Project:** MealOS AI
**Last Updated:** 2026-07-07
**Status:** Authoritative build sequence. This is a construction manual, not an architecture document — read ARCHITECTURE.md for *why*, read this for *what to build today and what must already exist before you start it*.
**Related files:** `MVP.md` (scope contract), `docs/GITHUB_ISSUES_P1.md` + `docs/GITHUB_ISSUES_P2.md` (work items referenced as ISSUE-###), `docs/DECISION_ENGINE.md`, `docs/AGENTS.md`, `docs/API.md`, `docs/TESTING.md`, `docs/SWIGGY_MCP.md`

---

## Table of Contents

1. [How to Use This Playbook](#1-how-to-use-this-playbook)
2. [The Milestone Map](#2-the-milestone-map)
3. [The Dependency Graph](#3-the-dependency-graph)
4. [Never-Before Rules](#4-never-before-rules)
5. [Parallelization Tracks](#5-parallelization-tracks)
6. [Day-by-Day Build Order](#6-day-by-day-build-order)
7. [Milestone Detail Sheets](#7-milestone-detail-sheets)
8. [Cut Lines — If You Only Have N Days](#8-cut-lines--if-you-only-have-n-days)
9. [Reconciliation Notes (MVP.md vs Issues Backlog)](#9-reconciliation-notes-mvpmd-vs-issues-backlog)

---

## 1. How to Use This Playbook

**The unit of work is the half-day.** Every scheduled item below is sized to fit a morning or an afternoon of focused work by one person (or one AI coding session). If an item is running past its half-day, it is either misunderstood or over-built — stop and re-read its issue.

**The unit of progress is the milestone exit test.** A milestone is done when its exit test passes, not when its issues are closed. Exit tests are executable: a command plus a manual smoke script. Never start milestone N+1's non-parallel work with milestone N's exit test failing.

**Rules of the build:**

1. Work top to bottom through §6. Deviations are allowed only along the parallel tracks in §5.
2. Check §4 (Never-Before Rules) before starting anything out of order. These rules exist because violating them forces rework, not because of taste.
3. Run the testing checkpoint at every milestone exit. The checkpoint commands are cumulative — every checkpoint re-runs all previous ones.
4. Commit at least once per half-day block. Branch naming and PR flow: see `CONTRIBUTING.md`.
5. When behind schedule, cut scope using §8. Never cut the exit test; cut the milestone.

**What this playbook assumes:** the V1 scope from MVP.md — single Next.js 16 app, no monorepo, no Redis, no BullMQ, no pgvector, synchronous agent pipeline, 4 agents (Conversation, Planning, Tool, Memory) plus the Clarification Engine as a pipeline stage, deterministic Decision Engine in `lib/engine/scorer.ts`. Where ARCHITECTURE.md's long-term design (10 agents, Turborepo, workers) conflicts with this, ARCHITECTURE.md loses for V1.

---

## 2. The Milestone Map

Eleven milestones, 21 working days, one person. Days assume the parallelization noted in §5 is NOT used (worst case, solo, strictly sequential). With two tracks running, the same scope fits ~16 days.

| # | Milestone | Days | Issues | Exit Test (one line) |
|---|---|---|---|---|
| M0 | Foundation | 1.0 – 2.0 | 001–012 | Sign in on the deployed Vercel URL; `pnpm db:seed` runs; CI green on a PR |
| M1 | Onboarding + Memory (read) | 2.5 – 3.5 | 020–023, 026, 029, 030 | Complete 5-question onboarding; facts appear in Memory Panel |
| M2 | Situation Input + Conversation Agent | 4.0 – 5.5 | 040–051, 053 | Type "I'm sick" → ConfidenceCard shows known/missing fields in < 1.5s |
| M3 | Clarification Engine | 6.0 – 7.5 | 060–069 | "I'm sick" → exactly 2 relevant questions → answers raise confidence live |
| M4 | Decision Engine | 8.0 – 9.0 | 075–086 | `pnpm test:engine` green: 30 cases + 8 property invariants, < 5ms per scoreAll |
| M5 | Swiggy MCP Client (mock-first) | 9.5 – 10.5 | 110–122 | All 7 tools return typed results from MockSwiggyMCPClient; fallback chain works |
| M6 | Planning Agent + Situation Board | 11.0 – 13.0 | 090–105, 049 | Full demo loop minus cooking mode: situation → comparison table → recommendation → Swiggy deep link |
| M1b | Memory Panel editable | 13.5 | 024, 025, 027, 028 | Edit a fact, delete a fact, both persist and re-render |
| M7 | AI Cooking Mode | 14.0 – 15.0 | 130–141 | Cook plan → pantry check → Instamart cart → YouTube card → step-by-step to completion |
| M8 | Memory Learning | 15.5 – 16.5 | 145–154 | Answer "150g protein" once → next session's ConfidenceCard already knows it |
| M9 | UI Polish | 17.0 – 18.0 | 160–171 | Mobile audit passes at 375/390/430/768px; theme + graph animations shipped |
| M10 | Testing Infrastructure | 18.5 – 19.5 | 175–184 | Full CI: typecheck → engine → clarify → API → E2E → golden set, < 4 min |
| M11 | Production Hardening | 20.0 – 21.0 | 190–200 | Rate limits live, Zod on all routes, Sentry receiving, P95 situation-to-plan < 6s |

Epic numbering note: the backlog's EPIC 6 (Planning Agent) precedes EPIC 7 (Swiggy) on paper, but the build order is Swiggy-mock → Planning, because ISSUE-091 depends on ISSUE-092 (Tool Agent) which depends on Swiggy tool shapes. See §9, item 1.

---

## 3. The Dependency Graph

```
M0 Foundation
 ├──────────────► M1 Onboarding + Memory(read)
 │                     │
 │                     ▼
 │               M2 Situation Input + Conversation Agent ──────┐
 │                     │                                       │
 │                     ▼                                       │
 │               M3 Clarification Engine                       │
 │                     │                                       │
 ├── (types only) ─► M4 Decision Engine ◄── needs types/, ─────┘
 │                     │        nothing else — PARALLEL TRACK B
 │                     │
 ├── (types only) ─► M5 Swiggy MCP (mock-first) — PARALLEL TRACK C
 │                     │
 │        ┌────────────┴───────────┐
 │        ▼                        ▼
 │   ISSUE-092 Tool Agent    ISSUE-118 Mock client
 │        │                        │
 │        └──────────┬─────────────┘
 │                   ▼
 │             M6 Planning Agent + Board   ◄── M3 (context complete)
 │                   │                     ◄── M4 (scorer output shapes)
 │        ┌──────────┼──────────────┐
 │        ▼          ▼              ▼
 │   M1b Memory   M7 Cooking    M8 Memory
 │     editable      Mode        Learning ◄── M1b (fact write paths)
 │                    │              │
 │                    └──────┬───────┘
 │                           ▼
 │                      M9 UI Polish
 │                           │
 │                           ▼
 └────────────────────► M10 Testing Infra (Vitest lands early — Day 7)
                             │
                             ▼
                        M11 Hardening
```

**Reading the graph:** an arrow means "everything upstream must have a passing exit test." Two arrows into one node means both are required. M4 and M5 hang off M0 with a types-only dependency — they need `types/` to exist and agree, nothing else, which is what makes them parallelizable.

---

## 4. Never-Before Rules

These are the orderings that cause rework when violated. Each has a reason rooted in a contract, not a preference.

| # | Never build… | …before | Because |
|---|---|---|---|
| N1 | Planning Agent prompt (ISSUE-091) | scorer.ts unit-tested (ISSUE-076–086) | The Planning Agent prompt *narrates* scorer output — it receives `{cook: 92, order: 71, dineout: 44}` and explains the winner. If the scorer's output shape or semantics shift after the prompt is written, the prompt, its golden set (ISSUE-183), and the ComparisonTable all break at once. The scorer is the contract; test it first. |
| N2 | Real SwiggyMCPClient tool calls (ISSUE-112–117) | MockSwiggyMCPClient (ISSUE-118) | Half the Swiggy capability matrix is flagged `[VERIFY WITH SWIGGY MCP DOCS]`. If you build against the live server first, every downstream feature blocks on an unverified external dependency. The mock defines the internal contract; the real client conforms to the mock's types, never the reverse. |
| N3 | ClarificationAgent (ISSUE-062) | Required-fields registry (ISSUE-061) | Questions are derived from the gap between `SituationContext` and the per-situation-type required fields. Without the registry, the agent free-associates questions and the max-3 cap (ISSUE-065) has nothing principled to rank against. |
| N4 | Memory Agent writes (ISSUE-146) | FactKey registry (ISSUE-149) | Memory poisoning is permanent: an agent inventing `fact_key` strings pollutes `user_memory_facts` for every future session, and the ConfidenceCard reads those keys. The registry is a const enum; writes to unknown keys must be rejected at compile time and runtime before the first write path exists. |
| N5 | Any API route handler | Clerk integration (ISSUE-004) | The auth middleware shape (`auth()` in every handler, 401 contract) affects the signature of every route. Retrofitting auth onto existing routes is how ISSUE-196 (auth enforcement audit) ends up finding holes. |
| N6 | PlanningGraph SSE animation (ISSUE-049) | Static PlanningGraph (ISSUE-048) + SSE infra (ISSUE-046) | The animated graph is a subscriber to a working event stream rendering a working static layout. Building animation against imagined events means rebuilding it when the real event names (`step_complete` payloads) land. |
| N7 | Recipe step generation (ISSUE-141) | Planning Agent output schema validation (ISSUE-102) | Recipe steps ride inside the Planning Agent's validated output contract. Steps generated before the Zod schema exists will be re-shaped when validation lands, breaking CookingStepCard. |
| N8 | Any EPIC 10 polish (ISSUE-160–171) | M7 exit test | Polishing a flow that then changes is double work. The one exception: skeleton loaders (ISSUE-165) may land with M6 since the board's async states exist then. |
| N9 | Redis, BullMQ, Turborepo, pgvector, workers | V2 — never in this playbook | MVP.md explicitly excludes them. Any PR introducing these in V1 is scope creep regardless of how reasonable it looks. The Memory Agent runs async via `after()`/fire-and-forget, not a queue. |
| N10 | Any direct Swiggy MCP or YouTube call from Planning Agent code | Tool Agent (ISSUE-092) | Architectural invariant: `lib/agents/tool.ts` is the sole intermediary to external services. Enforce with an ESLint `no-restricted-imports` rule on `lib/mcp/*` and `lib/youtube.ts` from `lib/agents/planning.ts` the day the Tool Agent lands. |
| N11 | E2E tests (ISSUE-181–182) | M6 exit test | Playwright against a UI still changing daily is pure maintenance. Unit tests (engine, clarification) land early; E2E lands after the board stabilizes. |
| N12 | Demo recording (Day 21) | M9 + P95 < 6s verified (ISSUE-198) | The demo *is* the deliverable. Recording it before latency is verified risks re-recording. |

---

## 5. Parallelization Tracks

Four tracks can run concurrently after Day 2. Solo builders interleave them (the day-by-day in §6 already does this); two people or two agent sessions split them cleanly.

| Track | Contents | Depends on | Blocks |
|---|---|---|---|
| **A — Product pipeline** | M1 → M2 → M3 → M6(UI) → M7 → M8 | M0 | Everything user-visible |
| **B — Decision Engine** | M4 entirely (`lib/engine/*`, pure TypeScript, zero I/O, zero LLM) | `types/` finalized (Day 2) | M6 (Planning Agent consumes scorer output) |
| **C — Swiggy client** | M5 entirely (mock first, then real tools behind env flag) | `types/` finalized (Day 2) | M6 (Tool Agent wraps these tools) |
| **D — Test infra** | Vitest config (ISSUE-176) Day 7; engine tests with Track B; API + E2E + golden after M6 | Per-item | M10 exit, CI gate |

**Split for two workers:** Worker 1 takes Track A. Worker 2 takes B, then C, then D-early — Worker 2's deliverables (scorer, mock Swiggy, Vitest) all merge before Day 9, exactly when Track A needs them for M6. The synchronization point is the ISSUE-092 Tool Agent: it needs B's types and C's tools, and belongs to whoever finishes first.

**Also parallelizable at component level:** every board UI component (ComparisonTable, DecisionCard, RecommendationCard, PlanSimulator) renders from a typed props object and can be built against fixture JSON before the Planning Agent exists. If a session is blocked on anything, building a board component against `tests/fixtures/recommendation.json` is always safe forward progress.

**Never parallelize:** M3 with M2 (clarification consumes the Conversation Agent's `missingRequired` output); M8 with M1b (Memory Agent writes through the same fact CRUD paths the panel edits); anything with M0.

---

## 6. Day-by-Day Build Order

21 days, AM/PM half-day blocks. ISSUE references in parentheses. **Bold** = milestone exit checkpoint at end of block.

### Week 1 — Foundation + Intelligence Core

| Day | Block | Work |
|---|---|---|
| 1 | AM | Repo init: Next.js 16 App Router, `strict: true`, path aliases, pnpm scripts (002, 011). Env scaffolding: `.env.local.example` with all 6 required vars, `lib/env.ts` runtime assertion (005). |
| 1 | PM | Prisma schema — 5 V1 tables exactly as MVP.md §Database; push to Neon (003). Clerk: middleware, sign-in/up routes, `(app)` group protection (004). |
| 2 | AM | Vercel deploy + preview envs (006). GitHub Actions CI: typecheck + lint on PR (007). Health endpoint (008). Seed script: 2 users, 4 completed situations (009). Error foundation: `AppError` taxonomy, API error envelope, root ErrorBoundary (010). Prisma singleton with connection pool guard (012). **M0 exit checkpoint.** |
| 2 | PM | Finalize `types/` package: `situation.ts`, `recommendation.ts`, `memory.ts`, `agents.ts` — every interface the scorer and Swiggy client will consume. This unblocks Tracks B and C. Onboarding wizard UI, 5 screens, progressive disclosure (021). |
| 3 | AM | POST /api/v1/onboarding — atomic write of 5 answers to `user_memory_facts` (022). GET /api/v1/memory (026). Skip-protection for P0 fields (030). |
| 3 | PM | Memory Panel read view (023) + drawer/sidebar responsive split (029). **M1 exit checkpoint.** |
| 4 | AM | SituationInput component (041), QuickTemplates chips (043). POST /api/v1/situations + situation state machine enforcement (044, 051). |
| 4 | PM | VoiceButton — Web Speech API + Firefox/iOS-Safari unavailability fallback to text (042, 052). |
| 5 | AM | Conversation Agent — Haiku, < 800ms, returns `situationType`, `explicit`, `confidence`, `missingRequired`, `missingSoft` (045). SSE infrastructure: stream route, heartbeat, reconnection contract (046). |
| 5 | PM | ConfidenceCard (047). PlanningGraph static (048). GET /api/v1/situations/:id for SSE-drop recovery (050). History page skeleton (053 — list only; re-run button lands Day 17). **M2 exit checkpoint.** |
| 6 | AM | Required-fields-per-situation-type registry — the MCR table as data, not prompt text (061). ClarificationAgent (062). Memory check before question generation (067). |
| 6 | PM | POST /:id/clarify (063). ClarificationCard with quick-tap options + freetext fallback (064). |
| 7 | AM | Max-3-questions enforcement (065). Assumption statement generation (066). Second-pass logic — max 2 passes, then assume (068). SSE disconnect answer-loss fix (069). |
| 7 | PM | Vitest setup, pulled forward from EPIC 11 (176). Clarification unit tests — 8 scenarios (178). Integration pass over the Week-1 pipeline; fix edge cases. **M3 exit checkpoint. Week 1 gate: type a situation → questions → answers → "Planning…" with live graph.** |

### Week 2 — Decision Engine + Integrations + The Demo Loop

| Day | Block | Work |
|---|---|---|
| 8 | AM | `lib/engine/scorer.ts` core structure + weight tables per situation type (076). Sub-scores: goalMatch (077), budgetFit (078). |
| 8 | PM | Sub-scores: timeFit (079), prefMatch (080). Path availability rules — unavailable paths excluded from scoring, never scored 0 by accident (081). `assertWeightIntegrity()` (082). |
| 9 | AM | Confidence calculator (083). Tie-breaking (084). Plan Simulator delta calc (085). Engine unit suite: 30 cases from docs/DECISION_ENGINE.md + 8 fast-check invariants (086 = 177; see §9 item 6). **M4 exit checkpoint: `pnpm test:engine` green.** |
| 9 | PM | MockSwiggyMCPClient with Mumbai fixtures, injectable via `SWIGGY_MCP_MODE=mock` (118) — before any real tool, per N2. SwiggyMCPClient singleton skeleton + connection lifecycle (111). |
| 10 | AM | Search tools: restaurants (112), instamart with fuzzy matching + compound-name normalization (113, 140), dineout (114). Error taxonomy — 8 typed codes (121). |
| 10 | PM | Cart/reservation tools: food cart (115), instamart cart with out-of-stock handling (116), dineout reservation (117). Fallback chain: MCP down → cook-only + UI notice (119). Partial failure `_meta` contract (122). **M5 exit checkpoint (against mock).** |
| 11 | AM | Tool Agent — sole external intermediary, normalizes Swiggy + YouTube responses, typed degraded responses `{available: false}` (092). `agent_progress` SSE events (103). ESLint restricted-imports rule (N10). |
| 11 | PM | Planning Agent — Sonnet; consumes scorer output, writes explanation, assembles PlanItem (091). Zod output schema validation with one re-ask on failure (102). Swiggy result cap at 20 to prevent context overflow (104). |
| 12 | AM | ComparisonTable (094). DecisionCard (095). PlanningGraph SSE animation (049). |
| 12 | PM | RecommendationCard (096). GET /api/v1/recommendations/:id (099). POST /:id/execute → deep link (100). PlanSimulator (097). "Why Not?" display (098). |
| 13 | AM | Degraded mode: Swiggy down → cook-only plan (101). LLM timeout → simplified fallback plan at 8s (105). Planning integration test (093). **M6 exit checkpoint: full demo loop minus cooking mode.** |
| 13 | PM | Memory Panel editable: inline edit (024), delete + confirm (025), PATCH /api/v1/memory (027), fact expiry logic (028). **M1b exit checkpoint.** |
| 14 | AM | YouTube Data API v3 client (131). YouTubeCard (132). Video attachment via Tool Agent (133). Recipe step generation by Planning Agent — 6–8 steps with timestamps (141). |
| 14 | PM | Pantry check vs recipe ingredients (134 — see §9 item 3). InstamartCart component (135). **Week 2 gate: speak → confidence → 1 question → comparison → recommendation → Swiggy cart pre-filled.** |

### Week 3 — Cooking Mode, Learning, Polish, Hardening

| Day | Block | Work |
|---|---|---|
| 15 | AM | CookingStepCard (136). Step progress tracking + completion screen (137, 139). Inline timestamp clips (138). **M7 exit checkpoint.** |
| 15 | PM | FactKey registry FIRST (149, per N4). Memory Agent — Haiku, async post-execution (146). Async trigger after execute, non-blocking (152). Silent-failure contract (153). |
| 16 | AM | Fact extraction from clarification answers (147) and executed actions (148). Concurrent-write UPSERT fix (154). |
| 16 | PM | Memory panel live refresh after plan_ready (150). Confidence decay for inferred facts (151). **M8 exit checkpoint.** |
| 17 | AM | Theme transition (161). Voice listening animation (162). Graph node completion animation (163). Toast (164). Skeletons if not landed with M6 (165). |
| 17 | PM | Route transitions (166). Latenight mode (169). Empty states (170). History page re-run button (053 completion). |
| 18 | AM | Mobile audit at 375/390/430/768 (167). Comparison table overflow fix (171). Accessibility pass 1 (168). **M9 exit checkpoint.** |
| 18 | PM | API integration test setup — testcontainers Postgres (179). Integration tests for all 10 endpoints (180). |
| 19 | AM | Playwright setup (181). E2E: 5 critical journeys (182). |
| 19 | PM | Prompt golden set framework — 8 input/schema pairs (183). Full CI pipeline < 4 min (184). **M10 exit checkpoint.** |
| 20 | AM | Sentry (191). `situation_agent_runs` logging (192). LLM cost tracking per situation (193). |
| 20 | PM | Rate limiting — 60/min general, 10/min situations, 20/min clarify (194). Zod on all routes (195). Auth enforcement audit (196). Security headers (199). |
| 21 | AM | Prompt injection resilience test (197). P95 profiling + verify < 6s (198). Neon cold-start mitigation (200). iOS deep-link universal link fallback (120). **M11 exit checkpoint.** |
| 21 | PM | Demo recording. Recruiter flow rehearsal ×3. README final pass. **Ship.** |

---

## 7. Milestone Detail Sheets

Each sheet: entry criteria → Definition of Done → file tree delta → testing checkpoint → cut line.

---

### M0 — Foundation (Days 1–2 AM)

**Entry criteria:** Empty repo. Neon project, Clerk app, Vercel project, and API keys already provisioned (do this before Day 1 — account signups are not build work).

**Definition of Done:**
- [ ] `pnpm dev` boots with zero TypeScript errors under `strict: true` + `noUncheckedIndexedAccess`
- [ ] All 5 path aliases resolve (`@/app`, `@/components`, `@/lib`, `@/types`, `@/prisma`)
- [ ] Prisma schema (5 tables: `users`, `user_memory_facts`, `situations`, `recommendations`, `user_actions`) applied to Neon; `pnpm db:seed` idempotent
- [ ] Clerk gates every `(app)` route; signed-out users redirect to sign-in
- [ ] `GET /api/v1/health` returns `{status, db, version}` without auth
- [ ] CI (typecheck + lint) green on a test PR; Vercel production deploy live from `main`
- [ ] `lib/env.ts` throws at boot on any missing env var — no runtime `undefined` surprises
- [ ] Error envelope shape from docs/API.md implemented in one helper, used by health route

**File tree after M0:**
```
mealos/
├── app/{layout.tsx, globals.css, (auth)/sign-in, (auth)/sign-up, (app)/layout.tsx, (app)/page.tsx}
├── app/api/v1/health/route.ts
├── lib/{db.ts, env.ts, errors.ts}
├── prisma/{schema.prisma, seed.ts}
├── styles/mealos.css            # ported tokens, scoped later
├── types/                       # empty barrels, filled Day 2 PM
├── .github/workflows/ci.yml
├── .env.local.example
└── {next.config.ts, tsconfig.json, package.json}
```

**Testing checkpoint:**
```bash
pnpm typecheck && pnpm lint
pnpm db:push && pnpm db:seed
curl -s https://<vercel-url>/api/v1/health | jq .status   # "ok"
```
Manual smoke: sign up with a fresh email → land on empty dashboard → sign out → verify `(app)` route redirects.

**Cut line:** None. M0 is never cut. If M0 takes more than 2 days, the problem is environment/accounts, not code — fix that before proceeding.

---

### M1 — Onboarding + Memory Read (Days 2 PM–3)

**Entry criteria:** M0 exit. `types/memory.ts` drafted (fact key shapes).

**Definition of Done:**
- [ ] 5-question wizard; P0 fields (diet, budget, location) cannot be skipped (030); back-navigation preserves answers
- [ ] POST /api/v1/onboarding writes all answers to `user_memory_facts` in one transaction with `source: 'onboarding'`
- [ ] GET /api/v1/memory returns the fact map; Memory Panel renders it grouped by category
- [ ] Panel is a drawer < 768px, sidebar ≥ 768px (029)
- [ ] Re-login skips onboarding (completion fact checked)

**File tree delta:**
```
+ app/(app)/onboarding/page.tsx
+ app/api/v1/{onboarding/route.ts, memory/route.ts}   # GET only; PATCH in M1b
+ components/memory/{MemoryDrawer.tsx, FactRow.tsx}   # FactRow read-only for now
+ components/ui/{Button.tsx, Card.tsx, Chip.tsx}
+ types/memory.ts
```

**Testing checkpoint:** previous checkpoints, plus:
```bash
pnpm test tests/api/onboarding.test.ts   # atomic write + skip-protection cases
```
Manual smoke: fresh user → onboard with diet=Vegetarian, budget=₹200–400 → Memory Panel shows both → refresh → still there → second login does not re-prompt.

**Cut line:** Voice-free onboarding UI polish. The wizard can be 5 plain screens; animation is M9's job.

---

### M2 — Situation Input + Conversation Agent (Days 4–5)

**Entry criteria:** M1 exit. `ANTHROPIC_API_KEY` verified against claude-haiku-4-5.

**Definition of Done:**
- [ ] SituationInput with rotating placeholder examples; 6 template chips pre-fill and submit (041, 043)
- [ ] VoiceButton: Web Speech API; on unsupported browsers renders text-only without layout shift (042, 052)
- [ ] POST /api/v1/situations validates, persists, returns `{situation_id, stream_url}`; state machine transitions enforced in one module — illegal transitions throw (044, 051)
- [ ] Conversation Agent returns valid `ConversationOutput` for the 8 canonical situation types; P95 < 800ms; malformed LLM output → one re-ask → static fallback (045)
- [ ] SSE stream with heartbeat every 15s; client reconnect resumes via GET /:id state (046, 050)
- [ ] ConfidenceCard renders confidence + known/missing field rows from real agent output (047)
- [ ] PlanningGraph renders all pipeline nodes statically (048)

**File tree delta:**
```
+ app/(app)/history/page.tsx
+ app/api/v1/situations/{route.ts, [id]/route.ts, [id]/stream/route.ts}
+ components/situation/{SituationInput.tsx, VoiceButton.tsx, QuickTemplates.tsx}
+ components/board/{SituationBoard.tsx, ConfidenceCard.tsx, PlanningGraph.tsx}
+ lib/{claude.ts, sse.ts, agents/conversation.ts, engine/stateMachine.ts}
+ hooks/{useSituationStream.ts, useSituation.ts}
+ stores/situationStore.ts
+ types/{situation.ts, agents.ts}
+ docs/prompts/conversation.md wired as the live prompt source
```

**Testing checkpoint:**
```bash
pnpm test tests/agents/conversation.test.ts   # 8 situation types, mocked Anthropic client
pnpm test tests/api/situations.test.ts        # state machine: illegal transition rejected
```
Manual smoke: type "I'm sick" → ConfidenceCard within 1.5s showing diet/budget known (from onboarding), canCook/alone missing. Tap mic in Chrome → speak → transcript lands in input. Kill the tab mid-stream → reopen → board state recovers.

**Cut line:** History page (053) and voice (042) — both can slip 2 days without blocking M3. Nothing else.

---

### M3 — Clarification Engine (Days 6–7)

**Entry criteria:** M2 exit — specifically the Conversation Agent's `missingRequired` output, which is this milestone's input.

**Definition of Done:**
- [ ] Required-fields registry: data-driven MCR per situation type, unit-tested, no prompt-embedded field lists (061)
- [ ] ClarificationAgent generates ≤ 3 batched questions ranked by EVOI; memory-known fields never asked (062, 065, 067)
- [ ] Confidence bands enforced: 100% → 0 questions; 75–99 → 1; 50–74 → 2; < 50 → 3 then assume
- [ ] Assumptions stated in UI when proceeding without answers (066)
- [ ] POST /:id/clarify merges answers, re-evaluates, triggers planning or second pass (max 2) (063, 068)
- [ ] Answers survive SSE disconnect — persisted server-side on receipt, not held in stream state (069)
- [ ] ClarificationCard: quick-tap options + freetext; answers animate the ConfidenceCard live (064)

**File tree delta:**
```
+ app/api/v1/situations/[id]/clarify/route.ts
+ components/board/ClarificationCard.tsx
+ lib/{agents/clarification.ts, engine/requiredFields.ts}
+ tests/{clarification/*.test.ts, agents/clarification.test.ts}
+ vitest.config.ts                                    # ISSUE-176, pulled early
```

**Testing checkpoint:**
```bash
pnpm test tests/clarification/    # 8 scenarios: caps, memory-skip, assumption gen, 2-pass limit
```
Manual smoke: "I'm sick" as onboarded vegetarian → exactly 2 questions (canCook, alone), NOT diet/budget → answer both → confidence animates up → planning starts. Then: "I need 180g protein today, full day, ₹400 budget" → zero questions.

**Cut line:** Second-pass logic (068) — first pass + assumptions covers the demo. Never cut the max-3 cap or the memory check; those are the product thesis.

---

### M4 — Decision Engine (Days 8–9 AM) — Track B, parallelizable from Day 2 PM

**Entry criteria:** `types/` finalized. Nothing else — no DB, no LLM, no network. This is the purest milestone in the build.

**Definition of Done:**
- [ ] `scoreAll(context, pathInputs)` → `{cook, order, dineout, winner, confidence}` in < 5ms, zero I/O (076)
- [ ] Four sub-score functions, each pure and separately tested (077–080)
- [ ] Weight tables per situation type; `assertWeightIntegrity()` proves each row sums to 1.0 at module load (082)
- [ ] Unavailable paths excluded from comparison, never scored (081)
- [ ] Deterministic tie-breaking with documented precedence (084)
- [ ] Confidence calculator per docs/DECISION_ENGINE.md (083)
- [ ] Simulator delta function for any two paths (085)
- [ ] 30 unit cases from docs/DECISION_ENGINE.md §test-cases + 8 fast-check property invariants green (086)

**File tree delta:**
```
+ lib/engine/{scorer.ts, subscores.ts, weights.ts, confidence.ts, simulator.ts, availability.ts}
+ tests/engine/{scorer.test.ts, invariants.test.ts, fixtures.ts}
```

**Testing checkpoint:**
```bash
pnpm test:engine          # all 30 + 8 invariants
pnpm test:engine --coverage   # lib/engine ≥ 95% branches — this module has no excuse
```
Manual smoke: none. If the engine needs manual smoke, its tests are wrong.

**Cut line:** None. This is the load-bearing wall of the product ("deterministic scoring + LLM narration" is the resume claim). Cut ANY other milestone first.

---

### M5 — Swiggy MCP Client, Mock-First (Days 9 PM–10) — Track C, parallelizable from Day 2 PM

**Entry criteria:** `types/` finalized. Swiggy MCP credentials NOT required (mock-first is the point).

**Definition of Done:**
- [ ] MockSwiggyMCPClient: realistic Mumbai fixtures for all 3 services; selected via `SWIGGY_MCP_MODE=mock` (118)
- [ ] SwiggyMCPClient singleton: lazy connect, reconnect w/ backoff, tool-call timeout (111)
- [ ] All 7 tools typed and implemented against the mock: search ×3 (112–114), carts ×2 (115–116), reservation (117)
- [ ] Compound ingredient normalization + simplified-query retry ("ginger-garlic paste" → "ginger garlic") (140, 113)
- [ ] 8-code error taxonomy; every tool returns `{available: false, reason}` instead of throwing (121)
- [ ] Partial failure: one tool down → others' results returned with `_meta.failed` (122)
- [ ] Fallback chain wired: all-Swiggy-down → cook-only signal consumable by Planning (119)

**File tree delta:**
```
+ lib/mcp/{swiggy.ts, mock.ts, fixtures/{restaurants.ts, instamart.ts, dineout.ts}, errors.ts, normalize.ts}
+ types/swiggy.ts
+ tests/mcp/{tools.test.ts, fallback.test.ts, normalize.test.ts}
```

**Testing checkpoint:**
```bash
pnpm test tests/mcp/      # every tool against mock; taxonomy mapping; partial failure
SWIGGY_MCP_MODE=mock pnpm dev   # boots, no connection attempt to real server
```
Manual smoke: none yet (no UI consumes this until M6).

**Cut line:** Real-client tools (the non-mock halves of 112–117) — the entire demo runs on the mock if Swiggy partnership access hasn't landed. Dineout reservation (117) is the first individual tool to cut; the demo loop never books a table.

---

### M6 — Planning Agent + Situation Board (Days 11–13 AM)

**Entry criteria:** M3, M4, M5 exits ALL passing. This is the convergence point of all three tracks — do not enter early.

**Definition of Done:**
- [ ] Tool Agent: single entry point for Swiggy + YouTube; normalizes to internal types; typed degraded responses; emits `agent_progress` SSE (092, 103)
- [ ] ESLint rule blocks `lib/mcp/*` and `lib/youtube.ts` imports outside `lib/agents/tool.ts` (N10)
- [ ] Planning Agent: calls Tool Agent, feeds results + context to `scoreAll()`, sends scores to Sonnet for narration only, assembles primary + alternatives (091)
- [ ] Zod validation on Planning output; one re-ask on schema failure, then timeout fallback (102, 105)
- [ ] Swiggy results truncated to 20 before prompt assembly (104)
- [ ] Degraded mode: Swiggy down → cook-only comparison with notice, never an error screen (101)
- [ ] Board complete: ComparisonTable (tap column to switch), DecisionCard, RecommendationCard, PlanSimulator, "Why Not?" (094–098)
- [ ] PlanningGraph animates from real SSE events (049)
- [ ] GET recommendation + POST execute with deep link (099, 100)
- [ ] Integration test: canned context → mock Swiggy → real scorer → mocked-LLM narration → valid recommendation (093)

**File tree delta:**
```
+ app/api/v1/recommendations/[id]/{route.ts, execute/route.ts}
+ components/board/{ComparisonTable.tsx, DecisionCard.tsx, RecommendationCard.tsx,
+                    PlanSimulator.tsx, WhyNot.tsx}
+ components/ui/Skeleton.tsx
+ lib/agents/{planning.ts, tool.ts}
+ lib/schemas/planningOutput.ts
+ tests/{agents/planning.test.ts, integration/planning-pipeline.test.ts, fixtures/recommendation.json}
```

**Testing checkpoint:**
```bash
pnpm test tests/integration/planning-pipeline.test.ts
pnpm test:engine     # re-run: Planning must not have touched scorer semantics
```
Manual smoke (the demo loop, minus cooking): "I want to hit 150g protein today" → 1 question → graph animates → comparison table (Cook wins) → decision explanation references 150g and ₹ budget → recommendation card → "Add to Instamart" → Swiggy deep link opens with items. Kill Swiggy mock (`SWIGGY_MCP_MODE=down`) → same input → cook-only plan with notice, no error screen.

**Cut line:** PlanSimulator (097) and "Why Not?" (098) — both are presentation over data the comparison already has. Cutting them costs demo sparkle, not correctness.

---

### M1b — Memory Panel Editable (Day 13 PM)

**Entry criteria:** M6 exit (scheduled here per MVP.md Day 13; only true dependency is M1).

**Definition of Done:**
- [ ] Inline edit + delete-with-confirm on every fact (024, 025)
- [ ] PATCH /api/v1/memory validates against FactKey types; unknown keys 400 (027)
- [ ] Expiry logic: soft facts get `expires_at`; expired facts excluded from reads (028)

**File tree delta:** `FactRow.tsx` gains edit/delete; `+ app/api/v1/memory` PATCH handler; `+ tests/api/memory.test.ts`.

**Testing checkpoint:** `pnpm test tests/api/memory.test.ts`. Manual: edit budget 350→400 → new situation's ConfidenceCard shows ₹400.

**Cut line:** Expiry (028) → M11. Edit/delete are user-trust features; keep them.

---

### M7 — AI Cooking Mode (Days 14–15 AM)

**Entry criteria:** M6 exit. `YOUTUBE_API_KEY` verified.

**Definition of Done:**
- [ ] YouTube client via Tool Agent only; quota-aware; result cached on the recommendation row (131, 133)
- [ ] YouTubeCard with thumbnail/duration/channel (132)
- [ ] Planning Agent generates 6–8 recipe steps with durations + timestamps into validated output (141)
- [ ] Pantry check: recipe ingredients vs pantry facts → have/need split (134; see §9 item 3)
- [ ] InstamartCart component: missing items, prices, ETA, deep-link CTA (135)
- [ ] Step-by-step mode: CookingStepCard, progress, 18s timestamp clips, completion screen with "Log this meal?" (136–139)
- [ ] Video-removed fallback: text-only steps, no broken thumbnail

**File tree delta:**
```
+ app/(app)/cook/[situationId]/page.tsx
+ components/cooking/{YouTubeCard.tsx, InstamartCart.tsx, CookingStepCard.tsx,
+                      CookingProgress.tsx, CompletionScreen.tsx}
+ lib/youtube.ts
+ tests/cooking/pantryCheck.test.ts
```

**Testing checkpoint:** `pnpm test tests/cooking/`. Manual smoke: protein demo → Cook wins → pantry shows ✔/○ split → Instamart cart has exactly the ○ items → YouTube card plays → Start Cooking → advance all 8 steps → completion screen. One step's clip link opens YouTube at its timestamp.

**Cut line:** Timestamp clips (138) then completion screen (139). The pantry → Instamart → steps chain is the unreplicated flow — never cut the chain itself.

---

### M8 — Memory Learning (Days 15 PM–16)

**Entry criteria:** M7 exit AND M1b exit (shared fact-write paths). FactKey registry (149) is the first item — see N4.

**Definition of Done:**
- [ ] FactKey const-enum registry; Memory Agent validates every write against it (149)
- [ ] Memory Agent: Haiku, fires after execute, never blocks, never surfaces errors to user (146, 152, 153)
- [ ] Extraction: clarification answers → facts at confidence 0.85; repeated actions → preference facts at 0.6 (147, 148)
- [ ] DB-level UPSERT (`ON CONFLICT DO UPDATE`) — concurrent duplicate-key writes resolved (154)
- [ ] Inferred-fact confidence decays 0.05/week; < 0.3 expires (151)
- [ ] Memory panel refreshes after situation completes (150)

**File tree delta:**
```
+ lib/agents/memory.ts
+ lib/memory/{factKeys.ts, decay.ts}
+ tests/agents/memory.test.ts
```

**Testing checkpoint:** `pnpm test tests/agents/memory.test.ts` (extraction cases, registry rejection, upsert race). Manual smoke: answer "150g protein" in clarification → execute plan → Memory Panel shows `fitness.protein_target: 150` without reload → new session → protein question not asked again. **This smoke is the "loop that never ends" resume claim — verify it honestly.**

**Cut line:** Decay (151) → M11. Extraction from answers (147) is the demo's learning moment; keep it.

---

### M9 — UI Polish (Days 17–18 AM)

**Entry criteria:** M7 exit (N8). All functional flows frozen — polish does not change behavior.

**Definition of Done:**
- [ ] Theme transition 500ms; latenight mode on `late_night` situations (161, 169)
- [ ] Voice pulse, graph node spring, toast, skeletons, route fades per docs/DESIGN_SYSTEM.md motion specs (162–166)
- [ ] Empty states for history/memory/pantry (170)
- [ ] No horizontal overflow at 375/390/430/768px; comparison table stacks below 480px (167, 171)
- [ ] A11y pass 1: tab order, ARIA labels, `aria-live` on PlanningGraph, contrast (168)

**File tree delta:** mostly edits; `+ styles/animations.css`, `+ components/ui/Toast.tsx`.

**Testing checkpoint:** `pnpm build && pnpm lint` (a11y plugin rules on). Manual: full demo loop on a real phone (or 390px DevTools) end to end; keyboard-only run-through of onboarding + one situation.

**Cut line:** Everything except 167/171 (mobile) and 168 (a11y). Animations are the first thing to drop under schedule pressure — the demo survives without spring curves, not without a working phone layout.

---

### M10 — Testing Infrastructure (Days 18 PM–19)

**Entry criteria:** M6 exit for E2E (N11). Vitest + engine + clarification tests already exist (landed Days 7–9).

**Definition of Done:**
- [ ] testcontainers Postgres; DB reset between suites (179)
- [ ] Integration tests, all 10 endpoints: happy path + auth failure + validation failure (180)
- [ ] Playwright: 5 journeys — first-time user, sick+can't-cook, voice input, Instamart cart, cooking steps (181, 182)
- [ ] Golden set: 8 canonical inputs → schema-validated agent outputs; runs on any prompt-file change; fails on schema break (183)
- [ ] CI: typecheck → engine → clarify → API → golden [→ E2E on main only], wall time < 4 min (184)

**File tree delta:**
```
+ tests/{integration/api/*.test.ts, e2e/*.spec.ts, golden/{inputs.json, run.ts}}
+ playwright.config.ts
~ .github/workflows/ci.yml    # full pipeline
```

**Testing checkpoint:** `pnpm test && pnpm test:e2e` locally green; push a PR touching `docs/prompts/planning.md` → golden set job runs; CI wall clock verified < 4 min.

**Cut line:** E2E down to 2 journeys (first-time user, sick-can't-cook). Golden set is NOT cuttable — it's the only regression net under every future prompt edit.

---

### M11 — Production Hardening (Days 20–21)

**Entry criteria:** M10 exit. Real (non-mock) keys in Vercel production env.

**Definition of Done:**
- [ ] Sentry: errors + tracing + source maps; test event received (191)
- [ ] `situation_agent_runs` migration + logging on every agent call: tokens, latency, model (192)
- [ ] Per-situation LLM cost summed to `situations.llm_cost_usd` (193)
- [ ] Rate limits: 60/min general, 10/min POST /situations, 20/min clarify — typed 429s (194; supersedes ARCHITECTURE.md's 30/5, see §9 item 5)
- [ ] Zod on every route's body + query; typed 400s (195)
- [ ] Auth audit: integration test proves 401 on every protected route without JWT (196)
- [ ] "Ignore all instructions" input → Conversation Agent still emits valid SituationContext (197)
- [ ] P95 situation-to-plan < 6000ms measured over 20 profiled runs (198)
- [ ] Security headers: CSP, HSTS, X-Frame-Options, X-Content-Type-Options (199)
- [ ] Neon cold-start mitigated (pooled connection string / keep-warm ping) (200)
- [ ] iOS deep-link universal-link fallback (120)

**File tree delta:**
```
+ {sentry.client,sentry.server}.config.ts
+ lib/{rateLimit.ts, agentRunLogger.ts}
+ prisma/migrations/*_agent_runs/
~ next.config.ts    # headers
~ all route handlers  # Zod parse at entry
```

**Testing checkpoint:**
```bash
pnpm test            # entire suite one final time
for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code}\n" -X POST .../situations; done  # 11th+ → 429
```
Manual: throw a test error → appears in Sentry; run 20 demo loops → check P95 in agent_runs; Lighthouse security pass on prod URL.

**Cut line:** 120, 200, 193 (deep-link edge case, cold start, cost column). Never cut 194–197 — rate limiting, validation, auth audit, and injection resilience are the difference between a demo and a product.

---

## 8. Cut Lines — If You Only Have N Days

The schedule compresses from the bottom of each milestone, never by skipping exit tests. These are the honest stopping points:

| Days available | Ship | You have | You don't have |
|---|---|---|---|
| **5** | M0–M2 + hardcoded static recommendation | Auth, onboarding, memory read, situation input, ConfidenceCard | Anything intelligent. **Do not demo this** — it's the search box MealOS exists to not be. |
| **9** | M0–M4 + mock Swiggy + minimal Planning narration | Real clarification, real deterministic scoring, comparison table on mock data | Cooking mode, learning, real Swiggy, polish |
| **12** | Through M6 | **The core demo loop**: voice → confidence → question → scored comparison → recommendation → Swiggy deep link | Cooking mode, memory learning |
| **15** | Through M7 | The full 90-second recruiter demo including the cooking chain | Learning loop, polish, hardening |
| **18** | Through M9 | Demo + learning loop + phone-ready polish | Full test pyramid, rate limits, Sentry |
| **21** | Everything | The product as specced | — |

Two hard floors regardless of N: **the Decision Engine is never cut** (it is the thesis), and **nothing demos publicly below the 12-day line** (below it, the product contradicts its own pitch).

---

## 9. Reconciliation Notes (MVP.md vs Issues Backlog)

Conflicts found while sequencing, and how this playbook resolves each. If you touch the source docs, resolve these there too.

1. **Epic order vs build order (EPIC 6 ↔ EPIC 7).** The backlog numbers Planning Agent (EPIC 6, ISSUE-090–105) before Swiggy Integration (EPIC 7, ISSUE-110–122), but ISSUE-091 depends on ISSUE-092 (Tool Agent), which needs Swiggy tool shapes. MVP.md's Day 8 ("Swiggy MCP client" before scoring) agrees with the dependency, not the epic numbering. **Resolution:** build order is M4 (engine) → M5 (Swiggy mock) → M6 (Planning). Epic numbers are labels, not sequence.
2. **Clarification "Agent" identity.** ARCHITECTURE.md Phase 5 makes Clarification a Sonnet agent; MVP.md collapses V1 to 4 agents with no Clarification Agent; the backlog has ISSUE-062 "ClarificationAgent Implementation." **Resolution:** the Clarification Engine is a pipeline stage — deterministic gap analysis (registry, ISSUE-061) plus a Haiku call for phrasing — implemented in `lib/agents/clarification.ts` but not counted as a fifth agent. The cost model in docs/AGENTS.md should reflect Haiku here, not Sonnet.
3. **Pantry contradiction.** MVP.md §10 says pantry state is "present in UI, not yet used in planning" and is NOT stored in V1 memory — but ISSUE-134 (pantry check vs recipe) is V1 EPIC 8, and the demo script shows ✔/○ ingredient splits. **Resolution:** pantry facts ARE stored (as `pantry.*` keys in `user_memory_facts`, populated via Memory Panel adds) and ARE read by the pantry check (134). What stays deferred is pantry *influencing scoring* (goalMatch/prefMatch ignore pantry in V1) and expiry tracking. MVP.md's sentence should be amended.
4. **`situation_agent_runs` timing.** MVP.md defers agent-run logging to V2 ("five tables only"); ISSUE-192 lands it in V1 hardening. **Resolution:** follow the backlog — Day 20. Observability before demo recording is worth a sixth table.
5. **Rate-limit numbers disagree.** ARCHITECTURE.md Phase 9: 30 req/min, 5 situations/min. ISSUE-194: 60 req/min, 10/min situations, 20/min clarify. **Resolution:** ISSUE-194 (newer, and the ARCHITECTURE numbers would throttle the clarify round-trip during demos).
6. **Duplicate engine test suites.** ISSUE-086 (EPIC 5: 30-case unit suite) and ISSUE-177 (EPIC 11: same 30 cases + 8 fast-check invariants) describe one deliverable. **Resolution:** build once on Day 9 AM satisfying both; close both issues against the same PR.
7. **History page split.** MVP.md schedules history on Day 19; backlog puts ISSUE-053 in EPIC 3. **Resolution:** list-only skeleton with M2 (Day 5), re-run button Day 17.
8. **Vitest timing.** ISSUE-176 sits in EPIC 11, but the engine suite (Day 9) and clarification tests (Day 7) need it. **Resolution:** Vitest config lands Day 7 PM; EPIC 11 keeps the CI-pipeline work only.

---

*End of Implementation Playbook. Start at Day 1 AM. The exit test is the boss — everything else is negotiable.*
