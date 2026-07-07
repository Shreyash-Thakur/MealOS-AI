/**
 * MealOS AI — Required Fields Registry Unit Tests
 *
 * Source: docs/AGENTS.md §2.4 "Required fields by situation type"
 */

import { describe, it, expect } from 'vitest'
import {
  REQUIRED_FIELDS,
  getRequiredFields,
  getMissingRequiredFields,
  isMissingRequiredFields,
} from '../../lib/engine/requiredFields'
import type { SituationType } from '@/types/situation'

describe('requiredFields registry', () => {

  describe('REQUIRED_FIELDS table', () => {
    it('contains all 11 situation types', () => {
      const types: SituationType[] = [
        'sick', 'broke', 'date_planning', 'party_hosting', 'nutrition_goal',
        'quick_meal', 'meal_prep', 'office_lunch', 'family_dinner', 'late_night', 'general',
      ]
      for (const t of types) {
        expect(REQUIRED_FIELDS[t]).toBeDefined()
      }
    })

    it('sick requires canCook and alone', () => {
      expect(REQUIRED_FIELDS.sick).toContain('canCook')
      expect(REQUIRED_FIELDS.sick).toContain('alone')
    })

    it('broke requires budget and canCook', () => {
      expect(REQUIRED_FIELDS.broke).toContain('budget')
      expect(REQUIRED_FIELDS.broke).toContain('canCook')
    })

    it('date_planning requires budget and indoorOutdoor', () => {
      expect(REQUIRED_FIELDS.date_planning).toContain('budget')
      expect(REQUIRED_FIELDS.date_planning).toContain('indoorOutdoor')
    })

    it('party_hosting requires guests and budget', () => {
      expect(REQUIRED_FIELDS.party_hosting).toContain('guests')
      expect(REQUIRED_FIELDS.party_hosting).toContain('budget')
    })

    it('nutrition_goal requires nutritionGoal.protein or nutritionGoal.calories', () => {
      expect(REQUIRED_FIELDS.nutrition_goal).toContain('nutritionGoal.protein')
      expect(REQUIRED_FIELDS.nutrition_goal).toContain('nutritionGoal.calories')
    })

    it('quick_meal has no required fields', () => {
      expect(REQUIRED_FIELDS.quick_meal).toHaveLength(0)
    })

    it('meal_prep requires timeframe', () => {
      expect(REQUIRED_FIELDS.meal_prep).toContain('timeframe')
    })

    it('office_lunch has no required fields', () => {
      expect(REQUIRED_FIELDS.office_lunch).toHaveLength(0)
    })

    it('family_dinner has no required fields', () => {
      expect(REQUIRED_FIELDS.family_dinner).toHaveLength(0)
    })

    it('late_night requires canCook', () => {
      expect(REQUIRED_FIELDS.late_night).toContain('canCook')
    })

    it('general has no required fields', () => {
      expect(REQUIRED_FIELDS.general).toHaveLength(0)
    })
  })

  describe('getRequiredFields', () => {
    it('returns same values as REQUIRED_FIELDS table', () => {
      expect(getRequiredFields('sick')).toEqual(REQUIRED_FIELDS.sick)
      expect(getRequiredFields('broke')).toEqual(REQUIRED_FIELDS.broke)
      expect(getRequiredFields('general')).toEqual(REQUIRED_FIELDS.general)
    })
  })

  describe('getMissingRequiredFields', () => {
    it('sick — all known → no missing', () => {
      const missing = getMissingRequiredFields('sick', ['canCook', 'alone'])
      expect(missing).toHaveLength(0)
    })

    it('sick — canCook known, alone missing', () => {
      const missing = getMissingRequiredFields('sick', ['canCook'])
      expect(missing).toContain('alone')
      expect(missing).not.toContain('canCook')
    })

    it('sick — nothing known → both missing', () => {
      const missing = getMissingRequiredFields('sick', [])
      expect(missing).toContain('canCook')
      expect(missing).toContain('alone')
    })

    it('broke — budget and canCook known → no missing', () => {
      const missing = getMissingRequiredFields('broke', ['budget', 'canCook'])
      expect(missing).toHaveLength(0)
    })

    it('nutrition_goal — protein known → no missing (either suffices)', () => {
      const missing = getMissingRequiredFields('nutrition_goal', ['nutritionGoal.protein'])
      expect(missing).toHaveLength(0)
    })

    it('nutrition_goal — calories known → no missing (either suffices)', () => {
      const missing = getMissingRequiredFields('nutrition_goal', ['nutritionGoal.calories'])
      expect(missing).toHaveLength(0)
    })

    it('nutrition_goal — nothing known → prompts for protein', () => {
      const missing = getMissingRequiredFields('nutrition_goal', [])
      expect(missing).toContain('nutritionGoal.protein')
    })

    it('quick_meal — never has missing fields', () => {
      const missing = getMissingRequiredFields('quick_meal', [])
      expect(missing).toHaveLength(0)
    })

    it('general — never has missing fields', () => {
      const missing = getMissingRequiredFields('general', [])
      expect(missing).toHaveLength(0)
    })
  })

  describe('isMissingRequiredFields', () => {
    it('returns true when fields are missing', () => {
      expect(isMissingRequiredFields('sick', [])).toBe(true)
      expect(isMissingRequiredFields('sick', ['canCook'])).toBe(true)
    })

    it('returns false when all required fields are known', () => {
      expect(isMissingRequiredFields('sick', ['canCook', 'alone'])).toBe(false)
      expect(isMissingRequiredFields('quick_meal', [])).toBe(false)
      expect(isMissingRequiredFields('general', [])).toBe(false)
    })

    it('nutrition_goal: false when protein known', () => {
      expect(isMissingRequiredFields('nutrition_goal', ['nutritionGoal.protein'])).toBe(false)
    })

    it('nutrition_goal: false when calories known', () => {
      expect(isMissingRequiredFields('nutrition_goal', ['nutritionGoal.calories'])).toBe(false)
    })

    it('nutrition_goal: true when neither known', () => {
      expect(isMissingRequiredFields('nutrition_goal', [])).toBe(true)
    })
  })
})
