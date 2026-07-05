# MealOS AI Code Style Guide

This document describes the coding standards specific to MealOS AI. It is not a generic TypeScript style guide — it covers the patterns, constraints, and conventions that are specific to how this codebase is structured.

Prettier and ESLint handle formatting automatically. These rules cover the things linters cannot catch.

---

## TypeScript Standards

### `strict: true` is non-negotiable

`tsconfig.json` has `"strict": true`. This is a project-wide constraint that enables:
- `strictNullChecks` — `null` and `undefined` are not assignable to other types without explicit handling. This alone eliminates an entire class of runtime errors.
- `noImplicitAny` — every value must have a known type.
- `strictFunctionTypes` — function parameter types are checked contravariantly.
- `strictPropertyInitialization` — class properties must be initialized in the constructor.

Do not add `// @ts-ignore` or `// @ts-expect-error` without a comment explaining why. If you are fighting the type system, you are probably doing something that needs a different approach.

### `type` over `interface` for data shapes

Use `type` for all data shapes. Use `interface` only when you need declaration merging (rare) or when defining a contract for a class to implement.

```typescript
// Correct — data shape
type MealPlan = {
  id: string;
  userId: string;
  situationId: string;
  options: MealOption[];
  createdAt: Date;
};

// Correct — class contract
interface Repository<T> {
  findById(id: string): Promise<T | null>;
  save(entity: T): Promise<T>;
}

// Wrong — interface used for a plain data shape
interface MealPlan { ... }
```

### Enums: use `as const` objects, not TypeScript enums

TypeScript enums compile to runtime objects and have surprising behavior at the edges. Use `as const` objects instead.

```typescript
// Correct
const SituationKind = {
  LateNightSnack: 'late_night_snack',
  WorkLunchBreak: 'work_lunch_break',
  PostWorkout: 'post_workout',
} as const;

type SituationKind = typeof SituationKind[keyof typeof SituationKind];

// Wrong
enum SituationKind {
  LateNightSnack = 'late_night_snack',
  ...
}
```

### Never use `any`

`any` turns off the type checker for that value and all values derived from it. If you need an escape hatch:
- Use `unknown` and write a type guard to narrow it.
- Use a specific union type.
- If the value genuinely could be anything (e.g., JSON from an external API), use `unknown` and validate with a schema library.

```typescript
// Wrong
function parseAgentOutput(raw: any): MealPlan { ... }

// Correct
function parseAgentOutput(raw: unknown): MealPlan {
  if (!isMealPlan(raw)) throw new Error('Invalid agent output shape');
  return raw;
}
```

### JSDoc on all exported functions

Every function exported from a module needs a JSDoc comment with `@param`, `@returns`, and a one-line description. This shows up in editor hover tooltips and makes the codebase navigable without jumping to source.

```typescript
/**
 * Scores a meal option against a situation using the weight table for that situation type.
 * @param option - The meal option to score
 * @param situation - The current user situation
 * @returns A score between 0 and 1, where 1 is a perfect match
 */
export function scoreMealOption(option: MealOption, situation: Situation): number { ... }
```

### Return type annotations on all exported functions

Even when TypeScript can infer the return type, annotate it explicitly on exported functions. This makes the public API explicit and catches regressions when an internal change accidentally broadens the return type.

```typescript
// Correct
export function getSituationScore(id: string): Promise<number | null> { ... }

// Wrong — inferred return type, no annotation
export function getSituationScore(id: string) { ... }
```

---

## Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| Utility files | `camelCase.ts` | `lib/youtube.ts`, `lib/sse.ts` |
| React component files | `PascalCase.tsx` | `MealBoard.tsx` |
| Component CSS modules | `PascalCase.module.css` | `MealBoard.module.css` |
| React hooks | `useCamelCase.ts` | `useSSE.ts`, `usePlan.ts` |
| Types | PascalCase, in `types/` | `types/situations.ts` → `type Situation = ...` |
| Database models | PascalCase (Prisma convention) | `model MealPlan`, `model Situation` |
| API route files | `route.ts` | `app/api/plans/route.ts` |
| Agent files | `lib/agents/agentName.ts` | `lib/agents/planningAgent.ts` |
| Error codes | `SCREAMING_SNAKE_CASE` | `SITUATION_NOT_FOUND` |

Components are colocated with their CSS module in their domain directory:
```
components/board/MealBoard.tsx
components/board/MealBoard.module.css
```

---

## Agent Development Standards

### Every agent call is wrapped in a try-catch with a typed fallback

Agents call external APIs. External APIs fail. Always catch and return a typed error result instead of throwing.

```typescript
// Correct
export async function runPlanningAgent(input: PlanningInput): Promise<PlanningResult> {
  try {
    const response = await claude.messages.create({ ... });
    return parsePlanningResponse(response);
  } catch (error) {
    logger.error('planningAgent failed', { input, error });
    return { success: false, error: 'Planning agent unavailable. Please try again.' };
  }
}

// Wrong — throws, crashing the API route
export async function runPlanningAgent(input: PlanningInput): Promise<PlanningResult> {
  const response = await claude.messages.create({ ... }); // can throw
  return parsePlanningResponse(response);
}
```

### Never throw from an agent — return a typed result

Agent functions return `{ success: true, data: T }` or `{ success: false, error: string }`. The caller decides what to do with a failure. This pattern keeps the error handling explicit and testable.

### Validate agent output before using it

Claude's output is text. Parse it, then validate it against a TypeScript type before treating it as structured data. Do not assume the shape is correct.

```typescript
const raw = JSON.parse(agentResponse.content[0].text);
if (!isPlanningOutput(raw)) {
  return { success: false, error: 'Agent returned unexpected output format' };
}
// raw is now typed as PlanningOutput
```

### Log every agent run to `situation_agent_runs`

Every call to an agent must produce a row in the `situation_agent_runs` table. This is how we track token usage, latency, and failures. The repository function for this is in `lib/db/agentRuns.ts`. Use it — no exceptions.

### Prompt strings live in `docs/prompts/`

The canonical version of every prompt is the `.md` file in `docs/prompts/`. The agent file reads that file and interpolates variables. This makes prompt changes reviewable as doc changes in PRs, separate from logic changes.

Do not hardcode multi-line prompt strings inline in agent files.

---

## Decision Engine Standards

### All scoring functions are pure

Functions in `lib/engine/scorer.ts` have no side effects and are not async. Given the same inputs, they always return the same output. This makes them trivially testable and composable.

```typescript
// Correct — pure function
export function scoreNutritionMatch(option: MealOption, targets: NutritionTargets): number { ... }

// Wrong — has a side effect (logging) and is therefore not pure
export function scoreNutritionMatch(option: MealOption, targets: NutritionTargets): number {
  console.log('scoring...'); // side effect
  ...
}
```

### Every weight table entry has a comment explaining the value

Weight values are not arbitrary numbers. Each one encodes a product decision. Document it.

```typescript
const lateNightSnackWeights = {
  // Caloric density is most important late at night — avoid heavy meals
  caloricDensity: 0.40,
  // Preparation time matters when the user is tired
  prepTime: 0.30,
  // Cuisine preference still factors in but is secondary
  cuisineMatch: 0.20,
  // Budget is least constrained in this situation
  budget: 0.10,
} as const;
// Weights sum: 1.00
```

### `scorer.ts` exports only typed functions — no class, no state

The scorer is a collection of functions, not an object with state. Do not introduce a `Scorer` class or any module-level mutable state.

### New situation type requires weight table + 3 unit tests minimum

When you add a situation type:
1. Typical case — a representative input with an expected score range.
2. Edge case — empty or missing optional fields.
3. Boundary case — a value at the edge of a range (e.g., budget exactly at limit).

---

## CSS Standards

### Use CSS custom properties from the theme — never hardcode colors

All colors, spacing tokens, and font sizes are defined as CSS custom properties in `styles/variables.css`. Reference them by name.

```css
/* Correct */
.card {
  background: var(--color-surface);
  color: var(--color-text-primary);
  border-radius: var(--radius-md);
}

/* Wrong */
.card {
  background: #1a1a2e;
  color: #ffffff;
  border-radius: 8px;
}
```

### Component styles go in `.module.css` next to the component file

Never add component-specific styles to a global file. Each component owns its own CSS module.

### Global styles only in `styles/`

Styles that apply globally (resets, typography base, keyframe animations, utility classes) live in `styles/`. Do not add global selectors to component CSS modules.

### No inline styles except for dynamic values

Inline styles are fine for values that cannot be expressed as static CSS (e.g., a progress bar width set by JavaScript, or a color interpolated from a data value). Everything else goes in a CSS module.

```tsx
// Correct — dynamic value that must be runtime-computed
<div style={{ width: `${progress}%` }} />

// Wrong — static value that belongs in a CSS module
<div style={{ display: 'flex', gap: '16px' }} />
```

### Follow existing animation keyframe names from `mealos.css`

When adding animations, check `styles/mealos.css` for existing keyframes before creating new ones. Reuse `fadeIn`, `slideUp`, `pulse`, etc. if they match the motion you need.

---

## Database Standards

### All DB calls go through repository functions in `lib/db/`

Never import the Prisma client directly in an API route. Always go through a repository function.

```typescript
// Correct — API route calls a repository function
import { findPlanById } from '@/lib/db/plans';
const plan = await findPlanById(params.id);

// Wrong — API route uses Prisma directly
import { prisma } from '@/lib/db';
const plan = await prisma.mealPlan.findUnique({ where: { id: params.id } });
```

This keeps DB logic testable in isolation and makes it easy to add caching or instrumentation in one place.

### Every query uses `select` to avoid over-fetching

Fetch only the columns you need.

```typescript
// Correct
const plan = await prisma.mealPlan.findUnique({
  where: { id },
  select: { id: true, title: true, createdAt: true },
});

// Wrong — fetches all columns including potentially large fields
const plan = await prisma.mealPlan.findUnique({ where: { id } });
```

### N+1 queries are a bug

If you are calling the database inside a loop, you have an N+1 bug. Use `include` to fetch related data in one query, or batch IDs and use `findMany` with `where: { id: { in: ids } }`.

### Never `.findFirst()` on a primary key

`.findFirst()` does not guarantee uniqueness — it returns the first match it finds. On a primary key, use `.findUnique()` which is both semantically correct and allows Prisma to generate a more efficient query.

```typescript
// Correct
const situation = await prisma.situation.findUnique({ where: { id } });

// Wrong
const situation = await prisma.situation.findFirst({ where: { id } });
```

---

## Error Handling Standards

### API routes return typed error responses

Every error response from an API route has the shape `{ code: string, message: string }`. The `code` is a machine-readable constant; the `message` is human-readable.

```typescript
// Correct
return NextResponse.json(
  { code: 'SITUATION_NOT_FOUND', message: 'We could not find that situation.' },
  { status: 404 }
);
```

### All error codes are defined in `types/errors.ts`

Do not invent error code strings inline. Every code that an API route might return is defined as a constant in `types/errors.ts`. This makes it easy to handle specific errors on the client and grep for all uses of a given error.

### User-facing errors are never technical

Do not send stack traces, SQL errors, or internal identifiers to the client. Translate every error to plain English that a user can understand. Log the full technical details server-side via the logger.

```typescript
// Correct
logger.error('DB query failed', { error, planId });
return NextResponse.json({ code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' }, { status: 500 });

// Wrong — leaks internal details
return NextResponse.json({ error: error.message }, { status: 500 });
```

---

## Testing Standards

### Test files colocate with source files

The test for `lib/engine/scorer.ts` lives at `lib/engine/scorer.test.ts`. The test for `lib/db/plans.ts` lives at `lib/db/plans.test.ts`.

The only exception is E2E tests, which live in `tests/e2e/`.

### Describe blocks match the file path

This makes it easy to find the test for a given file.

```typescript
// In lib/engine/scorer.test.ts
describe('lib/engine/scorer', () => {
  describe('scoreMealOption', () => {
    it('returns 1 for a perfect match', () => { ... });
  });
});
```

### Every new function in `scorer.ts` needs a test

This is the most critical module in the codebase — it determines what gets recommended to users. No untested scoring logic merges to main.

### No `it.skip` or `test.skip` merged to main

If a test is broken and you cannot fix it now, open a GitHub issue with the test name and a link to the failure, then delete the test rather than skipping it. Skipped tests accumulate and become permanent blind spots. The issue tracker is the right place to track known failures.
