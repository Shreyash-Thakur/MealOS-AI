VERSION: 1.0.0

# Clarification Engine Prompt — MealOS AI

---

## Overview

The Clarification Engine generates questions when required context fields are missing after the Conversation Agent runs. It uses claude-haiku-4-5 and must batch all questions for a given pass together — never asking them sequentially. Maximum 3 questions per pass. Maximum 2 passes per situation.

---

## 1. QUESTION GENERATION SYSTEM PROMPT

> The global system context from `system.md` is prepended before this prompt at runtime.

```
You are the Clarification Engine for MealOS AI. Given missing context fields and a situation type, generate the minimum set of questions needed to complete the recommendation. Output a JSON object matching the ClarificationOutput schema. Maximum 3 questions per output. Never ask about a field that already appears in the known context.

Rules:
1. Phrase every question in the context of the specific situation — not as a generic form field
2. Every question must include 2–4 quick-tap options AND exactly one free-text fallback option
3. Options are mutually exclusive and cover the 3–4 most common answers
4. Option labels are 2–5 words maximum
5. The free-text fallback option is always labeled "Something else" or "Tell me more"
6. Never generate a yes/no question — every option must have a meaningful label
7. Sort questions by EVOI descending — the question whose answer most changes the recommendation goes first
8. For every soft field being skipped (because a memory default exists), generate one AssumptionStatement per skipped field group

You output raw JSON only. No prose, no markdown, no explanation. The first character of your response is {.
```

---

## 2. QUESTION GENERATION USER MESSAGE TEMPLATE

```
SITUATION TYPE: {{situation_type}}

MISSING REQUIRED FIELDS:
{{missing_fields_json}}

MISSING SOFT FIELDS:
{{missing_soft_fields_json}}

KNOWN CONTEXT (do not ask about these):
{{known_context_json}}

USER MEMORY SUMMARY:
{{user_memory_summary}}
```

### Variable Definitions

| Variable | Type | Description |
|---|---|---|
| `{{situation_type}}` | `string` | One of the 11 situation types from SituationContext |
| `{{missing_fields_json}}` | `{ field: string, priority: "required" }[]` | Fields in `missingRequired` from SituationContext — these must become questions |
| `{{missing_soft_fields_json}}` | `{ field: string, priority: "soft" }[]` | Fields in `missingSoft` — skip if a memory default exists; otherwise include if question budget allows |
| `{{known_context_json}}` | `object` | All fields already populated in `explicit`, `inferred`, and from memory — never ask about these |
| `{{user_memory_summary}}` | `string` | Plain-English summary of user memory facts. `null` if first session. |

---

## 3. OUTPUT SCHEMA

```typescript
interface Question {
  text: string                               // Full question text shown to user
  field: string                              // The SituationContext field this question resolves
  type: 'single_choice' | 'multi_choice' | 'number_input' | 'freetext'
  options: {
    label: string                            // Display text: 2–5 words max
    value: unknown                           // Value to set in SituationContext when selected
  }[]                                        // 2–4 options always; last option is free-text fallback
  required: boolean                          // true if field is in missingRequired
  evoi: 'high' | 'medium' | 'low'           // Expected value of information — determines sort order
}

interface AssumptionStatement {
  text: string                               // "Assuming you're alone and at home — is that right?"
  fields: string[]                           // SituationContext field names being assumed
  values: Record<string, unknown>            // The assumed values for those fields
  confirmable: boolean                       // true = user sees this and can correct it before planning proceeds
}

interface ClarificationOutput {
  questions: Question[]                      // Sorted by evoi descending. Max 3 items.
  assumptions: AssumptionStatement[]         // One per group of skipped soft fields. Can be empty [].
}
```

---

## 4. QUESTION BANK

Pre-written questions for the 10 most common missing fields. The engine uses these as templates and adjusts phrasing based on situation type.

---

### Field: `canCook`

**Sick context:**
```json
{
  "text": "Are you feeling up to cooking today, or should we find something to deliver?",
  "field": "canCook",
  "type": "single_choice",
  "options": [
    { "label": "I can manage", "value": true },
    { "label": "Need delivery", "value": false },
    { "label": "Someone can cook for me", "value": "assisted" },
    { "label": "Tell me more", "value": null }
  ],
  "required": true,
  "evoi": "high"
}
```

**General context:**
```json
{
  "text": "Do you want to cook, get delivery, or head out somewhere?",
  "field": "canCook",
  "type": "single_choice",
  "options": [
    { "label": "I'll cook", "value": true },
    { "label": "Order delivery", "value": false },
    { "label": "Dine out", "value": "dineout" },
    { "label": "Depends on options", "value": null }
  ],
  "required": true,
  "evoi": "high"
}
```

---

### Field: `alone`

**Sick context:**
```json
{
  "text": "Are you home alone, or is someone there who can help?",
  "field": "alone",
  "type": "single_choice",
  "options": [
    { "label": "Alone", "value": true },
    { "label": "Partner's home", "value": false },
    { "label": "Family's home", "value": false },
    { "label": "Something else", "value": null }
  ],
  "required": true,
  "evoi": "medium"
}
```

**General context:**
```json
{
  "text": "Just for you, or for others too?",
  "field": "alone",
  "type": "single_choice",
  "options": [
    { "label": "Just me", "value": true },
    { "label": "2 people", "value": false },
    { "label": "Family (3–5)", "value": false },
    { "label": "More than 5", "value": false }
  ],
  "required": false,
  "evoi": "medium"
}
```

---

### Field: `budget`

**Broke context:**
```json
{
  "text": "What can you comfortably spend on food today?",
  "field": "budget",
  "type": "single_choice",
  "options": [
    { "label": "Under Rs 100", "value": 100 },
    { "label": "Rs 100–200", "value": 200 },
    { "label": "Rs 200–300", "value": 300 },
    { "label": "Rs 300+", "value": 400 }
  ],
  "required": true,
  "evoi": "high"
}
```

**Date context:**
```json
{
  "text": "What's your budget for the evening?",
  "field": "budget",
  "type": "single_choice",
  "options": [
    { "label": "Under Rs 1500", "value": 1500 },
    { "label": "Rs 1500–3000", "value": 3000 },
    { "label": "Rs 3000–5000", "value": 5000 },
    { "label": "Flexible", "value": null }
  ],
  "required": true,
  "evoi": "high"
}
```

---

### Field: `guests`

**Party context:**
```json
{
  "text": "How many people are you expecting?",
  "field": "guests",
  "type": "single_choice",
  "options": [
    { "label": "5–8 people", "value": 6 },
    { "label": "10–15 people", "value": 12 },
    { "label": "15–20 people", "value": 17 },
    { "label": "20+", "value": 25 }
  ],
  "required": true,
  "evoi": "high"
}
```

**Family context:**
```json
{
  "text": "Cooking for how many?",
  "field": "guests",
  "type": "single_choice",
  "options": [
    { "label": "Just me", "value": 1 },
    { "label": "2 people", "value": 2 },
    { "label": "3–4 people", "value": 4 },
    { "label": "5+ people", "value": 5 }
  ],
  "required": true,
  "evoi": "high"
}
```

---

### Field: `indoorOutdoor`

**Date context:**
```json
{
  "text": "Are you thinking a cozy restaurant, or somewhere with a rooftop or outdoor vibe?",
  "field": "indoorOutdoor",
  "type": "single_choice",
  "options": [
    { "label": "Cozy indoor", "value": "indoor" },
    { "label": "Rooftop/outdoor", "value": "outdoor" },
    { "label": "Either works", "value": "either" }
  ],
  "required": true,
  "evoi": "medium"
}
```

**General context:**
```json
{
  "text": "Indoor restaurant or outdoor setting?",
  "field": "indoorOutdoor",
  "type": "single_choice",
  "options": [
    { "label": "Indoor", "value": "indoor" },
    { "label": "Outdoor", "value": "outdoor" },
    { "label": "No preference", "value": "either" }
  ],
  "required": false,
  "evoi": "medium"
}
```

---

### Field: `craving`

**Quick meal context:**
```json
{
  "text": "What are you in the mood for?",
  "field": "craving",
  "type": "single_choice",
  "options": [
    { "label": "Rice/Indian", "value": "indian" },
    { "label": "Sandwich/wrap", "value": "snack" },
    { "label": "Eggs/omelette", "value": "eggs" },
    { "label": "Something else", "value": null }
  ],
  "required": false,
  "evoi": "medium"
}
```

**General context:**
```json
{
  "text": "What sounds good right now?",
  "field": "craving",
  "type": "single_choice",
  "options": [
    { "label": "Something spicy", "value": "spicy" },
    { "label": "Light and healthy", "value": "light" },
    { "label": "Comfort food", "value": "comfort" },
    { "label": "Tell me more", "value": null }
  ],
  "required": false,
  "evoi": "medium"
}
```

---

### Field: `timeframe`

**Meal prep context:**
```json
{
  "text": "Which meals are you planning for?",
  "field": "timeframe",
  "type": "single_choice",
  "options": [
    { "label": "Lunches only", "value": "lunches" },
    { "label": "Dinners only", "value": "dinners" },
    { "label": "Lunch + dinner", "value": "both" },
    { "label": "All meals", "value": "all" }
  ],
  "required": true,
  "evoi": "high"
}
```

**General context:**
```json
{
  "text": "When do you need this?",
  "field": "timeframe",
  "type": "single_choice",
  "options": [
    { "label": "Right now", "value": "now" },
    { "label": "Tonight", "value": "tonight" },
    { "label": "This week", "value": "week" }
  ],
  "required": false,
  "evoi": "medium"
}
```

---

### Field: `occasion`

**Date context:**
```json
{
  "text": "Is this a first date, or are you and your partner already together?",
  "field": "occasion",
  "type": "single_choice",
  "options": [
    { "label": "First date", "value": "first_date" },
    { "label": "Anniversary", "value": "anniversary" },
    { "label": "Regular date night", "value": "date_night" },
    { "label": "Special occasion", "value": "special" }
  ],
  "required": false,
  "evoi": "medium"
}
```

**Party context:**
```json
{
  "text": "What's the occasion?",
  "field": "occasion",
  "type": "single_choice",
  "options": [
    { "label": "Birthday", "value": "birthday" },
    { "label": "Sports/IPL", "value": "sports" },
    { "label": "Casual hangout", "value": "casual" },
    { "label": "Something else", "value": null }
  ],
  "required": false,
  "evoi": "low"
}
```

---

### Field: `proteinTarget`

**Nutrition goal context:**
```json
{
  "text": "What's your protein target for today?",
  "field": "nutritionGoal.protein",
  "type": "single_choice",
  "options": [
    { "label": "100g", "value": 100 },
    { "label": "120g", "value": 120 },
    { "label": "150g", "value": 150 },
    { "label": "180g+", "value": 180 }
  ],
  "required": true,
  "evoi": "high"
}
```

---

### Field: `dietaryNote`

**General context:**
```json
{
  "text": "Any dietary requirements we should know about?",
  "field": "dietaryNote",
  "type": "single_choice",
  "options": [
    { "label": "Vegetarian", "value": "vegetarian" },
    { "label": "Vegan", "value": "vegan" },
    { "label": "Non-veg is fine", "value": "none" },
    { "label": "I have allergies", "value": null }
  ],
  "required": false,
  "evoi": "medium"
}
```

Note: if the user selects "I have allergies", the follow-up uses a `freetext` type question: "What are you allergic to?" — this counts as the second question in the batch, not a new pass.

---

## 5. ASSUMPTION STATEMENT RULES

When a soft field is being skipped because a memory default exists, generate an AssumptionStatement. The planning flow uses this value but shows the assumption to the user so they can correct it before planning proceeds.

**Template format:** `"Assuming [concrete assumed value in plain English] — is that right?"`

**Rules:**
- State the assumed value concretely — "Assuming your usual budget of around Rs 350" not "Assuming the usual"
- Include only fields whose assumed values materially affect the recommendation
- Combine up to 3 related fields into one sentence
- Always end with `— is that right?`
- Set `confirmable: true` for all budget, location, and dietary assumptions
- Set `confirmable: false` for minor inferences (timeOfDay from current_time)

**Examples:**

Budget defaulted from memory (Rs 350):
```json
{
  "text": "Assuming your usual budget of around Rs 350 — is that right?",
  "fields": ["budget"],
  "values": { "budget": 350 },
  "confirmable": true
}
```

Location defaulted from memory (Bandra):
```json
{
  "text": "Assuming you're in Bandra — right?",
  "fields": ["location"],
  "values": { "location": "Bandra" },
  "confirmable": true
}
```

Alone + location both inferred:
```json
{
  "text": "Assuming you're home alone — is that right?",
  "fields": ["alone", "location"],
  "values": { "alone": true, "location": "home" },
  "confirmable": true
}
```

---

## 6. COMPLETE FLOW EXAMPLES

---

### Example 1: Sick User

**Input:**
```
SITUATION TYPE: sick
MISSING REQUIRED FIELDS: [{"field":"canCook","priority":"required"},{"field":"alone","priority":"required"}]
MISSING SOFT FIELDS: []
KNOWN CONTEXT: {"sick":true}
USER MEMORY SUMMARY: Diet is vegetarian. Daily food budget is Rs 350. Home location is Andheri West, Mumbai. Cooking skill is intermediate.
```

**Output:**
```json
{
  "questions": [
    {
      "text": "Are you feeling up to cooking today, or should we find something to deliver?",
      "field": "canCook",
      "type": "single_choice",
      "options": [
        { "label": "I can manage", "value": true },
        { "label": "Need delivery", "value": false },
        { "label": "Someone can cook for me", "value": "assisted" },
        { "label": "Tell me more", "value": null }
      ],
      "required": true,
      "evoi": "high"
    },
    {
      "text": "Are you home alone, or is someone there who can help?",
      "field": "alone",
      "type": "single_choice",
      "options": [
        { "label": "Alone", "value": true },
        { "label": "Partner's home", "value": false },
        { "label": "Family's home", "value": false },
        { "label": "Something else", "value": null }
      ],
      "required": true,
      "evoi": "medium"
    }
  ],
  "assumptions": [
    {
      "text": "Assuming your usual budget of Rs 350 — is that right?",
      "fields": ["budget"],
      "values": { "budget": 350 },
      "confirmable": true
    }
  ]
}
```

**After answers** (canCook=false, alone=true, budget confirmed): Context is complete. Planning Agent fires immediately. Memory Agent will store `canCook: false` at 0.4 confidence with 30-day expiry.

---

### Example 2: Date Planning

**Input:**
```
SITUATION TYPE: date_planning
MISSING REQUIRED FIELDS: [{"field":"budget","priority":"required"},{"field":"indoorOutdoor","priority":"required"}]
MISSING SOFT FIELDS: [{"field":"occasion","priority":"soft"}]
KNOWN CONTEXT: {"timeframe":"tonight","location":"Bandra"}
USER MEMORY SUMMARY: Home location is Bandra, Mumbai. Diet is vegetarian. No budget on record.
```

**Output:**
```json
{
  "questions": [
    {
      "text": "What's your budget for the evening?",
      "field": "budget",
      "type": "single_choice",
      "options": [
        { "label": "Under Rs 1500", "value": 1500 },
        { "label": "Rs 1500–3000", "value": 3000 },
        { "label": "Rs 3000–5000", "value": 5000 },
        { "label": "Flexible", "value": null }
      ],
      "required": true,
      "evoi": "high"
    },
    {
      "text": "Are you thinking a cozy restaurant, or somewhere with a rooftop or outdoor vibe?",
      "field": "indoorOutdoor",
      "type": "single_choice",
      "options": [
        { "label": "Cozy indoor", "value": "indoor" },
        { "label": "Rooftop/outdoor", "value": "outdoor" },
        { "label": "Either works", "value": "either" }
      ],
      "required": true,
      "evoi": "medium"
    }
  ],
  "assumptions": []
}
```

**Why no `occasion` question:** `occasion` is a soft field with no memory default. But 2 required questions are already in the batch and question budget is limited. `occasion` is the lowest EVOI of the three — it is dropped. Planning Agent handles unknown occasion as "regular date night" by default.

**After answers** (budget=2000, indoorOutdoor="outdoor"): Tool Agent fetches Dineout venues in Bandra filtered by budget Rs 2000 and ambience="rooftop" OR "outdoor".

---

### Example 3: Party Hosting

**Input:**
```
SITUATION TYPE: party_hosting
MISSING REQUIRED FIELDS: [{"field":"guests","priority":"required"},{"field":"budget","priority":"required"}]
MISSING SOFT FIELDS: []
KNOWN CONTEXT: {"occasion":"IPL final","timeframe":"week"}
USER MEMORY SUMMARY: Home location is Powai, Mumbai. Can cook. Diet is vegetarian.
```

**Output:**
```json
{
  "questions": [
    {
      "text": "How many people are you expecting for the IPL final?",
      "field": "guests",
      "type": "single_choice",
      "options": [
        { "label": "5–8 people", "value": 6 },
        { "label": "10–15 people", "value": 12 },
        { "label": "15–20 people", "value": 17 },
        { "label": "20+", "value": 25 }
      ],
      "required": true,
      "evoi": "high"
    },
    {
      "text": "What's your total food budget for the evening?",
      "field": "budget",
      "type": "single_choice",
      "options": [
        { "label": "Under Rs 1500", "value": 1500 },
        { "label": "Rs 1500–3000", "value": 3000 },
        { "label": "Rs 3000–5000", "value": 5000 },
        { "label": "Rs 5000+", "value": 7000 }
      ],
      "required": true,
      "evoi": "high"
    }
  ],
  "assumptions": []
}
```

**Occasion context in question text:** "for the IPL final" is incorporated directly into the guests question to maintain contextual phrasing.

**After answers** (guests=12, budget=3000): Planning Agent produces multi-restaurant order plan with Rs 250/head constraint.

---

### Example 4: Quick Meal, Memory-Rich User

**Input:**
```
SITUATION TYPE: quick_meal
MISSING REQUIRED FIELDS: []
MISSING SOFT FIELDS: [{"field":"craving","priority":"soft"}]
KNOWN CONTEXT: {"timeConstraintMinutes":20,"canCook":true}
USER MEMORY SUMMARY: Can cook. Pantry has eggs, bread, cheese, butter. Daily budget is Rs 300. Home, alone.
```

**Output:**
```json
{
  "questions": [
    {
      "text": "What are you in the mood for?",
      "field": "craving",
      "type": "single_choice",
      "options": [
        { "label": "Rice/Indian", "value": "indian" },
        { "label": "Sandwich/wrap", "value": "snack" },
        { "label": "Eggs/omelette", "value": "eggs" },
        { "label": "Something else", "value": null }
      ],
      "required": false,
      "evoi": "medium"
    }
  ],
  "assumptions": [
    {
      "text": "Assuming you're home alone with your usual budget of Rs 300 — is that right?",
      "fields": ["alone", "location", "budget"],
      "values": { "alone": true, "location": "home", "budget": 300 },
      "confirmable": true
    }
  ]
}
```

**After answer** (craving="eggs"): Cook path, egg sandwich or omelette recipe using pantry items. No Swiggy call needed — full pantry coverage.

---

### Example 5: Zero-Context First-Time User

**Input:**
```
SITUATION TYPE: general
MISSING REQUIRED FIELDS: [{"field":"craving","priority":"required"},{"field":"budget","priority":"required"},{"field":"canCook","priority":"required"}]
MISSING SOFT FIELDS: [{"field":"alone","priority":"soft"},{"field":"location","priority":"soft"}]
KNOWN CONTEXT: {}
USER MEMORY SUMMARY: null
```

**Output:**
```json
{
  "questions": [
    {
      "text": "Do you want to cook, get delivery, or head out somewhere?",
      "field": "canCook",
      "type": "single_choice",
      "options": [
        { "label": "I'll cook", "value": true },
        { "label": "Order delivery", "value": false },
        { "label": "Dine out", "value": "dineout" },
        { "label": "Depends on options", "value": null }
      ],
      "required": true,
      "evoi": "high"
    },
    {
      "text": "What sounds good right now?",
      "field": "craving",
      "type": "single_choice",
      "options": [
        { "label": "Something spicy", "value": "spicy" },
        { "label": "Light and healthy", "value": "light" },
        { "label": "Comfort food", "value": "comfort" },
        { "label": "Tell me more", "value": null }
      ],
      "required": true,
      "evoi": "medium"
    },
    {
      "text": "What can you spend on this meal?",
      "field": "budget",
      "type": "single_choice",
      "options": [
        { "label": "Under Rs 100", "value": 100 },
        { "label": "Rs 100–250", "value": 250 },
        { "label": "Rs 250–500", "value": 500 },
        { "label": "Rs 500+", "value": 700 }
      ],
      "required": true,
      "evoi": "medium"
    }
  ],
  "assumptions": []
}
```

**After answers**: Context built from scratch. Planning Agent fires. Memory Agent stores any stated preferences from these answers.

---

## CHANGELOG

| Date | Version | Change | Reason |
|---|---|---|---|
| 2026-07-05 | 1.0.0 | Initial clarification engine prompt | Pre-production baseline |
