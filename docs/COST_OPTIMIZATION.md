# MealOS AI — Claude Cost Optimization Plan

**Project:** MealOS AI
**Last Updated:** 2026-07-07
**Status:** Engineering plan. Baseline figures are taken from `docs/AGENTS.md` §8 (the authoritative cost model). Levers are ordered by ROI; each specifies estimated saving, implementation cost, and quality risk.
**Related files:** `docs/AGENTS.md` (§8 Cost Modeling), `docs/prompts/README.md` (§6 Cost Implications), `docs/OBSERVABILITY.md` (cost metrics + guardrail alerts), `docs/DECISION_ENGINE.md` (the deterministic core this plan extends)

---

## Table of Contents

1. [Goal and Summary](#1-goal-and-summary)
2. [Baseline Cost Model](#2-baseline-cost-model)
3. [Where the Money Actually Goes](#3-where-the-money-actually-goes)
4. [The Levers](#4-the-levers)
5. [The Waterfall — Path to ~90%](#5-the-waterfall--path-to-90)
6. [What NOT to Cut](#6-what-not-to-cut)
7. [Cost Guardrails](#7-cost-guardrails)
8. [Rollout Order](#8-rollout-order)

---

## 1. Goal and Summary

**Question:** How do we reduce Claude costs by 90%?

**Answer:** Mostly by *not calling Claude*. MealOS already made the single most important cost decision — path scoring is deterministic TypeScript (`lib/engine/scorer.ts`), not an LLM call. This plan extends that philosophy to every remaining call:

1. **Delete LLM calls that a lookup table can do** (Tool Agent query formulation and normalization, Clarification question generation).
2. **Shrink the calls that must remain** (context pruning, output schema trimming, prompt caching).
3. **Skip the expensive call entirely when a cheaper answer is equivalent** (response caching, template short-circuits, guarded model routing).

The conservative stack (levers 1–7) reaches **~65% reduction with zero quality risk**. Reaching ~90% requires two guarded levers — template short-circuiting and Haiku routing for formulaic situation types — both gated on quality metrics, both reversible with a config flag.

| | Per situation | 10k situations/day | Monthly (10k/day) |
|---|---|---|---|
| **Baseline** | $0.0263 | $263/day | ~$7,890 |
| **Conservative stack** | ~$0.0092 | ~$92/day | ~$2,760 |
| **Full stack (guarded)** | ~$0.0033 | ~$33/day | ~$990 |
| **Reduction** | | | **~87–90%** |

---

## 2. Baseline Cost Model

### 2.1 Pricing Assumptions

Published Anthropic API pricing used throughout this document:

| Model | Input / MTok | Output / MTok | Cache write | Cache read | Batch API |
|---|---|---|---|---|---|
| claude-sonnet-4-6 | $3.00 | $15.00 | +25% on written tokens | 10% of input price | 50% discount |
| claude-haiku-4-5 | $1.00 | $5.00 | +25% | 10% of input price | 50% discount |

### 2.2 Per-Situation Breakdown (from docs/AGENTS.md §8.1)

| Agent | Model | Avg in | Avg out | Cost/call | Share |
|---|---|---|---|---|---|
| ConversationAgent | claude-haiku-4-5 | 300 | 200 | ~$0.0003 | 1.1% |
| PlanningAgent | claude-sonnet-4-6 | 2,500 | 800 | ~$0.0250 | **95.1%** |
| ToolAgent | claude-haiku-4-5 | 600 | 400 | ~$0.0008 | 3.0% |
| MemoryAgent | claude-haiku-4-5 | 500 | 150 | ~$0.0002 | 0.8% |
| **Total** | | | | **~$0.0263** | 100% |

> **Known inconsistency:** `docs/prompts/README.md` §6 lists Planning at ~$0.0032/call. That table is stale (it under-counts output token pricing). `docs/AGENTS.md` §8 is authoritative; `prompts/README.md` §6 should be corrected to match in its next minor version.

> **Unaccounted call:** the Clarification Engine's question-generation prompt (`docs/prompts/clarification.md`) runs on **claude-sonnet-4-6** and appears in neither cost table. At ~700 in / ~250 out it costs ~$0.006 per clarified situation. Roughly 40–60% of situations clarify (higher for new users), adding ~$0.003 per situation on average — a hidden ~11% on top of baseline. Lever 2 eliminates most of it.

### 2.3 Monthly Cost at Scale (baseline, 30-day month)

| Volume | Daily | Monthly |
|---|---|---|
| 1,000 situations/day | ~$26.30 | ~$790 |
| 10,000 situations/day | ~$263 | ~$7,890 |
| 100,000 situations/day | ~$2,630 | ~$78,900 |

At 100k/day, baseline Claude spend approaches **$1M/year**. The levers below are not optional at that scale.

---

## 3. Where the Money Actually Goes

Decomposing the Planning Agent's $0.025 (the only number that matters):

| Component | Tokens | Cost | Notes |
|---|---|---|---|
| Input: system prefix + planning prompt + examples | ~800 | $0.0024 | Static per version — prime caching target |
| Input: SituationContext + user memory | ~400 | $0.0012 | Semi-static per user — cacheable within session |
| Input: Swiggy results (10 restaurants) + pantry | ~1,300 | $0.0039 | Dynamic — prime pruning target |
| Output: full recommendation JSON | ~800 | $0.0120 | **The single largest line item** |
| **Total** | ~3,300 effective | ~$0.0195–0.025 | |

Two structural facts drive the whole plan:

1. **Output tokens cost 5× input tokens.** The 800-token recommendation JSON ($0.012) costs more than all 2,500 input tokens ($0.0075). Output trimming beats input trimming per token.
2. **95% of spend is one call.** Any lever that skips or shrinks the Planning Agent dominates every lever that touches the other three agents combined.

---

## 4. The Levers

Each lever: **saving** (% of total baseline), **effort** (eng-days), **risk**, and how we detect over-cutting.

### Lever 1 — Deterministic Tool Agent (kill the LLM in the middle)

The Tool Agent (`lib/agents/tool.ts`) uses claude-haiku-4-5 to (a) formulate search queries and (b) normalize API responses. Neither needs a model:

- **Query formulation** is a lookup: `situationType → query template` is already enumerated in `docs/AGENTS.md` §4.3 ("sick → khichdi soup comfort food", "broke → cheap meals under Rs 150"). Move it to a TypeScript map keyed on `(situationType, dietaryFilter)`.
- **Normalization** is mechanical field mapping (§4.6 rules: round prices, convert slots to IST 12-hour, exact names). Pure functions, unit-testable, zero hallucination risk — *better* than the LLM at this job.
- **Keep a Haiku call only for Instamart fuzzy matching** ("2 onions" → "onions 500g"), which is genuinely linguistic — and even that gets a static synonym table for the top 200 grocery items first, LLM as fallback.

| | |
|---|---|
| Saving | ~2.7% of total (~$7/day at 10k) — plus removes ~500ms p50 latency from the critical path |
| Effort | 3–4 days (mappers + fixtures already exist in `docs/SWIGGY_MCP.md` test fixtures) |
| Risk | **None.** Deterministic mapping is strictly more reliable. `NO_RESULTS` rate is the watch metric — if templated queries under-perform LLM queries, `mealos_tool_no_results_ratio` rises |

### Lever 2 — Deterministic Clarification (template bank)

Gap analysis is *already* deterministic — `missingRequired` per situation type is a lookup table (`docs/AGENTS.md` §2.4). The only LLM work is phrasing the question, and the phrasing is formulaic: the required-field × situation-type matrix has ~11 types × ~6 fields ≈ **at most 40 distinct questions**, each with fixed quick-tap options (all worked examples in `ARCHITECTURE.md` Phase 4 are template-shaped).

Build a question bank: `(situationType, missingField) → {text, options[]}`. Fall back to the Sonnet call only for the `general` type with 3+ missing fields, where contextual phrasing genuinely helps.

| | |
|---|---|
| Saving | ~80% of the hidden clarification cost (~$0.0024/situation avg, ~$24/day at 10k) — and clarification cards render instantly instead of after a 2–4s LLM round trip |
| Effort | 2–3 days (bank + selection logic; copy review with design) |
| Risk | Low. Questions become less situationally phrased. Watch `clarification_answer_rate` — if users abandon at the clarification card more than baseline, phrasing quality regressed |

### Lever 3 — Context Pruning for Planning Agent input

Already specified in `docs/AGENTS.md` §8.3 Strategy 3; tighten further:

- Restaurants: top 5 by relevance (not 10) → and **only the fields the Planning Agent uses** (name, id, rating, ETA, top 3 items with price/veg/protein). Strip `deliveryFee`, `minOrderValue`, `cuisineTypes` unless situation type needs them.
- Pantry: only items touched in 30 days, name-only (no timestamps).
- Memory: inject the ~10 facts relevant to the situation type, not the full fact dump (the fact-key → situation-type relevance map is static).
- Instamart: `found: true` items only.

Input drops ~2,500 → ~1,600 tokens.

| | |
|---|---|
| Saving | ~10% of total (~$27/day at 10k: $0.0027/situation off Planning input) |
| Effort | 2 days (orchestrator-side filtering; no prompt change) |
| Risk | Low-medium. Over-pruning starves the model of context. Watch `whyNotAlternatives` quality and user rating on order-path recommendations; add back fields if ratings dip >0.2 stars |

### Lever 4 — Output Schema Trimming (the 5× lever)

800 output tokens at $15/MTok is the biggest single line item. Cut what the client can derive or already has:

- Drop `description` free-prose on menu items (client renders name + price).
- Recipe steps: cap instruction length at ~15 words; `durationMin` stays.
- `whyNotAlternatives`: one sentence hard cap (already spec — enforce via `max_tokens` headroom monitoring).
- Never echo input data back (restaurant fields the orchestrator already holds — return `restaurantId` and menu item ids/names only; orchestrator re-joins from Tool Agent output before persisting).

Output drops ~800 → ~500 tokens.

| | |
|---|---|
| Saving | ~17% of total (~$45/day at 10k: $0.0045/situation) |
| Effort | 3 days (schema change = major prompt version bump per `docs/prompts/README.md` §4; client re-join logic; regression run) |
| Risk | Medium. The re-join must be exact (ids as join keys). Schema-failure rate is the watch metric — if trimming confuses the model, `schema_failed` rises above its 2% deploy-gate |

### Lever 5 — Prompt Caching

Per `docs/prompts/README.md` §6: system prefix + agent prompt exceed 1024 tokens for the Planning Agent → eligible for `cache_control: ephemeral`.

Arithmetic for Planning (post-Lever-3, ~1,600 input tokens, ~800 static):
- Uncached: 800 × $3/MTok = $0.0024 per call on the static block.
- Cached read: 800 × $0.30/MTok = $0.00024. Cache write premium amortizes across the 5-minute TTL — at ≥10 situations per 5 min globally (true above ~300/day volume since the cache key is the shared system block, not per-user), hit rate on the static block approaches ~95%.
- Net: ~$0.0021 saved per Planning call. Same treatment on Conversation Agent's 200-token system prompt is below the 1024 minimum — concatenate examples into the cacheable block to cross the threshold.

| | |
|---|---|
| Saving | ~8% of total (~$21/day at 10k) |
| Effort | 1 day (SDK parameter + block ordering: static blocks first, dynamic last) |
| Risk | **None** (bit-identical prompts). Only failure mode is accidentally busting the cache by interpolating dynamic values into the static block — lint the template assembly |

### Lever 6 — Response Caching (identical situations)

Already specified in `docs/AGENTS.md` §8.3 Strategies 1–2:
- Planning output cache keyed on `(contextHash, swiggyHash)`, TTL 15 min → 5–15% hit rate.
- Swiggy result cache per `(location, situationType, dietaryFilter)`, TTL 15 min → 20–30% hit rate, which *also* raises the Planning cache hit rate (stable `swiggyHash`).
- Add: **template-situation cache.** Quick-tap situation templates (the onboarding chips) produce near-identical contexts for the same user across days. Cache per `(userId, templateId)` for 4 hours with a "same as yesterday?" freshness check.

| | |
|---|---|
| Saving | ~10% of total blended (~$26/day at 10k), assuming 10% planning-cache + template hits |
| Effort | 3 days (Redis keys + invalidation on memory-fact change) |
| Risk | Low. Staleness is bounded by TTL; a stale plan is still a *valid* plan (prices may drift ±₹10). Invalidate on `PATCH /memory` |

### Lever 7 — Batch API for Memory Agent

The Memory Agent is async by design (`docs/AGENTS.md` §5 — "NEVER in the critical path"). Perfect Batch API candidate: queue extraction jobs, flush every 30 min, 50% discount. Combine with §8.3 Strategy 6 (batch 5–10 situations per user into one extraction call) for a compound saving.

| | |
|---|---|
| Saving | ~0.6% of total (~$1.50/day at 10k) — small, but zero-risk and structurally right |
| Effort | 2 days |
| Risk | None user-facing. Memory facts land minutes later instead of seconds; clarification-suppression benefit of a fact is rarely needed within the same half hour |

### Lever 8 — Structured Outputs (kill retry waste)

Retries on schema failure re-bill full input + output. At the deploy-gate ceiling (2% schema-failure rate) with the Conversation Agent's one-retry policy, retry waste is ~1–2% of spend — worse during prompt regressions. Adopt strict JSON mode / tool-schema-forced output where SDK support exists (per `docs/AGENTS.md` §3.6), making malformed JSON structurally impossible rather than prompt-discouraged.

| | |
|---|---|
| Saving | ~1–2% steady-state; the real value is capping regression blast radius |
| Effort | 1–2 days |
| Risk | None. Also deletes the "stricter retry prompt" complexity in ConversationAgent Failure Mode 2 |

### Lever 9 — Template Short-Circuit (skip Sonnet entirely) — **GUARDED**

When (a) the Decision Engine winner has score >85, (b) the situation type is formulaic (`quick_meal`, `office_lunch`, `late_night`, `broke`), and (c) a near-identical situation for this user completed with rating ≥4 in the last 14 days — serve a **deterministic plan assembled in TypeScript**: winner path + top Swiggy result (or last cooked recipe) + a template explanation with numbers interpolated ("Cooking saves you ₹{delta} vs the best delivery option").

The Planning Agent's irreplaceable output is *prose judgment on novel situations*. A repeat Tuesday office lunch is not novel.

| | |
|---|---|
| Saving | ~19% of total at a 25% short-circuit rate (~$50/day at 10k) |
| Effort | 5 days (eligibility rules + template renderer + explanation snippets) |
| Risk | **Medium — gated.** Templated explanations feel robotic if over-applied. Gates: user rating on short-circuited plans must stay within 0.2 stars of LLM plans; `dismissed` rate within 3pp. Ship at 5% traffic, ramp on metrics |

### Lever 10 — Guarded Haiku Routing for Formulaic Planning — **GUARDED**

`docs/AGENTS.md` §8.3 Strategy 4 says "do not downgrade PlanningAgent to haiku" — as a blanket rule, that stands. The guarded version: route by situation type. `date_planning`, `party_hosting`, `meal_prep`, `nutrition_goal` (multi-step reasoning, multi-service plans) stay on Sonnet unconditionally. `sick`, `broke`, `quick_meal`, `late_night`, `office_lunch` — where the winning path is usually eliminated-down to one option and the recommendation is "top result + short explanation" — trial claude-haiku-4-5 at ~1/9 the blended cost.

| | |
|---|---|
| Saving | ~24% of total if 45% of (non-short-circuited) planning calls route to Haiku (~$63/day at 10k) |
| Effort | 4 days (router + per-model prompt variants + eval harness from `docs/TESTING.md` agent regression suite) |
| Risk | **Highest of any lever — hard-gated.** A/B against Sonnet on the same situations; ship only if rating delta <0.15 stars and schema-failure delta <1pp per routed type. Any type that fails its gate stays on Sonnet permanently. Kill switch: single env var reverts all routing |

---

## 5. The Waterfall — Path to ~90%

Cumulative, ordered by rollout sequence (not raw saving). Base: $0.0263/situation, $263/day at 10k situations/day. Savings interact (later levers apply to an already-reduced base), so column 3 is the honest number.

| # | Lever | Per-situation after | Daily at 10k | Cumulative reduction |
|---|---|---|---|---|
| — | Baseline | $0.0263 | $263 | — |
| 1 | Deterministic Tool Agent | $0.0256 | $256 | 2.7% |
| 2 | Deterministic clarification¹ | $0.0256 | $256 | 2.7%¹ |
| 3 | Context pruning | $0.0229 | $229 | 12.9% |
| 4 | Output schema trimming | $0.0184 | $184 | 30.0% |
| 5 | Prompt caching | $0.0163 | $163 | 38.0% |
| 6 | Response caching (10% blended hit) | $0.0148 | $148 | 43.7% |
| 7 | Batch Memory + structured outputs | $0.0143 | $143 | 45.6% |
| | **← Conservative stack ends here (+ Lever 2's off-book ~$24/day ≈ real-world ~55%)** | | | |
| 8 | Template short-circuit (25% of situations) | $0.0110 | $110 | 58.2% |
| 9 | Guarded Haiku routing (45% of remaining) | $0.0033–0.0040 | $33–40 | **85–87%** |

¹ Lever 2 saves ~$24/day of cost *not in the baseline table* (see §2.2) — it doesn't move the headline percentage but is among the highest-ROI items in absolute dollars.

**Honest bottom line:** levers 1–7 get ~46% on-book (~55% in real dollars) with zero-to-low risk. The last ~35 points come entirely from levers 9–10, which are quality-gated experiments, not guarantees. If both gates fail, ~55–60% is the ceiling — plan budgets on the conservative stack and treat 90% as the earned outcome.

---

## 6. What NOT to Cut

| Keep | Why |
|---|---|
| **Sonnet for novel/complex planning** (`date_planning`, `party_hosting`, `meal_prep`, `nutrition_goal`) | Multi-service, multi-constraint prose reasoning is the product's core value (`docs/AGENTS.md` §8.3 Strategy 4). A bad anniversary recommendation costs a user; a good one earns retention worth far more than $0.025 |
| **Conversation Agent quality** | It gates the whole pipeline; a misclassified situation wastes every downstream token. Its $0.0003 is the best-spent money in the system. Do not shrink its examples below the eval-passing set |
| **Clarification LLM fallback for `general` type** | The template bank covers enumerable gaps; genuinely ambiguous input still needs contextual phrasing |
| **`max_tokens` headroom** | Per `docs/AGENTS.md` §1.5: if outputs approach the cap >5% of the time, raise the cap — truncated JSON = schema failure = full-cost retry, which is *more* expensive |
| **The retry budget on timeouts** | A degraded fallback plan has measurable abandonment cost; one retry is cheaper than a lost situation |

**Over-cutting detectors** (all defined in `docs/OBSERVABILITY.md`; alert thresholds in its §7):

- `mealos_plan_rating_avg` drops >0.2 stars week-over-week on any situation type
- `mealos_situations_funnel` executed/plan_ready conversion drops >3pp
- `mealos_agent_schema_failures_ratio` >2% for any agent (the prompt-deploy gate, reused as a cost-lever gate)
- `mealos_plan_dismissed_ratio` rises >3pp on short-circuited or Haiku-routed plans vs Sonnet control
- `mealos_clarification_abandon_ratio` rises after template-bank rollout

Every guarded lever ships behind a flag with a one-variable revert.

---

## 7. Cost Guardrails

Optimization reduces the average; guardrails cap the tail.

### 7.1 Budgets

| Scope | Budget | On breach |
|---|---|---|
| Per-user daily | 50k tokens (~15–20 situations) | Soft: serve from caches/templates only. Hard at 2×: friendly rate-limit message, `RATE_LIMIT_EXCEEDED` semantics per `docs/API.md` |
| Per-situation | 15k tokens across all agents + retries | Abort to degraded fallback plan; log `budget_exceeded` |
| Global daily | 1.5× trailing-7-day average | Page on-call (see `docs/OBSERVABILITY.md` §7 alert table) |
| Global monthly | Hard cap in Anthropic console + `ANTHROPIC_SPEND_CAP` env check at 90% | Kill switch: disable Sonnet routing, serve template plans only, banner "simplified recommendations" |

### 7.2 Instrumentation

Token counts already land per-run in `situation_agent_runs` (`input_tokens`, `output_tokens` — `docs/AGENTS.md` §1.4). Add a nightly rollup job → `daily_cost_rollups` (date, agent, model, situations, tokens, computed USD) so cost-per-situation is a dashboard query, not a spreadsheet. Cost dashboard spec: `docs/OBSERVABILITY.md` §5.3.

### 7.3 Kill Switches

| Switch | Effect | Trigger |
|---|---|---|
| `DISABLE_HAIKU_ROUTING` | All planning back to Sonnet | Quality gate breach |
| `DISABLE_SHORT_CIRCUIT` | All situations get LLM planning | Rating/dismissal gate breach |
| `FORCE_TEMPLATE_MODE` | No Sonnet at all — template plans only | Spend-cap breach or Anthropic outage |
| `DISABLE_RESPONSE_CACHE` | Bypass Redis plan cache | Staleness incident |

---

## 8. Rollout Order

| Phase | Levers | Duration | Exit criteria |
|---|---|---|---|
| 1 | 5 (prompt caching), 8 (structured outputs) | 1 week | Zero schema/quality change; cache-read ratio >80% on static blocks |
| 2 | 1 (Tool), 2 (Clarification), 7 (Batch memory) | 2 weeks | `NO_RESULTS` and clarification-abandon flat vs baseline |
| 3 | 3 (pruning), 4 (output trim) — one prompt major-version bump together | 2 weeks | Agent regression suite green; rating flat; schema failures <2% |
| 4 | 6 (response caching) | 1 week | Hit rate ≥8%; zero stale-plan complaints |
| 5 | 9 (short-circuit) at 5% → 25% traffic | 3 weeks | Rating delta <0.2★, dismissal delta <3pp |
| 6 | 10 (Haiku routing) per-type A/B | 4 weeks | Per-type gates pass; failed types pinned to Sonnet |

Each phase's watch metrics and alert thresholds live in `docs/OBSERVABILITY.md`. No phase starts while the previous phase's exit criteria are red.

---

*Document ends. Baseline: `docs/AGENTS.md` §8. Metrics and alerts: `docs/OBSERVABILITY.md`. Prompt versioning rules for levers 3–4: `docs/prompts/README.md` §4–5.*
