# MealOS AI — GitHub Issues P2 (ISSUE-110 to ISSUE-200)

> Epics 7–12: Swiggy Integration, AI Cooking Mode, Memory Learning, UI Polish, Testing Infrastructure, Production Hardening

---

## EPIC 7: Swiggy Integration

### ISSUE-110: Swiggy Integration Epic
**Type:** epic  **Labels:** swiggy P0 XL
**Epic:** —  **Depends on:** —

Full integration with the Swiggy MCP server, exposing food delivery, Instamart grocery, and Dineout reservation workflows as typed tool calls available to the Tool Agent. Covers client lifecycle, all five cart/reservation tools, mock fixtures, fallback chains, and error taxonomy.

**Acceptance Criteria:**
- [ ] SwiggyMCPClient singleton connects, exposes all 4 tool definitions, and tears down cleanly
- [ ] All three service types (delivery, Instamart, Dineout) return typed result arrays
- [ ] Cart and reservation creation tools return deep links usable on web and iOS
- [ ] Fallback to cook-only mode when MCP is unavailable, surfaced in UI

---

### ISSUE-111: SwiggyMCPClient.ts — singleton client, connection lifecycle, all 4 tool definitions typed
**Type:** task  **Labels:** swiggy P0 M
**Epic:** ISSUE-110  **Depends on:** —

Implement `SwiggyMCPClient` as a module-level singleton that manages the MCP server connection lifecycle (connect on first call, auto-reconnect on drop, graceful close). All four Swiggy MCP tool definitions must be declared as typed `ToolDefinition` objects matching the MCP spec.

**Acceptance Criteria:**
- [ ] Singleton instance is reused across requests; connection is established lazily on first invocation
- [ ] `connect()`, `disconnect()`, and `isConnected()` methods exist with proper async semantics
- [ ] All 4 tool definitions (`swiggy_search_restaurants`, `swiggy_search_instamart`, `swiggy_search_dineout`, `swiggy_create_food_cart`) are typed with Zod input schemas
- [ ] Unit test confirms singleton identity across multiple imports

---

### ISSUE-112: swiggy_search_restaurants tool — query, location, filters → RestaurantResult[], max 20 results
**Type:** task  **Labels:** swiggy P0 M
**Epic:** ISSUE-110  **Depends on:** ISSUE-111

Implement the `swiggy_search_restaurants` tool that accepts a search query string, a location object, and optional filters (cuisine, rating, delivery time) and returns up to 20 `RestaurantResult` objects. Results must be sorted by relevance score descending and include restaurant id, name, cuisine tags, rating, ETA, and menu deep link.

**Acceptance Criteria:**
- [ ] Input schema validated with Zod; invalid location throws typed `INVALID_INPUT` error
- [ ] Returns at most 20 results; excess results are truncated before returning
- [ ] Each `RestaurantResult` includes `restaurantId`, `name`, `cuisines[]`, `rating`, `etaMinutes`, and `menuUrl`
- [ ] Unit test covers empty result set and max-20 truncation

---

### ISSUE-113: swiggy_search_instamart tool — ingredient names → InstamartResult[] with price + ETA, fuzzy matching
**Type:** task  **Labels:** swiggy P0 M
**Epic:** ISSUE-110  **Depends on:** ISSUE-111

Implement `swiggy_search_instamart` that takes an array of ingredient name strings and returns an `InstamartResult[]` with itemId, name, price, availability, and deliveryEtaMinutes per ingredient. Apply fuzzy matching so minor spelling variations ("tomato" vs "tomatos") resolve to the correct SKU.

**Acceptance Criteria:**
- [ ] Fuzzy match uses Levenshtein distance ≤ 2 before falling back to Swiggy catalog keyword search
- [ ] Each result includes `itemId`, `name`, `priceInr`, `available`, and `etaMinutes`
- [ ] Out-of-stock items are included in results with `available: false` rather than silently dropped
- [ ] Unit test covers multi-ingredient query, fuzzy match hit, and fully unavailable query

---

### ISSUE-114: swiggy_search_dineout tool — occasion, guests, budget → DineoutVenue[] with available time slots
**Type:** task  **Labels:** swiggy P0 M
**Epic:** ISSUE-110  **Depends on:** ISSUE-111

Implement `swiggy_search_dineout` that accepts occasion type, guest count, and budget-per-head and returns `DineoutVenue[]` each containing venue metadata and an array of available `TimeSlot` objects for the next 48 hours. Venues must be filtered to those with at least one open slot for the requested party size.

**Acceptance Criteria:**
- [ ] Input enum for occasion covers: `date`, `family`, `business`, `celebration`, `casual`
- [ ] Each `DineoutVenue` includes `venueId`, `name`, `cuisines[]`, `avgCostPerHead`, and `slots[]`
- [ ] Slots outside the next 48-hour window are excluded
- [ ] Returns empty array (not an error) when no venues match filters

---

### ISSUE-115: swiggy_create_food_cart tool — restaurantId + items → cartId + Swiggy deep link URL
**Type:** task  **Labels:** swiggy P1 M
**Epic:** ISSUE-110  **Depends on:** ISSUE-112

Implement `swiggy_create_food_cart` that takes a `restaurantId` and an array of `{itemId, quantity}` objects and returns a `CartResult` with `cartId` and a `deepLinkUrl` pointing to the pre-filled Swiggy cart. The tool must validate that all item IDs belong to the specified restaurant before creating the cart.

**Acceptance Criteria:**
- [ ] Item-restaurant mismatch throws `INVALID_INPUT` with a descriptive message listing the offending item IDs
- [ ] Returned `deepLinkUrl` follows the format `swiggy://cart/{cartId}` with web fallback `https://swiggy.com/cart/{cartId}`
- [ ] Cart creation is idempotent: same restaurantId + items within 60s returns the same cartId
- [ ] Integration test (MockMCPClient) confirms deep link format and idempotency window

---

### ISSUE-116: swiggy_create_instamart_cart tool — itemIds → cartId + Swiggy deep link, handles out-of-stock
**Type:** task  **Labels:** swiggy P1 M
**Epic:** ISSUE-110  **Depends on:** ISSUE-113

Implement `swiggy_create_instamart_cart` that takes an array of Instamart `itemId` strings and returns a cart deep link, gracefully handling items that are out of stock by excluding them and returning a `skippedItems[]` list in the response. The tool must never fail hard if a subset of items is unavailable.

**Acceptance Criteria:**
- [ ] Out-of-stock items are excluded from the cart and listed in `result.skippedItems[]`
- [ ] If all requested items are out of stock, return `CART_EMPTY` typed error rather than creating an empty cart
- [ ] `deepLinkUrl` uses `swiggy://instamart/cart/{cartId}` scheme with https web fallback
- [ ] Unit test covers: all available, partial skip, all skipped scenarios

---

### ISSUE-117: swiggy_create_dineout_reservation tool — venueId + slot + partySize → reservationId + confirmation
**Type:** task  **Labels:** swiggy P1 M
**Epic:** ISSUE-110  **Depends on:** ISSUE-114

Implement `swiggy_create_dineout_reservation` that takes a `venueId`, an ISO-8601 slot datetime, and party size and returns a `ReservationResult` with `reservationId`, confirmation number, and a `managementUrl`. Slot availability must be re-verified at booking time to catch race conditions.

**Acceptance Criteria:**
- [ ] Slot re-verification at booking time; stale slot throws `SLOT_TAKEN` typed error
- [ ] Party size exceeding venue capacity throws `INVALID_INPUT` with `maxPartySize` in error payload
- [ ] `ReservationResult` includes `reservationId`, `confirmationCode`, `venueId`, `slot`, and `managementUrl`
- [ ] Unit test confirms `SLOT_TAKEN` path and successful booking shape

---

### ISSUE-118: MockSwiggyMCPClient — realistic Mumbai fixture data for all 3 service types, injectable via env flag
**Type:** task  **Labels:** swiggy devops P1 S
**Epic:** ISSUE-110  **Depends on:** ISSUE-111

Create `MockSwiggyMCPClient` implementing the same interface as `SwiggyMCPClient` with static Mumbai fixture data covering restaurants, Instamart SKUs, and Dineout venues. The mock is activated when `SWIGGY_MCP_MOCK=true` is set, enabling local development and CI without live MCP connectivity.

**Acceptance Criteria:**
- [ ] `MockSwiggyMCPClient` satisfies the same TypeScript interface as the real client
- [ ] Fixtures include ≥ 5 restaurants, ≥ 20 Instamart SKUs, and ≥ 3 Dineout venues with slots
- [ ] `SWIGGY_MCP_MOCK=true` env flag swaps the singleton without code changes
- [ ] All unit tests use the mock client exclusively; no real MCP calls in CI

---

### ISSUE-119: Swiggy unavailable fallback chain — MCP down → cook-only mode, notice in UI
**Type:** task  **Labels:** swiggy ui P1 S
**Epic:** ISSUE-110  **Depends on:** ISSUE-111

Implement the fallback chain: when `SwiggyMCPClient.isConnected()` returns false or any MCP call throws `UNAVAILABLE`, the Tool Agent silently degrades to cook-only recommendations and sets a `swiggyUnavailable: true` flag in the plan response. The UI renders a non-blocking notice banner when this flag is present.

**Acceptance Criteria:**
- [ ] `UNAVAILABLE` error from MCP client triggers cook-only mode without surfacing an error to the user
- [ ] Plan response JSON includes `_meta.swiggyUnavailable: true` when fallback is active
- [ ] UI renders a dismissible notice banner ("Swiggy ordering unavailable right now") when flag is set
- [ ] E2E test confirms full plan completes in cook-only mode when mock MCP is set to offline

---

### ISSUE-120: BUG — Swiggy cart deep link opens browser instead of app on iOS (add universal link + web fallback)
**Type:** bug  **Labels:** swiggy ui P1 S
**Epic:** ISSUE-110  **Depends on:** ISSUE-115, ISSUE-116

On iOS, tapping the Swiggy deep link (`swiggy://...`) opens Safari rather than the Swiggy app when the app is installed, because the link is rendered as a plain anchor without the `apple-app-site-association` universal link pattern. Implement universal link support with a web fallback for users without the app.

**Acceptance Criteria:**
- [ ] Cart link uses `https://swiggy.com/cart/{cartId}` (universal link) rather than `swiggy://` scheme directly
- [ ] Page includes appropriate `<meta>` smart-app-banner or branch.io redirect for iOS app handoff
- [ ] On desktop, link opens Swiggy web cart in a new tab
- [ ] Manual test on iOS Safari and Chrome confirms app opens correctly when installed

---

### ISSUE-121: Swiggy error taxonomy — 8 error codes typed and documented
**Type:** task  **Labels:** swiggy P1 S
**Epic:** ISSUE-110  **Depends on:** ISSUE-111

Define a `SwiggyErrorCode` const enum with 8 codes: `UNAVAILABLE`, `NOT_SERVICEABLE`, `CLOSED`, `OUT_OF_STOCK`, `SLOT_TAKEN`, `CART_EXPIRED`, `RATE_LIMIT`, `AUTH_FAILED`. Each code must map to a typed `SwiggyError` class with a user-facing message template and a boolean `retryable` flag.

**Acceptance Criteria:**
- [ ] `SwiggyErrorCode` is a `const enum` exported from `lib/swiggy/errors.ts`
- [ ] Each error code has a `retryable` boolean and a `userMessage` template string
- [ ] All Swiggy tool implementations throw `SwiggyError` (never raw `Error`) for known failure modes
- [ ] Unit test asserts `retryable` values: `RATE_LIMIT` and `UNAVAILABLE` are retryable; others are not

---

### ISSUE-122: Tool Agent partial failure handling — one tool fails → return what succeeded, mark failed tools in _meta
**Type:** task  **Labels:** swiggy ai-agents P1 M
**Epic:** ISSUE-110  **Depends on:** ISSUE-121

Update the Tool Agent to handle partial tool failure gracefully: when one Swiggy tool call fails but others succeed, the agent returns the successful results and records each failure in `_meta.toolFailures[]` with tool name, error code, and timestamp. The plan is still delivered to the user with reduced richness rather than rejected outright.

**Acceptance Criteria:**
- [ ] `_meta.toolFailures[]` is populated per failed tool with `{tool, errorCode, failedAt}` shape
- [ ] A plan with partial failure still reaches `plan_ready` state (not `error`)
- [ ] If ALL tools fail, the agent falls back to cook-only mode (see ISSUE-119)
- [ ] Unit test covers: zero failures, one failure + one success, all failures

---

## EPIC 8: AI Cooking Mode

### ISSUE-130: AI Cooking Mode Epic
**Type:** epic  **Labels:** ai-agents ui P1 XL
**Epic:** —  **Depends on:** ISSUE-110

End-to-end cooking workflow powered by the Planning Agent: YouTube video attachment, pantry gap detection, Instamart cart for missing ingredients, step-by-step guided cooking with inline video clips, and a completion screen. Makes "cook at home" recommendations actionable without leaving MealOS.

**Acceptance Criteria:**
- [ ] Planning Agent attaches a YouTube recipe video to every cook recommendation
- [ ] Missing pantry ingredients surface an Instamart cart CTA
- [ ] Cooking steps are navigable one at a time with progress tracking
- [ ] Completion screen captures time taken and prompts meal logging

---

### ISSUE-131: YouTube Data API v3 client — search by recipe name + cuisine, returns top result with URL + thumbnail + duration
**Type:** task  **Labels:** ai-agents P1 M
**Epic:** ISSUE-130  **Depends on:** —

Implement `YouTubeClient` in `lib/youtube/client.ts` that wraps the YouTube Data API v3 `search.list` endpoint. Given a recipe name and cuisine string, it returns the single best-matching video with `videoId`, `title`, `channelName`, `thumbnailUrl`, `durationIso8601`, and a full watch URL.

**Acceptance Criteria:**
- [ ] API key read from `YOUTUBE_API_KEY` env var; missing key throws at startup
- [ ] Search query constructed as `"{recipeName} {cuisine} recipe"` with `type=video` and `videoDuration=medium`
- [ ] Returns the top result only; no result returns `null` (not an error)
- [ ] Unit test mocks the HTTP response and asserts output shape

---

### ISSUE-132: YouTubeCard component — thumbnail, channel name, duration, opens YouTube on tap
**Type:** task  **Labels:** ui P1 S
**Epic:** ISSUE-130  **Depends on:** ISSUE-131

Build `<YouTubeCard>` in `components/cooking/YouTubeCard.tsx` that renders a video thumbnail with a play-button overlay, the video title, channel name, and formatted duration. Tapping opens the YouTube watch URL in a new tab; the component accepts a `YouTubeResult` prop and handles `null` gracefully with a skeleton state.

**Acceptance Criteria:**
- [ ] Renders thumbnail as a `<img>` with `alt` set to video title for accessibility
- [ ] Duration is displayed in `MM:SS` format converted from ISO 8601
- [ ] `null` prop renders a skeleton shimmer placeholder (reuse ISSUE-165 skeleton)
- [ ] Opens YouTube URL via `target="_blank" rel="noopener noreferrer"`

---

### ISSUE-133: Recipe video attachment to cook recommendations — Planning Agent calls Tool Agent youtube_search_recipe
**Type:** task  **Labels:** ai-agents P1 M
**Epic:** ISSUE-130  **Depends on:** ISSUE-131, ISSUE-132

Add a `youtube_search_recipe` tool to the Tool Agent and wire the Planning Agent to call it for every recommendation with `action: "cook"`. The YouTube result is embedded in the recommendation payload under `recommendation.youtube` and rendered via `<YouTubeCard>` in the plan UI.

**Acceptance Criteria:**
- [ ] Tool Agent exposes `youtube_search_recipe(recipeName, cuisine)` returning `YouTubeResult | null`
- [ ] Planning Agent's system prompt instructs it to call `youtube_search_recipe` for all cook actions
- [ ] `recommendation.youtube` field is present in the API response for cook-type recommendations
- [ ] UI renders `<YouTubeCard>` below the recommendation title when `youtube` is non-null

---

### ISSUE-134: Pantry check against recipe ingredients — compare recipe ingredient list vs user_memory_facts pantry items
**Type:** task  **Labels:** ai-agents memory P1 M
**Epic:** ISSUE-130  **Depends on:** ISSUE-149

Implement `checkPantryGaps(recipeIngredients: string[], userId: string): Promise<PantryGapResult>` that reads the user's pantry facts from `user_memory_facts` and returns `{have: string[], missing: string[]}`. Matching uses case-insensitive partial string comparison to handle label variations.

**Acceptance Criteria:**
- [ ] Reads only facts with `factKey` matching the pantry key prefix from the `FactKey` registry
- [ ] Returns `have[]` and `missing[]` arrays; never throws on empty pantry (returns all as missing)
- [ ] Case-insensitive partial match: "Basmati Rice" matches user fact "basmati rice 1kg"
- [ ] Unit test covers: full pantry match, partial match, empty pantry

---

### ISSUE-135: InstamartCart component — missing ingredients list with price + ETA + "Add to Instamart" CTA
**Type:** task  **Labels:** ui swiggy P1 M
**Epic:** ISSUE-130  **Depends on:** ISSUE-116, ISSUE-134

Build `<InstamartCart>` that receives a `missingIngredients[]` list, fetches their Instamart prices and ETAs via `swiggy_search_instamart`, and displays them in a list with per-item price and delivery ETA. A primary CTA button calls `swiggy_create_instamart_cart` and opens the resulting deep link.

**Acceptance Criteria:**
- [ ] List shows ingredient name, price in INR, and ETA in minutes per item
- [ ] Out-of-stock items are shown with a strikethrough and "Unavailable" badge
- [ ] "Add to Instamart" button is disabled while cart creation is in-flight (loading spinner)
- [ ] On cart creation success, button label changes to "Open Instamart ↗" and triggers the deep link

---

### ISSUE-136: CookingStepCard component — step number, instruction text, duration badge, "Done" tap, progress bar
**Type:** task  **Labels:** ui P1 S
**Epic:** ISSUE-130  **Depends on:** —

Build `<CookingStepCard>` that displays a single recipe step with step number, instruction text, a duration badge (e.g. "3 min"), and a "Done" tap target. Accepts `isActive`, `isDone`, and `onDone` props; completed cards collapse to a single-line summary with a checkmark.

**Acceptance Criteria:**
- [ ] Active card is visually highlighted with accent border; done cards are dimmed with checkmark icon
- [ ] Duration badge renders as a pill; `null` duration renders nothing
- [ ] "Done" tap calls `onDone()` and is disabled when `isDone` is true
- [ ] Collapsed done-card shows step number + truncated instruction (max 60 chars) in a single row

---

### ISSUE-137: Cooking step progress tracking — local state: done steps array, progress percentage, completion screen
**Type:** task  **Labels:** ui P1 S
**Epic:** ISSUE-130  **Depends on:** ISSUE-136, ISSUE-139

Implement the stateful `<CookingMode>` container that holds `doneSteps: Set<number>` in local state, computes progress percentage, renders a progress bar above the step list, and transitions to the `<CookingCompletionScreen>` when all steps are marked done.

**Acceptance Criteria:**
- [ ] Progress percentage is `(doneSteps.size / totalSteps) * 100`, rounded to the nearest integer
- [ ] Progress bar uses the design system accent color and animates width change with CSS transition
- [ ] All steps done triggers `<CookingCompletionScreen>` render (ISSUE-139) after a 600ms delay
- [ ] State is local (no server calls); page refresh resets progress (acceptable for MVP)

---

### ISSUE-138: Inline YouTube timestamp clips — each step card has "Watch 18s clip ▶" linking to YouTube at timestamp
**Type:** task  **Labels:** ui ai-agents P2 S
**Epic:** ISSUE-130  **Depends on:** ISSUE-136, ISSUE-141

Each `<CookingStepCard>` with a non-null `youtubeTimestamp` displays a small "Watch 18s clip ▶" link that opens the recipe video at the specified timestamp using the `?t=` query param. The timestamp is generated by the Planning Agent during step generation (ISSUE-141).

**Acceptance Criteria:**
- [ ] Link rendered as `https://youtu.be/{videoId}?t={seconds}` in a new tab
- [ ] "Watch 18s clip ▶" label is a fixed string; duration is not dynamically computed
- [ ] Link is omitted entirely when `youtubeTimestamp` is null
- [ ] Accessibility: link has `aria-label="Watch cooking clip at {timestamp}"` 

---

### ISSUE-139: Cooking completion screen — all steps done → summary: time taken, protein cooked, "Log this meal?" prompt
**Type:** task  **Labels:** ui P1 S
**Epic:** ISSUE-130  **Depends on:** ISSUE-137

Build `<CookingCompletionScreen>` that shows a celebration headline, total time taken (calculated from step durations), protein name cooked, and a prominent "Log this meal?" CTA. The CTA triggers a POST to `/api/meal-log` and transitions to a success state showing a checkmark.

**Acceptance Criteria:**
- [ ] Time taken is the sum of all step `durationSeconds` values, formatted as "X min Y sec"
- [ ] Protein name is passed as a prop from the recipe; renders as "You cooked: {protein}"
- [ ] "Log this meal?" CTA shows a loading spinner while the POST is in-flight
- [ ] After successful log, CTA area replaced with "Logged ✓" text; error shows a toast

---

### ISSUE-140: BUG — Instamart search fails for compound ingredient names like "ginger-garlic paste" (add normalization + retry with simplified query)
**Type:** bug  **Labels:** swiggy P1 S
**Epic:** ISSUE-130  **Depends on:** ISSUE-113

`swiggy_search_instamart` returns zero results for hyphenated or multi-word compound ingredient names because the Swiggy catalog search treats the hyphen as a separator and splits the query. Add a normalization step that strips hyphens and retries with a simplified single-keyword query when the primary search returns no results.

**Acceptance Criteria:**
- [ ] Normalization replaces hyphens with spaces before the primary search
- [ ] If primary search returns 0 results, retry with only the last significant word (e.g., "paste" from "ginger-garlic paste")
- [ ] Retry is attempted at most once; no further fallback
- [ ] Unit test: "ginger-garlic paste" → first try normalized → if empty, retry "paste"

---

### ISSUE-141: Recipe steps generation by Planning Agent — sonnet generates 6-8 steps with title, instruction, duration, youtube_timestamp
**Type:** task  **Labels:** ai-agents P1 M
**Epic:** ISSUE-130  **Depends on:** ISSUE-131

Update the Planning Agent system prompt and response schema to generate a `steps[]` array for cook-type recommendations. Each step must include `stepNumber`, `title`, `instruction`, `durationSeconds`, and an optional `youtubeTimestamp` (integer seconds into the recipe video) estimated from the video duration.

**Acceptance Criteria:**
- [ ] Planning Agent generates between 6 and 8 steps per cook recommendation (enforced via Zod min/max)
- [ ] `youtubeTimestamp` is estimated proportionally based on step position and total video duration
- [ ] Steps schema validated with Zod on API response; malformed steps throw a 500 with structured log
- [ ] Golden set test (ISSUE-183) includes one cook-type case asserting step count and field presence

---

## EPIC 9: Memory Learning

### ISSUE-145: Memory Learning Epic
**Type:** epic  **Labels:** memory ai-agents P1 XL
**Epic:** —  **Depends on:** —

Asynchronous post-execution memory system where the Memory Agent (Haiku) extracts behavioral facts from completed situations and writes them to `user_memory_facts` with confidence scores. Includes a typed FactKey registry, confidence decay, live UI updates, and silent failure semantics.

**Acceptance Criteria:**
- [ ] Memory Agent fires async after every executed recommendation, never blocking the response
- [ ] Facts are extracted from both clarification answers and behavioral patterns
- [ ] Confidence decays over time for inferred facts; expired facts are pruned
- [ ] Any Memory Agent failure is logged silently without affecting user experience

---

### ISSUE-146: Memory Agent implementation — Haiku model, async post-execution, never blocks user
**Type:** task  **Labels:** ai-agents memory P1 M
**Epic:** ISSUE-145  **Depends on:** ISSUE-149

Implement `MemoryAgent` in `lib/agents/memory-agent.ts` using the `claude-haiku` model. The agent receives a completed `SituationContext` + recommendation and extracts new facts to upsert into `user_memory_facts`. It must be invoked via a fire-and-forget pattern and must never propagate exceptions to the caller.

**Acceptance Criteria:**
- [ ] Uses `claude-haiku-*` model; model ID read from `MEMORY_AGENT_MODEL` env var with haiku default
- [ ] Exported `runMemoryAgent(situationId, userId)` function returns `void` (Promise not awaited by caller)
- [ ] All uncaught exceptions inside the agent are caught, logged via `console.error`, and silently swallowed
- [ ] Unit test confirms the function resolves (not rejects) even when the LLM call throws

---

### ISSUE-147: Fact extraction from clarification answers — answered fields → user_memory_facts, confidence 0.85, source 'clarification'
**Type:** task  **Labels:** memory ai-agents P1 M
**Epic:** ISSUE-145  **Depends on:** ISSUE-146, ISSUE-149

Memory Agent reads the `clarificationAnswers` from a completed situation and maps each answered field to a `FactKey` with `confidence: 0.85` and `source: 'clarification'`. Facts are written via DB UPSERT so re-answering the same question updates the existing record rather than creating a duplicate.

**Acceptance Criteria:**
- [ ] Only answered fields (non-null values) produce fact writes; null/skipped answers are ignored
- [ ] Each fact written with `confidence: 0.85`, `source: 'clarification'`, and `learnedAt: now()`
- [ ] UPSERT uses `ON CONFLICT (userId, factKey) DO UPDATE` semantics
- [ ] Unit test: 3-answer clarification → 3 fact writes; one null answer → 2 fact writes

---

### ISSUE-148: Fact extraction from executed actions — cook 3x → preference.mealPreference.cook at confidence 0.6
**Type:** task  **Labels:** memory ai-agents P2 M
**Epic:** ISSUE-145  **Depends on:** ISSUE-146, ISSUE-149

Memory Agent counts executed action types per user from the `situations` table and writes behavioral preference facts when a pattern threshold is crossed (e.g., 3 cook executions → write `preference.mealPreference.cook` at confidence 0.6). Facts from behavior use `source: 'agent_inferred'`.

**Acceptance Criteria:**
- [ ] Threshold is 3 same-action executions within the last 30 days
- [ ] Behavioral facts written with `confidence: 0.6` and `source: 'agent_inferred'`
- [ ] Below-threshold executions produce no fact write (no partial writes)
- [ ] Unit test: 2 cook executions → no write; 3rd execution → fact written with correct keys

---

### ISSUE-149: FactKey registry — TypeScript const enum of all valid fact keys, Memory Agent validates before writing
**Type:** task  **Labels:** memory P1 S
**Epic:** ISSUE-145  **Depends on:** —

Create `lib/memory/fact-keys.ts` exporting a `FactKey` const enum covering all valid memory fact keys across domains: user profile, dietary preferences, pantry, household, health, and behavioral preferences. The Memory Agent must validate every key against this enum before writing; unknown keys throw a typed error.

**Acceptance Criteria:**
- [ ] `FactKey` const enum exported from `lib/memory/fact-keys.ts`
- [ ] Enum covers at minimum: profile (name, age, city), dietary (restrictions, preferences), pantry (items), household (members, cookingSkill), health (conditions), preference (mealPreference, orderPreference)
- [ ] Memory Agent validates key before DB write; invalid key logs error and skips the write
- [ ] TypeScript strict mode: no `any` casts in fact write path

---

### ISSUE-150: Memory panel live update after situation completes — SSE or polling refresh after plan_ready
**Type:** task  **Labels:** memory ui P2 M
**Epic:** ISSUE-145  **Depends on:** ISSUE-146

After a situation reaches `plan_ready` status, the Memory panel in the sidebar must refresh to show newly learned facts without requiring a page reload. Implement either a Server-Sent Events stream or a 5-second polling interval that stops once the updated facts are received.

**Acceptance Criteria:**
- [ ] Memory panel re-fetches `GET /api/memory` within 10 seconds of `plan_ready`
- [ ] New facts are highlighted with a subtle pulse animation for 2 seconds after appearing
- [ ] Polling/SSE stops after first successful refresh (no indefinite polling)
- [ ] No memory refresh occurs if the Memory Agent ran silently with no new facts

---

### ISSUE-151: Confidence decay for inferred facts — agent_inferred facts downgrade 0.05/week, expire when < 0.3
**Type:** task  **Labels:** memory devops P2 M
**Epic:** ISSUE-145  **Depends on:** ISSUE-149

Implement a weekly cron job (Vercel Cron or pg_cron) that reduces `confidence` by 0.05 for all `user_memory_facts` with `source: 'agent_inferred'` and deletes rows where confidence drops below 0.30. Facts with `source: 'clarification'` or `source: 'user_stated'` are not affected by decay.

**Acceptance Criteria:**
- [ ] Cron runs weekly (Sunday 02:00 UTC); configurable via env var `MEMORY_DECAY_CRON`
- [ ] Decay applied only to `source = 'agent_inferred'`; other sources unchanged
- [ ] Rows with `confidence < 0.30` are hard-deleted in the same cron transaction
- [ ] Cron logs a summary: `{decayed: N, deleted: N}` to stdout

---

### ISSUE-152: Memory Agent async trigger — fires after POST /recommendations/:id/execute, does not block response
**Type:** task  **Labels:** memory ai-agents P1 S
**Epic:** ISSUE-145  **Depends on:** ISSUE-146

In the `POST /api/recommendations/:id/execute` route handler, call `runMemoryAgent(situationId, userId)` after sending the 200 response. The function must be called without `await` so the HTTP response is not blocked. Add a comment explaining the intentional fire-and-forget pattern.

**Acceptance Criteria:**
- [ ] `runMemoryAgent(...)` is called after `res.json(...)` completes, not before
- [ ] No `await` on the memory agent call; ESLint `no-floating-promises` rule disabled for this line with an explanatory comment
- [ ] P95 response time for `/execute` is not increased by Memory Agent invocation (measured in ISSUE-198)
- [ ] Integration test confirms `/execute` returns 200 even when Memory Agent throws internally

---

### ISSUE-153: Memory Agent silent failure — any error → log only, user sees nothing, situation marked complete
**Type:** task  **Labels:** memory ai-agents P1 XS
**Epic:** ISSUE-145  **Depends on:** ISSUE-146, ISSUE-152

Wrap the entire `runMemoryAgent` body in a `try/catch` that logs to `console.error` with a structured `{event: 'memory_agent_error', situationId, error}` payload but never re-throws. Situation status must remain `complete` regardless of Memory Agent outcome; no error state is introduced.

**Acceptance Criteria:**
- [ ] `console.error` receives a structured object (not a raw Error) for observability
- [ ] `situations.status` is never set to `error` by the Memory Agent
- [ ] Sentry (ISSUE-191) captures the error at `level: 'warning'`, not `error`
- [ ] Unit test: Memory Agent throws mid-execution → function resolves, situation status unchanged

---

### ISSUE-154: BUG — Duplicate fact key writes from concurrent Memory Agent calls (add DB-level UPSERT with ON CONFLICT DO UPDATE)
**Type:** bug  **Labels:** memory P0 S
**Epic:** ISSUE-145  **Depends on:** ISSUE-147

When two situations complete in rapid succession for the same user, concurrent Memory Agent calls can race to insert the same `(userId, factKey)` pair, causing a unique-constraint violation crash. Replace the `INSERT` with a Prisma `upsert` that maps to `INSERT ... ON CONFLICT (userId, factKey) DO UPDATE SET value = EXCLUDED.value, confidence = EXCLUDED.confidence, learnedAt = now()`.

**Acceptance Criteria:**
- [ ] All Memory Agent DB writes use `prisma.userMemoryFact.upsert()` (no raw `INSERT`)
- [ ] Database migration adds `UNIQUE (userId, factKey)` constraint if not already present
- [ ] Concurrent test: fire 2 Memory Agent calls for the same userId + factKey in parallel → no exception, final row reflects the higher-confidence value
- [ ] No downtime migration: constraint added with `NOT VALID` then validated in a follow-up transaction

---

## EPIC 10: UI Polish

### ISSUE-160: UI Polish Epic
**Type:** epic  **Labels:** ui P2 XL
**Epic:** —  **Depends on:** —

Comprehensive UI polish pass covering motion design, accessibility, mobile responsiveness, and empty states. All interactions should feel native and fluid, meeting WCAG 2.1 AA contrast minimums, passing mobile overflow audits at all target breakpoints, and presenting contextual empty states instead of blank screens.

**Acceptance Criteria:**
- [ ] All async states have skeleton loaders; no raw "Loading..." text
- [ ] All route changes have a 400ms fadeUp entrance animation
- [ ] WCAG 2.1 AA contrast passes for all text elements in both light and latenight themes
- [ ] No horizontal overflow at 375px, 390px, 430px, or 768px viewport widths

---

### ISSUE-161: Theme transition animation — 500ms ease-smooth on app-shell background + color when mode changes
**Type:** task  **Labels:** ui P2 S
**Epic:** ISSUE-160  **Depends on:** —

Add CSS `transition: background-color 500ms ease, color 500ms ease` to the root `app-shell` element so switching between default and latenight themes produces a smooth cross-fade rather than an instant jump. The transition must apply to all theme-sensitive CSS custom properties including `--bg-primary`, `--text-primary`, and `--accent`.

**Acceptance Criteria:**
- [ ] Transition duration is exactly 500ms; easing is `cubic-bezier(0.4, 0, 0.2, 1)` (ease-smooth)
- [ ] Applies to `background-color`, `color`, and `border-color`; does not apply to layout properties
- [ ] Transition is disabled when `prefers-reduced-motion: reduce` is active
- [ ] Visual test: switching theme produces smooth fade with no flash of unstyled content

---

### ISSUE-162: VoiceButton listening animation — ring pulse expand CSS keyframe, accent color, 1.2s infinite
**Type:** task  **Labels:** ui P2 S
**Epic:** ISSUE-160  **Depends on:** —

Add a `@keyframes voicePulse` animation to the `<VoiceButton>` component that renders expanding ring pulses in the accent color while listening is active. The animation runs at 1.2-second intervals, infinite, and stops immediately when listening ends. The button's icon changes to a mic-active icon during animation.

**Acceptance Criteria:**
- [ ] `@keyframes voicePulse` scales a pseudo-element from 1× to 1.8× while fading opacity 0.6 → 0
- [ ] Animation duration is 1.2s, timing is `ease-out`, iteration count is `infinite`
- [ ] Animation class added only when `isListening` prop is true; removed immediately on false
- [ ] Respects `prefers-reduced-motion`: animation disabled, substitute with static accent border

---

### ISSUE-163: PlanningGraph node completion animation — accent fill + checkmark scale spring, 150ms per node
**Type:** task  **Labels:** ui P2 S
**Epic:** ISSUE-160  **Depends on:** —

When a PlanningGraph node transitions to `complete` state, animate the node background filling with accent color and a checkmark icon scaling from 0 to 1 using a spring curve (`cubic-bezier(0.34, 1.56, 0.64, 1)`). Each node animates independently at 150ms; staggered by 50ms when multiple nodes complete simultaneously.

**Acceptance Criteria:**
- [ ] Background fill transitions from neutral to accent in 150ms on `complete` state
- [ ] Checkmark scales from `scale(0)` to `scale(1)` with the spring curve over 150ms
- [ ] Stagger delay is 50ms × node index when ≥ 2 nodes complete in the same render cycle
- [ ] Respects `prefers-reduced-motion`: instant state change, no animation

---

### ISSUE-164: Toast component — slideToast from right, 300ms spring, auto-dismiss 4s, accessible role=status
**Type:** task  **Labels:** ui P2 S
**Epic:** ISSUE-160  **Depends on:** —

Build a `<Toast>` component and a `useToast()` hook that renders toasts sliding in from the right edge with a 300ms spring animation and auto-dismisses after 4 seconds. Multiple toasts stack vertically with 8px gap. The toast container has `role="status"` and `aria-live="polite"`.

**Acceptance Criteria:**
- [ ] Slide-in uses `transform: translateX(110%)` → `translateX(0)` over 300ms spring
- [ ] Auto-dismiss timer resets if the user hovers over the toast
- [ ] Toast container mounted at document root via portal to avoid z-index conflicts
- [ ] Variants: `success` (green), `error` (red), `info` (accent) with corresponding icon

---

### ISSUE-165: Skeleton loaders — shimmer gradient on card placeholders during all async states
**Type:** task  **Labels:** ui P2 S
**Epic:** ISSUE-160  **Depends on:** —

Create a reusable `<Skeleton>` component with a moving shimmer gradient animation (`background: linear-gradient(90deg, ...)` animated via `@keyframes shimmer`). Apply skeleton states to: RecommendationCard, YouTubeCard, MemoryPanel, and RestaurantCard while their data is loading.

**Acceptance Criteria:**
- [ ] `<Skeleton width height className>` renders a rounded rect with 1.5s shimmer cycle
- [ ] Shimmer gradient moves left-to-right using `background-position` animation
- [ ] All four card components render their skeleton variant when in loading state
- [ ] `prefers-reduced-motion`: shimmer animation replaced with static muted background

---

### ISSUE-166: Screen-enter transition on all route changes — fadeUp 400ms
**Type:** task  **Labels:** ui P2 S
**Epic:** ISSUE-160  **Depends on:** —

Implement a `fadeUp` entrance animation (`opacity: 0, translateY(12px)` → `opacity: 1, translateY(0)`) over 400ms that fires on every Next.js App Router page mount. Wrap the root layout's `{children}` in an `<AnimatePresence>` equivalent (CSS class toggle or Framer Motion) triggered by `usePathname()` changes.

**Acceptance Criteria:**
- [ ] Animation fires on initial page load and on every client-side navigation
- [ ] Duration is 400ms, easing is `ease-out`
- [ ] Does not animate on browser back/forward if `prefers-reduced-motion` is set
- [ ] No content layout shift during animation (use `will-change: opacity, transform`)

---

### ISSUE-167: Mobile responsiveness audit — all breakpoints: 375px, 390px, 430px, 768px, no horizontal overflow
**Type:** task  **Labels:** ui P1 M
**Epic:** ISSUE-160  **Depends on:** —

Audit every page and component at 375px, 390px, 430px, and 768px viewport widths using Playwright's `page.setViewportSize`. Document and fix all horizontal overflow, text truncation, and touch-target size (< 44px) violations. Produce a checklist of findings and fixes.

**Acceptance Criteria:**
- [ ] `document.documentElement.scrollWidth <= window.innerWidth` passes at all 4 breakpoints for all 5 routes
- [ ] All interactive elements have min touch target 44×44px
- [ ] ComparisonTable, InstamartCart, and CookingStepCard specifically verified at 375px
- [ ] Playwright script added to CI that asserts no horizontal overflow on key routes

---

### ISSUE-168: Accessibility audit pass 1 — Tab order, ARIA labels, aria-live on PlanningGraph, min contrast
**Type:** task  **Labels:** ui P1 M
**Epic:** ISSUE-160  **Depends on:** —

Run an axe-core automated scan and a manual keyboard-navigation audit across all five main routes. Fix: incorrect tab order on chat input, missing `aria-label` on icon-only buttons, add `aria-live="polite"` to the PlanningGraph status region, and ensure all text meets 4.5:1 contrast ratio in both themes.

**Acceptance Criteria:**
- [ ] axe-core scan returns zero violations of level A and AA
- [ ] PlanningGraph container has `aria-live="polite"` and `role="status"`
- [ ] All icon-only buttons (VoiceButton, send, close) have descriptive `aria-label`
- [ ] Contrast ratio verified via `color-contrast` tool for both default and latenight themes

---

### ISSUE-169: Latenight mode activation — situationType='late_night' → theme-latenight class, italic headline
**Type:** task  **Labels:** ui P2 S
**Epic:** ISSUE-160  **Depends on:** —

When the active situation has `situationType === 'late_night'`, add the `theme-latenight` CSS class to `<body>` and render the plan headline in italics with a dimmed accent color. The class is removed when the situation changes or the user navigates away. Latenight theme values are defined in `design-system.css`.

**Acceptance Criteria:**
- [ ] `theme-latenight` class applied to `<body>` only when `situationType === 'late_night'`
- [ ] Class removed on situation change or route navigation
- [ ] Latenight headline font-style is `italic`; accent color shifts to `--accent-latenight`
- [ ] Theme transition uses the 500ms animation from ISSUE-161

---

### ISSUE-170: Empty states — history: first-time message, memory: never empty post-onboarding, pantry: prompt to add items
**Type:** task  **Labels:** ui P2 S
**Epic:** ISSUE-160  **Depends on:** —

Implement contextual empty states for three panels: History shows "Plan your first meal →" with a CTA for new users; Memory panel shows a skeleton-like "Learning about you..." placeholder only during onboarding (never blank after first situation); Pantry shows "Add what's in your kitchen" with an input CTA.

**Acceptance Criteria:**
- [ ] History empty state renders when `situations.length === 0`; includes a primary CTA to start a situation
- [ ] Memory empty state only shown during onboarding (before first situation); replaced by "Learning..." shimmer after
- [ ] Pantry empty state shows an inline text input and an "Add item" button
- [ ] All three empty states tested in Storybook (or equivalent) with a `empty` story variant

---

### ISSUE-171: BUG — Comparison table overflows on mobile at 375px (horizontal scroll or stacked layout below 480px)
**Type:** bug  **Labels:** ui P1 S
**Epic:** ISSUE-160  **Depends on:** —

The `<ComparisonTable>` component renders a fixed-column table that exceeds the viewport width on 375px screens, causing the page to scroll horizontally. At viewports narrower than 480px, switch the table to a stacked card layout where each column becomes a labeled row within a card.

**Acceptance Criteria:**
- [ ] Below 480px, `<ComparisonTable>` renders in stacked-card layout (one card per option)
- [ ] Above 480px, original table layout is preserved
- [ ] Breakpoint controlled by a CSS media query, not JavaScript resize handler
- [ ] `document.documentElement.scrollWidth <= window.innerWidth` passes at 375px (Playwright assertion)

---

## EPIC 11: Testing Infrastructure

### ISSUE-175: Testing Infrastructure Epic
**Type:** epic  **Labels:** testing devops P1 XL
**Epic:** —  **Depends on:** —

End-to-end testing infrastructure: Vitest unit tests, testcontainers API integration tests, Playwright E2E suite, prompt golden-set regression framework, and a GitHub Actions CI pipeline that completes in under 4 minutes. Covers the Decision Engine, Clarification Engine, all API endpoints, and five critical user journeys.

**Acceptance Criteria:**
- [ ] Vitest unit tests cover Decision Engine and Clarification Engine with property-based tests
- [ ] API integration tests run against a real PostgreSQL instance (testcontainers)
- [ ] Playwright E2E tests cover 5 critical journeys against local dev server
- [ ] CI pipeline completes in < 4 minutes end-to-end

---

### ISSUE-176: Vitest setup — vitest.config.ts, test scripts in package.json, coverage thresholds
**Type:** task  **Labels:** testing devops P1 S
**Epic:** ISSUE-175  **Depends on:** —

Set up Vitest as the unit test runner by creating `vitest.config.ts` with TypeScript path alias resolution, jsdom environment for component tests, and coverage via `@vitest/coverage-v8`. Add `test`, `test:watch`, and `test:coverage` scripts to `package.json` with coverage thresholds: 80% lines, 75% branches.

**Acceptance Criteria:**
- [ ] `npm run test` executes all `*.test.ts` files; exits non-zero on failure
- [ ] `npm run test:coverage` generates a coverage report and fails if thresholds not met
- [ ] Path aliases (`@/`) resolved correctly in test files
- [ ] `vitest.config.ts` excludes `e2e/`, `node_modules/`, and `.next/` from test discovery

---

### ISSUE-177: Decision Engine full unit test suite — 30 test cases, 8 property-based invariants via fast-check
**Type:** task  **Labels:** testing decision-engine P1 L
**Epic:** ISSUE-175  **Depends on:** ISSUE-176

Write 30 unit test cases for the Decision Engine covering all situation type classifications, edge cases (empty stomach at midnight, sick + no cook + no money), and output schema validation. Add 8 property-based invariants using `fast-check` asserting: output always has ≥ 1 recommendation, confidence is always 0–1, situationType is always a valid enum value.

**Acceptance Criteria:**
- [ ] 30 named test cases organized by situation type; each asserts output shape and key field values
- [ ] 8 `fc.property` tests with generated `SituationInput` objects covering all required fields
- [ ] All 38 tests pass with `npm run test`
- [ ] Coverage for `lib/decision-engine/**` is ≥ 90% lines

---

### ISSUE-178: Clarification Engine unit tests — 8 scenarios for question selection, assumption generation, 3-question cap
**Type:** task  **Labels:** testing clarification P1 M
**Epic:** ISSUE-175  **Depends on:** ISSUE-176

Write 8 unit test scenarios for the Clarification Engine: 3 testing question selection logic (most impactful question is chosen first), 3 testing assumption generation when confidence is high, and 2 testing the 3-question hard cap (4th question is never generated). Each test mocks the Prisma memory read.

**Acceptance Criteria:**
- [ ] 8 named tests in `lib/clarification/__tests__/clarification-engine.test.ts`
- [ ] Question selection tests assert the returned question has the highest `impactScore`
- [ ] Cap tests assert `questions.length <= 3` even when 4+ fields are uncertain
- [ ] Prisma is mocked via `vi.mock`; no real DB calls in unit tests

---

### ISSUE-179: API integration test setup — testcontainers PostgreSQL, test database reset between suites
**Type:** task  **Labels:** testing devops P1 M
**Epic:** ISSUE-175  **Depends on:** ISSUE-176

Configure testcontainers to spin up a PostgreSQL container for API integration tests. Write `tests/integration/setup.ts` that runs Prisma migrations against the container and resets all tables between test suites using `TRUNCATE ... CASCADE`. The container lifecycle is managed in `globalSetup`/`globalTeardown`.

**Acceptance Criteria:**
- [ ] PostgreSQL container starts before the integration suite and stops after
- [ ] All Prisma migrations applied via `prisma migrate deploy` against the test container
- [ ] `beforeEach` in integration tests truncates all application tables in dependency order
- [ ] `DATABASE_URL` for tests is overridden to point to the container; never touches dev DB

---

### ISSUE-180: API integration tests for all 10 endpoints — happy path + key error cases
**Type:** task  **Labels:** testing P1 L
**Epic:** ISSUE-175  **Depends on:** ISSUE-179

Write integration tests for all 10 API endpoints (`/situations`, `/clarify`, `/recommendations`, `/execute`, `/memory`, `/meal-log`, and auth-gated routes). Each endpoint has at minimum: a happy-path test, an unauthenticated 401 test, and the most likely error case (400 or 404).

**Acceptance Criteria:**
- [ ] All 10 endpoints have ≥ 3 integration tests each (30 tests minimum)
- [ ] Every 401 test sends a request with no JWT and asserts `{error: "Unauthorized"}`
- [ ] Happy-path tests assert response shape against Zod schemas
- [ ] Tests run in under 60 seconds with the testcontainer already warm

---

### ISSUE-181: Playwright E2E setup — playwright.config.ts, test user fixtures, local dev server
**Type:** task  **Labels:** testing devops P1 M
**Epic:** ISSUE-175  **Depends on:** —

Configure Playwright with `playwright.config.ts` targeting Chromium only for CI speed. Create a `tests/e2e/fixtures.ts` with a seeded test user (pre-created Clerk test account) and a `globalSetup` that seeds the user's memory facts. The dev server is started via `webServer` config on port 3000.

**Acceptance Criteria:**
- [ ] `npx playwright test` starts the dev server if not running and runs all E2E tests
- [ ] Test user credentials stored in `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` env vars
- [ ] `fixtures.ts` exports a `loggedInPage` fixture that handles Clerk auth before each test
- [ ] Chromium only in CI; config supports adding Firefox/WebKit locally via `--project` flag

---

### ISSUE-182: E2E tests for 5 critical journeys — first-time user, sick+cannot-cook, voice input, Instamart cart, cooking steps
**Type:** task  **Labels:** testing P1 L
**Epic:** ISSUE-175  **Depends on:** ISSUE-181

Write Playwright E2E tests for 5 journeys: (1) first-time user completes onboarding and receives first plan, (2) sick+cannot-cook situation produces delivery-only recommendations, (3) voice input transcription populates situation form, (4) Instamart cart deep link is generated and displayed, (5) cooking steps progress bar reaches 100%.

**Acceptance Criteria:**
- [ ] Each journey is an isolated test file in `tests/e2e/journeys/`
- [ ] Tests use `expect(page).toHaveURL(...)` and `expect(locator).toBeVisible()` assertions
- [ ] Voice input test mocks the browser MediaRecorder API via `page.addInitScript`
- [ ] All 5 journeys pass in CI with `--reporter=github` annotation

---

### ISSUE-183: Prompt golden set regression framework — store 8 input/schema pairs, run on prompt changes, fail on schema break
**Type:** task  **Labels:** testing ai-agents P1 M
**Epic:** ISSUE-175  **Depends on:** ISSUE-176

Create `tests/golden/` with 8 JSON fixtures each containing an agent input and the expected output JSON schema. A Vitest test suite runs each fixture through the agent and validates the output against its schema using Zod. Any schema violation fails the test, alerting developers to prompt regressions.

**Acceptance Criteria:**
- [ ] 8 fixtures cover: 2 delivery plans, 2 cook plans, 1 Dineout, 1 sick scenario, 1 late-night, 1 cook-with-steps
- [ ] Fixtures run against real LLM calls (not mocked); gated behind `RUN_GOLDEN_TESTS=true` env flag
- [ ] Schema validation uses Zod `.safeParse()`; failures include field path and received value in error message
- [ ] Golden tests excluded from standard `npm run test`; run as a separate `npm run test:golden` script

---

### ISSUE-184: CI pipeline configuration — GitHub Actions: typecheck → engine → clarify → API → golden, < 4 min
**Type:** task  **Labels:** devops P1 M
**Epic:** ISSUE-175  **Depends on:** ISSUE-176, ISSUE-177, ISSUE-178, ISSUE-179, ISSUE-180

Create `.github/workflows/ci.yml` with five sequential jobs: (1) TypeScript typecheck, (2) Decision Engine unit tests, (3) Clarification Engine unit tests, (4) API integration tests with testcontainers, (5) E2E smoke test (journey 1 only). Total pipeline target: < 4 minutes.

**Acceptance Criteria:**
- [ ] Pipeline defined in `.github/workflows/ci.yml` and triggered on `push` and `pull_request` to `master`
- [ ] Each job caches `node_modules` and Next.js build cache via `actions/cache`
- [ ] Failure in any job blocks subsequent jobs and posts a PR status check
- [ ] Full pipeline (excluding golden tests) completes in < 4 minutes measured over 3 runs

---

## EPIC 12: Production Hardening

### ISSUE-190: Production Hardening Epic
**Type:** epic  **Labels:** devops P0 XL
**Epic:** —  **Depends on:** —

Production-readiness pass: Sentry error capture, structured agent run logging, LLM cost tracking, rate limiting, Zod input validation on all routes, auth enforcement audit, prompt injection resilience, P95 latency alerting, security headers, and the Neon cold-start fix.

**Acceptance Criteria:**
- [ ] All unhandled exceptions captured in Sentry with source maps
- [ ] Every agent run logged with token counts and latency to `situation_agent_runs`
- [ ] All API routes protected by Clerk auth and validated with Zod
- [ ] Situation-to-plan P95 latency stays below 6000ms under normal load

---

### ISSUE-191: Sentry integration — Next.js SDK, error capture + performance tracing, source maps
**Type:** task  **Labels:** devops P0 M
**Epic:** ISSUE-190  **Depends on:** —

Install and configure `@sentry/nextjs` with `sentry.client.config.ts`, `sentry.server.config.ts`, and `sentry.edge.config.ts`. Enable performance tracing with 10% sample rate in production, 100% in staging. Configure source map upload in `next.config.ts` so stack traces in Sentry show original TypeScript lines.

**Acceptance Criteria:**
- [ ] Unhandled exceptions in API routes appear in Sentry within 30 seconds
- [ ] Source maps uploaded during `npm run build`; Sentry frames show `.ts` file paths
- [ ] Performance traces visible in Sentry for all API route handlers
- [ ] `SENTRY_DSN` and `SENTRY_AUTH_TOKEN` documented in `.env.example`

---

### ISSUE-192: situation_agent_runs table and logging — migrate from V2 plan, log every agent call with tokens + latency
**Type:** task  **Labels:** devops ai-agents P1 M
**Epic:** ISSUE-190  **Depends on:** —

Create a Prisma migration adding `situation_agent_runs` table with columns: `id`, `situationId`, `agentName`, `model`, `inputTokens`, `outputTokens`, `latencyMs`, `createdAt`. Instrument every agent invocation to insert a row after completion using a shared `logAgentRun()` helper.

**Acceptance Criteria:**
- [ ] Migration creates the table with proper foreign key to `situations(id) ON DELETE CASCADE`
- [ ] `logAgentRun({situationId, agentName, model, inputTokens, outputTokens, latencyMs})` helper exported from `lib/logging/agent-runs.ts`
- [ ] All 4 agents (Conversation, Planning, Tool, Memory) call `logAgentRun` on every invocation
- [ ] Helper is fire-and-forget (no `await`); logging failure never blocks agent execution

---

### ISSUE-193: LLM cost tracking — sum input_tokens + output_tokens per situation, store in situations.llm_cost_usd
**Type:** task  **Labels:** devops P1 M
**Epic:** ISSUE-190  **Depends on:** ISSUE-192

Add `llmCostUsd` column to the `situations` table. After each situation reaches `plan_ready`, compute total LLM cost by summing all `situation_agent_runs` rows for that situation using model-specific pricing constants and update `situations.llm_cost_usd`. Expose the per-situation cost in admin logs.

**Acceptance Criteria:**
- [ ] Pricing constants defined in `lib/pricing/llm-costs.ts` for claude-sonnet and claude-haiku models
- [ ] Cost computed as `(inputTokens * inputPricePerToken) + (outputTokens * outputPricePerToken)`
- [ ] `situations.llm_cost_usd` updated via a single `prisma.situation.update()` after `plan_ready`
- [ ] Unit test: known token counts → expected USD cost within 0.000001 tolerance

---

### ISSUE-194: Rate limiting — 60 req/min general, 10/min POST /situations, 20/min POST /clarify
**Type:** task  **Labels:** devops P0 M
**Epic:** ISSUE-190  **Depends on:** —

Implement rate limiting middleware using Upstash Redis (or in-memory `lru-cache` as fallback for local dev). Apply three tiers: 60 req/min per IP for all routes, 10 req/min per user for `POST /api/situations`, 20 req/min per user for `POST /api/clarify`. Exceeded limits return 429 with `Retry-After` header.

**Acceptance Criteria:**
- [ ] 429 response includes `{error: "Rate limit exceeded", retryAfterSeconds: N}` and `Retry-After: N` header
- [ ] Rate limit keys are `ip:{ip}` for general and `user:{userId}:{route}` for per-user limits
- [ ] Upstash Redis used when `UPSTASH_REDIS_URL` env var is set; in-memory fallback otherwise
- [ ] Integration test confirms 11th `POST /situations` request within 60s returns 429

---

### ISSUE-195: Zod input validation on all API routes — request body + query params, typed 400 errors
**Type:** task  **Labels:** devops P0 M
**Epic:** ISSUE-190  **Depends on:** —

Add Zod validation to the request body and query params of all 10 API routes. Extract a shared `validateRequest(schema, data)` helper that returns a typed 400 response with `{error: "Validation failed", issues: ZodIssue[]}` on failure. Ensure TypeScript infers the validated type downstream with no `as` casts.

**Acceptance Criteria:**
- [ ] All 10 routes use `validateRequest()` at the top of the handler, before any business logic
- [ ] 400 response body is `{error: string, issues: Array<{path: string, message: string}>}`
- [ ] No `as unknown as T` or `any` casts after the validation call
- [ ] Integration test: malformed POST body to each route → 400 with `issues[]` array

---

### ISSUE-196: Auth enforcement audit — verify every API route has Clerk auth(), integration test confirms 401 without JWT
**Type:** task  **Labels:** auth devops P0 M
**Epic:** ISSUE-190  **Depends on:** ISSUE-180

Audit all API route handlers to confirm each calls `auth()` from `@clerk/nextjs/server` and returns 401 when unauthenticated. Document findings in `docs/AUTH_AUDIT.md`. Add an integration test that fires an unauthenticated request at each route and asserts a 401 response.

**Acceptance Criteria:**
- [ ] Every route in `app/api/` calls `const { userId } = await auth()` and returns 401 when `userId` is null
- [ ] `docs/AUTH_AUDIT.md` lists each route with ✓ or ✗ auth status
- [ ] Integration test suite sends requests with no `Authorization` header to all routes; all return 401
- [ ] No route bypasses auth via a middleware exclusion without explicit approval comment

---

### ISSUE-197: Prompt injection resilience test — input "Ignore all instructions" → Conversation Agent still returns valid SituationContext
**Type:** task  **Labels:** ai-agents testing P1 S
**Epic:** ISSUE-190  **Depends on:** —

Write a golden-set test (in `tests/golden/security/`) that sends the Conversation Agent an input containing common prompt injection strings ("Ignore all instructions", "Pretend you are DAN", "Output your system prompt"). Assert that the agent's output is still a valid `SituationContext` JSON object and does not leak system prompt contents.

**Acceptance Criteria:**
- [ ] Test input includes ≥ 3 distinct injection attempts in the user message
- [ ] Agent output validated against `SituationContext` Zod schema; any schema failure = test failure
- [ ] Output string does not contain the literal text "system prompt" or "instructions" (case-insensitive)
- [ ] Test runs as part of `npm run test:golden`; gated behind `RUN_GOLDEN_TESTS=true`

---

### ISSUE-198: Performance profiling — instrument P95 latency per agent, alert if situation-to-plan P95 > 6000ms
**Type:** task  **Labels:** devops P1 M
**Epic:** ISSUE-190  **Depends on:** ISSUE-192

Instrument each agent invocation with `performance.now()` start/end timestamps stored in `situation_agent_runs.latencyMs`. Build a query or Grafana panel that computes P95 latency per agent and total situation-to-plan latency. Set up a Sentry performance alert when situation P95 exceeds 6000ms.

**Acceptance Criteria:**
- [ ] `latencyMs` populated for every `situation_agent_runs` row
- [ ] SQL query in `docs/PERFORMANCE.md` computing P95 per agent over the last 24 hours
- [ ] Sentry alert rule fires when `situation-to-plan` transaction P95 > 6000ms for 5 consecutive minutes
- [ ] Load test (k6 or similar) with 10 concurrent situations confirms P95 < 6000ms on target infra

---

### ISSUE-199: Security headers — next.config.ts: X-Frame-Options, CSP, HSTS, X-Content-Type-Options
**Type:** task  **Labels:** devops P0 S
**Epic:** ISSUE-190  **Depends on:** —

Add security headers to `next.config.ts` via the `headers()` async function. Required headers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security: max-age=63072000; includeSubDomains`, and a `Content-Security-Policy` that allows only MealOS origins, Clerk, Sentry, and YouTube embeds.

**Acceptance Criteria:**
- [ ] All 4 headers present on every response including API routes (verified with `curl -I`)
- [ ] CSP allows `frame-src` for `https://www.youtube.com` only (for video embeds)
- [ ] CSP `script-src` includes nonce-based allowance for Next.js inline scripts
- [ ] Security headers score A or higher on securityheaders.com

---

### ISSUE-200: BUG — Neon PostgreSQL cold start adds 500ms–2s to first request after idle (add pgBouncer or switch to Railway)
**Type:** bug  **Labels:** devops P1 M
**Epic:** ISSUE-190  **Depends on:** —

Neon's serverless PostgreSQL suspends compute after 5 minutes of inactivity, causing the first query after an idle period to wait 500ms–2s for the instance to resume. This causes P99 latency spikes on the first user request after quiet periods. Evaluate and implement pgBouncer connection pooling on Neon, or migrate to a Railway dedicated PostgreSQL instance that does not cold-start.

**Acceptance Criteria:**
- [ ] Cold-start latency (time-to-first-query after 10 min idle) measured before and after fix
- [ ] After fix, cold-start P99 is < 300ms (target) or provisioned instance has no cold-start at all
- [ ] Connection pool size configured for Next.js serverless (max 10 connections per region)
- [ ] Decision and implementation details documented in `docs/ARCHITECTURE_DECISIONS.md` as a new ADR
