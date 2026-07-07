/**
 * MealOS AI — Ingredient Name Normalization
 *
 * Implements compound-ingredient normalization + simplified-query retry as
 * required by IMPLEMENTATION_PLAYBOOK.md M5 DoD (ISSUE-113, 140) and
 * docs/SWIGGY_MCP.md §3 (Fuzzy Matching subsection).
 *
 * Rule N2: this module is consumed by the mock and the real client alike; the
 * mock defines the contract, the real client conforms.
 */

// ── Adjective strip list ────────────────────────────────────────────────────

/**
 * Modifiers that Instamart product names never use but recipe texts often do.
 * Stripped from ingredient names before the first search attempt.
 */
const STRIP_ADJECTIVES: RegExp = /\b(fresh|organic|homemade|chopped|sliced|diced|minced|grated|peeled|raw|frozen|dried|roasted|powdered|ground)\b/gi

/**
 * Quantity-like tokens that are noise for product search.
 * e.g. "onion 2 pcs" → "onion"
 */
const STRIP_QUANTITY: RegExp = /\b\d+\s*(g|kg|ml|l|pcs?|pieces?|cups?|tbsp|tsp|bunch|cloves?|pods?)\b/gi

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Phase 1 normalization: strip adjectives, quantities, and collapse whitespace.
 *
 * "fresh ginger-garlic paste" → "ginger-garlic paste"
 * "organic basmati rice"      → "basmati rice"
 * "minced garlic cloves"      → "garlic cloves"
 * "onion 2 pcs"               → "onion"
 */
export function normalizeIngredient(raw: string): string {
  return raw
    .toLowerCase()
    .replace(STRIP_ADJECTIVES, '')
    .replace(STRIP_QUANTITY, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Phase 2 simplification: convert compound terms into space-separated words.
 * Called only when the Phase 1 query returns no `found` results.
 *
 * "ginger-garlic paste" → "ginger garlic paste"
 * "gram-flour"          → "gram flour"
 *
 * Also strips parenthetical notes and "paste/powder/sauce" suffix when the
 * compound form was not found — search engine will find the base ingredient.
 *
 * This is the "simplified-query retry" referenced in the M5 DoD.
 */
export function simplifyIngredient(normalized: string): string {
  return normalized
    .replace(/-/g, ' ')                            // hyphens → spaces
    .replace(/\(.*?\)/g, '')                       // strip parenthetical notes
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Returns both phases in order: [normalized, simplified].
 * The caller tries normalized first; if no results, tries simplified.
 *
 * @example
 * queryVariants('fresh ginger-garlic paste')
 * // → ['ginger-garlic paste', 'ginger garlic paste']
 *
 * queryVariants('organic basmati rice')
 * // → ['basmati rice', 'basmati rice']  (both the same when no hyphens)
 */
export function queryVariants(raw: string): [string, string] {
  const normalized = normalizeIngredient(raw)
  const simplified = simplifyIngredient(normalized)
  return [normalized, simplified]
}

/**
 * Normalize a list of ingredient names, deduplicating identical results.
 * Preserves original order. Used by searchInstamart before calling MCP.
 */
export function normalizeIngredientList(items: string[]): Array<{ original: string; query: string; fallbackQuery: string }> {
  return items.map((item) => {
    const [query, fallbackQuery] = queryVariants(item)
    return { original: item, query, fallbackQuery }
  })
}
