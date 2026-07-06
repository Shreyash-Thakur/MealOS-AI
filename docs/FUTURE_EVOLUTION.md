# MealOS AI — Future Evolution: Three Years, Ten Million Users

**Project:** MealOS AI
**Last Updated:** 2026-07-07
**Status:** Forward-looking design fiction, written as a retrospective from July 2029 (36 months post-launch, 10M MAU). Companion to `docs/POSTMORTEM.md`, which covers the first 24 months at 1M MAU — the events described there (the fact-key crisis, the IPL-finals pipeline collapse, the Swiggy outage and Zomato integration, the BullMQ migration) are treated here as settled history. This document covers what happened *after* that, and what it teaches the 2026 team.
**Related files:** `docs/POSTMORTEM.md`, `docs/DESIGN_REVIEW.md`, `ARCHITECTURE.md`, `docs/DECISION_ENGINE.md`

---

## Table of Contents

1. [The Shape of 10M Users](#1-the-shape-of-10m-users)
2. [What Changed Structurally](#2-what-changed-structurally)
3. [Decisions That Aged Badly (Years 2–3)](#3-decisions-that-aged-badly-years-23)
4. [Abstractions That Survived Unchanged](#4-abstractions-that-survived-unchanged)
5. [Rewrite vs. Leave Untouched: The Verdict Table](#5-rewrite-vs-leave-untouched-the-verdict-table)
6. [The 3-Year Product Shape](#6-the-3-year-product-shape)
7. [Advice to the Team of Five: The Month-One Five](#7-advice-to-the-team-of-five-the-month-one-five)

---

## 1. The Shape of 10M Users

The numbers that defined year three, because scale problems are always specific:

| Metric | Month 24 (POSTMORTEM era) | Month 36 |
|---|---|---|
| MAU | 1M | 10M |
| Decision-sessions/day | ~180k | ~2.4M |
| Peak concurrent (IPL finals, month 33) | 6k → broke us | 210k → boring |
| `situations` rows | 41M | 890M |
| `user_memory_facts` rows | 14M | 240M |
| LLM spend/month | ₹2.5L (peak, pre-optimization) | ₹31L (would be ₹4.2Cr at year-one architecture) |
| % sessions in a language other than English | 8% | 61% |
| % sessions from Tier-2/3 cities | 11% | 57% |
| Engineering team | 6 | 38 |

Two of those rows explain most of this document. The language row broke the Conversation Agent's core assumptions. The Tier-2/3 row broke the assumption that Swiggy coverage ≈ India — at month 30, roughly a third of our users lived where ORDER and DINE_OUT were structurally unavailable, and MealOS in those cities is a *cooking* product with a grocery tail. The Decision Engine handled this without modification: paths that don't exist get eliminated, COOK wins, the weight tables never knew anything changed. That is the quiet triumph of this architecture and it will come up repeatedly below.

---

## 2. What Changed Structurally

### 2.1 The Service Split (months 25–30)

POSTMORTEM.md ends with `api.mealos.ai` freshly extracted as a standalone Express service. By month 30 the topology stabilized at **five services, not fifty**:

```
edge (Vercel, frontend only)
   │
api-gateway (Fastify, Mumbai + Hyderabad)
   ├── situation-service      — pipeline orchestration, SSE fan-out
   ├── decision-engine        — @mealos/decision-engine behind gRPC (stateless, autoscaled)
   ├── memory-service         — facts, embeddings, the FactKey registry as an API
   ├── provider-service       — FoodProvider implementations (Swiggy, Zomato, ONDC)
   └── notification-service   — reminders, digests, push
```

We stopped there deliberately. Every proposal for a sixth service was tested against the question "does this need an independent deploy cadence or an independent scaling profile?" and most failed. The 2026 monolith's internal boundaries — `lib/engine/`, `lib/agents/`, `lib/mcp/`, repositories — became the service boundaries almost one-to-one, which is the strongest endorsement of the original file structure: **the monolith was a service catalog wearing a trench coat, and that was correct.**

**When Vercel stopped being the answer:** month 26, and only for the API tier. The forcing function was not scale; it was *stream residency*. At ~40k concurrent SSE connections, serverless function duration limits plus per-invocation pricing made long-lived streams the most expensive and least reliable thing we ran. The SSE fan-out moved to a pool of plain Node processes behind the gateway (sticky by `situation_id`, Redis pub-sub feeding them, `Last-Event-ID` replay from a Redis stream buffer). The frontend never left Vercel. Nobody misses managing it.

### 2.2 The Event Bus (month 27)

BullMQ carried us to about 1M events/day. Past that, three pressures converged: multiple consumers per event (memory writer, embeddings writer, analytics, weight-replay capture), replay requirements, and cross-service ordering. We adopted **Kafka (MSK) with a thin outbox pattern** — every state transition in the pipeline emits a domain event (`SituationCreated`, `ContextReady`, `DecisionMade`, `PlanExecuted`, `MemoryUpdateRequested`) written transactionally with the state change.

The retrospective insight: POSTMORTEM §5.1 asked for exactly this ("event-driven Memory Agent from day one") and was right for the wrong reason. The killer feature wasn't decoupling the Memory Agent — it was that **`DecisionMade` events became the training corpus.** Every event carries the full `SituationContext`, the `PathInput`s with provenance, `weightsUsed`, and the eventual outcome joined from `PlanExecuted`. The weight-tuning pipeline (§6) is a Kafka consumer. If the 2026 team logs these fields from day one — even into a plain Postgres table — the year-three ML program starts with three years of data instead of one.

### 2.3 The Database (months 26–34)

Read replicas at month 26 (memory reads and history pages off the primary). Table-level partitioning of `situations` and `analytics_events` by month at month 28. **Sharding never happened.** The projected crisis — 890M situation rows — was solved by partitioning plus the observation that situations older than 90 days are read only by analytics, which moved to ClickHouse fed from Kafka. Postgres holds hot state; ClickHouse holds history; the "we'll need to shard by user_id" workstream was cancelled twice and should embarrass nobody.

pgvector, however, did hit its ceiling: at 240M memory embeddings, IVFFlat recall/latency degraded past tuning. Month 31: embeddings moved to a dedicated vector store; `user_memory_facts` (structured) stayed in Postgres untouched. The POSTMORTEM's "structured first, vectors on top" layering made this a lift-and-shift of the fuzzy layer with zero changes to the facts layer.

### 2.4 Multi-Region India (month 32)

Mumbai primary, Hyderabad hot standby with regional read replicas and regional SSE pools. Full active-active was scoped, costed, and rejected — food decisions are a same-city product; a Mumbai user's session never needs Delhi's data. The one genuinely multi-region artifact is the provider-service, which routes to Swiggy/Zomato/ONDC endpoints regionally. India's data-residency rules (DPDP-era) were trivially satisfied because we never left the country.

---

## 3. Decisions That Aged Badly (Years 2–3)

POSTMORTEM.md owns the year-one-and-two regrets (sync pipeline, missing instrumentation, Neon cold starts, fact-key chaos, prompt versioning, single-provider coupling, no caching). These are the ones that only *became* wrong between 1M and 10M.

### 3.1 English-Only Situation Understanding — the most expensive one

**The decision (2026):** Nothing in any doc says "English only," which is exactly the problem — it was an assumption so deep it was never written down. The Conversation Agent prompt, the situation-type taxonomy, the clarification phrasing bank, the quick-tap templates, the UX copy laws: all authored in English, tested in English.

**Why it aged badly:** India's growth past the metro early-adopter cohort is vernacular. By month 30, Hinglish and code-switched inputs ("aaj kuch halka sa bana do, tabiyat theek nahi") were the plurality of raw inputs. Intent-classification accuracy for these was ~22 points below English in our regression suite. Worse, the *clarification questions* — the product's signature move — read as stilted formal Hindi when machine-phrased, precisely the register mismatch UX.md's "knowledgeable friend" principle prohibits.

**The forced migration (months 30–33):** New multilingual prompt suite for eleven languages; language-of-input detection; the clarification phrasing bank rewritten by native speakers per language (not translated — rewritten); the situation taxonomy audited for cultural fit (`office_lunch` and `family_dinner` carried assumptions; "tiffin," fasting days, and festival cooking needed first-class handling — `fasting_vrat` became the twelfth situation type and the first weight-table addition since launch). Cost: roughly two quarters of the AI team.

**What 2026 could have done:** Not solve it — solving it early would have been premature. But three one-day choices would have halved the migration: store `detected_language` on every situation from day one (we had to backfill by re-running detection on 400M rows); keep all user-facing strings out of prompts and in a copy layer; and write the regression suite's input corpus with a Hinglish section from the start, so the gap is *measured* from month one even if it isn't *fixed* until it matters.

### 3.2 Confidence as a Number the User Sees

**The decision (2026):** The Confidence Card shows "Confidence: 78%."

**Why it aged badly:** Power users learned to game it and casual users learned to distrust it. At 10M users, showing a two-digit number invited two failure modes: users who answered clarifications with garbage just to watch the number go up (the number rewards *fields populated*, not *fields true*), and users for whom 78% read as "the app is guessing" (it isn't — 78 is a good score; nobody reads the interpretation table). Month 29 A/B: replacing the number with the checklist only ("✔ Diet known · ✔ Budget known · ○ One thing to confirm") improved question-answer quality and execution rate. The number still exists — logged, used by the pipeline, shown in a debug drawer. It stopped being a headline. The deeper lesson generalizes: **expose the *evidence* of understanding, not the *scalar* of understanding.**

### 3.3 The `recommendations` JSONB Blobs

**The decision (2026):** `MVP.md`'s V1 schema stores `comparison`, `instamart_items`, `swiggy_data`, `recipe_steps` as JSONB on the `recommendations` row.

**Why it aged badly:** Correct for shipping in three weeks; brutal at analytical scale. Every product question of year three — "what's the median protein gap between COOK and ORDER when COOK wins?", "which cuisines over-index in dismissed recommendations?" — required JSONB spelunking across hundreds of millions of rows with no schema guarantees across prompt versions (a v3-era `comparison` blob and a v9-era blob differ silently). The fix was the Kafka/ClickHouse path (§2.2–2.3) with *versioned event schemas*, plus promoting the ~15 analytically-load-bearing fields to typed columns. The migration itself was easy; the three years of dirty history were not — the backfill parser for old blobs is 1,400 lines and still has a `// version guessing heuristics` section nobody is proud of. **JSONB is a fine serialization format and a terrible archive format.** Version every blob from the first write (`{ v: 1, ... }`); it costs six characters.

### 3.4 Clerk at 10M MAU

**The decision (2026):** Clerk, chosen correctly as "fastest path to working auth."

**Why it aged badly:** Pure economics plus one product need. MAU-based pricing that was rounding error at 10k users became a seven-figure-₹ annual line at 10M, and phone-OTP-first onboarding for the vernacular cohort (many users have no email) pushed against the grain of the integration. Migration to self-hosted auth (month 34–35) was long-planned, unglamorous, and fine — Clerk's clean JWT boundary meant the blast radius was the middleware and the webhook handler, not the app. **Verdict: right tool, correctly rented, returned on schedule.** The only mistake would have been building auth ourselves in 2026, and we didn't make it.

### 3.5 Deep-Link Execution as the Primary Conversion Path

**The decision (2026):** Execution = redirect to Swiggy with a pre-filled cart.

**Why it aged badly:** The DESIGN_REVIEW panel's Swiggy PM was right with a two-year fuse. Handoff loss (app-not-installed, cart-transfer failures, login mismatches) meant measured execution-completion on deep links plateaued around half of in-app completions. The fix arrived with the month-28 Swiggy partnership expansion: **in-flow ordering** (order placed via partner API, checkout inside MealOS, Swiggy fulfills) for the top cities, deep links as the fallback tier. This was as much a BD achievement as an engineering one, and it is the reason the three-tier execution layer (DESIGN_REVIEW RB-3) mattered: the tiers were already in the code; a partnership just promoted a new Tier 1.

---

## 4. Abstractions That Survived Unchanged

The honor roll — interfaces from the 2026 docs that ten million users and 38 engineers never forced open.

### 4.1 `SituationContext` — the universal envelope

Every service, every agent, every language, every interface (web, mobile, WhatsApp bot, the voice line) speaks `SituationContext`. It gained fields (`detectedLanguage`, `householdId`, provenance wrappers); it never changed shape. The three-block design — `explicit` / `inferred` / `fromMemory` — turned out to be the load-bearing insight, because it encodes *epistemic status*: the vernacular migration, the memory-poisoning defenses, and the confidence calculations all needed to know not just what the system believes but *why*. A flat context object would have died in year one. **Why it survived: it models the problem (what do we know and how do we know it), not the implementation.**

### 4.2 The deterministic scorer

`@mealos/decision-engine` is the same algorithm documented in `DECISION_ENGINE.md` §3–7: four sub-scores, weight tables, availability elimination, tie-breaking, `computeConfidence`. Three years of changes: weight *values* (300+ experiment variants, per-cohort tables since month 31 — a Tier-2 vegetarian household and a Gurgaon gym cohort genuinely deserve different `preferenceMatch` weights), one new situation type, uncertainty propagation from provenance (DESIGN_REVIEW MI-3). The *structure* — pure functions, weights sum to 1.0, replayable — is untouched. It now runs in four consumers the 2026 team never imagined, including the ML training pipeline where replay **is** the label-generation step. POSTMORTEM said "guard this file"; the file became a service and the guard held.

### 4.3 The `ToolResponse` / `FoodProvider` normalization boundary

Every provider quirk in three years — Swiggy schema changes, the Zomato integration, ONDC's arrival (month 29, and ONDC is *nothing* like Swiggy), the in-flow ordering partnership — was absorbed in `provider-service` behind the same normalized types. The planning pipeline has not learned a new provider vocabulary since launch. The `{ available: false, reason }` typed-degradation rule from `MVP.md`'s fallback table is still the single most-copied pattern in the codebase; new engineers absorb it by osmosis. **Why it survived: the boundary sits exactly where volatility (partners) meets stability (the decision problem).**

### 4.4 Memory fact provenance

`source: user_stated | agent_inferred | action_derived` plus `confidence`, `times_confirmed`, `expires_at` — the columns that looked like over-engineering in a 3-week MVP schema became the substrate for everything memory turned into: the poisoning defenses (inferred never overrides stated; allergy-class keys require confirmation), the trust UX ("you told us" vs. "we noticed"), DPDP deletion semantics (provenance determines what cascades), and household profiles (whose statement wins when two people share a kitchen). Retrofitting provenance onto an unprovenance'd memory store is the migration we never had to do, and watching two competitors do it badly was instructive.

### 4.5 The SSE event vocabulary

The transport moved twice (Vercel functions → Node pool → regional pools). The *events* — `context_understood`, `clarification_needed`, `agent_progress`, `plan_ready`, `error` — never changed. Clients from the 2026 web app to the 2029 voice line consume the same progression. A protocol outliving three transports is the definition of a good protocol.

---

## 5. Rewrite vs. Leave Untouched: The Verdict Table

The month-36 verdict on every major 2026 component. "Rewritten" = replaced in place; "Evolved" = same design, new muscle; "Untouched" = still recognizably the launch artifact.

| Component (2026) | Verdict | Reasoning |
|---|---|---|
| Deterministic scorer (`lib/engine/scorer.ts`) | **Untouched** (structurally) | See §4.2. Weight values churn weekly by design; the algorithm is the company's constitution. |
| Weight tables | **Evolved** | Hand-set priors → experiment-driven, per-cohort. The *mechanism* for change was built into the design (replay), so change never required rewrite. |
| `SituationContext` | **Untouched** | Fields added, shape never broken. §4.1. |
| Conversation Agent | **Rewritten twice** | Vernacular migration (month 30–33) and the model-generation upgrade (month 26 — new Claude generations made the extract-then-clarify merge trivially better). Prompts are consumables; budget for their replacement, don't mourn it. |
| Clarification engine (MCR gap analysis + question budget) | **Untouched** | The deterministic core — required-field analysis, EVOI ordering, 0/1/2/3 question budget — survived both Conversation rewrites *because* it was never inside the prompt. Phrasing is per-language; logic is universal. |
| Planning Agent | **Evolved** | Still one model call that narrates and assembles but never scores. Prompt rewritten ~9 times; contract stable. The DESIGN_REVIEW's benchmarked agentic branch finally won a narrow slice (multi-day meal-prep planning) at month 27 and runs there only. |
| Tool layer | **Rewritten** (2026, per DESIGN_REVIEW MI-2) then **Evolved** | De-agentified before launch; grew into provider-service. The one LLM remnant — SKU mapping — is now a fine-tuned small model, the company's only fine-tune. |
| Memory Agent | **Evolved** | Event-consumer since month 27; extraction rules hardened; provenance untouched. |
| `user_memory_facts` schema | **Untouched** | The FactKey union (added week one, per POSTMORTEM's plea) held the line. 240M rows, same shape. |
| pgvector semantic layer | **Rewritten** | Moved to dedicated vector store at month 31. Clean because it was always the *second* layer. §2.3. |
| SSE streaming | **Transport rewritten ×2, protocol untouched** | §4.5. |
| Next.js API routes | **Retired** (months 25–30) | Served exactly their intended tour of duty. The extraction was mechanical because handler boundaries were clean. No regrets, including the decision to start there. |
| Prisma + Postgres | **Evolved** | Partitioning, replicas, ClickHouse sidecar. Never sharded, never left. |
| Neon → Railway → managed Postgres | **Rewritten** (hosting only) | Per POSTMORTEM 3.3. Hosting is a commodity; the schema is the asset. |
| Clerk auth | **Retired** (month 35) | §3.4. Rented correctly, returned on schedule. |
| Vercel (frontend) | **Untouched** | Still there. Fights nobody. |
| Vercel (API/SSE) | **Retired** (month 26) | §2.1. |
| Confidence number in UI | **Retired** (month 29) | §3.2. The calculation lives; the headline died. |
| Comparison table + Plan Simulator UI | **Evolved / half-retired** | The comparison table is the product's signature and survived every redesign. The Plan Simulator's collapsible delta panel measured near-zero engagement and was folded into the table's tap-to-switch interaction at month 26 — its *calculation* (`PlanSimulatorDeltas`) powers the "if you switch" copy, so the code outlived the panel. |
| Quick-tap situation templates | **Evolved** | UX.md Law 12 called them training wheels; at 10M users they are load-bearing for the vernacular cohort — tapping "तबीयत ठीक नहीं" beats typing it. Wheels stayed on; product got faster, not slower. |
| YouTube timestamp curation | **Retired** (month 25) | Never scaled past a few hundred recipes, exactly as MVP.md predicted. Replaced by transcript parsing, then by licensed step-video content (month 31) once in-flow ordering revenue could pay for it. |
| 3-question law, Never-Say-Sorry, always-compare (UX laws) | **Untouched** | The twelve laws are the most-quoted internal document. Law 9's 6-second promise survived only via the month-26 model-speed windfall — honesty requires noting we were breaking it for a while. |

---

## 6. The 3-Year Product Shape

### What MealOS became

**The decision layer for household food in India** — and the operative word is *household*, not user. The month-28 shift from individual profiles to household graphs (shared pantry, multiple dietary profiles, "partner wants Thai, you need protein" negotiation — the V3 idea from MVP.md's future-scope list) is what unlocked the 1M→10M curve. Individuals graze; households *plan*, and planning is the product. Weekly meal planning + Instamart basket generation for a two-diet household is the single highest-retention flow, and it barely existed in V1.

Revenue, in the order it arrived: execution commissions from in-flow ordering (month 28+), MealOS Plus subscriptions (households, month 30), and — the one nobody predicted — **the Decision API** (month 33): the scorer + provider layer licensed as a B2B service to a health-insurance wellness program and a corporate-cafeteria operator. The deterministic, replayable, explainable engine is the *only* reason an insurer's compliance team said yes. An LLM-scored recommendation system is unlicensable in that market. The 2026 architecture decision paid for itself a third time, in a currency nobody knew existed.

### What MealOS refused to become

Three seductive wrong turns, each formally rejected:

- **A food-content platform.** Recipe feeds, creator programs, video content. Rejected month 27. Content is a traffic business owned by YouTube and Instagram; we license and link. Every competitor that pivoted to content stopped improving decisions.
- **A general grocery app.** The Instamart basket flow tempted us into "MealOS but for all shopping." Rejected month 29. The moat is the decision, and the decision is about *meals*; a generic basket has no `SituationContext`.
- **A super-app tab.** Two acquisition-adjacent conversations (month 26, month 32) would have made MealOS a feature inside a bigger app. The board deck against it had one slide: retention curves of decision-products absorbed into super-apps. They all flatten. Independence held.

### Which V1 features died

The Plan Simulator panel (month 26, folded in), the visible confidence percentage (month 29), timestamp-curated YouTube clips (month 25), the standalone Dineout path in Tier-2/3 markets (auto-eliminated by availability rules — the engine handled its own feature deprecation, which is a sentence worth rereading), and voice-as-Web-Speech-API (replaced month 30 by server-side multilingual ASR — voice *input* thrives in the vernacular cohort; the browser API just couldn't hear them).

### The moat, honestly audited

The 2026 thesis: "memory is the moat." Verdict: **half right, and the wrong half was expensive.**

Individual memory — diet, budget, allergies — was cloned by every competitor within eighteen months; a 90-second onboarding recreates most of it, so switching costs stayed low. Users did not stay for remembered facts.

What compounded instead, in ascending order of defensibility:

1. **Household memory** — two-plus profiles, a shared pantry, and outcome history are genuinely painful to re-create elsewhere; this is where switching costs finally appeared.
2. **The outcome-labeled decision corpus** — 890M situations × recommendation × *what the user actually did* × rating. This is the dataset that tunes per-cohort weights, and it cannot be cloned, bought, or prompted into existence. Competitors have models; nobody else has three years of labeled Indian food decisions.
3. **The trust asset** — "MealOS shows its work" (comparison table, explanations, replayable scores) became the brand, and the Decision API's compliance-grade explainability is its commercial expression.

So: memory was the moat's *foundation*, but the moat itself is the **decision-outcome loop**. The strategic instruction hiding in this for 2026: `user_actions` logging fidelity is not an analytics nicety — it is the future balance sheet. See §7, item 4.

---

## 7. Advice to the Team of Five: The Month-One Five

Everything else in this document is survivable. These five are the things that are cheap in month one and effectively unfixable later — not because code can't be changed, but because *data you didn't capture and contracts you didn't enforce cannot be backfilled.*

**1. Enforce the FactKey union and fact provenance in the first Memory Agent commit.** POSTMORTEM told you (three-week key-divergence hunt); DESIGN_REVIEW told you; now the 3-year view tells you: provenance is not hygiene, it is the substrate for poisoning defenses, trust UX, DPDP deletion, and household profiles. Twenty minutes of TypeScript. There is no version of this company where the memory store's keys and sources are sloppy and year three goes well.

**2. Build the `runPipeline()` seam and per-agent instrumentation in weeks one and two.** The seam turns the inevitable queue migration from a two-week emergency into a two-day swap. The instrumentation (`situation_agent_runs`, prompt hashes) is how every model degradation, prompt regression, and latency mystery of the next three years gets diagnosed in minutes instead of days. Both are afternoons. Both are begged for by your own postmortem. Do not defer them a second time.

**3. Put every provider behind `FoodProvider`, and make the mock the zeroth implementation.** The interface costs an afternoon; its absence cost 11,000 refunds in the postmortem timeline and would have blocked Zomato, ONDC, and the in-flow ordering partnership in this one. The mock is your demo insurance, your test suite, and your load-testing story on day one.

**4. Log the decision-outcome loop at full fidelity from the first real user.** Every recommendation: full `SituationContext`, `PathInput`s with provenance, `weightsUsed`, all path scores. Every outcome: executed / dismissed / modified, rating, and the join key between them. Version every blob (`{ v: 1 }`). This is the future moat (§6) and the one thing on this list that is *literally* impossible to backfill — the sessions you don't record are gone. The schema is already designed (`user_actions`, `recommendations.comparison`); the instruction is simply: treat that logging path with the same reverence as the scorer, because it *is* the scorer's future.

**5. Never let a number the model estimated cross a boundary without a provenance tag, and never let the model touch a score.** The first half is DESIGN_REVIEW MI-3 (it enables uncertainty-aware confidence in year one and the compliance-grade Decision API in year three). The second half is the company's founding law, and it will be tested constantly — every new engineer, every new model generation, every demo deadline will whisper "just let Claude estimate the score this once." The postmortem's closing line was "the scoring engine you are about to ship is the product. Protect it." Three years and ten million users later, amend it only slightly: **the scoring engine, and the record of what it decided and what humans did about it — that is the product. Protect both.**

---

*FUTURE_EVOLUTION.md — end*
*Backward-looking companion: `docs/POSTMORTEM.md` (months 0–24) · Review that shaped month one: `docs/DESIGN_REVIEW.md`*
