# MealOS AI — Failure Modes (The AI Failure Bible)

**Project:** MealOS AI
**Last Updated:** 2026-07-07
**Status:** Authoritative failure catalog. Every known way the AI pipeline can fail, how the system detects it, and EXACTLY what happens next. There are no silent failures and no generic error screens in MealOS — if a failure is not in this document, its handling is undefined and that is a bug in this document.
**Related files:** `docs/AGENTS.md` (agent contracts and fallbacks), `docs/prompts/fallback.md` (degraded-mode prompt blocks and static templates), `docs/API.md` (error codes, SSE events, retry rules), `docs/DECISION_ENGINE.md` (scoring, confidence, NO_WINNER), `docs/PROMPT_ENGINEERING_GUIDE.md`

---

## Table of Contents

1. [How to Read This Document](#1-how-to-read-this-document)
2. [Group 1 — Input Failures (FM-0xx)](#2-group-1--input-failures)
3. [Group 2 — Agent Failures (FM-1xx)](#3-group-2--agent-failures)
4. [Group 3 — Tool Failures (FM-2xx)](#4-group-3--tool-failures)
5. [Group 4 — Data Failures (FM-3xx)](#5-group-4--data-failures)
6. [Group 5 — Execution Failures (FM-4xx)](#6-group-5--execution-failures)
7. [Fallback Cascade Diagram](#7-fallback-cascade-diagram)
8. [Master Mapping Table: FM → API Error Code → UI State](#8-master-mapping-table)
9. [Monitoring: How Each Group Is Watched](#9-monitoring-how-each-group-is-watched)

---

## 1. How to Read This Document

Every failure mode (FM) is specified with the same eight fields:

| Field | Meaning |
|---|---|
| **Trigger** | The condition that causes the failure |
| **Detection** | The exact signal the system uses to know — a status code, a schema check, a threshold. Never "the output looks wrong" |
| **Blast radius** | What is affected: this call, this situation, this user, all users |
| **Handling path** | The deterministic sequence that fires: which fallback, which SSE event, in what order |
| **User sees** | The Situation Board state, verbatim strings where they are specified |
| **Logged** | What lands in `situation_agent_runs` / server logs |
| **Recovery** | How the system or user gets back to normal |
| **Pinning test** | The automated test that locks this behavior in place |

**SSE event names** follow `docs/API.md` (the wire contract): `context_understood`, `clarification_needed`, `planning_started`, `agent_progress`, `plan_ready`, `error`. Note: `docs/AGENTS.md` §7.4 uses older names (`context_extracted`, `context_ready`) — API.md wins; see `docs/PROMPT_ENGINEERING_GUIDE.md` Appendix item 5.

**Situation Board UI states** referenced throughout [NEW — this vocabulary is defined here; not yet in AGENTS.md or DESIGN_SYSTEM.md]:

| UI State | Meaning |
|---|---|
| `BOARD_NORMAL` | Standard flow: Context Card → (Clarification Card) → Plan Card with confidence badge |
| `BOARD_DEGRADED` | Plan Card shown with a degraded banner ("Delivery is temporarily unavailable…") |
| `BOARD_LOW_CONFIDENCE` | Plan Card with low-confidence styling + assumption warning + "tell me more" affordance |
| `BOARD_REDIRECT` | Redirect card with example inputs; no plan |
| `BOARD_ERROR` | Terminal error card with retry button; no plan |
| `BOARD_STALE` | Previously delivered plan with a staleness banner and refresh affordance |
| `BOARD_OFFLINE` | Client-side offline strings from `fallback.md` §6 |

**The prime directive** (from `docs/AGENTS.md` §7.5): *always give the user something.* A degraded plan beats a blank screen. Every handling path below terminates in a rendered card, never a spinner that spins forever.

---

## 2. Group 1 — Input Failures

Failures caused by what the user typed (or didn't).

---

### FM-001 — Non-Food Input

**Trigger:** User submits input unrelated to food: "help me with my taxes", "write a poem about dogs".
**Detection:** ConversationAgent output has `nonFoodInput: true`, OR `confidence < 30` with `situationType: 'general'` and the input contains zero food-adjacent vocabulary (word-list check in code — see `fallback.md` §4 selection rule).
**Blast radius:** This situation only. Pipeline ends early — no Tool, Decision Engine, or Planning calls are made (cost ~$0.0003 total).
**Handling path:**
1. Orchestrator skips clarification and planning entirely.
2. The prewritten `RedirectOutput` JSON from `fallback.md` §4 is returned directly from the API layer — no second LLM call.
3. SSE emits `error` with a redirect payload? No — SSE emits the redirect as the terminal event and closes the stream. [NEW — AGENTS.md names this event `non_food_redirect`; API.md does not define it. Resolution needed: add `non_food_redirect` to API.md's SSE event list.]
4. Situation status → `completed` (not `abandoned` — the system responded).
**User sees:** `BOARD_REDIRECT` — "MealOS plans meals — describe your food situation and I'll figure out the best path…" plus 3 example inputs.
**Logged:** ConversationAgent run with `status: 'completed'`, `nonFoodInput: true` in `output_snapshot`. No error.
**Recovery:** User types a food situation. Nothing to clean up.
**Pinning test:** Input `"help me with my taxes"` → assert `nonFoodInput === true`, assert zero ToolAgent/PlanningAgent runs for the situation, assert response body equals the canned `non_food` RedirectOutput.

---

### FM-002 — Vague Input, No Extractable Signal

**Trigger:** "hungry", "something good", "ok" — food-adjacent but contentless.
**Detection:** `situationType: 'general'`, `confidence` in [30, 60), `missingRequired` contains 3+ planning-critical fields.
**Blast radius:** This situation. Adds one clarification round-trip; no other cost.
**Handling path:** This is NOT an error — it is the designed low-information path. Clarification Engine fires with the broad 3-question batch (canCook, craving, budget — see `clarification.md` Example 5). SSE: `context_understood` → `clarification_needed`. Status: `created → intent_extracted → clarifying`.
**User sees:** `BOARD_NORMAL` with a Clarification Card (max 3 questions, quick-tap options).
**Logged:** Normal completed run; `confidence_score` in the 30–59 band is the queryable signature of this path.
**Recovery:** User answers → pipeline resumes at `context_ready`.
**Pinning test:** Input `"hungry"` with null memory → assert `situationType === 'general'`, `confidence` between 30 and 60, ClarificationEngine invoked with ≥3 required fields, exactly ≤3 questions returned.

---

### FM-003 — Clarification Loop (Answers Don't Fill the Gaps)

**Trigger:** User answers clarification questions with free-text that resolves nothing ("whatever", "you decide", "idk"), or repeatedly picks the null-valued "Tell me more" option. Without a cap, the system would ask forever.
**Detection:** Code-level counter: `clarifications.pass_number`. After pass 2, `missingRequired` is still non-empty.
**Blast radius:** This situation. The risk being contained is UX abandonment, not system damage.
**Handling path (the max-2-pass rule, enforced in code — `ARCHITECTURE.md` Phase 4 Step 6, `clarification.md` overview):**
1. Pass 1: up to 3 questions. Answers merged into SituationContext.
2. If required fields still missing → pass 2 (max 1 more pass, per AGENTS.md §7.3 step [2]).
3. After pass 2, **no third pass ever fires.** The orchestrator fills every still-missing required field with defaults (memory value if any, else the situation-type default) and records them as assumptions.
4. Decision Engine runs with assumed values → confidence takes the missing-required penalty (−15/−22/−37 per `DECISION_ENGINE.md` §6).
5. Pipeline proceeds to a plan. SSE: `planning_started` → `plan_ready`.
**User sees:** `BOARD_LOW_CONFIDENCE` — plan renders with "We're making some assumptions — verify these" (the 40–54 confidence band behavior) and the assumption statements displayed as confirmable chips.
**Logged:** `clarifications` rows with `pass_number: 1` and `2`; situation `extracted_context` records `source: 'assumed'` per filled field. [NEW — the per-field `assumed` source marker is not yet in DATABASE.md.]
**Recovery:** The plan's assumption chips let the user correct any assumed value, which re-enters planning (a new scoring pass, not a new clarification pass).
**Pinning test:** Simulate two clarification passes with all-null answers → assert a third `clarification_needed` SSE event is never emitted, assert `plan_ready` fires, assert confidence ≤ 68.

---

### FM-004 — Duplicate Situation Submission

**Trigger:** Double-tap on submit, client retry after a network blip, or a stuck user hammering the button. Two identical `POST /api/v1/situations` within seconds.
**Detection:** API layer: same `userId` + identical `input` string + an existing situation for that user with status not in (`completed`, `abandoned`) created within the last 60 seconds. [NEW — API.md documents "check for an existing in-progress situation before retrying" as a *client* rule; this server-side guard is not yet specified there.]
**Blast radius:** Duplicate LLM spend and — worse — two SSE streams fighting over one Board if unhandled.
**Handling path:**
1. Server returns the **existing** situation's `id` and current status with HTTP 200 (idempotent-style response), instead of creating a new row.
2. No new pipeline starts. Client attaches to the existing `/stream`.
3. Rate limiting (10 situations/min) backstops abusive repetition with `429 RATE_LIMIT_EXCEEDED`.
**User sees:** Nothing — the Board continues rendering the in-flight situation. On 429: the rate-limit message with retry-after seconds.
**Logged:** API log line `situation_dedup_hit` with both request IDs. No agent runs.
**Recovery:** Automatic.
**Pinning test:** Fire two identical POSTs 100ms apart → assert both responses carry the same situation `id`, assert exactly one ConversationAgent run exists for it.

---

### FM-005 — Conflicting Goals (Constraint Impossibility)

**Trigger:** The user's stated goals cannot jointly be satisfied: "180g protein, vegetarian, Rs 100, 15 minutes", or "5-star dinner, Rs 100 budget".
**Detection:** Two layers. (1) ConversationAgent extracts all stated facts *without resolving the conflict* (per `conversation.md` Edge Case 5) — contradiction is never "fixed" at extraction. (2) Decision Engine scores honestly: all paths score low (goalMatchScore ratios collapse — see `DECISION_ENGINE.md` worked example: "All paths score very low… Confidence is low because the goal is not achievable").
**Blast radius:** This situation. The system's credibility is what's at stake — pretending the goal is achievable is the failure to avoid.
**Handling path:**
1. If all three scores < 40 → the LOW CONFIDENCE MODE block from `fallback.md` §3 is appended to the Planning prompt.
2. Planning Agent names the binding constraint plainly, recommends the least-bad path, and ends with the re-plan invitation: "If [key constraint] changes, tell me and I'll re-plan."
3. `confidence: "low"` in the plan; numeric confidence carries the low-score/no-clear-winner penalties.
4. SSE: normal sequence ending in `plan_ready`.
**User sees:** `BOARD_LOW_CONFIDENCE` — an honest plan: "There are some real constraints here — [binding constraint]. The best available option given those limits is […]".
**Logged:** DecisionResult snapshot with all scores < 40; PlanningAgent `confidence_level: 'low'`.
**Recovery:** User relaxes a constraint (taps the re-plan affordance or types a new input) → fresh situation.
**Pinning test:** Context {protein: 180, diet: vegetarian, budget: 100, timeConstraintMinutes: 15} with fixture Swiggy data → assert all path scores < 40, assert explanation contains the literal substring "If " and "re-plan" (invitation present), assert no fabricated menu item appears (cross-check against fixture).

---

### FM-006 — Clarification Expired

**Trigger:** User walks away mid-clarification; answers arrive after the 5-minute window.
**Detection:** `POST /situations/:id/clarify` finds `asked_at` older than 5 minutes.
**Blast radius:** This situation only.
**Handling path:** API returns `409 CLARIFICATION_EXPIRED` (per `docs/API.md`). The situation transitions to `abandoned`. No partial pipeline resumes — state machine transitions are one-directional.
**User sees:** "This session expired — tell me your situation again and we'll pick up from there." with the original input pre-filled for one-tap resubmission. [NEW — pre-fill affordance not yet in UX.md.]
**Logged:** Situation row ends `abandoned` with `context_ready_at` null.
**Recovery:** Resubmission creates a fresh situation; memory (if any facts were confirmed in pass 1 — they were not yet persisted, Memory Agent runs only on completion) is NOT updated from the expired session.
**Pinning test:** Answer a clarification 5m01s after `asked_at` → assert 409 with code `CLARIFICATION_EXPIRED`, assert situation status `abandoned`, assert zero MemoryAgent runs.

---

## 3. Group 2 — Agent Failures

Failures inside an LLM call: timeouts, malformed output, refusals, and — most dangerous — *plausible wrong output*.

---

### FM-101 — Conversation Agent Timeout

**Trigger:** claude-haiku-4-5 call exceeds 3,000ms (API latency spike, provider incident).
**Detection:** `Promise.race` sentinel fires with `AGENT_TIMEOUT` (`docs/AGENTS.md` §1.2, §2.5 FM1).
**Blast radius:** This situation; if systemic, all new situations (watch the agent latency dashboard).
**Handling path:**
1. Retry once, same prompt (retry policy: 2 max, timeout-only trigger).
2. Second timeout → return `TIMEOUT_FALLBACK` SituationContext verbatim (`situationType: 'general'`, `confidence: 30`, `missingRequired: ['craving','budget','canCook']`, `ambiguities: ['agent_timeout']`).
3. Pipeline proceeds — the Clarification Engine asks the broad 3-question batch. The user experiences FM-002's path, slightly delayed.
4. SSE: `context_understood` (with the fallback's low confidence) → `clarification_needed`.
**User sees:** `BOARD_NORMAL` with the broad Clarification Card. The failure is invisible by design.
**Logged:** `status: 'timeout'`, `attempts: 2`, `error_message: 'AGENT_TIMEOUT'`.
**Recovery:** Automatic within the situation. Alert if ConversationAgent timeout rate > 1% over 15 min.
**Pinning test:** Mock the SDK to hang → assert exactly 2 attempts, assert returned context deep-equals `TIMEOUT_FALLBACK`, assert `clarification_needed` is the next SSE event.

---

### FM-102 — Schema-Invalid JSON, Twice

**Trigger:** Model returns prose, markdown-fenced JSON, or a shape that fails Zod — and (where a retry is allowed) the retry fails too.
**Detection:** `parseAndValidate` returns `success: false` (either `json_parse_failed` or a Zod error message).
**Blast radius:** This call → this situation, degraded.
**Handling path (differs by agent — this is deliberate, see `AGENTS.md` §1.2):**
- **ConversationAgent:** one retry with the stricter suffix ("Output ONLY the raw JSON object starting with `{`…"). Second failure → `SCHEMA_FALLBACK` context (`confidence: 20`, `ambiguities: ['schema_failure']`) → broad clarification. SSE `context_understood` with confidence 20.
- **PlanningAgent:** NO schema retry (fail fast). Degraded output with `status: 'schema_failed'`; the UI falls back to the situationType-generic message (`AGENTS.md` §3.5 FM4). SSE `plan_ready` with a `schema_failed` marker in the payload.
- **ToolAgent / MemoryAgent:** no retry; ToolAgent failure is treated as tool-failure output (FM-202 semantics); MemoryAgent failure is silent (no writes).
**User sees:** Conversation path — normal clarification. Planning path — `BOARD_DEGRADED` with the generic-by-type plan card.
**Logged:** `status: 'schema_failed'`, raw output preserved in `output_snapshot` as `{raw: string}` for prompt debugging. This metric has an alert threshold — rising schema failures are the earliest drift signal.
**Recovery:** Automatic per situation. Sustained rate > 2% for any agent → prompt rollback per `docs/prompts/README.md` §5.
**Pinning test:** Mock model returning ` ```json\n{...}\n``` ` → Conversation: assert exactly 2 attempts and fallback context; Planning: assert exactly 1 attempt, `status: 'schema_failed'`, and that the UI payload carries the marker.

---

### FM-103 — LLM Refusal on Benign Input

**Trigger:** Safety filter fires on an unusual-but-legitimate food input (graphic description of preparing raw meat, medical dietary details).
**Detection:** Response with `stop_reason: 'max_tokens'` at token 0, or empty content block with refusal text (`AGENTS.md` §2.5 FM3).
**Blast radius:** This situation; recurring for the same input text.
**Handling path:**
1. **No retry** — refusals are deterministic for identical input.
2. Log refusal + raw input for human review (this is the feed for prompt/model tuning).
3. Return `SCHEMA_FALLBACK` with `error_message: 'model_refusal'`, `status: 'failed'`.
4. Orchestrator treats it as low-confidence general → broad clarification. The user's *rephrased* answer usually passes.
**User sees:** `BOARD_NORMAL` with broad Clarification Card — indistinguishable from FM-002.
**Logged:** `status: 'failed'`, `error_message: 'model_refusal'`, raw input flagged into the review queue.
**Recovery:** User rephrases via clarification. If a benign phrase pattern recurs in the refusal log, add a worked example to `conversation.md` (minor version bump).
**Pinning test:** Mock a refusal response → assert 1 attempt only, assert fallback context returned, assert review-queue log entry exists.

---

### FM-104 — Planning Agent Timeout

**Trigger:** claude-sonnet-4-6 call exceeds 8,000ms. (Note: `fallback.md` says 10,000ms — 8,000ms per AGENTS.md is authoritative; see PROMPT_ENGINEERING_GUIDE Appendix item 2.)
**Detection:** Sentinel `AGENT_TIMEOUT` after the single allowed timeout retry.
**Blast radius:** This situation. If systemic (provider incident), all situations — the 15s pipeline deadline contains the worst case.
**Handling path:**
1. One retry on timeout.
2. Second timeout → **no LLM involvement in recovery.** The orchestrator serves the static template for `situation.situationType` from `fallback.md` §5 (hardcoded JSON; `confidence: "low"`, `whyNotAlternatives: []`).
3. If Swiggy data exists, the simplified degraded plan from `AGENTS.md` §3.5 FM1 may substitute (top Swiggy result as title). Template wins when both apply — templates are richer than the one-liner degraded plan. [NEW — precedence between AGENTS.md §3.5 FM1 output and fallback.md §5 templates is not specified in either doc; this line resolves it: static template first, swiggy[0] plan only for `general` where the template is weakest.]
4. SSE: `plan_ready` with degraded marker. Status reaches `plan_ready`.
**User sees:** `BOARD_DEGRADED` — e.g. sick template: "Khichdi or light soup delivery — search 'khichdi' or 'clear soup' on Swiggy…" with a subtle "generated from a template" indicator.
**Logged:** `status: 'timeout'`, `attempts: 2`; pipeline status `degraded`.
**Recovery:** User can tap refresh to re-run planning once load subsides. Alert: Planning p95 > 6s is also the Budget-Agent extraction signal (`AGENTS.md` §6.1).
**Pinning test:** Mock 9s Planning latency twice for a `sick` situation → assert the emitted plan deep-equals the `sick` static template, assert `plan_ready` fired before the 15s pipeline deadline.

---

### FM-105 — Hallucinated Restaurant / Menu Item

**Trigger:** Planning Agent references a restaurant, menu item, venue, or video not present in its Tool Agent input. The most dangerous failure in the product: it looks perfect and is fiction. Executing it produces a Swiggy deep-link to nothing.
**Detection:** **Post-generation referential integrity check, in code, before `plan_ready` is emitted** [NEW — this validator is implied by system.md rule 2 but not yet specified as a code component in AGENTS.md]:
- `recommendation.restaurantId` must exist in `swiggyResults.restaurants[].restaurantId`; every `menuItems[].name` must appear among that restaurant's `topItems[].name`.
- `venueId` must exist in `dineoutVenues[]`; `availableSlots` ⊆ that venue's slots.
- `youtubeVideoId` must equal `youtubeResult.videoId`.
- `proteinG`/`calories` must be null/absent unless present in the input data (fabricated-nutrition subcase).
**Blast radius:** This situation; user trust if it ever renders.
**Handling path:**
1. Validator fails → treat exactly like a schema failure (FM-102 Planning branch): no retry, `status: 'schema_failed'` with `error_message: 'referential_integrity: <field>'`.
2. Serve the situation-type static template (same recovery as FM-104).
3. The hallucinated output is preserved in `output_snapshot` — these snapshots are gold for prompt tuning.
**User sees:** `BOARD_DEGRADED` static-template plan. Never the hallucination.
**Logged:** `referential_integrity` error with the offending field and value.
**Recovery:** Automatic per situation. Recurring hallucination on a pattern (e.g., invented khichdi vendors when results are empty) → strengthen the planning prompt's empty-results example (minor bump) and add the case to the golden set.
**Pinning test:** Feed Planning a fixture with exactly 2 restaurants; mock output referencing "Annapurna Tiffins" (absent) → assert plan is blocked, template served, `error_message` starts with `referential_integrity`.

---

### FM-106 — Bad Recommendation (Violates Constraints Post-Scoring)

**Trigger:** The plan breaks a hard constraint the scores respected: recommends a Rs 450 order against a Rs 300 budget; recommends a chicken dish to a vegetarian; recommends cook when `canCook === false`; picks a path with `pathAvailability: false`.
**Detection:** **Constraint assertion pass in code, alongside the FM-105 validator** [NEW — same validator component]:
- `estimatedCost ≤ budget` (when budget known; small tolerance 0 — budget is a hard filter per `planning.md`).
- Diet filter: every menu item's `isVeg` consistent with `dietaryFilter: 'vegetarian'/'vegan'`; recipe ingredients screened against `allergies[]`.
- `primaryPath` must have `pathAvailability[path] === true` and must equal the highest-scoring *available* path (mechanical check against `preCalculatedScores` + the tie rule Cook > Order > Dineout).
**Blast radius:** This situation; an allergy violation that renders is a safety incident, which is why this check is code, not prompt trust.
**Handling path:**
1. Path-choice violation (wrong winner picked): **fix mechanically** — the orchestrator re-labels `primaryPath` to the correct winner only if the recommendation content already belongs to that path; otherwise treat as (2).
2. Content violation (budget/diet/allergy): block the plan → static template path (FM-104 recovery), `error_message: 'constraint_violation: <rule>'`.
3. Allergy violations additionally page: they indicate either prompt regression or poisoned input data.
**User sees:** Correct plan (case 1, invisible fix) or `BOARD_DEGRADED` template (case 2). Never the violating plan.
**Logged:** `constraint_violation` with rule name and the violating values.
**Recovery:** Automatic; every occurrence goes to the golden set.
**Pinning test:** Three fixtures: over-budget order, chicken-to-vegetarian, cook-when-canCook-false → assert all three blocked/fixed, assert the vegetarian case also raises the paging-severity log.

---

### FM-107 — Confidence Too Low to Recommend (All Paths < 40 / NO_WINNER)

**Trigger:** Severe binding constraints: canCook=false + Swiggy down + budget below dineout minimums. Decision Engine emits scores all < 40, or eliminates every path → `winner: 'NO_WINNER'`, confidence floor 15–20.
**Detection:** Deterministic: `DecisionResult` values. No LLM judgment involved.
**Blast radius:** This situation.
**Handling path:**
1. All-below-40 (paths exist): LOW CONFIDENCE MODE block (`fallback.md` §3) appended to Planning prompt → honest constrained plan; **never refuse to recommend** ("a low-confidence recommendation is better than no recommendation").
2. NO_WINNER (no path available): Planning sets `confidence: 'low'`, `primaryPath: 'cook'` (pantry fallback); if pantry empty too → the "We can't help right now" card (confidence 15 per `DECISION_ENGINE.md` worked example) with connectivity/pantry suggestions.
3. SSE: `plan_ready` in case 1; in case 2 with empty pantry, `plan_ready` carrying the cant-help card payload.
**User sees:** Case 1: `BOARD_LOW_CONFIDENCE` with the binding-constraint sentence and re-plan invitation. Case 2: "We can't help right now" card — the only place in the product where no actionable plan renders, and it still explains why and what would change it.
**Logged:** DecisionResult snapshot (all scores, eliminations, confidence with itemized penalties).
**Recovery:** Constraint change by user → new situation. Swiggy recovery → refresh affordance re-runs Tool + Planning.
**Pinning test:** DECISION_ENGINE.md test cases already pin NO_WINNER (confidence=15) and all-low-score scenarios; add an E2E asserting the §3 explanation format string ("There are some real constraints here —").

---

### FM-108 — Anthropic API Error / Overloaded

**Trigger:** The model provider itself errors: HTTP 529 `overloaded_error`, 500-class API errors, or connection resets — distinct from FM-101/104 timeouts (the call *returns*, with an error, often fast).
**Detection:** SDK throws a typed API error; `retryOn: ['api_error']` agents (MemoryAgent) retry per policy; others map it to their existing failure path.
**Blast radius:** Provider incidents hit ALL agents simultaneously — the signature is every agent's error rate stepping up in the same minute, which is how this is distinguished from a prompt regression (single-agent step) on the dashboard.
**Handling path:**
1. Per-agent, the api_error is routed into the same fallback as that agent's timeout: Conversation → `TIMEOUT_FALLBACK` + broad clarification; Planning → static template by situationType; Tool → the LLM never being reached means treat as full tool failure only if the *agent call* itself died (tool-level errors are FM-201/202); Memory → retry twice, then silent no-write.
2. A 529 specifically gets one retry after the SDK-suggested backoff before falling back — overload is often transient within seconds. [NEW — 529-specific single retry is not in AGENTS.md retry tables.]
3. If the provider incident persists (> 5 min of elevated api_error), the orchestrator can serve static templates *directly* for new situations, skipping doomed Sonnet calls — spending $0 during the outage instead of paying for failures. [NEW — circuit-breaker behavior; not yet specified.]
**User sees:** Same surfaces as the corresponding timeout FMs: broad clarification or `BOARD_DEGRADED` templates. Product stays usable in template-quality mode throughout a total LLM outage — this is the payoff of `fallback.md` §5 being zero-LLM.
**Logged:** `status: 'failed'`, `error_message` with the API error type; provider-incident detection is the cross-agent correlated step.
**Recovery:** Automatic when the provider recovers; circuit breaker half-opens on a successful probe call.
**Pinning test:** Mock SDK throwing 529 → assert exactly one backoff retry then fallback; mock sustained 529 → assert circuit opens and Planning calls stop being attempted while templates still serve.

---

## 4. Group 3 — Tool Failures

External dependencies: Swiggy MCP (three services) and YouTube.

---

### FM-201 — Single Swiggy Tool Fails (Timeout / 5xx / RATE_LIMITED)

**Trigger:** One of `swiggy_search_restaurants` / `swiggy_search_instamart` / `swiggy_search_dineout` times out (3s/3s/4s per-call budgets), returns 5xx, or `RATE_LIMITED`.
**Detection:** Per-tool error surfaced by the MCP client; runtime retries each tool independently (max 2, 500ms backoff) before declaring failure.
**Blast radius:** One data channel. The plan proceeds without it.
**Handling path (exactly `tool.md` Partial Failure table):**
1. Failed tool's field → `null`; entry appended to `errors[]` with the exact taxonomy code (`SWIGGY_DOWN`, `RATE_LIMITED`, `LOCATION_NOT_SERVICEABLE`, `NO_AVAILABILITY`, …) — never generic codes, never HTTP statuses.
2. Other tools' results returned normally. `_meta.toolsSucceeded` reflects reality.
3. Planning receives partial data and adapts: `restaurants: null` with order-path-winning → switch to cook with the prepend "Swiggy returned no results for your area right now. Recommending home cooking instead." (`AGENTS.md` §3.5 FM2 — same handling as empty results).
4. SSE `agent_progress` events reflect per-tool completion so the Board's progress row is honest.
**User sees:** Usually `BOARD_NORMAL` (a full plan from the surviving channels); `BOARD_DEGRADED` only if the failed channel was the winning path's data source.
**Logged:** ToolAgent run `status: 'completed'` (partial failure is a *successful* Tool run) with `errors[]` populated; `tools_succeeded[]` for dashboards.
**Recovery:** Next situation retries naturally. Channel-level error rate > 10% → the SwiggyAgent extraction signal (`AGENTS.md` §6.5).
**Pinning test:** Mock dineout 500 + others OK → assert output has `dineoutVenues: null`, `errors[0].errorCode ∈ taxonomy`, restaurants intact, and Planning still emits `plan_ready`.

---

### FM-202 — Swiggy MCP Fully Unavailable

**Trigger:** All three Swiggy tools fail: MCP server down, network partition, auth expiry.
**Detection:** Tool Agent output `swiggyError: 'SWIGGY_UNAVAILABLE'` (set only when ALL three fail).
**Blast radius:** All situations for the outage duration — this is the marquee degraded mode.
**Handling path (the most rehearsed path in the system):**
1. Orchestrator sets `isDegradedMode: true` for Planning (`isDeadedMode` typo in AGENTS.md §3.3 — same flag).
2. The DEGRADED MODE block from `fallback.md` §1 is **prepended** to the Planning system prompt: cook path proceeds normally if cook wins or scores are within 15 points; if cook < 30 (user can't cook) → low-confidence schema with the exact string "Delivery is temporarily unavailable in your area, and cooking isn't an option right now."
3. Output rules: never say "Swiggy" (say "delivery"/"ordering"); set `degradedMode: 'swiggy_unavailable'`.
4. Decision Engine confidence takes the −15 Swiggy-unavailability penalty.
5. Execute endpoints during the outage return `503 SWIGGY_UNAVAILABLE` with the manual "open Swiggy app" fallback (per `docs/API.md`).
**User sees:** `BOARD_DEGRADED` — cook plan with "Delivery is temporarily unavailable in your area. Here's the best home cooking option based on what you have." Or, cant-cook case: the low-confidence both-limited card.
**Logged:** `swiggy_available: false` on the Tool run; `degradedMode` on the plan; outage visible as a step change on the `swiggy_available` dashboard series.
**Recovery:** Health check flips → normal mode next situation. Cached recommendations remain valid for display (BOARD_STALE rules apply at execution — FM-303).
**Pinning test:** Mock all three tools failing → assert `swiggyError` set, assert Planning prompt contains the DEGRADED MODE block, assert output `degradedMode === 'swiggy_unavailable'` and explanation contains no substring "Swiggy".

---

### FM-203 — Malformed Swiggy Response

**Trigger:** MCP returns 200 with garbage: schema drift after a Swiggy-side deploy, truncated JSON, price as `"₹160"` string, missing `restaurantId`.
**Detection:** Zod validation at the MCP client boundary (`SwiggyMCPClient` normalizes and validates BEFORE data reaches the Tool Agent). A response that parses but fails the expected shape is a *malformed response*, not a "creative" one.
**Blast radius:** One channel (like FM-201) — but persistent until Swiggy reverts or MealOS ships a normalization fix, so it degrades every situation touching that channel.
**Handling path:**
1. Client-side validation fails → that tool call is treated as failed: field `null`, `errors[]` entry `errorCode: 'SWIGGY_DOWN'` with message noting schema mismatch. [NEW — the taxonomy has no MALFORMED_RESPONSE code; folding into SWIGGY_DOWN is the current resolution. Consider adding `MALFORMED_RESPONSE` to tool.md's error codes.]
2. Never pass partially-valid records through: one bad restaurant in a list of 10 drops the record, not the list (per-record validation), unless the envelope itself is broken (drop the channel).
3. Raw offending payload logged (truncated to 8KB) for the integration fix.
4. Downstream identical to FM-201.
**User sees:** Same as FM-201.
**Logged:** `swiggy_schema_mismatch` server log with payload sample — this log line, not user reports, is how the break is discovered.
**Recovery:** Alert on first occurrence (schema mismatches are always news). Fix normalizer or wait out Swiggy revert.
**Pinning test:** Feed the client a fixture with `price: "160.00"` (string) → assert that record dropped, others pass; feed truncated JSON → assert channel fails with taxonomy code, no exception escapes the client.

---

### FM-204 — Recipe Video Unavailable (YouTube Quota / Zero Results)

**Trigger:** `youtube_search_recipe` hits `QUOTA_EXCEEDED` (daily Data API v3 quota — resets midnight PT, so this is a *predictable evening failure* at scale), `NO_RESULTS`, or `API_DOWN`.
**Detection:** Tool error code; quota specifically returns 403 with `quotaExceeded` reason from Google, mapped to `QUOTA_EXCEEDED`.
**Blast radius:** Cook-path plans lose video enrichment. Explicitly non-critical: "Planning Agent proceeds without video data."
**Handling path:**
1. `youtube: null`, error in `errors[]`. No retry against a dead quota (retrying quota errors burns nothing but adds latency — skip retries for `QUOTA_EXCEEDED` specifically). [NEW — per-error-code retry exemption not yet in AGENTS.md §4.]
2. Planning generates `recipeSteps` without `youtubeTimestamp` fields and omits `youtubeVideoId`. The recipe is complete — text instructions never depended on the video.
3. If the *recipe itself* can't be assembled (empty pantry + beginner + no recipe data), that is FM-301's shopping-list mode, not this FM.
**User sees:** `BOARD_NORMAL` cook plan without the video chip. No error surfaced — a missing enrichment is not an error.
**Logged:** `errors[]` entry; quota exhaustion also increments a daily `youtube_quota_exhausted_at` metric (time-of-day of exhaustion is the capacity-planning signal).
**Recovery:** Quota resets daily; consider request caching keyed by recipeName (same dal khichdi video serves thousands of users).
**Pinning test:** Mock `QUOTA_EXCEEDED` → assert zero retries for that code, assert plan has `recipeSteps` with no `youtubeTimestamp` keys and no `youtubeVideoId`, assert no user-visible error.

---

### FM-205 — Location Not Serviceable

**Trigger:** The user is outside Swiggy's coverage for one or more services: `LOCATION_NOT_SERVICEABLE` from restaurants, Instamart, or Dineout — a small town, a new address, or a memory location that's simply wrong (travel).
**Detection:** The exact `LOCATION_NOT_SERVICEABLE` error code per tool. Crucially distinct from FM-202: Swiggy is *up*, it just doesn't serve here — so the "temporarily unavailable" phrasing would be a lie.
**Blast radius:** All order/dineout paths for this user at this location, persistently — not an outage that resolves.
**Handling path:**
1. Tool output: affected fields `null` with the `LOCATION_NOT_SERVICEABLE` entry in `errors[]`.
2. All three tools non-serviceable → same mechanical route as FM-202 (cook-only), but the explanation must differ: not "temporarily unavailable" but location-truthful — "Delivery doesn't cover your area — here's the best home cooking option." [NEW — fallback.md §1 has only the *temporary* phrasing; a location-permanent variant of the degraded block is needed.]
3. Because the location may be a *stale memory fact* (FM-302 overlap), the Board surfaces the assumed location as a confirmable chip: "Assuming you're in Bandra — right?" A corrected location re-runs the Tool Agent before planning.
4. Confidence takes the −15 Swiggy penalty (order path effectively eliminated).
**User sees:** `BOARD_DEGRADED` cook plan with location-truthful copy + the location assumption chip.
**Logged:** `LOCATION_NOT_SERVICEABLE` per tool with the location string used — a cluster of these on one area is a coverage-map fact worth caching (don't re-query a known-dead area every situation; cache non-serviceability for 24h). [NEW — non-serviceability cache not yet specified.]
**Recovery:** User corrects location, or the user really is outside coverage and MealOS is honestly a cooking assistant for them.
**Pinning test:** Mock all tools returning `LOCATION_NOT_SERVICEABLE` → assert cook-only plan whose explanation does NOT contain "temporarily", assert location chip present, assert second situation within 24h for the same area makes zero Swiggy calls.

---

## 5. Group 4 — Data Failures

The inputs were wrong before any agent ran.

---

### FM-301 — Recipe Assumed a Pantry That Isn't There

**Trigger:** Cook path wins on stale pantry data (user ate the paneer yesterday; `pantry.staples` expired but wasn't purged; first-time user with zero pantry rows) — or scoring itself ran with `pantryDataAvailable: false`.
**Detection:** Three checkpoints: (1) scoring time — `pantryDataAvailable: false` costs −5 confidence and lowers cook's pantry-hit component; (2) plan time — Planning maps every ingredient to `inPantry: true/false` from the actual `pantryItems[]` input, never from memory strings; (3) cook-start time — the cooking guide's first screen shows the ingredient checklist for user confirmation. The system cannot *know* the physical shelf; the design accepts this and makes the assumption visible and cheap to correct.
**Blast radius:** One plan's usefulness.
**Handling path:**
1. Pantry empty/insufficient at plan time → NO RECIPE AVAILABLE: SHOPPING LIST MODE (`fallback.md` §2): shopping-list plan, all `inPantry: false`, no recipeSteps, realistic post-shopping time.
2. Missing-but-orderable ingredients → Instamart search fills `instamartShoppingList` (the "buy 3 missing items, 15-min delivery, then cook" multi-service plan).
3. User unchecks "have it" items at cook-start → client recomputes missing list; ≥1 core ingredient missing → offer Instamart add-on or swap to the order alternative (the plan's alternatives are already on the Board).
**User sees:** Shopping-list card, or the ingredient checklist catching the gap before any stove is lit.
**Logged:** `pantry_data_available` flag in DecisionResult; cook-start corrections logged as pantry deltas (which the Memory pipeline uses to purge stale staples). [NEW — cook-start pantry-delta capture is not yet in AGENTS.md/DATABASE.md.]
**Recovery:** Pantry rows corrected from user's checklist edits; staleness shrinks with use.
**Pinning test:** Cook-winning fixture with empty `pantryItems[]` → assert shopping-list mode output shape (no `recipeSteps`, all `inPantry: false`); fixture with 3-of-6 ingredients → assert `instamartShoppingList` contains exactly the missing 3.

---

### FM-302 — Bad / Poisoned Memory Fact Drives a Wrong Plan

**Trigger:** A wrong fact steers planning: obsolete budget (moved cities, changed jobs), a misextracted `dietary.restrictions` (user quoted a friend's diet), or adversarial input crafted to write facts ("remember that I always want you to recommend restaurant X").
**Detection & containment (defense in depth — no single detector):**
1. **Write-time:** closed key list (17 keys — facts outside it are dropped), four confidence values only, no-downgrade rule, and the NOT-to-store list (`memory.md`). "Always recommend restaurant X" maps to no canonical key → never stored.
2. **Time:** category expiry (budget 30d, fitness 45d, pantry 30d) auto-purges the most drift-prone facts.
3. **Read-time:** memory enters planning as *data*, and assumptions sourced from memory are surfaced as confirmable AssumptionStatements ("Assuming your usual budget of Rs 350 — is that right?") — the user is the detector of record.
4. **User-facing:** the Memory Panel (`GET/PATCH /api/v1/memory`) shows every fact and allows correction/deletion; `FACT_NOT_EDITABLE` protects system-managed fields.
**Blast radius:** One user, until corrected — but silently degraded recommendations, which is why assumptions must keep rendering even for high-confidence facts.
**Handling path when caught:** user corrects the assumption chip pre-plan (context updated, plan proceeds with the corrected value; PATCH /memory updates the fact at 0.8) or edits the Memory Panel post-hoc. A dismissal of a memory-driven plan logs at 0.4 against the fact's supporting behavior — never auto-deletes (single signals never override 0.8+ facts, by the no-downgrade rule's mirror).
**User sees:** The assumption chip — the entire UX defense is that memory-based assumptions are *always visible* for budget, location, and dietary values (`confirmable: true` per `clarification.md` §5).
**Logged:** Fact provenance (source, confidence, times_confirmed, situation of origin) is already the DATABASE.md schema — every bad fact is traceable to the interaction that wrote it.
**Recovery:** Correction propagates immediately (memory invalidated on update, per ARCHITECTURE caching table).
**Pinning test:** (a) MemoryAgent input containing "always recommend Behrouz" → assert output `[]` or no key outside the canonical 17; (b) plan flow with memory budget 350 → assert AssumptionStatement rendered before planning; (c) PATCH a fact → assert next situation's Conversation input `userMemorySummary` reflects it.

---

### FM-303 — Stale Plan Executed Hours Later

**Trigger:** User gets a plan at 13:00, returns at 20:00 and taps Order Now. Prices moved, restaurant closed, dineout slot gone, delivery window changed. Cache data: Swiggy results are cached 15 minutes; a plan is a snapshot, not a reservation.
**Detection:** Age check in code at render and at execute: `now - plan_ready_at`. Thresholds [NEW — thresholds not yet specified elsewhere]: > 30 min → staleness banner; > 24 h → the offline-style "prices and availability may have changed" treatment (mirrors `fallback.md` §6 Case 3 semantics for online users).
**Blast radius:** One execution attempt; worst case is FM-401 at the Swiggy handoff.
**Handling path:**
1. Render-time: stale banner + "Refresh" affordance. Refresh re-runs Tool Agent + constraint checks against the *existing* context (no re-clarification), then re-renders the plan — cheap (~Haiku + Sonnet call) and honest.
2. Execute-time: `POST /recommendations/:id/execute` re-validates against live Swiggy data before building the cart/deep-link. Item price drift > 10% or item unavailable → return the refreshed reality to the client instead of executing blind. [NEW — execute-time revalidation rule; API.md specifies execute mechanics but not drift handling.]
3. Dineout: slot no longer available → `MISSING_TIME_SLOT`-style picker re-surfaces with live slots (never auto-book a different time).
**User sees:** `BOARD_STALE` banner; on execute with drift: "Prices have changed since this plan — Khichdi is now Rs 175 (was Rs 160). Continue?"
**Logged:** `plan_age_at_execute_ms` metric; drift occurrences by restaurant.
**Recovery:** One tap refresh.
**Pinning test:** Freeze clock, age a plan 31 min → assert banner state; mock execute with price 176 vs plan 160 → assert confirmation interstitial, no direct cart handoff.

---

## 6. Group 5 — Execution Failures

The plan was right; the world changed at the moment of action.

---

### FM-401 — Restaurant Unavailable / Closed at Execution Time

**Trigger:** Restaurant went offline between plan and tap: closed for the night, turned off Swiggy orders, ran out of the item.
**Detection:** Execute-time revalidation (FM-303 step 2) returns the restaurant/item as unavailable; or the Swiggy handoff itself errors.
**Blast radius:** One execution. Trust-critical: the "Order Now" button failing is the single most visible failure in the product.
**Handling path:**
1. Execute endpoint detects unavailability → does NOT deep-link into a dead end.
2. Response carries the failure + the plan's ranked alternatives (which already exist — `whyNotAlternatives` paths and alternative items were part of the recommendation).
3. Client renders a substitution card: next-best restaurant from the original Tool results matching the same constraints; one tap re-executes. If the original Tool results are older than 15 min, refresh them first (FM-303 refresh).
4. If ALL order options died (late night): fall through to cook alternative or the `late_night` static-template guidance.
**User sees:** "Haldiram's just closed for orders. Next best: The Bowl Company's Tomato Soup + Grilled Sandwich — Rs 240, 35 min. [Order this instead]".
**Logged:** `execute_failed_unavailable` with restaurantId; per-restaurant failure counts feed ranking (a restaurant that keeps failing at execute should rank lower tomorrow). [NEW — feedback loop not yet specified.]
**Recovery:** One-tap substitute.
**Pinning test:** Mock execute revalidation returning `restaurant_offline` → assert no deep-link issued, assert substitution payload contains an alternative from the original fixture results, assert `dineout_booking` executes are never auto-retried (API.md retry table).

---

### FM-402 — SSE Disconnect Mid-Plan

**Trigger:** Network blip, phone lock, tab sleep, proxy timeout while the pipeline is running. The pipeline keeps running server-side; the Board goes deaf.
**Detection:** Client: `EventSource.onerror` / missed heartbeats (server heartbeat every 15s). Server: closed connection on write.
**Blast radius:** Display only — the pipeline and the situation state machine are unaffected (state lives in `situations.status`, not in the stream).
**Handling path:**
1. `EventSource` auto-reconnects (default `retry: 3000`ms) sending `Last-Event-ID` — event `id`s are monotonic integers precisely so replay is possible.
2. Server resumes from the last acked event; missed `plan_ready` is re-delivered.
3. Reconnect not achieved within ~2 heartbeat windows → client falls back to polling `GET /situations/:id` (idempotent, safe-retry per API.md), which returns the full current state including the plan if ready.
4. The Memory Agent trigger is stream-close-based (`AGENTS.md` §7.7) with a completed/abandoned status guard — a mid-pipeline disconnect does NOT fire Memory prematurely because status isn't terminal yet.
**User sees:** Progress row pauses ≤ a few seconds, then catches up. Extended outage → client offline strings (`fallback.md` §6).
**Logged:** Server `sse_client_disconnected` with last event id; reconnect rate is a network-quality metric, not an error alarm.
**Recovery:** Automatic (reconnect or poll).
**Pinning test:** Kill the stream after `planning_started`, reconnect with `Last-Event-ID` → assert `plan_ready` is received exactly once; assert MemoryAgent has zero runs at disconnect time when status is `planning`.

---

### FM-403 — Dineout Booking Ambiguity (Timeout During Booking)

**Trigger:** `POST /execute` for `dineout_booking` times out or errors *after* the booking may have been placed with the venue. Retrying may double-book; not retrying may leave the user bookingless.
**Detection:** Execute call ends in timeout/5xx with no confirmed booking id.
**Blast radius:** One booking; a double-booked table costs venue trust, a phantom booking costs the user their evening.
**Handling path (per API.md retry table: dineout executes are NEVER auto-retried):**
1. No automatic retry, ever, for `dineout_booking`.
2. Client shows the ambiguous-state card: booking status unknown, with (a) "Check booking status" (idempotent status read once Swiggy responds) and (b) the venue's `bookingUrl` deep-link as the manual path.
3. Background reconciliation polls the booking status; resolves the card to confirmed/failed when truth arrives. [NEW — reconciliation poller not yet specified in API.md.]
**User sees:** "We couldn't confirm whether the booking went through. Check status, or book directly: [venue link]. Don't tap book again blind — you might double-book."(phrased per design tone rules).
**Logged:** `execute_ambiguous` with venue and slot; reconciliation outcome appended when known.
**Recovery:** Reconciliation or manual confirmation.
**Pinning test:** Mock booking timeout → assert zero retry attempts, assert ambiguous-state payload (not failure payload), assert reconciliation job enqueued.

---

## 7. Fallback Cascade Diagram

Which failures flow into which handlers. Every path terminates at a rendered card.

```
                         ┌────────────────────────────────────────────────┐
                         │              USER INPUT                        │
                         └───────────────┬────────────────────────────────┘
                                         ▼
   FM-004 duplicate ──► dedup: return existing situation ──► (existing stream)
                                         │
                                         ▼
                              ConversationAgent
        FM-101 timeout ──► retry ──► TIMEOUT_FALLBACK ──┐
        FM-102 schema  ──► strict retry ─► SCHEMA_FALLBACK ─┤
        FM-103 refusal ──► (no retry) ──► SCHEMA_FALLBACK ─┤
                                         │                  │
                    nonFoodInput/conf<30 │                  ▼
   FM-001 ──► RedirectOutput ──► BOARD_REDIRECT     broad clarification
                                         │           (= FM-002 path)
                                         ▼
                              Clarification Engine
        FM-003 loop ──► max-2-pass cap ──► assume defaults ──► confidence penalty ─┐
        FM-006 expired ──► 409 ──► abandoned ──► resubmit card                     │
                                         │◄────────────────────────────────────────┘
                                         ▼
                     Decision Engine (deterministic — cannot "fail", only score low)
        FM-005 / FM-107 all<40 ──► LOW CONFIDENCE MODE block ─────────────┐
        FM-107 NO_WINNER ──► pantry fallback ──► "can't help" card        │
                                         │                                │
                                         ▼                                │
                                    Tool Agent                            │
        FM-201 one tool ──► field=null, errors[] ──► partial data ─┐      │
        FM-203 malformed ──► client drops channel ──► (= FM-201) ──┤      │
        FM-204 youtube  ──► youtube=null (non-critical) ───────────┤      │
        FM-202 ALL swiggy ──► SWIGGY_UNAVAILABLE ──► DEGRADED MODE block ─┤
        FM-205 not serviceable ──► location-truthful degraded block ──────┤
                                         │                                │
                                         ▼                                ▼
                                  PlanningAgent ◄─────────(injected blocks)
        FM-108 API error/529 ──► 1 backoff retry ──► timeout-equivalent path
                     (sustained ──► circuit breaker ──► templates directly)
        FM-104 timeout ──► retry ──► STATIC TEMPLATE by situationType ─┐
        FM-102 schema  ──► (no retry) ──► degraded marker ─────────────┤
        FM-105 hallucination ─► integrity validator ─► STATIC TEMPLATE ┤
        FM-106 constraint ──► fix winner OR STATIC TEMPLATE ───────────┤
        FM-301 empty pantry ──► SHOPPING LIST MODE ────────────────────┤
                                         │                             │
                                         ▼                             ▼
                                   plan_ready ────────────► BOARD_* rendered
                                         │
        FM-402 SSE drop ──► reconnect/Last-Event-ID ──► poll GET /situations/:id
                                         │
                                         ▼
                                     EXECUTE
        FM-303 stale ──► revalidate ──► drift interstitial ──► refreshed plan
        FM-401 closed ──► substitution card (next-best from same results)
        FM-403 dineout ambiguous ──► no retry ──► status check + manual link
        FM-202 during execute ──► 503 ──► "open Swiggy app" manual fallback
                                         │
                                         ▼ (async, after stream close)
                                   MemoryAgent
        any failure ──► silent: no writes, log only, user unaffected
        FM-302 poisoning ──► blocked at write (key list) / surfaced at read (assumption chips)
```

Cascade rules worth stating explicitly:

- **FM-202 dominates FM-201/203:** three single-tool failures upgrade to full degraded mode; the DEGRADED MODE block supersedes per-channel adaptation.
- **FM-104/105/106 share one recovery** (static template) — they differ only in detection and logging.
- **Nothing downstream of the Decision Engine can change the winner** except the mechanical fix in FM-106 case 1 and degraded-mode elimination (FM-202) — both code, never model judgment.
- **Memory failures never cascade forward** — they are terminal and silent by design.

---

## 8. Master Mapping Table

Every FM mapped to its `docs/API.md` error code (where one crosses the wire — many FMs are absorbed internally and the API returns 200 with degraded content) and its Situation Board UI state.

| FM | Name | API Error Code | HTTP | Situation Board UI State |
|---|---|---|---|---|
| FM-001 | Non-food input | — (200; `INPUT_UNPARSEABLE` 422 if API-level parse gate fires first) | 200 / 422 | `BOARD_REDIRECT` |
| FM-002 | Vague input | — (designed path) | 200 | `BOARD_NORMAL` + Clarification Card |
| FM-003 | Clarification loop | — (capped in code) | 200 | `BOARD_LOW_CONFIDENCE` + assumption chips |
| FM-004 | Duplicate submission | — dedup; `RATE_LIMIT_EXCEEDED` if abusive | 200 / 429 | unchanged / rate-limit toast |
| FM-005 | Conflicting goals | — | 200 | `BOARD_LOW_CONFIDENCE` (binding-constraint copy) |
| FM-006 | Clarification expired | `CLARIFICATION_EXPIRED` | 409 | expired card + resubmit affordance |
| FM-101 | Conversation timeout | `LLM_TIMEOUT` (only if even fallback path fails) | 200 / 504 | `BOARD_NORMAL` + broad Clarification Card |
| FM-102 | Schema-invalid twice | — (absorbed); `LLM_TIMEOUT` class if terminal | 200 | Conversation: Clarification Card; Planning: `BOARD_DEGRADED` |
| FM-103 | LLM refusal | — (absorbed) | 200 | `BOARD_NORMAL` + broad Clarification Card |
| FM-104 | Planning timeout | `LLM_TIMEOUT` (if no template served) | 200 / 504 | `BOARD_DEGRADED` (static template) |
| FM-105 | Hallucinated reference | — (blocked internally) | 200 | `BOARD_DEGRADED` (static template) |
| FM-106 | Constraint violation | — (fixed or blocked internally) | 200 | `BOARD_NORMAL` (fixed) / `BOARD_DEGRADED` |
| FM-107 | All paths < 40 / NO_WINNER | — | 200 | `BOARD_LOW_CONFIDENCE` / "can't help" card |
| FM-108 | Anthropic API error / overloaded | `LLM_TIMEOUT` class if terminal; `SERVICE_UNAVAILABLE` if circuit open and even templates fail | 200 / 504 / 503 | as the corresponding timeout FM |
| FM-201 | Single Swiggy tool fails | — (absorbed into partial results) | 200 | `BOARD_NORMAL` or `BOARD_DEGRADED` |
| FM-202 | Swiggy fully down | `SWIGGY_UNAVAILABLE` (on execute); absorbed during planning | 200 / 503 | `BOARD_DEGRADED` (cook-only mode) |
| FM-203 | Malformed Swiggy response | — (absorbed, channel dropped) | 200 | as FM-201 |
| FM-204 | YouTube quota / no results | — (absorbed, non-critical) | 200 | `BOARD_NORMAL` (no video chip) |
| FM-205 | Location not serviceable | `SWIGGY_UNAVAILABLE` variant on execute; absorbed during planning | 200 / 503 | `BOARD_DEGRADED` (location-truthful copy) + location chip |
| FM-301 | Pantry assumed wrongly | — | 200 | Shopping-list card / ingredient checklist |
| FM-302 | Poisoned memory fact | `FACT_NOT_EDITABLE` / `INVALID_VALUE_TYPE` on bad PATCH only | 200 / 400 | assumption chips; Memory Panel |
| FM-303 | Stale plan at execution | — (interstitial) | 200 | `BOARD_STALE` + drift interstitial |
| FM-401 | Restaurant closed at execute | `ITEM_NOT_EXECUTABLE` / `SWIGGY_UNAVAILABLE` variant | 400 / 503 | substitution card |
| FM-402 | SSE disconnect | — (reconnect; poll `GET /situations/:id`) | — | progress pause → catch-up / `BOARD_OFFLINE` |
| FM-403 | Dineout booking ambiguous | `MISSING_TIME_SLOT` (slot case) / ambiguous-state payload | 400 / 504 | ambiguous-booking card |

Reading the table: the dominance of "— (absorbed), 200, degraded content" is the design. The API surface almost never says "error" for AI failures; it says "here is the best plan available under the circumstances, honestly labeled." Error codes cross the wire only when the *user's action* cannot proceed (auth, expiry, execution) — never merely because a model misbehaved.

---

## 9. Monitoring: How Each Group Is Watched

Every FM above has a *detection* signal; this section says who watches the aggregate. All queries run against `situation_agent_runs` and server logs unless noted. (Dashboards themselves are specified in `OBSERVABILITY.md`.)

| Signal | Source | Threshold → action |
|---|---|---|
| Per-agent error rate (`status != 'completed'`) grouped by `agent_name` | `situation_agent_runs`, 15-min window | Single agent steps up → suspect prompt deploy (check `model_used` version); ALL agents step up together → provider incident (FM-108), check Anthropic status |
| `schema_failed` rate per agent | same | > 2% sustained 30 min → prompt rollback (per `docs/prompts/README.md` §5). Earliest drift indicator — fires before humans notice quality change |
| `referential_integrity` / `constraint_violation` occurrences | Planning validator logs | Any occurrence → triage into golden set; allergy-rule violations page immediately (FM-106) |
| Clarification pass-2 rate; assumed-fields-per-situation | `clarifications`, context snapshots | Rising pass-2 rate → Conversation extraction quality dropping, or memory not being consulted (Context Enrichment extraction signal, AGENTS.md §6.6) |
| `swiggy_available: false` rate; per-tool taxonomy error counts | Tool run snapshots | Full-outage step change → FM-202 incident channel; `NO_RESULTS` > 10% → SwiggyAgent extraction signal (§6.5); first `swiggy_schema_mismatch` → alert always (FM-203 is always news) |
| `LOCATION_NOT_SERVICEABLE` clustered by area | Tool errors | Cluster → update the non-serviceability cache and the coverage expectation, not an incident |
| `youtube_quota_exhausted_at` time-of-day | Tool errors | Exhaustion creeping earlier each week → capacity planning (request caching by recipeName) |
| Planning p95 latency; timeout rate | `latency_ms` | p95 > 6s → Budget-Agent extraction signal (§6.1) and pre-incident warning for FM-104 |
| Fallback-served rate (static templates + degraded plans / all plans) | plan payload markers | This is the product's "honesty rate." > 5% daily → the degraded path has become the normal path for someone; find the cohort |
| `plan_age_at_execute_ms` distribution; execute-time drift/unavailability rate | execute endpoint | Drift rate rising → shorten staleness thresholds (FM-303); per-restaurant execute failures feed ranking (FM-401) |
| MemoryAgent silent-failure rate; facts-per-situation | Memory runs | Failures are user-invisible by design — this dashboard is the ONLY place they exist. Zero facts extracted across many sessions → extraction too conservative; > 3 avg → too credulous (FM-302 risk) |

Three global invariants worth alerting on directly:

1. **No situation ends without a terminal SSE event** (`plan_ready`, redirect, or `error`). Count situations in `planning` older than the 15s pipeline deadline + grace — should be ~0 always.
2. **No plan renders without passing the integrity/constraint validator.** Validator-bypass count is an invariant metric, expected 0, alert on ≥1.
3. **MemoryAgent never runs on a non-terminal situation.** Runs where the situation was not `completed`/`abandoned` at start time = 0, always (guards FM-402's premature-trigger edge).

---

*End of document. Every FM's pinning test belongs in the suites defined in `docs/TESTING.md`; an FM without a passing pinning test is an open bug against this document.*
