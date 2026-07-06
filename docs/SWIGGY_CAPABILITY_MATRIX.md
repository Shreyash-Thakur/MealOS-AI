# Swiggy MCP Capability Matrix

**Project:** MealOS AI  
**Last Updated:** 2026-07-06  
**Status:** Reference document. Capabilities marked `[VERIFY WITH SWIGGY MCP DOCS]` where tool existence or behavior is unconfirmed. Do not implement unverified capabilities without validating against Swiggy's partner documentation.  
**Related files:** `docs/SWIGGY_MCP.md` (implementation reference), `lib/mcp/swiggy.ts` (client)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Capability Matrix](#2-capability-matrix)
3. [MealOS Integration Architecture](#3-mealos-integration-architecture)
4. [OAuth Flow](#4-oauth-flow)
5. [Limitations and Constraints](#5-limitations-and-constraints)
6. [Fallback Behavior](#6-fallback-behavior)
7. [V2 Roadmap](#7-v2-roadmap)

---

## 1. Overview

Swiggy MCP (Model Context Protocol) is Swiggy's developer integration layer — part of the Swiggy Builders Club / Swiggy for Developers program — that exposes Swiggy's platform capabilities as named, schema-typed tools callable by AI agents. Instead of constructing HTTP requests against a REST API, an AI agent calls `swiggy_search_restaurants` with typed arguments and receives a structured JSON response; the MCP server handles request translation, authentication, normalization, and delivery. MealOS connects to the Swiggy MCP server through a singleton `SwiggyMCPClient` instance initialized at server startup (`lib/mcp/swiggy.ts`). All MCP calls originate from the Tool Agent (`lib/agents/tool.ts`), which acts as the sole intermediary between MealOS's agent pipeline and the Swiggy platform — the Planning Agent reasons about food and scores paths, but never touches the MCP directly. This indirection keeps Swiggy's API schemas out of the Planning Agent's context, centralizes normalization and error handling in one file, and means that if Swiggy changes a field name or tool signature, only `SwiggyMCPClient.ts` needs to change.

---

## 2. Capability Matrix

**Rating legend — "Swiggy Supports":**
- ✅ Yes — confirmed capability, tool documented in `docs/SWIGGY_MCP.md`
- ⚠️ Partial — capability exists but is limited, behaves differently than described, or relies on Tool Agent logic rather than MCP
- ❓ Unknown — `[VERIFY WITH SWIGGY MCP DOCS]` before implementing
- ❌ No — not available via Swiggy MCP; may exist in REST API or Swiggy app only

**Rating legend — "V1" and "V2":**
- ✅ Used — implemented and called in the given milestone
- 🔜 Planned — intentionally deferred to V2; architecture supports it
- ❌ Not needed — outside MealOS's use cases for that milestone
- ⏭️ Skip — not relevant to MealOS regardless of milestone (handled by Swiggy app, or no product fit)

---

### Food Delivery

| Capability | Swiggy Supports | MealOS Use Case | V1 | V2 | Notes |
|---|---|---|---|---|---|
| 1. Restaurant search by location | ✅ Yes | Core call on every ordering situation. `location: { lat, lng }` passed from user's stored home address or live location. | ✅ Used | ✅ Used | Tool: `swiggy_search_restaurants`. Location is required input, not optional. Falls back to stored address if live location unavailable. |
| 2. Restaurant search by cuisine filter | ✅ Yes | Used when user states a specific cuisine (`"I want biryani"`, `"something Italian"`). Passed as `filters.cuisines[]`. | ✅ Used | ✅ Used | Tool: `swiggy_search_restaurants`. Multi-value array — pass multiple cuisines to match any. Cuisine taxonomy should match Swiggy's internal values `[VERIFY accepted values]`. |
| 3. Restaurant search by vegetarian/vegan filter | ✅ Yes | Pre-applied from user memory when `dietary.restrictions` contains `"vegetarian"` or `"vegan"`. User never manually triggers this. | ✅ Used | ✅ Used | Tool: `swiggy_search_restaurants`. Field: `filters.vegetarianOnly`. Filters to pure-veg restaurants only. Vegan-only filter `[VERIFY — may require additional filter or post-processing]`. |
| 4. Restaurant search by delivery time filter | ✅ Yes | Applied for `quick_meal` situations (`timeConstraintMinutes < 30`) and when user states a time urgency. | ✅ Used | ✅ Used | Tool: `swiggy_search_restaurants`. Field: `filters.maxDeliveryTimeMinutes`. Field name may differ in actual Swiggy MCP `[VERIFY]`. |
| 5. Restaurant search by price range | ⚠️ Partial | Budget-constrained situations (`broke`, stated budget). Min-order filter exists; max item price filter does not. | ✅ Used | ✅ Used | Tool: `swiggy_search_restaurants`. Field: `filters.maxMinOrderValue` (INR). Filters on restaurant minimum order, not on individual item prices. True per-item price range is not supported — the Tool Agent post-filters results by `menuPreview` prices. |
| 6. Menu browsing by restaurant | ✅ Yes | Called after restaurant search when the Planning Agent needs specific items for cart creation or nutrition matching. Not called during search — `menuPreview` in search results handles preview. | ✅ Used | ✅ Used | Tool: `swiggy_get_restaurant_menu`. Returns full categorized menu. Optional `categoryFilter` narrows to a single category. Response includes `lastUpdatedAt` for cache freshness decisions. |
| 7. Menu search by dish name | ❓ Unknown | Would support craving-specific search ("find me dal fry specifically"). Not currently used. | ❌ Not needed | 🔜 Planned | `swiggy_get_restaurant_menu` has `categoryFilter` but not a dish-name search. The top-level `swiggy_search_restaurants` query field may fuzzy-match dish names `[VERIFY — behavior is uncertain]`. Implement in V2 if Swiggy MCP supports it. |
| 8. Dietary filtering on menu items | ✅ Yes | Applied at item level when Planning Agent selects items for cart. `isVeg: boolean` is present per item in menu response. | ✅ Used | ✅ Used | Field: `SwiggyMenuItem.isVeg`. Non-veg items are filtered out before cart creation for vegetarian users. Jain / no-onion-garlic filtering `[VERIFY — likely not a direct MCP field; would require post-processing on item names]`. |
| 9. Cart creation with multiple items | ✅ Yes | Execution step for the order path. Called only when user taps "Order Now" — not during planning. Items and `restaurantId` are stored in `execution_data` during planning. | ✅ Used | ✅ Used | Tool: `swiggy_create_food_cart`. Accepts `restaurantId` + `items[]` with quantity and optional customizations. Returns `cartId`, `deepLink`, `webFallbackUrl`, cart summary, and `expiresAt`. |
| 10. Cart modification (add/remove items) | ❓ Unknown | No MealOS use case for modifying a cart after creation. User modifies inside Swiggy app after tapping the deep link. | ❌ Not needed | ❌ Not needed | No modify-cart tool is documented in Swiggy MCP. If a user wants to change items, they do so inside Swiggy after following the deep link. MealOS regenerates the cart with new items if the user requests a different selection before tapping through. |
| 11. Checkout / order placement | ❌ No | MealOS never places orders on the user's behalf. Checkout and payment happen inside the Swiggy app after the deep link redirect. | ⏭️ Skip | ⏭️ Skip | By design. MealOS is a planning and routing layer, not a payment processor. The cart deep link is the handoff point. Swiggy handles payment, address confirmation, and order confirmation. |
| 12. Offers and discount application | ⚠️ Partial | Offer titles from `SwiggyRestaurant.offers[]` are surfaced in the recommendation display. Whether MCP can pre-apply an offer code at cart creation time is unverified. | ✅ Used | ✅ Used | Offers are displayed to the user (e.g., "30% off up to Rs 75 with NEWUSER"). Pre-application of offer codes at cart creation `[VERIFY — field may exist in swiggy_create_food_cart input]`. In V1, MealOS shows offers for informational value; user applies them inside Swiggy. |
| 13. Real-time order tracking | ❓ Unknown | After the user orders, MealOS could show live delivery status. V2 feature. | ❌ Not needed | 🔜 Planned | Tool: `swiggy_get_order_status(orderId)` `[VERIFY tool exists]`. The `external_order_id` is stored in `user_actions` so it is available when this tool ships. V2 implementation: background worker polls every 60 seconds, publishes status via SSE to the active session. |
| 14. Order history retrieval | ❓ Unknown | V2 memory feature: learn from past orders to improve recommendations (preferred restaurants, repeat orders). | ❌ Not needed | 🔜 Planned | No order history tool is documented. `[VERIFY WITH SWIGGY MCP DOCS]`. If the tool exists and requires OAuth (user account linkage), it would flow through the same auth path as user-specific operations. |

---

### Instamart

| Capability | Swiggy Supports | MealOS Use Case | V1 | V2 | Notes |
|---|---|---|---|---|---|
| 15. Ingredient / product search by name | ✅ Yes | Core to the cook path. The Recipe Agent outputs a `missingIngredients[]` list; the Tool Agent calls this for each item to check availability and price before recommending the cook path. | ✅ Used | ✅ Used | Tool: `swiggy_search_instamart`. Accepts `items: string[]` — searches each independently. Returns `bestMatch` and `alternatives[]` per item. Fuzzy matching behavior `[VERIFY — may be MCP-internal or may require Tool Agent normalization]`. |
| 16. Product search by category | ❓ Unknown | No current use case. MealOS searches by ingredient name, not by browsing a grocery category. | ❌ Not needed | ⏭️ Skip | No category-browse tool is documented. `[VERIFY WITH SWIGGY MCP DOCS]`. Even if available, MealOS has no UI for Instamart category browsing — the ingredient-to-cart flow is fully automated. |
| 17. Inventory availability check | ✅ Yes | Determines whether the cook path is viable. If key ingredients are out of stock with no substitutes, the cook path is deprioritized in scoring. | ✅ Used | ✅ Used | Field: `InstamartSearchedItem.bestMatch.inStock`. Also: `deliveryAreaServiceable` on the overall response. If `deliveryAreaServiceable: false`, Instamart is unavailable for the user's location and the cook path is flagged accordingly. |
| 18. Product substitution suggestions | ⚠️ Partial | When `bestMatch.inStock` is false, Swiggy returns `alternatives[]`. The Tool Agent applies substitution logic: try `alternatives[0]` first, then mark as unavailable. The logic lives in the Tool Agent, not the MCP. | ✅ Used | ✅ Used | Field: `InstamartSearchedItem.alternatives[]`. MCP returns alternatives sorted by relevance `[VERIFY sort order]`. Tool Agent substitution priority: `bestMatch` (in stock) → `alternatives[0]` → mark unavailable. Substitutions are disclosed to the user before cart creation. |
| 19. Instamart cart creation | ✅ Yes | Execution step for the cook path. Called when user taps "Add to Instamart." Items and IDs from a prior `swiggy_search_instamart` call are stored in `execution_data` during planning. | ✅ Used | ✅ Used | Tool: `swiggy_create_instamart_cart`. Accepts `items[]: { itemId, quantity }` and `location`. Returns `cartId`, `deepLink`, `webFallbackUrl`, cart summary, `unavailableItems[]`, and `expiresAt`. Partial cart creation (some items unavailable) is handled — see Section 6. |
| 20. Instamart checkout | ❌ No | Same as food delivery: checkout and payment happen in the Swiggy app after the deep link redirect. | ⏭️ Skip | ⏭️ Skip | By design. MealOS is the planning layer; Swiggy is the checkout layer. |
| 21. Delivery ETA for specific location | ✅ Yes | Shown in the cook path recommendation: "Ingredients delivered in ~14 min." Used to sequence the YouTube "start watching" suggestion while waiting. | ✅ Used | ✅ Used | Field: `SwiggySearchInstamartOutput.estimatedDeliveryMinutes`. Slot-based delivery (some cities during peak hours) returns a `deliverySlots[]` array instead `[VERIFY field structure]`. MealOS selects the earliest available slot automatically. |

---

### Dineout

| Capability | Swiggy Supports | MealOS Use Case | V1 | V2 | Notes |
|---|---|---|---|---|---|
| 22. Restaurant discovery for occasions | ✅ Yes | Called for `date_planning`, `family_dinner`, `party_hosting`, and explicit dineout intent. `occasion` field guides ranking toward ambience, child-friendliness, or quiet service accordingly. | ✅ Used | ✅ Used | Tool: `swiggy_search_dineout`. Occasion values: `'date' \| 'family' \| 'business' \| 'casual' \| 'celebration'`. Budget, cuisine, date, and `maxDistanceKm` are also filterable. Returns venue list with `hasAvailability` field (null until availability is checked). |
| 23. Table availability check | ✅ Yes | Always called for the top 2 venues before surfacing options to the user. MealOS never shows a Dineout venue without confirming at least one slot exists. | ✅ Used | ✅ Used | Tool: `swiggy_get_dineout_availability`. Requires `venueId`, `date`, `partySize`. Returns `DineoutTimeSlot[]` with `slotId`, `time`, and `available`. Cache TTL: 5 minutes (slots fill fast). See `docs/SWIGGY_MCP.md` Section 4 for the caching implementation. |
| 24. Reservation creation | ✅ Yes | Execution step for the dineout path. Called when user taps "Book Table." `slotId` is either user-selected or auto-selected (earliest available). | ✅ Used | ✅ Used | Tool: `swiggy_create_dineout_reservation`. Requires `venueId`, `slotId`, `partySize`, and guest contact info (name, phone). Returns `reservationId`, `confirmationCode` (shown at venue), `status` (`confirmed` or `pending`), deep link, and optional `cancellationDeadline`. |
| 25. Reservation modification / cancellation | ❓ Unknown | V2 feature. Users should be able to cancel a booking from within MealOS. | ❌ Not needed | 🔜 Planned | Tool: `swiggy_cancel_dineout_reservation` `[VERIFY tool exists]`. The `reservationId` is stored in `user_actions.external_order_id` so it is available when this ships. Modification (reschedule) may require cancel + rebook. |
| 26. Pre-meal menu browsing (Dineout) | ❓ Unknown | V2 feature. Browse and pre-select dishes before arriving at the venue. | ❌ Not needed | 🔜 Planned | No dedicated Dineout menu tool is documented. The standard `swiggy_get_restaurant_menu` may work if Swiggy uses the same restaurant ID for food delivery and Dineout `[VERIFY — IDs may differ across services]`. |
| 27. Dineout loyalty points | ❓ Unknown | No current use case. MealOS does not display or manage Swiggy's loyalty program points. | ⏭️ Skip | ⏭️ Skip | No tool documented. `[VERIFY WITH SWIGGY MCP DOCS]`. Even if available, surfacing loyalty points would require significant additional UI — out of scope for MealOS's planning-focused design. |

---

### Swiggy One / Membership

| Capability | Swiggy Supports | MealOS Use Case | V1 | V2 | Notes |
|---|---|---|---|---|---|
| 28. Membership status check | ❓ Unknown | V2 feature. If the user has Swiggy One, the Decision Engine should adjust delivery cost estimates to Rs 0, improving the order path score in budget-sensitive situations. | ❌ Not needed | 🔜 Planned | Tool: `swiggy_check_user_membership(userId)` `[VERIFY tool exists]`. Requires OAuth user linkage. V1 workaround: ask at onboarding ("Do you have Swiggy One?") and store as `user_memory_facts["swiggy.has_one_membership"]`. |
| 29. Free delivery benefit application | ❓ Unknown | Flows from membership check. If Swiggy One is confirmed, delivery cost in cart summary should be Rs 0 or discounted. | ❌ Not needed | 🔜 Planned | Dependency: capability 28. If MCP auto-applies the benefit when a linked user creates a cart `[VERIFY — behavior may be automatic]`, no additional tool call is needed. |
| 30. Discount benefit application | ❓ Unknown | Swiggy One discounts (e.g., 10–20% off partner restaurants) affect the total order cost shown in the Decision Engine comparison. | ❌ Not needed | 🔜 Planned | Dependency: capability 28. Discount amounts and eligible restaurants `[VERIFY WITH SWIGGY MCP DOCS — Swiggy One benefits vary by tier and city]`. V2 Budget Agent would factor these into cost scoring. |

---

### Cross-Service

| Capability | Swiggy Supports | MealOS Use Case | V1 | V2 | Notes |
|---|---|---|---|---|---|
| 31. User authentication (OAuth) | ⚠️ Partial | V1 uses API key for server-to-server calls (restaurant search, Instamart search, Dineout search). OAuth is needed for user-specific operations (cart linked to Swiggy account, order history). | ✅ Used | ✅ Used | V1: API key auth via `SWIGGY_MCP_API_KEY` — covers all read and anonymous cart operations. V2: OAuth 2.0 for user-linked operations (order history, Swiggy One check). See Section 4 for the full OAuth flow. `[VERIFY auth requirements per capability]`. |
| 32. Saved addresses retrieval | ❓ Unknown | Could improve location UX: pre-populate delivery address from user's Swiggy addresses instead of asking. | ❌ Not needed | ❓ Unknown | No tool documented. `[VERIFY WITH SWIGGY MCP DOCS]`. Requires OAuth (user account linkage). MealOS V1 uses the address stored in `user_memory_facts["location.home"]` from onboarding — sufficient for V1. |
| 33. Swiggy wallet balance | ❓ Unknown | No current use case. MealOS does not handle payments and has no reason to display wallet balance. | ⏭️ Skip | ⏭️ Skip | No tool documented. `[VERIFY WITH SWIGGY MCP DOCS]`. Even if available, displaying Swiggy wallet balance is outside MealOS's planning-focused scope. |
| 34. Push notifications for order updates | ❓ Unknown | V2 feature. After a food delivery order, Swiggy may send push notifications natively. MealOS would suppress its own delivery reminders to avoid double-notifying. | ❌ Not needed | 🔜 Planned | No MCP tool documented for querying Swiggy's push notification behavior. `[VERIFY WITH SWIGGY MCP DOCS]`. V2 implementation: after `swiggy_create_food_cart` execution, check if Swiggy will handle push; if not, MealOS schedules a BullMQ reminder. |
| 35. Webhook callbacks | ❓ Unknown | V2 feature. Real-time order status updates pushed to MealOS rather than polled. Would enable live order tracking without periodic MCP calls. | ❌ Not needed | 🔜 Planned | No webhook endpoint schema documented. `[VERIFY WITH SWIGGY MCP DOCS — Swiggy partner program likely gates webhook access]`. V2 implementation would require a registered callback URL and secure validation of incoming Swiggy events. |

---

## 3. MealOS Integration Architecture

All Swiggy MCP calls originate from the Tool Agent (`lib/agents/tool.ts`) via `SwiggyMCPClient` (`lib/mcp/swiggy.ts`). The Planning Agent never calls MCP directly. This section shows the exact tool call sequence for each major MealOS workflow.

### Workflow 1: Order Recommendation (Food Delivery)

Triggered when the Decision Engine scores the `order` path highest.

```
User situation (e.g., "sick, too tired to cook")
    │
    ▼
ConversationAgent extracts: { situationType: 'sick', canCook: false, ... }
    │
    ▼
Decision Engine pre-scores: order path is viable
    │
    ▼
ToolAgent (claude-haiku-4-5) runs the following in parallel:
    │
    ├── swiggy_search_restaurants({
    │       query: "comfort food soup khichdi",
    │       location: { lat: 19.0596, lng: 72.8295 },
    │       filters: {
    │           vegetarianOnly: true,          // from user memory
    │           maxDeliveryTimeMinutes: 45,
    │           maxMinOrderValue: 200,
    │           minRating: 3.5,
    │       },
    │       limit: 8,
    │   })
    │   → SwiggyRestaurant[]
    │
    └── [Dineout and Instamart tools skipped — sick + canCook: false]
    │
    ▼
ToolAgent normalizes → MealOSRestaurant[]
    │
    ▼
PlanningAgent (claude-sonnet-4-6) receives:
    - preCalculatedScores: { order: 84, cook: 0, dineout: 12 }
    - swiggyResults.restaurants: MealOSRestaurant[]
    │
    ▼
PlanningAgent selects top restaurant and calls (via ToolAgent):
    │
    ├── swiggy_get_restaurant_menu({
    │       restaurantId: "rms_36291",
    │       categoryFilter: "Soups",          // only if nutrition context exists
    │   })
    │   → SwiggyMenuCategory[]
    │
    ▼
PlanningAgent selects specific menu items
    │
    ▼ [User taps "Order Now"]
    │
    ├── swiggy_create_food_cart({
    │       restaurantId: "rms_36291",
    │       items: [
    │           { menuItemId: "mi_991023", quantity: 1 },  // Dal Khichdi
    │           { menuItemId: "mi_991024", quantity: 1 },  // Palak Khichdi
    │       ],
    │   })
    │   → { cartId, deepLink, webFallbackUrl, summary, expiresAt }
    │
    ▼
MealOS returns deep link to user
User is redirected to Swiggy app / web with cart pre-filled
```

**Key constraint:** `swiggy_create_food_cart` is called only on user execution, not during planning. The `restaurantId` and `items[]` are stored in `recommendations.swiggy_data` (JSONB) and used at execution time.

---

### Workflow 2: Instamart Cart for Cooking (Cook Path)

Triggered when the Decision Engine scores the `cook` path highest and the recipe requires ingredients not in the user's pantry.

```
Recipe selected: "Paneer Bhurji + Rajma + Brown Rice"
    │
    ▼
Pantry check (database query) identifies missing ingredients:
    missingIngredients = ["onion", "tomatoes", "ginger-garlic paste"]
    │
    ▼
ToolAgent calls:
    │
    ├── swiggy_search_instamart({
    │       items: [
    │           "onion 2 pcs",
    │           "tomatoes 3 pcs",
    │           "ginger garlic paste 50g",   // normalized: removed "fresh", hyphens
    │       ],
    │       location: { lat: 19.0596, lng: 72.8295 },
    │       maxPricePerItemInr: 200,
    │   })
    │   → InstamartSearchedItem[] (one per ingredient)
    │
    ▼
ToolAgent applies substitution logic per item:
    - onion: bestMatch found (inStock: true) → use bestMatch
    - tomatoes: bestMatch found (inStock: true) → use bestMatch
    - ginger-garlic paste: bestMatch.inStock: false → use alternatives[0]
    │
    ▼
ToolAgent returns MealOSInstamartItem[] to PlanningAgent
    │
    ▼
Recommendation displayed:
    "Instamart: 3 items · Rs 87 · ~14 min delivery"
    [Add to Instamart] [Edit items]
    │
    ▼ [User taps "Add to Instamart"]
    │
    ├── swiggy_create_instamart_cart({
    │       items: [
    │           { itemId: "im_10045", quantity: 2 },   // onion (resolved ID)
    │           { itemId: "im_22301", quantity: 3 },   // tomatoes
    │           { itemId: "im_30019", quantity: 1 },   // substitute paste
    │       ],
    │       location: { lat: 19.0596, lng: 72.8295 },
    │   })
    │   → { cartId, deepLink, webFallbackUrl, summary, unavailableItems[], expiresAt }
    │
    ▼
If unavailableItems[] is non-empty:
    User sees: "5 of 8 ingredients added. Ginger garlic paste unavailable
    — pick it up locally or skip."
    │
    ▼
MealOS returns deep link to user
User is redirected to Swiggy Instamart with cart pre-filled
```

**Key constraint:** The Instamart item IDs from `swiggy_search_instamart` are stored in `recommendations.instamart_items` (JSONB) during planning and used at cart creation time. The search is never repeated at execution.

---

### Workflow 3: Dineout Reservation

Triggered when the Decision Engine scores the `dineout` path highest (e.g., `date_planning` with budget > Rs 1000/person).

```
User situation: "planning a date night in Bandra, budget Rs 3000"
    │
    ▼
ConversationAgent extracts:
    { situationType: 'date_planning', budget: 3000, guests: 2, location: 'Bandra' }
    │
    ▼
ToolAgent calls:
    │
    ├── swiggy_search_dineout({
    │       location: { lat: 19.0596, lng: 72.8295 },
    │       occasion: 'date',
    │       partySize: 2,
    │       budgetPerPersonInr: 1500,          // 3000 / 2
    │       cuisines: [],                       // no cuisine preference stated
    │       date: "today",
    │       limit: 6,
    │   })
    │   → DineoutVenue[] (6 venues, hasAvailability: null)
    │
    ▼
ToolAgent checks availability for top 2 venues (parallel calls):
    │
    ├── swiggy_get_dineout_availability({
    │       venueId: "do_88231",               // Trattoria Cielo
    │       date: "2026-07-06",
    │       partySize: 2,
    │   })
    │   → { slots: [{ slotId: "slot_001", time: "7:30 PM", available: true }, ...] }
    │
    ├── swiggy_get_dineout_availability({
    │       venueId: "do_91044",               // Bastian Bandra
    │       date: "2026-07-06",
    │       partySize: 2,
    │   })
    │   → { slots: [{ slotId: "slot_011", time: "8:00 PM", available: true }, ...] }
    │
    ▼
ToolAgent returns MealOSDineoutVenue[] with availableSlots populated
    │
    ▼
PlanningAgent selects top venue (Trattoria Cielo, rating 4.6, "candlelit", "romantic")
Recommendation displayed with available time slots
    │
    ▼ [User selects "7:30 PM" and taps "Book Table"]
    │
    ├── swiggy_create_dineout_reservation({
    │       venueId: "do_88231",
    │       slotId: "slot_001",
    │       partySize: 2,
    │       guest: {
    │           name: "Shreyash",              // from user profile
    │           phone: "+91-XXXXXXXXXX",       // from user profile
    │       },
    │       specialRequests: "window seat preferred",  // optional
    │   })
    │   → { reservationId, confirmationCode: "SW-24819", status: "confirmed",
    │         deepLink, cancellationDeadline }
    │
    ▼
MealOS shows ExecutionCard:
    "Table booked at Trattoria Cielo — 7:30 PM · 2 guests
    Confirmation: SW-24819
    [View in Swiggy]"
```

**Key constraint:** If `SLOT_TAKEN` error is returned at reservation time, MealOS immediately re-fetches availability for the same venue and presents the next available slot. If the venue is fully booked, MealOS re-runs `swiggy_search_dineout` for alternative venues.

---

## 4. OAuth Flow

MealOS uses two authentication modes with Swiggy MCP:

- **API Key (V1 and V2):** Server-to-server. Used for all anonymous operations: restaurant search, Instamart search, Dineout search, and anonymous cart creation. The API key is provisioned through Swiggy's partner portal `[VERIFY — Swiggy Builders Club enrollment required]` and stored in Doppler / Vercel Environment Variables as `SWIGGY_MCP_API_KEY`. Never committed to the repository.

- **OAuth 2.0 (V2):** User-specific operations: order history retrieval, Swiggy One membership check, cart linked to user's Swiggy account. The OAuth flow below is the V2 plan `[VERIFY scope names and endpoint URLs WITH SWIGGY MCP DOCS]`.

---

### OAuth 2.0 Flow (V2 Design)

```
Step 1: MealOS initiates authorization
    MealOS backend generates a state token and redirects the user's browser to:
    https://accounts.swiggy.com/oauth/authorize
        ?client_id=MEALOS_CLIENT_ID
        &redirect_uri=https://mealos.ai/api/v1/auth/swiggy/callback
        &response_type=code
        &scope=food.search food.cart instamart.search instamart.cart
               dineout.search dineout.book orders.read membership.read
        &state=<csrf_token>
    [VERIFY: endpoint URL, scope names, and available scopes WITH SWIGGY MCP DOCS]

Step 2: User sees Swiggy OAuth consent screen
    Swiggy shows the user which permissions MealOS is requesting.
    User must be logged in to Swiggy to proceed.

Step 3: User grants permission
    User taps "Allow" on the Swiggy consent screen.

Step 4: Swiggy redirects to MealOS callback with authorization code
    GET https://mealos.ai/api/v1/auth/swiggy/callback
        ?code=<authorization_code>
        &state=<csrf_token>
    MealOS backend validates that the state token matches the one issued in Step 1.

Step 5: MealOS exchanges code for access + refresh tokens
    POST https://accounts.swiggy.com/oauth/token [VERIFY]
        client_id=MEALOS_CLIENT_ID
        client_secret=MEALOS_CLIENT_SECRET
        grant_type=authorization_code
        code=<authorization_code>
        redirect_uri=https://mealos.ai/api/v1/auth/swiggy/callback
    Response: { access_token, refresh_token, expires_in, scope }

Step 6: Tokens stored securely server-side
    - access_token: stored in the database encrypted, associated with user_id
    - refresh_token: stored separately, server-side only
    - NEVER sent to the client browser (no localStorage, no cookies with JavaScript access)
    - expires_in: stored as an absolute timestamp for expiry detection

Step 7: Access token used for user-specific Swiggy operations
    The SwiggyMCPClient includes the access_token in MCP tool calls that require
    user context (order history, membership check, user-linked cart).
    Non-user-specific calls (restaurant search, Instamart search) continue to use
    the API key — no OAuth required.

Step 8: Refresh token used when access token expires
    SwiggyMCPClient detects token expiry (stored timestamp check before each call).
    If expired, automatically calls the token refresh endpoint before the MCP call:
    POST https://accounts.swiggy.com/oauth/token [VERIFY]
        grant_type=refresh_token
        refresh_token=<stored_refresh_token>
        client_id=MEALOS_CLIENT_ID
        client_secret=MEALOS_CLIENT_SECRET
    New access_token and refresh_token are stored, replacing the old values.
    The original MCP call then proceeds with the new access_token.
```

### Token Lifetimes (Estimates — `[VERIFY WITH SWIGGY MCP DOCS]`)

| Token | Estimated Lifetime | Notes |
|---|---|---|
| Access token | 1–24 hours `[VERIFY]` | Short-lived by OAuth convention |
| Refresh token | 30–90 days `[VERIFY]` | Long-lived; rotated on each use |
| Authorization code | 5–10 minutes `[VERIFY]` | One-time use; expires quickly |

### Scopes Required Per Capability

| Capability | Required Scope |
|---|---|
| Restaurant search, menu browsing | API key sufficient — no user scope needed |
| Instamart search and cart creation | API key sufficient — no user scope needed |
| Dineout search, availability, reservation | API key sufficient — no user scope needed |
| Order history retrieval | `orders.read` `[VERIFY]` |
| Swiggy One membership check | `membership.read` `[VERIFY]` |
| User-linked cart (cart appears in user's Swiggy history) | `food.cart` or `instamart.cart` `[VERIFY]` |

### Token Refresh Handling

```typescript
// SwiggyMCPClient — token refresh before user-specific calls
async function callWithTokenRefresh<T>(
  toolName: string,
  args: Record<string, unknown>,
  userId: string
): Promise<T> {
  const tokenRecord = await db.getSwiggyToken(userId);

  // Refresh if expired or within 5-minute buffer
  if (Date.now() >= tokenRecord.expiresAt - 5 * 60 * 1000) {
    const refreshed = await refreshSwiggyToken(tokenRecord.refreshToken);
    await db.updateSwiggyToken(userId, refreshed);
    tokenRecord.accessToken = refreshed.accessToken;
  }

  return this.callTool<T>(toolName, args, tokenRecord.accessToken);
}
```

### User Revocation Handling

If a user revokes MealOS's Swiggy access from within Swiggy's account settings:

1. The next API call using that user's access token returns HTTP 401 or an equivalent MCP error.
2. `SwiggyMCPClient` detects the revocation (not a normal expiry — refresh would also fail).
3. The user's Swiggy token record is deleted from the database.
4. MealOS falls back to API-key mode (anonymous operations only).
5. User-specific features (order history, membership check) are silently unavailable until re-authorization.
6. MealOS does NOT prompt the user to re-authorize during a planning session — that would be disruptive. A non-blocking banner is shown in the Memory Panel: "Reconnect your Swiggy account to enable order history and Swiggy One benefits."

---

## 5. Limitations and Constraints

### Geographic Coverage

Swiggy is available in 500+ Indian cities. However, specific service coverage within Swiggy varies:

| Service | Coverage | Notes |
|---|---|---|
| Swiggy Food Delivery | Major metros and Tier-2 cities | Bandra, Koramangala, Cyber City, etc. Rural areas: not serviceable |
| Swiggy Instamart | Select metro areas and expanding `[VERIFY current list]` | Mumbai, Bangalore, Delhi, Hyderabad, Chennai, Pune confirmed. Exact city list: check `deliveryAreaServiceable` field in API response |
| Swiggy Dineout | Major metros only `[VERIFY]` | Typically follows Dineout's existing network, which is denser in Tier-1 cities |
| Swiggy One membership | All Swiggy-active cities | Membership benefits apply where Swiggy Food Delivery operates |

The definitive serviceability check for any given location is the `deliveryAreaServiceable` field in `swiggy_search_instamart` and the presence of results in `swiggy_search_restaurants`. MealOS never hard-codes city lists — it relies on the API response.

### Rate Limits `[VERIFY ALL LIMITS WITH SWIGGY MCP DOCS]`

| Tool | Estimated Limit | Basis |
|---|---|---|
| `swiggy_search_restaurants` | 60 req/min per API key | Assumed; partners likely receive higher limits |
| `swiggy_get_restaurant_menu` | 120 req/min per API key | Read-heavy; assumed higher |
| `swiggy_create_food_cart` | 30 req/min per API key | Write operation; conservative estimate |
| `swiggy_search_instamart` | 60 req/min per API key | Assumed similar to restaurant search |
| `swiggy_create_instamart_cart` | 30 req/min per API key | Write operation |
| `swiggy_search_dineout` | 30 req/min per API key | Lower; reservation systems are slower |
| `swiggy_get_dineout_availability` | 60 req/min per API key | Read-heavy; assumed higher |
| `swiggy_create_dineout_reservation` | 10 req/min per API key | Strict; actual bookings are write operations with side effects |

**At V1 scale (1,000 DAU, ~2 searches per session):** Peak load is approximately 30 restaurant searches per minute, well within limits. Rate limits become a hard constraint above approximately 5,000 DAU without caching.

**Caching strategy:** V1 uses Next.js `unstable_cache` with 15-minute revalidation for restaurant search and 30-minute revalidation for menu data. Redis caching with per-tool TTLs is the V2 plan (see `docs/SWIGGY_MCP.md` Section 6).

### What Swiggy MCP Cannot Do (vs Swiggy REST API)

Based on what is documented, the following operations are not available through MCP and would require the Swiggy REST API or are not available through any API:

- **Payment processing:** MCP cannot initiate or process payments. Checkout always happens in the Swiggy app.
- **Real-time rider tracking (map view):** Live GPS location of the delivery rider. `swiggy_get_order_status` `[VERIFY]` may return status text but not coordinate data.
- **Swiggy POP / cloud kitchen filters:** Filtering specifically for POP outlets vs. regular restaurants `[VERIFY]`.
- **Scheduled delivery:** Scheduling an order for a future time slot via MCP `[VERIFY — may not be exposed]`.
- **Group ordering:** Multiple users contributing to one cart `[VERIFY — Swiggy app feature not confirmed in MCP]`.
- **Restaurant ratings submission:** MCP is read-only for ratings; users submit ratings through the Swiggy app.

### Data Freshness

| Data Type | Update Frequency | Notes |
|---|---|---|
| Restaurant availability (`isOpen`) | Real-time | Checked at search time. A restaurant can close between search and cart creation (RESTAURANT_CLOSED fallback handles this). |
| Menu items and prices | Varies by restaurant; typically daily `[VERIFY]` | `SwiggyGetRestaurantMenuOutput.lastUpdatedAt` field indicates last update. MealOS respects a 30-minute cache ceiling. |
| Instamart stock (`inStock`) | Near real-time | Inventory changes frequently. MealOS uses a 10-minute cache ceiling for Instamart search results. |
| Dineout slot availability | Real-time | Slots fill as other users book. 5-minute cache ceiling with stale-slot invalidation before surfacing to user. |
| Restaurant ratings and metadata | Periodic `[VERIFY — likely daily or weekly batch]` | Not time-critical for MealOS. 15-minute cache is safe. |

### Authentication Requirements by Capability

| Operations | Auth Mode Required |
|---|---|
| Restaurant search, menu browsing, Dineout search | API key — no user login to Swiggy required |
| Instamart search | API key — no user login required |
| Cart creation (food, Instamart) | API key — cart is anonymous unless user's Swiggy account is linked |
| Dineout availability and reservation | API key — guest contact info (name, phone) provided at reservation time |
| Order history, Swiggy One status | OAuth access token — user must authorize MealOS to access their Swiggy account |

---

## 6. Fallback Behavior

MealOS never shows an error screen. Every Swiggy failure has a designed degradation path. The Planning Agent receives a typed `{ available: false, errorCode: string }` result and adapts the recommendation accordingly.

### Failure: Swiggy MCP Fully Unavailable (`SWIGGY_UNAVAILABLE`)

**Detection:** MCP client throws `MCPConnectionError` or request times out after 8 seconds.

**MealOS response:**
1. Tool Agent returns `{ available: false, errorCode: 'SWIGGY_UNAVAILABLE' }` for all Swiggy tools.
2. Decision Engine marks `order` and `dineout` paths as unavailable.
3. If `cook` path is viable (user can cook and pantry is not empty): recommend cook. No error message shown.
4. If `cook` path is also unavailable (user stated `canCook: false`, empty pantry): show manual suggestion with a plain-text shopping list and Google Maps link to nearest grocery store.

**UI:** The Situation Board shows the cook recommendation prominently. No Swiggy results card appears. Dineout option is hidden. No error message. If the cooking path is not viable, a soft message appears: "Delivery options aren't loading right now. Here's what you can do instead."

**Recovery:** Swiggy availability is not retried during the current situation. The next situation triggers a fresh connection attempt.

---

### Failure: Restaurant Search Returns 0 Results

**Detection:** `swiggy_search_restaurants` returns `restaurants: []` or `totalFound: 0`.

**MealOS response:**
1. Widen delivery radius by 10% (increase `maxDistanceKm` or remove distance filter if not set).
2. Remove most-restrictive filter first: `maxMinOrderValue` → `maxDeliveryTimeMinutes` → `minRating` (reduce to 3.0).
3. If results still empty after one retry: remove `cuisines` filter.
4. If still empty: mark `order` path as unavailable and recommend cook or dineout.

**UI:** The user never sees "no results." Either an alternative is found (different filter set) or the recommendation card shows a different path with a brief note: "No delivery options matched your criteria right now — here's the next best option."

---

### Failure: Instamart Unavailable in User's Area (`DELIVERY_AREA_UNAVAILABLE` or `deliveryAreaServiceable: false`)

**Detection:** `swiggy_search_instamart` returns `deliveryAreaServiceable: false` or error code `LOCATION_NOT_SERVICEABLE`.

**MealOS response:**
1. Recipe recommendation still surfaces (cook path is not cancelled).
2. The "Add to Instamart" button is replaced with a plain-text shopping list.
3. The shopping list is formatted for easy use at a nearby grocery store.

**UI:** ExecutionCard shows: "Instamart doesn't deliver to your area. Here's your shopping list." The ingredients are listed with quantities and approximate prices based on Claude's knowledge. No Swiggy UI elements appear.

**Memory:** If the user's stored `location.home` is not serviceable, a non-blocking flag is set for the Memory Panel: "Instamart may not be available at your saved address."

---

### Failure: Instamart Store Closed (`STORE_CLOSED`)

**Detection:** `swiggy_search_instamart` returns `storeOpen: false`.

**MealOS response:** Same as area unavailability — shopping list fallback. Additionally: "Instamart stores near you are closed right now. They typically reopen at 6 AM." `[VERIFY operating hours]`

---

### Failure: Dineout Fully Booked (`NO_AVAILABILITY` or all slots unavailable)

**Detection:** `swiggy_get_dineout_availability` returns no available slots for the top venue, or all top venues return no availability.

**MealOS response:**
1. For the primary venue: auto-expand to next available date ("Tomorrow has availability at 8:00 PM — want to book then?").
2. If user needs tonight specifically: show next 2–3 venues from the original search with their availability.
3. If all nearby venues are fully booked: suggest order path as alternative ("Restaurants near you are fully booked tonight — here's the best delivery option for a date night at home.").

**UI:** "That venue is fully booked tonight. Here are alternatives:" followed by 2–3 venue cards. Or, if expanding to tomorrow: a single venue card with the date clearly shown.

---

### Failure: OAuth Token Expired (V2)

**Detection:** MCP call using access token returns 401 or equivalent. Refresh token is still valid.

**MealOS response:**
1. `SwiggyMCPClient` transparently calls the refresh endpoint.
2. New access token is stored and the original MCP call is retried.
3. The user is unaffected and unaware.

**Detection — Refresh token also invalid (user revoked access):**
1. Delete stored tokens from the database.
2. Fall back to API-key mode (anonymous operations only).
3. User-specific features become unavailable.
4. Non-blocking banner in Memory Panel: "Reconnect your Swiggy account to enable order history and Swiggy One benefits." No pop-up during active planning.

---

### Failure: Rate Limit Hit (`RATE_LIMIT`)

**Detection:** MCP returns HTTP 429 or `RATE_LIMIT_EXCEEDED` error code.

**MealOS response:**
1. Retry with exponential backoff: 500ms → 1000ms → 2000ms (3 attempts maximum).
2. During the backoff, SSE sends `agent_progress` event to the UI: the Planning Graph shows "Finding options for you..." — user sees the system is working, not failing.
3. If all retries are exhausted: treat as `SWIGGY_UNAVAILABLE` and activate the cook-only fallback.

**UI:** No error is surfaced during retry. The Planning Graph shows normal activity. If fallback activates, the cook recommendation appears without explanation of the rate limit.

---

## 7. V2 Roadmap

These capabilities are explicitly not implemented in V1. The architecture — `external_order_id` in `user_actions`, the singleton `SwiggyMCPClient` with configurable auth — is designed to accommodate them without structural changes.

### Order Tracking (Live Status After Placement)

**What it enables:** After a user taps "Order Now" and is redirected to Swiggy, MealOS can show a live delivery tracker on the Situation Board: rider name, ETA updates, "delivered" confirmation.

**Implementation plan:**
- Store the Swiggy order ID in `user_actions.external_order_id` at execution time `[VERIFY: Swiggy MCP returns order ID after cart execution — this may require user to have linked Swiggy account]`.
- V2 background worker (BullMQ) polls `swiggy_get_order_status(orderId)` `[VERIFY tool exists]` every 60 seconds.
- Worker publishes status updates via SSE to the active session.
- UI: "Track Order" card replaces ExecutionCard after ordering. Shows estimated arrival, rider name, and live status.

**Dependency:** Swiggy account linkage via OAuth (to associate the order with the user).

---

### Swiggy One Membership Discount in Decision Engine Scoring

**What it enables:** For users with Swiggy One, delivery cost in order path scoring should be Rs 0 instead of the standard fee. This significantly improves the order path score for budget-sensitive situations, making the recommendations more accurate.

**Implementation plan:**
- During onboarding (or in the Memory Panel), ask: "Do you have Swiggy One?" Store as `user_memory_facts["swiggy.has_one_membership"]`.
- If `[VERIFY]` `swiggy_check_user_membership` tool exists: call it in V2 using OAuth access token and store result in memory facts.
- Decision Engine reads `swiggy.has_one_membership` from user memory and sets `deliveryCostInr: 0` when calculating order path total cost.
- Recommendation card shows: "Free delivery (Swiggy One)" when applicable.

---

### Order History for Preference Learning

**What it enables:** The Memory Agent can learn from past orders — which restaurants the user orders from repeatedly, which cuisines they choose when given options, budget patterns — without relying solely on explicit clarification answers.

**Implementation plan:**
- `swiggy_get_order_history(userId, limit: 20)` `[VERIFY tool exists and scope required]`.
- Memory Agent processes order history during its async run after each situation.
- Facts extracted: `ordering.frequent_restaurants`, `preference.cuisines.liked`, implicit budget from average order values.
- Confidence: 0.6 (behavior-inferred, not user-stated).

**Dependency:** OAuth user linkage (requires user's Swiggy account to be connected).

---

### Push Notifications for Delivery Updates

**What it enables:** After ordering, Swiggy sends native push notifications for order milestones (confirmed, rider picked up, arriving soon). MealOS suppresses its own reminders when Swiggy is handling them, avoiding duplicate notifications.

**Implementation plan:**
- After `swiggy_create_food_cart` execution, query whether Swiggy will send push notifications for this order `[VERIFY — this may not be an MCP-exposed capability]`.
- If Swiggy handles notifications: MealOS skips scheduling BullMQ reminder.
- If Swiggy does not: MealOS schedules a "Your order should arrive soon" notification at `estimatedDeliveryMinutes - 5` minutes.
- Requires BullMQ (not available in V1).

---

### Pre-Meal Dineout Ordering

**What it enables:** For Dineout reservations, users can browse the venue's menu and pre-select dishes before arriving. MealOS could suggest dishes matching the user's nutrition goals or dietary preferences for the occasion.

**Implementation plan:**
- Post-reservation, call `swiggy_get_restaurant_menu` with the Dineout venue's restaurant ID `[VERIFY — IDs may differ between food delivery and Dineout]`.
- Planning Agent filters menu by dietary restrictions and nutrition goals.
- UI: "Pre-order your meal" card below the reservation confirmation. Optional, not surfaced by default.
- Dependency: Confirmation that Dineout venue IDs map to food delivery restaurant IDs, or a dedicated Dineout menu tool `[VERIFY WITH SWIGGY MCP DOCS]`.

---

*End of Swiggy MCP Capability Matrix*

*For implementation details on each confirmed tool, see `docs/SWIGGY_MCP.md`.*  
*For Decision Engine scoring that uses Swiggy data, see `docs/DECISION_ENGINE.md`.*  
*Capabilities marked `[VERIFY WITH SWIGGY MCP DOCS]` must be validated against Swiggy's partner documentation before implementation. Contact the Swiggy Builders Club partner team for API access and documentation.*
