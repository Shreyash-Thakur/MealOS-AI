# MealOS AI — Database Documentation (V1)

**Technology:** PostgreSQL (Neon) · Prisma ORM · Clerk for identity  
**Version:** V1 (5 tables)  
**Last updated:** 2026-07-06  

---

## Table of Contents

1. [Entity Relationship Diagram](#1-entity-relationship-diagram)
2. [Table Documentation](#2-table-documentation)
3. [Index Strategy](#3-index-strategy)
4. [Common Query Patterns](#4-common-query-patterns)
5. [JSONB Strategy](#5-jsonb-strategy)
6. [Migration Strategy](#6-migration-strategy)
7. [V1 → V2 Migration Checklist](#7-v1--v2-migration-checklist)
8. [Seed Strategy](#8-seed-strategy)

---

## 1. Entity Relationship Diagram

All cardinality is shown as `1 : N` (one-to-many) or `1 : 1` (one-to-one).  
`?` denotes a nullable foreign key.

```
┌──────────────────────────────────────────────┐
│                    users                     │
├──────────────────────────────────────────────┤
│ PK  id              UUID                     │
│ UQ  clerk_id        VARCHAR                  │
│ UQ  email           VARCHAR                  │
│     name            VARCHAR?                 │
│     phone           VARCHAR?                 │
│     created_at      TIMESTAMPTZ              │
│     updated_at      TIMESTAMPTZ              │
│     last_active_at  TIMESTAMPTZ?             │
└────────────────────┬─────────────────────────┘
                     │
         ┌───────────┼──────────────────────────────┐
         │           │                              │
         │ 1:N       │ 1:N                          │ 1:N
         ▼           ▼                              ▼
┌──────────────────┐ ┌─────────────────────────┐  ┌─────────────────────────────┐
│ user_memory_facts│ │       situations        │  │      user_actions           │
├──────────────────┤ ├─────────────────────────┤  │  (also has FK →             │
│ PK  id  UUID     │ │ PK  id       UUID       │  │   situations and            │
│ FK  user_id UUID │ │ FK  user_id  UUID       │  │   recommendations)          │
│ UQ (user_id,     │ │     raw_input TEXT      │  └─────────────────────────────┘
│     fact_key)    │ │     situation_type ENUM │
│     fact_key     │ │     context      JSONB? │
│     fact_value   │ │     status       ENUM   │
│       JSONB      │ │     clarif_data  JSONB? │
│     source  ENUM │ │     created_at          │
│     confidence   │ │     updated_at          │
│     times_       │ │     context_ready_at ?  │
│       confirmed  │ │     plan_ready_at    ?  │
│     last_        │ │     completed_at     ?  │
│       confirmed_at│ │     lat     DECIMAL(10,8)?│
│     expires_at ? │ │     lng     DECIMAL(11,8)?│
│     created_at   │ └──────────┬──────────────┘
│     updated_at   │            │
└──────────────────┘            │ 1:1
                                ▼
                   ┌────────────────────────────────────┐
                   │          recommendations            │
                   ├────────────────────────────────────┤
                   │ PK  id               UUID          │
                   │ UQ  situation_id     UUID          │
                   │ FK  user_id          UUID          │
                   │     comparison_scores  JSONB       │
                   │     primary_path       ENUM        │
                   │     explanation        TEXT        │
                   │     confidence_score   INT         │
                   │     title              TEXT        │
                   │     estimated_cost     INT         │
                   │     estimated_time_min INT         │
                   │     calories           INT?        │
                   │     protein_g          INT?        │
                   │     carbs_g            INT?        │
                   │     fat_g              INT?        │
                   │     youtube_url        TEXT?       │
                   │     recipe_steps       JSONB?      │
                   │     instamart_items    JSONB?      │
                   │     swiggy_data        JSONB?      │
                   │     created_at         TIMESTAMPTZ │
                   └──────────────┬─────────────────────┘
                                  │
                                  │ 1:N
                                  ▼
                   ┌────────────────────────────────────┐
                   │            user_actions            │
                   ├────────────────────────────────────┤
                   │ PK  id                UUID         │
                   │ FK  user_id           UUID → users │
                   │ FK  situation_id      UUID → situations│
                   │ FK  recommendation_id UUID → recommendations│
                   │     action_type       ENUM         │
                   │     rating            INT? (1–5)   │
                   │     external_order_id VARCHAR?     │
                   │     created_at        TIMESTAMPTZ  │
                   │     updated_at        TIMESTAMPTZ  │
                   └────────────────────────────────────┘
```

**Relationship summary:**

| Relationship | Cardinality | Notes |
|---|---|---|
| users → user_memory_facts | 1:N | CASCADE DELETE |
| users → situations | 1:N | CASCADE DELETE |
| users → recommendations | 1:N | CASCADE DELETE |
| users → user_actions | 1:N | CASCADE DELETE |
| situations → recommendations | 1:1 | UNIQUE on situation_id; CASCADE DELETE |
| situations → user_actions | 1:N | CASCADE DELETE |
| recommendations → user_actions | 1:N | CASCADE DELETE |

---

## 2. Table Documentation

### 2.1 `users`

**Purpose:** Extension table for Clerk's identity system. Clerk owns the authoritative user record (email, social logins, MFA, sessions). This table is our internal user identifier and the anchor for all product data.

**When written:** Created by a Clerk webhook handler (`user.created` event) or lazily on first authenticated API request. Updated when the user modifies their name/phone in the MealOS app.

**When read:** On every authenticated request (auth middleware resolves clerk_id → internal id). On every API call that needs userId for a FK.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | UUID | No | Internal identifier. Used as FK in all related tables. |
| `clerk_id` | VARCHAR | No, UNIQUE | Clerk's stable user ID (e.g. `user_2NNiSlFa...`). Used in auth middleware. |
| `email` | VARCHAR | No, UNIQUE | User's primary email from Clerk. Keep in sync via webhook. |
| `name` | VARCHAR | Yes | Display name. Populated from Clerk profile but editable in MealOS. |
| `phone` | VARCHAR | Yes | E.164 format. Used for SMS notifications in V2. |
| `created_at` | TIMESTAMPTZ | No | Row creation timestamp. |
| `updated_at` | TIMESTAMPTZ | No | Auto-updated by Prisma on any field change. |
| `last_active_at` | TIMESTAMPTZ | Yes | Updated on each authenticated API request. Powers DAU/WAU analytics. |

**Constraints:**
- `clerk_id` and `email` both have database-level UNIQUE constraints.
- `email` format validation is enforced at the application layer (Zod), not at the database level.
- No CHECK constraint on `phone` — format validation at application layer.

---

### 2.2 `user_memory_facts`

**Purpose:** Key-value store for structured, addressable facts about a user. Each row is one atomic fact with provenance, confidence, and expiry tracking. This is the structured layer of the two-layer memory system (the other layer being pgvector embeddings in V2).

**When written:** During onboarding flow, after processing clarification answers, and by the Memory Agent after each completed situation.

**When read:** By the Context Agent before every planning pass (to build `SituationContext.fromMemory`). By the Clarification Engine (to check whether a question can be skipped because the answer is already known).

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | UUID | No | Primary key. |
| `user_id` | UUID | No | FK → users.id. The owner of this fact. |
| `fact_key` | VARCHAR | No | Dot-notation key identifying the fact category. See key registry below. |
| `fact_value` | JSONB | No | The value of the fact. Shape varies by key — see TypeScript interface below. |
| `source` | ENUM (memory_source) | No | How this fact was learned. Drives UI labels ("You told us this" vs "We inferred this"). |
| `confidence` | FLOAT | No | 0.0–1.0. ONBOARDING and USER_EDITED start at 1.0. AGENT_INFERRED starts at 0.7, increases 0.05 per confirmation, capped at 0.95. |
| `times_confirmed` | INT | No | Count of times this fact has been confirmed without contradiction. |
| `last_confirmed_at` | TIMESTAMPTZ | Yes | Timestamp of the most recent confirmation event. |
| `expires_at` | TIMESTAMPTZ | Yes | Null for permanent facts. Set for soft facts (budget, pantry, fitness goals). |
| `created_at` | TIMESTAMPTZ | No | Row creation timestamp. |
| `updated_at` | TIMESTAMPTZ | No | Auto-updated on any field change. |

**Unique constraint:** `(user_id, fact_key)` — enforces one row per fact per user. All writes must use upsert on this pair.

**Standard key registry:**

```
dietary.restrictions          → string[]   e.g. ["vegetarian", "no-onion"]
dietary.allergies             → string[]   e.g. ["shellfish", "peanuts"]
budget.daily_food_target      → number     e.g. 350  (INR)
budget.dining_out_per_outing  → number     e.g. 2500 (INR)
location.home                 → string     e.g. "Bandra West, Mumbai"
location.work                 → string     e.g. "BKC, Mumbai"
kitchen.skill_level           → string     "beginner" | "intermediate" | "advanced"
kitchen.equipment             → string[]   e.g. ["gas stove", "oven", "mixer grinder"]
household.size                → number     e.g. 2
fitness.protein_target        → number     e.g. 150 (grams/day)
fitness.calorie_target        → number     e.g. 2200 (kcal/day)
fitness.gym_days              → string[]   e.g. ["Monday", "Wednesday", "Friday"]
preference.cuisines.liked     → string[]   e.g. ["South Indian", "Italian"]
preference.cuisines.disliked  → string[]   e.g. ["Very spicy food"]
pantry.staples                → string[]   e.g. ["rice", "dal", "oil", "salt"]
ordering.frequent_restaurants → string[]   e.g. ["Behrouz Biryani", "Wow Momo"]
```

**TypeScript interface for `fact_value`:**

```typescript
// fact_value is typed per factKey. The FactValueByKey map is the source of truth.
type FactValueByKey = {
  "dietary.restrictions":           string[];
  "dietary.allergies":              string[];
  "budget.daily_food_target":       number;
  "budget.dining_out_per_outing":   number;
  "location.home":                  string;
  "location.work":                  string;
  "kitchen.skill_level":            "beginner" | "intermediate" | "advanced";
  "kitchen.equipment":              string[];
  "household.size":                 number;
  "fitness.protein_target":         number;
  "fitness.calorie_target":         number;
  "fitness.gym_days":               string[];
  "preference.cuisines.liked":      string[];
  "preference.cuisines.disliked":   string[];
  "pantry.staples":                 string[];
  "ordering.frequent_restaurants":  string[];
};
```

**Example row:**

```json
{
  "id": "a1b2c3d4-...",
  "user_id": "f5e6d7c8-...",
  "fact_key": "dietary.restrictions",
  "fact_value": ["vegetarian"],
  "source": "onboarding",
  "confidence": 1.0,
  "times_confirmed": 12,
  "last_confirmed_at": "2026-07-03T18:30:00Z",
  "expires_at": null,
  "created_at": "2026-06-01T09:00:00Z",
  "updated_at": "2026-07-03T18:30:00Z"
}
```

---

### 2.3 `situations`

**Purpose:** The core event. One row per user food situation submission. Drives the entire agent pipeline and owns the state machine.

**When written:** Immediately on POST /api/v1/situations request (status = CREATED). Updated at every state machine transition by the agent pipeline.

**When read:** Continuously during the agent pipeline. By the SSE stream handler. By the history page.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | UUID | No | Primary key. |
| `user_id` | UUID | No | FK → users.id. |
| `raw_input` | TEXT | No | Verbatim text the user submitted. Never modified after creation. |
| `situation_type` | ENUM (situation_type) | Yes | Classified by the Conversation Agent. Null until intent extraction completes. |
| `context` | JSONB | Yes | Full SituationContext object. Null until Intent Agent completes. |
| `status` | ENUM (situation_status) | No | State machine position. Default: CREATED. |
| `clarification_data` | JSONB | Yes | All clarification passes (max 2). Null if no clarification was needed. |
| `created_at` | TIMESTAMPTZ | No | Situation submission timestamp. |
| `updated_at` | TIMESTAMPTZ | No | Auto-updated on each state machine transition. |
| `context_ready_at` | TIMESTAMPTZ | Yes | When the situation transitioned to CONTEXT_READY. |
| `plan_ready_at` | TIMESTAMPTZ | Yes | When the Planning Agent completed and PLAN_READY was set. |
| `completed_at` | TIMESTAMPTZ | Yes | When the user took action and the situation was marked COMPLETED. |
| `lat` | DECIMAL(10,8) | Yes | Latitude from geolocation API or profile fallback. |
| `lng` | DECIMAL(11,8) | Yes | Longitude. |

**State machine transitions:**

```
CREATED → CLARIFYING → CONTEXT_READY → PLANNING → PLAN_READY → EXECUTING → COMPLETED
                     ↗                                                    ↘
               (if no clarification needed: skip CLARIFYING)               ABANDONED
```

**TypeScript interface for `context` (SituationContext):**

```typescript
interface SituationContext {
  situationType: string;
  explicit: {
    proteinTarget?:     number;   // grams
    budget?:            number;   // INR
    canCook?:           boolean;
    alone?:             boolean;
    guestCount?:        number;
    timeConstraintMin?: number;
    craving?:           string;
    location?:          string;
    occasion?:          string;
  };
  inferred: {
    timeOfDay?:  "breakfast" | "lunch" | "dinner" | "snack" | "late_night";
    isWeekend?:  boolean;
    location?:   string;
  };
  fromMemory: {
    dietType?:          string;
    allergies?:         string[];
    budget?:            number;
    cookingSkill?:      string;
    kitchenEquipment?:  string[];
    homeLoc?:           string;
    proteinTarget?:     number;
    preferredCuisines?: string[];
  };
}
```

**TypeScript interface for `clarification_data` (ClarificationData):**

```typescript
interface ClarificationQuestion {
  id:      string;
  text:    string;
  field:   string;  // which SituationContext key this answers
  type:    "single_choice" | "multi_choice" | "freetext" | "number";
  options: Array<{ label: string; value: unknown }>;
}

interface ClarificationPass {
  passNumber:  number;  // 1 or 2
  questions:   ClarificationQuestion[];
  answers:     Record<string, unknown>;  // questionId → answer value
  askedAt:     string;        // ISO 8601 timestamp
  answeredAt:  string | null; // ISO 8601 timestamp, null if pending
}

interface ClarificationData {
  passes: ClarificationPass[];
}
```

**Example `context` value:**

```json
{
  "situationType": "sick",
  "explicit": {
    "canCook": false,
    "alone": true
  },
  "inferred": {
    "timeOfDay": "dinner",
    "isWeekend": false,
    "location": "home"
  },
  "fromMemory": {
    "dietType": "vegetarian",
    "allergies": ["shellfish"],
    "budget": 350,
    "cookingSkill": "intermediate",
    "homeLoc": "Bandra West, Mumbai"
  }
}
```

---

### 2.4 `recommendations`

**Purpose:** The plan produced for a situation by the agent pipeline. One-to-one with situations. The single source of truth for what the system recommended and all execution data needed to act on it.

**When written:** By the Planning Agent when it completes. Triggers the PLAN_READY status update on the parent situation.

**When read:** On Situation Board display (GET /api/v1/recommendations/:id). During execution (to get deep link URLs and Instamart cart data).

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | UUID | No | Primary key. |
| `situation_id` | UUID | No, UNIQUE | FK → situations.id. Enforces 1:1 relationship. |
| `user_id` | UUID | No | FK → users.id. Denormalized for efficient user-scoped queries. |
| `comparison_scores` | JSONB | No | Cook / Order / Dine Out scores and supporting data. See TypeScript interface below. |
| `primary_path` | ENUM (primary_path) | No | The winning path selected by the scoring engine. |
| `explanation` | TEXT | No | Claude's 2–4 sentence explanation. |
| `confidence_score` | INT | No | 0–100. Derived from context completeness and score gap. |
| `title` | TEXT | No | Human-readable title of the primary recommendation. |
| `estimated_cost` | INT | No | Total cost in INR for the primary recommendation. |
| `estimated_time_min` | INT | No | End-to-end minutes (delivery wait or cook time). |
| `calories` | INT | Yes | Estimated calories. Null when nutritional data is unavailable. |
| `protein_g` | INT | Yes | Protein in grams. |
| `carbs_g` | INT | Yes | Carbohydrates in grams. |
| `fat_g` | INT | Yes | Fat in grams. |
| `youtube_url` | TEXT | Yes | Recipe tutorial URL. Populated for COOK path only. |
| `recipe_steps` | JSONB | Yes | Step-by-step recipe. Populated for COOK path only. |
| `instamart_items` | JSONB | Yes | Instamart cart items. Populated when missing ingredients can be sourced via Instamart, or when Instamart is the delivery vehicle. |
| `swiggy_data` | JSONB | Yes | Swiggy Food or Dineout execution data. Populated for ORDER and DINE_OUT paths. |
| `created_at` | TIMESTAMPTZ | No | Recommendation creation timestamp. |

**Constraints:**
- `confidence_score` must be 0–100. Enforced at application layer.
- `estimated_cost` must be >= 0. Enforced at application layer.

**TypeScript interface for `comparison_scores` (ComparisonScores):**

```typescript
interface PathScore {
  score:            number;   // 0–100, deterministic TypeScript calculation
  estimatedCostInr: number;
  estimatedTimeMin: number;
  feasible:         boolean;
  scoringFactors: {
    budgetFit:    number;  // 0–25 points
    timeFit:      number;  // 0–25 points
    contextFit:   number;  // 0–25 points (can be negative for wrong-fit paths)
    nutritionFit: number;  // 0–25 points
  };
  reason: string;  // 1-sentence human-readable explanation of this path's score
}

interface ComparisonScores {
  cook:    PathScore;
  order:   PathScore;
  dineOut: PathScore;
}
```

**TypeScript interface for `recipe_steps`:**

```typescript
interface RecipeStep {
  step:        number;
  instruction: string;
  durationMin: number;
  tip?:        string;  // optional pro tip shown in the UI
}
// Column type: RecipeStep[]
```

**TypeScript interface for `instamart_items`:**

```typescript
interface InstamartItem {
  itemId:            string;
  name:              string;
  quantityNeeded:    number;
  unit:              string;   // "pack", "kg", "g", "L", "piece"
  pricePerUnit:      number;   // INR
  imageUrl?:         string;
  inStockConfirmed:  boolean;
}
// Column type: InstamartItem[]
```

**TypeScript interface for `swiggy_data` (SwiggyData):**

```typescript
interface SwiggyData {
  // Swiggy Food fields (ORDER path)
  restaurantId?:       string;
  restaurantName?:     string;
  menuItemId?:         string;
  menuItemName?:       string;
  deliveryEstimateMin?: number;
  deliveryCostInr?:    number;
  deepLinkUrl?:        string;  // pre-filled cart deep link into Swiggy app

  // Swiggy Dineout fields (DINE_OUT path)
  dineoutPlaceId?:     string;
  dineoutPlaceName?:   string;
  availableSlots?:     Array<{
    date:      string;  // ISO date "YYYY-MM-DD"
    time:      string;  // "HH:MM"
    tableSize: number;
  }>;
  bookingUrl?:         string;
}
```

**Example `comparison_scores` value:**

```json
{
  "cook": {
    "score": 18,
    "estimatedCostInr": 40,
    "estimatedTimeMin": 35,
    "feasible": false,
    "scoringFactors": { "budgetFit": 24, "timeFit": 10, "contextFit": -16, "nutritionFit": 0 },
    "reason": "User is sick and explicitly unable to cook. Context fit is strongly negative."
  },
  "order": {
    "score": 86,
    "estimatedCostInr": 160,
    "estimatedTimeMin": 28,
    "feasible": true,
    "scoringFactors": { "budgetFit": 22, "timeFit": 22, "contextFit": 25, "nutritionFit": 17 },
    "reason": "Delivery is ideal. Khichdi is light, warm, vegetarian, within budget."
  },
  "dineOut": {
    "score": 12,
    "estimatedCostInr": 800,
    "estimatedTimeMin": 90,
    "feasible": false,
    "scoringFactors": { "budgetFit": 5, "timeFit": 2, "contextFit": -20, "nutritionFit": 10 },
    "reason": "User is sick and alone. Dine out is not feasible."
  }
}
```

---

### 2.5 `user_actions`

**Purpose:** What the user did after receiving a recommendation. The feedback loop that powers Memory Agent learning and analytics.

**When written:** The moment the user taps an action button on the Situation Board. Rating is updated later (async, post-meal feedback flow).

**When read:** By the Memory Agent (to extract behavioral patterns). By the analytics layer (funnel analysis). By the user's history page.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `id` | UUID | No | Primary key. |
| `user_id` | UUID | No | FK → users.id. Denormalized for direct user-scoped queries. |
| `situation_id` | UUID | No | FK → situations.id. |
| `recommendation_id` | UUID | No | FK → recommendations.id. |
| `action_type` | ENUM (action_type) | No | What the user did: executed_cook, executed_order, executed_dineout, dismissed, modified. |
| `rating` | INT | Yes | 1–5 star rating. Null until user provides feedback. Application layer enforces 1 ≤ rating ≤ 5. |
| `external_order_id` | VARCHAR | Yes | Swiggy order ID or Dineout booking reference. Null for EXECUTED_COOK and DISMISSED. |
| `created_at` | TIMESTAMPTZ | No | When the user tapped the action button. |
| `updated_at` | TIMESTAMPTZ | No | Updated when rating is submitted. |

**Constraints:**
- One recommendation can have multiple user_actions (e.g., user dismisses, then modifies, then executes). This is intentional — the full action trail is preserved.
- `rating` range (1–5) enforced at application layer via Zod validation. A future migration can add `CHECK (rating >= 1 AND rating <= 5)`.

---

## 3. Index Strategy

### 3.1 `users`

| Index | Columns | Type | Query pattern | Justification |
|---|---|---|---|---|
| Primary key | `id` | B-tree (auto) | FK lookups from all child tables | Automatic with PK declaration. |
| `users_clerk_id_key` | `clerk_id` | B-tree UNIQUE | Auth middleware: `WHERE clerk_id = $1` | Every authenticated request hits this index. Must be O(1). |
| `users_email_key` | `email` | B-tree UNIQUE | Email-based lookup during sign-up deduplication | Required for UNIQUE constraint enforcement. |

**Not indexed:** `last_active_at` is queried only for batch analytics jobs — those can afford a sequential scan at 10k users. Add index if DAU queries run more than twice a day.

---

### 3.2 `user_memory_facts`

| Index | Columns | Type | Query pattern | Justification |
|---|---|---|---|---|
| Primary key | `id` | B-tree (auto) | Direct row lookups | Automatic. |
| `user_memory_facts_user_id_fact_key_key` | `(user_id, fact_key)` | B-tree UNIQUE | Context Agent: `WHERE user_id = $1 AND fact_key = $2`; Upsert on this pair | The single most frequent query on this table. Must be a covering index for single-fact retrieval. |
| `user_memory_facts_user_id_fact_key_idx` | `(user_id, fact_key)` | B-tree | Batch retrieval of all facts for a user: `WHERE user_id = $1` | Unique index doubles as query index. The composite order (user_id first) allows prefix-only scans for `WHERE user_id = $1`. |
| `user_memory_facts_user_id_expires_at_idx` | `(user_id, expires_at)` | B-tree | Expiry sweep: `WHERE expires_at < NOW()` and per-user expiry lookups | Background job runs nightly to expire stale facts. Index keeps this scan efficient as the table grows. |

**Not in V1 (V2 candidate):** GIN index on `fact_value` for containment queries (e.g., "find all users who like Italian cuisine"). At 150k rows with 10k DAU these analytical queries can run as scheduled jobs against a read replica.

---

### 3.3 `situations`

| Index | Columns | Type | Query pattern | Justification |
|---|---|---|---|---|
| Primary key | `id` | B-tree (auto) | FK lookups, GET by situation ID | Automatic. |
| `situations_user_id_created_at_idx` | `(user_id, created_at DESC)` | B-tree | History page: `WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20` | Descending order on created_at avoids filesort. Composite index satisfies both the filter and order in one scan. |
| `situations_user_id_status_idx` | `(user_id, status)` | B-tree | Resume active situation: `WHERE user_id = $1 AND status NOT IN ('completed', 'abandoned')` | Users can have one active situation at a time. Auth middleware checks this on every app load. |
| `situations_status_idx` | `status` | B-tree | Ops monitoring: `WHERE status = 'planning' AND created_at < NOW() - INTERVAL '5 minutes'` (stuck situation alerts) | At 10k DAU the table has ~600k rows. A full scan looking for stuck situations would take seconds. |

---

### 3.4 `recommendations`

| Index | Columns | Type | Query pattern | Justification |
|---|---|---|---|---|
| Primary key | `id` | B-tree (auto) | Direct lookups | Automatic. |
| `recommendations_situation_id_key` | `situation_id` | B-tree UNIQUE | Situation Board: `WHERE situation_id = $1` | Enforces 1:1 constraint. UNIQUE constraint creates the index automatically. |
| `recommendations_user_id_created_at_idx` | `(user_id, created_at DESC)` | B-tree | User history: `WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10` | Mirrors situations history query pattern. Denormalized user_id makes this index necessary. |
| `recommendations_user_id_primary_path_idx` | `(user_id, primary_path)` | B-tree | Analytics: `WHERE user_id = $1 AND primary_path = 'cook'` | Supports personalization analytics: "what path wins most often for this user?" Powers Memory Agent's behavioral summary. |

---

### 3.5 `user_actions`

| Index | Columns | Type | Query pattern | Justification |
|---|---|---|---|---|
| Primary key | `id` | B-tree (auto) | Direct lookups | Automatic. |
| `user_actions_user_id_created_at_idx` | `(user_id, created_at DESC)` | B-tree | User activity history: `WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20` | Same pattern as situations and recommendations. Pagination on the history page. |
| `user_actions_user_id_action_type_idx` | `(user_id, action_type)` | B-tree | Analytics: `WHERE user_id = $1 AND action_type = 'executed_cook'` | Memory Agent aggregates execution history per action type to update preferences. Frequent query post-execution. |
| `user_actions_recommendation_id_idx` | `recommendation_id` | B-tree | Recommendation detail: `WHERE recommendation_id = $1` | Allows efficient lookup of all actions for a given recommendation (for history detail view). |

---

## 4. Common Query Patterns

At 10k DAU, assume approximately:
- **users:** 10,000 rows
- **user_memory_facts:** 150,000 rows (avg 15 facts/user)
- **situations:** 600,000 rows (avg 2/day × 30 active days)
- **recommendations:** 480,000 rows (80% of situations reach COMPLETED)
- **user_actions:** 700,000 rows (avg 1.5 actions per completed situation)

---

### Query 1: Resolve Clerk ID to internal User (Auth Middleware)

**What it does:** Every authenticated API request resolves the Clerk JWT to our internal user record.

**Prisma query:**
```typescript
const user = await prisma.user.findUnique({
  where: { clerkId: clerkJwt.sub },
  select: { id: true, email: true, name: true },
});
```

**N+1 prevention:** `select` returns only the fields needed by downstream middleware. No relations fetched.

**Expected rows:** 1 (index scan on `clerk_id`). Latency target: < 2ms with connection pooling.

---

### Query 2: Fetch All Memory Facts for a User (Context Agent)

**What it does:** Retrieves the user's complete memory profile before any planning pass. The Context Agent uses this to build `SituationContext.fromMemory`.

**Prisma query:**
```typescript
const facts = await prisma.userMemoryFact.findMany({
  where: {
    userId: userId,
    OR: [
      { expiresAt: null },
      { expiresAt: { gt: new Date() } },
    ],
  },
  select: {
    factKey: true,
    factValue: true,
    confidence: true,
    source: true,
  },
  orderBy: { confidence: "desc" },
});
```

**N+1 prevention:** Single query, no relations. `select` avoids fetching audit columns (timesConfirmed, lastConfirmedAt).

**Expected rows:** 10–20 per user. Index scan on `(user_id, expires_at)`.

---

### Query 3: Fetch a Single Memory Fact by Key

**What it does:** Clarification Engine checks whether a specific fact is already known before generating a question.

**Prisma query:**
```typescript
const fact = await prisma.userMemoryFact.findUnique({
  where: {
    userId_factKey: {
      userId: userId,
      factKey: "dietary.restrictions",
    },
  },
  select: { factValue: true, confidence: true, source: true },
});
```

**N+1 prevention:** Uses the `@@unique` composite index directly. Single row, single round trip.

**Expected rows:** 0 or 1. Index scan on `(user_id, fact_key)`. Latency: < 1ms.

---

### Query 4: Upsert a Memory Fact (Memory Agent Post-Execution)

**What it does:** Creates or updates a memory fact after a situation completes. Increments `times_confirmed` and updates `confidence` if the fact already exists.

**Prisma query:**
```typescript
await prisma.userMemoryFact.upsert({
  where: {
    userId_factKey: { userId, factKey: "budget.daily_food_target" },
  },
  create: {
    userId,
    factKey: "budget.daily_food_target",
    factValue: 400,
    source: MemorySource.AGENT_INFERRED,
    confidence: 0.7,
    timesConfirmed: 1,
    lastConfirmedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  },
  update: {
    factValue: 400,
    timesConfirmed: { increment: 1 },
    confidence: { increment: 0.05 },
    lastConfirmedAt: new Date(),
    source: MemorySource.AGENT_INFERRED,
  },
});
```

**N+1 prevention:** Prisma upsert compiles to a single `INSERT ... ON CONFLICT DO UPDATE` statement.

**Expected rows affected:** 1. No additional queries needed.

---

### Query 5: Create a New Situation

**What it does:** Immediately on POST /api/v1/situations. Stores the raw input and sets status = CREATED.

**Prisma query:**
```typescript
const situation = await prisma.situation.create({
  data: {
    userId,
    rawInput: input.trim(),
    status: SituationStatus.CREATED,
    lat: location?.lat,
    lng: location?.lng,
  },
  select: { id: true, createdAt: true },
});
```

**N+1 prevention:** `select` returns only what the API response needs (the situation ID for the SSE stream URL). No relations fetched.

**Expected rows inserted:** 1. Returns immediately.

---

### Query 6: Transition Situation Status (State Machine)

**What it does:** Updates status and the relevant timestamp at each pipeline step. Called by the agent orchestrator.

**Prisma query:**
```typescript
// Example: transitioning to CONTEXT_READY after clarification is answered
await prisma.situation.update({
  where: { id: situationId },
  data: {
    status: SituationStatus.CONTEXT_READY,
    context: situationContext,
    clarificationData: clarificationData,
    contextReadyAt: new Date(),
  },
  select: { id: true, status: true },
});
```

**N+1 prevention:** `select` returns minimal fields. No relations loaded.

**Expected rows:** 1. B-tree lookup by PK.

---

### Query 7: Get User's Situation History (History Page)

**What it does:** Paginated list of a user's past situations with their recommendations for the history page.

**Prisma query:**
```typescript
const situations = await prisma.situation.findMany({
  where: {
    userId,
    status: { in: [SituationStatus.COMPLETED, SituationStatus.ABANDONED] },
  },
  orderBy: { createdAt: "desc" },
  take: 20,
  skip: cursor ? 1 : 0,
  cursor: cursor ? { id: cursor } : undefined,
  select: {
    id: true,
    rawInput: true,
    situationType: true,
    status: true,
    createdAt: true,
    completedAt: true,
    recommendation: {
      select: {
        primaryPath: true,
        title: true,
        estimatedCost: true,
        confidenceScore: true,
      },
    },
  },
});
```

**N+1 prevention:** Single query with nested `select` on the `recommendation` relation. Prisma resolves the join in one SQL query (LEFT JOIN). Cursor-based pagination avoids OFFSET performance degradation at large page numbers.

**Expected rows:** 20 per page. Index scan on `(user_id, created_at DESC)`.

---

### Query 8: Get Full Recommendation for Situation Board Display

**What it does:** Fetches the complete recommendation including all execution data for the Situation Board.

**Prisma query:**
```typescript
const recommendation = await prisma.recommendation.findUnique({
  where: { situationId },
  include: {
    actions: {
      where: { userId },
      select: { actionType: true, rating: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    },
  },
});
```

**N+1 prevention:** `include` with `where` and `take` prevents loading unbounded action history. Single query with JOIN.

**Expected rows:** 1 recommendation + 0–5 actions. B-tree scan on `situation_id` (UNIQUE index).

---

### Query 9: Log a User Action

**What it does:** Records what the user did when they tapped an action button.

**Prisma query:**
```typescript
const action = await prisma.userAction.create({
  data: {
    userId,
    situationId,
    recommendationId,
    actionType: ActionType.EXECUTED_ORDER,
    externalOrderId: swiggyOrderId ?? null,
  },
  select: { id: true },
});

// Also mark the situation as COMPLETED
await prisma.situation.update({
  where: { id: situationId },
  data: { status: SituationStatus.COMPLETED, completedAt: new Date() },
});
```

**N+1 prevention:** Two separate queries (create action, update situation). Both are index-backed single-row operations. Consider wrapping in `prisma.$transaction([...])` for atomicity if strict consistency is required.

**Expected rows:** 1 inserted + 1 updated.

---

### Query 10: Expire Stale Memory Facts (Nightly Background Job)

**What it does:** A scheduled job runs nightly to delete or mark expired memory facts. This keeps the memory profile current and prevents stale data from biasing the Context Agent.

**Prisma query:**
```typescript
// Option A: Hard delete expired facts
const { count } = await prisma.userMemoryFact.deleteMany({
  where: {
    expiresAt: { lte: new Date() },
  },
});
console.log(`Expired ${count} memory facts.`);

// Option B: Soft-expire (mark as expired, keep for audit)
// Requires adding an `isExpired Boolean @default(false)` column in a migration.
```

**N+1 prevention:** Single bulk DELETE. No row-by-row processing.

**Expected rows affected:** < 1,000 per nightly run. Index scan on `expires_at`. Consider partitioning this table by `expires_at` if it grows beyond 5M rows.

---

## 5. JSONB Strategy

### When to use JSONB

Use JSONB for data that meets **all three** of the following criteria:

1. **Structure is variable or schema-evolves frequently.** The shape changes across rows or changes with product iteration.
2. **The entire object is read together.** You never need to query individual sub-fields in a WHERE clause with high selectivity.
3. **The aggregate volume is bounded.** You are not storing unbounded arrays that grow per row over time.

**Current JSONB columns in V1:**

| Table | Column | Reason for JSONB |
|---|---|---|
| `user_memory_facts` | `fact_value` | Type varies by key — string, number, string[] — and new types are added as the key registry grows. |
| `situations` | `context` | SituationContext has optional sub-objects that evolve with new situation types. Structure varies significantly per situationType. |
| `situations` | `clarification_data` | Variable number of passes (0–2), variable number of questions per pass (0–3), variable option shapes. |
| `recommendations` | `comparison_scores` | Three-path scoring object — always read together, never queried by individual score in WHERE. |
| `recommendations` | `recipe_steps` | Variable-length ordered array. Count and structure depend on recipe complexity. Never queried by step. |
| `recommendations` | `instamart_items` | Variable-length array. Item count depends on the recipe. Never filtered by individual item. |
| `recommendations` | `swiggy_data` | Mutually exclusive sub-objects (Food vs. Dineout). Structure diverges by primary_path. |

### When to extract a JSONB field to its own column

Extract a JSONB sub-field to a dedicated column when **any** of the following is true:

1. **You need to filter by it in a WHERE clause** (e.g., `WHERE comparison_scores->'cook'->>'score' > 70`). SQL over JSONB sub-fields is slow without a generated column or GIN index.
2. **You need to ORDER BY it** for pagination or ranking.
3. **You need a referential integrity constraint** on the value (FK, UNIQUE).
4. **It appears in a high-frequency query's SELECT** and could benefit from a covering index.
5. **The value is queried in aggregate** across many rows (GROUP BY, COUNT).

**Applied to V1:** The `primary_path` field started conceptually as a JSONB sub-field of the comparison score but was extracted to its own enum column because it is:
- Needed in WHERE (`WHERE primary_path = 'cook'`)
- Needed in GROUP BY for analytics
- High-frequency in the history index

**Rule of thumb for future development:** Add a column to the JSONB shape first, ship it, observe query patterns for two weeks, then extract to a column if query 5 criteria above are met.

---

## 6. Migration Strategy

### Core rules (never violate these)

1. **Never rename or drop a column in a single migration.** Add the new column, backfill, update application code to write both, deploy, then drop the old column in a separate migration.
2. **Always add nullable columns first.** A new NOT NULL column with no default causes a full table rewrite in PostgreSQL (blocks all reads/writes). Make it nullable, backfill, then add the NOT NULL constraint.
3. **Never add a NOT NULL constraint without a DEFAULT or backfill.** PostgreSQL acquires an ACCESS EXCLUSIVE lock for the duration of a constraint-add that involves a table scan.
4. **Use `prisma migrate deploy` in CI, never `prisma migrate dev` in production.** `migrate dev` resets shadow databases; `migrate deploy` applies only pending migrations.
5. **Test every migration against a copy of production data** before deploying. Use Neon's database branching for this.
6. **Lock-safe alternatives to full table rewrites:**
   - Adding a nullable column: instant (no lock)
   - Adding a column with a volatile DEFAULT: rewrite (use nullable + backfill instead)
   - Adding an index: use `CREATE INDEX CONCURRENTLY` via a raw migration, never `prisma db push`

### V2 table addition process

For every new V2 table:

```
Step 1: Write migration file in prisma/migrations/
Step 2: Add to schema.prisma (model definition only)
Step 3: Run `npx prisma generate` to update the client
Step 4: Deploy migration to staging, run integration tests
Step 5: Deploy to production via `npx prisma migrate deploy`
Step 6: Verify table exists and indexes were created
Step 7: Update API routes and services to use the new table
```

---

## 7. V1 → V2 Migration Checklist

The following tables are designed for V2. Each entry describes the exact steps to add the table without downtime or breaking existing queries.

---

### `pantry_items` (Milestone 1)

**Purpose:** Track user's pantry inventory. Used by Recipe Agent to determine canMakeNow.

```sql
-- Migration: 0002_add_pantry_items.sql
CREATE TABLE pantry_items (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_name    VARCHAR(255) NOT NULL,
  quantity     VARCHAR(100),
  unit         VARCHAR(50),
  is_staple    BOOLEAN     NOT NULL DEFAULT FALSE,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);
CREATE INDEX pantry_items_user_id_idx ON pantry_items(user_id);
CREATE INDEX pantry_items_user_id_is_staple_idx ON pantry_items(user_id, is_staple);
```

**Checklist:**
- [ ] Add migration SQL
- [ ] Add Prisma model `PantryItem`
- [ ] Add relation to `User` model (`pantryItems PantryItem[]`)
- [ ] Run `npx prisma generate`
- [ ] Test on staging
- [ ] Deploy migration
- [ ] Remove `pantry.staples` from `user_memory_facts` key registry once pantry_items is live (keep both reading during transition period)

---

### `meal_history` (Milestone 6)

**Purpose:** Log meals consumed with macros. Powers nutrition tracking and Memory Agent learning.

```sql
-- Migration: 0003_add_meal_history.sql
CREATE TABLE meal_history (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meal_type   VARCHAR(20) NOT NULL CHECK (meal_type IN ('breakfast','lunch','dinner','snack')),
  meal_date   DATE        NOT NULL,
  description TEXT,
  source      VARCHAR(50) NOT NULL, -- 'home_cooked', 'swiggy', 'dineout', 'instamart'
  calories    INTEGER,
  protein_g   INTEGER,
  carbs_g     INTEGER,
  fat_g       INTEGER,
  rating      INTEGER     CHECK (rating >= 1 AND rating <= 5),
  situation_id UUID REFERENCES situations(id),
  logged_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX meal_history_user_id_meal_date_idx ON meal_history(user_id, meal_date DESC);
CREATE INDEX meal_history_user_id_source_idx ON meal_history(user_id, source);
```

**Checklist:**
- [ ] Add nullable `situation_id` FK first (no backfill needed, new rows only)
- [ ] Add Prisma model `MealHistory`
- [ ] Add relation to `User` and `Situation` models
- [ ] Wire up Memory Agent to log meal after EXECUTED_* action
- [ ] Deploy and verify

---

### `scheduled_meals` (Milestone 7)

**Purpose:** Reminders and scheduled orders. Used by Scheduler Agent.

```sql
-- Migration: 0004_add_scheduled_meals.sql
CREATE TABLE scheduled_meals (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  situation_id   UUID        REFERENCES situations(id),
  scheduled_for  TIMESTAMPTZ NOT NULL,
  meal_type      VARCHAR(20),
  description    TEXT,
  reminder_type  VARCHAR(50),  -- 'cook', 'order', 'prep', 'shop'
  reminder_data  JSONB,
  status         VARCHAR(20)  NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  triggered_at   TIMESTAMPTZ
);
CREATE INDEX scheduled_meals_user_id_scheduled_for_idx ON scheduled_meals(user_id, scheduled_for);
CREATE INDEX scheduled_meals_status_scheduled_for_idx ON scheduled_meals(status, scheduled_for)
  WHERE status = 'pending';
```

**Checklist:**
- [ ] Add migration
- [ ] Add Prisma model `ScheduledMeal`
- [ ] Wire up BullMQ delayed jobs to trigger reminders at `scheduled_for`
- [ ] Add GET /api/v1/schedule and POST /api/v1/schedule/meals endpoints

---

### `user_memory_embeddings` (Milestone 6)

**Purpose:** pgvector embeddings for semantic memory retrieval. Required for the Vector layer of the two-layer memory system.

```sql
-- Migration: 0005_add_memory_embeddings.sql
-- Requires pgvector extension to be enabled on the Neon instance.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE user_memory_embeddings (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content             TEXT        NOT NULL,
  embedding           vector(1536) NOT NULL,
  content_type        VARCHAR(50) NOT NULL, -- 'situation_summary', 'preference', 'outcome'
  source_situation_id UUID        REFERENCES situations(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- IVFFlat index for approximate nearest neighbor search
CREATE INDEX user_memory_embeddings_embedding_idx
  ON user_memory_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
CREATE INDEX user_memory_embeddings_user_id_idx
  ON user_memory_embeddings(user_id, content_type);
```

**Important:** IVFFlat requires training data. Create the index AFTER the table has at least 1,000 rows. During initial rollout:
1. Create table without the ivfflat index
2. Wait until 1,000+ embeddings are inserted
3. Create the index in a separate step (`CREATE INDEX CONCURRENTLY`)

**Checklist:**
- [ ] Enable pgvector on Neon database
- [ ] Add migration (table only, no index)
- [ ] Add Prisma model `UserMemoryEmbedding` (requires `@prisma/client` with vector support or raw queries)
- [ ] Wire up Memory Agent to generate and store embeddings after each situation
- [ ] Wait for 1,000 rows, then create IVFFlat index
- [ ] Update Context Agent to query embeddings for semantic retrieval

---

### `situation_agent_runs` (Milestone 2)

**Purpose:** Agent execution log for observability, cost tracking, and debugging. Non-blocking — failure to write must never block the agent pipeline.

```sql
-- Migration: 0006_add_situation_agent_runs.sql
CREATE TABLE situation_agent_runs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  situation_id     UUID        NOT NULL REFERENCES situations(id) ON DELETE CASCADE,
  agent_name       VARCHAR(100) NOT NULL,
  model_used       VARCHAR(100),
  status           VARCHAR(20) NOT NULL, -- 'running', 'completed', 'failed', 'timeout'
  input_tokens     INTEGER,
  output_tokens    INTEGER,
  latency_ms       INTEGER,
  input_snapshot   JSONB,
  output_snapshot  JSONB,
  error_message    TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ
);
CREATE INDEX situation_agent_runs_situation_id_idx ON situation_agent_runs(situation_id);
CREATE INDEX situation_agent_runs_agent_name_status_idx ON situation_agent_runs(agent_name, status, started_at DESC);
```

**Checklist:**
- [ ] Add migration
- [ ] Add Prisma model `SituationAgentRun`
- [ ] Add relation to `Situation` model
- [ ] Wrap all agent write calls in try-catch — a write failure MUST be silently swallowed and logged to Sentry
- [ ] Add Axiom dashboard for agent latency and token cost

---

### `analytics_events` (Milestone 8)

**Purpose:** Event tracking for product analytics and funnel analysis.

```sql
-- Migration: 0007_add_analytics_events.sql
CREATE TABLE analytics_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        REFERENCES users(id),
  session_id   UUID,
  event_name   VARCHAR(100) NOT NULL,
  event_data   JSONB,
  occurred_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
-- High-volume table: consider partitioning by occurred_at month in production
CREATE INDEX analytics_events_user_id_event_name_occurred_at_idx
  ON analytics_events(user_id, event_name, occurred_at DESC);
CREATE INDEX analytics_events_event_name_occurred_at_idx
  ON analytics_events(event_name, occurred_at DESC);
```

**Checklist:**
- [ ] Add migration
- [ ] Add Prisma model `AnalyticsEvent`
- [ ] Create `AnalyticsService` that writes events asynchronously (fire-and-forget, never awaited in request path)
- [ ] At 10M+ rows, add monthly RANGE partitioning on `occurred_at`
- [ ] Consider migrating to ClickHouse if analytical queries exceed 500ms on PostgreSQL

---

## 8. Seed Strategy

### What to seed and why

The seed creates a realistic development environment that covers every major workflow path without requiring real Swiggy MCP calls or live Clerk accounts.

### Seed users

| User | Profile | Purpose |
|---|---|---|
| Priya Sharma | Vegetarian, Mumbai, intermediate cook, Rs 350/day, shellfish allergy | Covers the vegetarian-dietary + clarification + budget-constrained workflows |
| Arjun Mehta | Non-vegetarian, Bangalore, beginner cook, Rs 500/day, 150g protein goal | Covers the nutrition-goal + date-planning + beginner-cook workflows |

### Seed situations

| Situation | User | Type | Outcome | Covers |
|---|---|---|---|---|
| "I'm feeling really sick" | Priya | SICK | ORDER: Khichdi from Haldiram's, ⭐⭐⭐⭐⭐ | Clarification engine (canCook + alone questions), ORDER path, Swiggy Food execution data |
| "Super broke this week" | Priya | BROKE | COOK: Dal-Chawal, ⭐⭐⭐⭐ | Budget clarification, COOK path, recipe steps, YouTube URL |
| "Need 150g protein today, leg day" | Arjun | NUTRITION_GOAL | COOK + Instamart: Eggs + Chicken plan, ⭐⭐⭐⭐ | No-clarification path (context complete from memory), Instamart items, mixed path |
| "Planning anniversary dinner tonight" | Arjun | DATE_PLANNING | DINE_OUT: Toscano Indiranagar, ⭐⭐⭐⭐⭐ | Full clarification (budget + occasion + indoor/outdoor), DINE_OUT path, Dineout booking data |

### What the seed enables in development

- **Auth flow testing:** Two Clerk IDs mapped to two internal users. Swap `clerk_id` in JWT claims during local testing.
- **Memory Panel UI:** Priya has 13 facts, Arjun has 13 facts — sufficient to render a full memory panel with all fact categories.
- **History Page UI:** Each user has 2 completed situations — enough to test pagination and history card rendering.
- **Situation Board UI:** Each situation has a full recommendation with realistic comparison scores, explanation text, and execution data. Test all three primary paths.
- **Action recording:** Each situation has a logged user action with a rating — tests the post-action state of the board.

### How to run

```bash
# Install dependencies (if not already done)
npm install @prisma/client
npm install -D prisma tsx

# Generate the Prisma client
npx prisma generate

# Apply migrations to your local database
npx prisma migrate dev --name init

# Run the seed
npx tsx prisma/seed.ts
```

### Adding to package.json for `npx prisma db seed`

```json
{
  "prisma": {
    "seed": "npx tsx prisma/seed.ts"
  }
}
```

### Seed idempotency

The seed script deletes existing seed rows (identified by hardcoded UUIDs) before reinserting. Running the seed twice produces the same result. This makes it safe to run during local development when iterating on seed data.

**Do not use `deleteMany({})` on all tables.** The seed script uses specific UUID filters to avoid destroying non-seed data in a shared development database.
