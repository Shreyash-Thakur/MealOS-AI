# MealOS AI — MVP Plan
**Author:** Lead Staff AI Engineer  
**Review credit:** Staff Engineer review incorporated  
**Date:** 2026-07-06  
**Horizon:** 3 weeks to a demo-ready, deployable product

---

## The Organizing Principle

MealOS is not a chat app.  
MealOS is not a Swiggy wrapper.  
MealOS is not a recipe finder.

**MealOS is a Planning Engine.**

Text, voice, and quick templates are inputs to the engine.  
Swiggy, Instamart, recipes, and YouTube are outputs the engine dispatches.  
Everything else — the UI, the agents, the memory — exists to serve the Planning Engine.

**Every screen in MealOS follows a single loop:**

```
Situation → Decision → Execution → Learning
```

The user describes a situation. The engine makes a decision. The user executes it. The system learns from the outcome. This loop is the product identity. It appears on every screen, in every flow, in every conversation with anyone about this project. When in doubt about a feature, ask: which stage of this loop does it serve?

This document defines exactly what ships in 3 weeks, what does not, and why.

---

## The Demo Loop

This is the sequence a recruiter or investor will see. Every V1 decision traces back to making this loop work flawlessly.

```
1. User opens app (logged in, 90-second onboarding already done)

2. Taps the microphone and says:
   "I want to hit 150g protein today"

3. Voice transcribes in ~1 second.

4. Confidence card appears immediately:
   ┌─────────────────────────────────┐
   │ Confidence: 78%                 │
   │ ✔ Diet known (vegetarian)       │
   │ ✔ Budget known (₹350/day)       │
   │ ✔ Location set (Bandra)         │
   │ ✗ Protein target not confirmed  │
   └─────────────────────────────────┘

5. One smart question:
   "You're targeting 150g protein today — is that for your entire day,
   or just dinner?"
   [Full day] [Just dinner]

6. User taps: Full day

7. Planning Engine runs. Three options score in 4 seconds:

   ┌──────────────────────────────────────────────────────────┐
   │ COOK          92/100   ₹180    35 min    ~152g protein   │
   │ ORDER         71/100   ₹640    22 min    ~98g protein    │
   │ DINE OUT      44/100   ₹1400   90 min    ~80g protein    │
   └──────────────────────────────────────────────────────────┘

8. Decision card:
   "Cooking is the only way to reliably hit 150g on a vegetarian diet
   within your ₹350 daily budget. Ordered food at this calorie level
   would cost 3.5× more and still fall 50g short."

9. Recommendation surfaces:
   Paneer Bhurji + Rajma + Brown Rice
   — 157g protein · ₹180 ingredients · 35 min

   [▶ YouTube Tutorial]  [View Steps]  [Add to Instamart]

10. User taps "Add to Instamart" →
    Swiggy opens with all 8 ingredients pre-loaded in cart.
    Estimated delivery: 14 minutes.

11. Optional: "Remind me to start cooking at 6:30 PM?" [Yes]
```

This loop takes under 90 seconds. It is coherent, intelligent, and executable.  
**Every feature in V1 exists to serve this loop.**

---

## What Is In V1

### 1. Onboarding (Day 1–2)

A one-time, 90-second setup. No onboarding, no personalization. No personalization, no confidence scores.

5 questions, progressive disclosure:

```
Q1: What's your diet?          [Vegetarian] [Vegan] [Non-veg] [Flexible]
Q2: Any allergies?             [None] [Shellfish] [Nuts] [Gluten] [Dairy] [Other]
Q3: Daily food budget?         [Under ₹200] [₹200–400] [₹400–700] [₹700+]
Q4: Where are you based?       [City search + neighborhood]
Q5: Can you cook?              [Confident] [Basics only] [Rarely] [Never]
```

This feeds the memory layer. Every subsequent session starts with this context already known.

---

### 2. Situation Input: Text + Voice (Day 3–4)

The primary surface. Not a chat window. Not a form. One focused input.

- Text input with placeholder examples rotating through real scenarios
- Microphone button using Web Speech API (browser-native, no external service needed for V1)
- Quick-tap situation templates below the input for mobile users:

```
[I'm sick]  [I'm broke]  [Plan a date]  [Hit protein goal]  [Quick meal]  [Party tonight]
```

Templates pre-fill the input and trigger the engine immediately. They are not navigation — they are shortcuts to real situations.

**Voice is first-class from day one, not a future feature.** The demo moment of speaking to the app and watching the confidence card appear is the first impression that sticks.

---

### 3. The Confidence Score (Day 5)

Every situation begins with a Confidence Card before any recommendation appears. This is what makes MealOS feel like intelligence rather than guesswork.

```
┌────────────────────────────────────────────────┐
│ Understanding your situation...                 │
│                                                 │
│ Confidence: 92%                                 │
│                                                 │
│ ✔ Diet preferences known                        │
│ ✔ Daily budget: ₹350                            │
│ ✔ Location: Bandra, Mumbai                      │
│ ✔ Cooking skill: intermediate                   │
│ ○ Protein target — asking now                   │
└────────────────────────────────────────────────┘
```

Rules:
- 100%: Plan fires immediately. No questions.
- 75–99%: 1 question. Then plan fires.
- 50–74%: 2 questions maximum. Then plan fires.
- Below 50%: 3 questions maximum. Then plan fires with a stated assumption.

The system never asks more than 3 questions. Ever. If the confidence is still low after 3 answers, it states its assumptions explicitly and proceeds.

Confidence is calculated by the Planning Agent based on which context fields are populated vs. which are required for the detected situation type.

---

### 4. Clarification Engine (Day 5–6)

Already designed in ARCHITECTURE.md — the core logic is unchanged. What changes in the MVP:

- Maximum 3 questions total (not 2 passes of 3)
- All questions are batched together, never sequential
- Each question has 2–4 quick-tap options and a freetext fallback
- Answers immediately update the Confidence Score card (live, with animation)

The Clarification Card is not a form. It is a focused, contextual interaction that feels like talking to a knowledgeable friend who asked exactly the right question.

---

### 5. The Planning Graph (Day 6–7)

This is a UI element showing the reasoning pipeline as it runs. It is not decorative — it is what separates MealOS from a search box.

```
 Situation received
       │
       ▼
 ◉ Understanding you...         [complete]
       │
       ▼
 ◉ Checking your profile...     [complete]
       │
       ▼
 ◉ Clarifying 1 thing...        [complete]
       │
       ▼
 ◯ Evaluating options...        [running...]
   ├── Swiggy restaurants
   ├── Instamart + recipes
   └── Scoring against your goals
       │
       ▼
 ◯ Building your plan...        [waiting]
```

Each node lights up and checks off in real-time as the Planning Agent progresses. Users understand what the system is doing and why it takes a few seconds. This reduces drop-off during the 4–6 second wait for the plan.

Implementation: The Planning Agent emits step-completion events over SSE. The UI subscribes and animates each node as events arrive.

---

### 6. The Decision Engine and Plan Comparison (Day 8–9)

The most important feature in V1. This is what makes MealOS a Planning Engine rather than a recommendation list.

For every situation, the Planning Agent always evaluates all three service paths simultaneously — Cook, Order, and Dine Out — and scores each against the user's specific constraints.

```
┌─────────────────────────────────────────────────────────┐
│                    YOUR OPTIONS                         │
├──────────────┬────────────┬────────────┬────────────────┤
│              │    COOK    │   ORDER    │   DINE OUT     │
├──────────────┼────────────┼────────────┼────────────────┤
│ Score        │  92 / 100  │  71 / 100  │  44 / 100      │
│ Cost         │  ₹ 180     │  ₹ 640     │  ₹ 1,400       │
│ Time         │  35 min    │  22 min    │  90 min        │
│ Protein      │  ~152g     │  ~98g      │  ~80g          │
│ Effort       │  Medium    │  None      │  None          │
├──────────────┴────────────┴────────────┴────────────────┤
│ Why we chose Cook:                                      │
│ "Ordered food can't reliably hit 150g protein on a      │
│  vegetarian diet within ₹350. Cooking is the only       │
│  path that achieves your goal today."                   │
└─────────────────────────────────────────────────────────┘
```

The comparison table is always shown. The user can tap any column to switch to that option. The explanation changes when they switch.

**Scoring is deterministic TypeScript code, not an LLM prompt.**

This is the most important implementation decision in the entire codebase. Scores must be consistent, reproducible, and debuggable. Letting Claude invent scores in a prompt produces different numbers every call and makes every recommendation untestable.

```typescript
// lib/engine/scorer.ts — no LLM involved

const WEIGHTS: Record<SituationType, ScoreWeights> = {
  nutrition_goal: { goalMatch: 0.50, budgetFit: 0.15, timeFit: 0.20, preferenceMatch: 0.15 },
  budget_constrained: { goalMatch: 0.30, budgetFit: 0.50, timeFit: 0.10, preferenceMatch: 0.10 },
  quick_meal:      { goalMatch: 0.30, budgetFit: 0.15, timeFit: 0.40, preferenceMatch: 0.15 },
  default:         { goalMatch: 0.40, budgetFit: 0.25, timeFit: 0.20, preferenceMatch: 0.15 },
}

function scoreOption(option: PlanOption, context: SituationContext): number {
  const w = WEIGHTS[context.situationType] ?? WEIGHTS.default
  return Math.round(
    option.goalMatchScore  * w.goalMatch  +
    option.budgetFitScore  * w.budgetFit  +
    option.timeFitScore    * w.timeFit    +
    option.prefMatchScore  * w.preferenceMatch
  )
}
```

Each sub-score (goalMatchScore, budgetFitScore, etc.) is also a deterministic function — comparing the option's actual cost / time / nutrition against the user's stated constraints.

**Claude is called once, after scoring is complete,** with a prompt of the form: "Cook scored 92, Order scored 71, Dine scored 44. The user needs 150g protein on a ₹350 budget. Write one to three sentences explaining why Cook won." Claude writes the explanation. It does not invent the numbers.

This separation makes the Decision Engine fast (scoring runs in microseconds), consistent (same inputs always produce the same winner), and trustworthy (you can write unit tests for every weight table).

---

### 6.5 The Plan Simulator (Day 9, alongside Recommendation Card)

Shown immediately after the winning option is selected, before execution. Not a separate page — a collapsible panel beneath the primary recommendation.

```
╔══════════════════════════════════════════════════════════╗
║  PLAN SIMULATOR — See what you'd gain or lose            ║
╠══════════════════╦══════════════════╦════════════════════╣
║                  ║    COOK ✓        ║    ORDER           ║
╠══════════════════╬══════════════════╬════════════════════╣
║ Cost             ║  ₹ 180           ║  ₹ 640             ║
║ Time             ║  35 min          ║  22 min            ║
║ Protein          ║  157g            ║  98g               ║
║ Effort           ║  Medium          ║  None              ║
╠══════════════════╩══════════════════╩════════════════════╣
║  If you switch to Order:                                 ║
║  You spend  ₹460 more                                    ║
║  You save   13 minutes                                   ║
║  You miss   59g protein                                  ║
╚══════════════════════════════════════════════════════════╝
          [Stay with Cook]  [Switch to Order]
```

The savings/cost row only shows the delta between the current selection and the next-best alternative. It does not compare all three simultaneously — that is the Comparison Table's job. The Simulator is a confirmation nudge that makes the trade-off concrete at the moment of decision.

This UI takes under half a day to build. The data is already in the comparison object. It requires no new API call, no new agent, no new database table. It is a pure frontend calculation from numbers the Planning Engine already returned. The implementation cost is low; the perceived intelligence is disproportionately high.

---

### 7. The Recommendation Card (Day 9–10)

After the comparison, one option is expanded as the primary recommendation:

```
┌────────────────────────────────────────────────────────┐
│ TONIGHT'S PLAN                              Score: 92  │
├────────────────────────────────────────────────────────┤
│ Paneer Bhurji + Rajma + Brown Rice                     │
│ 157g protein · ₹180 · 35 min · Intermediate            │
│                                                        │
│ WHAT YOU NEED                                          │
│ ✔ Paneer (300g)      ✔ Rajma (1 cup, soaked)          │
│ ✔ Brown rice         ○ Onion (2 pcs) — add to cart    │
│ ○ Tomatoes (3 pcs)   ○ Ginger-garlic paste             │
│                                                        │
│ [▶ Watch on YouTube]  [Step-by-step]  [Add to Instamart]│
└────────────────────────────────────────────────────────┘
```

Pantry items the user has are checked. Missing items are flagged and automatically included in the Instamart cart.

---

### 8. The Cooking Flow: Pantry → Instamart → Cook (Day 10–12)

When the Planning Engine selects Cook, the experience is not "here is a recipe and a YouTube link." It is one continuous flow.

**Stage 1: Pantry Check**

Immediately after the recommendation appears, the system compares the recipe's ingredient list against the user's stored pantry:

```
WHAT YOU HAVE           WHAT YOU NEED
✔ Paneer (300g)         ○ Onion × 2
✔ Brown rice            ○ Tomatoes × 3
✔ Oil, salt, spices     ○ Ginger-garlic paste (50g)
```

**Stage 2: Instamart Cart**

Missing ingredients are automatically bundled:

```
INSTAMART ORDER — 3 items
Onion × 2         ₹18
Tomatoes × 3      ₹27
Ginger-garlic     ₹42
──────────────────────
Total             ₹87
Delivery          ~14 min

[Order now]  [Edit items]
```

Tapping "Order now" calls the Tool Agent, which uses Swiggy MCP to search Instamart for each item, builds a cart, and returns a deep link. The user lands in Swiggy with the cart pre-loaded.

**Stage 3: Watch Recipe** (while waiting for delivery)

The YouTube card appears with an estimated "ready to start cooking" time based on the delivery ETA:

```
▶  Paneer Bhurji in 20 Minutes — Chef Ranveer Brar
   23:14 · 4.2M views
   Start watching while Instamart delivers (12 min)
```

**Stage 4: AI Cooking Mode** (V1 — step-by-step with inline clips)

When the user taps "Start Cooking", they enter step-by-step mode. Each step is a focussed card:

```
┌─────────────────────────────────────────────┐
│  Step 3 of 8                    ⏱ 4 min     │
│                                             │
│  Add the onions to the pan.                 │
│  Cook until golden — about 4 minutes.       │
│  Keep stirring to avoid burning.            │
│                                             │
│  [Need help? Watch 18s clip ▶]              │
│                                             │
│  [Done — next step →]                       │
└─────────────────────────────────────────────┘
```

The "Watch 18s clip" opens YouTube at the precise timestamp for that step. In V1 this is a manually curated timestamp offset (Recipe Agent stores `{step: 3, timestamp: "4:22"}` at recipe creation time). In V2 this becomes automatic via YouTube transcript parsing.

This is the full cooking experience: ingredients sourced, delivered, video ready, guided step by step. No other food app chains these four stages into one unbroken flow. That is the demo.

In V2: YouTube transcript is parsed by Claude, timestamps are extracted automatically, and voice narrates each step hands-free.

---

### 9. Instamart Cart Integration (Day 11–12)

For cooking recommendations, missing ingredients are automatically bundled into an Instamart order.

User sees:
```
INSTAMART ORDER
Onion × 3      ₹24
Tomatoes × 3   ₹36
Ginger paste   ₹42
──────────────────
Total          ₹102
Delivery       14 min

[Open Instamart] [Edit items]
```

Tapping "Open Instamart" calls Swiggy MCP to pre-fill the cart and redirects. The user lands on the Swiggy checkout screen with items already added.

For ordering recommendations (not cooking), the full restaurant order is pre-filled the same way.

---

### 10. Memory (Day 12–13)

V1 memory is structured only. No embeddings, no pgvector.

**What is stored:**
- Profile facts from onboarding (diet, allergies, budget, location, cooking skill)
- Facts from clarification answers ("protein target: 150g", "alone tonight")
- Persistent facts flagged by the Planning Agent ("prefers paneer-based dishes", "avoids spicy food for dinner")

**What is NOT stored in V1:**
- Conversation history (no semantic retrieval, no embeddings)
- Meal history (logged but not yet used for recommendations)
- Pantry state (present in UI, not yet used in planning)

**Memory Panel:**
A drawer (mobile) or sidebar (desktop) showing everything the system knows. Each fact has an edit and delete button. The user is always in control.

---

### 11. Execution and Reminders (Day 13–14)

After the user acts (taps Order or starts cooking):
- A simple reminder is offered: "Remind you to start at [time]?" via browser notification
- The situation is marked as completed
- A brief feedback prompt: thumbs up/down on whether the recommendation was good
- This data feeds the memory layer in V2

---

## Fallback Strategy

The Planning Engine never says "Sorry, something went wrong." That is a failure of design, not a failure of technology. Every external dependency has a degradation chain.

| Failure | Immediate Fallback | Next Fallback |
|---|---|---|
| Swiggy MCP unavailable | Hide Order and Dine options, Cook only. Show notice: "Delivery unavailable right now — here's what you can make at home." | If cooking also fails, show manual shopping list with Google Maps link to nearest grocery store. |
| Instamart unavailable | Show recipe with ingredient list as plain text. "Instamart is busy — here's your shopping list." | Offer to remind the user when Instamart is back (via browser notification). |
| Specific restaurant closed | Swap to next-best restaurant in the same cuisine and price range. | If none available, switch to Instamart for a cook option silently — user sees a plan, not an error. |
| YouTube video removed or unavailable | Show recipe steps without video. Don't show a broken thumbnail. Silently fall back to text-only mode. | In V2: search for an alternative video at the same timestamp range. |
| LLM timeout (Planning Agent > 8 seconds) | Return a fast simplified plan: top Swiggy result for the situation type, no comparison table, no explanation. Mark as "Quick plan — full analysis is taking longer than usual." | If LLM is fully down, return a static template-based recommendation based on situation type and profile. |
| User is offline | Detect via `navigator.onLine`. Show the last generated recommendation from localStorage. Disable execution buttons. Show "You're offline — here's your last plan." | |

**Implementation rule:** every API call in the Tool Agent is wrapped in a try-catch that returns a typed `{ available: false, reason: string }` instead of throwing. The Planning Engine checks `available` before including a service path in the comparison. Unavailable paths are silently excluded from scoring, not surfaced as errors.

The user sees a reduced plan. They never see an error screen.

---

## What Is Explicitly Out of V1

These are real features worth building. They are not here because they compete for the same 3-week window as the features that make the demo work.

| Feature | Why Deferred |
|---|---|
| BullMQ / job queues | All agent work is synchronous in V1. Queues are needed for reminders and scheduled plans; that complexity is not worth it until M7. |
| Turborepo / monorepo | One Next.js app handles everything in V1. No benefit without multiple deployable services. |
| Background workers | Same reason as BullMQ. |
| pgvector / semantic memory | Structured facts cover 90% of memory use cases. Add embeddings when V1 proves the memory model. |
| Scheduler Agent | Standalone agent. Useful. Not needed for the core demo loop. |
| Multi-week meal plans | Useful. Not core to the first impression. |
| Calendar integration | OAuth complexity not worth it for V1. |
| WhatsApp / Alexa | Planning Engine is ready for these; the interfaces are out of scope. |
| Native apps | Web-first. Build the product before the platform. |
| Full nutrition tracking | The Planning Agent uses estimated macros. Full USDA food database integration is a V2 data problem. |
| Social or shared plans | Completely separate product surface. |
| Image-based pantry scanning | Computer vision pipeline. V3 at earliest. |

---

## Technology Stack: V1

Everything removed that the staff engineer flagged. Nothing added that is not needed for the demo loop.

| Layer | Technology | Why |
|---|---|---|
| Framework | Next.js 16 App Router | Single app, frontend + API routes in one repo |
| Language | TypeScript (strict mode) | Non-negotiable from day one |
| Styling | Port `mealos.css` into Tailwind + CSS Modules | Preserve the design system with scoping |
| LLM | Claude claude-sonnet-4-6 | One model for all agents in V1. claude-haiku-4-5 for classification only |
| Auth | Clerk | Fastest path to working auth with social login |
| Database | PostgreSQL (Neon or Railway) | Managed, no ops overhead |
| ORM | Prisma | Type-safe, good migration workflow |
| Cache | None in V1 | Premature. Add Redis when you measure a need. |
| Job queues | None in V1 | Synchronous pipeline only |
| Real-time | SSE (Server-Sent Events) via Next.js route handlers | Simpler than WebSocket, sufficient for Planning Graph updates |
| External APIs | Swiggy MCP + YouTube Data API v3 | Both required for the demo loop |
| Voice | Web Speech API (browser-native) | Zero dependencies, works in Chrome and Safari |
| State | Zustand (global) + TanStack Query (server) | Zustand for board/UI state, TQ for API calls |
| Hosting | Vercel (all-in-one) | One deploy target for everything |
| Error tracking | Sentry | Install on day one, not after the first production error |

No Turborepo. No monorepo. No BullMQ. No Redis. No pgvector. No workers. Not yet.

---

## Agent Design: V1 (4 Agents)

The ten-agent system in ARCHITECTURE.md is the correct long-term design. In V1, everything collapses into four agents. Budget, Nutrition, Recipe, and Scheduler are not separate agents — they are modules called from inside the Planning Agent.

### Agent 1: Conversation Agent (claude-haiku-4-5)

**Does:** Parse input → classify situation type → extract explicit facts → identify what is missing.

**Input:** Raw user text, timestamp, user timezone, previous situation type (for continuity).

**Output:**
```typescript
{
  situationType: SituationType,
  explicit: Partial<SituationContext>,
  confidence: number,          // 0–100
  missingRequired: string[],   // fields that must be known for this situation type
  missingSoft: string[],       // fields that would improve the recommendation
}
```

**Latency target:** Under 800ms. This must feel instant.

---

### Agent 2: Planning Agent (claude-sonnet-4-6)

**Does:** Given a complete context, evaluate all three service paths simultaneously, score each, produce a comparison table, select a primary recommendation, write the explanation, and return structured plan data.

This agent contains the Decision Engine logic. Budget analysis, nutrition calculation, recipe feasibility, and time estimation are all computed within this agent's tool calls — not by separate agents.

**Input:** Complete SituationContext (post-clarification), user profile, Swiggy MCP results, YouTube search result.

**Output:**
```typescript
{
  comparison: {
    cook: PlanOption | null,
    order: PlanOption | null,
    dineout: PlanOption | null,
  },
  primaryPath: "cook" | "order" | "dineout",
  explanation: string,         // plain language, 1–3 sentences
  confidence: number,
  primaryRecommendation: PlanItem,
}

PlanOption {
  score: number,              // 0–100
  estimatedCost: number,
  estimatedTime: number,
  proteinEstimate?: number,
  calorieEstimate?: number,
  effort: "none" | "low" | "medium" | "high",
}
```

**Latency target:** Under 4 seconds including Tool Agent calls. The Planning Graph keeps the user occupied.

**Tools available to this agent:**
- `swiggy.searchRestaurants` — via Tool Agent
- `swiggy.searchInstamart` — via Tool Agent
- `youtube.searchRecipeVideo` — via Tool Agent
- `memory.getUserFacts` — direct call to Memory Agent
- `nutrition.estimateMacros` — internal calculation function (not a separate agent)
- `pantry.checkIngredients` — reads from database

---

### Agent 3: Tool Agent (claude-haiku-4-5)

**Does:** Execute all external API calls on behalf of the Planning Agent. Swiggy MCP, YouTube API. Returns structured results.

Keeping external calls in a dedicated agent means the Planning Agent's prompt stays focused on reasoning, not API schemas.

**Input:** Tool name + parameters from Planning Agent.

**Output:** Typed API response, normalized to internal types.

**Failure handling:** If Swiggy MCP is unavailable, return a degraded response with `available: false`. The Planning Agent suppresses the Order and Dine Out options and surfaces a degraded confidence notice. The app still works — it just recommends cooking only.

---

### Agent 4: Memory Agent (claude-haiku-4-5)

**Does:** After a situation completes, extract new persistent facts from the interaction and write them to the database. Never blocks the main flow — always async.

**Runs:** Post-execution, not during. This agent never adds latency to the user experience.

**Input:** Completed situation context, clarification answers, what the user executed.

**Output:** List of facts to upsert into `user_memory_facts`.

**Examples of what it extracts:**
- User answered "150g protein" → stores `fitness.protein_target = 150`
- User executed a cooking plan twice → increments `preference.mealPreference.cook`
- User dismissed every delivery recommendation this week → notes `preference.delivery.avoidance = transient`

---

### Agent Orchestration: Synchronous in V1

```
POST /api/v1/situations
     │
     ▼ (immediate)
Conversation Agent (~800ms)
     │
     ├── confidence ≥ 75? ──► skip to Planning
     │
     └── confidence < 75? ──► respond with clarification questions
                                    │
                               User answers
                                    │
                              POST /api/v1/situations/:id/clarify
                                    │
                                    ▼
                              Update context
                                    │
                                    ▼
Planning Agent fires (Tool Agent called inside)
     │                    (~3–5 seconds total)
     ▼
Plan ready → SSE event → UI renders
     │
User executes
     │
     ▼ (async, does not block)
Memory Agent runs
```

SSE events emitted throughout planning:
```
event: step_complete  data: { step: "context_loaded" }
event: step_complete  data: { step: "swiggy_searched" }
event: step_complete  data: { step: "options_scored" }
event: plan_ready     data: { recommendation_id: "uuid" }
```

The Planning Graph in the UI subscribes to these and animates each node.

---

## Database: V1 (Simplified Schema)

Five tables only. Everything else deferred.

```sql
-- Authentication handled by Clerk; this is our extension table
users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id        VARCHAR(255) UNIQUE NOT NULL,
  email           VARCHAR(255) UNIQUE NOT NULL,
  name            VARCHAR(255),
  created_at      TIMESTAMPTZ DEFAULT NOW()
)

-- Structured memory: one row per user per fact
user_memory_facts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  fact_key        VARCHAR(255) NOT NULL,
  fact_value      JSONB NOT NULL,
  source          VARCHAR(50),  -- onboarding, clarification, agent_inferred, user_edited
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, fact_key)
)

-- The core event: one row per user food situation
situations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  raw_input       TEXT NOT NULL,
  situation_type  VARCHAR(50),
  status          VARCHAR(30) DEFAULT 'created',
  -- created | clarifying | planning | plan_ready | executed | abandoned
  context         JSONB,        -- full SituationContext after enrichment
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  plan_ready_at   TIMESTAMPTZ,
  executed_at     TIMESTAMPTZ
)

-- The plan produced for a situation
recommendations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  situation_id    UUID REFERENCES situations(id) ON DELETE CASCADE UNIQUE,
  
  -- Comparison data
  comparison      JSONB NOT NULL,   -- { cook: PlanOption, order: PlanOption, dineout: PlanOption }
  primary_path    VARCHAR(20),      -- cook | order | dineout
  explanation     TEXT,
  confidence      INTEGER,          -- 0–100
  
  -- Primary item
  title           TEXT,
  description     TEXT,
  estimated_cost  INTEGER,
  estimated_time  INTEGER,
  protein_g       INTEGER,
  calories        INTEGER,
  
  -- Execution data
  youtube_url     TEXT,
  youtube_thumb   TEXT,
  instamart_items JSONB,    -- items to add to cart
  swiggy_data     JSONB,    -- restaurant + menu data for ordering
  recipe_steps    JSONB,    -- step-by-step if cooking
  
  created_at      TIMESTAMPTZ DEFAULT NOW()
)

-- What the user did with the recommendation
user_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  situation_id    UUID REFERENCES situations(id),
  action_type     VARCHAR(50),   -- executed_cook | executed_order | executed_dineout | dismissed
  rating          INTEGER,       -- 1–5, if provided
  executed_at     TIMESTAMPTZ DEFAULT NOW()
)
```

Pantry, meal history, scheduled meals, agent run logs, and analytics events are all deferred to V2. They are designed in ARCHITECTURE.md and can be added without schema changes to the existing tables.

---

## API Contracts: V1

### POST /api/v1/situations
```
Request:  { input: string, location?: { lat: number, lng: number } }
Response: { situation_id: string, stream_url: string }
```

### GET /api/v1/situations/:id/stream
SSE endpoint. Events: `step_complete`, `clarification_needed`, `plan_ready`, `error`

### POST /api/v1/situations/:id/clarify
```
Request:  { answers: Record<string, any> }
Response: { status: "context_ready" | "more_questions", next_questions?: Question[] }
```

### GET /api/v1/recommendations/:id
Returns the full recommendation with comparison, explanation, YouTube data, and Instamart items.

### POST /api/v1/recommendations/:id/execute
```
Request:  { path: "cook" | "order" | "dineout" }
Response: { action_id: string, redirect_url?: string }
```
If order/dineout: returns a Swiggy deep link with pre-filled cart.  
If cook: marks as started, returns `null` redirect (user stays in app).

### GET /api/v1/memory
Returns the user's full `user_memory_facts` map.

### PATCH /api/v1/memory
```
Request:  { updates: { key: string, value: any }[] }
Response: { updated: number }
```

### POST /api/v1/onboarding
Called once on first login. Stores the 5 onboarding answers into `user_memory_facts` atomically.

---

## File Structure: V1

Single Next.js app. No packages subdirectory. No workers.

```
mealos/
├── app/
│   ├── (auth)/
│   │   ├── sign-in/page.tsx
│   │   └── sign-up/page.tsx
│   ├── (app)/
│   │   ├── layout.tsx              # App shell: navbar + memory drawer
│   │   ├── page.tsx                # Situation input (home)
│   │   ├── onboarding/page.tsx     # First-run setup
│   │   ├── history/page.tsx        # Past situations
│   │   └── memory/page.tsx         # Memory panel (mobile full-page)
│   ├── api/
│   │   └── v1/
│   │       ├── situations/
│   │       │   ├── route.ts             # POST
│   │       │   └── [id]/
│   │       │       ├── route.ts         # GET
│   │       │       ├── stream/route.ts  # SSE
│   │       │       └── clarify/route.ts # POST
│   │       ├── recommendations/
│   │       │   └── [id]/
│   │       │       ├── route.ts         # GET
│   │       │       └── execute/route.ts # POST
│   │       ├── memory/route.ts          # GET + PATCH
│   │       └── onboarding/route.ts      # POST
│   ├── globals.css
│   └── layout.tsx
│
├── components/
│   ├── situation/
│   │   ├── SituationInput.tsx      # Text + voice input
│   │   ├── VoiceButton.tsx         # Web Speech API integration
│   │   └── QuickTemplates.tsx      # Tap-to-fill situation chips
│   ├── board/
│   │   ├── SituationBoard.tsx      # Root board component
│   │   ├── ConfidenceCard.tsx      # Shows score + known/unknown fields
│   │   ├── ClarificationCard.tsx   # Smart question + quick-tap options
│   │   ├── PlanningGraph.tsx       # Step-by-step progress visualization
│   │   ├── ComparisonTable.tsx     # Cook vs Order vs Dine with scores
│   │   ├── DecisionCard.tsx        # Winner + explanation
│   │   └── RecommendationCard.tsx  # Full plan: recipe/order + YouTube + Instamart
│   ├── memory/
│   │   ├── MemoryDrawer.tsx        # Slide-in on desktop
│   │   └── FactRow.tsx             # Editable fact row
│   └── ui/
│       ├── Button.tsx
│       ├── Card.tsx
│       ├── Chip.tsx
│       ├── Toast.tsx
│       └── Skeleton.tsx
│
├── lib/
│   ├── agents/
│   │   ├── conversation.ts         # Conversation Agent
│   │   ├── planning.ts             # Planning Agent (Decision Engine inside)
│   │   ├── tool.ts                 # Tool Agent (Swiggy MCP + YouTube)
│   │   └── memory.ts               # Memory Agent
│   ├── mcp/
│   │   └── swiggy.ts               # Swiggy MCP client
│   ├── youtube.ts                  # YouTube Data API v3 client
│   ├── db.ts                       # Prisma client singleton
│   ├── claude.ts                   # Anthropic SDK client
│   └── sse.ts                      # SSE stream utilities
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
├── stores/
│   ├── situationStore.ts           # Zustand: active situation + board state
│   └── userStore.ts                # Zustand: user profile cache
│
├── types/
│   ├── situation.ts
│   ├── recommendation.ts
│   ├── memory.ts
│   └── agents.ts
│
├── hooks/
│   ├── useSituationStream.ts       # SSE hook for Planning Graph updates
│   ├── useSituation.ts
│   └── useMemory.ts
│
├── styles/
│   └── mealos.css                  # Ported from prototype, scoped
│
├── .env.local.example
├── next.config.ts
├── tsconfig.json                   # strict: true
├── prisma/schema.prisma
└── package.json
```

---

## 3-Week Build Timeline

### Week 1: Foundation + Intelligence Core

| Day | Work |
|---|---|
| 1 | Repo setup. Next.js + TypeScript strict. Prisma + Neon. Clerk auth. Deploy to Vercel. |
| 2 | Onboarding flow (5 questions → `user_memory_facts`). Memory Panel (read-only). |
| 3 | Situation input UI. Voice button (Web Speech API). Quick template chips. |
| 4 | Conversation Agent. POST /situations. SSE infrastructure. Planning Graph UI (static first). |
| 5 | Confidence Score calculation. Clarification Engine. ClarificationCard UI. |
| 6 | Full clarification flow: questions → answers → context update → planning trigger. |
| 7 | Integration test of the full input-to-clarification pipeline. Fix edge cases. |

**End of Week 1 check:** User can log in, complete onboarding, type a situation, get clarification questions, answer them, and see "Planning your situation..." with a live Planning Graph.

---

### Week 2: The Decision Engine + Integrations

| Day | Work |
|---|---|
| 8 | Planning Agent scaffold. Tool Agent. Swiggy MCP client for food delivery search. |
| 9 | Planning Agent: Cook vs Order vs Dine scoring. ComparisonTable UI. DecisionCard UI. |
| 10 | YouTube Data API v3 integration. Attach video to recipe recommendations. |
| 11 | Instamart item search via Swiggy MCP. Cart pre-fill deep link to Swiggy. |
| 12 | RecommendationCard UI: full plan with YouTube card + Instamart list + recipe steps. |
| 13 | Memory Panel: make editable. PATCH /memory. Fact validation. |
| 14 | Memory Agent (async post-execution). user_actions logging. Feedback (thumbs up/down). |

**End of Week 2 check:** Full demo loop works. Speak a situation → confidence card → 1 question → comparison table → recommendation with YouTube video → "Add to Instamart" opens Swiggy with cart pre-filled.

---

### Week 3: Polish + Demo Readiness

| Day | Work |
|---|---|
| 15 | Voice UX polish: transcription display, loading state during recognition, error handling. |
| 16 | Planning Graph animation polish. SSE reconnection on disconnect. Skeleton loaders. |
| 17 | Mobile responsiveness audit. Touch targets. Drawer vs sidebar at breakpoints. |
| 18 | Error states: Swiggy unavailable, LLM timeout, no Instamart results. Graceful degradation. |
| 19 | History page: past situations, re-run button. Onboarding re-entry from Memory Panel. |
| 20 | Sentry setup. LLM cost tracking log. Performance profiling (P95 situation-to-plan < 6 seconds). |
| 21 | Demo recording. Recruiter flow rehearsal. README with setup instructions. |

**End of Week 3:** Deployable product. One polished end-to-end flow. Under 6 seconds from voice input to full recommendation.

---

## The Recruiter Demo Script

This is what you show. 90 seconds.

```
"MealOS is a food planning engine. Not a search box.
You describe your situation. It reasons across cooking, delivery, and dining out
and tells you exactly what to do — and why.

Watch."

[Tap microphone]

"I want to hit 150 grams of protein today."

[Confidence card appears]

"It immediately shows me what it knows and what it still needs."

[One question appears: "For your full day, or just dinner?"]

[Tap: Full day]

[Planning Graph animates through 4 steps]

"It's checking Swiggy, looking at my profile, scoring three paths."

[Comparison table appears: Cook 92, Order 71, Dine Out 44]

"Cook wins. It explains why — ordering can't hit 150g protein on a
vegetarian diet within my ₹350 budget."

[Recommendation card expands: Paneer Bhurji + Rajma + Brown Rice]

[Tap YouTube card]

"Recipe tutorial, attached automatically."

[Tap Add to Instamart]

"Swiggy opens. Three missing ingredients are in the cart. 14-minute delivery."

"That's the full flow. Situation → reasoning → execution. Under 90 seconds."
```

That demo is self-explanatory, technically impressive, and shows product judgment. It is more memorable than any feature list.

---

## Future Scope

Everything below is real and worth building. It is deferred — not cancelled.

### Agent System Evolution (Post-V1)

The 10-agent architecture in ARCHITECTURE.md is the target. As the Planning Agent grows, extract:

1. **Budget Agent** — when financial reasoning becomes complex enough to need its own prompt and context
2. **Nutrition Agent** — when nutrition tracking needs a full food database (USDA, Nutritionix) and meal logging
3. **Recipe Agent** — when the recipe library grows and needs semantic search across 10,000+ recipes
4. **Scheduler Agent** — when weekly meal prep and scheduled reminders need their own pipeline
5. **Swiggy Agent** — when Swiggy MCP calls are complex enough to need dedicated context and retry logic

Extract agents when complexity demands it, not before. A module inside Planning Agent that becomes hard to reason about is the right signal.

### Infrastructure Evolution (Post-V1)

| Technology | When to Add | Trigger |
|---|---|---|
| Redis + BullMQ | When reminders and scheduled plans ship | The Scheduler Agent needs to fire at specific times, which requires persistent background jobs |
| Turborepo / monorepo | When a second deployable service exists (e.g., standalone workers) | If `apps/workers` needs a separate deploy cadence from `apps/web` |
| pgvector | When structured memory misses important context | The Memory Agent should flag when it's losing relevant past situations that structured facts can't capture |
| Multi-region Postgres | When P99 DB latency is the bottleneck | Measure first |
| Dedicated observability (Axiom) | At 1,000 DAU | Vercel logs + Sentry cover the early period |

### Memory Evolution (Post-V1)

- Semantic memory via pgvector: embed conversation summaries for fuzzy retrieval of past situations
- Pantry tracking with expiry dates and usage history
- Full meal history with logged macros
- Preference drift detection: cuisine preferences update with a weighted decay over time

### Feature Evolution (Post-V1)

**Scheduling and proactive intelligence**
- Weekly meal prep planner with Instamart shopping list
- Recurring meal reminders with pre-populated situations
- "You usually order on Fridays — shall I set a reminder?"

**AI-guided cooking (V2)**
- Parse the YouTube recipe transcript
- Synchronize transcript with recipe steps
- Voice-guided step-by-step: "Now add the ginger paste and stir for 2 minutes"
- Timer integration for each step

**Explainable Planning Timeline (V2)**

Distinct from the Planning Graph (which shows pipeline architecture). This is a user-facing reasoning log that appears after the plan is ready:

```
✓ Understood: you're sick, alone, need delivery
✓ Loaded your preferences: vegetarian, budget ₹350
✓ Checked pantry: 4 items available
✓ Searched 22 restaurants near Bandra
✓ Filtered to 6 vegetarian comfort food options
✓ Estimated nutrition for top 3
✓ Generated recommendation
```

The Planning Graph shows the system working. This timeline shows the system thinking. Together they make the AI feel alive and trustworthy rather than opaque.

**"Why Not?" — Recommendation Challenger (V2)**

Every recommendation surfaces a "Why didn't you recommend ordering?" link. Tapping it opens a concise explanation:

```
WHY NOT ORDER?

• ₹640 exceeds your ₹350 daily budget
• Best delivery option reaches only 98g protein
• You already have 70% of the cooking ingredients
• Cooking hits your goal; ordering doesn't

[Still want to order?]
```

The system does not hide alternatives. It defends its choice and then lets the user override it. This turns the Decision Engine from an oracle into a collaborator — and it gives users a reason to trust recommendations they initially disagree with.

**Multi-interface Planning Engine (V2–V3)**
The Planning Engine is already interface-agnostic. Attach:
- WhatsApp bot: user messages MealOS on WhatsApp, gets a reply with the plan
- Google Assistant / Alexa integration
- iOS widget: quick situation templates directly from the home screen
- Email digest: weekly meal plan sent Sunday morning

**Voice-first UI (V2)**
- Full voice-in, voice-out mode
- Spoken plan comparison: "I found three options. Cook gets a 92, order gets a 71..."
- Hands-free cooking guidance

**Social and household (V3)**
- Shared household profiles: plan for a family, not just one person
- Partner meal coordination: "Your partner wants Thai, you want high protein — here's a compromise"

**Platform expansion**
- Zomato MCP (if and when available)
- Calendar API integration: know when the user has gym, meetings, or travel
- Health API integration: sync with Apple Health or Google Fit for real calorie and activity data

---

## The Four Things That Make This Resume-Worthy

If you build only the V1 defined above, four things will make every technical interviewer remember this project.

**1. The Confidence Score**  
Almost no consumer AI product shows the user why the AI is confident or not. It is transparent reasoning. It signals product maturity and engineering judgment. Every person who sees it will ask how it works.

**2. Deterministic Scoring + LLM Explanation**  
The scores are TypeScript. Claude writes the sentence explaining the winner. This separation — deterministic engine, generative narration — is what a Staff Engineer recommends and what most junior engineers get wrong. When an interviewer asks "how do you ensure consistent recommendations?", you have a precise, testable answer.

**3. The End-to-End Cooking Flow**  
Voice → confidence → plan → pantry check → Instamart cart → delivery ETA → YouTube → step-by-step cooking with inline clips. This is not four separate features. It is one coherent flow that no food app has shipped. The recruiter demo ends with Swiggy open, ingredients ordered, and a cooking guide on screen. That is a closing argument, not a feature list.

**4. The Loop That Never Ends**  
Every situation teaches the system something. The Situation → Decision → Execution → Learning loop is visible on every screen. The user can see their memory panel update after they answer a clarification question. They can see the confidence score rise as the system learns. Most AI apps are stateless. This one accumulates intelligence with every use. That is the pitch: it gets better the longer you use it.

The worst outcome for this project is ten partially implemented subsystems. The best outcome is one flow, done completely, that is fast, intelligent, and executable.

Build that. Ship it. Then add everything else.

---

## Planning Phase: Complete

Three documents exist:
- `STATUS.md` — What the prototype is and is not
- `ARCHITECTURE.md` — The full long-term system (10 agents, Turborepo, pgvector, all 12 tables, all workflows)
- `MVP.md` — What ships in 3 weeks and why

The planning phase is done. The next action is Day 1 of the build timeline: repo setup, TypeScript strict, Prisma, Neon, Clerk, first Vercel deploy.

---

*MVP.md — end*  
*Full long-term architecture: see ARCHITECTURE.md*  
*Current prototype analysis: see STATUS.md*
