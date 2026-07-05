# MealOS AI — Architecture Document
**Role:** Lead Staff AI Engineer / Principal Architect / PM / Technical Lead  
**Date:** 2026-07-05  
**Status:** Pre-production planning document. No code was generated.

---

## Table of Contents

1. [Phase 1 — Architecture Audit](#phase-1--architecture-audit)
2. [Phase 2 — Product Redefinition](#phase-2--product-redefinition)
3. [Phase 3 — System Architecture](#phase-3--system-architecture)
4. [Phase 4 — Clarification Engine](#phase-4--clarification-engine)
5. [Phase 5 — Agent Design](#phase-5--agent-design)
6. [Phase 6 — Long-Term Memory](#phase-6--long-term-memory)
7. [Phase 7 — Workflows](#phase-7--workflows)
8. [Phase 8 — Database Schema](#phase-8--database-schema)
9. [Phase 9 — API Contracts](#phase-9--api-contracts)
10. [Phase 10 — Project Structure](#phase-10--project-structure)
11. [Phase 11 — Implementation Roadmap](#phase-11--implementation-roadmap)

---

## Phase 1 — Architecture Audit

### What Was Built

A 196-line React monolith (`MealOSApp.tsx`) containing the entire application: routing logic, all five UI screens, all business logic, and all data in a single file. There is no backend, no API, no AI, no authentication, and no state management beyond local `useState`. The `/chat` route renders the identical component as the homepage.

The only genuinely reusable artifact is `mealos.css` — 1,266 lines of well-structured design tokens, CSS custom properties, theme variants, and animation keyframes that form a coherent visual language.

---

### What Is Reusable

| Artifact | Verdict | Why |
|---|---|---|
| `mealos.css` | **Keep entirely** | Solid design token system, 5 theme variants, clean animation keyframes, responsive breakpoints |
| `globals.css` | **Keep the design variables** | Brand colors (`--yellow`, `--red`, etc.) are good; font import should move to `next/font` |
| TypeScript types in `data.ts` | **Extract and promote** | `Recipe`, `Restaurant`, `DineoutPlace` are the right domain shapes, just need fields added |
| The 5-mode concept | **Keep the taxonomy, discard the UX** | Cook / Order / Dine / LateNight are real user intents; the tab-switching UX is wrong |
| Next.js App Router structure | **Keep** | Correct foundation; `app/` directory is the right choice |

---

### What Should Be Deleted

- **`MealOSApp.tsx`** — A prototype proof-of-concept. Cannot be incrementally evolved into production code. Replace with a properly decomposed component tree.
- **`data.ts` (the mock data arrays)** — All 150+ fabricated records. The type definitions are salvageable; the data is not.
- **`app/chat/page.tsx`** — Dead route. Renders the same component as the homepage with no differentiation.
- **The `modeFromQuery` function** — Regex intent routing (`/cook|recipe|home|healthy/`) is not AI. It is embarrassing to ship. Delete it.
- **The `source.unsplash.com` image URLs** — The Unsplash Source API was deprecated in January 2024. Every `<img>` in the current app returns a 301 redirect to a generic broken image in production.

---

### Technical Debt Inventory

**Architecture-level**

1. **No separation of concerns.** Data fetching, business logic, state, and rendering are in one file. This will not survive a second developer or a second week of feature work.
2. **No state management.** Everything is `useState`. When the user's situation affects multiple screens simultaneously (e.g., their budget constraint), there is no mechanism to propagate that across components without prop-drilling or a complete rewrite.
3. **No error boundaries.** Any runtime error kills the entire app with a white screen.
4. **`useMemo` for screen switching is an antipattern.** The memo wraps JSX construction, not expensive computation. It prevents nothing and adds confusion.

**Frontend-specific**

5. **Global CSS namespace.** All 1,266 lines of `mealos.css` are global. Adding a second developer guarantees class name collisions within weeks. Scoping strategy is required (CSS Modules or CSS-in-JS or Tailwind component composition).
6. **Google Fonts via `@import` in CSS.** Blocks render. Should use `next/font` for font subsetting and local hosting.
7. **No `next/image`.** All `<img>` tags are raw HTML, losing automatic optimization, lazy loading, size attributes, and format negotiation.
8. **No accessibility.** No ARIA roles on interactive elements. Keyboard navigation is untested. The "search icon" renders the literal text "AI". The chip icons render "CK", "OD", "DN", "LN".
9. **No loading states.** There is no concept of data being fetched. Every list renders instantly or not at all.
10. **Empty `next.config.ts`.** No image domain allowlist, no security headers, no CSP, no redirect rules.

**Type safety**

11. **TypeScript is present but ceremonial.** No strict mode. No `noUncheckedIndexedAccess`. The `Mode` union type is good; everything else is permissive.

---

### Scalability Issues

1. **The 5-mode paradigm does not scale to the real product vision.** "Sick + alone + no groceries + Rs 150 budget" cannot be expressed as a chip selection. The UX architecture is fundamentally misaligned with the product.
2. **Client-side data.** Expanding mock data from 4 base items to 30/45/26/28 via a `for` loop runs at component render time in the browser. Real data will come from APIs; there is no data layer to swap into.
3. **No caching strategy.** No concept of stale-while-revalidate, optimistic updates, or background refresh.
4. **Single-page architecture.** All screens are in one component tree. Deep-linking to a specific recipe, restaurant, or recommendation is impossible.
5. **No multi-tenancy.** The app has no concept of a user. Every session starts blank.

---

### Bad Assumptions

| Assumption | Reality |
|---|---|
| Users know what kind of solution they want (cook vs. order vs. dine) | Most users know their *problem* (hungry, sick, planning, broke), not the solution category |
| Intent can be inferred from 5 keywords via regex | Intent is contextual, ambiguous, and multi-dimensional |
| Four chips cover the solution space | "I want to meal prep for the week" has no chip. "Host a party" has no chip. |
| Swiggy is the only integration needed | Weather, calendar, pantry, nutrition data, and location are equally important inputs |
| The AI label on the search icon implies capability | It does not. This will create negative first impressions when users discover it is a static list. |
| Images are cosmetic | They are not. Food images are a primary conversion driver in food apps. A solution without real images will feel unfinished. |

---

### Missing Architecture

- Authentication and identity
- Backend / API layer
- Database and persistence
- AI/LLM integration
- Long-term memory
- Swiggy MCP client
- Event system
- Notification infrastructure
- Analytics and observability
- Error handling and monitoring
- Deployment pipeline
- Environment configuration

---

### Opportunities

1. **The CSS design system is genuinely good.** Five themed modes with smooth transitions is a real differentiator. Productize it properly with CSS Modules.
2. **Event-driven UI is the right paradigm.** Rather than a chat interface, the "situation → plan" model is novel and better suited to food decisions that involve multiple services.
3. **Memory as competitive moat.** A system that remembers your allergies, usual budget, kitchen equipment, and past orders is 10× more valuable than one that asks you every time.
4. **Multi-service reasoning is unoccupied.** No product today reasons across cook / order / dine / grocery simultaneously based on constraints. This is the real product.

---

### Migration Plan: Prototype to Production

The current prototype should be treated as a **design reference only**. The migration is a greenfield build with the design system ported over, not an incremental refactor. Trying to evolve `MealOSApp.tsx` into production code will take longer and produce worse results than starting the component tree fresh with proper architecture.

Migration approach:
1. Extract and formalize the CSS design system (Phase 1 of implementation)
2. Stand up the backend and database (Phase 2)
3. Build authentication (Phase 3)
4. Build the AI core (Phase 4)
5. Rebuild the frontend against real APIs (Phase 5+)

The prototype's chip labels, theme colors, and animation style are worth referencing throughout. Its code structure is not.

---

## Phase 2 — Product Redefinition

### What the Current Product Does

> "Choose how you want to solve your food problem."

The user picks a mode (Cook / Order / Dine / Late Night) and sees a static list. There is no intelligence, no personalization, no memory, no reasoning.

### What the Product Should Be

> **MealOS AI is the operating system for your food life.**

It understands your situation — not just your craving — and reasons across every available service, constraint, and preference to decide what you should do and orchestrate the execution.

The user does not pick a mode. The user describes a situation. The system decides whether to cook, order, dine, prep, shop, or combine multiple solutions. The user reviews and confirms.

---

### Input Dimensions

The AI reasons across all of these simultaneously:

| Dimension | Examples |
|---|---|
| **Situation** | Sick, hungry, celebrating, broke, hosting, rushed, bored |
| **Time** | 15 minutes, tonight, this weekend, all week |
| **Budget** | Rs 50, Rs 500, no constraint |
| **Nutrition goals** | 180g protein, low carb, 1800 kcal, allergy-free |
| **Social context** | Alone, partner, family, 15 guests, office |
| **Location** | Home, office, travelling |
| **Pantry state** | Empty, have basics, have specific ingredients |
| **Cooking ability** | Can't cook, beginner, confident |
| **Calendar** | Gym tonight, meeting at lunch, flight tomorrow |
| **Weather** | Too hot to cook, monsoon, comfortable |
| **Long-term memory** | Prefers vegetarian, allergic to shellfish, Rs 300 daily food budget |

---

### Output Modes

The AI produces a **Situation Plan** — not a list of options, but an opinionated recommendation with ranked alternatives:

| Plan Type | When |
|---|---|
| **Single action** | "Order butter chicken from Behrouz" |
| **Timed sequence** | "Cook pasta tonight (30 min), order lunch tomorrow" |
| **Multi-service** | "Buy these 6 items from Instamart (delivered in 15 min), then cook" |
| **Weekly plan** | "Meal prep Sunday, Swiggy Mon/Tue, cook Wed–Fri" |
| **Party plan** | "Order from 3 restaurants for the IPL party: appetizers from X, mains from Y, dessert from Z" |

---

### Event-Driven vs. Chat-Driven: The Key Distinction

**Chat-driven** (wrong for this product):
```
User: I'm hungry
AI: What would you like to eat?
User: Something healthy
AI: Here are some healthy options...
```

This is a search box with extra steps. It's slower than Google.

**Event-driven** (right for this product):
```
User inputs: "I'm sick and tired"
→ SituationEvent emitted
→ ContextAgent evaluates: {sick=true, alone=?, can_cook=?, budget=?}
→ ClarificationAgent: 2 questions needed
→ UI: two focused questions appear
→ User answers
→ PlanningAgent fires in parallel with BudgetAgent, NutritionAgent
→ SwiggyAgent queries comfort food delivery
→ Plan assembles progressively in UI
→ User sees: "Khichdi recipe (you have the ingredients) OR Behrouz soup delivery (38 min)"
→ One tap to execute
```

The UI is a **Situation Board**, not a chat window. Cards appear progressively. The user taps, not types. The system works, not the user.

---

## Phase 3 — System Architecture

### High-Level Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLIENT (Browser)                               │
│                                                                         │
│   ┌─────────────────┐    ┌──────────────────┐    ┌───────────────────┐  │
│   │  Situation Input │    │  Situation Board  │    │  Execution Layer  │  │
│   │  (text/voice)   │    │  (progressive UI) │    │  (confirm & act)  │  │
│   └────────┬────────┘    └────────┬──────────┘    └─────────┬─────────┘  │
│            │                     │ SSE stream               │             │
└────────────┼─────────────────────┼──────────────────────────┼─────────────┘
             │ HTTPS               │                          │ HTTPS
┌────────────▼─────────────────────▼──────────────────────────▼─────────────┐
│                        API Layer (Next.js API Routes)                      │
│              Auth (Clerk/NextAuth) · Rate Limiting · Input Validation      │
└──────┬───────────┬──────────────┬───────────────┬────────────┬─────────────┘
       │           │              │               │            │
       ▼           ▼              ▼               ▼            ▼
 Situation     Memory          User           Swiggy      Notification
  Service      Service        Service          MCP          Service
       │           │              │               │
       └───────────┴──────────────┴───────────────┘
                           │
              ┌────────────▼──────────────┐
              │        Event Bus          │
              │  (Redis Streams / BullMQ) │
              └────────────┬──────────────┘
                           │
              ┌────────────▼──────────────┐
              │    Agent Orchestrator     │
              │  (coordinates all agents) │
              └───┬───┬───┬───┬───┬───┬──┘
                  │   │   │   │   │   │
              Intent  Ctx Clarif Plan Budget Nutrition
              Agent  Agent Agent Agent Agent  Agent
                  │   │   │   │   │   │
              Memory Swiggy Recipe Sched Notif Analytics
              Agent   Agent Agent Agent Agent  Agent
```

---

### Component Breakdown

#### Frontend

**Technology:** Next.js 16 App Router, React 19, TypeScript (strict), Tailwind v4, CSS Modules for component-scoped styles

**Key surfaces:**

| Surface | Description |
|---|---|
| **Situation Input** | Single focused text field. Supports natural language, voice (Web Speech API), and quick-tap situation templates. Not a chat box. No message history visible. |
| **Situation Board** | The primary workspace. Cards appear progressively as the agent system processes the situation. Cards: Context Card (what the AI understood), Clarification Card (questions, max 3), Reasoning Card (brief explanation of the plan), Plan Cards (the recommendation items), Execution Card (buttons to act). |
| **Memory Panel** | A side panel (desktop) or drawer (mobile) showing what the system knows about the user. Editable. The user can correct facts. |
| **History** | Past situations and their outcomes. Tap to re-run a situation. |

**State management:** Zustand for global state (user profile, active situation, board state). React Query (TanStack Query) for server state (API calls, caching). SSE for real-time board updates.

**Real-time updates:** Server-Sent Events (SSE) over a `/api/situations/:id/stream` endpoint. Each agent completion pushes a board update event. The UI subscribes and renders cards as they arrive.

---

#### Backend

**Technology:** Next.js API Routes (V1), migrate to standalone Hono/Bun service at scale

**Services:**

| Service | Responsibility |
|---|---|
| **Situation Service** | Receives user situation, validates, stores, emits initial event, manages SSE stream |
| **Memory Service** | Read/write user facts, retrieve relevant context for a situation, update after execution |
| **User Service** | Profile management, preferences, authentication integration |
| **Swiggy MCP Service** | Client for Swiggy MCP — food search, instamart search, dineout search, cart management |
| **Notification Service** | Push notifications, in-app alerts, meal reminders |
| **Analytics Service** | Event tracking, funnel analysis, agent performance metrics |

---

#### Agent Layer

**Technology:** Claude claude-sonnet-4-6 (primary reasoning), Claude claude-haiku-4-5 (fast classification and extraction)

**Orchestration:** BullMQ job queues with Redis. Each situation creates a job. The orchestrator spawns sub-jobs per agent. Results aggregate into the situation record.

**Agent communication:** Agents publish results as Redis Stream events. The orchestrator subscribes, aggregates, and decides when the plan is ready to surface.

---

#### Infrastructure

| Layer | Technology |
|---|---|
| **Database** | PostgreSQL (primary), Redis (cache + event bus + rate limiting) |
| **Vector Store** | pgvector extension on PostgreSQL (avoid external service at V1) |
| **File Storage** | Cloudflare R2 (avatars, pantry photos if needed) |
| **Authentication** | Clerk (fastest path) or NextAuth v5 (more control) |
| **Deployment** | Vercel (frontend + API routes V1), add Railway/Fly.io when workers need persistent processes |
| **CDN** | Vercel Edge Network |
| **Monitoring** | Sentry (errors), Axiom (logs), Vercel Analytics (web vitals) |
| **Background Jobs** | BullMQ + Redis on Railway/Fly.io |
| **CI/CD** | GitHub Actions |
| **Secrets** | Doppler or Vercel Environment Variables |

---

#### Caching Strategy

| Data | TTL | Strategy |
|---|---|---|
| Swiggy restaurant list | 15 min | Redis with stale-while-revalidate |
| Swiggy menu | 30 min | Redis |
| User profile | Session | In-memory + Redis |
| User memory facts | Indefinite | PostgreSQL, invalidated on update |
| Weather data | 1 hour | Redis |
| Recommendation | Until executed | PostgreSQL |
| Agent results | Situation lifetime | Redis |

---

## Phase 4 — Clarification Engine

### The Problem

Most AI food apps fail at clarification in one of two ways:

1. **Too many questions.** The user types "I'm hungry" and the AI asks 8 questions. The user abandons. This is not intelligence; it is a form.
2. **No questions.** The AI guesses and produces a generic recommendation ("here are some popular restaurants"). This is not intelligence; it is a search box.

The Clarification Engine solves this by only asking questions that materially change the recommendation.

---

### Design Principles

1. **Never ask what you already know.** Memory is checked before any question is generated.
2. **Never ask what you can infer.** If it's 11:45 PM and the user says "hungry", time of day answers the "when" question.
3. **Never ask more than 3 questions in a single clarification pass.** If you need more than 3 things, make a reasonable assumption and state it.
4. **Prioritize by expected value.** Ask the question whose answer most changes the recommendation output.
5. **Batch questions.** If 2 questions are needed, ask them together. Do not ask one, wait for the answer, then ask another.
6. **State your assumptions.** "Assuming you're alone and in Mumbai — is that right?"

---

### Clarification Engine Design

#### Step 1: Context Extraction

The Intent Agent parses the user's input and extracts a structured context object:

```
SituationContext {
  explicit: {          // directly stated
    sick: true,
    budget: null,
    time: null,
    alone: null,
    canCook: null,
    guests: null,
    occasion: null,
    location: null,
    craving: null,
    timeConstraint: null,
    nutritionGoal: null,
  },
  inferred: {          // derived from time, history, patterns
    timeOfDay: "dinner",
    isWeekend: false,
    location: "home",  // from stored preference
  },
  fromMemory: {        // retrieved from user profile
    dietaryRestrictions: ["vegetarian"],
    defaultBudget: 350,
    kitchenEquipment: ["gas stove", "mixer"],
    cookingSkill: "intermediate",
    usualLocation: "Bandra, Mumbai",
  }
}
```

#### Step 2: Required Context Analysis

Each situation type has a minimum context requirement (MCR) — the fields that must be known to produce a confident recommendation.

For a "sick" situation:
```
MCR = {
  canCook: REQUIRED,       // determines cook vs. order
  alone: REQUIRED,         // determines portion and service type
  budget: SOFT_REQUIRED,   // use default from memory if available
  craving: OPTIONAL,       // nice to have, not essential
}
```

For a "planning a date" situation:
```
MCR = {
  budget: REQUIRED,
  indoorOutdoor: REQUIRED,
  occasion: SOFT_REQUIRED,  // first date vs. anniversary matters
  cuisine: OPTIONAL,
}
```

#### Step 3: Gap Analysis

The engine compares the context object against the MCR:
- If a REQUIRED field is missing and not in memory → question needed
- If a SOFT_REQUIRED field is missing but a default exists in memory → use default, don't ask
- If an OPTIONAL field is missing → skip

#### Step 4: Question Selection and Prioritization

Questions are scored by expected value of information (EVOI): how much does knowing this change the recommendation?

For a sick user:
- "Can you cook today?" — EVOI = HIGH (determines entire solution path)
- "Are you alone?" — EVOI = MEDIUM (affects portion size, cost)
- "What's your craving?" — EVOI = LOW (nice personalization, not blocking)

Top 2 questions are asked together.

#### Step 5: Question Formulation

Questions are not generic form fields. They are contextually phrased:

| Context | Generic (wrong) | Contextual (right) |
|---|---|---|
| Sick user | "Can you cook?" | "Are you feeling up to cooking, or should we find something to order?" |
| Broke user | "What's your budget?" | "What can you comfortably spend on food today?" |
| Date planner | "Indoor or outdoor?" | "Are you thinking a restaurant or somewhere with an outdoor/rooftop vibe?" |
| Rushed user | "How much time?" | "Are we talking 20 minutes total, or do you have an hour?" |

Questions appear as a **Clarification Card** on the Situation Board — not in a chat interface. Each question is presented as a short text with 2-4 quick-tap answer options and a free-text fallback.

#### Step 6: Answer Integration and Re-evaluation

After the user answers:
1. Answers are merged into the context object
2. New context is checked against MCR
3. If all required fields are now filled → proceed to planning
4. If another required field is still missing → one more pass (max 2 passes total, then assume)
5. Memory service is updated with any new persistent facts (e.g., newly stated budget, dietary restriction)

---

### Clarification Engine Examples

**Situation: "I'm sick"**

Memory check: `{diet: vegetarian, budget: Rs 300, cookingSkill: intermediate, kitchenEquipment: complete}`

Gap analysis: `canCook = missing (REQUIRED), alone = missing (REQUIRED)`

Questions generated (batched):
> "Are you feeling up to cooking today? / And are you home alone, or is someone there who can help?"

Quick options for Q1: `[Yes, I can manage] [No, need something delivered]`  
Quick options for Q2: `[Alone] [Partner/family home] [Someone can cook for me]`

After answers: Context complete. Planning begins immediately.

---

**Situation: "Plan a date"**

Memory check: `{budget: unknown (never set), diet: vegetarian, location: Bandra}`

Gap analysis: `budget = missing (REQUIRED for dineout), indoorOutdoor = missing (REQUIRED)`

Questions generated:
> "What's your budget for the evening? / And are you picturing a restaurant or somewhere with an outdoor vibe?"

Quick options for budget: `[Under Rs 1500] [Rs 1500–3000] [Rs 3000+] [Flexible]`  
Quick options for vibe: `[Cozy restaurant] [Rooftop or outdoor] [Either is fine]`

After answers: Budget and vibe stored in memory for future date plans.

---

**Situation: "I need 180g protein today"**

Memory check: `{diet: vegetarian, meals_logged: 0g protein so far today, ...}`

Gap analysis: Nutrition goal is explicit. No clarification needed.

Immediate action: PlanningAgent fires. Nutrition agent calculates required meals.

No clarification card shown. This is the correct behavior when context is sufficient.

---

## Phase 5 — Agent Design

### Agent Architecture Overview

All agents share a common interface:

```
Agent {
  name: string
  model: "claude-sonnet-4-6" | "claude-haiku-4-5"
  systemPrompt: string
  inputs: SituationContext + AgentInput
  outputs: AgentOutput
  tools: MCPTool[]
  timeout: number (ms)
  retryPolicy: { maxRetries: 2, backoff: "exponential" }
  fallback: AgentOutput  // what to return if agent fails
}
```

Agents communicate through the event bus, not directly. The orchestrator manages sequencing.

---

### Agent 1: Intent Agent

**Model:** claude-haiku-4-5 (fast, cheap, classification task)

**Responsibility:** Convert raw user input into a structured `SituationContext`. Classify the primary situation type, extract explicit facts, identify inferred facts.

**Inputs:**
- Raw user text
- Timestamp
- User timezone
- Session history (last 3 situations)

**Outputs:**
```
{
  situationType: "sick" | "broke" | "date" | "party" | "meal_prep" | "quick_meal" | "nutrition_goal" | "craving" | "planning",
  explicit: { [key]: value },
  inferred: { [key]: value },
  confidence: 0.0–1.0,
  ambiguities: string[],   // things the agent is unsure about
}
```

**Failure handling:** If confidence < 0.6, flag for clarification. Do not guess.

---

### Agent 2: Context Agent

**Model:** claude-haiku-4-5

**Responsibility:** Retrieve relevant memory for the situation and merge with extracted context. Determine what the system already knows, what can be inferred, and what is genuinely missing.

**Inputs:**
- `SituationContext` from Intent Agent
- User ID (to query memory service)

**Outputs:**
```
{
  enrichedContext: SituationContext,  // merged with memory
  knownFields: string[],
  missingFields: { field: string, priority: "required" | "soft" | "optional" }[],
  assumptions: { field: string, value: any, source: "memory" | "inference" }[],
}
```

**Tool access:** `memory.get_relevant_facts(userId, situationContext)`

**Failure handling:** If memory service is down, proceed with blank memory. Log degraded mode.

---

### Agent 3: Clarification Agent

**Model:** claude-sonnet-4-6

**Responsibility:** Determine which questions to ask (if any), how to phrase them, and what quick-tap options to present. This agent is the UX layer of the clarification engine.

**Inputs:**
- `missingFields` from Context Agent
- `situationType`
- `explicit` context (to avoid asking about things already stated)

**Outputs:**
```
{
  needsClarification: boolean,
  questions: {
    text: string,
    field: string,        // which context field this answers
    type: "single_choice" | "multi_choice" | "freetext" | "number",
    options: { label: string, value: any }[],
    required: boolean,
  }[],                    // max 3 items
  assumptions: string[],  // stated assumptions when skipping optional questions
}
```

**Failure handling:** If agent fails, present 1 generic question: "Tell me more about what you need?"

---

### Agent 4: Planning Agent

**Model:** claude-sonnet-4-6 (highest capability needed here)

**Responsibility:** Given a complete context, produce an opinionated situation plan. This is the core intelligence of the product. It reasons across all services and constraints simultaneously.

**Inputs:**
- Complete `SituationContext` (post-clarification)
- Available services (Swiggy Food, Instamart, Dineout, Recipe DB)
- User memory (preferences, history, pantry)
- Agent results from Budget Agent, Nutrition Agent, Swiggy Agent (when available)

**Outputs:**
```
{
  plan: {
    headline: string,          // "Order comfort food — you're sick and alone"
    reasoning: string,         // brief explanation (1-2 sentences)
    primaryRecommendation: PlanItem,
    alternatives: PlanItem[],  // max 2
    timeline: TimelineItem[],  // if multi-step
  },
  planType: "single" | "sequence" | "multi_service" | "weekly",
  confidence: 0.0–1.0,
}

PlanItem {
  service: "swiggy_food" | "instamart" | "dineout" | "recipe" | "meal_prep",
  title: string,
  description: string,
  estimatedCost: number,
  estimatedTime: number,  // minutes
  nutritionSummary?: NutritionInfo,
  actionable: boolean,    // can be executed in-app?
  executionData: any,     // data needed to execute (restaurant ID, recipe ID, etc.)
}
```

**Failure handling:** If planning fails, return a simplified plan with the top Swiggy result for the situation type.

---

### Agent 5: Budget Agent

**Model:** claude-haiku-4-5

**Responsibility:** Analyze the financial dimension of the situation. Calculate cost breakdowns, identify budget-optimal options, flag if the user's desired outcome exceeds their stated or historical budget.

**Inputs:**
- Budget (stated or from memory)
- Candidate recommendations from Planning Agent
- Time in month (beginning vs. end of month affects constraint)

**Outputs:**
```
{
  budgetAssessment: "comfortable" | "tight" | "over_budget",
  recommendedMaxSpend: number,
  costBreakdown: { service: string, amount: number }[],
  savingsSuggestions: string[],
  budgetWarning?: string,
}
```

---

### Agent 6: Nutrition Agent

**Model:** claude-haiku-4-5

**Responsibility:** Handle nutrition-aware situations. Calculate macros for recommended meals, flag dietary conflicts, estimate progress toward daily goals.

**Inputs:**
- Nutrition goal (from situation or memory)
- Dietary restrictions (from memory)
- Meal history for the day (from memory)
- Candidate recommendations

**Outputs:**
```
{
  macroAnalysis: {
    calories: number,
    protein: number,
    carbs: number,
    fat: number,
  },
  goalProgress: { [goal]: { current: number, target: number, remaining: number } },
  conflicts: string[],   // "This contains shellfish (allergy in profile)"
  suggestions: string[], // "Add a protein-rich breakfast to hit your target"
}
```

---

### Agent 7: Swiggy Agent

**Model:** claude-haiku-4-5 (primarily a tool-calling agent, minimal reasoning)

**Responsibility:** Interface with the Swiggy MCP. Search restaurants, menus, and instamart. Return structured results for the Planning Agent to reason over.

**Inputs:**
- Search intent (comfort food, quick delivery, specific cuisine, etc.)
- Location (from user profile or current)
- Budget range
- Dietary filters

**Outputs:**
```
{
  foodDelivery: {
    restaurants: SwiggyRestaurant[],
    estimatedDeliveryTime: number,
    bestMatch: SwiggyRestaurant,
  },
  instamart: {
    items: InstamartItem[],
    totalCost: number,
    deliveryTime: number,  // usually 15-30 min
  },
  dineout: {
    places: DineoutPlace[],
    availability: { [placeId]: TimeSlot[] },
    bestMatch: DineoutPlace,
  },
}
```

**Tool access:** All Swiggy MCP tools: `swiggy.search_restaurants`, `swiggy.search_menu`, `swiggy.search_instamart`, `swiggy.search_dineout`, `swiggy.get_availability`, `swiggy.add_to_cart`

**Failure handling:** If Swiggy MCP is unavailable, Planning Agent falls back to recipe-only recommendations with a degraded mode notice.

---

### Agent 8: Recipe Agent

**Model:** claude-sonnet-4-6

**Responsibility:** Generate or retrieve recipe recommendations. Check pantry availability. Estimate cooking time realistically. Suggest ingredient substitutions.

**Inputs:**
- Craving or nutritional goal
- Pantry state (from memory)
- Cooking skill level (from memory)
- Kitchen equipment (from memory)
- Time available

**Outputs:**
```
{
  recipes: {
    name: string,
    description: string,
    cookingTime: number,      // realistic, not optimistic
    difficulty: "beginner" | "intermediate" | "advanced",
    ingredients: { name: string, qty: string, inPantry: boolean, swiggyItemId?: string }[],
    missingIngredients: string[],
    canMakeNow: boolean,
    nutritionInfo: NutritionInfo,
    steps: CookingStep[],
    instamartShoppingList?: InstamartItem[],  // if missing ingredients can be ordered
  }[],
}
```

---

### Agent 9: Memory Agent

**Model:** claude-haiku-4-5

**Responsibility:** Manage the user's persistent memory. Extract new facts from conversations. Update preferences based on actions taken. Build the long-term user model.

**Inputs:**
- Completed situation (what was recommended, what was executed)
- Newly stated facts (from clarification answers)
- User corrections

**Outputs:**
```
{
  factsToStore: { key: string, value: any, confidence: number, expiresAt?: Date }[],
  factsToUpdate: { key: string, oldValue: any, newValue: any }[],
  factsToExpire: string[],    // e.g., "on a diet" after 30 days of no mention
  embeddingsToStore: string[], // conversation summaries for vector search
}
```

**Runs after every situation completes, not during.** Memory updates are async and do not block the user experience.

---

### Agent 10: Scheduler Agent

**Model:** claude-haiku-4-5

**Responsibility:** Handle time-based planning. Convert "meal prep for the week" into a specific schedule. Create reminders. Integrate with calendar context.

**Inputs:**
- Situation requiring scheduling (weekly plan, party planning, etc.)
- User's calendar context (if connected)
- Meal history (to avoid repetition)

**Outputs:**
```
{
  schedule: {
    date: Date,
    meal: "breakfast" | "lunch" | "dinner" | "snack",
    recommendation: PlanItem,
    reminder?: { time: Date, message: string },
  }[],
  shoppingList: { day: Date, items: InstamartItem[] }[],
  prepSuggestions: string[],
}
```

---

### Agent Sequencing

```
Situation Received
       │
       ▼
  Intent Agent (always first, ~1s)
       │
       ▼
  Context Agent (parallel with Intent in V2, sequential in V1, ~0.5s)
       │
       ├── Clarification needed?
       │        │
       │    YES │          NO
       │        ▼          │
       │  ClarificationAgent │
       │  → UI shows questions│
       │  → User answers      │
       │  → Re-enter Context  │
       │                      │
       └──────────────────────┘
                  │
                  ▼ (full context available)
         ┌────────┴─────────────────────────────┐
         │                                      │
   SwiggyAgent                            RecipeAgent
   BudgetAgent                          NutritionAgent
   (all fire in parallel)
         │
         └────────────────┐
                          ▼
                    PlanningAgent (~2-4s)
                          │
                          ▼
                  Plan published to SSE
                          │
                          ▼
               UI: Situation Board complete
                          │
                    User executes
                          │
                          ▼
                  MemoryAgent (async, post-execution)
```

---

## Phase 6 — Long-Term Memory

### Memory Architecture: Two Layers

**Layer 1: Structured Facts (PostgreSQL)**

Explicit, queryable facts. Updated by Memory Agent and direct user edits.

```
Type: user_memory_facts

Key                          Value              Source          Updated
─────────────────────────────────────────────────────────────────────────
dietary.restrictions         ["vegetarian"]     user_stated     2026-06-01
dietary.allergies            ["shellfish"]      user_stated     2026-03-15
budget.daily_food_target     350                user_stated     2026-05-20
budget.dining_out_budget     2500               inferred        2026-07-01
kitchen.equipment            ["gas", "mixer"]   user_stated     2026-04-10
kitchen.skill_level          "intermediate"     inferred        2026-06-15
location.home                "Bandra, Mumbai"   user_stated     2026-01-01
location.work                "BKC, Mumbai"      user_stated     2026-01-01
household.size               2                  inferred        2026-05-01
fitness.protein_target       150                user_stated     2026-06-20
fitness.gym_days             ["Monday","Wednesday","Friday"] user_stated  2026-06-01
preference.cuisines.liked    ["South Indian", "Italian"]  inferred  2026-07-01
preference.cuisines.disliked ["Bland food"]    user_stated   2026-06-01
pantry.staples               ["rice", "dal", "oil", "salt"] user_stated 2026-07-01
ordering.frequent_restaurants ["Behrouz", "Wow Momo"]  inferred 2026-07-01
```

**Layer 2: Semantic Memory (pgvector)**

Embeddings of conversation summaries, outcomes, and stated preferences in natural language. Used for fuzzy retrieval.

Example embeddings stored:
- "User was sick in June, preferred light khichdi and jeera water, ordered from Swiggy"
- "User planned anniversary dinner at Trattoria Cielo, budget Rs 3500, positive outcome"
- "User tried to cook biryani on a weeknight, ran out of time, ordered instead"

These are retrieved by similarity to the current situation to provide behavioral context the structured layer cannot capture.

---

### Memory Retrieval

When a new situation arrives, the Memory Agent:
1. Queries structured facts by key (O(1) lookup)
2. Embeds the situation text and queries pgvector for top-5 semantically similar past situations
3. Returns a merged context object ranked by recency and relevance

---

### Memory Lifecycle

| Fact Type | Persistence | Expiry |
|---|---|---|
| Dietary restrictions and allergies | Permanent | Never expires, user must explicitly remove |
| Location | Permanent | Updated when user moves |
| Budget targets | Soft | Re-evaluated after 30 days of no mention |
| Pantry | Soft | Items expire after 30 days unless restated |
| Fitness goals | Soft | Re-evaluated after 45 days of no mention |
| Cuisine preferences | Learned | Updated with each interaction (weighted average) |
| Frequent restaurants | Learned | Rolling 30-day frequency |
| Conversation summaries | Archived | Kept for 12 months, then purged |

---

### What Memory Prevents

| Pattern | Without Memory | With Memory |
|---|---|---|
| Same dietary question | Asked every session | Asked once, never again |
| Budget clarification | Asked every session | Defaults to stored target |
| Location | Asked every session | Assumed from stored preference |
| "What do I usually like?" | Cannot personalize | Surfaces past favorites |
| "Have I tried this before?" | Cannot answer | Yes, with outcome |
| Fitness constraints | User must restate | Applied automatically |

---

## Phase 7 — Workflows

### Workflow: "I'm broke"

**Input:** User types "I'm broke" or "I'm broke this week" or "Can't spend much on food"

**Intent detection:** `situationType = "budget_constrained"`, explicit budget = null

**Context check (memory):** Default budget = Rs 350. Pantry = has rice, dal, oil.

**Clarification decision:** Budget is unknown (stated "broke" ≠ specific amount). Pantry state is known from memory.
- Question 1: "What can you work with for food today?" [Under Rs 100] [Rs 100–200] [Rs 200–300] [Rs 300+]

**After answer (user says: Rs 150):**

**Agents fire in parallel:**
- SwiggyAgent: search delivery under Rs 150 near user location
- RecipeAgent: what can be cooked with pantry staples (dal-chawal = Rs 30, estimated)
- BudgetAgent: calculates Rs 150 budget breakdown for full day (not just one meal)

**Planning Agent reasoning:**
- Recipe option (dal-chawal): Rs 30, 25 min, within pantry, covers 2 meals
- Delivery option: cheapest available = Rs 99 after discount, covers 1 meal
- Recommendation: Cook at home (dal-chawal covers lunch + dinner, rice is a staple), order tea/snack if needed

**Situation Board output:**
```
UNDERSTOOD: Budget day — Rs 150 for today's food

PRIMARY RECOMMENDATION:
Cook Dal-Chawal — Rs 30, ~25 min, uses what you have
Covers: Lunch + Dinner · Calories: ~800 kcal

You have everything you need (rice, dal, oil, salt)
[See Recipe] [Start Cooking]

ALTERNATIVE:
Faasos Wrap deal — Rs 89 after discount, 18 min delivery
[Order Now]

AI NOTE: Cooking at home saves Rs 60 and covers two meals.
If you're exhausted, the Faasos wrap is the next best option.
```

---

### Workflow: "I'm sick"

**Intent:** `situationType = "unwell"`

**Memory:** Diet = vegetarian, cooking skill = intermediate, location = home

**Clarification:** `canCook = missing (REQUIRED)`, `alone = missing (REQUIRED)`
- "Are you up for cooking, or do you need something delivered? And are you home alone?"

**User:** "Need delivery, I'm alone"

**Agents:**
- SwiggyAgent: comfort food delivery (khichdi, soup, congee, light Indian)
- NutritionAgent: light, easily digestible, warm foods for sick user
- BudgetAgent: budget = Rs 350 (stored default)

**Plan:**
```
UNDERSTOOD: You're sick, alone, need delivery

PRIMARY:
Khichdi from Haldiram's — Rs 160, 28 min delivery
Light, warm, easily digestible. Matches your vegetarian diet.
[Order Now]

ALTERNATIVE:
Tomato Soup + Grilled Sandwich from The Bowl Company — Rs 240
Slightly more filling if you haven't eaten all day.
[Order Now]

REMINDER SET: Check in at 7 PM if you want dinner ordered too?
[Yes] [No thanks]
```

---

### Workflow: "Plan a date"

**Intent:** `situationType = "date_planning"`

**Memory:** Location = Bandra, diet = vegetarian, past date = Trattoria Cielo (good outcome)

**Clarification:**
- "What's your budget for tonight?" [Under Rs 1500] [Rs 1500–3000] [Rs 3000+]
- "First date or established partner?"

**User:** Rs 2000-3000, established partner

**Agents:**
- SwiggyAgent / Dineout: restaurants in Bandra, Rs 2000–3000, vegetarian-friendly, available tonight
- Memory: Past positive experience at Trattoria Cielo — retrieve and surface
- PlanningAgent: rank by ambience (date night), availability, vegetarian options

**Plan:**
```
UNDERSTOOD: Date night, Bandra, Rs 2000–3000, vegetarian-friendly

PRIMARY:
Trattoria Cielo — Rs 2400 for 2
You've been here before and it went well.
Italian, candlelit, available at 8 PM · 3 tables left
[Book Table] [View Menu]

NEW OPTION:
Bastian Bandra — Rs 2800 for 2
Fresh opening, rooftop, known for ambience. Vegetarian menu available.
[View]

INSIDER:
Book before 6 PM — Saturday availability at Trattoria closes fast.
```

---

### Workflow: "Host IPL Party"

**Intent:** `situationType = "group_event"`, occasion = "sports_event"

**Clarification:**
- "How many people?" [5–8] [10–15] [15–20] [20+]
- "What's your food budget for the evening?" [Per head options]

**User:** 12 people, Rs 3000 total

**Agents:**
- SwiggyAgent: bulk order options, multi-restaurant, group deals
- BudgetAgent: Rs 250 per person budget allocation
- NutritionAgent: finger food, snacks appropriate for group watching cricket
- PlanningAgent: multi-restaurant strategy

**Plan:**
```
UNDERSTOOD: IPL party, 12 guests, Rs 3000 budget

MULTI-RESTAURANT PLAN:

STARTERS (arrive 45 min before match)
Momos × 4 trays from Wow Momo — Rs 720
Estimated: 5 min walk / 20 min delivery

MAINS (order 30 min into match, expected delivery by first innings break)
Pizza × 3 large from Dominos — Rs 1050 (use 30% party deal)
Biryani × 2 kg from Behrouz — Rs 860

DRINKS/SIDES
Instamart: Coke × 6, juice × 6, chips × 4 — Rs 320 · 15 min delivery

TOTAL: Rs 2950 | Rs 246 per head

[Add all to cart] [Customize plan]

TIP: Order Instamart drinks now — party items sell out on match days.
```

---

### Workflow: "I need 180g protein today"

**Intent:** `situationType = "nutrition_goal"`, protein_target = 180g

**Memory:** Diet = non-vegetarian, usual order restaurants, current time = 9 AM

**Clarification:** None needed. Full context available.

**Nutrition Agent:** Current logged protein = 0g. Need 180g across 3-4 meals. Target per meal: ~45-50g.

**Plan:**
```
PROTEIN PLAN FOR TODAY · 0/180g protein logged

BREAKFAST (right now)
Eggs × 4 + Greek Yogurt — cook at home (pantry)
~36g protein · Rs 0 (already have)
[Start cooking]

LUNCH (12:30 PM)
Chicken Tikka bowl from The Bowl Company — 35g protein
Rs 350 · order at 12:15 PM for 12:30 delivery
[Schedule order]

SNACK (4 PM)
Peanut butter toast × 2 — cook at home
~18g protein

DINNER (7:30 PM)
Paneer Bhurji + Dal + Rice — cook at home
~38g protein · Rs 80 estimated ingredient cost
[View recipe]

PROJECTED TOTAL: 127g protein
SHORTFALL: 53g

CLOSE THE GAP:
Add a whey protein shake (not available via Swiggy)
OR add a second chicken item at lunch (+25g)
[Adjust lunch order]
```

---

### Workflow: "Weekly meal prep"

**Intent:** `situationType = "meal_prep"`, timeframe = "week"

**Clarification:**
- "Which meals are you prepping for?" [Lunches only] [Dinners only] [Both] [All meals]
- "Do you want to shop on Instamart or already have groceries?"

**Agents:** Scheduler, Recipe, Nutrition, Swiggy (Instamart), Budget

**Output:** 7-day meal plan with shopping list, scheduled Instamart delivery, 3 prep recipes, and daily reminders.

---

## Phase 8 — Database Schema

**Technology:** PostgreSQL with Prisma ORM. pgvector extension for embeddings.

---

### Schema

```sql
-- Users & Auth (managed by Clerk, these are our extension tables)

users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id     VARCHAR(255) UNIQUE NOT NULL,
  email             VARCHAR(255) UNIQUE NOT NULL,
  name              VARCHAR(255),
  phone             VARCHAR(20),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  last_active_at    TIMESTAMPTZ
)

-- User profile: structured preferences

user_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  
  -- Location
  home_address      TEXT,
  home_lat          DECIMAL(10, 8),
  home_lng          DECIMAL(11, 8),
  work_address      TEXT,
  work_lat          DECIMAL(10, 8),
  work_lng          DECIMAL(11, 8),
  
  -- Dietary
  diet_type         VARCHAR(50),   -- vegetarian, vegan, non-vegetarian, pescatarian
  allergies         TEXT[],
  dietary_notes     TEXT,          -- free text for complex restrictions
  
  -- Household
  household_size    INTEGER DEFAULT 1,
  cooking_skill     VARCHAR(20),   -- beginner, intermediate, advanced
  kitchen_equipment TEXT[],
  
  -- Budget
  daily_food_budget INTEGER,       -- INR
  dining_out_budget INTEGER,       -- per outing, INR
  
  -- Fitness
  daily_protein_target INTEGER,
  daily_calorie_target INTEGER,
  gym_days          TEXT[],
  
  -- Preferences
  preferred_cuisines TEXT[],
  disliked_cuisines  TEXT[],
  
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
)

-- Memory: individual facts with confidence and source tracking

user_memory_facts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  
  fact_key          VARCHAR(255) NOT NULL,   -- e.g. "preference.cuisines.liked"
  fact_value        JSONB NOT NULL,
  fact_type         VARCHAR(50),             -- string, array, number, boolean, date
  
  source            VARCHAR(50),             -- user_stated, agent_inferred, action_derived
  confidence        DECIMAL(3, 2) DEFAULT 1.0,  -- 0.0–1.0
  
  times_confirmed   INTEGER DEFAULT 1,
  last_confirmed_at TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, fact_key)
)
INDEX ON user_memory_facts(user_id, fact_key)

-- Memory: semantic embeddings (pgvector)

user_memory_embeddings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  
  content           TEXT NOT NULL,           -- the text that was embedded
  embedding         VECTOR(1536),            -- OpenAI/Claude embedding dimensions
  content_type      VARCHAR(50),             -- situation_summary, preference, outcome, correction
  
  source_situation_id UUID,                  -- which situation generated this
  
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  
  INDEX USING ivfflat (embedding vector_cosine_ops)
)

-- Core: the user's food situation (the event)

situations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  
  raw_input         TEXT NOT NULL,           -- exactly what the user typed
  
  -- Processed context
  situation_type    VARCHAR(50),             -- broke, sick, date, party, nutrition, etc.
  extracted_context JSONB,                   -- full SituationContext object
  
  -- State machine
  status            VARCHAR(30) DEFAULT 'created',
  -- created → intent_extracted → clarifying → context_ready
  -- → planning → plan_ready → executing → completed | abandoned
  
  -- Timing
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  context_ready_at  TIMESTAMPTZ,
  plan_ready_at     TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  
  -- Location at time of situation
  lat               DECIMAL(10, 8),
  lng               DECIMAL(11, 8)
)

-- Clarification pass within a situation

clarifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  situation_id      UUID REFERENCES situations(id) ON DELETE CASCADE,
  
  questions         JSONB NOT NULL,          -- array of question objects
  answers           JSONB,                   -- user's responses
  pass_number       INTEGER DEFAULT 1,       -- 1 or 2 (max)
  
  asked_at          TIMESTAMPTZ DEFAULT NOW(),
  answered_at       TIMESTAMPTZ
)

-- Agent execution log (observability)

situation_agent_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  situation_id      UUID REFERENCES situations(id) ON DELETE CASCADE,
  
  agent_name        VARCHAR(100) NOT NULL,
  model_used        VARCHAR(100),
  
  status            VARCHAR(20),             -- running, completed, failed, timeout
  
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  latency_ms        INTEGER,
  
  input_snapshot    JSONB,
  output_snapshot   JSONB,
  error_message     TEXT,
  
  started_at        TIMESTAMPTZ DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
)

-- Recommendations

recommendations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  situation_id      UUID REFERENCES situations(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  
  headline          TEXT,
  reasoning         TEXT,
  plan_type         VARCHAR(50),
  
  created_at        TIMESTAMPTZ DEFAULT NOW()
)

recommendation_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID REFERENCES recommendations(id) ON DELETE CASCADE,
  
  rank              INTEGER DEFAULT 1,        -- 1 = primary, 2+ = alternatives
  is_primary        BOOLEAN DEFAULT FALSE,
  
  service           VARCHAR(50),              -- swiggy_food, instamart, dineout, recipe
  title             TEXT,
  description       TEXT,
  
  estimated_cost    INTEGER,                  -- INR
  estimated_time    INTEGER,                  -- minutes
  
  -- Nutrition
  calories          INTEGER,
  protein_g         INTEGER,
  carbs_g           INTEGER,
  fat_g             INTEGER,
  
  -- Execution data (service-specific IDs, cart data)
  execution_data    JSONB,
  is_executable     BOOLEAN DEFAULT FALSE,
  
  created_at        TIMESTAMPTZ DEFAULT NOW()
)

-- What the user actually did

user_actions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  situation_id      UUID REFERENCES situations(id),
  recommendation_item_id UUID REFERENCES recommendation_items(id),
  
  action_type       VARCHAR(50),             -- executed, dismissed, modified, saved
  service_used      VARCHAR(50),
  
  -- Outcome (filled in later)
  user_rating       INTEGER,                 -- 1-5, if provided
  was_satisfactory  BOOLEAN,
  
  -- For Swiggy actions: order tracking
  external_order_id VARCHAR(255),
  order_status      VARCHAR(50),
  
  executed_at       TIMESTAMPTZ DEFAULT NOW(),
  feedback_at       TIMESTAMPTZ
)

-- Pantry

pantry_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  
  item_name         VARCHAR(255) NOT NULL,
  quantity          VARCHAR(100),
  unit              VARCHAR(50),
  
  added_at          TIMESTAMPTZ DEFAULT NOW(),
  expires_at        TIMESTAMPTZ,
  last_used_at      TIMESTAMPTZ,
  
  is_staple         BOOLEAN DEFAULT FALSE    -- staples don't expire (salt, oil, etc.)
)

-- Meal history (for memory, learning, nutrition tracking)

meal_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  
  meal_type         VARCHAR(20),             -- breakfast, lunch, dinner, snack
  meal_date         DATE NOT NULL,
  
  description       TEXT,
  source            VARCHAR(50),             -- home_cooked, swiggy, dineout, instamart
  
  calories          INTEGER,
  protein_g         INTEGER,
  
  rating            INTEGER,                 -- 1-5
  
  logged_at         TIMESTAMPTZ DEFAULT NOW()
)

-- Scheduled meals and reminders

scheduled_meals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  situation_id      UUID REFERENCES situations(id),
  
  scheduled_for     TIMESTAMPTZ NOT NULL,
  meal_type         VARCHAR(20),
  description       TEXT,
  
  -- Action to take at scheduled time
  reminder_type     VARCHAR(50),             -- cook, order, prep, shop
  reminder_data     JSONB,                   -- data to pre-populate the action
  
  status            VARCHAR(20) DEFAULT 'pending',
  
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  triggered_at      TIMESTAMPTZ
)

-- Analytics events

analytics_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id),
  session_id        UUID,
  
  event_name        VARCHAR(100) NOT NULL,
  event_data        JSONB,
  
  occurred_at       TIMESTAMPTZ DEFAULT NOW()
)
INDEX ON analytics_events(user_id, event_name, occurred_at)
INDEX ON analytics_events(event_name, occurred_at)
```

---

## Phase 9 — API Contracts

**Base URL:** `/api/v1/`  
**Auth:** Bearer token (Clerk JWT) on all endpoints except health.  
**Content-Type:** `application/json`  
**Rate limiting:** 30 req/min per user, 5 situation submissions/min.

---

### Situations API

**POST /api/v1/situations**

Submit a new food situation. This is the primary entry point for the product.

```
Request:
{
  "input": "I'm sick and alone",
  "location": { "lat": 19.0596, "lng": 72.8295 },   // optional, falls back to profile
  "context_hints": {}  // optional pre-filled context (future: voice/calendar integration)
}

Response 201:
{
  "situation_id": "uuid",
  "status": "intent_extracted",
  "stream_url": "/api/v1/situations/uuid/stream"
}
```

**GET /api/v1/situations/:id/stream**

SSE endpoint. Client subscribes after creating a situation.

```
Event types:

event: context_understood
data: { "situation_type": "unwell", "understood_as": "You're sick and need support" }

event: clarification_needed
data: {
  "questions": [
    {
      "id": "q1",
      "text": "Are you up for cooking today?",
      "field": "canCook",
      "type": "single_choice",
      "options": [
        { "label": "Yes, I can manage", "value": true },
        { "label": "No, need delivery", "value": false }
      ]
    }
  ]
}

event: agent_progress
data: { "agent": "swiggy", "status": "searching", "message": "Finding comfort food near you..." }

event: plan_ready
data: { "recommendation_id": "uuid" }

event: error
data: { "code": "SWIGGY_UNAVAILABLE", "fallback_available": true }
```

**POST /api/v1/situations/:id/clarify**

Provide answers to clarification questions.

```
Request:
{
  "answers": {
    "q1": false,    // canCook = false
    "q2": true      // alone = true
  }
}

Response 200:
{
  "status": "context_ready",
  "message": "Got it — finding delivery options for you"
}
```

**GET /api/v1/situations/:id**

Fetch situation state (for reconnection after SSE drop).

```
Response 200:
{
  "id": "uuid",
  "status": "plan_ready",
  "situation_type": "unwell",
  "clarifications": [...],
  "recommendation_id": "uuid"
}
```

---

### Recommendations API

**GET /api/v1/recommendations/:id**

Fetch the full recommendation plan.

```
Response 200:
{
  "id": "uuid",
  "headline": "Order comfort food — you're sick and alone",
  "reasoning": "Delivery is the right call. Found vegetarian comfort options under your budget.",
  "plan_type": "single",
  "items": [
    {
      "rank": 1,
      "is_primary": true,
      "service": "swiggy_food",
      "title": "Khichdi from Haldiram's",
      "description": "Light, warm, vegetarian. 28 min delivery.",
      "estimated_cost": 160,
      "estimated_time": 28,
      "nutrition": { "calories": 380, "protein_g": 12 },
      "is_executable": true
    },
    {
      "rank": 2,
      "is_primary": false,
      "service": "swiggy_food",
      "title": "Tomato Soup + Grilled Sandwich",
      ...
    }
  ]
}
```

**POST /api/v1/recommendations/:id/execute**

Execute an item in the plan.

```
Request:
{
  "item_id": "uuid"
}

Response 200:
{
  "action_id": "uuid",
  "service": "swiggy_food",
  "redirect_url": "https://swiggy.com/cart/...",   // deep link into Swiggy with cart pre-filled
  "confirmation": "Opening Swiggy with Khichdi added to your cart"
}
```

---

### Memory API

**GET /api/v1/memory**

Fetch the user's current memory state (for the Memory Panel in the UI).

```
Response 200:
{
  "profile": {
    "diet_type": "vegetarian",
    "allergies": ["shellfish"],
    "household_size": 2,
    "cooking_skill": "intermediate"
  },
  "facts": [
    { "key": "budget.daily_food_target", "value": 350, "source": "user_stated" },
    { "key": "preference.cuisines.liked", "value": ["South Indian", "Italian"], "source": "agent_inferred" }
  ]
}
```

**PATCH /api/v1/memory**

User corrects a fact directly from the Memory Panel.

```
Request:
{
  "updates": [
    { "key": "budget.daily_food_target", "value": 400 },
    { "key": "dietary.restrictions", "value": ["vegetarian", "no-onion"] }
  ]
}

Response 200:
{ "updated": 2 }
```

---

### Pantry API

**GET /api/v1/pantry**  
**POST /api/v1/pantry/items** (add item)  
**DELETE /api/v1/pantry/items/:id** (remove item)  
**POST /api/v1/pantry/scan** (future: image-based pantry scanning)

---

### Scheduling API

**GET /api/v1/schedule** — upcoming scheduled meals  
**POST /api/v1/schedule/meals** — create a scheduled meal or reminder  
**DELETE /api/v1/schedule/meals/:id** — cancel  

---

### Analytics API (internal, not user-facing)

**POST /api/v1/analytics/events** — batch event ingestion  

---

## Phase 10 — Project Structure

### Repository: Turborepo Monorepo

```
mealos/
├── apps/
│   ├── web/                        # Next.js 16 frontend
│   │   ├── app/
│   │   │   ├── (auth)/             # Clerk auth pages
│   │   │   ├── (app)/              # Authenticated app routes
│   │   │   │   ├── layout.tsx      # App shell (navbar, memory panel)
│   │   │   │   ├── page.tsx        # Situation input (home)
│   │   │   │   ├── history/        # Past situations
│   │   │   │   ├── memory/         # Memory panel page (mobile)
│   │   │   │   └── schedule/       # Upcoming meals
│   │   │   ├── api/                # API routes (proxy to services)
│   │   │   └── layout.tsx
│   │   ├── components/
│   │   │   ├── situation/          # Situation input components
│   │   │   │   ├── SituationInput.tsx
│   │   │   │   ├── QuickTemplates.tsx  # "I'm sick", "Plan a date" etc.
│   │   │   │   └── VoiceInput.tsx
│   │   │   ├── board/              # Situation board components
│   │   │   │   ├── SituationBoard.tsx
│   │   │   │   ├── ContextCard.tsx
│   │   │   │   ├── ClarificationCard.tsx
│   │   │   │   ├── ReasoningCard.tsx
│   │   │   │   ├── PlanCard.tsx
│   │   │   │   └── ExecutionCard.tsx
│   │   │   ├── memory/
│   │   │   │   ├── MemoryPanel.tsx
│   │   │   │   └── FactEditor.tsx
│   │   │   ├── ui/                 # Design system primitives
│   │   │   │   ├── Button.tsx
│   │   │   │   ├── Card.tsx
│   │   │   │   ├── Chip.tsx
│   │   │   │   ├── Toast.tsx
│   │   │   │   └── Skeleton.tsx
│   │   │   └── shared/
│   │   │       ├── Navbar.tsx
│   │   │       └── ErrorBoundary.tsx
│   │   ├── hooks/
│   │   │   ├── useSituationStream.ts  # SSE subscription hook
│   │   │   ├── useSituation.ts
│   │   │   └── useMemory.ts
│   │   ├── stores/
│   │   │   ├── situationStore.ts   # Zustand
│   │   │   └── userStore.ts
│   │   ├── styles/
│   │   │   ├── globals.css         # Design tokens (ported from prototype)
│   │   │   ├── themes.css          # Mode themes (ported from prototype)
│   │   │   └── animations.css      # Keyframes (ported from prototype)
│   │   └── package.json
│   │
│   └── workers/                    # BullMQ worker processes
│       ├── src/
│       │   ├── queues/
│       │   │   ├── situationQueue.ts
│       │   │   └── memoryQueue.ts
│       │   ├── processors/
│       │   │   ├── situationProcessor.ts
│       │   │   └── memoryProcessor.ts
│       │   └── index.ts
│       └── package.json
│
├── packages/
│   ├── agents/                     # All AI agent implementations
│   │   ├── src/
│   │   │   ├── base/
│   │   │   │   ├── Agent.ts        # Base agent class
│   │   │   │   └── Orchestrator.ts
│   │   │   ├── intent/
│   │   │   │   ├── IntentAgent.ts
│   │   │   │   └── prompts.ts
│   │   │   ├── context/
│   │   │   │   ├── ContextAgent.ts
│   │   │   │   └── prompts.ts
│   │   │   ├── clarification/
│   │   │   │   ├── ClarificationAgent.ts
│   │   │   │   └── prompts.ts
│   │   │   ├── planning/
│   │   │   │   ├── PlanningAgent.ts
│   │   │   │   └── prompts.ts
│   │   │   ├── budget/
│   │   │   ├── nutrition/
│   │   │   ├── swiggy/
│   │   │   ├── recipe/
│   │   │   ├── memory/
│   │   │   └── scheduler/
│   │   └── package.json
│   │
│   ├── db/                         # Database layer
│   │   ├── prisma/
│   │   │   ├── schema.prisma       # Full schema
│   │   │   └── migrations/
│   │   ├── src/
│   │   │   ├── client.ts           # Prisma client singleton
│   │   │   └── repositories/       # Data access layer
│   │   │       ├── SituationRepository.ts
│   │   │       ├── MemoryRepository.ts
│   │   │       ├── UserRepository.ts
│   │   │       └── RecommendationRepository.ts
│   │   └── package.json
│   │
│   ├── ai/                         # LLM client + prompt utilities
│   │   ├── src/
│   │   │   ├── client.ts           # Anthropic SDK client
│   │   │   ├── streaming.ts        # Streaming utilities
│   │   │   └── prompts/            # Shared prompt templates
│   │   └── package.json
│   │
│   ├── mcp/                        # MCP clients
│   │   ├── src/
│   │   │   ├── swiggy/
│   │   │   │   ├── SwiggyMCPClient.ts
│   │   │   │   ├── types.ts
│   │   │   │   └── tools.ts        # MCP tool definitions
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── types/                      # Shared TypeScript types
│   │   ├── src/
│   │   │   ├── situation.ts
│   │   │   ├── recommendation.ts
│   │   │   ├── memory.ts
│   │   │   ├── agents.ts
│   │   │   └── api.ts
│   │   └── package.json
│   │
│   └── config/                     # Shared config (ESLint, TypeScript, Tailwind)
│       ├── eslint/
│       ├── typescript/
│       └── tailwind/
│
├── infrastructure/
│   ├── docker/
│   │   ├── Dockerfile.workers
│   │   └── docker-compose.yml      # Local dev: Postgres + Redis
│   └── scripts/
│       ├── setup-local.sh
│       └── seed.ts
│
├── .github/
│   └── workflows/
│       ├── ci.yml                  # Test + lint on PR
│       ├── deploy-web.yml          # Deploy to Vercel
│       └── deploy-workers.yml      # Deploy workers to Railway
│
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

---

### Technology Decisions and Rationale

| Decision | Choice | Why |
|---|---|---|
| Monorepo tool | Turborepo | Best Next.js ecosystem integration, fast builds, remote caching |
| Package manager | pnpm | Disk efficient, strict dependency isolation, works well with Turborepo |
| LLM | Claude claude-sonnet-4-6 (planning, clarification), Claude claude-haiku-4-5 (intent, budget, nutrition) | claude-sonnet-4-6 has the reasoning quality needed for multi-constraint planning; claude-haiku-4-5 is fast and cheap for classification |
| ORM | Prisma | Type-safe, good migration tooling, integrates cleanly with TypeScript monorepo |
| State management | Zustand + TanStack Query | Zustand for UI state, TanStack Query for server state. React Context alone will not scale. |
| Job queues | BullMQ + Redis | Battle-tested, good dashboard visibility, supports priority queues and delayed jobs |
| Auth | Clerk | Fastest path to production auth with social login, OTP, and good Next.js integration |
| CSS | Port existing `mealos.css` into CSS Modules per component | Preserves the design system; scoping prevents cascade collisions |
| Real-time | SSE over WebSocket | SSE is simpler, works over HTTP/1.1, sufficient for unidirectional agent updates |
| Embedding | pgvector | Avoids external vector DB dependency at V1; upgrade to Pinecone when vector queries exceed 50ms |

---

## Phase 11 — Implementation Roadmap

### Milestone 0: Foundation (Weeks 1–2)

**Goal:** Running Next.js app with authentication, database, and CI/CD.  
**Testable:** Can sign up, sign in, see an empty dashboard. Database migrations run. CI passes.

- [ ] Turborepo monorepo setup (apps/web, packages/db, packages/types, packages/config)
- [ ] TypeScript strict mode everywhere
- [ ] PostgreSQL setup (Railway for staging, local via Docker)
- [ ] Redis setup (Railway for staging, local via Docker)
- [ ] Prisma schema V1 (users, user_profiles only)
- [ ] Clerk authentication integration
- [ ] GitHub Actions CI (lint + typecheck on PR)
- [ ] Vercel deploy (web)
- [ ] Railway deploy (workers, V0: placeholder)
- [ ] Port `mealos.css` design system into `packages/config/tailwind` and global styles
- [ ] Basic app shell: Navbar, layout, auth-protected routes

**Does NOT include:** Any AI. Any Swiggy. Any recommendations.

---

### Milestone 1: Profile and Memory (Weeks 3–4)

**Goal:** The system knows who the user is. First-time onboarding collects dietary, household, budget, and location. Memory panel is editable.  
**Testable:** Complete onboarding, see facts in memory panel, edit a fact, confirm it persists.

- [ ] Onboarding flow (5–7 focused questions, progressive disclosure)
- [ ] `user_profiles` fully implemented
- [ ] `user_memory_facts` table + read/write API
- [ ] Memory panel UI component
- [ ] PATCH /api/v1/memory (user corrections)
- [ ] Pantry input UI (basic: add/remove items by name)

**Does NOT include:** AI reasoning. Agents. Situations.

---

### Milestone 2: Basic Situation + Intent (Weeks 5–6)

**Goal:** User types a situation. Intent Agent classifies it. A simple (non-AI-reasoned) plan is shown.  
**Testable:** Type "I'm sick" → see "You're unwell, we recommend delivery" with a static recommendation.

- [ ] Situation input surface (UI)
- [ ] POST /api/v1/situations endpoint
- [ ] SSE stream infrastructure (/api/v1/situations/:id/stream)
- [ ] Intent Agent (claude-haiku-4-5, classifies situation type)
- [ ] Context Agent (reads memory, builds context object)
- [ ] `situation_agent_runs` table (observability from day 1)
- [ ] Situation Board UI (ContextCard component)
- [ ] Basic static recommendation rules (no Planning Agent yet): if sick → show khichdi-type options; if broke → show budget options
- [ ] `recommendations` + `recommendation_items` tables

**Does NOT include:** Clarification. Swiggy MCP. Planning Agent.

---

### Milestone 3: Clarification Engine (Weeks 7–8)

**Goal:** The system asks smart questions when context is missing. Memory prevents redundant questions.  
**Testable:** "I'm sick" → system asks 2 relevant questions → answer them → see a more specific recommendation than Milestone 2.

- [ ] Clarification Agent fully implemented
- [ ] `clarifications` table
- [ ] POST /api/v1/situations/:id/clarify
- [ ] ClarificationCard UI component (question + quick-tap options)
- [ ] Memory update after clarification answers (new facts stored)
- [ ] Second clarification pass logic (max 2 passes, then assume)
- [ ] SSE events: `clarification_needed`, `context_ready`

---

### Milestone 4: Swiggy MCP (Weeks 9–10)

**Goal:** The system can search Swiggy Food, Instamart, and Dineout and surface real results.  
**Testable:** "I'm hungry" → see real Swiggy restaurants near the user with real delivery times.

- [ ] `packages/mcp` Swiggy MCP client
- [ ] Swiggy Agent implemented (tool-calling pattern)
- [ ] Real restaurant results in recommendations
- [ ] Real instamart items in shopping lists
- [ ] Real dineout availability
- [ ] Execute action: redirect to Swiggy with pre-filled cart
- [ ] `user_actions` table (track what was executed)
- [ ] Graceful degradation if Swiggy MCP is unavailable

---

### Milestone 5: Planning Agent (Weeks 11–13)

**Goal:** The AI actually reasons. Multi-constraint situations produce intelligent plans. Budget, nutrition, and service selection are all weighed.  
**Testable:** "I'm broke" → budget-aware recommendation. "I need protein" → nutrition-aware recommendation. "Plan a date" → dineout-focused plan with real availability.

- [ ] Planning Agent (claude-sonnet-4-6)
- [ ] Budget Agent (claude-haiku-4-5)
- [ ] Nutrition Agent (claude-haiku-4-5)
- [ ] Recipe Agent (claude-sonnet-4-6, with pantry awareness)
- [ ] Multi-agent parallel execution via BullMQ
- [ ] Agent timeout and fallback handling
- [ ] `packages/agents` package fully structured
- [ ] ReasoningCard UI (brief AI explanation of the plan)
- [ ] PlanCard UI (primary + alternatives)
- [ ] ExecutionCard UI (action buttons)

---

### Milestone 6: Memory Learning (Weeks 14–15)

**Goal:** Every interaction improves future recommendations. The system learns from what the user executes and rates.  
**Testable:** Execute an order twice → third time the system proactively suggests it. State an allergy once → never shown that food again.

- [ ] Memory Agent (post-execution, async)
- [ ] Semantic memory via pgvector (situation summaries embedded and stored)
- [ ] Memory retrieval in Context Agent (similarity search)
- [ ] Post-execution feedback (simple thumbs up/down on recommendation)
- [ ] `meal_history` logging from executed actions
- [ ] Preference drift detection (cuisine preferences update over time)

---

### Milestone 7: Scheduling and Notifications (Weeks 16–17)

**Goal:** Proactive food intelligence. Meal prep plans, weekly schedules, reminders.  
**Testable:** Create a weekly meal prep plan → see 7-day schedule → receive dinner reminder at 6:30 PM.

- [ ] Scheduler Agent
- [ ] `scheduled_meals` table
- [ ] Scheduler UI (weekly plan view)
- [ ] Web push notifications (service worker)
- [ ] BullMQ delayed jobs for reminders
- [ ] "Repeat this plan" quick action on completed situations

---

### Milestone 8: Production Hardening (Weeks 18–20)

**Goal:** Ship to real users with confidence.  
**Testable:** Load test at 1,000 concurrent users. Error rate < 0.1%. P95 situation-to-plan < 8 seconds.

- [ ] Sentry integration (errors, performance)
- [ ] Axiom log aggregation
- [ ] Rate limiting (per-user, per-IP)
- [ ] API input validation (Zod schemas)
- [ ] LLM cost monitoring (track tokens per situation)
- [ ] Agent latency dashboards
- [ ] Retry logic audit across all agents
- [ ] Mobile responsiveness audit
- [ ] Accessibility audit (WCAG 2.1 AA)
- [ ] Security audit (OWASP Top 10)
- [ ] Load testing
- [ ] Incident runbook

---

### What Is Deliberately Excluded From V1

The following are real features worth building, but they increase complexity enough that they should not be in the first version shipped to users:

| Feature | Why excluded | When to add |
|---|---|---|
| Voice input | Requires browser permission UX, ASR latency, transcription service | After M5, when core product is proven |
| Calendar integration | OAuth flow for Google/Apple Calendar, significant privacy friction | After M6 |
| Image-based pantry scanning | Computer vision pipeline, significant infra | After M6 |
| Nutrition tracking (full) | Requires food database (USDA/Nutritionix), significant data cost | After M5 (basic), full after M7 |
| Social features (shared meal plans) | Completely separate product surface | Never (out of scope for V1) |
| iOS/Android apps | Significant investment, web-first is the right call for V1 | After product-market fit |
| Multi-city Swiggy coverage | Depends on Swiggy MCP coverage, not a product decision | Automatic when MCP covers it |

---

### Cost Model (Rough Estimate at Launch)

| Component | Unit Cost | At 1,000 DAU |
|---|---|---|
| Claude claude-haiku-4-5 (Intent, Context, Budget, Nutrition) | ~$0.001/situation | ~$1/day |
| Claude claude-sonnet-4-6 (Clarification, Planning, Recipe) | ~$0.02/situation | ~$20/day |
| PostgreSQL (Railway) | $20/month base | ~$20/month |
| Redis (Railway) | $15/month base | ~$15/month |
| Vercel (web + API routes) | ~$20/month at this scale | ~$20/month |
| Swiggy MCP | TBD (depends on partnership) | TBD |
| **Total estimated** | | **~$75–100/month + Swiggy MCP** |

At 10,000 DAU, LLM costs dominate. Caching agent results and batching requests become critical optimizations at that scale.

---

*End of Architecture Document*  
*Next step: Begin Milestone 0 when ready.*
