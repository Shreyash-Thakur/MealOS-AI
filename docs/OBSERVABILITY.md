# MealOS AI — Observability Specification

**Project:** MealOS AI
**Last Updated:** 2026-07-07
**Status:** Authoritative reference for metrics, logs, traces, errors, dashboards, health checks, and alerts. A developer instrumenting any service must use the exact metric names and log fields defined here.
**Related files:** `docs/AGENTS.md` (§1.4 agent observability, §7 orchestrator), `docs/API.md` (error code reference, health endpoint), `docs/COST_OPTIMIZATION.md` (cost guardrails that alert through this system), `docs/DATABASE.md` (`situation_agent_runs` table)

**Stack:** Sentry (errors), Axiom (structured logs), Vercel Analytics (web vitals), OpenTelemetry SDK (traces + metrics, OTLP export to Axiom), PostgreSQL (`situation_agent_runs` as the durable agent audit trail).

---

## Table of Contents

1. [Principles](#1-principles)
2. [Metrics](#2-metrics)
3. [Structured Logs](#3-structured-logs)
4. [Tracing](#4-tracing)
5. [Dashboards](#5-dashboards)
6. [Error Tracking](#6-error-tracking)
7. [Alerts](#7-alerts)
8. [Health Endpoints](#8-health-endpoints)
9. [The Agent-Run Audit Trail](#9-the-agent-run-audit-trail)

---

## 1. Principles

1. **One situation = one trace.** Every pipeline artifact (log line, span, metric sample, Sentry event, agent-run row) carries `situation_id`. Given a user complaint, one query reconstructs everything.
2. **The database is the durable truth; telemetry is the fast view.** `situation_agent_runs` survives retention windows; Axiom/OTel data is for speed, not compliance.
3. **Metrics are cheap, cardinality is not.** No `user_id`, `situation_id`, or free text in metric labels — those belong in logs and traces. Label values come from closed enums only.
4. **PII never leaves the database.** Raw input, memory facts, and addresses appear in logs only as hashes or lengths (see §3.4).
5. **Every alert has a runbook line.** An alert that doesn't tell the on-call what to do first is noise.

---

## 2. Metrics

Prefix: `mealos_`. Types: `C` counter, `H` histogram, `G` gauge. All histograms in milliseconds unless noted.

### 2.1 Situation Funnel

State machine source: `docs/AGENTS.md` §7.2 (`created → intent_extracted → clarifying → context_ready → planning → plan_ready → executing → completed | abandoned`).

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `mealos_situations_created_total` | C | `entry` (text\|voice\|template) | Funnel top |
| `mealos_situations_state_transitions_total` | C | `from_state`, `to_state` | Every transition; funnel = ratios between totals |
| `mealos_situations_completed_total` | C | `situation_type`, `executed_path` (cook\|order\|dineout) | Funnel bottom |
| `mealos_situations_abandoned_total` | C | `situation_type`, `last_state` | `last_state` shows *where* users drop |
| `mealos_situation_e2e_duration_ms` | H | `situation_type`, `clarified` (true\|false) | Created → plan_ready wall clock; excludes user think-time during clarification (subtract `clarifying` dwell) |
| `mealos_non_food_redirects_total` | C | — | `nonFoodInput` detections |

**Derived funnel (dashboard queries, not stored):** clarification rate = transitions into `clarifying` / created; plan rate = `plan_ready` / created; execution rate = `executing` / `plan_ready`; abandonment by stage = abandoned{last_state=X} / entries into X.

### 2.2 Agents

One set of series per agent via the `agent` label (`conversation` | `planning` | `tool` | `memory` — matches `agent_name` in `situation_agent_runs`).

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `mealos_agent_runs_total` | C | `agent`, `model`, `status` (completed\|failed\|timeout\|schema_failed\|degraded) | Status enum from `docs/AGENTS.md` §1.1 |
| `mealos_agent_latency_ms` | H | `agent`, `model` | Buckets: 100, 250, 500, 1000, 2000, 4000, 8000, 15000 |
| `mealos_agent_input_tokens` | H | `agent`, `model` | From Anthropic `usage` |
| `mealos_agent_output_tokens` | H | `agent`, `model` | Watch vs `max_tokens` cap (§1.5 rule: raise cap if >5% of runs approach it) |
| `mealos_agent_cost_usd_total` | C | `agent`, `model` | Computed at run-log time from token counts × pricing table |
| `mealos_agent_retries_total` | C | `agent`, `trigger` (timeout\|schema_invalid\|api_error) | attempts−1 per run |
| `mealos_agent_fallbacks_total` | C | `agent`, `fallback_kind` (timeout\|schema\|refusal) | Fallback output served |
| `mealos_agent_cache_read_tokens` | H | `agent` | Prompt-cache effectiveness (`docs/COST_OPTIMIZATION.md` lever 5) |
| `mealos_conversation_confidence` | H | `situation_type` | Buckets: 20, 40, 60, 80, 90, 100 |

### 2.3 Decision Engine

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `mealos_decision_score` | H | `path` (cook\|order\|dineout), `situation_type` | Score 0–100 distribution; drift = scoring-weight regression |
| `mealos_decision_winner_total` | C | `winner` (cook\|order\|dineout\|no_winner), `situation_type` | Winner mix; a sudden shift with no deploy = upstream data problem |
| `mealos_decision_margin` | H | `situation_type` | Winner minus runner-up; low margins correlate with dismissals |
| `mealos_decision_eliminations_total` | C | `path`, `reason` (cant_cook\|swiggy_down\|group_too_large\|no_budget_fit) | Path availability eliminations |
| `mealos_decision_duration_us` | H | — | Microseconds — must stay <5000 (the "<5ms, no LLM" contract) |

### 2.4 Clarification Engine

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `mealos_clarification_questions_count` | H | `situation_type` | Buckets: 0,1,2,3. **The memory-value metric** — should decline per returning user cohort |
| `mealos_clarification_passes_total` | C | `pass_number` (1\|2) | Max 2 per spec |
| `mealos_clarification_answered_total` | C | `situation_type` | vs asked = abandon ratio |
| `mealos_clarification_expired_total` | C | — | 5-min expiry hit (`CLARIFICATION_EXPIRED`) |
| `mealos_clarification_answer_latency_ms` | H | — | User think-time; informs expiry tuning |
| `mealos_memory_hit_total` | C | `outcome` (question_suppressed\|default_used\|no_memory) | Counts fields resolved from memory instead of asking |

### 2.5 Swiggy MCP + External Tools

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `mealos_tool_calls_total` | C | `tool` (swiggy_search_restaurants\|swiggy_search_instamart\|swiggy_search_dineout\|youtube_search_recipe), `outcome` (ok\|error\|timeout) | |
| `mealos_tool_latency_ms` | H | `tool` | Per-tool budgets: 3000/3000/4000/2000 (see `docs/AGENTS.md` §4.3) |
| `mealos_tool_errors_total` | C | `tool`, `error_code` (LOCATION_NOT_SERVICEABLE\|NO_RESULTS\|RATE_LIMITED\|SWIGGY_DOWN\|INSTAMART_DOWN\|DINEOUT_DOWN\|NO_AVAILABILITY\|QUOTA_EXCEEDED\|API_DOWN) | Codes from Tool Agent spec |
| `mealos_tool_no_results_ratio` | G | `tool` | 15-min rolling; >10% = SwiggyAgent extraction signal (§6.5) and Lever-1 watch metric |
| `mealos_swiggy_unavailable_total` | C | — | All-Swiggy-tools-failed events (`isDeadedMode` activations) |
| `mealos_swiggy_cache_hits_total` | C | `cache` (restaurants\|planning\|template) | Response-cache effectiveness |

### 2.6 SSE / API

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `mealos_sse_connections_active` | G | — | Concurrent streams |
| `mealos_sse_connection_duration_ms` | H | `close_reason` (plan_delivered\|client_drop\|timeout\|error) | Healthy p50 ≈ pipeline e2e |
| `mealos_sse_events_sent_total` | C | `event` (context_extracted\|clarification_needed\|context_ready\|plan_ready\|non_food_redirect\|error\|heartbeat) | Envelope from `docs/AGENTS.md` §7.4 |
| `mealos_sse_reconnects_total` | C | — | EventSource re-attach with Last-Event-ID |
| `mealos_api_requests_total` | C | `route`, `method`, `status_code` | Route = template, not raw path |
| `mealos_api_request_duration_ms` | H | `route`, `method` | |
| `mealos_api_rate_limited_total` | C | `route` | 429s |

### 2.7 Memory & Product Quality

| Metric | Type | Labels | Notes |
|---|---|---|---|
| `mealos_memory_facts_written_total` | C | `source` (user_stated\|clarification_answer\|behavior_inferred\|action_derived) | |
| `mealos_memory_facts_per_user` | H | — | Sampled daily; >50 avg = ContextEnrichmentAgent extraction signal |
| `mealos_plan_rating` | H | `situation_type`, `primary_path`, `plan_source` (sonnet\|haiku\|template\|cache) | 1–5 stars. `plan_source` is the quality gate for cost levers 9–10 |
| `mealos_plan_dismissed_total` | C | `situation_type`, `plan_source` | Primary recommendation dismissals |

---

## 3. Structured Logs

### 3.1 Base Schema

Every log line is one JSON object (Axiom-ingested). Required fields:

```json
{
  "ts": "2026-07-07T14:31:22.412Z",
  "level": "debug | info | warn | error",
  "msg": "planning_agent_completed",
  "service": "api | orchestrator | memory-worker",
  "env": "production | preview | development",
  "version": "1.4.2",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "situation_id": "uuid | null",
  "user_id_hash": "sha256, first 16 hex chars | null",
  "request_id": "uuid | null"
}
```

`msg` is a **stable snake_case event name**, never an interpolated sentence — dashboards and alerts key on it. Human context goes in event-specific fields.

### 3.2 Events Per Pipeline Stage

| Stage | Event name (`msg`) | Level | Extra fields |
|---|---|---|---|
| API ingress | `situation_created` | info | `entry`, `input_length`, `has_location` |
| Conversation Agent | `agent_run_completed` | info | `agent:"conversation"`, `status`, `latency_ms`, `input_tokens`, `output_tokens`, `attempts`, `confidence`, `situation_type` |
| Clarification | `clarification_issued` / `clarification_answered` / `clarification_expired` | info | `question_count`, `pass_number`, `fields[]` |
| Decision Engine | `decision_scored` | info | `cook_score`, `order_score`, `dineout_score`, `winner`, `margin`, `eliminations[]`, `duration_us` |
| Tool Agent | `tool_call_completed` (one per tool) + `agent_run_completed` | info | `tool`, `outcome`, `latency_ms`, `error_code?`, `result_count` |
| Planning Agent | `agent_run_completed` | info | `agent:"planning"`, `status`, `latency_ms`, tokens, `primary_path`, `confidence_level`, `plan_source` |
| SSE | `sse_opened` / `sse_event_sent` / `sse_closed` | debug (info for `sse_closed`) | `event`, `close_reason`, `duration_ms` |
| Execution | `recommendation_executed` | info | `service`, `item_rank`, `external_order_id?` |
| Memory Agent | `agent_run_completed` + `memory_facts_written` | info | `facts_count`, `sources[]`, `no_changes` |
| Any failure | `agent_run_failed`, `pipeline_degraded`, `pipeline_failed` | warn/error | `error_code`, `error_message`, `fallback_used` |

### 3.3 Levels and Sampling

| Level | Production policy |
|---|---|
| `debug` | Sampled 1% (100% when `MEALOS_DEBUG_SITUATION_IDS` contains the situation — targeted debugging of a live complaint) |
| `info` | 100% retained 30 days |
| `warn` | 100% retained 90 days |
| `error` | 100% retained 90 days + mirrored to Sentry |

### 3.4 Redaction Rules

| Data | Rule |
|---|---|
| Raw user input | **Never at info level.** Log `input_length` + `input_sha256` only. Full text lives in `situations.raw_input` (DB) and in `input_snapshot` (DB). Exception: `error`-level model-refusal events may include raw input for review, flagged `contains_pii: true` for Axiom field-level access control |
| Prompts / completions | Never in logs at any level — snapshots go to `situation_agent_runs` JSONB only |
| Addresses, lat/lng | Round coordinates to 2 decimals (~1km) in logs; full precision DB-only |
| Memory fact values | Log `fact_key` and value *type*, never the value (`dietary.allergies` values are health data) |
| `user_id` | Always the 16-char hash; join back via a restricted lookup, not in Axiom |
| Clerk JWTs, API keys | Static scrubber list in the log wrapper + Sentry `beforeSend`; CI test asserts scrubbing |

---

## 4. Tracing

### 4.1 Model

**One trace per situation**, rooted at `POST /api/v1/situations`. `trace_id` is stored on the situation row (`situations.trace_id` — add column in next migration) so support can jump from DB → Axiom trace view. W3C `traceparent` propagates across the API → orchestrator → memory-worker boundary; the clarification `POST /clarify` and execution `POST /execute` requests attach to the same trace via `traceparent` echoed to the client in the SSE `context_extracted` event payload (`data._trace`).

### 4.2 Span Tree

```
POST /api/v1/situations                          [SERVER span, root]
├── validate_and_persist                         (input validation, situations INSERT)
├── orchestrator.pipeline                        [pipeline root]
│   ├── memory.summary_fetch                     (Memory Service pre-read)
│   ├── agent.conversation                       [attrs: model, tokens, status, attempts]
│   │   └── anthropic.messages.create            (SDK auto-instrumented; retries = child spans)
│   ├── clarification.evaluate                   (deterministic gap analysis)
│   ├── clarification.wait                       [ends at /clarify POST; may span minutes — excluded from latency SLOs]
│   ├── parallel: ─────────────────────────────
│   │   ├── engine.score                         (<5ms; attrs: winner, margin)
│   │   └── agent.tool
│   │       ├── tool.swiggy_search_restaurants   [parallel]
│   │       ├── tool.swiggy_search_instamart     [parallel]
│   │       ├── tool.swiggy_search_dineout       [parallel]
│   │       └── tool.youtube_search_recipe       [parallel]
│   ├── agent.planning
│   │   └── anthropic.messages.create
│   └── sse.deliver                              (plan_ready emitted)
└── (async, same trace, follows-from link)
    └── agent.memory                             [memory-worker service]
        └── db.facts_upsert
```

**Span attributes (canonical):** `mealos.situation_id`, `mealos.situation_type`, `mealos.agent`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `mealos.status`, `mealos.plan_source`, `mealos.error_code`.

### 4.3 SSE Propagation

The SSE stream itself is not a span (it outlives useful span duration). Instead: each emitted event records a span event on `orchestrator.pipeline` (`sse.event: plan_ready, id: 7`), and `sse_closed` logs the final `close_reason`. Client-side reconnects appear as new `GET /stream` SERVER spans linked to the root trace via `Last-Event-ID` → `situation_id` → `trace_id` lookup.

### 4.4 Sampling

Head sampling 100% at V1 volume (<50k traces/day is cheap). Above that: tail-based — always keep traces with `error`, `status != completed`, e2e >10s, or `plan_source != sonnet` during cost-lever rollouts; sample 10% of the healthy remainder.

---

## 5. Dashboards

Five dashboards. Panel = metric + breakdown.

### 5.1 Ops (on-call home)

- Situation throughput (`situations_created_total` rate, by `entry`)
- E2E latency p50/p95 (`situation_e2e_duration_ms`, split `clarified`)
- Pipeline status mix (`plan_ready` vs `degraded` vs `failed` — from `pipeline_status`)
- Per-agent p95 latency vs timeout budget (4 series + budget lines 3000/6000/8000ms)
- Agent status heatmap (`agent_runs_total` by `agent` × `status`)
- SSE active connections + close-reason mix
- API 5xx/4xx rate by route; 429 rate
- `swiggy_unavailable_total` (deaded-mode events)

### 5.2 Agent Quality

- Conversation confidence distribution by `situation_type`
- Schema-failure ratio per agent (the 2% deploy gate from `docs/prompts/README.md` §5)
- Retry + fallback rates by agent and trigger
- Output tokens vs `max_tokens` cap proximity (the §1.5 5% rule)
- Decision winner mix over time; score distributions per path; margin histogram
- Clarification questions per situation (target: cohort-declining) + memory hit outcomes
- `plan_rating` by `plan_source` and `situation_type` (cost-lever quality gates)
- Prompt version overlay (deploy markers) on every panel

### 5.3 Cost (see docs/COST_OPTIMIZATION.md §7.2)

- `agent_cost_usd_total` daily, stacked by agent (expect Planning ≈95% pre-optimization)
- Cost per situation (cost total / completed+abandoned)
- Token histograms per agent; cache-read ratio on static blocks
- Cache hit rates (restaurants / planning / template)
- `plan_source` mix (sonnet / haiku / template / cache) — the waterfall in production
- Per-user daily token p99 vs the 50k budget; budget-breach count
- Projected monthly spend vs cap (burn-rate line)

### 5.4 Product Funnel

- Full funnel: created → context_ready → plan_ready → executing → completed, as ratios
- Abandonment by `last_state` and by `situation_type`
- Clarification answer rate + expiry rate
- Executed-path mix vs Decision-Engine winner mix (do users follow the recommendation?)
- Dismissal rate by `plan_source`
- Ratings volume + average by path
- Returning-user clarification decline curve (memory ROI)

### 5.5 Swiggy Integration

- Calls, latency p95, and error rate per tool vs per-tool timeout budgets
- Error-code breakdown (`NO_RESULTS` vs `SWIGGY_DOWN` vs `RATE_LIMITED`…)
- `no_results_ratio` per tool with the 10% extraction-signal line
- Instamart found-ratio (fuzzy-match quality; Lever-1 synonym-table watch)
- Dineout availability yield (`NO_AVAILABILITY` ratio)
- YouTube quota consumption vs daily cap

---

## 6. Error Tracking

### 6.1 Sentry Conventions

- `environment`: production | preview | development; `release`: git SHA (Vercel-injected).
- **Fingerprinting:** group by `[error_code, agent_or_route]`, not stack — LLM pipeline errors share stacks but differ by meaning. E.g. `["LLM_TIMEOUT", "planning"]` vs `["LLM_TIMEOUT", "conversation"]` are separate issues.
- **Tags:** `situation_type`, `agent`, `error_code`, `plan_source`, `pipeline_status`. **Context (non-indexed):** `situation_id`, `trace_id` (deep link to Axiom).
- `beforeSend` scrubber: same redaction rules as §3.4 (raw input, JWTs, addresses, fact values).
- Memory Agent failures are **silent to users but not to Sentry** — they report with tag `user_impact: none` at `warning` level.

### 6.2 Severity Mapping (aligned to docs/API.md error codes)

| Severity | Error codes / conditions |
|---|---|
| `fatal` | `SERVICE_UNAVAILABLE` (DB down), unhandled exception in orchestrator |
| `error` | `AGENT_BOOTSTRAP_FAILED`, `LLM_TIMEOUT` after all retries, `pipeline_failed`, schema failure after retry, DB write failures in memory-worker |
| `warning` | `SWIGGY_UNAVAILABLE` (degraded mode works as designed), agent fallback served, `INPUT_UNPARSEABLE` spike, model refusal |
| `info` (not sent; log-only) | Expected 4xx: `INVALID_INPUT`, `CLARIFICATION_EXPIRED`, `RATE_LIMIT_EXCEEDED`, access-denied probes (unless spiking — see A11) |

---

## 7. Alerts

Channels: `#mealos-oncall` (page = PagerDuty + Slack), `#mealos-eng` (Slack only). All ratios on 15-minute rolling windows unless stated.

| # | Condition | Threshold | Severity | Channel | Runbook first move |
|---|---|---|---|---|---|
| A1 | Health endpoint `status != ok` | 3 consecutive checks (90s) | Page | oncall | Check `services` block → follow the down dependency (DB → Neon status; llm → Anthropic status) |
| A2 | Pipeline failure ratio (`pipeline_failed`/created) | >2% | Page | oncall | Ops dashboard → which agent's status heatmap is red; check last deploy marker |
| A3 | `agent_schema_failed` ratio, any agent | >2% (the deploy gate) | Page | oncall | Diff last prompt version; rollback per `docs/prompts/README.md` §5 |
| A4 | Planning p95 latency | >6s for 15 min | Slack | eng | Check Anthropic status + input-token histogram (context bloat); sustained breach is the BudgetAgent extraction signal per `docs/AGENTS.md` §6.1 |
| A5 | E2E p95 (unclarified) | >12s for 15 min | Page | oncall | Ops dashboard latency waterfall; usually Tool Agent — check Swiggy tool latencies |
| A6 | `swiggy_unavailable_total` | >5 in 5 min | Slack | eng | Verify MCP endpoint; confirm degraded mode banner is serving; escalate to Swiggy partner channel |
| A7 | `tool_no_results_ratio` | >10% for 30 min | Slack | eng | Query-template regression or Swiggy catalog issue; compare per-location |
| A8 | SSE `close_reason=error` ratio | >5% | Slack | eng | Check Vercel function duration limits + heartbeat delivery |
| A9 | Daily Claude spend | >1.5× trailing-7-day avg | Page | oncall | Cost dashboard → which agent; check for retry storm (`agent_retries_total`); kill switches in `docs/COST_OPTIMIZATION.md` §7.3 |
| A10 | Per-user token budget breaches | >20 users/hour | Slack | eng | Likely abuse or client retry loop — inspect top `user_id_hash` request patterns |
| A11 | 403 `*_ACCESS_DENIED` | >50/hour from any single user hash | Slack | eng | Potential enumeration probe; forward to security review |
| A12 | `plan_rating` avg, any `plan_source` | <3.5★ over 200+ ratings/day | Slack | eng | Quality-gate breach; revert the newest cost lever for that source |
| A13 | `abandoned{last_state=clarifying}` ratio | >25% | Slack | eng | Clarification UX regression — check question count distribution and expiry rate |
| A14 | Memory-worker failure ratio | >10% | Slack | eng | User-invisible but memory stops learning; check DB write errors and Batch API status |
| A15 | Decision Engine duration | p99 >5ms | Slack | eng | The deterministic contract is breached — profile recent scorer changes |

---

## 8. Health Endpoints

### 8.1 `GET /api/v1/health` (exists — spec in docs/API.md)

Shallow liveness + dependency summary. No auth, unlimited rate. Returns `status: ok | degraded`, per-service `ok|degraded|down` for `database`, `redis`, `llm`, `swiggy_mcp`; **503 only when the database is unreachable**. Each dependency check has a 500ms internal timeout. Uptime monitors (Vercel checks, BetterStack) poll this every 30s → feeds alert A1.

### 8.2 `GET /api/v1/health/deep` (add)

Authenticated (internal token header `X-Health-Token`), rate-limited 6/min. Runs real work, not just connectivity:

| Check | Verifies | Budget |
|---|---|---|
| `db_roundtrip` | `SELECT` on `situations` (index touch, not `SELECT 1`) | 300ms |
| `redis_roundtrip` | SET/GET/DEL on a probe key | 100ms |
| `llm_probe` | 1-token Haiku completion (cached prompt; costs ~$0.000001) | 2000ms |
| `swiggy_probe` | `swiggy_search_restaurants` with a fixed probe location, result count >0 | 3000ms |
| `queue_depth` | Memory-worker backlog < 1000 jobs | — |
| `migrations` | Prisma migration state matches build's expected head | — |

Returns per-check `{status, latency_ms, detail?}`. Used by CI post-deploy verification and the on-call, **not** by load balancers (too slow/expensive for LB cadence).

### 8.3 Platform Semantics

- **Vercel (V1):** no liveness/readiness distinction — serverless functions are per-request. `/health` exists for external monitors and CI gates. A failing deploy is caught by the post-deploy `health/deep` check in GitHub Actions; auto-rollback = re-promote previous deployment.
- **Railway/Fly memory-worker (when split out per ARCHITECTURE.md):** `/healthz` (liveness: process up, event-loop lag <1s) and `/readyz` (readiness: Redis + DB reachable, not draining). Restart on liveness failure; drain on readiness failure.
- **Degraded ≠ down:** `swiggy_mcp: down` keeps the app serving cook-path recommendations (deaded mode). Monitors must not page on `degraded` alone (A1 pages on `status != ok` only via consecutive-check dampening; A6 covers Swiggy specifically).

---

## 9. The Agent-Run Audit Trail

`situation_agent_runs` (schema in `docs/DATABASE.md`; write contract in `docs/AGENTS.md` §1.4) is the **durable, queryable record of every LLM interaction** — one row per run, success or failure, with `input_snapshot`/`output_snapshot` JSONB, token counts, latency, status, and error message.

**Division of labor:** metrics answer "is it broken?", traces answer "where?", logs answer "what happened around it?", and `situation_agent_runs` answers **"what exactly did the model see and say?"** — the only layer that can, since prompts/completions are barred from logs (§3.4).

Operational queries it must support (verify indexes: `(situation_id)`, `(agent_name, started_at)`, `(status, started_at)`):

```sql
-- Reconstruct a complained-about situation end to end
SELECT agent_name, status, latency_ms, input_tokens, output_tokens,
       error_message, started_at
FROM situation_agent_runs WHERE situation_id = $1 ORDER BY started_at;

-- Prompt-version regression check (30-min post-deploy gate, prompts/README §5)
SELECT agent_name, model_used,
       COUNT(*) FILTER (WHERE error_message IS NOT NULL)::float / COUNT(*) AS err_rate
FROM situation_agent_runs
WHERE started_at > NOW() - INTERVAL '30 minutes'
GROUP BY 1, 2;

-- Nightly cost rollup (feeds daily_cost_rollups, COST_OPTIMIZATION §7.2)
SELECT DATE(started_at), agent_name, model_used,
       SUM(input_tokens) AS in_tok, SUM(output_tokens) AS out_tok, COUNT(*)
FROM situation_agent_runs GROUP BY 1, 2, 3;
```

**Retention:** snapshots contain PII (raw input, memory) — retain full rows 90 days, then null the two snapshot columns and keep the numeric/status columns for 13 months of trend analysis. Deletion cascades from `situations` on user account deletion (GDPR/DPDP path).

**Consistency rule:** the row is written **once, at run end** (never partial rows mid-run); the in-flight state is visible via `situations.status` and the trace, not this table. If the process dies mid-run, the absent row + a `pipeline_failed` log is itself the signal.

---

*Document ends. Metric names are canonical — changes require a PR touching this file. Alert thresholds reviewed monthly against actuals. Cost guardrail integration: `docs/COST_OPTIMIZATION.md` §7.*
