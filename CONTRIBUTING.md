# Contributing to MealOS AI

Welcome. This guide gets you from zero to a working local environment and explains how the codebase is organized, how to contribute changes, and what the rules are before opening a PR.

---

## 1. Prerequisites

Install these before anything else.

| Tool | Version | Why |
|---|---|---|
| Node.js | 18+ (LTS) | Required by Next.js 16 |
| pnpm | 9+ | Package manager (see note below) |
| Docker | Any recent | Local PostgreSQL (Redis in V2) |
| Git | Any | Obviously |

**Why pnpm and not npm/yarn?**
pnpm uses a content-addressable store and hard-links packages instead of copying them. On a project with heavy AI-SDK and Prisma dependencies, install times drop from ~90s to ~15s on a warm cache. It also enforces strict dependency isolation — a package can only access what it explicitly declared, which catches phantom dependency bugs early. All scripts in `package.json` are written for pnpm.

Install pnpm:
```bash
npm install -g pnpm
```

**Accounts and credentials you need:**

- **Clerk account** — [clerk.com](https://clerk.com), free tier is fine. You need a publishable key and secret key from an Application you create in the dashboard.
- **Anthropic API key** — [console.anthropic.com](https://console.anthropic.com). You need an API key with access to `claude-haiku-4-5` and `claude-sonnet-4-6`. Free trial credits work for development.
- **YouTube Data API key** — See quick setup below.
- **Swiggy MCP credentials** — See below. You can develop without them using a mock flag.

**Getting a YouTube Data API key (< 5 minutes):**
1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a new project (or use an existing one).
2. Navigate to APIs & Services → Library, search for "YouTube Data API v3", and enable it.
3. Go to APIs & Services → Credentials → Create Credentials → API Key.
4. Copy the key. You do not need to restrict it for local development, but do restrict it before using it in production.

**Getting Swiggy MCP credentials:**
Swiggy MCP access is provided by the team — ask a maintainer to share the credentials in the team password manager. The credentials consist of a `SWIGGY_MCP_API_KEY` and a `SWIGGY_MCP_BASE_URL`. If you do not have them yet, see the section below on running without Swiggy MCP.

---

## 2. Local Setup

Run these commands in order. Each one must succeed before the next.

```bash
# 1. Clone the repository
git clone https://github.com/mealos-ai/mealos.git
cd mealos

# 2. Install dependencies
pnpm install

# 3. Create your local environment file
cp .env.local.example .env.local
```

Open `.env.local` and fill in the required values. See the Environment Variables Reference section below for every variable.

```bash
# 4. Start local PostgreSQL via Docker
docker compose up -d

# 5. Push the Prisma schema to your local database
pnpm db:push

# 6. Seed test data (creates sample users, situations, and plans)
pnpm db:seed

# 7. Start the dev server
pnpm dev
```

The app is now running at [http://localhost:3000](http://localhost:3000).

**What the dev environment includes:**
- Full Next.js dev server with hot reload
- Local PostgreSQL database (via Docker)
- Clerk auth in development mode (sign in with any email)
- Live Claude agent calls (real API, real cost — see token costs section)

**What the dev environment does NOT include:**
- Swiggy MCP live data — if `SWIGGY_MCP_API_KEY` is not set, the app falls back to a static fixture response so you can work on UI and agent logic without live restaurant data. No configuration needed; the fallback is automatic.
- Redis / BullMQ — these are V2 features and are not needed locally.

**Running without Swiggy MCP:**
If you do not have MCP credentials yet, just leave `SWIGGY_MCP_API_KEY` empty in `.env.local`. The `lib/mcp/swiggy.ts` client detects the missing key and returns fixture data. You will see a console warning on startup to remind you. Everything else works normally.

---

## 3. Environment Variables Reference

These all live in `.env.local` locally. Never commit this file — it is in `.gitignore`. Production values are set in the Vercel dashboard.

| Variable | Required | Where to get it | What breaks if missing | Example (not real) |
|---|---|---|---|---|
| `DATABASE_URL` | Required | Your Docker compose setup generates this | All DB calls fail immediately | `postgresql://postgres:password@localhost:5432/mealos` |
| `DIRECT_URL` | Required | Same as `DATABASE_URL` for local; Vercel Postgres provides a separate direct URL | Prisma migrations fail | `postgresql://postgres:password@localhost:5432/mealos` |
| `CLERK_PUBLISHABLE_KEY` | Required | Clerk dashboard → API Keys | Auth UI doesn't load | `pk_test_abc123...` |
| `CLERK_SECRET_KEY` | Required | Clerk dashboard → API Keys | Server-side auth fails; all protected routes 401 | `sk_test_abc123...` |
| `ANTHROPIC_API_KEY` | Required | console.anthropic.com | All agent calls fail with 401; Planning, Memory, Scheduler agents are broken | `sk-ant-api03-...` |
| `YOUTUBE_API_KEY` | Required | Google Cloud Console | Recipe agent cannot fetch cooking videos; returns empty video results | `AIzaSy...` |
| `SWIGGY_MCP_API_KEY` | Optional | Team password manager | App falls back to fixture data; no live restaurant results | `mcp_live_...` |
| `SWIGGY_MCP_BASE_URL` | Optional | Team password manager | Same as above | `https://mcp.swiggy.com/v1` |
| `MOCK_AGENTS` | Optional | Set in shell | — | `true` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Required | Set to `/sign-in` | Clerk redirect loops | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Required | Set to `/sign-up` | Clerk redirect loops | `/sign-up` |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` | Required | Set to `/` | Post-login redirect broken | `/` |
| `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` | Required | Set to `/` | Post-signup redirect broken | `/` |
| `SENTRY_DSN` | Optional | sentry.io dashboard | Error tracking disabled; app still works | `https://abc@sentry.io/123` |

The `.env.local.example` file in the repo has all of these with empty values and comments.

---

## 4. Project Structure Tour

```
mealos/
├── app/                    # Next.js App Router pages and API routes
│   ├── (auth)/             # Clerk auth pages (sign-in, sign-up)
│   ├── api/                # API route handlers
│   │   ├── agents/         # Agent invocation endpoints
│   │   ├── plans/          # Plan CRUD endpoints
│   │   └── situations/     # Situation endpoints
│   └── ...                 # Page routes
│
├── components/             # React components, organized by domain
│   ├── situation/          # Situation input flow (SituationForm, SituationCard, etc.)
│   ├── board/              # The Planning Board (MealBoard, PlanCard, etc.)
│   ├── memory/             # Memory panel (MemoryList, MemoryEditor, etc.)
│   └── ui/                 # Domain-agnostic primitives (Button, Modal, Spinner, etc.)
│
├── lib/                    # Server-side business logic (never imported by components directly)
│   ├── agents/             # AI agent definitions (planningAgent.ts, memoryAgent.ts, etc.)
│   ├── mcp/                # Swiggy MCP client (swiggy.ts)
│   ├── engine/             # Deterministic Decision Engine (scorer.ts, weights.ts, etc.)
│   ├── db/                 # Repository functions — all Prisma calls live here
│   ├── db.ts               # Prisma client singleton
│   ├── claude.ts           # Anthropic SDK wrapper
│   ├── sse.ts              # SSE stream helpers
│   └── youtube.ts          # YouTube Data API client
│
├── prisma/
│   ├── schema.prisma       # Single source of truth for the data model
│   ├── seed.ts             # Seed script for local dev
│   └── migrations/         # Auto-generated by Prisma — never hand-edit
│
├── stores/                 # Zustand stores (client-side state)
├── types/                  # Shared TypeScript types (not Prisma-generated)
├── hooks/                  # React hooks (useSSE.ts, usePlan.ts, etc.)
├── styles/                 # Global CSS (mealos.css, variables.css)
└── docs/                   # All planning, API, and architecture docs
    └── prompts/            # Agent prompt strings (source of truth)
```

**Component naming convention:** Components follow the pattern `domain/ComponentName.tsx`. Every component that has its own styles lives next to a `ComponentName.module.css` file. For example:

```
components/
└── board/
    ├── MealBoard.tsx
    ├── MealBoard.module.css
    ├── PlanCard.tsx
    └── PlanCard.module.css
```

UI primitives in `components/ui/` have no domain prefix because they are shared across the app.

**lib/ is server-only.** Nothing in `lib/` should be imported into a React component directly. Components call API routes; API routes call `lib/`. This boundary keeps secrets (API keys, DB connections) out of the client bundle.

---

## 5. Development Workflow

**Branch naming:**

| Prefix | When to use |
|---|---|
| `feat/` | New user-facing feature |
| `fix/` | Bug fix |
| `chore/` | Dependency updates, config, tooling |
| `docs/` | Documentation only |
| `refactor/` | Code reorganization with no behavior change |

Examples: `feat/scheduler-agent`, `fix/sse-reconnect`, `chore/bump-prisma`.

**Commit message format — Conventional Commits:**

```
type(scope): short description

Optional longer body explaining why, not what.
```

Examples:
```
feat(engine): add late-night snack situation type
fix(agents): handle empty Swiggy MCP response gracefully
chore(deps): bump @anthropic-ai/sdk to 0.27.0
docs(api): document /api/situations endpoint
```

Valid types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, `perf`.

**Running tests before pushing:**

```bash
# Fast — Decision Engine unit tests only (no network, < 5 seconds)
pnpm test:engine

# Medium — All unit and integration tests
pnpm test

# Slow — E2E tests (requires running dev server)
pnpm test:e2e

# Type checking (catches what tests might miss)
pnpm typecheck
```

Run `pnpm test:engine` and `pnpm typecheck` before every push. E2E tests run in CI and do not need to run locally every time, but run them when you change a user flow.

**Running a single test file:**
```bash
pnpm test lib/engine/scorer.test.ts
```

**Type checking:**
```bash
pnpm typecheck
```

This runs `tsc --noEmit` against the full project. Fix all errors before opening a PR — the CI gate will block merges with type errors.

---

## 6. Working with AI Agents

**Agent files live in `lib/agents/`.** Each agent file is named `agentName.ts` in camelCase: `planningAgent.ts`, `memoryAgent.ts`, `schedulerAgent.ts`, `recipeAgent.ts`.

**Prompt strings are NOT inline in the agent file.** They live in `docs/prompts/` as `.md` files (e.g., `docs/prompts/planning-agent.md`). The agent file reads and interpolates the prompt at runtime. This makes prompt changes reviewable in PRs without touching TypeScript code.

**To update a prompt:**
1. Edit the file in `docs/prompts/`.
2. Run the golden set regression to check for regressions: `pnpm test:agents`.
3. Attach the diff of the golden set output to your PR.

**Running the golden set regression:**
```bash
pnpm test:agents
```

This runs a fixed set of situations through the agent pipeline and compares structured output against expected fixtures in `tests/agents/golden/`. It makes real API calls — budget approximately $0.05–0.10 for a full run.

**Mocking agents for UI work:**
If you are working on UI components and do not want to make real Claude API calls, set `MOCK_AGENTS=true`:

```bash
MOCK_AGENTS=true pnpm dev
```

All agent endpoints return fixture responses from `tests/agents/fixtures/` instantly. No API cost, no latency. Do not commit `.env.local` with this set — it is a local override only.

**Token cost estimate:**
A full planning pipeline run (Planning Agent + Memory Agent) for one situation costs approximately **$0.03** using the current model tier assignment (claude-sonnet-4-6 for Planning, claude-haiku-4-5 for Memory and Scheduler). A Recipe Agent call adds ~$0.005. Budget accordingly when running the golden set repeatedly.

---

## 7. Working with the Decision Engine

The Decision Engine is the deterministic scoring layer in `lib/engine/`. It assigns compatibility scores to meal options using weighted criteria — no LLM involved.

**Key files:**
- `lib/engine/scorer.ts` — Main scoring logic; all exported functions are pure
- `lib/engine/weights.ts` — Weight tables per situation type
- `lib/engine/scorer.test.ts` — Unit tests

**Adding a new situation type:**
1. Add the situation type to `types/situations.ts`.
2. Add a weight table entry in `lib/engine/weights.ts`. Every entry must have a comment explaining each weight value.
3. Write at least 3 unit tests covering: a typical case, an edge case (empty input), and a boundary case.
4. Run `pnpm test:engine` to confirm the invariant check passes.

**The weights-sum-to-1.0 invariant:**
Every weight table must have weights that sum to exactly 1.0. This is enforced at runtime by a check in `scorer.ts` that throws on startup if any table violates this. It is also tested explicitly in `scorer.test.ts`. If you add a weight table and forget to balance it, the app will not start and you will see a clear error in the console.

**Running Decision Engine tests:**
```bash
pnpm test:engine
```

This is fast (< 5 seconds, no network calls) and should be run before every push.

---

## 8. Database Workflow

**All Prisma calls go through repository functions in `lib/db/`.** Never import `prisma` directly in an API route. See CODE_STYLE.md for the full rule.

**Making schema changes:**
1. Edit `prisma/schema.prisma`.
2. Run `pnpm db:migrate` — this creates a migration file under `prisma/migrations/` and applies it to your local database.
3. Commit the schema file and the generated migration file together.

Never edit migration files by hand. If a migration is wrong, create a new one that corrects it.

**Useful database commands:**

```bash
# Apply schema changes (generates migration + applies it)
pnpm db:migrate

# Push schema without creating a migration (dev only, not for production changes)
pnpm db:push

# Reset local DB and re-seed (destructive — deletes all local data)
pnpm db:reset

# Open Prisma Studio to browse/edit data visually
pnpm db:studio

# Re-run the seed script against current DB
pnpm db:seed
```

`pnpm db:reset` is destructive. It drops the database, recreates it from the current schema, and runs the seed. Only use it locally.

---

## 9. Deployment

**Main branch** auto-deploys to production on Vercel. Do not push directly to `main` — open a PR.

**Every PR** gets a preview deploy on Vercel with its own URL. The URL is posted as a comment by the Vercel bot. Test your changes there before requesting review.

**Environment variables** must be set in the Vercel dashboard (Settings → Environment Variables). They are never committed to the repository. If you add a new required env var, you must:
1. Add it to `.env.local.example` with a placeholder value and a comment.
2. Document it in the Environment Variables Reference section above.
3. Add it in the Vercel dashboard for all three environments (Production, Preview, Development).

**Database migrations on deploy:**
The Vercel build command is configured to run `pnpm db:migrate` before starting the app. This means migrations are applied automatically on deploy. Make sure any migration you land is backwards-compatible with the previous version of the app if a rollback might be needed.

**Checking errors after deploy:**
After a preview deploy, check Sentry for any new errors. The Sentry project is `mealos-ai` — ask a maintainer for access if you do not have it.
