# MealOS AI

> **An intelligent food operating system that decides how you should solve your food problem.**

MealOS is not a restaurant finder. It is a Planning Engine that reasons across cooking, delivery, and dining out simultaneously — against your budget, time, nutrition goals, pantry, and preferences — and tells you exactly what to do.

---

## Product Vision

Most food apps ask: "What do you want to order?"
MealOS asks: "What's your situation?" — and figures out the rest.

```
User: "I'm sick and alone"

MealOS:
  ✔ Understood: unwell, alone, need delivery
  ✔ Budget known (₹350) · Diet known (vegetarian)
  ✗ Can you cook today? → asks one question

  Decision Engine (deterministic TypeScript):
    Cook:   Score 0   (can't cook)
    Order:  Score 88  ← WINNER
    Dine:   Score 0   (can't travel)

  "Swiggy delivery is the only viable path. Found
   comfort food options within your ₹350 budget."

  → Khichdi from Haldiram's — ₹160, 28 min
  [Order Now → Swiggy opens with cart pre-filled]
```

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 App Router, React 19, TypeScript strict |
| Styling | Tailwind v4 + CSS Modules (ported design system) |
| Auth | Clerk |
| Database | PostgreSQL (Neon) + Prisma ORM |
| AI Agents | Claude claude-sonnet-4-6 (Planning), Claude claude-haiku-4-5 (Conversation, Tool, Memory) |
| Scoring | Deterministic TypeScript — `lib/engine/scorer.ts` (not LLM) |
| Food Data | Swiggy MCP (food delivery, Instamart, Dineout) |
| Recipe Video | YouTube Data API v3 |
| Real-time | Server-Sent Events (SSE) |
| Deployment | Vercel |

---

## The Key Architectural Decision

**Scores are calculated by deterministic TypeScript code, not by Claude.**

```typescript
// lib/engine/scorer.ts — no LLM, no network, < 5ms
const score = scoreAll(situationContext, pathInputs)
// → { cook: 88, order: 44, dineout: 0, winner: 'cook', confidence: 92 }

// Claude is called ONCE, after scoring, to write the explanation:
// "Cooking achieves your protein goal at 3× lower cost than ordering."
```

This makes recommendations reproducible, unit-testable, and debuggable.
See [docs/DECISION_ENGINE.md](docs/DECISION_ENGINE.md) for the full spec.

---

## Architecture Flow

```
Situation Input (text / voice / template)
        │
        ▼
Conversation Agent (claude-haiku) — parse intent → SituationContext JSON
        │
        ▼
Clarification Engine — max 3 smart questions (checks memory first)
        │
        ▼
Decision Engine (TypeScript, deterministic) — score Cook / Order / Dine
        │
        ├── Tool Agent (claude-haiku) — Swiggy MCP + YouTube API
        │
        ▼
Planning Agent (claude-sonnet) — explain winner, build recommendation
        │
        ▼
Situation Board — Confidence Card, Comparison Table, Plan Simulator
        │
        ▼
Execute — pre-fill Swiggy cart / start cooking guide / book dineout
        │
        ▼
Memory Agent (claude-haiku, async) — extract and store new facts
```

---

## Quick Start

```bash
# Prerequisites: Node 18+, pnpm

git clone <repo>
pnpm install
cp .env.local.example .env.local

# Required env vars:
# DATABASE_URL          — Neon PostgreSQL connection string
# CLERK_SECRET_KEY      — from clerk.com dashboard
# CLERK_PUBLISHABLE_KEY — from clerk.com dashboard
# NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY — same as above
# ANTHROPIC_API_KEY     — from console.anthropic.com
# YOUTUBE_API_KEY       — from Google Cloud Console (Data API v3)

pnpm db:push      # apply Prisma schema to database
pnpm db:seed      # seed 2 test users + 4 completed situations
pnpm dev          # → http://localhost:3000
```

---

## Documentation

| Document | What it covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Full long-term system architecture (11 phases) |
| [MVP.md](MVP.md) | 3-week build plan, demo loop, what ships vs what's deferred |
| [STATUS.md](STATUS.md) | Prototype audit — what exists and what doesn't |
| [docs/DATABASE.md](docs/DATABASE.md) | ER diagram, Prisma schema, indexes, query patterns, migrations |
| [docs/DECISION_ENGINE.md](docs/DECISION_ENGINE.md) | Scoring spec, weight tables, confidence calc, 30 unit test cases |
| [docs/API.md](docs/API.md) | 10 API contracts, 26 error codes, SSE event spec, retry logic |
| [docs/AGENTS.md](docs/AGENTS.md) | Deep agent specs: inputs, outputs, retries, cost tables |
| [docs/SWIGGY_MCP.md](docs/SWIGGY_MCP.md) | Swiggy MCP integration guide (all 3 services) |
| [docs/SWIGGY_CAPABILITY_MATRIX.md](docs/SWIGGY_CAPABILITY_MATRIX.md) | Every Swiggy capability mapped to MealOS use cases |
| [docs/prompts/](docs/prompts/) | Production AI prompt library (all agents) |
| [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | UI bible: typography, tokens, all 19 components, motion |
| [docs/UX.md](docs/UX.md) | 12 UX laws, screen-by-screen rules, micro-interactions |
| [docs/TESTING.md](docs/TESTING.md) | Unit, integration, E2E, agent regression, CI pipeline |
| [docs/TEST_SCENARIOS.md](docs/TEST_SCENARIOS.md) | 100 E2E scenarios with expected decisions and assertions |
| [docs/POSTMORTEM.md](docs/POSTMORTEM.md) | "2 years, 1M users" retro — what aged poorly and why |
| [docs/ARCHITECTURE_DECISIONS.md](docs/ARCHITECTURE_DECISIONS.md) | 8 ADRs with context, alternatives, and revisit triggers |
| [docs/IMPLEMENTATION_PLAYBOOK.md](docs/IMPLEMENTATION_PLAYBOOK.md) | Day-by-day build order, milestones, DoD, never-before rules |
| [docs/BACKEND_DESIGN.md](docs/BACKEND_DESIGN.md) | All 8 services: interfaces, failures, caching, metrics |
| [docs/TYPES.md](docs/TYPES.md) | Complete TypeScript domain type library (~85 types) |
| [docs/SCHEMAS.md](docs/SCHEMAS.md) | Zod schemas for every route, SSE event, and LLM output |
| [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md) | AppSec threat model — 17 findings incl. ship blockers |
| [docs/FAILURE_MODES.md](docs/FAILURE_MODES.md) | AI Failure Bible — 25 failure modes with exact handling |
| [docs/COST_OPTIMIZATION.md](docs/COST_OPTIMIZATION.md) | Path from $0.026 to ~$0.003 per situation |
| [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md) | Metrics, logs, tracing, dashboards, alerts, health checks |
| [docs/PROMPT_ENGINEERING_GUIDE.md](docs/PROMPT_ENGINEERING_GUIDE.md) | Why each prompt exists; when not to call Claude |
| [docs/DESIGN_REVIEW.md](docs/DESIGN_REVIEW.md) | Three-reviewer design review transcript with blockers |
| [docs/FUTURE_EVOLUTION.md](docs/FUTURE_EVOLUTION.md) | MealOS at 10M users — what ages badly, what survives |
| [docs/GITHUB_ISSUES_P1.md](docs/GITHUB_ISSUES_P1.md) + [P2](docs/GITHUB_ISSUES_P2.md) | ~200 issues across 12 epics with acceptance criteria |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Local setup, branch naming, agent development, DB workflow |
| [CODE_STYLE.md](CODE_STYLE.md) | TypeScript standards, naming conventions, CSS rules |

---

## The 90-Second Demo

```
[Tap microphone]
"I want to hit 150 grams of protein today"

→ Confidence: 78%  ✔ Budget ✔ Diet ✗ Protein target
→ "For your full day, or just dinner?" [Full day]

→ Planning Graph: Understood → Profile → Searching → Scoring → Plan Ready

→ ┌─────────────┬──────────┬──────────┬────────────┐
  │             │  COOK ✓  │  ORDER   │  DINE OUT  │
  ├─────────────┼──────────┼──────────┼────────────┤
  │ Score       │  92/100  │  71/100  │  44/100    │
  │ Cost        │  ₹ 180   │  ₹ 640   │  ₹ 1,400   │
  │ Time        │  35 min  │  22 min  │  90 min    │
  │ Protein     │  ~152g   │  ~98g    │  ~80g      │
  └─────────────┴──────────┴──────────┴────────────┘

→ "Cooking is the only way to hit 150g vegetarian within ₹350."

→ Paneer Bhurji + Rajma + Brown Rice
  [▶ YouTube Tutorial]  [Add to Instamart ↗]

→ Swiggy opens. 3 missing ingredients in cart. 14 min delivery.
```

---

## Prototype vs Production

The `src/frontend/mealos/` directory is the original prototype — kept as a design reference only. The CSS design system (`mealos.css`) is being ported into production components. `MealOSApp.tsx` will not be evolved — it is a starting point, not a foundation.

---

## Current Branch

`draft/mealos-ui-snapshot-20260508` — planning phase complete, build starts next.
