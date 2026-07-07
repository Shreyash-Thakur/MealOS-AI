/**
 * MealOS AI — Situation Status State Machine
 *
 * Source of truth: docs/AGENTS.md §7.2 (Pipeline State Machine)
 *                  docs/BACKEND_DESIGN.md §4.1 (reconciliation note 7: 'error' state)
 *
 * Valid transitions (one-directional; no backward moves):
 *
 *   created → intent_extracted
 *   intent_extracted → clarifying | context_ready
 *   clarifying → context_ready
 *   context_ready → planning
 *   planning → plan_ready
 *   plan_ready → executing
 *   executing → completed
 *   plan_ready | executing | clarifying | context_ready | intent_extracted → abandoned
 *   any non-terminal → error
 *
 * Illegal transitions throw AppError('INVALID_SITUATION_STATE', ...).
 */

import type { SituationStatus } from '@/types/situation'
import { AppError } from '@/lib/errors'

// Terminal states — no further transitions allowed (except to error)
const TERMINAL_STATES = new Set<SituationStatus>(['completed', 'abandoned', 'error'])

// Legal transition map: from → Set<to>
// Based on docs/AGENTS.md §7.2 + BACKEND_DESIGN.md reconciliation note 7
const LEGAL_TRANSITIONS: Record<SituationStatus, ReadonlyArray<SituationStatus>> = {
  created:          ['intent_extracted', 'abandoned', 'error'],
  intent_extracted: ['clarifying', 'context_ready', 'abandoned', 'error'],
  clarifying:       ['context_ready', 'abandoned', 'error'],
  context_ready:    ['planning', 'abandoned', 'error'],
  planning:         ['plan_ready', 'abandoned', 'error'],
  plan_ready:       ['executing', 'abandoned', 'error'],
  executing:        ['completed', 'abandoned', 'error'],
  completed:        [],
  abandoned:        [],
  error:            [],
}

/**
 * Validates that a status transition is legal.
 *
 * @param from - Current situation status
 * @param to - Desired next status
 * @throws AppError('INVALID_SITUATION_STATE') if the transition is illegal
 */
export function validateTransition(from: SituationStatus, to: SituationStatus): void {
  const allowed = LEGAL_TRANSITIONS[from]

  if (TERMINAL_STATES.has(from)) {
    throw new AppError(
      'INVALID_SITUATION_STATE',
      `Cannot transition from terminal state '${from}' to '${to}'.`,
      { from, to }
    )
  }

  if (!allowed.includes(to)) {
    throw new AppError(
      'INVALID_SITUATION_STATE',
      `Illegal status transition: '${from}' → '${to}'. Allowed: ${allowed.join(', ') || 'none'}.`,
      { from, to, allowed }
    )
  }
}

/**
 * Returns the next status after applying the transition, or throws if illegal.
 *
 * @param from - Current situation status
 * @param to - Desired next status
 * @returns The new status (same as `to` on success)
 * @throws AppError('INVALID_SITUATION_STATE') if transition is illegal
 */
export function applyTransition(from: SituationStatus, to: SituationStatus): SituationStatus {
  validateTransition(from, to)
  return to
}

/**
 * Returns true if the given status is a terminal state (no further transitions).
 */
export function isTerminalState(status: SituationStatus): boolean {
  return TERMINAL_STATES.has(status)
}

/**
 * Returns all legal next statuses from the given status.
 */
export function getLegalNextStatuses(from: SituationStatus): ReadonlyArray<SituationStatus> {
  return LEGAL_TRANSITIONS[from]
}
