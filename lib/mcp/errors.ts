/**
 * MealOS AI — Swiggy MCP Error Taxonomy
 *
 * 8 typed error codes per IMPLEMENTATION_PLAYBOOK.md M5 DoD (ISSUE-121) and
 * docs/SWIGGY_MCP.md §5.
 *
 * Every public client method returns {available: false, errorCode} instead of
 * throwing — callers never need try/catch on the client API.
 *
 * Import NOTE: this file lives inside lib/mcp/ which is restricted to
 * lib/agents/tool.ts and tests/mcp/ by the N10 ESLint rule.
 */

import type { SwiggyToolErrorCode } from '@/types/swiggy'

// ── Canonical error code set ─────────────────────────────────────────────────

/**
 * All 8 error codes the MCP layer can emit.
 *
 * Mapping between MCP-layer codes and the frozen SwiggyToolErrorCode type:
 *   SWIGGY_DOWN        ↔  'SWIGGY_DOWN'
 *   INSTAMART_DOWN     ↔  'INSTAMART_DOWN'
 *   DINEOUT_DOWN       ↔  'DINEOUT_DOWN'
 *   LOCATION_NOT_SERVICEABLE ↔  'LOCATION_NOT_SERVICEABLE'
 *   NO_RESULTS         ↔  'NO_RESULTS'
 *   RATE_LIMITED       ↔  'RATE_LIMITED'
 *   NO_AVAILABILITY    ↔  'NO_AVAILABILITY'
 *   MENU_UNAVAILABLE   ↔  (mapped to SWIGGY_DOWN in ToolResponse)
 *
 * The 8th code from the doc taxonomy is CART_EXPIRED / RESTAURANT_CLOSED /
 * ITEM_OUT_OF_STOCK / MINIMUM_ORDER_NOT_MET / SLOT_TAKEN — these are handled
 * as degraded-result data fields rather than error codes (e.g. unavailableItems[]).
 * The 8 machine-readable codes below are the typed contract for tool responses.
 */
export type McpErrorCode =
  | 'SWIGGY_DOWN'           // MCP endpoint unreachable or timed out (8s)
  | 'INSTAMART_DOWN'        // Instamart sub-service down
  | 'DINEOUT_DOWN'          // Dineout sub-service down
  | 'LOCATION_NOT_SERVICEABLE' // lat/lng outside coverage
  | 'NO_RESULTS'            // search returned zero matches after retry
  | 'RATE_LIMITED'          // HTTP 429 / RATE_LIMIT_EXCEEDED after all retries
  | 'NO_AVAILABILITY'       // all dineout slots taken
  | 'MENU_UNAVAILABLE'      // swiggy_get_restaurant_menu failed

/** Coerce an unknown thrown value to one of the 8 typed McpErrorCode values. */
export function classifyError(err: unknown, context: 'food' | 'instamart' | 'dineout' | 'general'): McpErrorCode {
  const e = err as { code?: string; message?: string; status?: number }

  // Explicit code passed through from MCP response
  const code = (e.code ?? '').toUpperCase()

  if (code === 'RATE_LIMIT' || code === 'RATE_LIMIT_EXCEEDED' || e.status === 429) {
    return 'RATE_LIMITED'
  }
  if (code === 'LOCATION_NOT_SERVICEABLE') {
    return 'LOCATION_NOT_SERVICEABLE'
  }
  if (code === 'NO_RESULTS') {
    return 'NO_RESULTS'
  }
  if (code === 'NO_AVAILABILITY' || code === 'SLOT_TAKEN') {
    return 'NO_AVAILABILITY'
  }
  if (code === 'MENU_UNAVAILABLE' || code === 'INVALID_RESTAURANT') {
    return 'MENU_UNAVAILABLE'
  }

  // Fallback: map to sub-service-specific DOWN code
  switch (context) {
    case 'instamart': return 'INSTAMART_DOWN'
    case 'dineout':   return 'DINEOUT_DOWN'
    default:          return 'SWIGGY_DOWN'
  }
}

/**
 * Map an McpErrorCode to the frozen SwiggyToolErrorCode from types/swiggy.ts.
 * Used when building a typed ToolResponse for the Tool Agent.
 */
export function toSwiggyToolErrorCode(code: McpErrorCode): SwiggyToolErrorCode {
  switch (code) {
    case 'SWIGGY_DOWN':                return 'SWIGGY_DOWN'
    case 'INSTAMART_DOWN':             return 'INSTAMART_DOWN'
    case 'DINEOUT_DOWN':              return 'DINEOUT_DOWN'
    case 'LOCATION_NOT_SERVICEABLE':  return 'LOCATION_NOT_SERVICEABLE'
    case 'NO_RESULTS':                return 'NO_RESULTS'
    case 'RATE_LIMITED':              return 'RATE_LIMITED'
    case 'NO_AVAILABILITY':           return 'NO_AVAILABILITY'
    case 'MENU_UNAVAILABLE':          return 'SWIGGY_DOWN'  // collapse to generic for Tool Agent
  }
}

/** Human-readable message for each error code (for Planning Agent context). */
export function errorMessage(code: McpErrorCode): string {
  switch (code) {
    case 'SWIGGY_DOWN':
      return 'Swiggy is temporarily unavailable. Showing cook-only options.'
    case 'INSTAMART_DOWN':
      return 'Swiggy Instamart is temporarily unavailable. Manual shopping list provided.'
    case 'DINEOUT_DOWN':
      return 'Swiggy Dineout is temporarily unavailable. Delivery or cook options recommended instead.'
    case 'LOCATION_NOT_SERVICEABLE':
      return 'Swiggy does not deliver to your location. Showing cook-only options.'
    case 'NO_RESULTS':
      return 'No matching results found after expanding search. Try a different query.'
    case 'RATE_LIMITED':
      return 'Too many requests. Retried with backoff; showing cook-only fallback.'
    case 'NO_AVAILABILITY':
      return 'No table availability found for this date and party size.'
    case 'MENU_UNAVAILABLE':
      return 'Restaurant menu is temporarily unavailable.'
  }
}
