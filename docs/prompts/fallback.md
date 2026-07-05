VERSION: 1.0.0

# Fallback and Degraded Mode Prompts — MealOS AI

---

## Overview

Every failure scenario in MealOS has a specific, deterministic response. There are no silent failures, no generic error messages, and no blank screens. This file defines the prompts, output schemas, and static text for all degraded operating modes.

Six degraded scenarios are covered:
1. Swiggy unavailable → cook-only mode
2. No recipes found → manual shopping list
3. All paths score below 40 → low-confidence recommendation
4. Non-food input → redirect
5. LLM timeout → static template by situation type
6. User offline → cached recommendation display

---

## 1. SWIGGY UNAVAILABLE — COOK-ONLY MODE

**Trigger:** Tool Agent returns `swiggyError: "SWIGGY_UNAVAILABLE"` in its output.

**Effect:** This block is injected at the top of the Planning Agent's system prompt, before its standard instructions.

```
DEGRADED MODE ACTIVE: SWIGGY_UNAVAILABLE

Swiggy is currently unavailable. The restaurants, dineout venues, and instamart data in your input will be null. Apply these rules for this call only:

1. If the Cook path score is highest OR if all scores are within 15 points of each other: proceed with the Cook path. Use pantry data and YouTube data normally.
2. If the Order or Dineout path score is highest AND Cook score is below 30: the user may not be able to cook. Apply rule 3.
3. If Cook score is below 30 (canCook=false in context): output the low-confidence schema. Set explanation to the exact string: "Delivery is temporarily unavailable in your area, and cooking isn't an option right now." Set primaryPath to "cook" anyway — it is the only viable output.
4. Do not mention the word "Swiggy" in any output field. Use "delivery" or "ordering" instead.
5. Set degradedMode: "swiggy_unavailable" in the output.
```

**User-facing explanation string** (injected into the `explanation` field when Cook wins in degraded mode):
```
Delivery is temporarily unavailable in your area. Here's the best home cooking option based on what you have.
```

**Schema addition for degraded mode** (add this field to PlanningAgentOutput when active):
```typescript
degradedMode: 'swiggy_unavailable' | null
```

**Example output when Swiggy is down and Cook path wins:**
```json
{
  "explanation": "Delivery is temporarily unavailable in your area. Here's the best home cooking option based on what you have.",
  "primaryPath": "cook",
  "confidence": "medium",
  "degradedMode": "swiggy_unavailable",
  "recommendation": {
    "title": "Dal-Chawal",
    "description": "You have the pantry staples for a complete meal. Pressure-cook dal with turmeric and salt, boil rice, and a quick cumin tempering brings it together in 25 minutes.",
    "estimatedCost": 0,
    "estimatedTime": 25
  },
  "whyNotAlternatives": [
    { "path": "order", "reason": "Delivery is unavailable right now." },
    { "path": "dineout", "reason": "No venue data available in this mode." }
  ]
}
```

---

## 2. NO RECIPES FOUND — MANUAL SHOPPING LIST

**Trigger:** Cook path wins (highest score) but the Recipe/Tool pipeline cannot generate a recipe — either the pantry is completely empty, the user's cooking skill is `"beginner"` with no simple recipes matching the craving, or the requested cuisine has no available recipe data.

**Effect:** This instruction block is appended to the Planning Agent's system prompt for this call.

```
NO RECIPE AVAILABLE: SHOPPING LIST MODE

No suitable recipe was found for this situation. Do not attempt to generate recipe steps. Instead:
1. Set recommendation.title to a descriptive "Shopping List" title that names the dish.
2. Set recommendation.description to 1–2 sentences: what to buy and the simplest possible preparation instruction.
3. Populate recommendation.ingredients with the items to buy. Set inPantry: false for all items.
4. Do not populate recipeSteps.
5. Set estimatedTime to the realistic prep time after shopping (not including travel).
6. Set estimatedCost to the estimated total ingredient cost in INR.
```

**Canonical output format:**
```json
{
  "explanation": "The easiest path here is picking up a few items and putting together a simple meal.",
  "primaryPath": "cook",
  "confidence": "medium",
  "recommendation": {
    "title": "Simple Dal-Rice — buy these items",
    "description": "Pick up toor dal, rice, one onion, and one tomato from the nearest store. Pressure cook the dal for 15 minutes, boil the rice separately, and season with salt. Total cook time after shopping: 30 minutes.",
    "estimatedCost": 60,
    "estimatedTime": 30,
    "ingredients": [
      { "name": "Toor dal", "qty": "100g", "inPantry": false },
      { "name": "Basmati rice", "qty": "100g", "inPantry": false },
      { "name": "Onion", "qty": "1 medium", "inPantry": false },
      { "name": "Tomato", "qty": "1 medium", "inPantry": false },
      { "name": "Salt", "qty": "to taste", "inPantry": false },
      { "name": "Oil", "qty": "1 tbsp", "inPantry": false }
    ]
  },
  "whyNotAlternatives": [
    { "path": "order", "reason": "Ordering costs more and covers fewer meals than cooking this from scratch." },
    { "path": "dineout", "reason": "No dineout context or occasion was identified for this situation." }
  ]
}
```

---

## 3. ALL PATHS SCORE BELOW 40 — LOW-CONFIDENCE RECOMMENDATION

**Trigger:** All three values in `pre_calculated_scores_json` are below 40. This indicates severe binding constraints — for example, the user cannot cook, there is no delivery, and the budget is too low for dineout.

**Effect:** This block is appended to the Planning Agent's system prompt for this call.

```
LOW CONFIDENCE MODE: ALL PATHS SCORE BELOW 40

All three paths are severely constrained. Apply these rules:
1. Identify the highest-scoring path (even if it scores below 40) — this is still the primary path.
2. In the explanation field, state the binding constraint plainly in plain English. Do not soften it.
3. End the explanation with an invitation to clarify: "If [key constraint] changes, tell me and I'll re-plan."
4. Set confidence: "low" in the output.
5. Populate the recommendation schema normally for the highest-scoring path, even if the recommendation is imperfect.
6. Do not refuse to produce a recommendation. A low-confidence recommendation is better than no recommendation.
```

**User-facing explanation format:**
```
There are some real constraints here — [state the binding constraint in 1 sentence, e.g., "you can't cook right now and your budget of Rs 80 rules out most delivery options"]. The best available option given those limits is [brief description]. If [the key constraint, e.g., "your budget situation"] changes, tell me and I'll re-plan.
```

**Worked example** (canCook=false, budget=Rs 80, no delivery under Rs 100 in area):
```json
{
  "explanation": "There are some real constraints here — you can't cook right now and Rs 80 rules out most delivery options in your area. The closest option is a local tea stall or convenience store meal, which won't be on any app. If your budget shifts above Rs 100, tell me and I'll find the best Swiggy option immediately.",
  "primaryPath": "order",
  "confidence": "low",
  "recommendation": {
    "title": "Nearest convenience store or tea stall",
    "description": "With Rs 80, a local tea stall (chai + samosa ~Rs 40–60) or convenience store snack is the most realistic option. Not something MealOS can execute in-app, but it fits the constraint.",
    "estimatedCost": 50,
    "estimatedTime": 10
  },
  "whyNotAlternatives": [
    { "path": "cook", "reason": "Cooking isn't an option right now as stated." },
    { "path": "dineout", "reason": "All dineout venues require a minimum spend above the current budget." }
  ]
}
```

---

## 4. NON-FOOD INPUT — REDIRECT

**Trigger:** Conversation Agent returns `confidence < 30` AND `situationType` could not be assigned above `"general"`. This indicates the user's input is either clearly not food-related or too ambiguous to classify.

**Effect:** The normal Planning Agent pipeline is bypassed entirely. This redirect schema is returned directly from the API layer without an LLM call.

**System prompt for redirect generation** (only used if real-time redirect message generation is needed):
```
The user's input does not appear to be food-related or is too ambiguous to produce a food recommendation. Do not generate a food plan. Output only the RedirectOutput schema below. Choose the message that best matches the input: "non_food" if the input is clearly about something other than food, "ambiguous" if the input could be food-related but lacks enough signal.
```

**Output schema:**
```typescript
interface RedirectOutput {
  isRedirect: true
  redirectType: 'non_food' | 'ambiguous'
  message: string          // What MealOS does + invitation to re-enter
  examples: string[]       // 3 example inputs that work
}
```

**Prewritten redirect: Non-food input** (use when input is clearly off-topic — e.g., "help me with my resume", "what's the weather"):
```json
{
  "isRedirect": true,
  "redirectType": "non_food",
  "message": "MealOS plans meals — describe your food situation and I'll figure out the best path (cook, order, or dine out). What's going on with food right now?",
  "examples": [
    "I'm tired and hungry, don't want to cook",
    "Need 150g protein today, vegetarian",
    "Planning a dinner date tonight in Bandra"
  ]
}
```

**Prewritten redirect: Ambiguous input** (use when input could be food-related but has no extractable signal — e.g., "something good", "help me", "ideas"):
```json
{
  "isRedirect": true,
  "redirectType": "ambiguous",
  "message": "Tell me a bit more — are you hungry right now, or planning ahead? Any budget, time, or dietary constraints?",
  "examples": [
    "I'm hungry, can spend Rs 200, don't feel like cooking",
    "Quick lunch, 20 minutes max",
    "Sick and need something easy to eat"
  ]
}
```

**Selection rule:** Use `"non_food"` if the input contains zero food-adjacent vocabulary (no hunger, meal, eat, cook, order, food, restaurant, delivery, hungry, drink, snack). Use `"ambiguous"` if it contains at least one food-adjacent word but lacks enough context to classify.

---

## 5. LLM TIMEOUT — STATIC TEMPLATES BY SITUATION TYPE

**Trigger:** Planning Agent call exceeds 10,000ms (10-second timeout threshold). The orchestrator cancels the LLM call and returns the static template for the detected situation type.

**Rule:** These responses are served directly from the API layer as hardcoded JSON objects. No LLM call is made. The orchestrator selects the template using `situation.situationType` from the Conversation Agent output.

**All static templates conform to the PlanningAgentOutput schema. `confidence` is always `"low"`. `whyNotAlternatives` is always `[]`. `degradedMode` is not set.**

---

### Template: `sick`

```json
{
  "explanation": "When you're unwell, light warm food is best — something easy to digest that doesn't require effort to eat.",
  "primaryPath": "order",
  "confidence": "low",
  "recommendation": {
    "title": "Khichdi or light soup delivery",
    "description": "Search 'khichdi' or 'clear soup' on Swiggy. Haldiram's, Behrouz, or any Indian restaurant with a comfort section will have options. Aim for something under Rs 200 and with a delivery time under 35 minutes.",
    "estimatedCost": 180,
    "estimatedTime": 35
  },
  "whyNotAlternatives": []
}
```

---

### Template: `broke`

```json
{
  "explanation": "Dal-chawal is the most cost-efficient complete meal in any Indian kitchen — it costs under Rs 30 and covers two meals.",
  "primaryPath": "cook",
  "confidence": "low",
  "recommendation": {
    "title": "Dal-Chawal",
    "description": "If you have dal, rice, oil, and salt — you have a full meal. Boil the dal (15 min), cook the rice (15 min), add a small cumin tempering if you have it. Total cost under Rs 30, covers lunch and dinner.",
    "estimatedCost": 30,
    "estimatedTime": 25
  },
  "whyNotAlternatives": []
}
```

---

### Template: `quick_meal`

```json
{
  "explanation": "Under 15 minutes from your kitchen — no shopping needed.",
  "primaryPath": "cook",
  "confidence": "low",
  "recommendation": {
    "title": "Egg Bhurji or Omelette",
    "description": "2 eggs scrambled with onion, tomato, and spices takes 10 minutes. Pair with bread or leftover roti. If no eggs, bread with peanut butter or jam is ready in 3 minutes.",
    "estimatedCost": 20,
    "estimatedTime": 12
  },
  "whyNotAlternatives": []
}
```

---

### Template: `date_planning`

```json
{
  "explanation": "A table at a well-reviewed neighbourhood restaurant is the safest date choice — familiar enough to be comfortable, good enough to impress.",
  "primaryPath": "dineout",
  "confidence": "low",
  "recommendation": {
    "title": "Book a table via Swiggy Dineout",
    "description": "Open Swiggy Dineout, filter by your area and budget, sort by rating. Look for any restaurant rated 4.0+ with available slots tonight. Book directly in-app — confirmation is instant.",
    "estimatedCost": 2000,
    "estimatedTime": 0
  },
  "whyNotAlternatives": []
}
```

---

### Template: `nutrition_goal`

```json
{
  "explanation": "High-protein home cooking is the most cost-effective way to hit macro targets — ordering protein-rich food costs 3x more for the same gram count.",
  "primaryPath": "cook",
  "confidence": "low",
  "recommendation": {
    "title": "Eggs + Dal + Paneer combination",
    "description": "3 eggs (18g protein) + 100g paneer (18g protein) + 100g cooked dal (9g protein) = approximately 45g protein per meal. Repeat this twice today with rice or roti. Total ingredient cost under Rs 100.",
    "estimatedCost": 90,
    "estimatedTime": 25
  },
  "whyNotAlternatives": []
}
```

---

### Template: `meal_prep`

```json
{
  "explanation": "Batch-cooking dal, rice, and one dry sabzi on Sunday covers five weekday lunches for under Rs 200.",
  "primaryPath": "cook",
  "confidence": "low",
  "recommendation": {
    "title": "Sunday Meal Prep — Dal, Rice, Aloo Sabzi",
    "description": "Cook 500g toor dal (covers 5 servings), 1kg basmati rice, and a dry aloo jeera or any dry sabzi of your choice. Refrigerate in individual containers. Each meal reheats in 3 minutes. Total prep time: 45 minutes.",
    "estimatedCost": 180,
    "estimatedTime": 45
  },
  "whyNotAlternatives": []
}
```

---

### Template: `general`

```json
{
  "explanation": "Without more context, ordering is the lowest-effort option with the widest selection.",
  "primaryPath": "order",
  "confidence": "low",
  "recommendation": {
    "title": "Open Swiggy and order",
    "description": "Open Swiggy, sort by 'Fast delivery', filter by your dietary preference. Pick anything rated 4.0+ that delivers in under 30 minutes. Most cities have options under Rs 200 that meet this filter.",
    "estimatedCost": 200,
    "estimatedTime": 30
  },
  "whyNotAlternatives": []
}
```

---

### Template: `party_hosting`

```json
{
  "explanation": "For a group, spreading orders across two restaurants avoids single-restaurant minimum order constraints and reduces variety risk.",
  "primaryPath": "order",
  "confidence": "low",
  "recommendation": {
    "title": "Multi-restaurant party order strategy",
    "description": "Split the order: one restaurant for mains (biryani or a rice dish for the group), one for snacks/starters (momos or wraps). Order starters first, schedule mains to arrive 40 minutes later. Search Swiggy for 'party platter' or 'group meal' in your area.",
    "estimatedCost": 1500,
    "estimatedTime": 40
  },
  "whyNotAlternatives": []
}
```

---

### Template: `office_lunch`

```json
{
  "explanation": "Ordering to the office is faster and more practical than cooking or dining out during a work day.",
  "primaryPath": "order",
  "confidence": "low",
  "recommendation": {
    "title": "Quick office delivery",
    "description": "Open Swiggy, filter by 'Under 30 minutes', sort by rating. Look for lunch bowls, thali, or wraps — they travel well and are easy to eat at a desk. Most options in commercial areas are under Rs 200.",
    "estimatedCost": 180,
    "estimatedTime": 28
  },
  "whyNotAlternatives": []
}
```

---

### Template: `late_night`

```json
{
  "explanation": "Late-night options are limited — delivery coverage drops after 11 PM and cooking is the most reliable path.",
  "primaryPath": "cook",
  "confidence": "low",
  "recommendation": {
    "title": "Quick fridge raid — eggs or instant noodles",
    "description": "At this hour, check your fridge first: eggs (10 min), leftover rice + anything (5 min), or instant noodles (3 min). If nothing's available, Swiggy may have a few late-night restaurants — search 'late night delivery' and filter by 'Open now'.",
    "estimatedCost": 15,
    "estimatedTime": 10
  },
  "whyNotAlternatives": []
}
```

---

### Template: `family_dinner`

```json
{
  "explanation": "For a household meal, cooking is the most cost-effective path — ordering family-sized quantities from Swiggy costs 2–3x more for the same dishes.",
  "primaryPath": "cook",
  "confidence": "low",
  "recommendation": {
    "title": "Dal, sabzi, roti — the reliable family dinner",
    "description": "A standard Indian dinner: 300g dal, one dry sabzi (potato or paneer), and roti/rice takes 35–40 minutes and serves 3–4 people for under Rs 150. Check your pantry for dal and staple vegetables before ordering anything.",
    "estimatedCost": 150,
    "estimatedTime": 40
  },
  "whyNotAlternatives": []
}
```

---

## 6. USER OFFLINE — DISPLAY STRINGS

**Trigger:** Client-side network detection returns offline before the API call is initiated (navigator.onLine === false).

These are client-side display strings, not LLM outputs. They are hardcoded in the frontend.

---

**Case 1: Offline, cached recommendation exists and is <24 hours old**
```
You're offline. Showing your last recommendation.
```

**Case 2: Offline, no cached recommendation exists**
```
You're offline and there's no saved recommendation to show. Connect to the internet and describe your situation — MealOS will plan your meal.
```

**Case 3: Offline, cached recommendation exists but is >24 hours old**
```
You're offline. This recommendation is from {{relative_time}} — prices and availability may have changed.
```

Replace `{{relative_time}}` with a human-readable relative timestamp:
- Same day → "earlier today"
- Yesterday → "yesterday"
- 2–6 days ago → "X days ago"
- 7+ days ago → "last week"

**Case 4: Connection restored after offline period**
```
You're back online. Your last recommendation is shown below — tap to refresh for updated availability.
```

---

## CHANGELOG

| Date | Version | Change | Reason |
|---|---|---|---|
| 2026-07-05 | 1.0.0 | Initial fallback prompt library | Pre-production baseline |
