# ADR 0001 — Why Next.js

**Status:** Accepted
**Date:** 2026-07-07
**Deciders:** MealOS AI founding engineering team

---

## Problem

MealOS V1 must ship a full product — situation input UI, progressive Situation Board streamed over SSE, ten authenticated API routes (`docs/API.md`), a four-agent LLM pipeline, and a Postgres data layer — in roughly three weeks (`MVP.md`), with a team of one-to-five engineers and no dedicated infrastructure operator. The stack choice determines deployment story, streaming support, auth integration, and how painful the eventual backend extraction will be. `ARCHITECTURE.md` Phase 3 already anticipates that the API tier will one day leave the frontend framework ("migrate to standalone Hono/Bun service at scale"), so the framework must be a good *starting* host for the backend, not necessarily its permanent home.

## Decision

MealOS V1 is a single Next.js 16 App Router application deployed on Vercel. Frontend (React 19 Server/Client Components), API layer (route handlers under `app/api/v1/`), and all backend services (as logical modules under `lib/`, per `docs/BACKEND_DESIGN.md` §1) live in one deployable. Route handlers are deliberately thin — validate, authenticate, delegate — so the framework never owns business logic.

## Alternatives Considered

- **Separate SPA (Vite + React) + standalone API (Fastify/Hono).** The "clean" split. Rejected for V1: two deployments, two env-var sets, CORS management, and a second hosting decision — all cost, no benefit, while the API's consumers are exactly one web client. Legacy ADR-006 rejected the same split for the same reasons at the repo level.
- **Remix / React Router 7.** Comparable App-Router-era DX, good streaming. Rejected on ecosystem gravity: Clerk, Vercel deployment primitives, `next/font`, `next/image`, and the team's existing prototype (`src/frontend/mealos/`) are all Next-shaped. No countervailing advantage.
- **SvelteKit.** Smaller bundles, excellent DX. Rejected: the design system and prototype are React; React 19 server components map directly onto the Situation Board's progressive-render model; hiring and future-contributor familiarity favor React in this context.
- **Express/Node monolith with server-rendered templates.** Rejected: the Situation Board is an interactive, progressively-hydrating client experience (see `docs/UX.md`); a template-rendered app fights that from day one.

## Tradeoffs Accepted

- **Serverless constraints shape the backend.** No long-lived workers; async work rides `waitUntil` or the open SSE connection (`docs/BACKEND_DESIGN.md` §1.3). The queue migration is deliberately deferred (ADR 0007).
- **SSE on Vercel has function-duration and concurrency limits.** Accepted with eyes open; `docs/DESIGN_REVIEW.md` DK-4 requires these limits documented and reconnect behavior tested before M2.
- **Framework lock-in at the edges.** Route handlers, middleware, and font/image pipelines are Next-specific. Mitigated by the thin-handler rule: business logic lives in `lib/services/`, which is framework-agnostic by construction.
- **One deployable means one blast radius.** A bad deploy takes down UI and API together. Acceptable at V1 traffic; a listed driver for the Stage-2 extraction in ADR 0010.

## Future Consequences

- **Easier:** one repo, one deploy, preview deployments per PR for free, zero CORS, shared types end-to-end without a monorepo (legacy ADR-006).
- **Harder:** the API tier will eventually outgrow serverless — `docs/FUTURE_EVOLUTION.md` §2.1 records the projected forcing function as *SSE stream residency*, not raw scale. When that happens the extraction is mechanical precisely because handlers are thin ("Next.js API routes: Retired — served exactly their intended tour of duty. No regrets, including the decision to start there," `docs/FUTURE_EVOLUTION.md` §5).
- **Revisit triggers:** sustained SSE concurrency approaching Vercel plan limits; p95 pipeline latency pressing the function timeout; a second client (mobile app) needing an API host with its own deploy cadence. Any of these activates Stage 2 of ADR 0010 — do not fight the platform past its design envelope.

*Rationale reconstructed post-hoc: the framework choice predates this record; the constraints above are reconstructed from `ARCHITECTURE.md` Phase 1 (prototype audit) and `MVP.md`.*
