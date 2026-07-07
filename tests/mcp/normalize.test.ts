/**
 * tests/mcp/normalize.test.ts
 *
 * Tests for lib/mcp/normalize.ts — compound-ingredient normalization and
 * simplified-query retry (ISSUE-113, ISSUE-140, playbook M5 DoD).
 *
 * N10 exemption: tests/mcp/ is allowed to import lib/mcp/* directly.
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeIngredient,
  simplifyIngredient,
  queryVariants,
  normalizeIngredientList,
} from '@/lib/mcp/normalize'

// ── normalizeIngredient ──────────────────────────────────────────────────────

describe('normalizeIngredient', () => {
  it('strips "fresh" adjective', () => {
    expect(normalizeIngredient('fresh ginger-garlic paste')).toBe('ginger-garlic paste')
  })

  it('strips "organic" adjective', () => {
    expect(normalizeIngredient('organic basmati rice')).toBe('basmati rice')
  })

  it('strips "minced" adjective', () => {
    expect(normalizeIngredient('minced garlic cloves')).toBe('garlic cloves')
  })

  it('strips "chopped" adjective', () => {
    expect(normalizeIngredient('chopped onion')).toBe('onion')
  })

  it('strips "diced" adjective', () => {
    expect(normalizeIngredient('diced tomatoes')).toBe('tomatoes')
  })

  it('strips "sliced" adjective', () => {
    expect(normalizeIngredient('sliced mushrooms')).toBe('mushrooms')
  })

  it('strips "grated" adjective', () => {
    expect(normalizeIngredient('grated cheese')).toBe('cheese')
  })

  it('strips "peeled" adjective', () => {
    expect(normalizeIngredient('peeled garlic')).toBe('garlic')
  })

  it('strips "raw" adjective', () => {
    expect(normalizeIngredient('raw cashews')).toBe('cashews')
  })

  it('strips "frozen" adjective', () => {
    expect(normalizeIngredient('frozen peas')).toBe('peas')
  })

  it('strips "dried" adjective', () => {
    expect(normalizeIngredient('dried red chillies')).toBe('red chillies')
  })

  it('strips "roasted" adjective', () => {
    expect(normalizeIngredient('roasted cumin')).toBe('cumin')
  })

  it('strips "powdered" adjective', () => {
    expect(normalizeIngredient('powdered sugar')).toBe('sugar')
  })

  it('strips "ground" adjective', () => {
    expect(normalizeIngredient('ground black pepper')).toBe('black pepper')
  })

  it('strips quantity tokens (grams)', () => {
    expect(normalizeIngredient('basmati rice 500g')).toBe('basmati rice')
  })

  it('strips quantity tokens (kg)', () => {
    expect(normalizeIngredient('chicken breast 1kg')).toBe('chicken breast')
  })

  it('strips quantity tokens (pcs)', () => {
    expect(normalizeIngredient('onion 2 pcs')).toBe('onion')
  })

  it('strips quantity tokens (pieces)', () => {
    expect(normalizeIngredient('tomatoes 3 pieces')).toBe('tomatoes')
  })

  it('strips quantity tokens (ml)', () => {
    expect(normalizeIngredient('coconut milk 400ml')).toBe('coconut milk')
  })

  it('strips quantity tokens (cups)', () => {
    expect(normalizeIngredient('flour 2 cups')).toBe('flour')
  })

  it('strips quantity tokens (tbsp)', () => {
    expect(normalizeIngredient('oil 1 tbsp')).toBe('oil')
  })

  it('strips quantity tokens (tsp)', () => {
    expect(normalizeIngredient('salt 1 tsp')).toBe('salt')
  })

  it('lowercases the result', () => {
    expect(normalizeIngredient('BASMATI RICE')).toBe('basmati rice')
  })

  it('collapses extra whitespace', () => {
    expect(normalizeIngredient('  ginger   garlic   ')).toBe('ginger garlic')
  })

  it('preserves hyphens in compound names', () => {
    // normalizeIngredient does NOT strip hyphens — that's simplifyIngredient
    expect(normalizeIngredient('ginger-garlic paste')).toBe('ginger-garlic paste')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeIngredient('   ')).toBe('')
  })

  it('handles multi-adjective stripping', () => {
    expect(normalizeIngredient('fresh organic chopped onion')).toBe('onion')
  })
})

// ── simplifyIngredient ───────────────────────────────────────────────────────

describe('simplifyIngredient', () => {
  it('converts hyphens to spaces', () => {
    expect(simplifyIngredient('ginger-garlic paste')).toBe('ginger garlic paste')
  })

  it('converts multiple hyphens', () => {
    expect(simplifyIngredient('gram-flour-paste')).toBe('gram flour paste')
  })

  it('strips parenthetical notes', () => {
    expect(simplifyIngredient('garlic (minced)')).toBe('garlic')
  })

  it('strips parenthetical notes with text', () => {
    expect(simplifyIngredient('cream (heavy, 35%)')).toBe('cream')
  })

  it('collapses whitespace after stripping', () => {
    expect(simplifyIngredient('ginger -garlic  paste')).toBe('ginger garlic paste')
  })

  it('no-op on a simple name without hyphens or parens', () => {
    expect(simplifyIngredient('basmati rice')).toBe('basmati rice')
  })

  it('handles combined hyphens and parenthetical', () => {
    expect(simplifyIngredient('ginger-garlic (store-bought)')).toBe('ginger garlic')
  })
})

// ── queryVariants ────────────────────────────────────────────────────────────

describe('queryVariants', () => {
  it('returns [normalized, simplified] as a tuple', () => {
    const [normalized, simplified] = queryVariants('fresh ginger-garlic paste')
    expect(normalized).toBe('ginger-garlic paste')
    expect(simplified).toBe('ginger garlic paste')
  })

  it('both variants are the same when no hyphens or adjectives', () => {
    const [normalized, simplified] = queryVariants('basmati rice')
    expect(normalized).toBe('basmati rice')
    expect(simplified).toBe('basmati rice')
  })

  it('first variant preserves compound form', () => {
    const [normalized] = queryVariants('ginger-garlic paste')
    expect(normalized).toContain('-')
  })

  it('second variant splits compound form', () => {
    const [, simplified] = queryVariants('ginger-garlic paste')
    expect(simplified).not.toContain('-')
  })

  it('strips quantity from normalized', () => {
    const [normalized, simplified] = queryVariants('basmati rice 1kg')
    expect(normalized).toBe('basmati rice')
    expect(simplified).toBe('basmati rice')
  })

  it('strips adjective and quantity from both variants', () => {
    const [normalized, simplified] = queryVariants('fresh organic basmati rice 500g')
    expect(normalized).toBe('basmati rice')
    expect(simplified).toBe('basmati rice')
  })
})

// ── normalizeIngredientList ──────────────────────────────────────────────────

describe('normalizeIngredientList', () => {
  it('returns one entry per input item', () => {
    const result = normalizeIngredientList(['fresh ginger-garlic paste', 'basmati rice'])
    expect(result.length).toBe(2)
  })

  it('preserves original name', () => {
    const result = normalizeIngredientList(['fresh ginger-garlic paste'])
    expect(result[0]!.original).toBe('fresh ginger-garlic paste')
  })

  it('provides normalized query', () => {
    const result = normalizeIngredientList(['fresh ginger-garlic paste'])
    expect(result[0]!.query).toBe('ginger-garlic paste')
  })

  it('provides fallback (simplified) query', () => {
    const result = normalizeIngredientList(['fresh ginger-garlic paste'])
    expect(result[0]!.fallbackQuery).toBe('ginger garlic paste')
  })

  it('handles empty list', () => {
    expect(normalizeIngredientList([])).toEqual([])
  })

  it('handles items without adjectives or hyphens', () => {
    const result = normalizeIngredientList(['onion', 'tomatoes'])
    expect(result[0]!.query).toBe('onion')
    expect(result[0]!.fallbackQuery).toBe('onion')
    expect(result[1]!.query).toBe('tomatoes')
  })

  it('handles mixed list', () => {
    const result = normalizeIngredientList([
      'organic basmati rice',
      'fresh ginger-garlic paste',
      'onion 2 pcs',
      'saffron',
    ])
    expect(result.length).toBe(4)
    expect(result[0]!.query).toBe('basmati rice')
    expect(result[1]!.query).toBe('ginger-garlic paste')
    expect(result[1]!.fallbackQuery).toBe('ginger garlic paste')
    expect(result[2]!.query).toBe('onion')
    expect(result[3]!.query).toBe('saffron')
  })
})

// ── Integration: normalization feeds the mock ────────────────────────────────

describe('Normalization integration — feeds fixture lookup in MockSwiggyMCPClient', () => {
  it('normalizeIngredient("fresh ginger-garlic paste") matches fixture key', () => {
    // The mock's instamartFixtureMap has 'ginger-garlic paste' as a key
    const normalized = normalizeIngredient('fresh ginger-garlic paste')
    expect(normalized).toBe('ginger-garlic paste')
  })

  it('simplifyIngredient("ginger-garlic paste") matches fallback fixture key', () => {
    // The mock also has 'ginger garlic paste' as a key (simplified query variant)
    const simplified = simplifyIngredient('ginger-garlic paste')
    expect(simplified).toBe('ginger garlic paste')
  })

  it('normalizeIngredient + simplify covers the M5 DoD example', () => {
    // Playbook M5 DoD: "ginger-garlic paste" → "ginger garlic" for retry
    const [normalized, simplified] = queryVariants('ginger-garlic paste')
    expect(normalized).toBe('ginger-garlic paste')
    expect(simplified).toBe('ginger garlic paste')
  })
})
