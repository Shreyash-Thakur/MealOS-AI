## What this PR does

<!-- 2-3 sentences. What problem does it solve? What user-visible behavior changes? -->

---

## Type

- [ ] Feature
- [ ] Bug Fix
- [ ] Refactor
- [ ] Chore
- [ ] Documentation

---

## Checklist

- [ ] `pnpm typecheck` passes with no errors
- [ ] Decision Engine unit tests pass (`pnpm test:engine`)
- [ ] If modifying a prompt in `docs/prompts/`: golden set run completed and output diff attached below
- [ ] If modifying `lib/engine/scorer.ts` or `lib/engine/weights.ts`: weight tables still sum to 1.0 and new unit tests added
- [ ] If adding a new API endpoint: documented in `docs/API.md`
- [ ] If adding a new component: all states handled (loading, error, empty/zero-state)
- [ ] Sentry checked after preview deploy — no new errors

---

## Screenshots / Recordings

<!-- Required for any UI change. Attach before/after or a short screen recording. Delete this section if no UI changes. -->

---

## How to test this manually

<!-- Step-by-step instructions to verify this PR works in the preview deploy. Be specific enough that a reviewer can follow them without asking you questions. -->

1.
2.
3.

---

## Breaking changes

<!-- Does this change any API contracts, rename env vars, alter the DB schema in a non-additive way, or change any behavior that other code depends on? If yes, describe what callers need to update. If no, delete this section. -->

None.

---

## Golden set output diff

<!-- Required only if a prompt was modified. Paste the diff or attach the output file from `pnpm test:agents`. Delete this section if no prompt changes. -->
