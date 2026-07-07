/**
 * Realistic Mumbai Instamart fixtures for MockSwiggyMCPClient.
 *
 * Types: InstamartResult (types/swiggy.ts — post-normalization output of
 * searchInstamart). Each fixture represents one resolved ingredient.
 *
 * Source: docs/SWIGGY_MCP.md §9 Mock Data Fixtures (adapted to types/swiggy.ts).
 */

import type { InstamartResult } from '@/types/swiggy'
import type { InstamartItemId, Rupees, Minutes } from '@/types/primitives'

const iid  = (s: string) => s as InstamartItemId
const rs   = (n: number) => n as Rupees
const min  = (n: number) => n as Minutes

// ── Individual fixture items ─────────────────────────────────────────────────

const gingerGarlicPaste: InstamartResult = {
  item: 'ginger-garlic paste',
  found: true,
  price: rs(65),
  unit: '200g',
  brand: 'National',
  deliveryTimeMin: min(15),
  instamartItemId: iid('im_30012'),
}

const basmatiRice: InstamartResult = {
  item: 'basmati rice',
  found: true,
  price: rs(189),
  unit: '1kg',
  brand: 'India Gate',
  deliveryTimeMin: min(15),
  instamartItemId: iid('im_10023'),
}

const turmericPowder: InstamartResult = {
  item: 'turmeric powder',
  found: true,
  price: rs(55),
  unit: '100g',
  brand: 'Everest',
  deliveryTimeMin: min(15),
  instamartItemId: iid('im_44512'),
}

const onion: InstamartResult = {
  item: 'onion',
  found: true,
  price: rs(40),
  unit: '500g',
  brand: 'Fresh',
  deliveryTimeMin: min(14),
  instamartItemId: iid('im_10045'),
}

const tomatoes: InstamartResult = {
  item: 'tomatoes',
  found: true,
  price: rs(35),
  unit: '500g',
  brand: 'Fresh',
  deliveryTimeMin: min(14),
  instamartItemId: iid('im_22301'),
}

const chickenStock: InstamartResult = {
  item: 'chicken stock',
  found: true,
  price: rs(85),
  unit: '500ml',
  brand: 'Maggi',
  deliveryTimeMin: min(15),
  instamartItemId: iid('im_55090'),
}

/** An item that is searched but not found (to test out-of-stock path). */
const saffron: InstamartResult = {
  item: 'saffron',
  found: false,
}

/** Standard fixture set used for most cook-path tests. */
export const mockInstamartItems: InstamartResult[] = [
  gingerGarlicPaste,
  basmatiRice,
  turmericPowder,
  onion,
  tomatoes,
]

/** Set that includes an unfound item — tests partial-cart and fallback logic. */
export const mockInstamartWithMissing: InstamartResult[] = [
  gingerGarlicPaste,
  basmatiRice,
  turmericPowder,
  saffron,  // not found
]

/** All known fixture items for lookup by ingredient name. */
export const instamartFixtureMap: Record<string, InstamartResult> = {
  'ginger-garlic paste': gingerGarlicPaste,
  'ginger garlic paste': gingerGarlicPaste,   // simplified query variant
  'basmati rice':        basmatiRice,
  'turmeric powder':     turmericPowder,
  'onion':               onion,
  'tomatoes':            tomatoes,
  'chicken stock':       chickenStock,
  'saffron':             saffron,
}

export {
  gingerGarlicPaste,
  basmatiRice,
  turmericPowder,
  onion,
  tomatoes,
  chickenStock,
  saffron,
}
