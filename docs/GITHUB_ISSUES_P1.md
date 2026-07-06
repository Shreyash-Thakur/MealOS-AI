# MealOS AI — GitHub Issues P1 (ISSUE-001 through ISSUE-105)

> Generated 2026-07-06. Format: Type · Labels · Epic · Depends On · 2-sentence description · 3-4 acceptance criteria.

---

## EPIC 1 — Foundation (M0)

### ISSUE-001: Foundation (M0) — Project Scaffolding and Infrastructure Epic
**Type:** epic  **Labels:** devops P0 XL
**Epic:** —  **Depends on:** —

Establishes the full technical foundation for MealOS AI: project structure, database, auth, CI/CD, and shared utilities. All subsequent epics depend on this milestone being complete and deployed.

**Acceptance Criteria:**
- [ ] Next.js 16 + TypeScript strict project boots locally with `pnpm dev`
- [ ] Prisma schema is applied to Neon PostgreSQL and seed script runs without error
- [ ] Clerk authentication gates all protected routes in production
- [ ] Vercel deployment is live on `main` with passing GitHub Actions CI

---

### ISSUE-002: Next.js 16 + TypeScript Strict Project Init
**Type:** task  **Labels:** devops P0 S
**Epic:** ISSUE-001  **Depends on:** —

Initialize the Next.js 16 App Router project with `strict: true` in `tsconfig.json` and configure path aliases (`@/lib`, `@/components`, `@/types`). Verify the project builds cleanly with zero TypeScript errors.

**Acceptance Criteria:**
- [ ] `tsconfig.json` has `"strict": true` and all 5 path alias entries (`@/app`, `@/components`, `@/lib`, `@/types`, `@/prisma`)
- [ ] `pnpm build` exits 0 with no type errors on a fresh clone
- [ ] Next.js App Router file-based routing is confirmed working (root layout + one test page)
- [ ] `next.config.ts` is TypeScript (not `.js`) and has no `@ts-ignore` suppressions

---

### ISSUE-003: Prisma Schema + Neon PostgreSQL Setup
**Type:** task  **Labels:** devops P0 M
**Epic:** ISSUE-001  **Depends on:** ISSUE-002

Define the 5-table Prisma schema (`users`, `user_memory_facts`, `situations`, `recommendations`, `user_actions`) with correct relations and indexes. Configure the Prisma client to use the Neon PostgreSQL `DATABASE_URL` from `.env.local`.

**Acceptance Criteria:**
- [ ] All 5 tables exist in Neon after `pnpm db:push` with no migration drift
- [ ] Foreign key relations are enforced at the DB level (cascade deletes on user removal)
- [ ] `@/prisma/client.ts` exports a singleton Prisma client safe for Next.js hot-reload
- [ ] `prisma studio` opens and can browse all 5 tables without error

---

### ISSUE-004: Clerk Authentication Integration
**Type:** task  **Labels:** auth P0 M
**Epic:** ISSUE-001  **Depends on:** ISSUE-002

Integrate Clerk into the Next.js middleware to gate all `/app/*` routes and `/api/v1/*` endpoints. Expose a typed `getUserId()` helper in `lib/auth.ts` that throws `AuthError` on missing session.

**Acceptance Criteria:**
- [ ] Unauthenticated requests to `/api/v1/*` return `401` with the standard error shape from ISSUE-010
- [ ] `middleware.ts` uses Clerk `clerkMiddleware()` and correctly marks public vs protected matchers
- [ ] `getUserId()` helper is typed `string` (never `null`) and is used consistently across all API routes
- [ ] Sign-in and sign-up pages are accessible without auth (public routes verified)

---

### ISSUE-005: Environment Variables Setup
**Type:** task  **Labels:** devops P0 XS
**Epic:** ISSUE-001  **Depends on:** ISSUE-002

Create `.env.local.example` documenting all 6 required environment variables with inline comments explaining where to obtain each value. Add a startup validation in `lib/config.ts` that throws a descriptive error if any required variable is missing.

**Acceptance Criteria:**
- [ ] `.env.local.example` lists all 6 vars: `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `ANTHROPIC_API_KEY`, `YOUTUBE_API_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- [ ] `lib/config.ts` validates all vars at import time and throws a named `ConfigError` with the missing key name
- [ ] `.env.local` is in `.gitignore` and `.env.local.example` is committed
- [ ] README documents the setup steps referencing `.env.local.example`

---

### ISSUE-006: Vercel Deployment Pipeline
**Type:** task  **Labels:** devops P0 S
**Epic:** ISSUE-001  **Depends on:** ISSUE-002, ISSUE-005

Configure Vercel to auto-deploy `main` branch to production and create preview deployments for every pull request. Set all 6 environment variables in the Vercel project dashboard and confirm a successful production build.

**Acceptance Criteria:**
- [ ] Push to `main` triggers a production deployment within 5 minutes
- [ ] Opening a PR creates a unique preview URL accessible without Vercel login
- [ ] All 6 env vars are set in Vercel (Production + Preview environments)
- [ ] Build logs show zero TypeScript or ESLint errors

---

### ISSUE-007: GitHub Actions CI — Typecheck and Lint on Every PR
**Type:** task  **Labels:** devops P1 S
**Epic:** ISSUE-001  **Depends on:** ISSUE-002

Add a `.github/workflows/ci.yml` workflow that runs `pnpm typecheck` and `pnpm lint` on every pull request targeting `main`. The workflow must cache `node_modules` and the Next.js build cache to keep runs under 90 seconds.

**Acceptance Criteria:**
- [ ] Workflow triggers on `pull_request` to `main` and `push` to `main`
- [ ] `pnpm typecheck` (`tsc --noEmit`) and `pnpm lint` (ESLint) both run in the workflow
- [ ] `node_modules` is cached by `pnpm-lock.yaml` hash; cache hit keeps total CI under 90s
- [ ] A PR with a type error causes the check to fail and blocks merge

---

### ISSUE-008: Health Check Endpoint GET /api/v1/health
**Type:** task  **Labels:** devops P1 S
**Epic:** ISSUE-001  **Depends on:** ISSUE-003, ISSUE-004

Implement `GET /api/v1/health` that returns HTTP 200 with a JSON body reporting the status of each dependency (DB, Clerk, Anthropic API reachability). If any dependency is unhealthy, return HTTP 503 with the failing dependency identified by name.

**Acceptance Criteria:**
- [ ] Response schema: `{ status: "ok"|"degraded", dependencies: { db: bool, clerk: bool, anthropic: bool }, latencyMs: number }`
- [ ] Prisma `$queryRaw SELECT 1` failure sets `db: false` and overall status to `"degraded"`
- [ ] Endpoint is publicly accessible (no auth required) for uptime monitoring tools
- [ ] Response time is under 2 seconds under normal conditions

---

### ISSUE-009: Prisma Seed Script
**Type:** task  **Labels:** devops P1 S
**Epic:** ISSUE-001  **Depends on:** ISSUE-003

Write `prisma/seed.ts` that populates the database with 2 test users, 4 diverse situations (sick/broke/date/protein), and realistic `user_memory_facts` and `recommendations`. The script must be idempotent (safe to run multiple times without duplicating data).

**Acceptance Criteria:**
- [ ] `pnpm db:seed` completes without error on a fresh Neon database
- [ ] Re-running `pnpm db:seed` does not create duplicate records (upsert by stable IDs)
- [ ] Seeded situations cover at least 4 distinct `situationType` values
- [ ] Seeded memory facts include at least `diet`, `allergies`, `budget`, and `location` keys

---

### ISSUE-010: Error Handling Foundation
**Type:** task  **Labels:** devops P0 S
**Epic:** ISSUE-001  **Depends on:** ISSUE-002

Define typed error codes in `types/errors.ts` (e.g. `AUTH_MISSING`, `VALIDATION_FAILED`, `DB_ERROR`, `AGENT_TIMEOUT`) and a shared `apiError(code, message, status)` helper in `lib/api.ts` that returns consistent `{ error: { code, message } }` JSON responses. All API routes must use this helper exclusively.

**Acceptance Criteria:**
- [ ] `types/errors.ts` exports an exhaustive `ErrorCode` union type with at least 12 codes
- [ ] `apiError()` helper returns `NextResponse.json({ error: { code, message } }, { status })` with correct typing
- [ ] No API route in the codebase uses raw `new Response()` or `NextResponse.json({ message })` without the `error` wrapper
- [ ] 400, 401, 404, 409, 500 status codes are all represented in the error code map

---

### ISSUE-011: pnpm Setup + package.json Scripts
**Type:** task  **Labels:** devops P0 XS
**Epic:** ISSUE-001  **Depends on:** ISSUE-002

Configure the project to use `pnpm` as the sole package manager (`.npmrc` with `engine-strict=true`, `engines.pnpm` version pin) and define all required scripts in `package.json`. Ensure `npm install` and `yarn` are rejected with a clear error message.

**Acceptance Criteria:**
- [ ] `package.json` scripts include: `dev`, `build`, `typecheck`, `test`, `db:push`, `db:seed`, `db:studio`
- [ ] `.npmrc` has `engine-strict=true` and the correct `pnpm` version is pinned in `engines`
- [ ] Running `npm install` prints "Please use pnpm" and exits non-zero
- [ ] `pnpm dev` starts the dev server on port 3000 with hot-reload working

---

### ISSUE-012: BUG — Prisma Connection Pool Exhaustion Under Concurrent Load
**Type:** bug  **Labels:** devops P0 S
**Epic:** ISSUE-001  **Depends on:** ISSUE-003

Under concurrent API requests Prisma opens more connections than Neon's free tier allows (max 5), causing `P2024 Connection pool timeout` errors. Fix by appending `?connection_limit=5&pool_timeout=10` to `DATABASE_URL` and implementing a singleton Prisma client pattern.

**Acceptance Criteria:**
- [ ] `DATABASE_URL` in `.env.local.example` includes `?connection_limit=5&pool_timeout=10` with a comment explaining why
- [ ] Prisma client singleton in `lib/prisma.ts` uses `globalThis` guard to prevent hot-reload duplication
- [ ] 10 concurrent API requests to `/api/v1/health` all succeed without `P2024` errors
- [ ] Error is documented in a code comment in `lib/prisma.ts` so future devs understand the constraint

---

## EPIC 2 — Onboarding and Memory

### ISSUE-020: Onboarding and Memory Epic
**Type:** epic  **Labels:** onboarding memory P0 XL
**Epic:** —  **Depends on:** ISSUE-001

Captures user dietary profile, preferences, and constraints via a 5-screen onboarding flow and persists them as queryable `user_memory_facts`. Exposes a memory panel for users to view, edit, and delete individual facts post-onboarding.

**Acceptance Criteria:**
- [ ] New user completes onboarding and all 5 answers are stored as `user_memory_facts`
- [ ] Memory panel displays, edits, and deletes facts with optimistic UI
- [ ] Soft-expired facts are excluded from AI context queries
- [ ] P0 fields (diet, allergies) cannot be skipped during onboarding

---

### ISSUE-021: Onboarding Flow UI — 5-Screen Wizard
**Type:** feature  **Labels:** onboarding ui P0 M
**Epic:** ISSUE-020  **Depends on:** ISSUE-004

Build a 5-screen onboarding wizard in `app/onboarding/` where each screen asks one question (diet type, allergies, typical budget, preferred cuisines, location). Display a "Step X of 5" progress indicator and persist answers in React state until submission.

**Acceptance Criteria:**
- [ ] 5 distinct screens cover: diet type, allergies, budget range, cuisine preferences, and delivery location
- [ ] "Step X of 5" progress indicator updates on every screen transition
- [ ] Back navigation preserves previously entered answers
- [ ] Submitting the final screen calls `POST /api/v1/onboarding` and redirects to `/app` on success

---

### ISSUE-022: POST /api/v1/onboarding Endpoint
**Type:** task  **Labels:** onboarding P0 M
**Epic:** ISSUE-020  **Depends on:** ISSUE-003, ISSUE-004, ISSUE-010

Implement `POST /api/v1/onboarding` that accepts all 5 onboarding answers and writes them atomically to `user_memory_facts` in a single Prisma transaction. Return `409` if the user has already completed onboarding.

**Acceptance Criteria:**
- [ ] All 5 facts are written in a single `prisma.$transaction()` — all succeed or none persist
- [ ] Existing users who call this endpoint again receive `409 ONBOARDING_ALREADY_COMPLETE`
- [ ] Each fact is stored with `source: "onboarding"` and `expiresAt: null`
- [ ] Response body includes the created fact IDs for client-side confirmation

---

### ISSUE-023: Memory Panel Read View
**Type:** feature  **Labels:** memory ui P1 M
**Epic:** ISSUE-020  **Depends on:** ISSUE-026

Build the memory panel read view at `components/memory/MemoryPanel.tsx` that fetches from `GET /api/v1/memory` and renders each fact as a row with: fact key (formatted), value, and a colored `source` badge (onboarding/manual/ai-inferred). Show a skeleton loader while fetching.

**Acceptance Criteria:**
- [ ] All facts from `GET /api/v1/memory` render with key, value, and source badge
- [ ] Source badge colors are distinct: onboarding=blue, manual=green, ai-inferred=purple
- [ ] Skeleton loader (3 placeholder rows) shows during initial fetch
- [ ] Empty state shows "No preferences saved yet — complete onboarding to get started"

---

### ISSUE-024: Memory Panel Inline Edit
**Type:** feature  **Labels:** memory ui P1 M
**Epic:** ISSUE-020  **Depends on:** ISSUE-023, ISSUE-027

Enable inline editing in the memory panel: tapping a fact row turns the value into an `<input>`, and `onBlur` or pressing Enter calls `PATCH /api/v1/memory` with optimistic UI. Revert to the original value and show a toast if the API call fails.

**Acceptance Criteria:**
- [ ] Tapping any fact value renders an inline `<input>` pre-filled with the current value
- [ ] `onBlur` and Enter both trigger `PATCH /api/v1/memory` for that single key
- [ ] Optimistic update shows the new value immediately; API failure reverts it with an error toast
- [ ] Source badge changes to `manual` after a successful user edit

---

### ISSUE-025: Memory Panel Delete with Confirmation
**Type:** feature  **Labels:** memory ui P1 S
**Epic:** ISSUE-020  **Depends on:** ISSUE-023, ISSUE-027

Add a delete affordance (trash icon, visible on hover) to each memory fact row. Clicking it shows an inline confirmation message "We'll ask you about this next time" with Confirm and Cancel buttons before calling `PATCH /api/v1/memory` with `value: null`.

**Acceptance Criteria:**
- [ ] Trash icon appears on row hover (desktop) or is always visible (mobile)
- [ ] Confirmation step shows the string "We'll ask you about this next time" verbatim
- [ ] Cancel dismisses without any API call
- [ ] Deleted fact disappears from the panel immediately (optimistic removal)

---

### ISSUE-026: GET /api/v1/memory Endpoint
**Type:** task  **Labels:** memory P0 S
**Epic:** ISSUE-020  **Depends on:** ISSUE-003, ISSUE-004, ISSUE-010

Implement `GET /api/v1/memory` that returns the authenticated user's profile plus all non-expired `user_memory_facts` as `{ profile: User, facts: MemoryFact[] }`. Facts with `expiresAt` in the past must be excluded from the response.

**Acceptance Criteria:**
- [ ] Response schema: `{ profile: { id, email, createdAt }, facts: [{ id, key, value, source, expiresAt }] }`
- [ ] Facts where `expiresAt < now()` are not included in the response
- [ ] Unauthenticated requests return `401 AUTH_MISSING`
- [ ] Response is typed end-to-end with a shared `MemoryResponse` type in `types/memory.ts`

---

### ISSUE-027: PATCH /api/v1/memory Endpoint
**Type:** task  **Labels:** memory P0 M
**Epic:** ISSUE-020  **Depends on:** ISSUE-003, ISSUE-004, ISSUE-010

Implement `PATCH /api/v1/memory` that accepts a partial `{ [key: string]: string | null }` map and upserts each key individually. Return a per-key success/failure report so the client can handle partial failures gracefully.

**Acceptance Criteria:**
- [ ] Request body is `{ updates: Record<string, string | null> }` (validated with Zod)
- [ ] Each key is processed independently; one key's DB error does not roll back others
- [ ] Response: `{ results: Record<string, "ok" | { error: string }> }`
- [ ] Setting a value to `null` soft-deletes the fact (sets `deletedAt`, not a hard `DELETE`)

---

### ISSUE-028: Memory Fact Expiry Logic
**Type:** task  **Labels:** memory P1 S
**Epic:** ISSUE-020  **Depends on:** ISSUE-026, ISSUE-027

Implement soft expiry: facts with `expiresAt` in the past are excluded from all context-building queries in `lib/memory.ts`. Expose a `getActiveMemoryFacts(userId)` helper used by all agents — never query `user_memory_facts` directly from agent code.

**Acceptance Criteria:**
- [ ] `getActiveMemoryFacts(userId)` filters by `expiresAt > now() OR expiresAt IS NULL`
- [ ] All 4 agent implementations import from `lib/memory.ts` — no direct Prisma calls for facts
- [ ] AI-inferred facts (source=`ai-inferred`) default to `expiresAt = now() + 30 days`
- [ ] A Prisma query test confirms expired facts are excluded

---

### ISSUE-029: Memory Panel — Mobile Drawer vs Desktop Sidebar
**Type:** feature  **Labels:** memory ui P2 M
**Epic:** ISSUE-020  **Depends on:** ISSUE-023

Implement responsive layout for the memory panel: on desktop (≥768px) it renders as a fixed right sidebar alongside the main chat; on mobile it is a bottom drawer triggered by a floating button. Use a single `MemoryPanel` component with responsive CSS — no duplicate markup.

**Acceptance Criteria:**
- [ ] Breakpoint at 768px: sidebar on desktop, drawer on mobile
- [ ] Mobile drawer opens/closes with a smooth slide-up CSS transition (no JS animation library)
- [ ] Drawer close button and backdrop click both dismiss the drawer
- [ ] A single `MemoryPanel` component handles both layouts via Tailwind responsive classes

---

### ISSUE-030: Onboarding Skip Protection for P0 Fields
**Type:** task  **Labels:** onboarding P0 S
**Epic:** ISSUE-020  **Depends on:** ISSUE-021, ISSUE-022

Prevent users from skipping the diet type and allergies screens by disabling the "Next" button until a valid answer is entered. On the backend, `POST /api/v1/onboarding` must return `422 VALIDATION_FAILED` if either `diet` or `allergies` is absent from the request body.

**Acceptance Criteria:**
- [ ] "Next" button on diet and allergies screens is `disabled` (not hidden) until a non-empty value is selected or typed
- [ ] All other screens (budget, cuisines, location) allow skipping by passing a `null` value
- [ ] `POST /api/v1/onboarding` rejects payloads missing `diet` or `allergies` with `422 VALIDATION_FAILED`
- [ ] Error message specifies which P0 field is missing: "diet is required to continue"

---

## EPIC 3 — Situation Input

### ISSUE-040: Situation Input Epic
**Type:** epic  **Labels:** situation ui P0 XL
**Epic:** —  **Depends on:** ISSUE-001, ISSUE-020

Captures the user's current meal situation via text, voice, or quick-tap templates and pipes it through the Conversation Agent to produce a `SituationContext` JSON. Drives the SSE planning pipeline visible as an animated `PlanningGraph`.

**Acceptance Criteria:**
- [ ] User can submit a situation via text input, voice button, or template chip
- [ ] SSE stream delivers all 6 event types to the client without dropping events on reconnect
- [ ] `ConfidenceCard` accurately reflects which context fields are populated
- [ ] Situation state transitions are enforced at the API level with `409` on invalid transitions

---

### ISSUE-041: SituationInput Component
**Type:** feature  **Labels:** situation ui P0 M
**Epic:** ISSUE-040  **Depends on:** ISSUE-004

Build `components/situation/SituationInput.tsx` — a textarea with 500-character limit, live character counter, and a submit button. The placeholder text rotates every 4 seconds through 4 example situations using a CSS fade transition.

**Acceptance Criteria:**
- [ ] Character counter shows `X / 500` and turns red at 480+ characters
- [ ] Submit button is disabled when input is empty or exceeds 500 characters
- [ ] Placeholder text rotates every 4 seconds through at least 4 distinct example situations
- [ ] Pressing Enter (without Shift) submits the form; Shift+Enter inserts a newline

---

### ISSUE-042: VoiceButton Component — Web Speech API Integration
**Type:** feature  **Labels:** situation ui P1 M
**Epic:** ISSUE-040  **Depends on:** ISSUE-041

Implement `components/situation/VoiceButton.tsx` using the Web Speech API that cycles through 4 states: idle (mic icon), listening (animated pulse + red), processing (spinner), and error (error icon with retry). Transcribed text is appended to the `SituationInput` field.

**Acceptance Criteria:**
- [ ] All 4 states (idle/listening/processing/error) render distinct visual feedback
- [ ] Transcribed speech is appended to — not replaced in — the existing `SituationInput` text
- [ ] Listening auto-stops after 10 seconds of silence via `SpeechRecognition.interimResults`
- [ ] Error state shows a human-readable message ("Could not hear you — try again")

---

### ISSUE-043: Quick Template Chips
**Type:** feature  **Labels:** situation ui P1 S
**Epic:** ISSUE-040  **Depends on:** ISSUE-041

Render 6 horizontally scrollable template chips below `SituationInput`: "I'm sick", "Broke this week", "Date night", "High protein", "Quick meal", "Party snacks". Tapping a chip sets the input to a pre-written situation string and focuses the textarea for editing.

**Acceptance Criteria:**
- [ ] All 6 chips are defined in a `SITUATION_TEMPLATES` const in `lib/constants.ts` (not hardcoded in JSX)
- [ ] Tapping a chip populates the textarea and moves focus to it for immediate editing
- [ ] Chip strip is horizontally scrollable on mobile without wrapping
- [ ] Active chip (last tapped) shows a selected visual state until the user edits the text

---

### ISSUE-044: POST /api/v1/situations Endpoint
**Type:** task  **Labels:** situation P0 M
**Epic:** ISSUE-040  **Depends on:** ISSUE-003, ISSUE-004, ISSUE-010, ISSUE-045

Implement `POST /api/v1/situations` that creates a `situations` row in state `CREATED`, fires the Conversation Agent asynchronously (do not await it in the request), and returns `{ situationId, streamUrl }` immediately. The stream URL pattern is `/api/v1/situations/:id/stream`.

**Acceptance Criteria:**
- [ ] Endpoint returns `201` with `{ situationId: string, streamUrl: string }` within 200ms
- [ ] A `situations` row is created with `state: "CREATED"` before the response is sent
- [ ] Conversation Agent is triggered in the background (non-blocking) via a queued async call
- [ ] Request body is Zod-validated: `{ input: string (1-500 chars) }` — invalid input returns `422`

---

### ISSUE-045: Conversation Agent Implementation
**Type:** task  **Labels:** ai-agents P0 L
**Epic:** ISSUE-040  **Depends on:** ISSUE-003, ISSUE-028, ISSUE-046

Implement the Conversation Agent in `lib/agents/conversation.ts` using `claude-haiku-4-5`. It receives raw situation text + active memory facts, and produces a `SituationContext` JSON with fields: `goal`, `budget`, `timeConstraint`, `canCook`, `groupSize`, `indoorOutdoor`, `dietaryRestrictions`, and `situationType`.

**Acceptance Criteria:**
- [ ] Agent outputs valid `SituationContext` parsed by the Zod schema in `types/situation.ts`
- [ ] Agent uses `getActiveMemoryFacts(userId)` from ISSUE-028 — never queries DB directly
- [ ] Agent emits `context_understood` or `clarification_needed` SSE event when done (via ISSUE-046)
- [ ] Prompt is defined in `lib/prompts/conversation.ts` as a typed template function, not inline

---

### ISSUE-046: SSE Infrastructure — GET /api/v1/situations/:id/stream
**Type:** task  **Labels:** situation P0 L
**Epic:** ISSUE-040  **Depends on:** ISSUE-003, ISSUE-004, ISSUE-010

Implement `GET /api/v1/situations/:id/stream` as a Server-Sent Events endpoint that streams 6 event types: `context_understood`, `clarification_needed`, `planning_started`, `agent_progress`, `plan_ready`, and `error`. On client reconnect, replay all events emitted since situation creation.

**Acceptance Criteria:**
- [ ] Response `Content-Type` is `text/event-stream` with `Cache-Control: no-cache`
- [ ] All 6 event types are defined in `types/events.ts` as a discriminated union
- [ ] Reconnect within 30 seconds replays all past events so the client can restore state
- [ ] Stream closes automatically after `plan_ready` or `error` event is sent

---

### ISSUE-047: ConfidenceCard Component
**Type:** feature  **Labels:** situation ui P1 S
**Epic:** ISSUE-040  **Depends on:** ISSUE-045

Build `components/situation/ConfidenceCard.tsx` that displays a 0–100 confidence score (from `SituationContext`) as a circular progress indicator, with a list of known fields (✔ green) and unknown fields (✗ grey) below it. Update in real-time as `context_understood` SSE events arrive.

**Acceptance Criteria:**
- [ ] Circular progress indicator visually represents the 0–100 score
- [ ] All 8 `SituationContext` fields are listed with ✔ or ✗ based on whether they are populated
- [ ] Component re-renders on new SSE data without a full page reload
- [ ] Score below 60 shows an amber warning: "Some details are missing — we'll ask a couple questions"

---

### ISSUE-048: PlanningGraph Component — Static
**Type:** feature  **Labels:** situation ui P2 S
**Epic:** ISSUE-040  **Depends on:** ISSUE-004

Build `components/situation/PlanningGraph.tsx` as a static 6-node directed graph rendered in SVG: Understood → Profile → Clarifying → Searching → Scoring → Plan Ready. Each node is a labelled circle; edges are straight lines with arrowheads.

**Acceptance Criteria:**
- [ ] All 6 nodes and 5 directed edges render correctly in SVG with labels
- [ ] Component is fully self-contained — no external graph library dependencies
- [ ] Nodes and edges are defined as a typed const in the component file for easy modification
- [ ] Graph is responsive and readable at 320px viewport width

---

### ISSUE-049: PlanningGraph SSE Animation
**Type:** feature  **Labels:** situation ui P2 M
**Epic:** ISSUE-040  **Depends on:** ISSUE-046, ISSUE-048

Extend `PlanningGraph` to listen for `agent_progress` SSE events and highlight the corresponding node in the accent color with a 300ms CSS transition. The active node pulses while in progress; completed nodes remain filled in a lighter accent shade.

**Acceptance Criteria:**
- [ ] Each `agent_progress` event includes a `step` field mapped to one of the 6 graph nodes
- [ ] Active node has a CSS pulse animation; completed nodes have static accent fill
- [ ] Node transitions use `transition: fill 300ms ease` (CSS, no JS animation)
- [ ] If the SSE connection drops, the last-known active node remains highlighted (no reset)

---

### ISSUE-050: GET /api/v1/situations/:id Endpoint
**Type:** task  **Labels:** situation P0 S
**Epic:** ISSUE-040  **Depends on:** ISSUE-003, ISSUE-004, ISSUE-010

Implement `GET /api/v1/situations/:id` that returns the full situation row including `state`, `context` (parsed `SituationContext`), and all emitted SSE events as an `events` array. Used by the client to restore state after SSE reconnection.

**Acceptance Criteria:**
- [ ] Response: `{ id, state, input, context: SituationContext | null, events: SseEvent[], createdAt }`
- [ ] Returns `404 NOT_FOUND` if the situation does not exist
- [ ] Returns `403 FORBIDDEN` if the situation belongs to a different user
- [ ] `events` array is ordered by `emittedAt` ascending

---

### ISSUE-051: Situation State Machine Enforcement
**Type:** task  **Labels:** situation P0 M
**Epic:** ISSUE-040  **Depends on:** ISSUE-003, ISSUE-010

Define valid state transitions for situations (`CREATED → PROCESSING → CLARIFYING → PLANNING → COMPLETE | ERROR`) in `lib/situation-fsm.ts` and call `assertValidTransition(from, to)` in every API route that mutates situation state. Return `409 INVALID_STATE_TRANSITION` on invalid transitions.

**Acceptance Criteria:**
- [ ] `lib/situation-fsm.ts` exports `assertValidTransition(from: SituationState, to: SituationState): void`
- [ ] All 5 state values are in a `SituationState` enum/union in `types/situation.ts`
- [ ] Every API route that changes `state` calls `assertValidTransition` before the DB update
- [ ] Attempting `COMPLETE → PROCESSING` returns `409 INVALID_STATE_TRANSITION`

---

### ISSUE-052: BUG — Web Speech API Unavailable in Firefox and Safari iOS
**Type:** bug  **Labels:** situation ui P1 S
**Epic:** ISSUE-040  **Depends on:** ISSUE-042

`VoiceButton` crashes on Firefox and Safari iOS because `window.SpeechRecognition` is undefined, causing an unhandled JS error. Detect Web Speech API support at component mount and fall back to a disabled text-only mode with a tooltip explaining the limitation.

**Acceptance Criteria:**
- [ ] `typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)` check runs before any API use
- [ ] On unsupported browsers, the mic button renders as visually disabled (not hidden)
- [ ] Hovering/tapping the disabled button shows: "Voice input requires Chrome on desktop or Android"
- [ ] No uncaught JS errors appear in Firefox or Safari iOS DevTools console

---

### ISSUE-053: Situation History Page
**Type:** feature  **Labels:** situation ui P2 M
**Epic:** ISSUE-040  **Depends on:** ISSUE-050

Build `/app/history` that lists the authenticated user's past situations in reverse chronological order, showing the original input text, situation type badge, and final recommendation headline. Tapping a row navigates to the full recommendation view for that situation.

**Acceptance Criteria:**
- [ ] History list fetches from `GET /api/v1/situations` (add this endpoint if missing) with user scoping
- [ ] Each row shows: input text (truncated to 80 chars), situation type badge, and date
- [ ] Empty state shows: "No meal situations yet — describe what you need above"
- [ ] Tapping a row navigates to `/app/situations/:id` to re-view the recommendation

---

## EPIC 4 — Clarification Engine

### ISSUE-060: Clarification Engine Epic
**Type:** epic  **Labels:** clarification ai-agents P0 XL
**Epic:** —  **Depends on:** ISSUE-040

Handles incomplete `SituationContext` by generating targeted questions (max 3) using the Clarification Agent, presenting them as quick-tap cards, and merging answers back into context before triggering planning. Falls back to stated assumptions when soft fields remain missing.

**Acceptance Criteria:**
- [ ] Clarification flow never asks more than 3 questions per situation
- [ ] Memory facts are checked before any question is generated (no redundant questions)
- [ ] Answers are persisted to DB before planning is triggered (no loss on SSE disconnect)
- [ ] Assumption statements display when a soft field is filled by default

---

### ISSUE-061: Required Fields Per Situation Type Definition
**Type:** task  **Labels:** clarification P0 S
**Epic:** ISSUE-060  **Depends on:** ISSUE-045

Define a `REQUIRED_FIELDS_MAP` TypeScript `const` in `lib/clarification-config.ts` mapping each `situationType` to its required and optional fields. Example: `sick → required: [canCook, alone], optional: [budget]`; `date → required: [budget, indoorOutdoor], optional: [groupSize]`.

**Acceptance Criteria:**
- [ ] All 11 situation types from the `WEIGHT_TABLE` (ISSUE-076) have entries in `REQUIRED_FIELDS_MAP`
- [ ] Each entry has `required: SituationContextKey[]` and `optional: SituationContextKey[]`
- [ ] `SituationContextKey` is the keyof `SituationContext` type — no magic strings
- [ ] A unit test asserts that no key appears in both `required` and `optional` for any situation type

---

### ISSUE-062: ClarificationAgent Implementation
**Type:** task  **Labels:** clarification ai-agents P0 L
**Epic:** ISSUE-060  **Depends on:** ISSUE-045, ISSUE-061

Implement `lib/agents/clarification.ts` using `claude-haiku-4-5`. It receives `missingRequired: SituationContextKey[]` and the current `SituationContext`, and returns an array of at most 3 question objects, each with `field`, `questionText`, and `options: string[]` (2–4 items).

**Acceptance Criteria:**
- [ ] Output is Zod-validated against `ClarificationQuestion[]` schema in `types/clarification.ts`
- [ ] Agent output never exceeds 3 questions regardless of how many fields are missing
- [ ] Each question's `options` array has 2–4 items suitable for quick-tap UI
- [ ] Prompt is defined in `lib/prompts/clarification.ts` as a typed template — no inline strings

---

### ISSUE-063: POST /api/v1/situations/:id/clarify Endpoint
**Type:** task  **Labels:** clarification P0 M
**Epic:** ISSUE-060  **Depends on:** ISSUE-003, ISSUE-010, ISSUE-051, ISSUE-062

Implement `POST /api/v1/situations/:id/clarify` that merges clarification answers into the situation's `context`, re-evaluates which required fields are still missing, and either triggers Planning Agent (if ready) or emits another `clarification_needed` SSE event.

**Acceptance Criteria:**
- [ ] Request body: `{ answers: Record<SituationContextKey, string> }` — validated with Zod
- [ ] Merged context is persisted to DB before any agent is triggered
- [ ] If all required fields are now populated: situation state transitions to `PLANNING` and Planning Agent fires
- [ ] If required fields are still missing: a second pass through `ClarificationAgent` runs (see ISSUE-068)

---

### ISSUE-064: ClarificationCard Component
**Type:** feature  **Labels:** clarification ui P0 M
**Epic:** ISSUE-060  **Depends on:** ISSUE-046

Build `components/clarification/ClarificationCard.tsx` that renders a clarification question with its text, 2–4 quick-tap option buttons, and an optional free-text input below. Tapping an option submits immediately; free-text requires an explicit "Done" tap.

**Acceptance Criteria:**
- [ ] Option buttons have distinct selected/unselected states; only one can be active at a time
- [ ] "Done" button for free-text is disabled until at least 1 character is entered
- [ ] Selecting a quick-tap option and submitting a free-text answer both call `POST /api/v1/situations/:id/clarify`
- [ ] Card shows the question number ("Question 2 of 3") when multiple questions exist

---

### ISSUE-065: Max-3-Questions Enforcement
**Type:** task  **Labels:** clarification P0 S
**Epic:** ISSUE-060  **Depends on:** ISSUE-062

Add a hard cap of 3 questions in `ClarificationAgent`: if more than 3 required fields are missing, the agent must prioritize the 3 most impactful fields (defined by `REQUIRED_FIELDS_MAP` ordering). Unit test this cap with a situation that has 5 missing fields.

**Acceptance Criteria:**
- [ ] `ClarificationAgent` output array length is always ≤ 3, enforced by a `slice(0, 3)` after Zod parse
- [ ] Field priority order is defined explicitly in `REQUIRED_FIELDS_MAP` (first fields = highest priority)
- [ ] Unit test: 5-missing-field situation → exactly 3 questions covering the top 3 priority fields
- [ ] No `ClarificationQuestion[]` with length > 3 ever reaches `POST /api/v1/situations/:id/clarify`

---

### ISSUE-066: Assumption Statement Generation
**Type:** feature  **Labels:** clarification ui P2 S
**Epic:** ISSUE-060  **Depends on:** ISSUE-063

When a soft/optional field is missing, generate an assumption statement ("Assuming you're alone — is that right?") and display it in a dismissable info banner on the `ClarificationCard`. Dismissing the banner without correction confirms the assumption silently.

**Acceptance Criteria:**
- [ ] Assumption statements are generated for optional fields only (never required fields)
- [ ] Banner renders below the question with a checkmark button ("Yes, that's right") and an edit link
- [ ] Dismissing the banner (clicking ✔ or outside it) stores the assumed value in context
- [ ] Clicking "Edit" converts the banner into a free-text input pre-filled with the assumed value

---

### ISSUE-067: Memory Check Before Question Generation
**Type:** task  **Labels:** clarification memory P0 S
**Epic:** ISSUE-060  **Depends on:** ISSUE-028, ISSUE-062

Before `ClarificationAgent` generates any question, call `getActiveMemoryFacts(userId)` and remove any `missingRequired` fields that can be resolved from memory facts. Only fields genuinely absent from both context and memory should result in a question.

**Acceptance Criteria:**
- [ ] `buildMissingFields()` in `lib/clarification-config.ts` accepts `context` and `memoryFacts` and returns the true missing set
- [ ] A user with `budget` in memory facts never receives a budget clarification question
- [ ] Unit test: user has `diet` and `canCook` in memory → situation requiring those fields skips clarification entirely
- [ ] Memory fact keys are mapped to `SituationContextKey` via a typed `MEMORY_TO_CONTEXT_MAP` const

---

### ISSUE-068: Second Clarification Pass Logic
**Type:** task  **Labels:** clarification P1 M
**Epic:** ISSUE-060  **Depends on:** ISSUE-063, ISSUE-065

If context is still incomplete after the first set of clarification answers, allow exactly one more clarification pass covering only the remaining required fields. After the second pass, proceed to planning regardless — filling remaining fields with reasonable defaults and logging them as assumptions.

**Acceptance Criteria:**
- [ ] `POST /api/v1/situations/:id/clarify` tracks `clarificationRound` (1 or 2) on the situation row
- [ ] After `clarificationRound: 2`, planning is triggered even if fields remain empty
- [ ] Remaining empty required fields are filled with defaults defined in `REQUIRED_FIELDS_MAP` and stored as `assumedFields` on the situation
- [ ] SSE `agent_progress` event announces each assumption: "Assuming budget ₹300 — you can update this later"

---

### ISSUE-069: BUG — Clarification Answers Lost on SSE Disconnect
**Type:** bug  **Labels:** clarification P0 S
**Epic:** ISSUE-060  **Depends on:** ISSUE-063

When the SSE connection drops mid-clarification, submitted answers in the client's React state are lost on reconnect because they were never persisted before planning was triggered. Fix: persist each answer batch to `situations.context` in `POST /api/v1/situations/:id/clarify` before triggering any agent.

**Acceptance Criteria:**
- [ ] `POST /api/v1/situations/:id/clarify` writes merged context to `situations.context` column before returning `200`
- [ ] On SSE reconnect, `GET /api/v1/situations/:id` returns the persisted partial context
- [ ] Simulated disconnect during clarification → reconnect → context is intact, no re-prompting for answered questions
- [ ] No clarification data is held solely in server memory between the endpoint call and the agent invocation

---

## EPIC 5 — Decision Engine

### ISSUE-075: Decision Engine Epic
**Type:** epic  **Labels:** decision-engine P0 XL
**Epic:** —  **Depends on:** ISSUE-040, ISSUE-060

The deterministic TypeScript scoring engine that ranks Cook / Order / Dineout options using weighted sub-scores per situation type. Produces a winner, confidence score, delta panel data, and per-path rejection reasons — no LLM involved.

**Acceptance Criteria:**
- [ ] `scoreAll()` returns a ranked array of 3 paths with scores, winner, and deltas
- [ ] Weight table entries all sum to 1.0 (enforced by `assertWeightIntegrity()` at module load)
- [ ] All 11 situation types and all edge cases are covered by the 30-case unit test suite
- [ ] Availability rules (canCook=false, Swiggy down) correctly zero out ineligible paths

---

### ISSUE-076: scorer.ts Core Structure
**Type:** task  **Labels:** decision-engine P0 M
**Epic:** ISSUE-075  **Depends on:** ISSUE-045

Create `lib/engine/scorer.ts` with: `ScoreWeights` type (keys: goalMatch, budgetFit, timeFit, prefMatch, summing to 1.0), a `WEIGHT_TABLE` const mapping all 11 situation types to their weights, and a `scoreAll(context, paths)` function returning `ScoredPath[]`.

**Acceptance Criteria:**
- [ ] `ScoreWeights` type enforces exactly 4 keys and their values must sum to `1.0` (enforced at runtime by `assertWeightIntegrity`)
- [ ] `WEIGHT_TABLE` has entries for all 11 situation types matching the architecture spec
- [ ] `scoreAll()` returns `ScoredPath[]` sorted descending by `totalScore`
- [ ] `scorer.ts` has zero imports from Next.js, React, or Prisma — pure TypeScript only

---

### ISSUE-077: goalMatchScore Sub-Score Function
**Type:** task  **Labels:** decision-engine P0 S
**Epic:** ISSUE-075  **Depends on:** ISSUE-076

Implement `goalMatchScore(path: MealPath, context: SituationContext): number` in `lib/engine/subscores.ts` that returns 0–100 measuring how well each path satisfies the stated goal (e.g. high-protein situation scores cooking higher if macro data is available).

**Acceptance Criteria:**
- [ ] Function signature is `(path: MealPath, context: SituationContext) => number` with return range `[0, 100]`
- [ ] Cooking path receives a bonus when `context.goal` includes protein/health/nutrition keywords
- [ ] Dineout path receives a bonus when `context.goal` includes social/ambiance/date keywords
- [ ] Unit tests cover at least 5 distinct goal types with expected score ordering

---

### ISSUE-078: budgetFitScore Sub-Score Function
**Type:** task  **Labels:** decision-engine P0 S
**Epic:** ISSUE-075  **Depends on:** ISSUE-076

Implement `budgetFitScore(estimatedCost: number, budget: number | null): number` using a piecewise function: 20%+ under budget → 100, at budget → 85, 20%+ over budget → 50, significantly over → 0. Return 75 when `budget` is null (neutral).

**Acceptance Criteria:**
- [ ] Returns 100 when `estimatedCost <= budget * 0.8`
- [ ] Returns 85 when `estimatedCost === budget`
- [ ] Returns 50 when `estimatedCost >= budget * 1.2` and `estimatedCost < budget * 1.5`
- [ ] Returns 0 when `estimatedCost >= budget * 1.5`; returns 75 when `budget` is `null`

---

### ISSUE-079: timeFitScore Sub-Score Function
**Type:** task  **Labels:** decision-engine P0 S
**Epic:** ISSUE-075  **Depends on:** ISSUE-076

Implement `timeFitScore(pathMinutes: number, timeConstraint: number | null): number` that uses constraint-relative scoring when `timeConstraint` is set, and absolute-time scoring (penalising over 60 minutes) when it is null.

**Acceptance Criteria:**
- [ ] With constraint: `pathMinutes <= timeConstraint * 0.8` → 100; `pathMinutes === timeConstraint` → 85; `pathMinutes > timeConstraint` → `max(0, 85 - (overage / constraint) * 85)`
- [ ] Without constraint: ≤20 min → 100, 21–40 min → 80, 41–60 min → 60, >60 min → 40
- [ ] Function never returns a value outside `[0, 100]`
- [ ] Unit tests cover constraint=null, constraint met exactly, and 50% over constraint

---

### ISSUE-080: prefMatchScore Sub-Score Function
**Type:** task  **Labels:** decision-engine P0 M
**Epic:** ISSUE-075  **Depends on:** ISSUE-076

Implement `prefMatchScore(path: MealPath, context: SituationContext): number` that applies hard blocks (0) for dietary restriction violations and bonus/penalty adjustments (±10–20 points) for cuisine preference matches and mismatches.

**Acceptance Criteria:**
- [ ] Dietary restriction violation (e.g. non-veg dish for vegetarian user) returns 0 immediately
- [ ] Preferred cuisine match adds +20 to base score of 60
- [ ] Disliked cuisine match subtracts -15 from base score
- [ ] No preference data → returns neutral 70; total is clamped to `[0, 100]`

---

### ISSUE-081: Path Availability Rules
**Type:** task  **Labels:** decision-engine P0 S
**Epic:** ISSUE-075  **Depends on:** ISSUE-076

Implement availability guards in `scoreAll()`: if `context.canCook === false`, set Cook path `totalScore` to 0; if Swiggy is marked unavailable in the `EngineInput`, set both Order and Dineout paths to 0. Unavailable paths still appear in results but are marked `available: false`.

**Acceptance Criteria:**
- [ ] `ScoredPath` type has `available: boolean` field
- [ ] `canCook === false` → Cook path `available: false`, `totalScore: 0`
- [ ] `swiggyAvailable === false` → Order and Dineout paths both `available: false`, `totalScore: 0`
- [ ] Winner selection ignores `available: false` paths; if all paths are unavailable, winner is `null`

---

### ISSUE-082: assertWeightIntegrity() Function
**Type:** task  **Labels:** decision-engine P0 S
**Epic:** ISSUE-075  **Depends on:** ISSUE-076

Implement `assertWeightIntegrity()` in `lib/engine/scorer.ts` that iterates `WEIGHT_TABLE` at module load time and throws `WeightIntegrityError` if any entry's weights do not sum to `1.0` (within ±0.001 floating-point tolerance).

**Acceptance Criteria:**
- [ ] Function is called at the bottom of `scorer.ts` so it runs on module import
- [ ] Throws `WeightIntegrityError` with the offending situation type name in the message
- [ ] Tolerance is ±0.001 to handle IEEE 754 floating-point arithmetic
- [ ] A unit test intentionally corrupts one entry and asserts the error is thrown

---

### ISSUE-083: Confidence Calculator
**Type:** task  **Labels:** decision-engine P1 S
**Epic:** ISSUE-075  **Depends on:** ISSUE-076

Implement `calculateConfidence(context: SituationContext): number` in `lib/engine/confidence.ts` that returns 0–100 based solely on how many `SituationContext` fields are populated (deterministic, no LLM). Required fields contribute more weight than optional fields.

**Acceptance Criteria:**
- [ ] All required fields for a given `situationType` populated → score ≥ 85
- [ ] Only optional fields populated → score ≤ 50
- [ ] Empty context → score is 10 (minimum, not 0, because `situationType` is always known)
- [ ] Score is used verbatim in `ConfidenceCard` (ISSUE-047) — single source of truth

---

### ISSUE-084: Tie-Breaking Logic
**Type:** task  **Labels:** decision-engine P1 S
**Epic:** ISSUE-075  **Depends on:** ISSUE-076

When two or more paths are within 5 points of each other, apply tie-breaking: default preference is Cook > Order > Dineout, but invert Order/Cook if `context.canCook === false` or if `prefMatchScore` for cooking is below 40.

**Acceptance Criteria:**
- [ ] Tie-breaking activates only when scores are within 5.0 points
- [ ] Default preference: Cook wins ties against Order; Order wins ties against Dineout
- [ ] `canCook === false` inverts Cook vs Order preference
- [ ] Tie-break reason is recorded in `ScoredPath.tieBreakReason` for display in "Why Not?" (ISSUE-098)

---

### ISSUE-085: Plan Simulator Delta Calculation
**Type:** task  **Labels:** decision-engine P2 S
**Epic:** ISSUE-075  **Depends on:** ISSUE-076

Implement `calculateDeltas(winner: ScoredPath, nextBest: ScoredPath): PlanDelta` in `lib/engine/deltas.ts` that computes the cost, time, and protein difference between the winning path and the second-best option for display in the Plan Simulator (ISSUE-097).

**Acceptance Criteria:**
- [ ] `PlanDelta` type: `{ costDelta: number, timeDelta: number, proteinDelta: number, nextBestLabel: string }`
- [ ] Positive delta means winner is better (cheaper, faster, or more protein)
- [ ] `nextBestLabel` is one of `"Cook"`, `"Order"`, or `"Dineout"`
- [ ] Returns `null` when only one path is `available: true` (no meaningful comparison)

---

### ISSUE-086: Decision Engine Unit Test Suite
**Type:** task  **Labels:** decision-engine testing P0 L
**Epic:** ISSUE-075  **Depends on:** ISSUE-076, ISSUE-077, ISSUE-078, ISSUE-079, ISSUE-080, ISSUE-081, ISSUE-082, ISSUE-083, ISSUE-084, ISSUE-085

Write 30 Vitest unit tests in `tests/engine/` covering all 11 situation types, all 4 sub-score functions, availability rules, tie-breaking, confidence calculation, and delta calculation. Each test must assert both the winner identity and the numeric score range.

**Acceptance Criteria:**
- [ ] 30 test cases covering all 11 situation types (at least 2 tests each for common types)
- [ ] Edge cases tested: all paths unavailable, budget=null, timeConstraint=null, all dietary restrictions active
- [ ] Tests run via `pnpm test` using Vitest with zero external network calls (all data is inline fixtures)
- [ ] Test coverage for `lib/engine/` is ≥ 90% lines as reported by Vitest coverage

---

## EPIC 6 — Planning Agent

### ISSUE-090: Planning Agent Epic
**Type:** epic  **Labels:** planning ai-agents P0 XL
**Epic:** —  **Depends on:** ISSUE-075

Orchestrates the full recommendation pipeline: Tool Agent fetches live Swiggy + YouTube data, Decision Engine scores options, and Planning Agent (sonnet) synthesizes the winner into a rich recommendation JSON with explanation, comparison table, and simulator data.

**Acceptance Criteria:**
- [ ] `POST /api/v1/situations/:id` triggers the full pipeline and emits `plan_ready` SSE event
- [ ] Recommendation JSON is Zod-validated before DB storage; schema errors trigger a retry
- [ ] Planning Agent degrades gracefully when Swiggy is unavailable (cook-only mode)
- [ ] LLM timeout > 8 seconds falls back to a simplified recommendation

---

### ISSUE-091: Planning Agent Implementation
**Type:** task  **Labels:** planning ai-agents P0 L
**Epic:** ISSUE-090  **Depends on:** ISSUE-075, ISSUE-092

Implement `lib/agents/planning.ts` using `claude-sonnet-4-5`. It receives pre-scored `ScoredPath[]` + Tool Agent results and produces a `Recommendation` JSON with: `winner`, `explanation`, `comparisonTable`, `whyNot`, and `planSimulator` fields.

**Acceptance Criteria:**
- [ ] Output is Zod-validated against `Recommendation` schema in `types/recommendation.ts` before DB write
- [ ] `explanation` is 2–3 sentences written in second-person ("We picked cooking because…")
- [ ] `comparisonTable` contains all 3 paths even when 2 are unavailable (with `available: false` rows)
- [ ] Prompt is defined in `lib/prompts/planning.ts` as a typed template, never inline

---

### ISSUE-092: Tool Agent Implementation
**Type:** task  **Labels:** planning ai-agents P0 L
**Epic:** ISSUE-090  **Depends on:** ISSUE-046

Implement `lib/agents/tool.ts` using `claude-haiku-4-5` that executes Swiggy MCP restaurant/menu searches and YouTube API video lookups in parallel. Returns normalized `ToolResults` with `restaurants: SwiggyRestaurant[]` and `videos: YoutubeVideo[]`.

**Acceptance Criteria:**
- [ ] Swiggy MCP and YouTube API calls run concurrently via `Promise.all()`
- [ ] `ToolResults` type is defined in `types/tools.ts` and shared with Planning Agent
- [ ] Swiggy failure sets `restaurants: []` and adds `swiggyError: true` to results (no thrown error)
- [ ] YouTube failure sets `videos: []` and adds `youtubeError: true` (Planning Agent handles gracefully)

---

### ISSUE-093: Planning Agent Integration Test
**Type:** task  **Labels:** planning testing P1 M
**Epic:** ISSUE-090  **Depends on:** ISSUE-091, ISSUE-092

Write an integration test in `tests/agents/planning.test.ts` that mocks the Tool Agent response (3 restaurants, 2 videos) and asserts the Planning Agent outputs a valid `Recommendation` matching the Zod schema. Test both normal and degraded (Swiggy down) modes.

**Acceptance Criteria:**
- [ ] Tool Agent is mocked via a typed fixture in `tests/fixtures/tool-results.ts`
- [ ] Test asserts `recommendation.winner` is one of `"cook" | "order" | "dineout"`
- [ ] Degraded mode test: `swiggyError: true` → `recommendation.winner` is always `"cook"`
- [ ] No real API calls are made; Anthropic SDK is mocked with `vi.mock()`

---

### ISSUE-094: ComparisonTable Component
**Type:** feature  **Labels:** planning ui P1 M
**Epic:** ISSUE-090  **Depends on:** ISSUE-099

Build `components/recommendation/ComparisonTable.tsx` that renders a 3-column table (Cook / Order / Dine) with rows: Score, Estimated Cost, Time, Protein. The winning column is visually highlighted. Unavailable columns are greyed out with a "Not available" overlay.

**Acceptance Criteria:**
- [ ] Table renders all 3 columns with 4 data rows each
- [ ] Winning column has a colored header and a winner badge
- [ ] Unavailable columns show a semi-transparent grey overlay with "Not available" text
- [ ] Table is horizontally scrollable on mobile without overflowing the viewport

---

### ISSUE-095: DecisionCard Component
**Type:** feature  **Labels:** planning ui P0 M
**Epic:** ISSUE-090  **Depends on:** ISSUE-099

Build `components/recommendation/DecisionCard.tsx` that displays the winner headline ("Cook Tonight" / "Order In" / "Dine Out"), the `explanation` text from Planning Agent, and a confidence badge. This is the first element the user sees after `plan_ready` event.

**Acceptance Criteria:**
- [ ] Winner headline uses a distinct icon per path: 🍳 Cook, 📦 Order, 🍽️ Dine
- [ ] Explanation text renders as-is from the Planning Agent (no truncation)
- [ ] Confidence badge shows the score from `calculateConfidence()` with a color: ≥80 green, 60–79 amber, <60 red
- [ ] Card is the topmost element in the recommendation view, above `ComparisonTable`

---

### ISSUE-096: RecommendationCard Component
**Type:** feature  **Labels:** planning ui P1 M
**Epic:** ISSUE-090  **Depends on:** ISSUE-099

Build `components/recommendation/RecommendationCard.tsx` that shows the winning option's details: title (dish or restaurant name), estimated cost, time, and a compact nutrition summary (calories, protein, carbs). Include two action buttons: "Order Now" (Swiggy) and "Save for Later".

**Acceptance Criteria:**
- [ ] Title, cost (₹), time (min), and nutrition (cal/protein/carbs) all render from the `Recommendation` data
- [ ] "Order Now" button is hidden for Cook path and renders for Order/Dineout
- [ ] "Save for Later" writes to `user_actions` table via `POST /api/v1/recommendations/:id/execute`
- [ ] Card skeleton loader displays while `GET /api/v1/recommendations/:id` is in-flight

---

### ISSUE-097: PlanSimulator Component
**Type:** feature  **Labels:** planning ui P2 M
**Epic:** ISSUE-090  **Depends on:** ISSUE-085, ISSUE-099

Build `components/recommendation/PlanSimulator.tsx` — a collapsible panel that shows the delta between the winner and next-best option using `PlanDelta` data. Example rows: "₹460 more expensive", "+59g protein", "+13 min". Panel is collapsed by default.

**Acceptance Criteria:**
- [ ] Panel is collapsed by default; clicking "Compare with [nextBestLabel]" expands it
- [ ] All 3 delta rows (cost, time, protein) render with correct sign and unit
- [ ] Positive deltas (winner is better) render in green; negative deltas in amber
- [ ] If `PlanDelta` is `null` (only one available path), the component renders `null`

---

### ISSUE-098: "Why Not?" Display
**Type:** feature  **Labels:** planning ui P2 S
**Epic:** ISSUE-090  **Depends on:** ISSUE-094, ISSUE-099

Add a "Why not [Cook/Order/Dine]?" tap target on each non-winning `ComparisonTable` column that expands an inline rejection reason sentence. Rejection reasons are from `ScoredPath.rejectionReason` (set by the Decision Engine or tie-break logic).

**Acceptance Criteria:**
- [ ] Each non-winning column has a "Why not?" expandable row
- [ ] Tapping it reveals a single sentence reason (e.g. "Cooking takes 45 min — over your 30-min limit")
- [ ] Tapping again collapses the reason
- [ ] Winning column shows "This is why we chose this" on tap instead of a rejection

---

### ISSUE-099: GET /api/v1/recommendations/:id Endpoint
**Type:** task  **Labels:** planning P0 S
**Epic:** ISSUE-090  **Depends on:** ISSUE-003, ISSUE-004, ISSUE-010

Implement `GET /api/v1/recommendations/:id` that returns the full `Recommendation` document including `comparisonTable`, `whyNot`, and `planSimulator` (delta) data. Used by all recommendation UI components.

**Acceptance Criteria:**
- [ ] Response matches the `Recommendation` Zod schema from `types/recommendation.ts` exactly
- [ ] Returns `404` if the recommendation does not exist for the given situation
- [ ] Returns `403` if the recommendation belongs to a different user
- [ ] Response is typed end-to-end — no `any` casts in the route handler or client fetch

---

### ISSUE-100: POST /api/v1/recommendations/:id/execute Endpoint
**Type:** task  **Labels:** planning swiggy P1 M
**Epic:** ISSUE-090  **Depends on:** ISSUE-003, ISSUE-004, ISSUE-010, ISSUE-099

Implement `POST /api/v1/recommendations/:id/execute` that pre-fills the Swiggy cart (for Order/Dineout paths via Swiggy MCP) or marks cooking started (for Cook path), and records the action in `user_actions`. Return the Swiggy deep-link URL for Order/Dineout.

**Acceptance Criteria:**
- [ ] Cook path: records `user_actions` row with `actionType: "cook_started"` and returns `{ action: "cook_started" }`
- [ ] Order/Dineout path: calls Swiggy MCP cart pre-fill and returns `{ action: "swiggy_redirect", url: string }`
- [ ] Action is always recorded in `user_actions` regardless of Swiggy MCP success or failure
- [ ] Swiggy MCP failure returns `{ action: "swiggy_redirect", url: null, error: "swiggy_unavailable" }` — not a 5xx

---

### ISSUE-101: Planning Agent Degraded Mode
**Type:** task  **Labels:** planning ai-agents P1 S
**Epic:** ISSUE-090  **Depends on:** ISSUE-091, ISSUE-092

When Tool Agent returns `swiggyError: true`, Planning Agent must produce a cook-only recommendation with `winner: "cook"`, set `recommendation.degraded: true`, and include a user-facing note: "Swiggy is unavailable right now — showing cook options only."

**Acceptance Criteria:**
- [ ] `Recommendation` type has `degraded: boolean` field
- [ ] `swiggyError: true` in `ToolResults` → `recommendation.degraded: true` and `recommendation.winner: "cook"`
- [ ] Order and Dineout columns in `comparisonTable` have `available: false` with reason `"Swiggy unavailable"`
- [ ] A degraded banner renders in `DecisionCard` when `recommendation.degraded === true`

---

### ISSUE-102: Planning Agent Output Schema Validation
**Type:** task  **Labels:** planning ai-agents P0 S
**Epic:** ISSUE-090  **Depends on:** ISSUE-091

After the Planning Agent responds, Zod-parse the output before storing to DB. On schema validation failure, retry the agent call once with an error-correcting system prompt. If the second call also fails, return a `500 AGENT_SCHEMA_ERROR` and emit an `error` SSE event.

**Acceptance Criteria:**
- [ ] `Recommendation` Zod schema parse failure triggers exactly one retry (not infinite)
- [ ] Retry system prompt includes the Zod error message so the agent can self-correct
- [ ] Second failure emits `error` SSE event with `code: "AGENT_SCHEMA_ERROR"` and returns 500
- [ ] Both the original and retry Zod errors are logged with `console.error` including the situation ID

---

### ISSUE-103: agent_progress SSE Events from Tool Agent
**Type:** task  **Labels:** planning swiggy P1 S
**Epic:** ISSUE-090  **Depends on:** ISSUE-046, ISSUE-092

Have the Tool Agent emit `agent_progress` SSE events as it works: before Swiggy search ("Searching restaurants near [location]..."), after Swiggy ("Found 22 restaurants"), before YouTube ("Finding cooking videos..."), after YouTube ("Found 3 relevant videos"). These drive the `PlanningGraph` animation.

**Acceptance Criteria:**
- [ ] 4 distinct `agent_progress` events are emitted per Tool Agent run (2 before, 2 after each external call)
- [ ] Event payload: `{ step: "searching_swiggy"|"swiggy_done"|"searching_youtube"|"youtube_done", message: string }`
- [ ] `message` includes dynamic content (location for Swiggy, count for results)
- [ ] Events are emitted via the SSE channel established in ISSUE-046 using the situation ID

---

### ISSUE-104: BUG — Planning Agent Context Window Overflow with >20 Swiggy Results
**Type:** bug  **Labels:** planning ai-agents P0 S
**Epic:** ISSUE-090  **Depends on:** ISSUE-091, ISSUE-092

When Swiggy returns more than 20 restaurants, the full list inflates the Planning Agent prompt past the context window, causing `400 context_length_exceeded` errors. Fix by truncating `ToolResults.restaurants` to the top 5 by rating before passing to Planning Agent.

**Acceptance Criteria:**
- [ ] Tool Agent truncates `restaurants` to `slice(0, 5)` sorted by `rating DESC` before returning `ToolResults`
- [ ] Truncation count is a named constant `MAX_RESTAURANTS_FOR_PLANNING = 5` in `lib/constants.ts`
- [ ] A unit test asserts that `ToolResults.restaurants.length` is always ≤ 5
- [ ] Truncation is logged at `info` level: "Truncated 22 restaurants to top 5 for planning context"

---

### ISSUE-105: LLM Timeout Fallback for Planning Agent
**Type:** task  **Labels:** planning ai-agents P1 M
**Epic:** ISSUE-090  **Depends on:** ISSUE-091, ISSUE-102

If the Planning Agent LLM call takes longer than 8 seconds, abort the request and return a simplified recommendation using only the top Swiggy result and Decision Engine winner — no LLM text. Mark the response `{ simplified: true }` and emit `plan_ready` (not `error`) so the user still gets a result.

**Acceptance Criteria:**
- [ ] Planning Agent call is wrapped in `Promise.race([agentCall, timeout(8000)])` 
- [ ] Timeout path builds a minimal `Recommendation` from `ScoredPath[]` winner + top Swiggy result
- [ ] Simplified recommendation has `simplified: true` and a generic `explanation: "Here's our best match based on your situation."`
- [ ] `plan_ready` SSE event fires on the timeout path; no `error` event is emitted
