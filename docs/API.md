# MealOS AI — API Reference

**Version:** 1.0  
**Base URL:** `/api/v1/`  
**Protocol:** HTTPS  
**Content-Type:** `application/json` (except the SSE stream endpoint)  
**Last updated:** 2026-07-06

---

## Table of Contents

1. [Authentication](#authentication)
2. [Rate Limiting](#rate-limiting)
3. [POST /api/v1/situations](#post-apiv1situations)
4. [GET /api/v1/situations/:id/stream](#get-apiv1situationsidstream)
5. [POST /api/v1/situations/:id/clarify](#post-apiv1situationsidclarify)
6. [GET /api/v1/situations/:id](#get-apiv1situationsid)
7. [GET /api/v1/recommendations/:id](#get-apiv1recommendationsid)
8. [POST /api/v1/recommendations/:id/execute](#post-apiv1recommendationsidexecute)
9. [GET /api/v1/memory](#get-apiv1memory)
10. [PATCH /api/v1/memory](#patch-apiv1memory)
11. [POST /api/v1/onboarding](#post-apiv1onboarding)
12. [GET /api/v1/health](#get-apiv1health)
13. [Error Code Reference](#error-code-reference)
14. [Retry Logic Guidelines](#retry-logic-guidelines)
15. [Webhooks (V2)](#webhooks-v2)

---

## Authentication

### How Clerk JWT Tokens Are Obtained

MealOS uses [Clerk](https://clerk.com) for identity management. Tokens are issued via Clerk's frontend SDK after the user signs in. No MealOS endpoint handles login credentials directly.

**Browser (React):**
```typescript
import { useAuth } from '@clerk/nextjs';

const { getToken } = useAuth();
const token = await getToken(); // short-lived JWT, auto-refreshed by Clerk SDK
```

**Every authenticated request must include:**
```
Authorization: Bearer <clerk_jwt_token>
```

### Token Refresh Strategy

Clerk tokens expire after 60 seconds by default. The Clerk SDK handles silent refresh automatically when using `useAuth().getToken()`. Callers that cache tokens must re-fetch via the SDK before each request — do not cache the raw token string.

### Server-Side userId Extraction

On the API server, every authenticated route extracts the userId via Clerk's `auth()` helper:

```typescript
import { auth } from '@clerk/nextjs/server';

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return new Response(null, { status: 401 });
  // userId is the Clerk user ID, e.g. "user_2abc..."
}
```

The Clerk `userId` is mapped to the internal `users.clerk_user_id` column on every database operation. It is never passed in the request body.

### What Happens on 401

When the server returns `401 UNAUTHORIZED`, the client must:
1. Call `getToken()` from the Clerk SDK to force a token refresh.
2. Retry the original request once with the new token.
3. If the second attempt also returns 401, redirect the user to the Clerk sign-in page.

Do not retry more than once on a 401 — repeated 401s indicate a session that has been revoked, not a stale token.

---

## Rate Limiting

Rate limits are enforced per `userId` (extracted from the Clerk JWT), not per IP.

| Endpoint | Limit |
|---|---|
| All GET endpoints | 60 requests / minute |
| POST /api/v1/situations | 10 requests / minute |
| POST /api/v1/situations/:id/clarify | 20 requests / minute |
| POST /api/v1/recommendations/:id/execute | 30 requests / minute |
| PATCH /api/v1/memory | 30 requests / minute |
| POST /api/v1/onboarding | 3 requests / lifetime (one-time endpoint) |
| GET /api/v1/health | Unlimited (no auth) |

When a rate limit is exceeded, the server responds with:

```
HTTP 429 Too Many Requests
Retry-After: 37
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1751788800

{
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "You have submitted too many situations. Wait 37 seconds before trying again.",
  "details": {
    "limit": 10,
    "window_seconds": 60,
    "retry_after_seconds": 37
  }
}
```

---

## POST /api/v1/situations

### Overview

- **Method + Path:** `POST /api/v1/situations`
- **Purpose:** Submit a new food situation in natural language. Triggers the Conversation Agent pipeline (Intent Agent → Context Agent → Clarification Agent).
- **Authentication:** Required. Clerk JWT in `Authorization` header.
- **Rate limit:** 10 requests / minute per user.

### Request

**Headers:**
```
Authorization: Bearer <clerk_jwt_token>
Content-Type: application/json
```

**Request Body TypeScript Interface:**
```typescript
interface CreateSituationRequest {
  input: string;                    // required, 1–2000 chars
  location?: {
    lat: number;                    // decimal degrees, -90 to 90
    lng: number;                    // decimal degrees, -180 to 180
  };
  context_hints?: {                 // optional, for future integrations
    calendar_busy_until?: string;   // ISO 8601 datetime
    current_weather?: string;       // "hot" | "cold" | "rainy"
    pantry_last_updated?: string;   // ISO 8601 date
  };
}
```

**Example Request:**
```json
{
  "input": "I'm sick and exhausted, don't feel like cooking at all",
  "location": {
    "lat": 19.0596,
    "lng": 72.8295
  }
}
```

**Validation Rules:**
- `input` is required. Minimum 1 character, maximum 2000 characters.
- `input` must not be blank (whitespace-only strings are rejected).
- `location.lat` must be between -90 and 90.
- `location.lng` must be between -180 and 180.
- If `location` is omitted, the server falls back to `user_profiles.home_lat` / `home_lng`. If neither is set, location-sensitive features (Swiggy delivery estimates, dineout search) are disabled and noted in the response.

### Response

**Success — HTTP 201 Created:**

```typescript
interface CreateSituationResponse {
  situation_id: string;             // UUID
  status: 'intent_extracted';       // always this value on creation
  stream_url: string;               // subscribe here immediately
  situation_type: string;           // initial classification
  understood_as: string;            // human-readable summary of what was parsed
  location_used: 'request' | 'profile' | 'none';
}
```

**Example Success Response:**
```json
{
  "situation_id": "a3f1b2c4-7e89-4d12-b456-426614174000",
  "status": "intent_extracted",
  "stream_url": "/api/v1/situations/a3f1b2c4-7e89-4d12-b456-426614174000/stream",
  "situation_type": "unwell",
  "understood_as": "You're sick and need food without cooking",
  "location_used": "request"
}
```

**Error Responses:**

| Status | Code | When | Client Action |
|---|---|---|---|
| 400 | `INVALID_INPUT` | `input` is empty, too long, or whitespace-only | Show validation error, do not retry |
| 400 | `INVALID_LOCATION` | `lat`/`lng` out of range | Fix coordinates or omit `location` |
| 401 | `UNAUTHORIZED` | Token missing or expired | Refresh token via Clerk SDK and retry once |
| 422 | `INPUT_UNPARSEABLE` | Input is valid string but contains no extractable intent (e.g., random characters) | Prompt user to rephrase |
| 429 | `RATE_LIMIT_EXCEEDED` | More than 10 situations in 60 seconds | Respect `Retry-After` header |
| 500 | `AGENT_BOOTSTRAP_FAILED` | Intent Agent failed to start | Retry after 5 seconds, max 2 retries |
| 503 | `SERVICE_UNAVAILABLE` | LLM provider unreachable at startup | Show degraded mode notice, retry after 30 seconds |

**Error body shape:**
```json
{
  "code": "INVALID_INPUT",
  "message": "Situation input cannot be empty.",
  "details": {
    "field": "input",
    "received_length": 0,
    "minimum_length": 1
  }
}
```

### Idempotency

This endpoint is **not idempotent**. Two identical inputs from the same user create two separate situations. Each situation is an independent planning session.

To avoid accidental duplicates (e.g., double-taps on a mobile submit button), the client should disable the submit button after the first successful 201 response and only re-enable it when the user explicitly starts a new situation.

There is no server-side idempotency key for this endpoint. If the network drops after the request is sent but before the 201 is received, the client should check `GET /api/v1/situations` (future list endpoint) before resubmitting.

### Timeouts

- **Client-side timeout recommendation:** 10 seconds. If no response in 10 seconds, surface an error and allow the user to retry.
- **Server-side behavior:** The Intent Agent has a 6-second internal timeout. If it exceeds this, the situation is created with `status: "intent_extraction_failed"` and the stream will emit an `error` event. The user is not charged against their rate limit for a failed submission.
- **No `Retry-After` header** on timeout (503 is not a rate limit). Use exponential backoff starting at 5 seconds.

### Versioning

Breaking changes to this endpoint (new required fields, changed `status` enum values, removed response fields) will be introduced at `/api/v2/situations`. Non-breaking additions (new optional fields, new `situation_type` values, new optional response fields) may be added to V1 with a 30-day notice in the changelog.

### Code Example

```typescript
async function createSituation(
  input: string,
  location?: { lat: number; lng: number }
): Promise<{ situationId: string; streamUrl: string }> {
  const { getToken } = useAuth(); // Clerk hook
  const token = await getToken();

  const res = await fetch('/api/v1/situations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input, location }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message);
  }

  const data = await res.json();
  return { situationId: data.situation_id, streamUrl: data.stream_url };
}
```

---

## GET /api/v1/situations/:id/stream

### Overview

- **Method + Path:** `GET /api/v1/situations/:id/stream`
- **Purpose:** Server-Sent Events (SSE) stream that delivers real-time Planning Graph updates as agents complete their work. The client subscribes to this immediately after creating a situation and renders the Situation Board progressively as events arrive.
- **Authentication:** Required. Clerk JWT in `Authorization` header (also accepted as `?token=<jwt>` query param for `EventSource` compatibility, since the native `EventSource` API does not support custom headers).
- **Rate limit:** Counts against the general 60 req/min GET limit, but one open SSE connection does not count continuously — only the initial HTTP handshake counts.

### Path Parameters

| Parameter | Type | Validation |
|---|---|---|
| `id` | UUID string | Must be a valid UUID v4. Must belong to the authenticated user. |

### Query Parameters

| Parameter | Type | Description |
|---|---|---|
| `token` | string | Optional. Clerk JWT as an alternative to the `Authorization` header. Required when using the native browser `EventSource` API. |
| `Last-Event-ID` | string | Set automatically by the browser's `EventSource` on reconnect. The server uses this to replay missed events from that sequence number onward. |

### Headers Required

```
Authorization: Bearer <clerk_jwt_token>
Accept: text/event-stream
Cache-Control: no-cache
```

### Response

**Success — HTTP 200 (SSE stream opens):**

The response `Content-Type` is `text/event-stream`. The connection remains open until the situation reaches a terminal state (`plan_ready`, `abandoned`, or `error`), after which the server closes the stream.

Each SSE message follows the format:
```
id: <sequence_number>
event: <event_name>
data: <JSON string>

```
(blank line terminates the message)

---

### SSE Events

#### Event: `context_understood`

**When it fires:** Immediately after the Intent Agent and Context Agent complete (typically within 1–2 seconds of situation creation).

**Data shape:**
```typescript
interface ContextUnderstoodEvent {
  situation_type: string;
  understood_as: string;
  confidence: number;           // 0.0–1.0
  known_fields: string[];       // fields resolved from memory or inference
  assumptions: Array<{
    field: string;
    value: string | number | boolean;
    source: 'memory' | 'inference' | 'time_of_day';
  }>;
}
```

**Example payload:**
```
id: 1
event: context_understood
data: {"situation_type":"unwell","understood_as":"You're sick and need food without having to cook","confidence":0.91,"known_fields":["diet_type","budget","location","cooking_skill"],"assumptions":[{"field":"location","value":"Bandra, Mumbai","source":"memory"},{"field":"budget","value":350,"source":"memory"},{"field":"diet_type","value":"vegetarian","source":"memory"}]}

```

**How to handle:** Render the Context Card on the Situation Board. Display `understood_as` as the headline. Show `assumptions` as a collapsible "what I know" list so the user can spot and correct errors before planning proceeds.

---

#### Event: `clarification_needed`

**When it fires:** When the Context Agent identifies one or more required fields that are not in memory and cannot be inferred. Fires instead of `planning_started` if questions are needed.

**Data shape:**
```typescript
interface ClarificationNeededEvent {
  clarification_id: string;     // UUID, needed for POST /clarify
  pass_number: 1 | 2;           // which clarification pass this is
  questions: Array<{
    id: string;                 // e.g. "q1", "q2"
    text: string;               // human-readable question text
    field: string;              // which SituationContext field this answers
    type: 'single_choice' | 'multi_choice' | 'freetext' | 'number';
    options?: Array<{
      label: string;
      value: string | number | boolean;
    }>;
    required: boolean;
  }>;
  assumptions_stated: string[]; // assumptions being made to avoid asking more
  expires_at: string;           // ISO 8601 — client should show countdown
}
```

**Example payload:**
```
id: 2
event: clarification_needed
data: {"clarification_id":"b7e2d3a1-4c56-4e12-8f90-426614174111","pass_number":1,"questions":[{"id":"q1","text":"Are you feeling up to cooking today, or should we find something to order?","field":"canCook","type":"single_choice","options":[{"label":"I can manage a simple meal","value":true},{"label":"Need delivery — I'm wiped out","value":false}],"required":true},{"id":"q2","text":"Are you home alone, or is someone there who could help?","field":"alone","type":"single_choice","options":[{"label":"Home alone","value":true},{"label":"Partner or family here","value":false}],"required":true}],"assumptions_stated":["Assuming Bandra, Mumbai as your location","Using your default vegetarian filter"],"expires_at":"2026-07-06T14:35:00Z"}

```

**How to handle:** Render the Clarification Card. Display each question with its quick-tap options. When the user answers, call `POST /api/v1/situations/:id/clarify`. Show a subtle countdown to `expires_at` — if the clarification expires before the user answers, the situation must be recreated.

---

#### Event: `planning_started`

**When it fires:** When all required context is available (either from memory/inference with no questions needed, or after the user answers the clarification questions). This confirms that the Planning Engine is running.

**Data shape:**
```typescript
interface PlanningStartedEvent {
  agents_running: string[];     // names of agents firing in parallel
  estimated_seconds: number;   // approximate time to plan_ready
}
```

**Example payload:**
```
id: 3
event: planning_started
data: {"agents_running":["swiggy","recipe","budget","nutrition"],"estimated_seconds":4}

```

**How to handle:** Show a "Planning..." skeleton state on the Situation Board. Use `estimated_seconds` to drive a progress animation (do not use it as a hard deadline — show indeterminate progress after the estimate passes).

---

#### Event: `agent_progress`

**When it fires:** Each time an individual agent completes its work. Multiple `agent_progress` events may arrive in rapid succession as parallel agents finish.

**Data shape:**
```typescript
interface AgentProgressEvent {
  agent: 'swiggy' | 'recipe' | 'budget' | 'nutrition' | 'planning';
  status: 'completed' | 'failed' | 'skipped';
  message: string;              // human-readable status for progressive UI
  partial_data?: unknown;       // agent-specific preview data (optional, unstable shape)
}
```

**Example payloads:**
```
id: 4
event: agent_progress
data: {"agent":"swiggy","status":"completed","message":"Found 8 delivery options near Bandra"}

id: 5
event: agent_progress
data: {"agent":"recipe","status":"completed","message":"3 recipes match your pantry and skill level"}

id: 6
event: agent_progress
data: {"agent":"budget","status":"completed","message":"Budget analysis complete — Rs 350 is comfortable for tonight"}

id: 7
event: agent_progress
data: {"agent":"nutrition","status":"skipped","message":"No active nutrition goal — skipping macro analysis"}

```

**How to handle:** Update the Situation Board's progress indicators as each event arrives. If an agent reports `status: "failed"`, continue rendering — the Planning Agent handles fallbacks. Do not block the UI on any single agent failure.

---

#### Event: `plan_ready`

**When it fires:** When the Planning Agent has assembled the full recommendation. This is the terminal success event.

**Data shape:**
```typescript
interface PlanReadyEvent {
  recommendation_id: string;   // UUID, use to call GET /recommendations/:id
  headline: string;            // primary decision headline
  plan_type: 'single' | 'sequence' | 'multi_service' | 'weekly';
  preview: {
    primary_service: 'swiggy_food' | 'instamart' | 'dineout' | 'recipe';
    primary_title: string;
    primary_cost: number;       // INR
    primary_time: number;       // minutes
    alternatives_count: number;
  };
}
```

**Example payload:**
```
id: 8
event: plan_ready
data: {"recommendation_id":"c9d4e5f2-3a78-4b23-9012-426614174222","headline":"Order comfort food — you're sick and need rest","plan_type":"single","preview":{"primary_service":"swiggy_food","primary_title":"Khichdi from Haldiram's","primary_cost":160,"primary_time":28,"alternatives_count":2}}

```

**How to handle:** This is the trigger to call `GET /api/v1/recommendations/:id` to fetch the full plan and render the complete Situation Board. The stream will close server-side within 2 seconds of sending this event. Do not wait for the stream to close — fetch the recommendation immediately on receiving `plan_ready`.

---

#### Event: `error`

**When it fires:** When a non-recoverable error occurs (LLM timeout, Swiggy outage with no fallback, situation expired). The stream will close after this event.

**Data shape:**
```typescript
interface StreamErrorEvent {
  code: string;
  message: string;
  fallback_available: boolean;
  fallback_type?: 'recipe_only' | 'generic_suggestion';
  situation_id: string;
}
```

**Example payload:**
```
id: 9
event: error
data: {"code":"LLM_TIMEOUT","message":"The planning engine took too long. We've generated a simpler recommendation.","fallback_available":true,"fallback_type":"recipe_only","situation_id":"a3f1b2c4-7e89-4d12-b456-426614174000"}

```

**How to handle:** If `fallback_available: true`, call `GET /api/v1/situations/:id` to retrieve whatever partial state exists and render it gracefully. If `fallback_available: false`, show an error state with a "Try again" button that creates a new situation.

---

#### Event: `heartbeat`

**When it fires:** Every 15 seconds while the stream is open and no other event has been sent. Keeps the connection alive through proxies and load balancers that close idle SSE connections.

**Data shape:**
```typescript
interface HeartbeatEvent {
  ts: string;   // ISO 8601 server timestamp
}
```

**Example payload:**
```
id: 10
event: heartbeat
data: {"ts":"2026-07-06T14:32:45Z"}

```

**How to handle:** Ignore. The browser's `EventSource` handles keepalive automatically. If your framework processes all events, filter out `heartbeat` type before rendering.

---

### SSE Reconnection

The browser's native `EventSource` automatically reconnects on disconnect. When reconnecting, it sends the `Last-Event-ID` header with the ID of the last received event. The server replays all events from that sequence number onward (events are held in Redis for the lifetime of the situation, maximum 10 minutes).

**Client-side reconnection with custom headers (when using `token` query param instead of Authorization header):**

```typescript
function subscribeSituationStream(
  situationId: string,
  token: string,
  onEvent: (type: string, data: unknown) => void
): () => void {
  const url = `/api/v1/situations/${situationId}/stream?token=${encodeURIComponent(token)}`;
  const source = new EventSource(url);

  const events = [
    'context_understood',
    'clarification_needed',
    'planning_started',
    'agent_progress',
    'plan_ready',
    'error',
  ];

  events.forEach((eventType) => {
    source.addEventListener(eventType, (e: MessageEvent) => {
      onEvent(eventType, JSON.parse(e.data));
    });
  });

  source.onerror = () => {
    // EventSource will reconnect automatically with Last-Event-ID
    // Only close manually on terminal events (plan_ready, error)
  };

  return () => source.close(); // cleanup function
}
```

**Error Responses (before stream opens):**

| Status | Code | When | Client Action |
|---|---|---|---|
| 401 | `UNAUTHORIZED` | Token missing or expired | Refresh token and reconnect |
| 403 | `SITUATION_ACCESS_DENIED` | Situation belongs to a different user | Do not retry |
| 404 | `SITUATION_NOT_FOUND` | UUID does not exist | Show error, redirect to home |
| 410 | `SITUATION_EXPIRED` | Situation is older than 10 minutes in a pre-terminal state | Prompt user to start a new situation |

### Idempotency

Opening multiple simultaneous SSE connections to the same situation ID is safe. The server broadcasts the same events to all open connections for the same situation. Events are not consumed — they are broadcast. Reconnecting does not change situation state.

### Timeouts

- **Client-side:** Do not set a timeout on the SSE connection itself. The stream stays open until `plan_ready` or `error`. The maximum server-side stream duration is 3 minutes; the server closes the connection at that point regardless of state.
- **Server-side:** Individual agents have their own timeouts (Intent: 6s, Swiggy: 8s, Planning: 20s). If Planning Agent exceeds its timeout, the server emits an `error` event with `fallback_available: true`.

### Versioning

The SSE event payload schemas follow the same versioning rules as REST endpoints. New optional fields may be added to event data without a version bump. New event types may be added without a version bump (clients should ignore unknown event types). Removing fields or changing types requires `/api/v2/situations/:id/stream`.

---

## POST /api/v1/situations/:id/clarify

### Overview

- **Method + Path:** `POST /api/v1/situations/:id/clarify`
- **Purpose:** Submit the user's answers to the clarification questions generated by the Clarification Agent. If the answers complete the required context, triggers the Planning Agent immediately.
- **Authentication:** Required. Clerk JWT in `Authorization` header.
- **Rate limit:** 20 requests / minute per user.

### Path Parameters

| Parameter | Type | Validation |
|---|---|---|
| `id` | UUID string | Must be a valid UUID v4. Must belong to the authenticated user. |

### Request

**Headers:**
```
Authorization: Bearer <clerk_jwt_token>
Content-Type: application/json
```

**Request Body TypeScript Interface:**
```typescript
interface ClarifyRequest {
  clarification_id: string;    // UUID from the clarification_needed SSE event
  answers: {
    [questionId: string]: string | number | boolean | string[];
    // key is the question ID from the clarification_needed event ("q1", "q2", etc.)
    // value type matches the question's declared type
  };
}
```

**Example Request:**
```json
{
  "clarification_id": "b7e2d3a1-4c56-4e12-8f90-426614174111",
  "answers": {
    "q1": false,
    "q2": true
  }
}
```

**Validation Rules:**
- `clarification_id` must match the most recent active clarification for the situation.
- All `required: true` questions from the clarification_needed event must have a corresponding answer key.
- Optional questions (where `required: false`) may be omitted — the server will apply its stated assumption.
- Answer values must match the declared `type` of the question (`single_choice` → one of the option values, `multi_choice` → array of option values, `freetext` → string, `number` → integer).

### Response

**Success — HTTP 200:**
```typescript
interface ClarifyResponse {
  status: 'context_ready' | 'more_clarification_needed';
  message: string;
  pass_number: number;
  // if status is 'context_ready':
  planning_started?: boolean;
  // if status is 'more_clarification_needed':
  next_pass_event_incoming?: boolean; // a new clarification_needed event will arrive on the stream
}
```

**Example Success — Context Complete:**
```json
{
  "status": "context_ready",
  "message": "Got it — finding vegetarian delivery options for you now",
  "pass_number": 1,
  "planning_started": true
}
```

**Example Success — Second Pass Needed:**
```json
{
  "status": "more_clarification_needed",
  "message": "One more thing to narrow this down",
  "pass_number": 1,
  "next_pass_event_incoming": true
}
```

**Error Responses:**

| Status | Code | When | Client Action |
|---|---|---|---|
| 400 | `MISSING_REQUIRED_ANSWERS` | One or more required questions have no answer | Show which questions are missing and re-prompt |
| 400 | `INVALID_ANSWER_TYPE` | Answer value does not match declared question type | Fix the value type |
| 401 | `UNAUTHORIZED` | Token missing or expired | Refresh token and retry |
| 403 | `SITUATION_ACCESS_DENIED` | Situation belongs to a different user | Do not retry |
| 404 | `SITUATION_NOT_FOUND` | Situation UUID does not exist | Show error |
| 409 | `CLARIFICATION_EXPIRED` | The clarification_id has expired (>5 minutes since the question was asked) | Surface an expiry message; the user must create a new situation |
| 409 | `INVALID_SITUATION_STATE` | Situation is not in `clarifying` state (e.g., already planning) | Ignore — this answer is a duplicate; the plan is already underway |
| 429 | `RATE_LIMIT_EXCEEDED` | More than 20 clarify calls in 60 seconds | Respect `Retry-After` header |

### Idempotency

Submitting identical answers to the same `clarification_id` twice is safe. The server is idempotent for the same clarification ID — the second call returns the same response as the first without re-triggering agents. Submitting different answers to the same expired clarification returns `CLARIFICATION_EXPIRED`.

### Timeouts

- **Client-side timeout recommendation:** 5 seconds. This is a lightweight write — no LLM is invoked directly by this endpoint.
- **Server-side:** The Planning Agent is triggered asynchronously after this call succeeds. Planning progress is delivered via the still-open SSE stream, not this endpoint's response.

### Versioning

Non-breaking: new optional answer types may be added. Breaking: removing question IDs or changing `clarification_id` semantics requires V2.

### Code Example

```typescript
async function submitClarification(
  situationId: string,
  clarificationId: string,
  answers: Record<string, unknown>,
  token: string
): Promise<void> {
  const res = await fetch(`/api/v1/situations/${situationId}/clarify`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ clarification_id: clarificationId, answers }),
    signal: AbortSignal.timeout(5_000),
  });

  if (res.status === 409) {
    const err = await res.json();
    if (err.code === 'CLARIFICATION_EXPIRED') {
      // Prompt user to start a new situation
    }
    // INVALID_SITUATION_STATE — safe to ignore, planning is already running
    return;
  }

  if (!res.ok) throw new Error((await res.json()).message);
  // Success: continue watching the SSE stream for planning_started
}
```

---

## GET /api/v1/situations/:id

### Overview

- **Method + Path:** `GET /api/v1/situations/:id`
- **Purpose:** Fetch the current state of a situation. Primarily used for reconnection after an SSE disconnect — the client checks this endpoint to determine what has already happened and whether it needs to re-subscribe to the stream.
- **Authentication:** Required. Clerk JWT in `Authorization` header.
- **Rate limit:** 60 requests / minute per user (general GET limit).

### Path Parameters

| Parameter | Type | Validation |
|---|---|---|
| `id` | UUID string | Must be a valid UUID v4. Must belong to the authenticated user. |

### Request

**Headers:**
```
Authorization: Bearer <clerk_jwt_token>
```

No request body.

### Response

**Success — HTTP 200:**
```typescript
type SituationStatus =
  | 'created'
  | 'intent_extracted'
  | 'clarifying'
  | 'context_ready'
  | 'planning'
  | 'plan_ready'
  | 'executing'
  | 'completed'
  | 'abandoned'
  | 'error';

interface SituationResponse {
  id: string;
  status: SituationStatus;
  situation_type: string | null;
  raw_input: string;
  understood_as: string | null;
  created_at: string;           // ISO 8601
  context_ready_at: string | null;
  plan_ready_at: string | null;
  completed_at: string | null;

  // Present when status is 'clarifying'
  pending_clarification?: {
    clarification_id: string;
    questions: Array<{
      id: string;
      text: string;
      field: string;
      type: string;
      options?: Array<{ label: string; value: unknown }>;
      required: boolean;
    }>;
    expires_at: string;
  };

  // Present when status is 'plan_ready', 'executing', or 'completed'
  recommendation_id?: string;

  // Present when status is 'error'
  error?: {
    code: string;
    message: string;
    fallback_available: boolean;
    fallback_recommendation_id?: string;
  };

  // Whether the SSE stream is still open
  stream_active: boolean;
}
```

**Example — Situation awaiting clarification:**
```json
{
  "id": "a3f1b2c4-7e89-4d12-b456-426614174000",
  "status": "clarifying",
  "situation_type": "unwell",
  "raw_input": "I'm sick and exhausted, don't feel like cooking at all",
  "understood_as": "You're sick and need food without having to cook",
  "created_at": "2026-07-06T14:30:00Z",
  "context_ready_at": null,
  "plan_ready_at": null,
  "completed_at": null,
  "pending_clarification": {
    "clarification_id": "b7e2d3a1-4c56-4e12-8f90-426614174111",
    "questions": [
      {
        "id": "q1",
        "text": "Are you feeling up to cooking today, or should we find something to order?",
        "field": "canCook",
        "type": "single_choice",
        "options": [
          { "label": "I can manage a simple meal", "value": true },
          { "label": "Need delivery — I'm wiped out", "value": false }
        ],
        "required": true
      }
    ],
    "expires_at": "2026-07-06T14:35:00Z"
  },
  "stream_active": true
}
```

**Example — Plan ready:**
```json
{
  "id": "a3f1b2c4-7e89-4d12-b456-426614174000",
  "status": "plan_ready",
  "situation_type": "unwell",
  "raw_input": "I'm sick and exhausted, don't feel like cooking at all",
  "understood_as": "You're sick and need food without having to cook",
  "created_at": "2026-07-06T14:30:00Z",
  "context_ready_at": "2026-07-06T14:30:45Z",
  "plan_ready_at": "2026-07-06T14:31:12Z",
  "completed_at": null,
  "recommendation_id": "c9d4e5f2-3a78-4b23-9012-426614174222",
  "stream_active": false
}
```

**Error Responses:**

| Status | Code | When | Client Action |
|---|---|---|---|
| 401 | `UNAUTHORIZED` | Token missing or expired | Refresh token and retry |
| 403 | `SITUATION_ACCESS_DENIED` | Situation belongs to a different user | Do not retry |
| 404 | `SITUATION_NOT_FOUND` | UUID does not exist | Redirect to home screen |

### Idempotency

This is a read-only GET endpoint. It is fully idempotent. Safe to call as frequently as needed.

### Reconnection Pattern

When an SSE connection drops, the client should:

1. Call `GET /api/v1/situations/:id` immediately.
2. If `status` is a pre-terminal state (`clarifying`, `planning`, `context_ready`, `intent_extracted`) and `stream_active` is true, re-open the SSE stream — events will be replayed from the last received `id`.
3. If `status` is `plan_ready`, fetch the recommendation directly — no need to reconnect to the stream.
4. If `status` is `error`, handle the error state without reconnecting.

### Timeouts

- **Client-side timeout recommendation:** 5 seconds.
- **No LLM calls on this endpoint.** Pure database read.

### Code Example

```typescript
async function getSituationState(situationId: string, token: string) {
  const res = await fetch(`/api/v1/situations/${situationId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}
```

---

## GET /api/v1/recommendations/:id

### Overview

- **Method + Path:** `GET /api/v1/recommendations/:id`
- **Purpose:** Fetch the full recommendation plan including all plan items, comparison scores, nutrition data, and execution metadata. Called immediately after receiving the `plan_ready` SSE event.
- **Authentication:** Required. Clerk JWT in `Authorization` header.
- **Rate limit:** 60 requests / minute per user.

### Path Parameters

| Parameter | Type | Validation |
|---|---|---|
| `id` | UUID string | Must be a valid UUID v4. Must belong to the authenticated user's situation. |

### Response

**Success — HTTP 200:**
```typescript
type Service = 'swiggy_food' | 'instamart' | 'dineout' | 'recipe' | 'meal_prep';
type PlanType = 'single' | 'sequence' | 'multi_service' | 'weekly';

interface NutritionInfo {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

interface ComparisonScore {
  service: Service;
  score: number;          // 0–100, the deterministic TypeScript scoring output
  cost_inr: number;
  time_minutes: number;
  nutrition?: NutritionInfo;
  score_breakdown: {
    budget_fit: number;       // 0–25
    time_fit: number;         // 0–25
    nutrition_fit: number;    // 0–25
    preference_fit: number;   // 0–25
  };
}

interface RecipeStep {
  step_number: number;
  title: string;
  detail: string;
  time_minutes: number;
}

interface InstamartItem {
  name: string;
  quantity: string;
  estimated_cost_inr: number;
  swiggy_item_id?: string;   // null if not available on Instamart
  in_pantry: boolean;
}

interface RecommendationItem {
  id: string;                 // UUID of recommendation_item row
  rank: number;               // 1 = primary, 2+ = alternatives
  is_primary: boolean;
  service: Service;
  title: string;
  description: string;
  estimated_cost_inr: number;
  estimated_time_minutes: number;
  nutrition?: NutritionInfo;
  is_executable: boolean;

  // Service-specific detail blocks
  // Populated based on 'service' value:

  recipe_detail?: {
    difficulty: 'beginner' | 'intermediate' | 'advanced';
    serves: number;
    steps: RecipeStep[];
    ingredients: InstamartItem[];
    missing_ingredients: string[];
    can_make_now: boolean;
    youtube_search_query: string;  // pre-formed YouTube search for a tutorial
    instamart_cart_ready: boolean; // true if all missing items are available on Instamart
  };

  delivery_detail?: {
    restaurant_name: string;
    restaurant_id: string;        // Swiggy restaurant ID
    item_name: string;
    estimated_delivery_minutes: number;
    offer_applied?: string;       // e.g. "30% off up to Rs 100"
    deep_link: string;            // Swiggy app/web deep link (pre-fills cart)
  };

  instamart_detail?: {
    items: InstamartItem[];
    total_cost_inr: number;
    estimated_delivery_minutes: number;
    deep_link: string;
  };

  dineout_detail?: {
    venue_name: string;
    venue_id: string;
    cuisine: string;
    ambience: string;
    available_slots: string[];    // ISO 8601 datetime strings
    deep_link: string;
  };
}

interface RecommendationResponse {
  id: string;
  situation_id: string;
  headline: string;
  reasoning: string;
  plan_type: PlanType;
  created_at: string;             // ISO 8601

  // The scored comparison across all evaluated services
  comparison: ComparisonScore[];

  // The actual recommendation items (primary + alternatives)
  items: RecommendationItem[];

  // For 'sequence' or 'multi_service' plans
  timeline?: Array<{
    label: string;               // e.g. "Now", "At 6:30 PM", "Tomorrow"
    action: string;
    item_id: string;             // references items[].id
    scheduled_for?: string;      // ISO 8601 if scheduled
  }>;

  // Memory updates that will be persisted after user acts
  memory_previews?: Array<{
    key: string;
    value: unknown;
    action: 'store' | 'update';
    reason: string;
  }>;
}
```

**Example Response:**
```json
{
  "id": "c9d4e5f2-3a78-4b23-9012-426614174222",
  "situation_id": "a3f1b2c4-7e89-4d12-b456-426614174000",
  "headline": "Order comfort food — you're sick and need rest",
  "reasoning": "Delivery is the right call. You're unwell and alone, so cooking adds unnecessary effort. Found vegetarian comfort options under your Rs 350 daily budget.",
  "plan_type": "single",
  "created_at": "2026-07-06T14:31:12Z",
  "comparison": [
    {
      "service": "swiggy_food",
      "score": 87,
      "cost_inr": 160,
      "time_minutes": 28,
      "nutrition": { "calories": 380, "protein_g": 12, "carbs_g": 65, "fat_g": 8 },
      "score_breakdown": { "budget_fit": 23, "time_fit": 20, "nutrition_fit": 22, "preference_fit": 22 }
    },
    {
      "service": "recipe",
      "score": 41,
      "cost_inr": 85,
      "time_minutes": 25,
      "nutrition": { "calories": 420, "protein_g": 16, "carbs_g": 72, "fat_g": 10 },
      "score_breakdown": { "budget_fit": 25, "time_fit": 18, "nutrition_fit": 22, "preference_fit": -24 }
    },
    {
      "service": "dineout",
      "score": 12,
      "cost_inr": 900,
      "time_minutes": 90,
      "score_breakdown": { "budget_fit": -8, "time_fit": 5, "nutrition_fit": 10, "preference_fit": 5 }
    }
  ],
  "items": [
    {
      "id": "d1e2f3a4-5b67-4c89-a012-426614174333",
      "rank": 1,
      "is_primary": true,
      "service": "swiggy_food",
      "title": "Khichdi from Haldiram's",
      "description": "Light, warm, and easily digestible. Perfect for when you're feeling unwell. Vegetarian, within budget.",
      "estimated_cost_inr": 160,
      "estimated_time_minutes": 28,
      "nutrition": { "calories": 380, "protein_g": 12, "carbs_g": 65, "fat_g": 8 },
      "is_executable": true,
      "delivery_detail": {
        "restaurant_name": "Haldiram's Bandra",
        "restaurant_id": "swg_rest_4821",
        "item_name": "Khichdi (Full Bowl)",
        "estimated_delivery_minutes": 28,
        "offer_applied": "Free delivery on orders above Rs 149",
        "deep_link": "https://www.swiggy.com/city/mumbai/haldirams-bandra?cart=khichdi_4821"
      }
    },
    {
      "id": "e5f6a7b8-9c01-4d23-b456-426614174444",
      "rank": 2,
      "is_primary": false,
      "service": "swiggy_food",
      "title": "Tomato Soup + Grilled Veg Sandwich from The Bowl Company",
      "description": "More filling if you haven't eaten all day. Warm soup is ideal for cold symptoms.",
      "estimated_cost_inr": 240,
      "estimated_time_minutes": 32,
      "nutrition": { "calories": 520, "protein_g": 18, "carbs_g": 72, "fat_g": 14 },
      "is_executable": true,
      "delivery_detail": {
        "restaurant_name": "The Bowl Company",
        "restaurant_id": "swg_rest_2039",
        "item_name": "Healing Soup Combo",
        "estimated_delivery_minutes": 32,
        "offer_applied": "Rs 50 off on first Bowl Company order",
        "deep_link": "https://www.swiggy.com/city/mumbai/the-bowl-company-bandra?cart=healing_combo_2039"
      }
    }
  ],
  "memory_previews": [
    {
      "key": "health.last_sick_day",
      "value": "2026-07-06",
      "action": "store",
      "reason": "User indicated they were sick today"
    }
  ]
}
```

**Error Responses:**

| Status | Code | When | Client Action |
|---|---|---|---|
| 401 | `UNAUTHORIZED` | Token missing or expired | Refresh token and retry |
| 403 | `RECOMMENDATION_ACCESS_DENIED` | Recommendation belongs to a different user | Do not retry |
| 404 | `RECOMMENDATION_NOT_FOUND` | UUID does not exist | Check `GET /situations/:id` for the correct recommendation_id |
| 409 | `RECOMMENDATION_NOT_READY` | Called before `plan_ready` SSE event (planning still in progress) | Wait for `plan_ready` event, then retry |

### Idempotency

Fully idempotent GET endpoint. Safe to call multiple times. The recommendation is immutable after creation.

### Timeouts

- **Client-side timeout recommendation:** 5 seconds.
- **No LLM calls on this endpoint.** Pure database read of pre-computed data.

### Code Example

```typescript
async function getRecommendation(recommendationId: string, token: string) {
  const res = await fetch(`/api/v1/recommendations/${recommendationId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (res.status === 409) {
    // Poll until ready — but prefer waiting for the SSE plan_ready event instead
    throw new Error('Recommendation not ready yet');
  }
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}
```

---

## POST /api/v1/recommendations/:id/execute

### Overview

- **Method + Path:** `POST /api/v1/recommendations/:id/execute`
- **Purpose:** Execute a specific item from a recommendation. For delivery and dineout items, pre-fills the Swiggy cart and returns a deep link. For cook/recipe items, marks the cooking session as started and returns the step-by-step guide. Triggers async memory updates after execution.
- **Authentication:** Required. Clerk JWT in `Authorization` header.
- **Rate limit:** 30 requests / minute per user.

### Path Parameters

| Parameter | Type | Validation |
|---|---|---|
| `id` | UUID string | The recommendation ID (not the item ID). |

### Request

**Headers:**
```
Authorization: Bearer <clerk_jwt_token>
Content-Type: application/json
```

**Request Body TypeScript Interface:**
```typescript
interface ExecuteRecommendationRequest {
  item_id: string;              // UUID of the specific recommendation_item to execute
  execution_context?: {
    modified_items?: string[];  // Swiggy item IDs the user added/removed from the cart preview
    selected_time_slot?: string; // ISO 8601, for dineout reservations
    party_size?: number;        // for dineout
  };
}
```

**Example Request — Executing a delivery item:**
```json
{
  "item_id": "d1e2f3a4-5b67-4c89-a012-426614174333"
}
```

**Example Request — Executing a dineout item with a time slot:**
```json
{
  "item_id": "f7a8b9c0-1d23-4e56-c789-426614174555",
  "execution_context": {
    "selected_time_slot": "2026-07-06T20:00:00+05:30",
    "party_size": 2
  }
}
```

### Response

**Success — HTTP 200:**
```typescript
type ExecutionResultType = 'swiggy_cart' | 'instamart_cart' | 'dineout_booking' | 'cooking_guide';

interface ExecuteRecommendationResponse {
  action_id: string;            // UUID of the user_action record created
  execution_type: ExecutionResultType;
  confirmation: string;         // human-readable confirmation message

  // For swiggy_cart and instamart_cart:
  redirect_url?: string;        // Swiggy deep link with cart pre-filled
  cart_summary?: {
    items: Array<{ name: string; quantity: number; cost_inr: number }>;
    total_cost_inr: number;
    estimated_delivery_minutes: number;
  };

  // For dineout_booking:
  booking_url?: string;
  booking_confirmation?: {
    venue_name: string;
    date_time: string;          // ISO 8601
    party_size: number;
    reservation_id?: string;    // Swiggy Dineout reservation ID if available
  };

  // For cooking_guide:
  cooking_session_id?: string;  // UUID to track cooking progress
  recipe_steps?: Array<{
    step_number: number;
    title: string;
    detail: string;
    time_minutes: number;
  }>;
  shopping_needed?: boolean;    // true if missing ingredients need to be purchased
  instamart_shortfall_url?: string; // Instamart deep link for missing ingredients only
}
```

**Example Response — Delivery execution:**
```json
{
  "action_id": "g2h3i4j5-6k78-4l90-m123-426614174666",
  "execution_type": "swiggy_cart",
  "confirmation": "Opening Swiggy with Khichdi from Haldiram's added to your cart",
  "redirect_url": "https://www.swiggy.com/city/mumbai/haldirams-bandra?cart=khichdi_4821",
  "cart_summary": {
    "items": [{ "name": "Khichdi (Full Bowl)", "quantity": 1, "cost_inr": 160 }],
    "total_cost_inr": 160,
    "estimated_delivery_minutes": 28
  }
}
```

**Example Response — Cook execution:**
```json
{
  "action_id": "h3i4j5k6-7l89-4m01-n234-426614174777",
  "execution_type": "cooking_guide",
  "confirmation": "Starting Paneer Bhurji cooking guide — estimated 35 minutes",
  "cooking_session_id": "i4j5k6l7-8m90-4n12-o345-426614174888",
  "recipe_steps": [
    { "step_number": 1, "title": "Crumble the paneer", "detail": "Break 250g paneer into coarse crumbles using your hands. Keep pieces uneven — texture matters.", "time_minutes": 2 },
    { "step_number": 2, "title": "Sauté onion and aromatics", "detail": "Heat 2 tbsp oil in a pan on medium. Add 1 large onion (finely chopped). Cook until golden, 6–8 minutes. Add 1 tsp ginger-garlic paste, stir for 1 minute.", "time_minutes": 9 },
    { "step_number": 3, "title": "Add tomato and spices", "detail": "Add 2 tomatoes (chopped), ½ tsp turmeric, 1 tsp red chilli powder, 1 tsp coriander powder. Cook until oil separates, about 5 minutes.", "time_minutes": 5 }
  ],
  "shopping_needed": false
}
```

**Error Responses:**

| Status | Code | When | Client Action |
|---|---|---|---|
| 400 | `ITEM_NOT_EXECUTABLE` | The item has `is_executable: false` | Do not retry; show the item's info only |
| 400 | `MISSING_TIME_SLOT` | Dineout item requires a `selected_time_slot` in `execution_context` | Prompt user to select a time slot |
| 401 | `UNAUTHORIZED` | Token missing or expired | Refresh token and retry |
| 403 | `RECOMMENDATION_ACCESS_DENIED` | Recommendation belongs to a different user | Do not retry |
| 404 | `RECOMMENDATION_NOT_FOUND` | Recommendation UUID does not exist | Redirect to home |
| 404 | `ITEM_NOT_FOUND` | `item_id` does not exist within this recommendation | Check the item ID |
| 409 | `RECOMMENDATION_NOT_READY` | Recommendation is not yet in `plan_ready` state | Wait for plan; do not retry immediately |
| 503 | `SWIGGY_UNAVAILABLE` | Swiggy MCP is unreachable; cannot pre-fill cart | Show the restaurant name and fallback instructions to open Swiggy manually; set `retry_after_seconds` |

### Idempotency

This endpoint is **not strictly idempotent** — calling it twice creates two `user_action` records. However, it is **safe to retry** for `swiggy_cart` and `instamart_cart` execution types: the Swiggy deep link is deterministic based on the item data, so a duplicate call produces the same `redirect_url`. The extra `user_action` record does not cause observable harm.

For `dineout_booking`, do not retry on success. Submitting twice may attempt two reservations. Check the returned `action_id` before retrying.

### Timeouts

- **Client-side timeout recommendation:** 10 seconds. Swiggy MCP calls are the slowest part.
- **Server-side:** The Swiggy MCP call has an 8-second internal timeout. If it times out, the server returns `503 SWIGGY_UNAVAILABLE` with `retry_after_seconds: 15`.

### Code Example

```typescript
async function executeRecommendation(
  recommendationId: string,
  itemId: string,
  token: string
): Promise<string | null> { // returns redirect_url for order/instamart, null for cooking
  const res = await fetch(`/api/v1/recommendations/${recommendationId}/execute`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ item_id: itemId }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const err = await res.json();
    if (err.code === 'SWIGGY_UNAVAILABLE') {
      // Show fallback UI
    }
    throw new Error(err.message);
  }

  const data = await res.json();
  return data.redirect_url ?? null;
}
```

---

## GET /api/v1/memory

### Overview

- **Method + Path:** `GET /api/v1/memory`
- **Purpose:** Fetch the authenticated user's complete memory state — structured profile fields and individual memory facts. Used to populate the Memory Panel in the UI.
- **Authentication:** Required. Clerk JWT in `Authorization` header.
- **Rate limit:** 60 requests / minute per user.

### Request

**Headers:**
```
Authorization: Bearer <clerk_jwt_token>
```

No request body. No query parameters.

### Response

**Success — HTTP 200:**
```typescript
type MemorySource = 'user_stated' | 'agent_inferred' | 'action_derived';
type FactType = 'string' | 'number' | 'boolean' | 'array' | 'date';

interface MemoryFact {
  id: string;                   // UUID of the user_memory_facts row
  key: string;                  // e.g. "budget.daily_food_target"
  value: unknown;
  fact_type: FactType;
  source: MemorySource;
  confidence: number;           // 0.0–1.0
  last_confirmed_at: string;    // ISO 8601
  expires_at: string | null;
  editable: boolean;            // some agent-inferred facts are read-only
  display_label: string;        // human-readable label for the Memory Panel
  display_category: string;     // grouping for the Memory Panel UI
}

interface UserProfile {
  diet_type: string | null;
  allergies: string[];
  dietary_notes: string | null;
  household_size: number;
  cooking_skill: 'beginner' | 'intermediate' | 'advanced' | null;
  kitchen_equipment: string[];
  daily_food_budget: number | null;
  dining_out_budget: number | null;
  daily_protein_target: number | null;
  daily_calorie_target: number | null;
  gym_days: string[];
  preferred_cuisines: string[];
  disliked_cuisines: string[];
  home_address: string | null;
  work_address: string | null;
}

interface MemoryResponse {
  profile: UserProfile;
  facts: MemoryFact[];
  last_updated_at: string;      // ISO 8601, most recent change to any fact
  fact_count: number;
  onboarding_complete: boolean;
}
```

**Example Response:**
```json
{
  "profile": {
    "diet_type": "vegetarian",
    "allergies": ["shellfish"],
    "dietary_notes": null,
    "household_size": 1,
    "cooking_skill": "intermediate",
    "kitchen_equipment": ["gas stove", "mixer", "pressure cooker"],
    "daily_food_budget": 350,
    "dining_out_budget": 2500,
    "daily_protein_target": 150,
    "daily_calorie_target": null,
    "gym_days": ["Monday", "Wednesday", "Friday"],
    "preferred_cuisines": ["South Indian", "Italian"],
    "disliked_cuisines": [],
    "home_address": "Bandra West, Mumbai",
    "work_address": "BKC, Mumbai"
  },
  "facts": [
    {
      "id": "j5k6l7m8-9n01-4o23-p456-426614174999",
      "key": "budget.daily_food_target",
      "value": 350,
      "fact_type": "number",
      "source": "user_stated",
      "confidence": 1.0,
      "last_confirmed_at": "2026-05-20T10:00:00Z",
      "expires_at": "2026-08-20T10:00:00Z",
      "editable": true,
      "display_label": "Daily food budget",
      "display_category": "Budget"
    },
    {
      "id": "k6l7m8n9-0o12-4p34-q567-426614175000",
      "key": "preference.cuisines.liked",
      "value": ["South Indian", "Italian"],
      "fact_type": "array",
      "source": "agent_inferred",
      "confidence": 0.82,
      "last_confirmed_at": "2026-07-01T18:30:00Z",
      "expires_at": null,
      "editable": true,
      "display_label": "Cuisines you enjoy",
      "display_category": "Preferences"
    },
    {
      "id": "l7m8n9o0-1p23-4q45-r678-426614175111",
      "key": "ordering.frequent_restaurants",
      "value": ["Behrouz Biryani", "Wow Momo"],
      "fact_type": "array",
      "source": "action_derived",
      "confidence": 0.95,
      "last_confirmed_at": "2026-07-05T20:15:00Z",
      "expires_at": null,
      "editable": false,
      "display_label": "Your usual spots",
      "display_category": "Order History"
    }
  ],
  "last_updated_at": "2026-07-05T20:15:00Z",
  "fact_count": 14,
  "onboarding_complete": true
}
```

**Error Responses:**

| Status | Code | When | Client Action |
|---|---|---|---|
| 401 | `UNAUTHORIZED` | Token missing or expired | Refresh token and retry |
| 404 | `USER_NOT_FOUND` | No MealOS user record for this Clerk userId (user deleted?) | Redirect to onboarding or sign-out |

### Idempotency

Fully idempotent GET. Safe to call repeatedly.

### Timeouts

- **Client-side timeout recommendation:** 5 seconds.

### Code Example

```typescript
async function getUserMemory(token: string) {
  const res = await fetch('/api/v1/memory', {
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}
```

---

## PATCH /api/v1/memory

### Overview

- **Method + Path:** `PATCH /api/v1/memory`
- **Purpose:** Update one or more memory facts directly from the Memory Panel. Used when the user corrects an AI-inferred fact (e.g., updating their budget, changing their diet type, removing an incorrect cuisine preference). All updates are marked `source: "user_stated"` and `confidence: 1.0`.
- **Authentication:** Required. Clerk JWT in `Authorization` header.
- **Rate limit:** 30 requests / minute per user.

### Request

**Headers:**
```
Authorization: Bearer <clerk_jwt_token>
Content-Type: application/json
```

**Request Body TypeScript Interface:**
```typescript
interface MemoryUpdate {
  key: string;                  // the fact_key to update (e.g. "budget.daily_food_target")
  value: unknown;               // new value; null to delete the fact
  source?: 'user_stated';       // always user_stated from this endpoint; ignored if provided
}

interface PatchMemoryRequest {
  updates: MemoryUpdate[];      // 1–20 updates per request
}
```

**Example Request:**
```json
{
  "updates": [
    { "key": "budget.daily_food_target", "value": 450 },
    { "key": "dietary.restrictions", "value": ["vegetarian", "no-onion"] },
    { "key": "preference.cuisines.disliked", "value": ["Fast Food"] }
  ]
}
```

**Validation Rules:**
- Maximum 20 updates per request.
- Keys must match the format `<category>.<subcategory>.<detail>` (dot-separated, lowercase).
- Keys that do not exist are created as new facts.
- Setting `value` to `null` deletes the fact.
- Facts with `editable: false` (from `GET /memory` response) cannot be updated via this endpoint. Attempting to update them returns `FACT_NOT_EDITABLE`.

### Response

**Success — HTTP 200:**
```typescript
interface PatchMemoryResponse {
  updated: number;              // count of facts successfully updated
  created: number;              // count of new facts created
  deleted: number;              // count of facts deleted (value was null)
  failures: Array<{
    key: string;
    code: string;
    message: string;
  }>;                           // partial failures (non-critical; update continues for valid keys)
}
```

**Example Response:**
```json
{
  "updated": 2,
  "created": 1,
  "deleted": 0,
  "failures": []
}
```

**Example Response with Partial Failure:**
```json
{
  "updated": 1,
  "created": 0,
  "deleted": 0,
  "failures": [
    {
      "key": "ordering.frequent_restaurants",
      "code": "FACT_NOT_EDITABLE",
      "message": "This fact is derived from your order history and cannot be manually edited."
    }
  ]
}
```

**Error Responses:**

| Status | Code | When | Client Action |
|---|---|---|---|
| 400 | `INVALID_UPDATE_PAYLOAD` | `updates` array is empty or contains more than 20 items | Fix the payload |
| 400 | `INVALID_KEY_FORMAT` | Key does not match `category.subcategory` format | Fix the key string |
| 400 | `INVALID_VALUE_TYPE` | Value type is incompatible with the existing fact type | Fix the value |
| 401 | `UNAUTHORIZED` | Token missing or expired | Refresh token and retry |
| 429 | `RATE_LIMIT_EXCEEDED` | More than 30 requests in 60 seconds | Respect `Retry-After` |

### Idempotency

**Idempotent for the same key-value pair.** Sending the same update twice results in the same final state. The `updated` count will be 1 on the first call and 0 on the second (no change detected), but no error is returned.

### Timeouts

- **Client-side timeout recommendation:** 5 seconds.

### Code Example

```typescript
async function updateMemoryFacts(
  updates: Array<{ key: string; value: unknown }>,
  token: string
): Promise<{ updated: number }> {
  const res = await fetch('/api/v1/memory', {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ updates }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}
```

---

## POST /api/v1/onboarding

### Overview

- **Method + Path:** `POST /api/v1/onboarding`
- **Purpose:** One-time endpoint called at the end of the 90-second onboarding flow. Stores the user's answers as structured memory facts and marks the account as onboarding-complete. Calling this endpoint a second time returns a no-op success (not an error).
- **Authentication:** Required. Clerk JWT in `Authorization` header.
- **Rate limit:** 3 requests / lifetime per user (enforced to prevent abuse; the effective limit is 1 meaningful call).

### Request

**Headers:**
```
Authorization: Bearer <clerk_jwt_token>
Content-Type: application/json
```

**Request Body TypeScript Interface:**
```typescript
type DietType = 'vegetarian' | 'vegan' | 'non_vegetarian' | 'pescatarian' | 'jain';
type CookingSkill = 'beginner' | 'intermediate' | 'advanced';

interface OnboardingRequest {
  // Question 1: Diet
  diet_type: DietType;
  allergies?: string[];              // free-text, e.g. ["shellfish", "peanuts"]

  // Question 2: Location
  home_address: string;              // free-text address, e.g. "Bandra West, Mumbai"
  home_lat?: number;
  home_lng?: number;

  // Question 3: Budget
  daily_food_budget: number;         // INR per day

  // Question 4: Cooking skill
  cooking_skill: CookingSkill;
  kitchen_equipment?: string[];      // e.g. ["gas stove", "microwave", "oven"]

  // Question 5: Fitness (optional — user can skip)
  daily_protein_target?: number;     // grams
  daily_calorie_target?: number;     // kcal
  gym_days?: string[];               // e.g. ["Monday", "Wednesday", "Friday"]
}
```

**Example Request:**
```json
{
  "diet_type": "vegetarian",
  "allergies": ["shellfish"],
  "home_address": "Bandra West, Mumbai 400050",
  "home_lat": 19.0596,
  "home_lng": 72.8295,
  "daily_food_budget": 350,
  "cooking_skill": "intermediate",
  "kitchen_equipment": ["gas stove", "mixer", "pressure cooker"],
  "daily_protein_target": 150,
  "gym_days": ["Monday", "Wednesday", "Friday"]
}
```

**Validation Rules:**
- `diet_type` is required.
- `home_address` is required.
- `daily_food_budget` is required. Minimum 1, maximum 100,000.
- `cooking_skill` is required.
- All other fields are optional. Skipped fitness fields are stored as null.

### Response

**Success — First Call — HTTP 201 Created:**
```typescript
interface OnboardingResponse {
  user_id: string;            // internal MealOS UUID (not Clerk ID)
  onboarding_complete: boolean;  // always true
  facts_stored: number;          // count of memory facts created
  profile_complete: boolean;     // true if all optional fields were provided
  next_step: 'home';             // always "home" — redirect to the main app
}
```

**Success — Subsequent Call (no-op) — HTTP 200 OK:**
```json
{
  "user_id": "m8n9o0p1-2q34-4r56-s789-426614175222",
  "onboarding_complete": true,
  "facts_stored": 0,
  "profile_complete": true,
  "next_step": "home"
}
```

**Example First-Call Response:**
```json
{
  "user_id": "m8n9o0p1-2q34-4r56-s789-426614175222",
  "onboarding_complete": true,
  "facts_stored": 9,
  "profile_complete": false,
  "next_step": "home"
}
```

**Error Responses:**

| Status | Code | When | Client Action |
|---|---|---|---|
| 400 | `INVALID_ONBOARDING_DATA` | Required fields missing or invalid types | Show per-field validation errors |
| 400 | `INVALID_DIET_TYPE` | `diet_type` not in the allowed enum | Show the allowed values |
| 401 | `UNAUTHORIZED` | Token missing or expired | Refresh token and retry |
| 429 | `ONBOARDING_LIMIT_EXCEEDED` | More than 3 lifetime calls (abuse protection) | Contact support |

### Idempotency

Idempotent on repeated calls with the same data. A second call does not overwrite existing user-stated facts (subsequent manual edits via `PATCH /memory` take precedence). A second call with different data does overwrite existing onboarding facts — this is intentional to allow users to redo onboarding during development.

### Timeouts

- **Client-side timeout recommendation:** 8 seconds.

### Code Example

```typescript
async function completeOnboarding(
  data: OnboardingRequest,
  token: string
): Promise<void> {
  const res = await fetch('/api/v1/onboarding', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  // Redirect to '/' (home) after success
}
```

---

## GET /api/v1/health

### Overview

- **Method + Path:** `GET /api/v1/health`
- **Purpose:** Public health check. Used by load balancers, uptime monitors (e.g., Vercel, Railway), and CI/CD pipelines to verify the API is up.
- **Authentication:** None required.
- **Rate limit:** Unlimited.

### Request

No headers, body, or query parameters required.

### Response

**Success — HTTP 200:**
```typescript
type ServiceStatus = 'ok' | 'degraded' | 'down';

interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;              // semver, e.g. "1.0.0"
  timestamp: string;            // ISO 8601 server time
  services: {
    database: ServiceStatus;
    redis: ServiceStatus;
    llm: ServiceStatus;         // Claude API reachability
    swiggy_mcp: ServiceStatus;
  };
  uptime_seconds: number;
}
```

**Example — All systems healthy:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2026-07-06T14:30:00Z",
  "services": {
    "database": "ok",
    "redis": "ok",
    "llm": "ok",
    "swiggy_mcp": "ok"
  },
  "uptime_seconds": 86401
}
```

**Example — Degraded (Swiggy MCP unavailable):**
```json
{
  "status": "degraded",
  "version": "1.0.0",
  "timestamp": "2026-07-06T14:30:00Z",
  "services": {
    "database": "ok",
    "redis": "ok",
    "llm": "ok",
    "swiggy_mcp": "down"
  },
  "uptime_seconds": 3602
}
```

**503 Service Unavailable** is returned only when the database is unreachable (the API cannot serve any requests at all). A degraded status (Swiggy or LLM unavailable) still returns 200 with `status: "degraded"`.

### Idempotency

Fully idempotent. Safe to call at any frequency.

### Timeouts

Each dependency check has a 500ms internal timeout. The total endpoint response time is under 1.5 seconds in healthy conditions.

---

## Error Code Reference

Complete table of all error codes used across the MealOS API.

| Code | HTTP Status | When It Occurs | Client Action |
|---|---|---|---|
| `UNAUTHORIZED` | 401 | Clerk JWT missing, expired, or malformed | Call `getToken()` from Clerk SDK; retry once. If second attempt fails, redirect to sign-in. |
| `SITUATION_ACCESS_DENIED` | 403 | Situation's user_id does not match the authenticated user | Do not retry. Log as potential abuse. |
| `RECOMMENDATION_ACCESS_DENIED` | 403 | Recommendation's user_id does not match the authenticated user | Do not retry. |
| `SITUATION_NOT_FOUND` | 404 | No situation exists for the given UUID | Show an error; redirect to home screen. |
| `RECOMMENDATION_NOT_FOUND` | 404 | No recommendation exists for the given UUID | Check `GET /situations/:id` for the correct `recommendation_id`. |
| `USER_NOT_FOUND` | 404 | No MealOS user record for the authenticated Clerk userId | Trigger onboarding flow. |
| `ITEM_NOT_FOUND` | 404 | Item UUID does not belong to the given recommendation | Refetch the recommendation to get valid item IDs. |
| `INVALID_INPUT` | 400 | `input` field is empty, whitespace-only, or exceeds 2000 chars | Show a validation message; do not retry automatically. |
| `INVALID_LOCATION` | 400 | `lat`/`lng` values are out of range | Fix the coordinate values or omit the location field. |
| `INPUT_UNPARSEABLE` | 422 | Input text contains no extractable intent | Prompt the user to rephrase their situation in plain language. |
| `MISSING_REQUIRED_ANSWERS` | 400 | One or more `required: true` questions have no answer in the clarify payload | Identify which question IDs are missing and re-prompt the user. |
| `INVALID_ANSWER_TYPE` | 400 | An answer value's type does not match the declared question type | Fix the answer format before resubmitting. |
| `CLARIFICATION_EXPIRED` | 409 | The clarification was not answered within 5 minutes | Inform the user the session expired; prompt them to start a new situation. |
| `INVALID_SITUATION_STATE` | 409 | Operation is incompatible with the situation's current `status` (e.g., clarifying a situation that is already planning) | Safe to ignore in most cases — the situation has already progressed. |
| `RECOMMENDATION_NOT_READY` | 409 | `GET /recommendations/:id` called before `plan_ready` SSE event | Wait for the `plan_ready` SSE event before fetching. |
| `ITEM_NOT_EXECUTABLE` | 400 | `POST /execute` called on an item with `is_executable: false` | Show the item's details only; hide the execute button for non-executable items. |
| `MISSING_TIME_SLOT` | 400 | Dineout execute call has no `selected_time_slot` in `execution_context` | Surface the time-slot picker before allowing execution. |
| `FACT_NOT_EDITABLE` | 400 | `PATCH /memory` attempted on a fact with `editable: false` | Filter out non-editable facts from the Memory Panel's edit UI. |
| `INVALID_UPDATE_PAYLOAD` | 400 | `PATCH /memory` has an empty `updates` array or more than 20 entries | Batch or split the updates. |
| `INVALID_KEY_FORMAT` | 400 | Memory key does not follow the `category.subcategory` dot-notation format | Correct the key string format. |
| `INVALID_VALUE_TYPE` | 400 | Memory value type conflicts with the existing fact's declared type | Check the fact's `fact_type` from `GET /memory` before updating. |
| `INVALID_ONBOARDING_DATA` | 400 | Required onboarding fields (`diet_type`, `home_address`, `daily_food_budget`, `cooking_skill`) are missing | Show per-field validation errors on the onboarding form. |
| `INVALID_DIET_TYPE` | 400 | `diet_type` is not one of the allowed values | Show the list of valid diet types. |
| `ONBOARDING_LIMIT_EXCEEDED` | 429 | More than 3 onboarding submissions (abuse threshold) | Contact support; do not retry automatically. |
| `RATE_LIMIT_EXCEEDED` | 429 | Per-user rate limit exceeded for the endpoint | Read the `Retry-After` header and wait the specified duration. |
| `LLM_TIMEOUT` | 504 | An AI agent (Intent, Planning, Clarification) did not respond within its timeout window | A fallback recommendation may be available — check `GET /situations/:id`. If not, surface a retry option. |
| `AGENT_BOOTSTRAP_FAILED` | 500 | The initial agent pipeline failed to start (Redis queue unavailable, etc.) | Retry after 5 seconds, maximum 2 retries. |
| `SWIGGY_UNAVAILABLE` | 503 | Swiggy MCP is unreachable | Show recipe-only recommendations if a fallback exists. For execute calls, show a manual "open Swiggy app" fallback. |
| `SERVICE_UNAVAILABLE` | 503 | Core dependencies (database, Redis) are down | Do not retry immediately. Show a service-disruption notice. Retry after the `Retry-After` interval. |

---

## Retry Logic Guidelines

### Which Endpoints Are Safe to Retry

| Endpoint | Safe to Retry | Notes |
|---|---|---|
| `GET /situations/:id` | Yes, always | Idempotent read |
| `GET /situations/:id/stream` | Yes, always | EventSource reconnects automatically |
| `GET /recommendations/:id` | Yes, always | Idempotent read |
| `GET /memory` | Yes, always | Idempotent read |
| `GET /api/v1/health` | Yes, always | Idempotent read |
| `POST /situations` | With care | Check for an existing in-progress situation before retrying to avoid duplicates |
| `POST /situations/:id/clarify` | Yes | Idempotent for the same `clarification_id` |
| `POST /recommendations/:id/execute` | Safe for `swiggy_cart` / `instamart_cart` | Do not retry `dineout_booking` — may double-book |
| `PATCH /memory` | Yes, always | Idempotent for same key-value pairs |
| `POST /onboarding` | Yes | Subsequent calls are no-ops |

### Detecting Transient vs Permanent Failures

**Transient (safe to retry):**
- HTTP 429 — rate limited; use `Retry-After` header
- HTTP 500 with code `AGENT_BOOTSTRAP_FAILED`
- HTTP 503 with code `SWIGGY_UNAVAILABLE` or `SERVICE_UNAVAILABLE`
- HTTP 504 with code `LLM_TIMEOUT`
- Network errors (no response received at all)
- `EventSource` connection dropped

**Permanent (do not retry):**
- HTTP 400 — client error, input is wrong
- HTTP 401 — after one retry with a fresh token
- HTTP 403 — access denied, will not change on retry
- HTTP 404 — resource does not exist
- HTTP 409 with code `CLARIFICATION_EXPIRED` — must start a new situation
- HTTP 422 — input is well-formed but semantically unparseable

### Exponential Backoff Parameters

Apply to all transient failures for non-GET endpoints:

```typescript
const backoff = {
  initialDelayMs: 1_000,
  multiplier: 2,
  maxDelayMs: 30_000,
  maxRetries: 3,
  jitterMs: 500, // random(0, 500) added to each delay
};

// Delay schedule:
// Attempt 1 (immediate)
// Attempt 2: ~1.0–1.5s
// Attempt 3: ~2.0–2.5s
// Attempt 4: ~4.0–4.5s
```

For `LLM_TIMEOUT` errors, use a longer initial delay:

```typescript
const llmBackoff = {
  initialDelayMs: 5_000,   // LLM timeouts indicate load; wait longer
  multiplier: 2,
  maxDelayMs: 30_000,
  maxRetries: 2,
};
```

### Retry Implementation Pattern

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  isRetryable: (error: { code: string; status: number }) => boolean,
  maxRetries = 3
): Promise<T> {
  let delay = 1_000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const apiError = err as { code: string; status: number };
      if (attempt === maxRetries || !isRetryable(apiError)) throw err;
      const jitter = Math.random() * 500;
      await new Promise((r) => setTimeout(r, delay + jitter));
      delay = Math.min(delay * 2, 30_000);
    }
  }
  throw new Error('Max retries exceeded');
}
```

---

## Webhooks (V2)

Webhooks are planned for V2. They allow external systems to subscribe to MealOS events without polling.

### Planned Webhook Events

| Event | Trigger | Payload |
|---|---|---|
| `situation.plan_ready` | Planning Engine completes a recommendation | `{ situation_id, recommendation_id, plan_type, user_id }` |
| `situation.executed` | User executes a recommendation item | `{ situation_id, action_id, service, item_title }` |
| `order.status_updated` | Swiggy order status changes (requires Swiggy webhook integration) | `{ action_id, external_order_id, status, estimated_minutes }` |
| `reminder.triggered` | A scheduled meal reminder fires | `{ scheduled_meal_id, meal_type, description, action }` |
| `memory.updated` | A memory fact is created or changed (for multi-device sync) | `{ user_id, fact_key, new_value, source }` |

### Delivery Mechanism (V2)

Webhooks will be delivered via HTTPS POST to a user-configured URL. Payloads will be signed with an HMAC-SHA256 signature using a per-subscriber secret. Deliveries will be retried up to 5 times with exponential backoff on non-2xx responses.

### Registration (V2)

```
POST /api/v2/webhooks
{
  "url": "https://your-server.example.com/hooks/mealos",
  "events": ["situation.plan_ready", "order.status_updated"],
  "secret": "your-hmac-secret"
}
```

### Order Status Tracking Note

Order status tracking from Swiggy (delivery progress, driver location) depends on Swiggy exposing these events via their MCP or a partner webhook integration. This is the primary V2 dependency. Until it is available, clients should poll `GET /api/v1/situations/:id` for execution status.

---

## Versioning Policy

### What Constitutes a Breaking Change (Requires `/api/v2/`)

- Removing a required request field
- Removing a response field that clients are expected to use
- Changing the type of a field (e.g., `string` to `number`)
- Changing the meaning of an existing enum value
- Changing the behavior of an existing endpoint in a way that breaks existing integrations
- Removing an SSE event type
- Changing the structure of an SSE event's `data` field

### What Is Non-Breaking (May Be Added to V1)

- Adding a new optional request field
- Adding a new response field
- Adding a new SSE event type
- Adding a new enum value to an existing field
- Adding a new HTTP error code for a new edge case
- Performance improvements or internal implementation changes with no observable behavior change

### Deprecation Timeline Policy

Deprecated V1 endpoints will:
1. Return a `Deprecation: true` response header and a `Sunset: <date>` header from the deprecation announcement date.
2. Remain functional for a minimum of 90 days after the `Sunset` date is published.
3. Be removed with one additional 30-day warning notice before the final sunset.

V2 will be introduced alongside V1 — both will be operational simultaneously during the transition period.
