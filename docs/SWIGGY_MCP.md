# Swiggy MCP Integration Guide

**Project:** MealOS AI  
**Last Updated:** 2026-07-06  
**Status:** Authoritative integration reference. Where Swiggy MCP specifics are not yet confirmed, fields are marked `[VERIFY WITH SWIGGY MCP DOCS]`.  
**Target file:** `packages/mcp/src/swiggy/SwiggyMCPClient.ts`

---

## Table of Contents

1. [Overview](#1-overview)
2. [Food Delivery Integration](#2-food-delivery-integration)
3. [Instamart Integration](#3-instamart-integration)
4. [Dineout Integration](#4-dineout-integration)
5. [Error Handling](#5-error-handling)
6. [Rate Limits and Caching](#6-rate-limits-and-caching)
7. [The Tool Agent Wrapper](#7-the-tool-agent-wrapper)
8. [Cart Deep Links](#8-cart-deep-links)
9. [Testing the Integration](#9-testing-the-integration)
10. [V2 Integrations](#10-v2-integrations)

---

## 1. Overview

### What Swiggy MCP Is

The Swiggy MCP (Model Context Protocol) is a structured tool interface that exposes Swiggy's platform capabilities — food delivery, Instamart grocery delivery, and Dineout table reservations — as callable tools for AI agents. Unlike a traditional REST API where the caller constructs HTTP requests, an MCP server exposes a manifest of named tools with typed input/output schemas. The AI agent selects which tool to call based on its reasoning; the MCP runtime handles transport, serialization, and response delivery.

MCP eliminates the need for custom API wrapper code in most cases. The agent calls `swiggy_search_restaurants` with a natural-language `query` field; the MCP server handles translation to Swiggy's internal search API, result normalization, and returning a structured JSON response.

**Key difference from REST:**

| Dimension | REST API | MCP |
|---|---|---|
| Caller | Application code | AI agent |
| Interface | HTTP verbs + URL paths | Named tool calls with typed schemas |
| Discovery | Swagger/OpenAPI docs | `tools/list` manifest (auto-discoverable) |
| Error surface | HTTP status codes | Structured tool error objects |
| Versioning | URL path (`/v2/`) | Tool schema version field |
| Auth | Bearer token in header | Configured at MCP client init |

### MCP Authentication

The Swiggy MCP client is initialized once per server process and shared across all requests. Authentication is configured at initialization time, not per-call.

**Expected auth pattern** `[VERIFY WITH SWIGGY MCP DOCS]`:

```typescript
// Option A: API key (most likely for server-to-server)
const client = new SwiggyMCPClient({
  apiKey: process.env.SWIGGY_MCP_API_KEY,
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'sandbox',
});

// Option B: OAuth2 client credentials flow
const client = new SwiggyMCPClient({
  clientId: process.env.SWIGGY_CLIENT_ID,
  clientSecret: process.env.SWIGGY_CLIENT_SECRET,
  tokenEndpoint: 'https://api.swiggy.com/oauth/token', // [VERIFY]
  scopes: ['food.search', 'instamart.search', 'dineout.search', 'cart.write'],
});
```

The `SWIGGY_MCP_API_KEY` (or equivalent credential) must be provisioned through Swiggy's partner portal `[VERIFY WITH SWIGGY MCP DOCS]` and stored in Doppler / Vercel Environment Variables — never committed to the repository.

Token refresh (for OAuth flows) is handled internally by the MCP client SDK. The application layer does not manage token lifecycle.

### The Tool Agent Pattern

The Planning Agent (`claude-sonnet-4-6`) never calls the Swiggy MCP directly. It calls the MealOS Tool Agent (the "Swiggy Agent," running `claude-haiku-4-5`), which is the sole intermediary between the agent system and the MCP.

```
Planning Agent (claude-sonnet-4-6)
    │
    │  tool_call: { name: "search_food_delivery", args: { query, location, filters } }
    ▼
Tool Agent / Swiggy Agent (claude-haiku-4-5)
    │
    │  MCP tool_call: swiggy_search_restaurants(...)
    ▼
Swiggy MCP Server
    │
    │  JSON response: SwiggyRestaurant[]
    ▼
Tool Agent
    │
    │  normalize to MealOS internal types
    │  handle errors and fallbacks
    ▼
Planning Agent receives: MealOSRestaurant[]
```

**Why this indirection matters:**

1. The Planning Agent's prompt stays clean — it reasons about food, not API schemas.
2. Normalization happens in one place. If Swiggy changes a field name, only `SwiggyMCPClient.ts` changes.
3. The Tool Agent can apply business logic: dietary filter pre-application, budget pre-filtering, result re-ranking.
4. Failure isolation: if Swiggy is down, the Tool Agent returns `{ available: false, error: "SWIGGY_UNAVAILABLE" }` and the Planning Agent adapts — it does not crash.

### Connection Lifecycle

The MCP client is a singleton initialized at server startup. It is not re-initialized per request.

```typescript
// packages/mcp/src/swiggy/client.ts
import { MCPClient } from '@modelcontextprotocol/sdk'; // [VERIFY package name]

let _client: SwiggyMCPClient | null = null;

export function getSwiggyMCPClient(): SwiggyMCPClient {
  if (!_client) {
    _client = new SwiggyMCPClient({
      apiKey: process.env.SWIGGY_MCP_API_KEY!,
      environment: process.env.SWIGGY_MCP_ENV as 'sandbox' | 'production',
      timeout: 8_000,        // 8 second default per call
      maxRetries: 2,
      retryDelay: 500,       // ms, exponential backoff applied
    });
  }
  return _client;
}
```

In Vercel serverless functions, the singleton lives for the duration of the lambda's warm lifecycle. In BullMQ worker processes (Railway), it persists for the process lifetime.

The client maintains a persistent connection to the MCP server `[VERIFY — may be HTTP or WebSocket]`. If the connection drops, the client SDK handles reconnection transparently with exponential backoff.

---

## 2. Food Delivery Integration

### Tool: `swiggy_search_restaurants`

Search for restaurants matching a natural-language description, filtered by location and user preferences.

**When MealOS calls this:** During the planning phase, the Swiggy Agent calls this tool with query terms derived from the Planning Agent's intent (e.g., `"comfort food vegetarian"` for a sick user, `"high protein non-vegetarian"` for a fitness user). Dietary filters from the user's memory profile are pre-applied before the call.

#### Input Schema

```typescript
interface SwiggySearchRestaurantsInput {
  // Natural language description of what the user wants.
  // Examples: "comfort food", "high protein vegetarian", "biryani"
  query: string;

  // User's current location. Falls back to stored home address if omitted.
  location: {
    lat: number;   // e.g., 19.0596
    lng: number;   // e.g., 72.8295
  };

  filters?: {
    // If true, only return restaurants with a vegetarian menu / pure-veg tag.
    // If false, include all. Default: false (show all).
    vegetarianOnly?: boolean;

    // Filter out restaurants where delivery takes longer than this.
    // [VERIFY] — field name may differ in Swiggy MCP
    maxDeliveryTimeMinutes?: number;  // e.g., 45

    // Filter out restaurants where minimum order exceeds this amount (INR).
    maxMinOrderValue?: number;  // e.g., 200

    // Cuisine type filters. Pass multiple to match any.
    // [VERIFY] accepted values — likely matches Swiggy's cuisine taxonomy
    cuisines?: string[];  // e.g., ["North Indian", "Chinese", "Italian"]

    // Rating floor. Restaurants below this rating are excluded.
    minRating?: number;  // e.g., 3.5
  };

  // Maximum number of restaurants to return.
  // Default: 10. Max: 20. [VERIFY]
  limit?: number;
}
```

#### Output Schema

```typescript
interface SwiggyRestaurant {
  id: string;               // Swiggy's internal restaurant ID. Store for cart creation.
  name: string;             // "Haldiram's Minute Khana"
  cuisines: string[];       // ["North Indian", "Sweets"]
  rating: number;           // 4.2
  ratingCount: number;      // 1842 (number of ratings)
  deliveryTimeMinutes: number;  // 28
  minOrderValue: number;    // 149  (INR)
  deliveryCost: number;     // 0 or 30 (INR)
  distanceKm: number;       // 1.4
  isVeg: boolean;           // true = pure veg restaurant
  isOpen: boolean;          // false if currently closed
  imageUrl: string;         // CDN URL for restaurant image

  offers: {
    title: string;          // "50% off up to Rs 100"
    code?: string;          // "SWIGGY50"
    minOrderValue?: number;
  }[];

  // Top 3-5 menu items for preview purposes. Full menu requires swiggy_get_restaurant_menu.
  menuPreview: {
    id: string;
    name: string;
    price: number;          // INR
    isVeg: boolean;
    imageUrl?: string;
  }[];

  // [VERIFY] — availability of this field depends on Swiggy MCP response
  tags?: string[];          // ["bestseller", "fast delivery", "new"]
}

// swiggy_search_restaurants returns:
interface SwiggySearchRestaurantsOutput {
  restaurants: SwiggyRestaurant[];
  totalFound: number;       // total matching before limit applied
  searchId: string;         // opaque token for pagination [VERIFY]
  location: { lat: number; lng: number };  // echoed back
}
```

#### Example Call

```typescript
const result = await client.call('swiggy_search_restaurants', {
  query: 'comfort food vegetarian khichdi soup',
  location: { lat: 19.0596, lng: 72.8295 },  // Bandra, Mumbai
  filters: {
    vegetarianOnly: true,
    maxDeliveryTimeMinutes: 40,
    maxMinOrderValue: 250,
    minRating: 3.8,
  },
  limit: 8,
});
```

#### Example Response (Realistic Mumbai Data)

```json
{
  "restaurants": [
    {
      "id": "rms_36291",
      "name": "Haldiram's Minute Khana",
      "cuisines": ["North Indian", "Sweets", "Snacks"],
      "rating": 4.3,
      "ratingCount": 2341,
      "deliveryTimeMinutes": 25,
      "minOrderValue": 149,
      "deliveryCost": 0,
      "distanceKm": 1.1,
      "isVeg": true,
      "isOpen": true,
      "imageUrl": "https://res.cloudinary.com/swiggy/image/upload/rms_36291.jpg",
      "offers": [
        { "title": "30% off up to Rs 75", "code": "NEWUSER", "minOrderValue": 149 }
      ],
      "menuPreview": [
        { "id": "mi_991023", "name": "Dal Khichdi", "price": 149, "isVeg": true },
        { "id": "mi_991024", "name": "Palak Khichdi", "price": 159, "isVeg": true },
        { "id": "mi_991025", "name": "Jeera Rice + Dal", "price": 169, "isVeg": true }
      ],
      "tags": ["pure veg", "bestseller", "comfort food"]
    },
    {
      "id": "rms_44102",
      "name": "The Bowl Company",
      "cuisines": ["Healthy Food", "Continental", "Salads"],
      "rating": 4.1,
      "ratingCount": 987,
      "deliveryTimeMinutes": 32,
      "minOrderValue": 199,
      "deliveryCost": 30,
      "distanceKm": 2.3,
      "isVeg": false,
      "isOpen": true,
      "imageUrl": "https://res.cloudinary.com/swiggy/image/upload/rms_44102.jpg",
      "offers": [],
      "menuPreview": [
        { "id": "mi_772001", "name": "Tomato Basil Soup", "price": 179, "isVeg": true },
        { "id": "mi_772002", "name": "Grilled Veggie Bowl", "price": 249, "isVeg": true }
      ]
    }
  ],
  "totalFound": 23,
  "searchId": "srch_bandra_2026070512345",
  "location": { "lat": 19.0596, "lng": 72.8295 }
}
```

---

### Tool: `swiggy_get_restaurant_menu`

Fetch the full menu for a specific restaurant, optionally filtered to a category.

**When MealOS calls this:** The Planning Agent calls this (via the Tool Agent) when it needs to select specific menu items for cart creation, or when it needs nutritional estimates to satisfy a nutrition goal. It is NOT called during restaurant search — that uses `menuPreview` from `swiggy_search_restaurants`.

#### Input Schema

```typescript
interface SwiggyGetRestaurantMenuInput {
  restaurantId: string;   // from SwiggyRestaurant.id

  // Optional filter to a specific category.
  // [VERIFY] — category values come from the menu structure itself
  categoryFilter?: string;  // e.g., "Soups", "Mains", "Rice Bowls"
}
```

#### Output Schema

```typescript
interface SwiggyMenuItem {
  id: string;                   // use this in cart creation
  name: string;
  description?: string;
  price: number;                // INR, base price
  isVeg: boolean;
  isAvailable: boolean;         // false if sold out or time-restricted
  imageUrl?: string;

  // Nutritional info — only available for some restaurants. [VERIFY availability]
  nutrition?: {
    calories?: number;
    proteinG?: number;
    carbsG?: number;
    fatG?: number;
    servingSize?: string;       // "1 bowl (300g)"
  };

  customizations?: {
    id: string;
    name: string;               // "Choose spice level"
    type: 'single' | 'multi';
    required: boolean;
    options: {
      id: string;
      name: string;             // "Extra Spicy"
      additionalPrice: number;  // 0 if no surcharge
    }[];
  }[];
}

interface SwiggyMenuCategory {
  name: string;               // "Soups & Starters"
  items: SwiggyMenuItem[];
}

interface SwiggyGetRestaurantMenuOutput {
  restaurantId: string;
  restaurantName: string;
  categories: SwiggyMenuCategory[];
  lastUpdatedAt: string;      // ISO 8601 — use to decide cache freshness
}
```

#### How MealOS Uses It

For the nutrition-goal workflow (e.g., "I need 180g protein today"), the Planning Agent instructs the Tool Agent to:
1. Search restaurants with `query: "high protein chicken"`.
2. For the top 2 results, call `swiggy_get_restaurant_menu`.
3. From the menu, find items where `nutrition.proteinG >= 30`.
4. Surface those specific items in the recommendation with their protein values.

If `nutrition` fields are null (most restaurants), the Planning Agent uses Claude's knowledge to estimate protein content from item names. This estimation is marked as approximate in the UI.

---

### Tool: `swiggy_create_food_cart`

Create a pre-filled cart in the Swiggy system and return a deep link the user can tap to open Swiggy with items already added.

**When MealOS calls this:** On execution — when the user taps "Order Now" on a recommendation. This is NOT called during planning. The recommendation stores `restaurantId` and `items[]` in `execution_data`; this tool is called only when the user commits.

#### Input Schema

```typescript
interface SwiggyCreateFoodCartInput {
  restaurantId: string;

  items: {
    menuItemId: string;
    quantity: number;           // 1–10 per item
    customizations?: {
      customizationId: string;
      selectedOptionIds: string[];
    }[];
  }[];

  // [VERIFY] — some MCP implementations accept a user identifier for cart persistence
  userId?: string;             // MealOS user ID or Swiggy user ID if linked
}
```

#### Output Schema

```typescript
interface SwiggyCreateFoodCartOutput {
  cartId: string;              // Swiggy's cart reference
  deepLink: string;            // URL to open Swiggy with this cart — see Section 8
  webFallbackUrl: string;      // Web URL if app is not installed

  // Cart summary for display in MealOS UI before redirecting
  summary: {
    itemCount: number;
    subtotal: number;          // INR, before delivery + taxes
    deliveryCost: number;
    estimatedTotal: number;
    estimatedDeliveryMinutes: number;
  };

  // [VERIFY] — cart deep links have a TTL after which they expire
  expiresAt: string;           // ISO 8601, typically 30–60 minutes [VERIFY]
}
```

#### Idempotency

Calling `swiggy_create_food_cart` twice with the same `restaurantId` and `items[]` within the cart's TTL returns the same `cartId` and a refreshed `deepLink`. `[VERIFY — behavior may differ]`

If called after the cart expires (`CART_EXPIRED` error), the call must be retried with the same inputs to generate a fresh cart. MealOS handles this transparently — see Section 5.

---

## 3. Instamart Integration

### Tool: `swiggy_search_instamart`

Search Swiggy Instamart for specific grocery items or ingredients.

**When MealOS calls this:** During planning for recipe-based recommendations. The Recipe Agent produces a `missingIngredients[]` list (items the user's pantry does not contain). The Tool Agent calls `swiggy_search_instamart` with that list to check availability and price before recommending the cook path.

#### Input Schema

```typescript
interface SwiggySearchInstamartInput {
  // List of ingredient names to find. Each item is searched independently.
  // Natural language names are acceptable — the MCP handles fuzzy matching.
  items: string[];  // e.g., ["ginger-garlic paste", "basmati rice", "chicken stock"]

  location: {
    lat: number;
    lng: number;
  };

  // Optional per-item budget cap. Items whose cheapest match exceeds this are
  // flagged as unavailable in the response.
  maxPricePerItemInr?: number;  // e.g., 200
}
```

#### Output Schema

```typescript
interface InstamartSearchedItem {
  requestedName: string;          // the name you passed in
  found: boolean;                 // false = unavailable in this location

  // Best match product (null if found = false)
  bestMatch?: {
    id: string;                   // use this for cart creation
    name: string;                 // "National Ginger Garlic Paste 200g"
    brand: string;                // "National"
    price: number;                // INR
    mrp: number;                  // original MRP for discount display
    quantity: string;             // "200g"
    imageUrl?: string;
    inStock: boolean;             // may be found but temporarily out of stock
  };

  // Alternative products if bestMatch is out of stock or unavailable
  alternatives?: {
    id: string;
    name: string;
    brand: string;
    price: number;
    quantity: string;
  }[];
}

interface SwiggySearchInstamartOutput {
  items: InstamartSearchedItem[];
  storeOpen: boolean;             // false if the local Instamart store is closed
  estimatedDeliveryMinutes: number;  // typically 10–30 min
  deliveryAreaServiceable: boolean;  // false if location not covered by Instamart

  // Minimum order value for free delivery from this store
  freeDeliveryThresholdInr?: number;  // e.g., 199 [VERIFY]
}
```

#### Fuzzy Matching

Swiggy Instamart's product names often differ from how a recipe lists ingredients. The MCP server performs fuzzy matching internally `[VERIFY — may need to be implemented in the Tool Agent if MCP does not handle it]`. If MCP does not handle fuzzy matching, the Tool Agent must apply the following normalization before calling:

```typescript
// Tool Agent pre-processing: normalize ingredient names before passing to MCP
function normalizeIngredientName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\b(fresh|organic|homemade|chopped|sliced|diced|minced)\b/g, '')
    .trim();
}

// Examples:
// "fresh ginger-garlic paste" → "ginger-garlic paste"
// "organic basmati rice" → "basmati rice"
// "minced garlic cloves" → "garlic cloves"  → MCP finds "garlic" products
```

If `bestMatch.inStock === false` and `alternatives.length === 0`, the item is treated as unavailable and the recipe recommendation is adjusted to note the missing ingredient.

---

### Tool: `swiggy_create_instamart_cart`

Create an Instamart cart and return a deep link.

**When MealOS calls this:** When the user taps "Add to Instamart" on a recipe recommendation. The Tool Agent aggregates the `missingIngredients` list (from Recipe Agent output), maps each to an Instamart item ID (from a prior `swiggy_search_instamart` call stored in `execution_data`), and creates the cart.

#### Input Schema

```typescript
interface SwiggyCreateInstamartCartInput {
  items: {
    itemId: string;       // from InstamartSearchedItem.bestMatch.id
    quantity: number;     // number of units, not grams/ml
  }[];

  location: {
    lat: number;
    lng: number;
  };

  // [VERIFY] — may be needed for cart persistence
  userId?: string;
}
```

#### Output Schema

```typescript
interface SwiggyCreateInstamartCartOutput {
  cartId: string;
  deepLink: string;               // opens Instamart tab in Swiggy app
  webFallbackUrl: string;

  summary: {
    itemCount: number;
    subtotal: number;
    deliveryCost: number;         // 0 if above free delivery threshold
    estimatedTotal: number;
    estimatedDeliveryMinutes: number;
  };

  // Items that could not be added (out of stock at time of cart creation)
  unavailableItems: {
    itemId: string;
    reason: 'OUT_OF_STOCK' | 'STORE_CLOSED' | 'ITEM_REMOVED';
    substitute?: { itemId: string; name: string; price: number };
  }[];

  expiresAt: string;              // [VERIFY TTL — Instamart carts likely expire faster]
}
```

#### Error Cases

| Error | Trigger | MealOS Behavior |
|---|---|---|
| `STORE_CLOSED` | Instamart store not operating at this hour | Show recipe with manual shopping note |
| `DELIVERY_AREA_UNAVAILABLE` | Location not served by Instamart | Flag in UI: "Instamart not available in your area" |
| `MINIMUM_ORDER_NOT_MET` | Cart value below store minimum | Add items or show minimum order notice |
| `PARTIAL_CART` | Some items unavailable | Create cart with available items, list unavailable ones separately |

For `PARTIAL_CART`: MealOS creates the cart with available items and informs the user in the ExecutionCard: _"5 of 8 ingredients added to Instamart. You'll need to source basmati rice and ghee separately."_ This is always preferable to blocking execution.

---

### Instamart-Specific Concerns

#### Delivery Slot Availability

In some cities and during peak hours, Instamart operates slot-based delivery rather than 10-minute delivery. `[VERIFY — varies by city and Swiggy MCP version]`

If slot-based delivery is active, `swiggy_search_instamart` returns an additional field:

```typescript
// [VERIFY field structure]
deliverySlots?: {
  slotId: string;
  startTime: string;    // ISO 8601
  endTime: string;
  available: boolean;
}[];
```

MealOS selects the earliest available slot automatically. The slot time is shown in the ExecutionCard: _"Ingredients delivered between 6–6:30 PM."_

#### Minimum Order Value

If the ingredient list generates a cart below Instamart's minimum order value (typically Rs 149–199), the Tool Agent:
1. Checks if any `alternatives` items are larger package sizes that satisfy the minimum.
2. If not, flags the shortfall in the cart summary: _"Add Rs 45 more to meet the minimum order."_
3. Never silently blocks the user — always surface the partial cart option.

#### Item Substitution Logic

The Tool Agent applies substitution in this order:
1. Use `bestMatch` if `inStock = true`.
2. If `inStock = false`, use the first item in `alternatives` (sorted by price ascending).
3. If `alternatives` is empty, mark item as `UNAVAILABLE` and omit from cart.

Substitutions are displayed to the user before cart creation: _"Substituting 'Double Horse Ginger Garlic Paste' for 'National Ginger Garlic Paste' (out of stock)."_

#### Partial Cart Handling

A "partial cart" is defined as a cart where one or more requested items could not be added. MealOS always creates the partial cart rather than aborting. The ExecutionCard shows:

- Items added: list with quantities and prices.
- Items missing: list with reason and suggestion (buy locally / skip).
- Total for partial cart.
- CTA: "Add to Instamart (5 of 8 items)" — the count is explicit.

---

## 4. Dineout Integration

### Tool: `swiggy_search_dineout`

Search for dine-in restaurants matching occasion, budget, and party size.

**When MealOS calls this:** During planning for `date_planning`, `family_dinner`, `business_meal`, `party_hosting` (small group, not home delivery) situations. Called by the Swiggy Agent with filters derived from the Planning Agent's context.

#### Input Schema

```typescript
interface SwiggySearchDineoutInput {
  location: {
    lat: number;
    lng: number;
  };

  // Occasion type guides ranking and filtering.
  // "date" prioritizes ambience, lighting, private seating.
  // "family" prioritizes child-friendly, parking, vegetarian options.
  // "business" prioritizes quiet, private rooms, premium service.
  // "casual" is the default: no strong bias.
  occasion?: 'date' | 'family' | 'business' | 'casual' | 'celebration';

  partySize: number;  // 1–20. Affects availability filter.

  // Budget per person in INR. Venues with averageSpendPerPerson > budget are excluded.
  budgetPerPersonInr?: number;  // e.g., 1500

  // Cuisine preferences. Match any.
  cuisines?: string[];  // e.g., ["Italian", "Japanese", "Continental"]

  // "today" = tonight's date, "tomorrow", or ISO date string.
  date?: string;  // e.g., "today" | "2026-07-07"

  // Distance filter in km. Default: 5km.
  maxDistanceKm?: number;

  // Number of results to return. Default: 8. Max: 20. [VERIFY]
  limit?: number;
}
```

#### Output Schema

```typescript
interface DineoutVenue {
  id: string;                       // use for availability + reservation calls
  name: string;                     // "Trattoria Cielo"
  cuisines: string[];
  rating: number;                   // 4.5
  ratingCount: number;
  averageSpendFor2: number;         // INR, the standard Swiggy "cost for two"
  averageSpendPerPerson: number;    // derived: averageSpendFor2 / 2
  distanceKm: number;
  address: string;
  imageUrl: string;
  isVegFriendly: boolean;           // has substantial veg options (not necessarily pure veg)

  // Ambience and vibe tags
  tags: string[];  // ["rooftop", "candlelit", "live music", "outdoor seating", "fine dining"]

  // Whether a table is available for the requested date/partySize.
  // null = availability not checked yet (call swiggy_get_dineout_availability).
  hasAvailability: boolean | null;

  // Earliest available slot for the requested date (if availability was checked).
  // null if no availability or not checked.
  nearestAvailableSlot?: string;    // e.g., "8:00 PM"
}

interface SwiggySearchDineoutOutput {
  venues: DineoutVenue[];
  totalFound: number;
  searchId: string;
  date: string;                     // ISO date searched
  partySize: number;
}
```

#### Example Call

```typescript
const result = await client.call('swiggy_search_dineout', {
  location: { lat: 19.0596, lng: 72.8295 },
  occasion: 'date',
  partySize: 2,
  budgetPerPersonInr: 1500,
  cuisines: ['Italian', 'Continental'],
  date: 'today',
  limit: 6,
});
```

---

### Tool: `swiggy_get_dineout_availability`

Check available time slots for a specific venue on a specific date.

**When MealOS calls this:** After `swiggy_search_dineout`, for the top 2 venues in the recommendation. Availability is fetched before surfacing options to the user — MealOS never shows a venue without confirming a slot exists.

#### Input Schema

```typescript
interface SwiggyGetDineoutAvailabilityInput {
  venueId: string;          // from DineoutVenue.id
  date: string;             // ISO date string: "2026-07-06"
  partySize: number;
}
```

#### Output Schema

```typescript
interface DineoutTimeSlot {
  slotId: string;           // opaque token used in reservation
  time: string;             // "7:30 PM"
  available: boolean;       // true = can be booked now
  seatsRemaining?: number;  // [VERIFY — not always provided]
}

interface SwiggyGetDineoutAvailabilityOutput {
  venueId: string;
  date: string;
  partySize: number;
  slots: DineoutTimeSlot[];
  lastCheckedAt: string;    // ISO 8601 — used to enforce TTL caching
}
```

**Caching:** Dineout availability changes rapidly (slots fill as other users book). Cache with a 5-minute TTL using the `venueId + date + partySize` as the cache key. After 5 minutes, re-fetch before showing the user. Do not surface a cached slot as "available" if it is more than 5 minutes old.

```typescript
const DINEOUT_AVAILABILITY_TTL_MS = 5 * 60 * 1000;

async function getCachedOrFreshAvailability(
  venueId: string, date: string, partySize: number
): Promise<SwiggyGetDineoutAvailabilityOutput> {
  const cacheKey = `dineout:avail:${venueId}:${date}:${partySize}`;
  const cached = await redis.get(cacheKey);

  if (cached) {
    const parsed = JSON.parse(cached);
    const age = Date.now() - new Date(parsed.lastCheckedAt).getTime();
    if (age < DINEOUT_AVAILABILITY_TTL_MS) return parsed;
  }

  const fresh = await swiggyClient.call('swiggy_get_dineout_availability', {
    venueId, date, partySize
  });

  await redis.setex(cacheKey, 300, JSON.stringify(fresh));
  return fresh;
}
```

---

### Tool: `swiggy_create_dineout_reservation`

Reserve a table at a Dineout venue.

**When MealOS calls this:** When the user taps "Book Table" in the ExecutionCard. The `slotId` selected is either the user's choice (if multiple slots were shown) or the earliest available slot (if MealOS auto-selected).

#### Input Schema

```typescript
interface SwiggyCreateDineoutReservationInput {
  venueId: string;
  slotId: string;         // from DineoutTimeSlot.slotId
  partySize: number;

  // Guest contact information for the venue's confirmation
  guest: {
    name: string;         // from user profile
    phone: string;        // from user profile — venue uses this for confirmation
    // [VERIFY] — email may also be required
    email?: string;
  };

  // Optional free-text passed to the venue (e.g., "anniversary dinner", "window seat preferred")
  specialRequests?: string;

  // [VERIFY] — some systems require a prepayment or deposit
  paymentToken?: string;
}
```

#### Output Schema

```typescript
interface SwiggyCreateDineoutReservationOutput {
  reservationId: string;          // Swiggy's reservation reference
  confirmationCode: string;       // Short code to show at the venue: "SW-24819"
  venueId: string;
  venueName: string;
  date: string;
  time: string;                   // "7:30 PM"
  partySize: number;
  status: 'confirmed' | 'pending';  // pending if venue manual-confirms [VERIFY]

  // Deep link to manage/view the reservation in Swiggy app
  deepLink: string;
  webFallbackUrl: string;

  // Cancellation window (V2 feature — document now, implement later)
  cancellationDeadline?: string;  // ISO 8601 — must cancel before this time [VERIFY]
}
```

#### Cancellation (V2)

Reservation cancellation is a V2 feature. The `reservationId` is stored in `user_actions.external_order_id` so it can be passed to a future `swiggy_cancel_dineout_reservation` tool `[VERIFY tool exists]`. Do not expose cancellation UI in V1.

---

## 5. Error Handling

### Complete Error Taxonomy

| Error Code | Meaning | Detection Pattern |
|---|---|---|
| `SWIGGY_UNAVAILABLE` | MCP endpoint is down or unreachable | Tool call throws network error or returns HTTP 503 |
| `LOCATION_NOT_SERVICEABLE` | No Swiggy services at user's lat/lng | MCP returns `deliveryAreaServiceable: false` or explicit error code |
| `RESTAURANT_CLOSED` | Specific restaurant not accepting orders | `SwiggyRestaurant.isOpen === false` |
| `ITEM_OUT_OF_STOCK` | Instamart item unavailable | `InstamartSearchedItem.bestMatch.inStock === false` and no alternatives |
| `SLOT_TAKEN` | Dineout slot just filled between search and booking | `swiggy_create_dineout_reservation` returns error on a previously-available slot |
| `CART_EXPIRED` | Cart deep link TTL exceeded | `swiggy_create_food_cart` or `swiggy_create_instamart_cart` returns `CART_EXPIRED` |
| `RATE_LIMIT` | Too many MCP calls in window | MCP returns HTTP 429 or `RATE_LIMIT_EXCEEDED` error code |
| `MINIMUM_ORDER_NOT_MET` | Cart below Instamart minimum | `swiggy_create_instamart_cart` rejects cart |
| `MENU_UNAVAILABLE` | Restaurant menu temporarily unavailable | `swiggy_get_restaurant_menu` returns error |
| `INVALID_RESTAURANT` | Restaurant ID not found or deleted | `swiggy_get_restaurant_menu` returns 404-equivalent |

### Error Handling Per Code

#### `SWIGGY_UNAVAILABLE`

**Detection:** MCP client throws `MCPConnectionError` or request times out after 8 seconds.

**Immediate fallback:**
1. Tool Agent returns `{ available: false, error: 'SWIGGY_UNAVAILABLE' }` to Planning Agent.
2. Planning Agent switches to recipe-only planning mode using pantry data.
3. If pantry is empty, Planning Agent returns a manual suggestion ("Order from your preferred restaurant directly").

**UI behavior:** The Situation Board shows the cook recommendation prominently. No error message. No Swiggy results card appears. If Dineout was the intended path, UI shows: _"Restaurant booking is temporarily unavailable. Here's what you can do instead."_ The ExecutionCard removes all Swiggy action buttons.

**Recovery:** Swiggy availability is checked again on the next situation — not retried in the current one. No polling.

---

#### `LOCATION_NOT_SERVICEABLE`

**Detection:** `swiggy_search_restaurants` or `swiggy_search_instamart` returns `deliveryAreaServiceable: false`, or `LOCATION_NOT_SERVICEABLE` error code.

**Immediate fallback:** Same as `SWIGGY_UNAVAILABLE`. Additionally: if location is not serviceable and this is the user's stored home address, flag for update in memory panel.

**UI behavior:** Cook-only plan shown. If cook path is not viable (empty pantry, user cannot cook), a manual shopping list is surfaced: _"Instamart doesn't deliver to your area. Here's what to pick up from a nearby store."_

---

#### `RESTAURANT_CLOSED`

**Detection:** `SwiggyRestaurant.isOpen === false` in search results, or a cart creation attempt fails because the restaurant closed between search and execution.

**Immediate fallback:**
- During search: filter out closed restaurants before returning results to Planning Agent. If the `limit` is not met after filtering, expand `maxDeliveryTimeMinutes` by 10 minutes and re-search.
- During cart creation: re-run `swiggy_search_restaurants` with the same query and recommend the next-best open restaurant.

**UI behavior:** Never exposed. Restaurant results shown to users are always open. If a restaurant closes between recommendation and execution (race condition), the ExecutionCard refreshes and shows: _"[Restaurant name] just closed. Here's the next best option."_

---

#### `ITEM_OUT_OF_STOCK`

**Detection:** `InstamartSearchedItem.bestMatch.inStock === false` and `alternatives.length === 0`.

**Immediate fallback:**
1. Try `alternatives[0]` first.
2. If no alternatives, create a partial cart without the item.
3. Note the missing item in `SwiggyCreateInstamartCartOutput.unavailableItems`.

**UI behavior:** Shown transparently in ExecutionCard: _"Ginger garlic paste is out of stock — it's been removed from your cart. You can pick it up from a kirana store."_ Never blocks execution.

---

#### `SLOT_TAKEN`

**Detection:** `swiggy_create_dineout_reservation` returns an error indicating the slot is no longer available.

**Immediate fallback:**
1. Call `swiggy_get_dineout_availability` again for the same venue and date.
2. If alternative slots exist, auto-select the next available slot and present it to the user for confirmation.
3. If no slots remain, call `swiggy_search_dineout` again for alternative venues.

**UI behavior:** _"That slot just filled up. [Venue name] has a table at 8:30 PM instead — want to book that?"_ [Yes / No, show alternatives]. Never: "Error: SLOT_TAKEN."

---

#### `CART_EXPIRED`

**Detection:** Cart deep link was generated > TTL minutes ago (stored in `SwiggyCreateFoodCartOutput.expiresAt`), or the deep link returns a Swiggy error when tapped.

**Immediate fallback:** Re-call `swiggy_create_food_cart` with the same `restaurantId` and `items[]` stored in `recommendation_items.execution_data`. The new `cartId` and `deepLink` are returned in the execute API response.

**UI behavior:** Transparent to the user. The "Order Now" button tap triggers re-generation silently. The redirect happens with a slightly longer delay (< 2 seconds). If re-generation fails (restaurant now closed), show `RESTAURANT_CLOSED` flow.

---

#### `RATE_LIMIT`

**Detection:** MCP client receives HTTP 429 or `RATE_LIMIT_EXCEEDED` error.

**Immediate fallback:** Queue the call for retry after backoff. Do not surface an error to the user during planning — the planning phase buffers the result.

**Retry strategy:**
```typescript
const RETRY_DELAYS_MS = [500, 1000, 2000];  // exponential backoff, 3 attempts max

async function callWithRetry<T>(
  toolName: string,
  args: unknown,
  attemptIndex = 0
): Promise<T> {
  try {
    return await client.call(toolName, args);
  } catch (err) {
    if (err.code === 'RATE_LIMIT' && attemptIndex < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attemptIndex]);
      return callWithRetry(toolName, args, attemptIndex + 1);
    }
    throw err;
  }
}
```

**UI behavior:** During planning, a `agent_progress` SSE event is sent: _"Finding options for you..."_ — the user sees the system is working, not failing. If all retries are exhausted, treat as `SWIGGY_UNAVAILABLE`.

---

## 6. Rate Limits and Caching

### Estimated Rate Limits Per Tool `[VERIFY WITH SWIGGY MCP DOCS]`

| Tool | Estimated Limit | Notes |
|---|---|---|
| `swiggy_search_restaurants` | 60 req/min per API key | Assumed; actual may be higher for partners |
| `swiggy_get_restaurant_menu` | 120 req/min per API key | Menus are read-heavy, likely higher limit |
| `swiggy_create_food_cart` | 30 req/min per API key | Write operation, lower limit expected |
| `swiggy_search_instamart` | 60 req/min per API key | Similar to restaurant search |
| `swiggy_create_instamart_cart` | 30 req/min per API key | Write operation |
| `swiggy_search_dineout` | 30 req/min per API key | Likely lower due to reservation system load |
| `swiggy_get_dineout_availability` | 60 req/min per API key | Read-heavy |
| `swiggy_create_dineout_reservation` | 10 req/min per API key | Strict — actual bookings |

At 1,000 DAU with ~2 Swiggy searches per active session, peak load is ~30 searches/minute — well within assumed limits. Rate limits become a concern above ~5,000 DAU without caching.

### Caching Strategy Per Tool

#### V1 (No Redis — Vercel Serverless Only)

In V1, MealOS has no Redis instance for the MCP layer. Every planning pass makes live MCP calls. This means:

- Restaurant searches are repeated if the same user submits a similar situation within minutes.
- Menu fetches are repeated on every planning run, even for the same restaurant.
- Dineout availability is fetched fresh every time (which is actually correct behavior).

**Cost of not caching in V1:**
- A typical situation with Swiggy involvement: 1 restaurant search + 1–2 menu fetches + 1 Instamart search = 3–4 MCP calls per planning run.
- At 1,000 planning runs/day: ~3,000–4,000 MCP calls/day — manageable.
- At 10,000 planning runs/day: 30,000–40,000 calls/day — caching becomes mandatory to stay under limits.

**V1 mitigation (no Redis required):**
- Use Next.js `unstable_cache` (or `revalidate`) for restaurant search responses: 15-minute revalidation per location+query combination.
- Use Next.js `unstable_cache` for menu data: 30-minute revalidation per restaurantId.

#### V2 (Redis Caching — Plan Now)

When Redis is available (Milestone 4+), apply the following caching strategy:

| Tool | Cache Key | TTL | Strategy |
|---|---|---|---|
| `swiggy_search_restaurants` | `swiggy:rest:search:{lat_3dp}:{lng_3dp}:{query_hash}:{filter_hash}` | 15 min | Cache full response. Stale-while-revalidate if > 10 min old. |
| `swiggy_get_restaurant_menu` | `swiggy:rest:menu:{restaurantId}` | 30 min | Cache full menu. Invalidate if `isOpen` changes. |
| `swiggy_search_instamart` | `swiggy:instamart:search:{lat_3dp}:{lng_3dp}:{items_hash}` | 10 min | Shorter TTL — stock changes frequently. |
| `swiggy_search_dineout` | `swiggy:dineout:search:{lat_3dp}:{lng_3dp}:{occasion}:{partySize}:{date}` | 15 min | Cache venue list. Availability is NOT cached here. |
| `swiggy_get_dineout_availability` | `swiggy:dineout:avail:{venueId}:{date}:{partySize}` | 5 min | Strict TTL — slots fill fast. |

Notes:
- `lat_3dp` / `lng_3dp` means latitude/longitude truncated to 3 decimal places (~111m precision). This allows nearby users to share cache entries.
- `query_hash` is a short hash (e.g., first 8 chars of SHA-256) of the normalized query string.
- `filter_hash` is a stable JSON-serialized hash of the filters object.
- Cart creation calls (`swiggy_create_food_cart`, `swiggy_create_instamart_cart`, `swiggy_create_dineout_reservation`) are NEVER cached — they are write operations.

---

## 7. The Tool Agent Wrapper

This section specifies the complete TypeScript implementation of `packages/mcp/src/swiggy/SwiggyMCPClient.ts`. A developer can implement this file directly from this specification.

### Complete Interface

```typescript
// packages/mcp/src/swiggy/types.ts

export interface MealOSLocation {
  lat: number;
  lng: number;
}

// MealOS internal restaurant type — normalized from Swiggy's schema
export interface MealOSRestaurant {
  swiggyId: string;
  name: string;
  cuisines: string[];
  rating: number;
  deliveryTimeMinutes: number;
  minOrderInr: number;
  deliveryCostInr: number;
  distanceKm: number;
  isVeg: boolean;
  isOpen: boolean;
  imageUrl: string;
  activeOffers: string[];       // simplified: just the offer titles
  menuPreview: {
    id: string;
    name: string;
    priceInr: number;
    isVeg: boolean;
  }[];
}

// MealOS internal Instamart item type
export interface MealOSInstamartItem {
  swiggyItemId: string;
  requestedName: string;        // what the recipe asked for
  resolvedName: string;         // what Instamart matched
  brand: string;
  priceInr: number;
  quantity: string;             // "200g"
  inStock: boolean;
  isSubstitute: boolean;        // true if this is an alternative, not the best match
  imageUrl?: string;
}

// MealOS internal dineout venue type
export interface MealOSDineoutVenue {
  swiggyId: string;
  name: string;
  cuisines: string[];
  rating: number;
  averageSpendFor2Inr: number;
  distanceKm: number;
  address: string;
  imageUrl: string;
  tags: string[];
  availableSlots: string[];     // e.g., ["7:00 PM", "8:00 PM", "9:30 PM"]
}

// Standard fallback type returned by all Tool Agent methods on failure
export interface MCPUnavailableResult {
  available: false;
  error: string;               // human-readable, for Planning Agent context
  errorCode: string;           // machine-readable, for fallback logic
}

export type MCPResult<T> = T | MCPUnavailableResult;

export function isUnavailable(result: MCPResult<unknown>): result is MCPUnavailableResult {
  return (result as MCPUnavailableResult).available === false;
}
```

### Client Implementation

```typescript
// packages/mcp/src/swiggy/SwiggyMCPClient.ts

import { Client as MCPClient } from '@modelcontextprotocol/sdk/client/index.js'; // [VERIFY import path]
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'; // [VERIFY]
import type {
  MealOSLocation,
  MealOSRestaurant,
  MealOSInstamartItem,
  MealOSDineoutVenue,
  MCPResult,
  MCPUnavailableResult,
} from './types';
import {
  SwiggySearchRestaurantsInput,
  SwiggyCreateFoodCartOutput,
  SwiggyCreateInstamartCartOutput,
  SwiggyCreateDineoutReservationOutput,
} from './swiggy-types';  // raw Swiggy MCP types

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 2;

export class SwiggyMCPClient {
  private client: MCPClient;
  private initialized = false;

  constructor(private config: {
    apiKey: string;
    environment: 'sandbox' | 'production';
    timeout?: number;
  }) {}

  // Called once at server startup. Idempotent.
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // [VERIFY] — transport type depends on how Swiggy MCP is served.
    // May be HTTP transport rather than stdio.
    const transport = new StdioClientTransport({
      command: 'swiggy-mcp-server', // [VERIFY — binary name or endpoint URL]
      env: {
        SWIGGY_API_KEY: this.config.apiKey,
        SWIGGY_ENV: this.config.environment,
      },
    });

    this.client = new MCPClient(
      { name: 'mealos-swiggy-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await this.client.connect(transport);
    this.initialized = true;
  }

  // Internal: call an MCP tool with timeout and retry
  private async callTool<T>(
    toolName: string,
    args: Record<string, unknown>,
    attempt = 0
  ): Promise<T> {
    const timeoutMs = this.config.timeout ?? DEFAULT_TIMEOUT_MS;

    const callPromise = this.client.callTool({ name: toolName, arguments: args });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('MCP_TIMEOUT')), timeoutMs)
    );

    try {
      const result = await Promise.race([callPromise, timeoutPromise]);
      // [VERIFY] — extract result content from MCP response envelope
      return (result as { content: { text: string }[] }).content[0]
        ? JSON.parse((result as { content: { text: string }[] }).content[0].text)
        : (result as T);
    } catch (err: unknown) {
      const error = err as { code?: string; message?: string };
      const isRetryable = error.code === 'RATE_LIMIT' || error.message === 'MCP_TIMEOUT';
      if (isRetryable && attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 500;
        await new Promise(r => setTimeout(r, delay));
        return this.callTool<T>(toolName, args, attempt + 1);
      }
      throw err;
    }
  }

  // Standard error wrapper for all public methods
  private wrapError(err: unknown, context: string): MCPUnavailableResult {
    const error = err as { code?: string; message?: string };
    const code = error.code ?? 'SWIGGY_UNAVAILABLE';
    console.error(`[SwiggyMCP] ${context} failed:`, error.message ?? err);
    return {
      available: false,
      error: `Swiggy is temporarily unavailable (${context})`,
      errorCode: code,
    };
  }

  // ─── FOOD DELIVERY ───────────────────────────────────────────────────────

  async searchRestaurants(params: {
    query: string;
    location: MealOSLocation;
    vegetarianOnly?: boolean;
    maxDeliveryMinutes?: number;
    maxMinOrderInr?: number;
    cuisines?: string[];
    limit?: number;
  }): Promise<MCPResult<MealOSRestaurant[]>> {
    try {
      const raw = await this.callTool<{ restaurants: unknown[] }>(
        'swiggy_search_restaurants',
        {
          query: params.query,
          location: params.location,
          filters: {
            vegetarianOnly: params.vegetarianOnly,
            maxDeliveryTimeMinutes: params.maxDeliveryMinutes,
            maxMinOrderValue: params.maxMinOrderInr,
            cuisines: params.cuisines,
          },
          limit: params.limit ?? 10,
        }
      );

      return raw.restaurants
        .map(this.normalizeRestaurant)
        .filter(r => r.isOpen);          // never return closed restaurants
    } catch (err) {
      return this.wrapError(err, 'searchRestaurants');
    }
  }

  private normalizeRestaurant(raw: unknown): MealOSRestaurant {
    const r = raw as Record<string, unknown>;
    return {
      swiggyId: r.id as string,
      name: r.name as string,
      cuisines: r.cuisines as string[],
      rating: r.rating as number,
      deliveryTimeMinutes: r.deliveryTimeMinutes as number,
      minOrderInr: r.minOrderValue as number,
      deliveryCostInr: r.deliveryCost as number,
      distanceKm: r.distanceKm as number,
      isVeg: r.isVeg as boolean,
      isOpen: r.isOpen as boolean,
      imageUrl: r.imageUrl as string,
      activeOffers: ((r.offers as { title: string }[]) ?? []).map(o => o.title),
      menuPreview: ((r.menuPreview as Record<string, unknown>[]) ?? []).map(item => ({
        id: item.id as string,
        name: item.name as string,
        priceInr: item.price as number,
        isVeg: item.isVeg as boolean,
      })),
    };
  }

  async getRestaurantMenu(params: {
    restaurantId: string;
    categoryFilter?: string;
  }): Promise<MCPResult<{ categories: { name: string; items: { id: string; name: string; priceInr: number; isVeg: boolean; nutritionEstimate?: { calories?: number; proteinG?: number } }[] }[] }>> {
    try {
      const raw = await this.callTool<{
        categories: {
          name: string;
          items: { id: string; name: string; price: number; isVeg: boolean; isAvailable: boolean; nutrition?: { calories?: number; proteinG?: number } }[];
        }[];
      }>('swiggy_get_restaurant_menu', {
        restaurantId: params.restaurantId,
        categoryFilter: params.categoryFilter,
      });

      return {
        categories: raw.categories.map(cat => ({
          name: cat.name,
          items: cat.items
            .filter(item => item.isAvailable)
            .map(item => ({
              id: item.id,
              name: item.name,
              priceInr: item.price,
              isVeg: item.isVeg,
              nutritionEstimate: item.nutrition
                ? { calories: item.nutrition.calories, proteinG: item.nutrition.proteinG }
                : undefined,
            })),
        })),
      };
    } catch (err) {
      return this.wrapError(err, 'getRestaurantMenu');
    }
  }

  async createFoodCart(params: {
    restaurantId: string;
    items: { menuItemId: string; quantity: number; customizations?: { customizationId: string; selectedOptionIds: string[] }[] }[];
  }): Promise<MCPResult<SwiggyCreateFoodCartOutput>> {
    try {
      return await this.callTool<SwiggyCreateFoodCartOutput>(
        'swiggy_create_food_cart',
        params
      );
    } catch (err) {
      return this.wrapError(err, 'createFoodCart');
    }
  }

  // ─── INSTAMART ───────────────────────────────────────────────────────────

  async searchInstamart(params: {
    items: string[];
    location: MealOSLocation;
    maxPricePerItemInr?: number;
  }): Promise<MCPResult<{ items: MealOSInstamartItem[]; estimatedDeliveryMinutes: number; storeOpen: boolean }>> {
    try {
      const raw = await this.callTool<{
        items: {
          requestedName: string;
          found: boolean;
          bestMatch?: { id: string; name: string; brand: string; price: number; quantity: string; inStock: boolean; imageUrl?: string };
          alternatives?: { id: string; name: string; brand: string; price: number; quantity: string }[];
        }[];
        estimatedDeliveryMinutes: number;
        storeOpen: boolean;
        deliveryAreaServiceable: boolean;
      }>('swiggy_search_instamart', params);

      if (!raw.deliveryAreaServiceable) {
        return {
          available: false,
          error: 'Instamart does not deliver to your location',
          errorCode: 'LOCATION_NOT_SERVICEABLE',
        };
      }

      const items: MealOSInstamartItem[] = raw.items.map(item => {
        // Apply substitution logic: bestMatch first, then alternatives
        const source = item.bestMatch?.inStock
          ? { ...item.bestMatch, isSubstitute: false }
          : item.alternatives?.[0]
            ? { ...item.alternatives[0], inStock: true, isSubstitute: true, imageUrl: undefined }
            : null;

        if (!source) {
          return {
            swiggyItemId: '',
            requestedName: item.requestedName,
            resolvedName: '',
            brand: '',
            priceInr: 0,
            quantity: '',
            inStock: false,
            isSubstitute: false,
          };
        }

        return {
          swiggyItemId: source.id,
          requestedName: item.requestedName,
          resolvedName: source.name,
          brand: source.brand,
          priceInr: source.price,
          quantity: source.quantity,
          inStock: source.inStock,
          isSubstitute: source.isSubstitute,
          imageUrl: source.imageUrl,
        };
      });

      return {
        items,
        estimatedDeliveryMinutes: raw.estimatedDeliveryMinutes,
        storeOpen: raw.storeOpen,
      };
    } catch (err) {
      return this.wrapError(err, 'searchInstamart');
    }
  }

  async createInstamartCart(params: {
    items: { itemId: string; quantity: number }[];
    location: MealOSLocation;
  }): Promise<MCPResult<SwiggyCreateInstamartCartOutput>> {
    try {
      return await this.callTool<SwiggyCreateInstamartCartOutput>(
        'swiggy_create_instamart_cart',
        params
      );
    } catch (err) {
      return this.wrapError(err, 'createInstamartCart');
    }
  }

  // ─── DINEOUT ─────────────────────────────────────────────────────────────

  async searchDineout(params: {
    location: MealOSLocation;
    occasion?: 'date' | 'family' | 'business' | 'casual' | 'celebration';
    partySize: number;
    budgetPerPersonInr?: number;
    cuisines?: string[];
    date?: string;
    limit?: number;
  }): Promise<MCPResult<MealOSDineoutVenue[]>> {
    try {
      const raw = await this.callTool<{ venues: unknown[] }>(
        'swiggy_search_dineout',
        { ...params, limit: params.limit ?? 8 }
      );

      return raw.venues.map(v => {
        const venue = v as Record<string, unknown>;
        return {
          swiggyId: venue.id as string,
          name: venue.name as string,
          cuisines: venue.cuisines as string[],
          rating: venue.rating as number,
          averageSpendFor2Inr: venue.averageSpendFor2 as number,
          distanceKm: venue.distanceKm as number,
          address: venue.address as string,
          imageUrl: venue.imageUrl as string,
          tags: (venue.tags as string[]) ?? [],
          availableSlots: [],   // populated by getAvailability call
        };
      });
    } catch (err) {
      return this.wrapError(err, 'searchDineout');
    }
  }

  async getDineoutAvailability(params: {
    venueId: string;
    date: string;
    partySize: number;
  }): Promise<MCPResult<{ slots: { slotId: string; time: string; available: boolean }[] }>> {
    try {
      const raw = await this.callTool<{
        slots: { slotId: string; time: string; available: boolean }[];
      }>('swiggy_get_dineout_availability', params);

      return { slots: raw.slots.filter(s => s.available) };
    } catch (err) {
      return this.wrapError(err, 'getDineoutAvailability');
    }
  }

  async createDineoutReservation(params: {
    venueId: string;
    slotId: string;
    partySize: number;
    guest: { name: string; phone: string; email?: string };
    specialRequests?: string;
  }): Promise<MCPResult<SwiggyCreateDineoutReservationOutput>> {
    try {
      return await this.callTool<SwiggyCreateDineoutReservationOutput>(
        'swiggy_create_dineout_reservation',
        params
      );
    } catch (err) {
      return this.wrapError(err, 'createDineoutReservation');
    }
  }
}
```

### How Planning Agent Tool Calls Are Mapped

The Planning Agent calls tools on the Tool Agent using MealOS-specific names (not Swiggy names). The Tool Agent translates:

| Planning Agent calls | Tool Agent method | MCP tool called |
|---|---|---|
| `search_food_delivery` | `searchRestaurants()` | `swiggy_search_restaurants` |
| `get_menu` | `getRestaurantMenu()` | `swiggy_get_restaurant_menu` |
| `search_ingredients` | `searchInstamart()` | `swiggy_search_instamart` |
| `find_restaurant_venue` | `searchDineout()` | `swiggy_search_dineout` |
| `check_table_availability` | `getDineoutAvailability()` | `swiggy_get_dineout_availability` |
| `create_order_cart` | `createFoodCart()` | `swiggy_create_food_cart` |
| `create_grocery_cart` | `createInstamartCart()` | `swiggy_create_instamart_cart` |
| `book_table` | `createDineoutReservation()` | `swiggy_create_dineout_reservation` |

---

## 8. Cart Deep Links

Swiggy deep links open the Swiggy app directly to a pre-filled state. If the app is not installed, the fallback URL opens the Swiggy website.

### Food Delivery Cart Deep Link

```
App URL scheme:
swiggy://open?screen=cart&cartId={cartId}&source=mealos

Web fallback URL:
https://www.swiggy.com/open?cartId={cartId}&source=mealos
```

`[VERIFY URL scheme with Swiggy MCP Docs — the cartId parameter name and scheme prefix may differ]`

The `source=mealos` parameter is a UTM-equivalent tracking parameter that attributes Swiggy orders to MealOS in Swiggy's partner analytics. `[VERIFY parameter name]`

### Instamart Cart Deep Link

```
App URL scheme:
swiggy://open?screen=instamart&cartId={cartId}&source=mealos

Web fallback URL:
https://www.swiggy.com/instamart?cartId={cartId}&source=mealos
```

`[VERIFY — Instamart may use a different scheme from the food delivery cart]`

### Dineout Deep Link

```
App URL scheme:
swiggy://open?screen=dineout&reservationId={reservationId}

Web fallback URL:
https://www.swiggy.com/dineout/reservation/{reservationId}
```

For Dineout, the link is shown as a "View Reservation" link rather than an "open cart" action.

### App Not Installed: Fallback Behavior

MealOS checks for app availability before redirecting. On mobile web (where Swiggy app may not be installed):

```typescript
function openSwiggyLink(deepLink: string, webFallbackUrl: string): void {
  // Attempt to open app. If not installed, the scheme will fail silently.
  // Set a timeout to fall back to web.
  const appOpenTimeout = setTimeout(() => {
    window.location.href = webFallbackUrl;
  }, 1500);

  // Attempt app open
  window.location.href = deepLink;

  // If the page loses focus (app opened), cancel the fallback
  window.addEventListener('blur', () => clearTimeout(appOpenTimeout), { once: true });
}
```

This pattern is a best-effort heuristic and is not 100% reliable across all browsers. `[VERIFY — Swiggy may provide a JS SDK for smarter app detection]`

### Cart Link Validity Window

| Cart Type | TTL | Behavior After Expiry |
|---|---|---|
| Food delivery cart | 30–60 minutes `[VERIFY]` | `CART_EXPIRED` error on tap; MealOS regenerates |
| Instamart cart | 30 minutes `[VERIFY]` | Same as above |
| Dineout reservation | Permanent (until cancelled) | Link stays valid; slot remains booked |

The `expiresAt` field from cart creation responses is stored in `user_actions` so MealOS can detect expiry before the user taps.

---

## 9. Testing the Integration

### Mocking the Swiggy MCP in Development

In development and test environments, never call the real Swiggy MCP. Use the mock client:

```typescript
// packages/mcp/src/swiggy/__mocks__/SwiggyMCPClient.ts

import { SwiggyMCPClient } from '../SwiggyMCPClient';
import { mockRestaurants, mockInstamartItems, mockDineoutVenues } from './fixtures';

export class MockSwiggyMCPClient extends SwiggyMCPClient {
  async initialize() { /* no-op */ }

  async searchRestaurants() {
    return mockRestaurants;
  }

  async getRestaurantMenu({ restaurantId }: { restaurantId: string }) {
    return mockMenus[restaurantId] ?? mockMenus['default'];
  }

  async createFoodCart(params: unknown) {
    return {
      cartId: 'mock_cart_food_001',
      deepLink: 'swiggy://open?screen=cart&cartId=mock_cart_food_001',
      webFallbackUrl: 'https://www.swiggy.com/open?cartId=mock_cart_food_001',
      summary: { itemCount: 1, subtotal: 149, deliveryCost: 0, estimatedTotal: 149, estimatedDeliveryMinutes: 28 },
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
  }

  async searchInstamart() {
    return { items: mockInstamartItems, estimatedDeliveryMinutes: 15, storeOpen: true };
  }

  async createInstamartCart() {
    return {
      cartId: 'mock_cart_instamart_001',
      deepLink: 'swiggy://open?screen=instamart&cartId=mock_cart_instamart_001',
      webFallbackUrl: 'https://www.swiggy.com/instamart?cartId=mock_cart_instamart_001',
      summary: { itemCount: 4, subtotal: 320, deliveryCost: 0, estimatedTotal: 320, estimatedDeliveryMinutes: 15 },
      unavailableItems: [],
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
  }

  async searchDineout() {
    return mockDineoutVenues;
  }

  async getDineoutAvailability() {
    return {
      slots: [
        { slotId: 'slot_001', time: '7:30 PM', available: true },
        { slotId: 'slot_002', time: '8:00 PM', available: true },
        { slotId: 'slot_003', time: '9:00 PM', available: true },
      ],
    };
  }

  async createDineoutReservation(params: { venueId: string; slotId: string; partySize: number; guest: { name: string; phone: string } }) {
    return {
      reservationId: 'mock_res_001',
      confirmationCode: 'SW-24819',
      venueId: params.venueId,
      venueName: 'Trattoria Cielo (Mock)',
      date: new Date().toISOString().split('T')[0],
      time: '7:30 PM',
      partySize: params.partySize,
      status: 'confirmed' as const,
      deepLink: 'swiggy://open?screen=dineout&reservationId=mock_res_001',
      webFallbackUrl: 'https://www.swiggy.com/dineout/reservation/mock_res_001',
    };
  }
}
```

Swap in the mock client using dependency injection or an environment variable:

```typescript
// packages/mcp/src/swiggy/index.ts
import { SwiggyMCPClient } from './SwiggyMCPClient';
import { MockSwiggyMCPClient } from './__mocks__/SwiggyMCPClient';

export function createSwiggyClient() {
  if (process.env.NODE_ENV === 'test' || process.env.SWIGGY_MOCK === 'true') {
    return new MockSwiggyMCPClient({ apiKey: 'mock', environment: 'sandbox' });
  }
  return new SwiggyMCPClient({
    apiKey: process.env.SWIGGY_MCP_API_KEY!,
    environment: process.env.SWIGGY_MCP_ENV as 'sandbox' | 'production',
  });
}
```

### Mock Data Fixtures (Realistic Mumbai Data)

```typescript
// packages/mcp/src/swiggy/__mocks__/fixtures.ts

export const mockRestaurants = [
  {
    swiggyId: 'rms_36291',
    name: "Haldiram's Minute Khana",
    cuisines: ['North Indian', 'Sweets'],
    rating: 4.3,
    deliveryTimeMinutes: 25,
    minOrderInr: 149,
    deliveryCostInr: 0,
    distanceKm: 1.1,
    isVeg: true,
    isOpen: true,
    imageUrl: 'https://placeholder.swiggy.test/haldirams.jpg',
    activeOffers: ['30% off up to Rs 75'],
    menuPreview: [
      { id: 'mi_991023', name: 'Dal Khichdi', priceInr: 149, isVeg: true },
      { id: 'mi_991024', name: 'Palak Khichdi', priceInr: 159, isVeg: true },
    ],
  },
  {
    swiggyId: 'rms_44102',
    name: 'The Bowl Company',
    cuisines: ['Healthy Food', 'Continental'],
    rating: 4.1,
    deliveryTimeMinutes: 32,
    minOrderInr: 199,
    deliveryCostInr: 30,
    distanceKm: 2.3,
    isVeg: false,
    isOpen: true,
    imageUrl: 'https://placeholder.swiggy.test/bowlco.jpg',
    activeOffers: [],
    menuPreview: [
      { id: 'mi_772001', name: 'Chicken Tikka Bowl', priceInr: 319, isVeg: false },
      { id: 'mi_772002', name: 'Tomato Basil Soup', priceInr: 179, isVeg: true },
    ],
  },
  {
    swiggyId: 'rms_55891',
    name: 'Behrouz Biryani',
    cuisines: ['Biryani', 'Mughlai'],
    rating: 4.4,
    deliveryTimeMinutes: 38,
    minOrderInr: 299,
    deliveryCostInr: 0,
    distanceKm: 3.1,
    isVeg: false,
    isOpen: true,
    imageUrl: 'https://placeholder.swiggy.test/behrouz.jpg',
    activeOffers: ['Free raita on orders above Rs 400'],
    menuPreview: [
      { id: 'mi_881001', name: 'Dum Gosht Biryani', priceInr: 379, isVeg: false },
      { id: 'mi_881002', name: 'Chicken Nizami Handi', priceInr: 349, isVeg: false },
    ],
  },
];

export const mockInstamartItems: import('../types').MealOSInstamartItem[] = [
  {
    swiggyItemId: 'im_30012',
    requestedName: 'ginger-garlic paste',
    resolvedName: 'National Ginger Garlic Paste 200g',
    brand: 'National',
    priceInr: 65,
    quantity: '200g',
    inStock: true,
    isSubstitute: false,
    imageUrl: 'https://placeholder.swiggy.test/ggpaste.jpg',
  },
  {
    swiggyItemId: 'im_10023',
    requestedName: 'basmati rice',
    resolvedName: 'India Gate Classic Basmati Rice 1kg',
    brand: 'India Gate',
    priceInr: 189,
    quantity: '1kg',
    inStock: true,
    isSubstitute: false,
  },
  {
    swiggyItemId: 'im_44512',
    requestedName: 'turmeric powder',
    resolvedName: 'Everest Turmeric Powder 100g',
    brand: 'Everest',
    priceInr: 55,
    quantity: '100g',
    inStock: true,
    isSubstitute: false,
  },
];

export const mockDineoutVenues: import('../types').MealOSDineoutVenue[] = [
  {
    swiggyId: 'do_88231',
    name: 'Trattoria Cielo',
    cuisines: ['Italian', 'Continental'],
    rating: 4.6,
    averageSpendFor2Inr: 2400,
    distanceKm: 1.8,
    address: '14 Hill Road, Bandra West, Mumbai',
    imageUrl: 'https://placeholder.swiggy.test/trattoria.jpg',
    tags: ['candlelit', 'romantic', 'outdoor seating', 'wine list'],
    availableSlots: ['7:30 PM', '8:00 PM', '9:00 PM'],
  },
  {
    swiggyId: 'do_91044',
    name: 'Bastian Bandra',
    cuisines: ['Seafood', 'Continental'],
    rating: 4.5,
    averageSpendFor2Inr: 2800,
    distanceKm: 0.9,
    address: 'The Palladium, Bandra Kurla Complex, Mumbai',
    imageUrl: 'https://placeholder.swiggy.test/bastian.jpg',
    tags: ['rooftop', 'trendy', 'cocktails', 'seafood'],
    availableSlots: ['8:00 PM', '8:30 PM'],
  },
];
```

### Integration Test Checklist

Before deploying Swiggy MCP integration to production, verify the following:

**Food Delivery**
- [ ] `swiggy_search_restaurants` returns results for a known Mumbai location
- [ ] Vegetarian filter correctly excludes non-veg restaurants
- [ ] Closed restaurants are not returned by `searchRestaurants()`
- [ ] `swiggy_get_restaurant_menu` returns items for a known restaurant ID
- [ ] `swiggy_create_food_cart` returns a valid `deepLink` and `webFallbackUrl`
- [ ] Cart deep link opens Swiggy app (manual test on device)
- [ ] Cart web fallback URL loads the correct Swiggy page

**Instamart**
- [ ] `swiggy_search_instamart` correctly fuzzy-matches "ginger-garlic paste" to a product
- [ ] `storeOpen: false` is handled gracefully (cook-only plan shown)
- [ ] Partial cart creation works when one item is out of stock
- [ ] `swiggy_create_instamart_cart` returns a valid deep link
- [ ] Instamart deep link opens the Instamart tab in Swiggy

**Dineout**
- [ ] `swiggy_search_dineout` returns venues for Bandra, Mumbai
- [ ] Occasion filter affects result ranking (date vs family)
- [ ] `swiggy_get_dineout_availability` returns available slots
- [ ] `swiggy_create_dineout_reservation` creates a booking and returns `confirmationCode`
- [ ] Dineout deep link opens reservation in Swiggy

**Error Scenarios**
- [ ] `SWIGGY_UNAVAILABLE` (simulate by calling with invalid API key): returns fallback, cook-only plan rendered
- [ ] `LOCATION_NOT_SERVICEABLE` (use a remote location, e.g., rural coordinates): handled gracefully
- [ ] `RATE_LIMIT` (simulate via mock): retried with backoff, not surfaced to user
- [ ] `CART_EXPIRED` (simulate via mock returning `CART_EXPIRED`): regenerated transparently
- [ ] `SLOT_TAKEN` (simulate via mock): next slot offered to user

### Simulating Error Types in Tests

```typescript
// In test files, use MockSwiggyMCPClient with error overrides:

const errorClient = new MockSwiggyMCPClient({ apiKey: 'test', environment: 'sandbox' });

// Simulate SWIGGY_UNAVAILABLE
errorClient.searchRestaurants = async () => ({
  available: false,
  error: 'Swiggy is temporarily unavailable',
  errorCode: 'SWIGGY_UNAVAILABLE',
});

// Simulate SLOT_TAKEN
errorClient.createDineoutReservation = async () => {
  throw Object.assign(new Error('Slot no longer available'), { code: 'SLOT_TAKEN' });
};

// Simulate RATE_LIMIT (first call fails, second succeeds)
let rateLimitCalled = false;
const originalSearch = errorClient.searchRestaurants.bind(errorClient);
errorClient.searchRestaurants = async (...args) => {
  if (!rateLimitCalled) {
    rateLimitCalled = true;
    throw Object.assign(new Error('Rate limit exceeded'), { code: 'RATE_LIMIT' });
  }
  return originalSearch(...args);
};
```

---

## 10. V2 Integrations

These Swiggy capabilities are not used in V1 but are worth designing for. Do not implement them in V1 — document the integration point so the architecture supports them without rewiring.

### Order Tracking (Live Status After Placement)

Swiggy supports real-time order status updates (received → preparing → picked up → delivered). In V2, MealOS would poll or subscribe to order status and update the Situation Board with a live tracker.

**Integration point:** Store `external_order_id` in `user_actions` (already in schema). In V2, a background worker polls `swiggy_get_order_status(orderId)` `[VERIFY tool exists]` every 60 seconds and publishes updates via SSE to the active session.

**UI:** A "Track Order" card on the Situation Board replaces the ExecutionCard after ordering. Shows the Swiggy delivery agent's name and ETA.

### Swiggy One Membership (Loyalty Discounts in Scoring)

Swiggy One gives users free delivery and additional discounts. If the user has Swiggy One, the Planning Agent should factor this into cost estimates.

**Integration point:** In V2, during user onboarding, ask "Do you have Swiggy One?" (yes/no). Store as `user_memory_facts["swiggy.has_one_membership"]`. The Budget Agent checks this fact and adjusts delivery cost estimates to Rs 0 when calculating total order cost.

`[VERIFY]` — Swiggy MCP may expose a `swiggy_check_user_membership(userId)` tool that the Tool Agent can call if the user's Swiggy account is linked.

### Swiggy Widgets (Embedded in MealOS UI)

Swiggy may offer embeddable web widgets for browsing menus or tracking orders without leaving MealOS. These would replace the current "redirect to Swiggy" pattern with an in-app experience.

**Integration point:** The `PlanCard` component would embed a Swiggy widget `<iframe>` or Web Component instead of a deep link button. The cart and checkout remain in Swiggy's widget; MealOS does not handle payment.

`[VERIFY]` — Swiggy's partner program likely gates widget access. Check with Swiggy's partner team before designing V2 UI.

### Push Notifications via Swiggy

For Swiggy One users or high-value orders, Swiggy may send its own push notifications for delivery updates. In V2, MealOS would suppress its own order-related notifications when Swiggy is handling them natively.

**Integration point:** After `swiggy_create_food_cart` execution, MealOS checks if Swiggy will send a push notification `[VERIFY — may not be an MCP-exposed capability]`. If yes, MealOS skips scheduling its own reminder. If no, MealOS schedules a "Your order should be arriving soon" reminder via BullMQ at `estimatedDeliveryMinutes - 5` minutes.

---

*End of Swiggy MCP Integration Guide*

*Questions or discrepancies: file an issue in the MealOS repository or contact the Swiggy partner team for `[VERIFY WITH SWIGGY MCP DOCS]` items.*
