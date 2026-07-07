/**
 * MealOS AI — State Machine Unit Tests
 *
 * Source: docs/AGENTS.md §7.2 (Pipeline State Machine)
 */

import { describe, it, expect } from 'vitest'
import {
  validateTransition,
  applyTransition,
  isTerminalState,
  getLegalNextStatuses,
} from '../../lib/engine/stateMachine'
import { AppError } from '../../lib/errors'

describe('stateMachine', () => {

  describe('legal transitions', () => {
    it('created → intent_extracted', () => {
      expect(() => validateTransition('created', 'intent_extracted')).not.toThrow()
      expect(applyTransition('created', 'intent_extracted')).toBe('intent_extracted')
    })

    it('created → abandoned', () => {
      expect(() => validateTransition('created', 'abandoned')).not.toThrow()
    })

    it('created → error', () => {
      expect(() => validateTransition('created', 'error')).not.toThrow()
    })

    it('intent_extracted → clarifying', () => {
      expect(() => validateTransition('intent_extracted', 'clarifying')).not.toThrow()
    })

    it('intent_extracted → context_ready (no clarification needed)', () => {
      expect(() => validateTransition('intent_extracted', 'context_ready')).not.toThrow()
    })

    it('clarifying → context_ready', () => {
      expect(() => validateTransition('clarifying', 'context_ready')).not.toThrow()
    })

    it('context_ready → planning', () => {
      expect(() => validateTransition('context_ready', 'planning')).not.toThrow()
    })

    it('planning → plan_ready', () => {
      expect(() => validateTransition('planning', 'plan_ready')).not.toThrow()
    })

    it('plan_ready → executing', () => {
      expect(() => validateTransition('plan_ready', 'executing')).not.toThrow()
    })

    it('executing → completed', () => {
      expect(() => validateTransition('executing', 'completed')).not.toThrow()
    })

    it('plan_ready → abandoned', () => {
      expect(() => validateTransition('plan_ready', 'abandoned')).not.toThrow()
    })

    it('planning → error', () => {
      expect(() => validateTransition('planning', 'error')).not.toThrow()
    })
  })

  describe('illegal transitions throw AppError', () => {
    it('created → planning (skips states)', () => {
      expect(() => validateTransition('created', 'planning')).toThrow(AppError)
    })

    it('intent_extracted → completed (skips many states)', () => {
      expect(() => validateTransition('intent_extracted', 'completed')).toThrow(AppError)
    })

    it('completed → abandoned (terminal → another terminal)', () => {
      expect(() => validateTransition('completed', 'abandoned')).toThrow(AppError)
    })

    it('completed → intent_extracted (backward transition)', () => {
      expect(() => validateTransition('completed', 'intent_extracted')).toThrow(AppError)
    })

    it('abandoned → planning (terminal state → forward)', () => {
      expect(() => validateTransition('abandoned', 'planning')).toThrow(AppError)
    })

    it('error → intent_extracted (terminal state)', () => {
      expect(() => validateTransition('error', 'intent_extracted')).toThrow(AppError)
    })

    it('plan_ready → created (backward)', () => {
      expect(() => validateTransition('plan_ready', 'created')).toThrow(AppError)
    })

    it('executing → planning (backward)', () => {
      expect(() => validateTransition('executing', 'planning')).toThrow(AppError)
    })

    it('throws AppError with INVALID_SITUATION_STATE code', () => {
      try {
        validateTransition('completed', 'planning')
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(AppError)
        const appErr = err as AppError
        expect(appErr.code).toBe('INVALID_SITUATION_STATE')
      }
    })
  })

  describe('isTerminalState', () => {
    it('completed is terminal', () => expect(isTerminalState('completed')).toBe(true))
    it('abandoned is terminal', () => expect(isTerminalState('abandoned')).toBe(true))
    it('error is terminal', () => expect(isTerminalState('error')).toBe(true))
    it('created is not terminal', () => expect(isTerminalState('created')).toBe(false))
    it('planning is not terminal', () => expect(isTerminalState('planning')).toBe(false))
    it('plan_ready is not terminal', () => expect(isTerminalState('plan_ready')).toBe(false))
  })

  describe('getLegalNextStatuses', () => {
    it('created can transition to intent_extracted, abandoned, error', () => {
      const next = getLegalNextStatuses('created')
      expect(next).toContain('intent_extracted')
      expect(next).toContain('abandoned')
      expect(next).toContain('error')
    })

    it('completed has no legal next statuses', () => {
      expect(getLegalNextStatuses('completed')).toHaveLength(0)
    })

    it('abandoned has no legal next statuses', () => {
      expect(getLegalNextStatuses('abandoned')).toHaveLength(0)
    })

    it('error has no legal next statuses', () => {
      expect(getLegalNextStatuses('error')).toHaveLength(0)
    })
  })
})
