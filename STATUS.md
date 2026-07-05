# MealOS AI — Status (2026-07-05)

## What it is
A Next.js frontend prototype for an AI meal assistant "powered by Swiggy". No real AI or Swiggy API — all data is hardcoded mock data. The app demonstrates a concept UI for intent-driven food discovery.

## Stack
- Next.js 16.2.4 · React 19.2.4 · TypeScript · Tailwind CSS v4
- No backend, no API routes, no database

## Branch
`draft/mealos-ui-snapshot-20260508` — 2 commits ahead of `master`, clean working tree.

## File Map
```
app/
  page.tsx          → root route, renders MealOSApp
  chat/page.tsx     → /chat route, also renders MealOSApp (no distinct chat UI)
  layout.tsx        → Next.js root layout
  globals.css       → base styles

src/frontend/mealos/
  MealOSApp.tsx     → entire app (~196 lines, single file)
  data.ts           → all mock data (recipes, restaurants, dineout, latenight)
  mealos.css        → custom component styles
```

## Modes / Flows
| Mode | Trigger | What it shows |
|---|---|---|
| `landing` | Default | Search bar + 4 intent chips |
| `instamart` | "Cook something healthy" | Recipe list → recipe detail → step-by-step cooking flow with progress bar |
| `delivery` | "Order quickly" | Restaurant grid, Order button fires toast |
| `dineout` | "Plan a dinner" | Place list → detail with time slot picker + confirm reservation |
| `latenight` | "Late night cravings" | Restaurant grid (same layout as delivery) |

Intent is routed via regex on the search query (`modeFromQuery`) — not an LLM.

## Mock Data Scale
- 30 recipes (4 base × expand)
- 45 delivery restaurants (4 base × expand)
- 26 dineout places (3 base × expand)
- 28 late-night restaurants (3 base × expand)
- 16 ingredients, 8 cooking steps

Images use `source.unsplash.com` (deprecated API — likely broken in production).

## What's Missing / Not Built
- **No AI** — search is regex, not an LLM call. The chat page is a dead route.
- **No Swiggy API** — all restaurant/recipe data is fabricated.
- **No real images** — card images use Unsplash source API (deprecated); UI falls back to text placeholders.
- **No icons** — all icons are 2-letter text abbreviations (e.g. "CK", "OD", "AI").
- **No tests** — zero test files.
- **No authentication**, cart, payments, or checkout flow.
- Cozy/Light theme toggle exists in the navbar but theme differences are minimal.

## Recent Commits
```
6289aa8  bug fixes
3e10509  WIP: draft snapshot
e7b25f9  feat: remove Zomato, exclusively feature Swiggy ecosystem, revamp landing page UI
23501e8  chore: move Next.js project to root for Vercel deployment
cb2f5ed  feat: implement core landing page and AI chat interface
```

## To Run
```bash
npm install
npm run dev   # http://localhost:3000
```
