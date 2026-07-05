# MealOS AI — Agent Specification

**Version:** 1.0  
**Status:** Authoritative implementation reference — do not implement without reading this document  
**Author:** MealOS AI Engineering  
**Date:** 2026-07-06

This document is the single source of truth for every agent in the MealOS AI pipeline. A developer reading only this document — without access to code, prompts, or any other reference — must be able to implement, test, monitor, and debug any agent described here.

---

## Table of Contents

1. [Agent Architecture Overview](#1-agent-architecture-overview)
2. [Conversation Agent](#2-conversation-agent)
3. [Planning Agent](#3-planning-agent)
4. [Tool Agent](#4-tool-agent)
5. [Memory Agent](#5-memory-agent)
6. [Future Agent Specs (Design Only)](#6-future-agent-specs-design-only)
7. [Agent Orchestrator](#7-agent-orchestrator)
8. [Cost Modeling](#8-cost-modeling)

---

## 1. Agent Architecture Overview

### 1.1 Base Agent Interface

Every agent in MealOS implements the following TypeScript interface. All four V1 agents and all six future agents conform to this contract.

```typescript
interface AgentConfig {
  /** Human-readable name used in logs and the situation_agent_runs table. */
  name: string

  /** Anthropic model ID. */
  model: 'claude-sonnet-4-6' | 'claude-haiku-4-5'

  /** Hard cap on output tokens. Prevents runaway generation. Enforced via API parameter. */
  maxOutputTokens: number

  /** Wall-clock timeout in milliseconds. If the API call does not resolve within this
   *  window, the call is aborted and the timeout failure path activates. */
  timeoutMs: number

  /** Retry configuration. Each agent defines its own policy because some agents
   *  are in the critical path (retry sparingly) and others are async (retry freely). */
  retryPolicy: {
    maxRetries: number
    backoffMs: number         // Base backoff. Actual wait = backoffMs * 2^attempt
    retryOn: RetryTrigger[]   // Which failure types trigger a retry
  }

  /** Structured fallback output returned when all retries are exhausted or a
   *  non-retriable failure occurs. Must conform to the agent's output type. */
  fallback: AgentOutput
}

type RetryTrigger = 'timeout' | 'schema_invalid' | 'api_error'

interface AgentRun<TInput, TOutput> {
  config: AgentConfig
  run(input: TInput): Promise<AgentRunResult<TOutput>>
}

interface AgentRunResult<TOutput> {
  output: TOutput
  status: 'completed' | 'failed' | 'timeout' | 'schema_failed' | 'degraded'
  latencyMs: number
  inputTokens: number
  outputTokens: number
  attempts: number         // 1 = succeeded on first try
  error?: string           // populated when status is not 'completed'
}
```

### 1.2 Common Patterns

#### Timeout Handling

Every agent call uses `Promise.race` between the Anthropic SDK call and a timeout sentinel:

```typescript
async function callWithTimeout<T>(
  apiCall: Promise<T>,
  timeoutMs: number
): Promise<T> {
  const sentinel = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('AGENT_TIMEOUT')), timeoutMs)
  )
  return Promise.race([apiCall, sentinel])
}
```

When the sentinel fires, the in-flight API call is abandoned (not cancelled — Anthropic SDK does not support cancellation). The agent activates its timeout failure path immediately.

#### Retry Logic

Retries are governed by the `retryPolicy` in each agent's config. The orchestrator calls `run()` once; retry logic lives inside the agent's `run()` method, not in the orchestrator.

```typescript
async function runWithRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  trigger: RetryTrigger
): Promise<T> {
  if (!policy.retryOn.includes(trigger)) throw new Error('non_retriable')
  for (let attempt = 0; attempt < policy.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === policy.maxRetries - 1) throw err
      await sleep(policy.backoffMs * Math.pow(2, attempt))
    }
  }
  throw new Error('max_retries_exceeded')
}
```

**Critical rule:** Schema validation errors (`schema_invalid`) are NOT retried by default for any agent except the Conversation Agent (which gets one retry with a stricter prompt). Retrying on schema errors tends to produce the same malformed output. Fail fast and use the fallback.

#### Structured Output Enforcement

Every agent that outputs JSON uses the following validation pattern:

```typescript
function parseAndValidate<T>(
  rawOutput: string,
  schema: ZodSchema<T>
): { success: true; data: T } | { success: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawOutput)
  } catch {
    return { success: false, error: 'json_parse_failed' }
  }
  const result = schema.safeParse(parsed)
  if (!result.success) {
    return { success: false, error: result.error.message }
  }
  return { success: true, data: result.data }
}
```

The Zod schema for each agent's output is the enforcement layer. Raw model output is never trusted without passing through this validator.

### 1.3 Agent Communication

**Agents do not call each other directly.** All agent coordination goes through the orchestrator.

The communication model:
1. Orchestrator calls Agent A
2. Orchestrator receives Agent A's typed output
3. Orchestrator prepares input for Agent B (may combine A's output with other data)
4. Orchestrator calls Agent B
5. Repeat until pipeline is complete

Agents have no awareness of each other. An agent receives inputs, produces outputs, and returns. This makes each agent independently testable and independently deployable.

### 1.4 Agent Observability

Every agent run — success or failure — writes one row to the `situation_agent_runs` table. This is the canonical source for debugging, cost tracking, and performance monitoring.

```typescript
// Written at the END of every agent run (not during)
interface AgentRunLog {
  situation_id: string            // UUID of the parent situation
  agent_name: string              // e.g. 'ConversationAgent'
  model_used: string              // exact Anthropic model string
  status: 'completed' | 'failed' | 'timeout' | 'schema_failed' | 'degraded'
  input_tokens: number            // from Anthropic usage response
  output_tokens: number           // from Anthropic usage response
  latency_ms: number              // wall clock from call start to parse completion
  input_snapshot: object          // the full input passed to the agent (JSONB)
  output_snapshot: object | null  // the parsed output, or null on failure
  error_message: string | null    // populated on non-completed status
  started_at: string              // ISO 8601 UTC
  completed_at: string            // ISO 8601 UTC
}
```

**Agent-specific additional fields** (stored in `output_snapshot` or indexed separately):
- `ConversationAgent`: `confidence_score`, `situation_type_detected`
- `PlanningAgent`: `primary_path_selected`, `confidence_level`
- `ToolAgent`: `tools_attempted[]`, `tools_succeeded[]`, `swiggy_available`
- `MemoryAgent`: `facts_extracted_count`, `no_changes`

### 1.5 Token Budget Management

Max tokens per agent are set as API parameters (`max_tokens` in the Anthropic SDK). This is the primary cost control lever.

| Agent | `max_tokens` | Rationale |
|---|---|---|
| ConversationAgent | 800 | SituationContext JSON is small; 800 is generous |
| PlanningAgent | 2000 | Full recommendation with recipe steps; 2000 is sufficient |
| ToolAgent | 1500 | Normalized API results; 1500 covers all tools |
| MemoryAgent | 600 | Small fact array; 600 is ample |

If an agent's output approaches its `max_tokens` limit more than 5% of the time (monitor via `output_tokens` in the log), the limit should be raised — not the prompt shortened.

---

## 2. Conversation Agent

### 2.1 Identity

| Property | Value |
|---|---|
| Name | `ConversationAgent` |
| File | `lib/agents/conversation.ts` |
| Model | `claude-haiku-4-5` |
| Max output tokens | 800 |
| Timeout | 3000ms |
| Retry policy | 2 retries max, 200ms base backoff, retry on `timeout` only |
| Runs | Synchronously, first in pipeline, blocks SSE |
| Prompt file | `docs/prompts/conversation.md` |

### 2.2 Responsibility

Convert raw user text into a structured `SituationContext`. This is the gateway to the entire pipeline — all downstream agents receive the output of this agent. Its speed is critical because nothing appears in the UI until this agent completes. The Confidence Card displayed to the user is derived directly from this agent's `confidence` field.

This agent does not recommend. It does not reason about food options. It classifies, extracts, and flags what is missing.

### 2.3 Full Input Specification

```typescript
interface ConversationAgentInput {
  /** Exactly what the user typed or spoke. Never pre-processed, cleaned, or trimmed.
   *  Maximum length: 500 characters. Longer inputs are truncated by the API layer before
   *  reaching this agent — the agent never receives more than 500 chars. */
  rawInput: string

  /** ISO 8601 datetime string in the user's local timezone.
   *  Example: "2026-07-05T19:45:00+05:30"
   *  Used to infer: timeOfDay (breakfast/lunch/dinner/latenight), isWeekend.
   *  The agent is given current_date, current_time, and day_of_week separately
   *  for prompt clarity — the ISO string is the source that generates these three values. */
  timestamp: string

  /** IANA timezone string. Example: "Asia/Kolkata"
   *  Used to correctly interpret the timestamp for local time of day. */
  userTimezone: string

  /** A brief natural-language summary of known facts about the user, generated by
   *  the Memory Service before this agent is called. Examples:
   *  - "Vegetarian, daily food budget Rs 350, home in Bandra, cooks at intermediate level"
   *  - null (first interaction — no memory exists)
   *  The agent uses this to avoid listing known facts in missingRequired. */
  userMemorySummary: string | null

  /** The situationType from the user's immediately preceding situation in this session.
   *  Used to resolve ambiguous follow-up inputs ("same thing", "that again", "no wait").
   *  null if this is the first situation in the session. */
  previousSituationType?: SituationType

  /** How many situations have been processed in this session (starts at 0).
   *  A high count (> 5) combined with short inputs may indicate user frustration.
   *  The agent uses this as context for generating broader fallback outputs. */
  sessionSituationCount: number
}
```

### 2.4 Full Output Specification

```typescript
type SituationType =
  | 'sick'           // unwell, fever, illness, recovery food
  | 'broke'          // budget is the primary stated constraint
  | 'date_planning'  // romantic occasion, date night
  | 'party_hosting'  // 3+ guests, hosting context
  | 'nutrition_goal' // explicit macro or calorie target stated
  | 'quick_meal'     // time is primary constraint, under 30 min
  | 'meal_prep'      // planning for multiple future meals
  | 'office_lunch'   // workplace context during work hours
  | 'family_dinner'  // household of 2–5, not a party
  | 'late_night'     // after 22:00 local time, or explicitly stated
  | 'general'        // no specific category — use as last resort

interface SituationContext {
  /** Classification of the primary situation type.
   *  Use exactly one value. Compound situations (sick AND broke) resolve to the
   *  dominant constraint — whichever drives the recommendation most. */
  situationType: SituationType

  /** Facts explicitly stated in the user's raw input.
   *  Do NOT populate from memory or inference — this object contains only what
   *  the user directly said in this message. */
  explicit: {
    /** true if user indicates illness. Set only if directly stated ("sick", "fever",
     *  "not feeling well", "unwell"). Do not infer from symptoms without naming them. */
    sick?: boolean

    /** Budget in INR (integer). Convert any form: "50 rupees" → 50, "₹200" → 200,
     *  "2k" → 2000, "fifty bucks" → 50. Always positive. */
    budget?: number

    /** true if user is dining/cooking alone. false if others are present. */
    alone?: boolean

    /** Whether the user can cook in this situation. false means either physically unable
     *  (sick, injured) or explicitly unwilling ("can't cook", "no energy to cook"). */
    canCook?: boolean

    /** Number of guests including the user. Minimum 2 for date_planning (assumed, never
     *  surfaced in missingRequired). Minimum 3 for party_hosting. */
    guests?: number

    /** The specific occasion, if named. Free text. Examples: "IPL final", "anniversary",
     *  "birthday party", "team lunch". Always in English (translate if non-English input). */
    occasion?: string

    /** Time constraint in integer minutes. Extract from: "I have 20 minutes" → 20,
     *  "half an hour" → 30, "quick" → null (vague, not extractable). */
    timeConstraintMinutes?: number

    /** What the user wants to eat, if stated. Free text. Keep it short and concrete.
     *  "biryani", "something light", "comfort food", "high protein". Always English. */
    craving?: string

    /** Explicit nutritional targets. Only populate if user states a number.
     *  "I need protein" is not a target. "150g protein" is a target. */
    nutritionGoal?: {
      protein?: number    // grams, integer
      calories?: number   // kcal, integer
    }

    /** Free text location if the user mentions where they are or where they want food.
     *  "I'm in Bandra", "near my office in BKC". Always English. */
    location?: string

    /** When the user needs the food solution.
     *  'now' = immediate (within the hour).
     *  'tonight' = same day, evening.
     *  'week' = planning horizon of days. */
    timeframe?: 'now' | 'tonight' | 'week'

    /** Indoor or outdoor preference for dineout situations. */
    indoorOutdoor?: 'indoor' | 'outdoor' | 'either'

    /** Any dietary note stated in this message. Free text, always English.
     *  "vegetarian", "no onion garlic", "gluten-free", "halal".
     *  Do not repeat what is already in userMemorySummary — only new information. */
    dietaryNote?: string
  }

  /** Facts the agent may compute from timestamp and day_of_week. These are the ONLY
   *  two fields the agent is permitted to populate via inference — everything else in
   *  the output must come from explicit user text. */
  inferred: {
    /** Meal period based on current_time in the user's timezone. */
    timeOfDay?: 'breakfast' | 'lunch' | 'dinner' | 'latenight'

    /** true if current_date falls on Saturday or Sunday in userTimezone. */
    isWeekend?: boolean
  }

  /** Overall confidence in the classification and extraction. Integer 0–100.
   *  80–100: clear, unambiguous situation type.
   *  60–79: plausible but some ambiguity (flag for clarification consideration).
   *  Below 60: use general type; the Clarification Engine will handle disambiguation. */
  confidence: number

  /** Field names that MUST be known to produce a recommendation for the detected
   *  situationType, and are absent from both the user's raw input and their memory.
   *  These drive the mandatory clarification questions. */
  missingRequired: string[]

  /** Field names that would meaningfully improve the recommendation but are not
   *  blocking. These may generate optional clarification questions if the required
   *  fields are already satisfied. */
  missingSoft: string[]

  /** Things the agent is uncertain about — ambiguities it resolved by choosing the
   *  higher-confidence interpretation. Used for debugging and prompt tuning.
   *  Example: "input could be 'sick' or 'tired' — chose sick due to 'fever' mention" */
  ambiguities: string[]

  /** true if the input is clearly unrelated to food, meals, or cooking.
   *  Examples that set this to true: "help me with my taxes", "write a poem about dogs".
   *  When true, the orchestrator activates the non-food redirect path and skips planning. */
  nonFoodInput: boolean
}
```

**Required fields by situation type:**

| Situation Type | Required Fields | Notes |
|---|---|---|
| `sick` | `canCook`, `alone` | Both determine cook vs. order routing |
| `broke` | `budget`, `canCook` | Budget confirms constraint severity |
| `date_planning` | `budget`, `indoorOutdoor` | `guests` assumed 2 — never ask |
| `party_hosting` | `guests`, `budget` | Both needed for multi-restaurant planning |
| `nutrition_goal` | `nutritionGoal.protein` OR `nutritionGoal.calories` | At least one target required |
| `quick_meal` | — | Time is implied; `craving` is soft |
| `meal_prep` | `timeframe` | Week vs. tonight determines scope |
| `office_lunch` | — | Location defaults to "office" |
| `family_dinner` | — | `alone` is false by definition; `guests` comes from memory |
| `late_night` | `canCook` | Determines delivery vs. fridge |
| `general` | — | No required fields; Clarification Engine handles |

### 2.5 Failure Modes and Handling

**Failure Mode 1: LLM Timeout (> 3000ms)**

The sentinel fires. The first call is abandoned.

- Retry once (attempt 2) with the same prompt and inputs.
- If the retry also times out: return the graceful timeout fallback immediately.
- Do not attempt a third call.

Timeout fallback:
```typescript
const TIMEOUT_FALLBACK: SituationContext = {
  situationType: 'general',
  explicit: {},
  inferred: {},
  confidence: 30,
  missingRequired: ['craving', 'budget', 'canCook'],
  missingSoft: [],
  ambiguities: ['agent_timeout'],
  nonFoodInput: false,
}
```

The log entry writes `status: 'timeout'`. The orchestrator proceeds with the timeout fallback — the Clarification Engine will ask broad questions.

**Failure Mode 2: Invalid JSON Output**

The `parseAndValidate` step fails. This means the model returned prose, partial JSON, or a markdown-wrapped response.

- Retry once with a stricter system prompt suffix: "Your previous response was not valid JSON. Output ONLY the raw JSON object starting with `{`. No markdown. No prose."
- If the retry also fails schema validation: activate the schema fallback.

Schema fallback:
```typescript
const SCHEMA_FALLBACK: SituationContext = {
  situationType: 'general',
  explicit: {},
  inferred: {},
  confidence: 20,
  missingRequired: ['craving', 'budget', 'canCook'],
  missingSoft: [],
  ambiguities: ['schema_failure'],
  nonFoodInput: false,
}
```

Log writes `status: 'schema_failed'`.

**Failure Mode 3: Model Refusal (Safety Filter)**

The Anthropic API returns a response with `stop_reason: 'max_tokens'` at token 0, or the content block is empty with a refusal message. This can occur on unusual food inputs (e.g., describing preparing raw meat in an explicit way).

- Do not retry (refusals are deterministic for the same input).
- Log the refusal reason and the raw input (for review).
- Return the schema fallback with `status: 'failed'` and `error_message: 'model_refusal'`.
- The orchestrator treats this as a low-confidence general situation.

**Failure Mode 4: Very Short Input**

Inputs of 1–3 characters ("k", "ok", "no", a single word with no context).

This is NOT a failure — the agent handles it correctly by returning `general` with low confidence and all planning fields in `missingRequired`. The Clarification Engine handles the actual gap-filling.

Expected output for "hungry" (1 word, no memory):
```json
{
  "situationType": "general",
  "explicit": {},
  "inferred": { "timeOfDay": "lunch", "isWeekend": false },
  "confidence": 40,
  "missingRequired": ["craving", "budget", "canCook"],
  "missingSoft": ["location", "alone"],
  "ambiguities": [],
  "nonFoodInput": false
}
```

**Failure Mode 5: Non-English Input**

Hindi, Tamil, Telugu, Bengali, and other Indian languages are supported. The agent:
1. Internally translates the input to English.
2. Extracts context from the translated meaning.
3. Populates all output fields in English.
4. Processes normally.

This is not a failure mode — it is expected behavior. The agent produces English-language output regardless of input language.

### 2.6 Observability Fields

Written to `situation_agent_runs` for every Conversation Agent run:

| Field | Source |
|---|---|
| `agent_name` | Hardcoded: `'ConversationAgent'` |
| `model_used` | From Anthropic response: `'claude-haiku-4-5'` |
| `input_tokens` | From Anthropic `usage.input_tokens` |
| `output_tokens` | From Anthropic `usage.output_tokens` |
| `latency_ms` | `Date.now()` delta from call start to parse complete |
| `status` | `'completed'` \| `'failed'` \| `'timeout'` \| `'schema_failed'` |
| `confidence_score` | Extracted from parsed output: `output.confidence` |
| `situation_type_detected` | Extracted from parsed output: `output.situationType` |

### 2.7 Cost Profile

| Metric | Value |
|---|---|
| Model | claude-haiku-4-5 |
| Average input tokens | ~300 (system prompt ~200, user message ~100) |
| Average output tokens | ~200 (SituationContext JSON) |
| Cost per call | ~$0.0003 at haiku-4-5 pricing |
| At 10k daily situations | ~$3/day |

### 2.8 Unit Test Hooks

These are the 5 behaviors that must be covered by automated tests before this agent ships:

1. **All required fields present.** Parse a valid output and assert that `situationType`, `explicit`, `inferred`, `confidence`, `missingRequired`, `missingSoft`, `ambiguities`, and `nonFoodInput` are all present in the parsed result.

2. **Confidence is always 0–100.** Feed 20 diverse inputs through the agent (or a mock). Assert `confidence >= 0 && confidence <= 100 && Number.isInteger(confidence)` for every response.

3. **Non-food input detection.** Input: `"help me with my taxes"`. Assert `nonFoodInput === true`. Input: `"I'm hungry"`. Assert `nonFoodInput === false`.

4. **missingRequired matches situation type.** For a `sick` situation with no memory and no explicit fields, assert `missingRequired` contains `'canCook'` and `'alone'`. For a `nutrition_goal` situation with `nutritionGoal.protein` set, assert `missingRequired` is empty.

5. **500-char input handled without truncation errors.** Pass a 500-character input string. Assert the agent returns a valid parsed `SituationContext` without throwing, and that `rawInput` is not truncated in the `input_snapshot` log.

---

## 3. Planning Agent

### 3.1 Identity

| Property | Value |
|---|---|
| Name | `PlanningAgent` |
| File | `lib/agents/planning.ts` |
| Model | `claude-sonnet-4-6` |
| Max output tokens | 2000 |
| Timeout | 8000ms |
| Retry policy | 1 retry on `timeout` only; no retry on `schema_invalid` (fail fast) |
| Runs | Synchronously, after Tool Agent completes, blocks SSE plan event |
| Prompt file | `docs/prompts/planning.md` |

### 3.2 Responsibility

The Planning Agent is the only agent that generates user-facing prose. It receives a complete, post-clarification `SituationContext`, pre-calculated path scores from the deterministic Decision Engine, and live data from the Tool Agent. Its job is to:

1. Identify the winning path from the pre-calculated scores.
2. Select the best specific option within that path.
3. Write the explanation (1–3 sentences, plain language, no jargon).
4. Fill the full recommendation schema.
5. Write one "why not" sentence per rejected path.

**Critical constraint:** This agent does NOT calculate scores. It does NOT override scores. Scores are computed by deterministic TypeScript code (`lib/engine/scorer.ts`) and passed in as `preCalculatedScores`. The system prompt explicitly instructs: "You receive pre-calculated scores. Do not recalculate. Do not second-guess the scores. Write the explanation only."

### 3.3 Full Input Specification

```typescript
interface PlanningAgentInput {
  /** Complete SituationContext output by ConversationAgent, merged with all
   *  clarification answers. All missingRequired fields should now be populated. */
  situationContext: SituationContext

  /** Full structured memory object for the user. */
  userMemory: {
    diet: string | null                   // 'vegetarian' | 'vegan' | 'non-vegetarian' | null
    budget: number | null                 // daily food budget INR
    allergies: string[]                   // e.g. ["shellfish", "peanuts"]
    cookingSkill: 'beginner' | 'intermediate' | 'advanced' | null
    kitchenEquipment: string[]            // e.g. ["gas stove", "pressure cooker"]
    householdSize: number                 // defaults to 1 if unknown
    fitnessGoals: {
      dailyProteinG?: number
      dailyCalorieTarget?: number
      gymDays?: string[]
    }
    preferredCuisines: string[]
    frequentRestaurants: string[]
    pantryStaples: string[]               // staple ingredients always on hand
  }

  /** Scores from the Decision Engine. Integer 0–100 per path.
   *  These are final. Do not override. */
  preCalculatedScores: {
    cook: number
    order: number
    dineout: number
  }

  /** Which paths are available after elimination rules are applied.
   *  A path with available: false must NOT be selected even if its score is highest.
   *  Elimination reasons: canCook=false, swiggy unavailable, group too large, etc. */
  pathAvailability: {
    cook: boolean
    order: boolean
    dineout: boolean
  }

  /** Normalized results from Tool Agent. null if Tool Agent failed for that tool.
   *  The agent must handle null for any or all of these fields. */
  swiggyResults: {
    restaurants: RestaurantResult[] | null
    instamartItems: InstamartResult[] | null
    dineoutVenues: DineoutVenueResult[] | null
  } | null

  /** YouTube recipe video result. null if cook path not viable or YouTube call failed.
   *  Non-critical — agent proceeds without it when null. */
  youtubeResult: YouTubeRecipeResult | null

  /** Current pantry items from the database. Empty array if no pantry data exists. */
  pantryItems: PantryItem[]

  /** true when Swiggy MCP is unavailable and order/dineout are not possible.
   *  When true: if cook is available, recommend cook; if cook is not available,
   *  activate low-confidence fallback. */
  isDeadedMode: boolean
}
```

**Context window management:** If `swiggyResults.restaurants` contains more than 10 restaurants, the orchestrator truncates to the top 10 by rating before passing to the Planning Agent. If `pantryItems` exceeds 50 items, truncate to 50. These limits prevent context overflow without losing the most relevant data.

### 3.4 Full Output Specification

```typescript
interface PlanningAgentOutput {
  /** Why the winning path won. 1–3 sentences. Plain language. References specific
   *  numbers: cost differences, delivery times, protein content, cooking time.
   *  Never mentions the score value itself. Example:
   *  "Cooking is the clear call — you have everything in your pantry and it's Rs 120
   *  cheaper than the best Swiggy option for your protein target." */
  explanation: string

  /** The winning path. Must match the highest available pre-calculated score. */
  primaryPath: 'cook' | 'order' | 'dineout'

  /** Confidence derived from the winning path score.
   *  score > 70 → 'high', 50–70 → 'medium', < 50 → 'low' */
  confidence: 'high' | 'medium' | 'low'

  recommendation: {
    /** Specific title. Not generic. "Dal Palak + Paneer Bhurji", not "Comfort food".
     *  "Moong Dal Khichdi — Haldiram's", not "Delivery option". */
    title: string

    /** 2–3 sentence description of why this specific option, within the winning path. */
    description: string

    /** Cost in INR. For cook: ingredient cost only (exclude pantry staples).
     *  For order: total order value. For dineout: total bill estimate. */
    estimatedCost: number

    /** Total time in minutes. Realistic — not optimistic. Cook: prep + cook time.
     *  Order: delivery ETA. Dineout: travel + wait + meal time. */
    estimatedTime: number

    /** Protein in grams. Only if nutrition data is available in input — never estimated. */
    proteinG?: number

    /** Calories in kcal. Only if nutrition data is available in input — never estimated. */
    calories?: number

    // ── COOK PATH FIELDS ───────────────────────────────────────────────────────

    /** Ingredient list. Each item has inPantry flag derived from pantryItems input. */
    ingredients?: {
      name: string
      qty: string        // Standard units: "1 cup", "2 tbsp", "200g", "1 tsp", "½ cup"
      inPantry: boolean
    }[]

    /** Step-by-step recipe instructions. Steps are numbered from 1. */
    recipeSteps?: {
      step: number
      instruction: string      // Action-first: "Heat oil in a pan over medium flame."
      durationMin: number      // Realistic. Chopping = 3 min. Sauté = 4–6 min. Boil = 5 min.
      youtubeTimestamp?: string // "MM:SS" — only when keyTimestamps data exists in youtubeResult
    }[]

    /** YouTube video ID (not full URL) — only when youtubeResult is not null. */
    youtubeVideoId?: string

    // ── ORDER PATH FIELDS ──────────────────────────────────────────────────────

    restaurantName?: string
    restaurantId?: string     // Swiggy restaurant ID from swiggyResults
    menuItems?: {
      name: string
      price: number           // INR
    }[]
    estimatedDeliveryMin?: number

    // ── DINEOUT PATH FIELDS ────────────────────────────────────────────────────

    venueName?: string
    venueId?: string          // Swiggy Dineout venue ID from swiggyResults
    availableSlots?: string[] // ["7:30 PM", "8:00 PM", "9:00 PM"] — IST, 12-hour format
    pricePerPerson?: number   // INR estimated
  }

  /** Exactly 2 entries — one for each non-winning path.
   *  Each entry: one sentence, decisive factor only. Never blame the user.
   *  Examples: "Ordering has no vegetarian protein options under your budget."
   *            "Dineout is off the table — you can't spare 90+ minutes tonight." */
  whyNotAlternatives: {
    path: 'cook' | 'order' | 'dineout'
    reason: string
  }[]
}
```

### 3.5 Failure Modes

**Failure Mode 1: Timeout after 8000ms**

Return a simplified degraded recommendation:
```typescript
{
  explanation: "Taking longer than expected. Here's the top match based on your situation.",
  primaryPath: 'order',   // or 'cook' if swiggy unavailable
  confidence: 'low',
  recommendation: {
    title: swiggyResults?.restaurants?.[0]?.name ?? 'Home cooking',
    description: 'Selected based on your situation type.',
    estimatedCost: 0,
    estimatedTime: 30,
  },
  whyNotAlternatives: [
    { path: 'cook', reason: 'Plan generation timed out — showing fastest available option.' },
    { path: 'dineout', reason: 'Plan generation timed out.' },
  ]
}
```
Log `status: 'timeout'`. The UI shows this with a degraded indicator.

**Failure Mode 2: Swiggy Results Empty**

If `swiggyResults.restaurants` is `[]` or `null` and order was the winning path: switch to cook path regardless of scores. Prepend to explanation: "Swiggy returned no results for your area right now. Recommending home cooking instead."

**Failure Mode 3: All Paths Score 0 / NO_WINNER**

The Decision Engine returns `winner: 'NO_WINNER'`. The Planning Agent:
- Sets `confidence: 'low'`
- Sets `primaryPath: 'cook'` (pantry fallback)
- Explanation: "No strong options available right now. Here's a pantry-based fallback:"
- Generates a minimal recipe from pantryItems if not empty, or returns: "Your pantry appears empty and Swiggy has no results. Consider checking nearby options manually."

**Failure Mode 4: Schema Invalid After Retry**

After the single allowed retry (on timeout — schema errors are not retried): return raw text response wrapped in a degraded output with `status: 'schema_failed'`. The UI falls back to the Conversation Agent's situationType to show a generic message.

### 3.6 Prompt Engineering Notes

The system prompt must contain this exact constraint at the top of the agent-specific section:

> "The scores in `{{pre_calculated_scores_json}}` are final. They were computed by deterministic TypeScript code using the user's constraints. Do not recalculate. Do not override. Do not second-guess the scores. Write the explanation only."

For models that attempt to re-derive scores (a known failure mode): the system prompt must additionally include a worked example showing pre-calculated scores in the input and an explanation that references the scores' reasons without recomputing them.

The agent uses JSON mode (`response_format: { type: "json_object" }`) if the Anthropic SDK version supports it. When JSON mode is not available, the system prompt appends: "Output only raw JSON. The first character is `{`. Do not use markdown code fences."

### 3.7 Cost Profile

| Metric | Value |
|---|---|
| Model | claude-sonnet-4-6 |
| Average input tokens | ~2500 (context + memory + scores + Swiggy results + pantry) |
| Average output tokens | ~800 (full recommendation with recipe steps) |
| Cost per call | ~$0.025 at sonnet-4-6 pricing |
| At 10k daily situations | ~$250/day |

The Planning Agent is the dominant cost driver. Cost optimization strategies are in Section 8.

---

## 4. Tool Agent

### 4.1 Identity

| Property | Value |
|---|---|
| Name | `ToolAgent` |
| File | `lib/agents/tool.ts` |
| Model | `claude-haiku-4-5` |
| Max output tokens | 1500 |
| Timeout | 6000ms (must allow for multiple parallel MCP calls) |
| Retry policy | Retry each tool call independently, max 2 retries per tool, 500ms backoff |
| Runs | Parallel with Decision Engine scoring, before Planning Agent |
| Prompt file | `docs/prompts/tool.md` |

### 4.2 Responsibility

Execute external API calls, normalize results into MealOS types, and handle partial failures gracefully. This agent does not reason about food. It fetches, normalizes, and returns. The Planning Agent does the reasoning.

All tool calls that can run in parallel are dispatched simultaneously. The agent waits for all calls to resolve (or timeout/fail) before returning.

### 4.3 Tool Definitions

#### Tool 1: `swiggy_search_restaurants`

**Purpose:** Search Swiggy food delivery for restaurants matching a situation-specific query.

**Input:**
```typescript
{
  query: string          // Situation-specific: sick → "khichdi soup comfort food";
                         // broke → "cheap meals under Rs 150";
                         // nutrition_goal → "high protein chicken paneer";
                         // party → "party platters group orders";
                         // date → "romantic dinner fine dining"
  location: string       // Full area name from user memory: "Bandra West, Mumbai"
  filters?: {
    maxBudget?: number          // INR, from situationContext.explicit.budget
    dietaryFilter?: 'vegetarian' | 'vegan' | 'non-vegetarian' | 'none'
    maxDeliveryMinutes?: number // from situationContext.explicit.timeConstraintMinutes
    minRating?: number          // Default: 3.5
  }
}
```

**Output (normalized):**
```typescript
interface RestaurantResult {
  restaurantId: string
  name: string            // Exact display name from Swiggy — never truncated
  rating: number          // 0.0–5.0, one decimal
  deliveryTimeMin: number // integer minutes
  deliveryFee: number     // INR integer
  minOrderValue: number   // INR integer
  cuisineTypes: string[]
  topItems: {
    name: string
    price: number         // INR integer
    isVeg: boolean
    calories?: number     // Only present if Swiggy returned it — never estimated
    proteinG?: number     // Only present if Swiggy returned it — never estimated
  }[]
}
```

**Per-call timeout:** 3000ms  
**Error codes:** `LOCATION_NOT_SERVICEABLE`, `NO_RESULTS`, `RATE_LIMITED`, `SWIGGY_DOWN`  
**On failure:** Set `restaurants: null` in output; add error to `errors[]`

---

#### Tool 2: `swiggy_search_instamart`

**Purpose:** Search Swiggy Instamart for grocery ingredients. Called only when the cook path requires items not in the user's pantry.

**Input:**
```typescript
{
  items: string[]    // Generic, searchable names with quantity:
                     // "paneer 200g", "basmati rice 1kg", "tomatoes 500g"
                     // Only items NOT in user's pantry
  location: string   // Same format as restaurants
}
```

**Output (normalized):**
```typescript
interface InstamartResult {
  item: string           // The search term passed in
  found: boolean         // false = not available on Instamart
  price?: number         // INR integer. Only present if found: true
  unit?: string          // "200g", "1kg", "500ml"
  brand?: string
  deliveryTimeMin?: number // typically 15–30 minutes
  instamartItemId?: string
}
```

**Fuzzy matching behavior:** The agent uses the recipeName or cooking intent to form searchable terms. "ginger-garlic paste" should be searched as "ginger garlic paste" (remove hyphen). "2 onions" should be searched as "onions 500g" (approximate weight). The agent applies common-sense normalization to avoid zero-result searches.

**Partial results:** When some items are found and some are not, this is `found: true/false` per item — not an error. `PARTIAL_RESULTS` is informational only; the tool returns what it found.

**Per-call timeout:** 3000ms  
**Error codes:** `LOCATION_NOT_SERVICEABLE`, `INSTAMART_DOWN`  
**On failure (INSTAMART_DOWN only):** Set `instamartItems: null`; add error to `errors[]`

---

#### Tool 3: `swiggy_search_dineout`

**Purpose:** Search Swiggy Dineout for bookable venues with real-time availability. Called only when `date_planning`, `party_hosting`, `family_dinner`, or explicit dineout intent is present.

**Input:**
```typescript
{
  occasion: string    // "date night" | "anniversary" | "birthday dinner" |
                      // "business lunch" | "family dinner" | "casual outing"
  location: string    // Area name only: "Bandra", "Koramangala" (not full address)
  budget: number      // Total INR for entire table
  guests: number      // Total diners including user
  date: string        // ISO 8601: "2026-07-06" — today for tonight bookings
}
```

**Output (normalized):**
```typescript
interface DineoutVenueResult {
  venueId: string
  name: string
  cuisineTypes: string[]
  ambience: string[]     // Subset of: ["romantic", "rooftop", "candlelit", "casual",
                         // "fine-dining", "outdoor", "live-music", "family-friendly", "sports-bar"]
  pricePerPerson: number // INR integer
  rating: number         // 0.0–5.0
  availableSlots: string[] // ["7:30 PM", "8:00 PM"] — IST, 12-hour, no zero-padding on hours
  isVegFriendly: boolean
  distanceKm?: number
  bookingUrl?: string
}
```

**Per-call timeout:** 4000ms (availability checks are slower than search)  
**Error codes:** `NO_AVAILABILITY`, `LOCATION_NOT_SERVICEABLE`, `DINEOUT_DOWN`  
**On failure:** Set `dineoutVenues: null`; add error to `errors[]`

---

#### Tool 4: `youtube_search_recipe`

**Purpose:** Find a recipe video for the cook path. Called only when cook is a viable path and a specific recipe has been identified.

**Input:**
```typescript
{
  recipeName: string     // Specific: "dal khichdi" not "Indian comfort food"
  cuisine?: string       // "Indian", "Italian", "Chinese", etc.
  style?: 'quick' | 'detailed' | 'beginner' | 'restaurant-style'
                         // quick if timeConstraint < 30 min
                         // beginner if cookingSkill === 'beginner'
  maxDurationMinutes?: number // User's available time minus 5 min buffer; default 20
}
```

**Output (normalized):**
```typescript
interface YouTubeRecipeResult {
  videoId: string        // YouTube video ID only (not full URL)
  title: string
  channelName: string
  durationSeconds: number  // integer
  thumbnailUrl: string
  viewCount: number
  publishedAt: string      // ISO 8601
  keyTimestamps: {
    label: string          // "Add dal", "Start tempering", "Final seasoning", "Plating"
    seconds: number        // integer, offset from video start
  }[]
}
```

**Per-call timeout:** 2000ms  
**Error codes:** `NO_RESULTS`, `QUOTA_EXCEEDED`, `API_DOWN`  
**On failure:** Set `youtube: null`; add error to `errors[]`. YouTube failure is non-critical — Planning Agent proceeds without video data.

### 4.4 Partial Failure Handling

| Scenario | Behavior |
|---|---|
| Swiggy restaurants fails, others succeed | `restaurants: null`, error in `errors[]`, continue |
| Swiggy Instamart fails, others succeed | `instamartItems: null`, error in `errors[]`, continue |
| Swiggy Dineout fails, others succeed | `dineoutVenues: null`, error in `errors[]`, continue |
| All three Swiggy tools fail | All Swiggy fields null, set `swiggyError: 'SWIGGY_UNAVAILABLE'` |
| YouTube fails | `youtube: null`, error in `errors[]`, non-critical |
| All tools fail | All fields null, `swiggyError: 'SWIGGY_UNAVAILABLE'`, full `errors[]` |

### 4.5 Full Output Schema

```typescript
interface ToolAgentOutput {
  restaurants: RestaurantResult[] | null     // null = tool failed; [] = not called or no results
  instamartItems: InstamartResult[] | null   // null = tool failed; [] = not called or not needed
  dineoutVenues: DineoutVenueResult[] | null // null = tool failed; [] = not called
  youtube: YouTubeRecipeResult | null        // null = not called or failed

  errors: {
    tool: string       // Exact tool name that failed
    errorCode: string  // Exact error code from the tool's error list
    message: string    // 1 sentence human-readable description
  }[]

  swiggyError?: 'SWIGGY_UNAVAILABLE'   // Set only when ALL Swiggy tools failed

  _meta: {
    toolsAttempted: string[]           // All tool names called
    toolsSucceeded: string[]           // Tool names that returned without error
    totalLatencyMs: number             // Wall clock from first tool call to last result
  }
}
```

### 4.6 Normalization Rules

- **Prices:** Round to nearest integer INR. Never write "159.99" — write "160".
- **Times:** Integer minutes for delivery/cooking; integer seconds for YouTube timestamps.
- **Restaurant names:** Exact official name from Swiggy API. Never truncate. "Behrouz Biryani - Bandra" stays as-is.
- **Calories/protein:** Include ONLY if present in API response. Never estimate. Omit the field entirely if absent — do not set to 0 or null.
- **Available slots:** Convert ISO timestamps to IST 12-hour format: "7:30 PM", "8:00 PM". Remove date portion.
- **Empty vs null:** Successful tool call with no results → `[]`. Failed tool call → `null`.

### 4.7 Cost Profile

| Metric | Value |
|---|---|
| Model | claude-haiku-4-5 |
| Average input tokens | ~600 (situation context + tool definitions) |
| Average output tokens | ~400 (normalized results) |
| Cost per call | ~$0.0008 at haiku-4-5 pricing |
| At 10k daily situations | ~$8/day |

---

## 5. Memory Agent

### 5.1 Identity

| Property | Value |
|---|---|
| Name | `MemoryAgent` |
| File | `lib/agents/memory.ts` |
| Model | `claude-haiku-4-5` |
| Max output tokens | 600 |
| Timeout | 5000ms |
| Retry policy | 2 retries, 500ms base backoff, retry on `timeout` and `api_error` |
| Runs | Async, AFTER the situation completes and the user has seen their plan. NEVER in the critical path. |
| Prompt file | `docs/prompts/memory.md` |

### 5.2 Responsibility

Extract durable facts from the completed interaction. Write them to `user_memory_facts`. Over time, build a rich user model that reduces the number of clarification questions needed in future situations.

**This agent is the only one that writes to the database.** All other agents are read-only with respect to persistent state.

**The Memory Agent never blocks the user.** The user sees their plan and can act on it. The Memory Agent fires after the user's SSE stream closes. If it fails, the user is unaffected and the failure is logged silently.

### 5.3 Full Input Specification

```typescript
interface MemoryAgentInput {
  /** The full situation — raw input, context, recommendation, and everything in between. */
  completedSituation: {
    rawInput: string
    situationType: SituationType
    explicit: SituationContext['explicit']
    inferred: SituationContext['inferred']
    recommendation: {
      primaryPath: 'cook' | 'order' | 'dineout'
      title: string
      estimatedCost: number
    }
  }

  /** The clarification questions asked and the user's verbatim answers.
   *  This is the highest-confidence source for new facts — user answered directly. */
  clarificationAnswers: {
    question: string        // The question text shown to the user
    answer: string          // User's verbatim answer
    fieldAnswered: string   // The SituationContext field name this answer resolves
  }[]

  /** What the user actually did after seeing the recommendation. */
  executedPath: 'cook' | 'order' | 'dineout' | 'dismissed' | null
  // dismissed = user dismissed the primary recommendation
  // null = user abandoned (closed app, no action)

  /** Star rating provided by user post-execution. null if not provided. */
  userRating?: 1 | 2 | 3 | 4 | 5 | null

  /** All existing facts for this user — to avoid storing duplicates or
   *  downgrading existing high-confidence facts. */
  existingFacts: {
    factKey: string
    factValue: unknown
    confidence: number
  }[]
}
```

### 5.4 Full Output Specification

```typescript
type MemorySource = 'user_stated' | 'clarification_answer' | 'behavior_inferred' | 'action_derived'

interface MemoryFact {
  /** Dot-notation key from the canonical list (see 5.5 below).
   *  Do not create new key names. */
  factKey: string

  /** The value to store. Must match the expected type for that key. */
  factValue: string | number | boolean | string[]

  /** Exactly one of four values: 1.0, 0.8, 0.6, 0.4
   *  1.0 = user explicitly stated in raw input
   *  0.8 = user confirmed in clarification answer
   *  0.6 = inferred from 3+ behavioral data points
   *  0.4 = weakly inferred from single data point
   *  Any value below 0.4 = do not store */
  confidence: 0.4 | 0.6 | 0.8 | 1.0

  /** Source of the fact. */
  source: MemorySource

  /** Days until this fact should be re-evaluated.
   *  null = permanent (dietary restrictions, allergies, location).
   *  See expiry table in 5.5 for values by category. */
  expiresAfterDays: number | null
}

/** The complete output of the Memory Agent. An empty array means no new facts. */
type MemoryAgentOutput = MemoryFact[]
```

### 5.5 Extraction Rules

**What to store and at what confidence:**

| Signal | Confidence | Source | Example |
|---|---|---|---|
| Explicitly stated in raw input | 1.0 | `user_stated` | "I'm vegetarian" |
| Confirmed in clarification answer | 0.8 | `clarification_answer` | Q: "Budget?" A: "Rs 300" |
| Executed cook path 3+ times (cross-session) | 0.6 | `behavior_inferred` | Pattern in history |
| Single execution or dismissal | 0.4 | `behavior_inferred` | Dismissed cook once |

**Never downgrade confidence.** If a fact already exists with confidence 0.8, a new signal at 0.4 does not lower it. Only upgrade.

**Canonical fact keys:**

| Key | Type | Expiry (days) |
|---|---|---|
| `dietary.restrictions` | `string[]` | null (permanent) |
| `dietary.allergies` | `string[]` | null (permanent) |
| `budget.daily_food_target` | `number` | 30 |
| `budget.dining_out_budget` | `number` | 30 |
| `kitchen.skill_level` | `string` | null |
| `kitchen.equipment` | `string[]` | null |
| `location.home` | `string` | null |
| `location.work` | `string` | null |
| `fitness.protein_target` | `number` | 45 |
| `fitness.calorie_target` | `number` | 45 |
| `fitness.gym_days` | `string[]` | 45 |
| `pantry.staples` | `string[]` | 30 |
| `preference.cuisines.liked` | `string[]` | 90 |
| `preference.cuisines.disliked` | `string[]` | 90 |
| `ordering.frequent_restaurants` | `string[]` | 90 |
| `household.size` | `number` | null |
| `cooking.can_cook` | `boolean` | 30 |

Do not create keys outside this list. If a fact does not map to an existing key, do not store it.

**What NOT to store:**

- Situational states: "sick today", "tired tonight" — these are temporary, not facts
- Mood-based cravings: "felt like biryani" — present-moment desire, not preference
- Negative-space inferences: user dismissed dineout today → do NOT infer they dislike dining out
- Inferred location from a single session — user may be traveling
- Any fact with confidence below 0.4
- The situation type itself
- Single restaurant orders (one order ≠ "frequent restaurant")
- Time-of-day preferences from one session

### 5.6 Failure Handling

Memory Agent failure is always silent to the user.

| Failure | Behavior |
|---|---|
| Agent call timeout | 2 retries; if all fail: log error, write no facts, continue |
| Output schema invalid | No writes, log for debugging, continue |
| Database write fails | Retry write 3 times with exponential backoff; log on final failure |
| Agent returns `[]` | No writes — this is normal when there's nothing worth storing |

In every failure case: the user is completely unaffected. The situation is marked `completed` regardless. The Memory Agent failure is recorded in `situation_agent_runs` with `status: 'failed'`.

### 5.7 Cost Profile

| Metric | Value |
|---|---|
| Model | claude-haiku-4-5 |
| Average input tokens | ~500 (completed situation + clarifications + existing facts) |
| Average output tokens | ~150 (small fact array; often `[]`) |
| Cost per call | ~$0.0002 at haiku-4-5 pricing |
| At 10k daily situations | ~$2/day |

---

## 6. Future Agent Specs (Design Only)

These agents are not built in V1. They represent extractions from the Planning Agent that will be warranted once Planning Agent complexity grows past its 8-second budget, or when specialized logic requires dedicated reasoning power.

### 6.1 Budget Agent

**Name:** `BudgetAgent`  
**Model (when extracted):** `claude-haiku-4-5`

**Trigger for extraction:** Planning Agent timeout rate exceeds 15% on budget-constrained situations (`broke`, `party_hosting`). The financial analysis is computationally cheap but prompt-heavy when the Planning Agent also has to handle recipe generation.

**Responsibilities:**
- Analyze the financial dimension of the situation
- Calculate per-person cost breakdowns for group situations
- Flag when the user's desired outcome exceeds their budget with specific numbers
- Suggest budget-optimal alternatives within the same path

**Key inputs:** `budget: number`, `guests: number`, `candidatePlanItems: PlanItem[]`, `situationType`  
**Key outputs:** `budgetAssessment: 'comfortable' | 'tight' | 'over_budget'`, `recommendedMaxSpend: number`, `costBreakdown[]`, `savingsSuggestions: string[]`

**Why kept inside Planning Agent initially:** Budget analysis is a small portion of the Planning Agent's reasoning. Separating it requires an additional API round trip and adds ~1–2 seconds to the critical path. Extract when the round trip cost is less than the Planning Agent timeout rate.

**Extraction signal:** Planning Agent p95 latency > 6 seconds OR schema failure rate on budget situations > 5%.

---

### 6.2 Nutrition Agent

**Name:** `NutritionAgent`  
**Model (when extracted):** `claude-haiku-4-5`

**Trigger for extraction:** `nutrition_goal` situations require multi-meal planning calculations that are consuming >30% of the Planning Agent's token budget, leaving insufficient space for recipe generation.

**Responsibilities:**
- Calculate macro breakdowns for candidate meals
- Track daily progress toward protein/calorie targets
- Flag dietary conflicts with user's restrictions
- Suggest gap-closing options when targets aren't met

**Key inputs:** `nutritionGoal`, `mealHistory[]` (today's logged meals), `candidateItems[]`  
**Key outputs:** `macroAnalysis`, `goalProgress`, `conflicts: string[]`, `suggestions: string[]`

**Why kept inside Planning Agent initially:** Only `nutrition_goal` situations need this. At V1 volume, a dedicated agent adds overhead without enough benefit. Extract when `nutrition_goal` situations exceed 20% of daily volume.

**Extraction signal:** `nutrition_goal` situations exceed 20% of daily situations OR planning latency for nutrition situations is 2x other situation types.

---

### 6.3 Recipe Agent

**Name:** `RecipeAgent`  
**Model (when extracted):** `claude-sonnet-4-6` (recipe generation requires higher capability)

**Trigger for extraction:** The Planning Agent is producing suboptimal recipe recommendations because it cannot allocate enough tokens to both recipe reasoning and explanation writing simultaneously.

**Responsibilities:**
- Generate or retrieve recipe recommendations
- Match recipes against pantry state
- Estimate cooking time realistically (not optimistically)
- Suggest ingredient substitutions for missing items
- Generate step-by-step instructions with realistic durations

**Key inputs:** `craving`, `pantryItems[]`, `cookingSkill`, `kitchenEquipment`, `timeConstraintMinutes`  
**Key outputs:** Full recipe object with ingredients, steps, pantry flags, and Instamart shopping list for missing items

**Why kept inside Planning Agent initially:** Recipe generation and plan explanation are tightly coupled. Separating them requires the Recipe Agent's output to be passed back to Planning Agent, adding a serial dependency.

**Extraction signal:** Cook path recommendation quality scores (via user ratings) consistently below 3.5/5 stars, OR pantry hit rate below 60% despite users having stocked pantries.

---

### 6.4 Scheduler Agent

**Name:** `SchedulerAgent`  
**Model (when extracted):** `claude-haiku-4-5`

**Trigger for extraction:** `meal_prep` situations are consistently timing out in Planning Agent because scheduling logic (generating a 7-day plan) is token-intensive.

**Responsibilities:**
- Convert "meal prep for the week" into a specific day-by-day schedule
- Avoid meal repetition across the week
- Create timed reminders and Instamart delivery windows
- Integrate with calendar context if connected

**Key inputs:** `timeframe: 'week' | 'tonight'`, `nutritionGoals`, `mealHistory`, `calendarContext?`  
**Key outputs:** `schedule[]` (date, meal type, recommendation per slot), `shoppingList[]`, `prepSuggestions: string[]`

**Why kept inside Planning Agent initially:** Only `meal_prep` situations need it. At V1 volume, the Planning Agent handles weekly plans adequately within its token budget.

**Extraction signal:** `meal_prep` situation planning latency > 6 seconds or output token usage > 1800 (approaching the 2000 limit).

---

### 6.5 Swiggy Agent (Dedicated)

**Name:** `SwiggyAgent`  
**Model (when extracted):** `claude-haiku-4-5` (tool-calling only, minimal reasoning)

**Trigger for extraction:** Tool Agent complexity grows past pure tool execution — the agent starts needing to reason about search strategy (e.g., progressive search refinement when first queries return no results).

**Responsibilities:**
- Interface exclusively with the Swiggy MCP
- Implement search strategy: broad first, then narrow
- Handle progressive fallback: if "biryani Bandra" returns 0 results, try "Indian Bandra"
- Return structured results in MealOS types

**Key inputs:** `searchIntent`, `location`, `filters`, `situationType`  
**Key outputs:** Same as current Tool Agent Swiggy fields

**Why kept inside Tool Agent initially:** At V1, one Tool Agent handles all external APIs without needing to reason about search strategy. Extract when search refinement logic becomes complex enough to warrant its own agent loop.

**Extraction signal:** Tool Agent `NO_RESULTS` error rate for Swiggy > 10% of calls.

---

### 6.6 Context Enrichment Agent

**Name:** `ContextEnrichmentAgent`  
**Model (when extracted):** `claude-haiku-4-5`

**Trigger for extraction:** The ConversationAgent is being asked to do too much — parse input AND enrich context from memory AND infer temporal signals all in one pass.

**Responsibilities:**
- Retrieve relevant memory for the situation (semantic search over past situations)
- Merge memory into the SituationContext
- Determine what is known, what can be inferred, and what is genuinely missing
- Surface assumptions being made from memory (for transparency to Planning Agent)

**Key inputs:** `rawSituationContext`, `userId`  
**Key outputs:** `enrichedContext: SituationContext`, `knownFields: string[]`, `assumptions[]`

**Why kept inside ConversationAgent initially:** At V1, ConversationAgent receives `userMemorySummary` as a pre-built string from the Memory Service. This is fast and sufficient. Context enrichment as a separate agent step is only needed when the memory corpus grows large enough that a summary string loses important detail.

**Extraction signal:** User memory exceeds 50 facts per user (average), or clarification question rate does not decline over time (indicating memory isn't being utilized).

---

## 7. Agent Orchestrator

### 7.1 Location and Interface

**File:** `lib/agents/orchestrator.ts`

```typescript
interface OrchestratorConfig {
  /** Total wall-clock timeout for the entire pipeline (all agents combined).
   *  If this fires, the orchestrator returns whatever partial plan exists. */
  pipelineTimeoutMs: number   // 15000ms (15 seconds)

  /** SSE event emitter — the orchestrator emits events at each stage completion. */
  emitter: SituationEventEmitter
}

interface OrchestratorInput {
  situationId: string
  userId: string
  rawInput: string
  timestamp: string
  userTimezone: string
}

interface OrchestratorOutput {
  plan: PlanningAgentOutput
  situationContext: SituationContext
  agentRunIds: string[]   // IDs of situation_agent_runs rows created
  pipelineStatus: 'complete' | 'degraded' | 'failed'
  totalLatencyMs: number
}
```

### 7.2 Pipeline State Machine

The orchestrator manages the situation through these states. State transitions are written to the `situations.status` column in real time.

```
created
  → intent_extracted        (ConversationAgent completed)
  → clarifying              (missingRequired fields exist → ClarificationEngine active)
  → context_ready           (all required fields filled — clarification complete or not needed)
  → planning                (ToolAgent + Decision Engine running)
  → plan_ready              (PlanningAgent completed)
  → executing               (user tapped an action)
  → completed               (action confirmed)
  → abandoned               (user closed app without acting)
```

Transitions are one-directional. A situation cannot move backward in the state machine.

### 7.3 Pipeline Flow

```
OrchestratorInput received
        │
        ▼
[1] ConversationAgent.run(rawInput, memorySummary, ...)
    ↳ Emits SSE: 'context_extracted' { situationType, confidence }
    ↳ Status: created → intent_extracted
        │
        ├─ nonFoodInput === true?
        │    → Emit 'non_food_redirect'. Pipeline ends.
        │
        ▼
[2] ClarificationEngine.evaluate(situationContext)
    ↳ If missingRequired.length > 0:
       → Status: intent_extracted → clarifying
       → Emit SSE: 'clarification_needed' { questions[] }
       → PAUSE: wait for user answers via POST /api/v1/situations/:id/clarify
       → Merge answers into situationContext
       → Run ClarificationEngine again (max 1 additional pass)
    ↳ If missingRequired.length === 0:
       → Proceed immediately
        │
        ▼
[3] Status: context_ready
    Emit SSE: 'context_ready' { situationType, confidence }
        │
        ▼ (parallel)
[4a] DecisionEngine.score(situationContext, pathInputs)
     ↳ Synchronous TypeScript — completes in < 5ms
     ↳ Returns: DecisionResult { cookScore, orderScore, dineoutScore, winner }

[4b] ToolAgent.run(situationContext, userLocation, ...)
     ↳ Dispatches all relevant tool calls in parallel
     ↳ Timeout: 6000ms
     ↳ Returns: ToolAgentOutput (with partial results on partial failure)
        │
        │ (both 4a and 4b must complete before step 5)
        ▼
[5] PlanningAgent.run(context, scores, toolResults, pantry, ...)
    ↳ Status: plan_ready
    ↳ Emits SSE: 'plan_ready' { plan }
        │
        ▼
[6] User sees plan. Pipeline waits for action or timeout.
        │
        ├─ User acts → Status: executing → completed
        └─ User abandons → Status: abandoned (after 5 min timeout)
        │
        ▼ (async, does NOT block user)
[7] MemoryAgent.run(completedSituation, clarificationAnswers, executedPath, ...)
    ↳ Fires after SSE stream closes (or after 30 seconds if stream stays open)
    ↳ Writes to user_memory_facts
    ↳ Failure is silent to user
```

### 7.4 SSE Event Schema

Every event emitted on `/api/v1/situations/:id/stream` follows this envelope:

```typescript
interface SituationSSEEvent {
  event: SituationEventType
  data: object   // event-specific payload
  id: string     // monotonically increasing integer as string
  retry?: number // reconnect timeout in ms (default 3000)
}

type SituationEventType =
  | 'context_extracted'     // ConversationAgent done
  | 'clarification_needed'  // ClarificationEngine requests user input
  | 'context_ready'         // Full context assembled, planning starting
  | 'plan_ready'            // PlanningAgent done, full plan available
  | 'non_food_redirect'     // nonFoodInput detected
  | 'error'                 // Unrecoverable pipeline error
  | 'heartbeat'             // Sent every 15s to keep connection alive
```

### 7.5 Partial Agent Failure Handling

The orchestrator's priority is to always give the user something — even a degraded plan is better than a blank screen.

| Failure | Orchestrator Response |
|---|---|
| ConversationAgent timeout (all retries) | Use timeout fallback context; proceed to clarification |
| ConversationAgent schema fail | Use schema fallback context; emit `context_extracted` with confidence=20 |
| ToolAgent timeout | Proceed with empty tool results; Planning Agent activates degraded mode |
| ToolAgent partial failure | Proceed with partial results; Planning Agent adapts |
| All Swiggy tools fail | Set `isDeadedMode: true` for Planning Agent |
| PlanningAgent timeout | Return simplified plan from swiggy[0] or pantry; emit `plan_ready` with degraded marker |
| PlanningAgent schema fail | Return raw text plan; emit `plan_ready` with `schema_failed` marker |
| MemoryAgent failure | Silent. Emit nothing. No user impact. |

### 7.6 Timeout Management

The orchestrator uses a pipeline-level deadline of 15 seconds from the moment the situation is received. Individual agent timeouts are:

| Agent | Timeout | Budget in pipeline |
|---|---|---|
| ConversationAgent | 3000ms | Steps 1–2: 0–4000ms |
| Clarification wait | User-driven | Indefinite (user must answer) |
| ToolAgent | 6000ms | Steps 4a+4b: runs in parallel, 6000ms max |
| DecisionEngine | < 5ms | Negligible |
| PlanningAgent | 8000ms | Step 5: 0–8000ms |

**Worst case (no clarification):** 3000 + 6000 + 8000 = 17000ms.

The 15-second pipeline timeout fires before worst case. This is intentional — a fully degraded plan at 15 seconds beats a slightly better plan at 17 seconds.

### 7.7 MemoryAgent Trigger

The Memory Agent is triggered by the orchestrator after the SSE stream closes:

```typescript
// Orchestrator code after plan is delivered
const MEMORY_DELAY_MS = 2000  // 2s grace period

situationEventEmitter.on('stream_closed', (situationId: string) => {
  setTimeout(async () => {
    const situation = await db.situations.findById(situationId)
    if (!['completed', 'abandoned'].includes(situation.status)) return

    memoryAgent.run({
      completedSituation: situation,
      clarificationAnswers: situation.clarifications?.[0]?.answers ?? [],
      executedPath: getExecutedPath(situation),
      userRating: situation.user_actions?.[0]?.user_rating ?? null,
      existingFacts: await memoryService.getFactsForUser(situation.userId),
    }).catch(err => {
      logger.error('MemoryAgent failed silently', { situationId, err })
    })
  }, MEMORY_DELAY_MS)
})
```

---

## 8. Cost Modeling

### 8.1 Per-Agent Cost Per Situation

| Agent | Model | Avg Input Tokens | Avg Output Tokens | Cost Per Call |
|---|---|---|---|---|
| ConversationAgent | claude-haiku-4-5 | 300 | 200 | ~$0.0003 |
| PlanningAgent | claude-sonnet-4-6 | 2500 | 800 | ~$0.0250 |
| ToolAgent | claude-haiku-4-5 | 600 | 400 | ~$0.0008 |
| MemoryAgent | claude-haiku-4-5 | 500 | 150 | ~$0.0002 |
| **Total per situation** | | | | **~$0.0263** |

### 8.2 Scale Cost Table

(Assumes 1 situation per user per day; costs rounded to nearest dollar)

| Scale | Conversation | Planning | Tool | Memory | Daily Total |
|---|---|---|---|---|---|
| 100 DAU | $0.03 | $2.50 | $0.08 | $0.02 | **~$2.63** |
| 1,000 DAU | $0.30 | $25.00 | $0.80 | $0.20 | **~$26.30** |
| 10,000 DAU | $3.00 | $250.00 | $8.00 | $2.00 | **~$263** |
| 100,000 DAU | $30.00 | $2,500.00 | $80.00 | $20.00 | **~$2,630** |

Monthly projection: multiply daily total by 30.

**The Planning Agent drives 95% of cost at every scale.** All cost optimization effort should focus here.

### 8.3 Cost Optimization Strategies

#### Strategy 1: Planning Agent Output Caching

Cache Planning Agent outputs for identical (context hash, Swiggy results hash) pairs. TTL: 15 minutes.

Cache key construction:
```typescript
function buildPlanningCacheKey(
  situationContext: SituationContext,
  swiggyResults: ToolAgentOutput
): string {
  const contextHash = hashObject({
    situationType: situationContext.situationType,
    explicit: situationContext.explicit,
    // Exclude inferred — time of day changes but doesn't affect planning much
  })
  const swiggyHash = hashObject(swiggyResults)
  return `planning:${contextHash}:${swiggyHash}`
}
```

Expected hit rate: 5–15% (Swiggy results change every 15 minutes; context varies per user). At 10k DAU, a 10% cache hit rate saves $25/day.

#### Strategy 2: Swiggy Result Caching

Cache Tool Agent Swiggy results per (location, situationType, dietary filter) for 15 minutes in Redis. This reduces Tool Agent calls AND reduces the input token count for Planning Agent (smaller context = cheaper).

Expected hit rate: 20–30% (many users in the same area have similar queries at similar times).

#### Strategy 3: Context Truncation

When Swiggy results are large, truncate before passing to Planning Agent:

- `restaurants`: top 5 by relevance score (not 10)
- `instamartItems`: only items with `found: true`
- `dineoutVenues`: top 3 by availability and rating
- `pantryItems`: only items used in the last 30 days (exclude dormant pantry items)

A typical unconstrained Swiggy result set is ~1500 tokens. Truncated to top 5 restaurants, it's ~600 tokens. At 10k daily situations, this saves ~900 tokens per Planning Agent call → ~$13.50/day.

#### Strategy 4: Haiku for Conversation, Tool, Memory; Sonnet Only for Planning

The model allocation is already optimal in V1:
- claude-haiku-4-5: ConversationAgent, ToolAgent, MemoryAgent (classification + tool-calling tasks)
- claude-sonnet-4-6: PlanningAgent only (complex reasoning + prose generation)

**Do not downgrade PlanningAgent to haiku** — recommendation quality is the product's core value proposition. The $0.025/call for Planning Agent is the right investment.

#### Strategy 5: Prompt Length Optimization for Planning Agent

The Planning Agent system prompt and user message template account for ~800 of the 2500 average input tokens. Savings available:

- Remove worked examples from the system prompt after the model has been tuned on production data (saves ~300 tokens per call)
- Compress Swiggy result schema documentation in the prompt (move to inline comments instead of separate documentation block)
- Pre-compute and inject only the winning path's data (if Decision Engine runs first), reducing context by ~200 tokens

Combined effect: ~500 token reduction per call → ~$7.50/day at 10k DAU.

#### Strategy 6: Batch Memory Agent Runs

Instead of triggering MemoryAgent for every situation, batch 5-10 situations per user per day and run MemoryAgent once. This is particularly effective for high-frequency users.

At current volumes (V1), individual runs are fine. Implement batching when Memory Agent cost exceeds $10/day (approximately 50,000 DAU).

---

*Document ends. For prompts, see `docs/prompts/`. For Decision Engine scoring logic, see `docs/DECISION_ENGINE.md`. For database schema, see `docs/DATABASE.md`. For API contracts, see `docs/API.md`.*
