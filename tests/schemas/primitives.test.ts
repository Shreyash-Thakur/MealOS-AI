/**
 * Tests for shared Zod primitives (lib/schemas/primitives.ts)
 * Validates: scalars, enums, building blocks.
 */

import { describe, it, expect } from 'vitest'
import {
  zUuid,
  zRupees,
  zMinutes,
  zMs,
  zSeconds,
  zGrams,
  zKcal,
  zConfidencePercent,
  zFactConfidence,
  zWriteTimeFactConfidence,
  zIsoDateTime,
  zIsoDate,
  zRating,
  zLat,
  zLng,
  zSlotLabel,
  zFactKey,
  zSituationType,
  zSituationStatus,
  zPrimaryPath,
  zEnginePath,
  zService,
  zPlanType,
  zDietType,
  zCookingSkill,
  zConfidenceLevel,
  zMemorySource,
  zFactType,
  zUserActionType,
  NutritionInfoSchema,
  RecipeStepSchema,
  IngredientLineSchema,
  ClarificationQuestionSchema,
  ClarificationAnswerValueSchema,
  PathComparisonSchema,
  ComparisonScoresSchema,
} from '@/lib/schemas/primitives'

// ── Scalar tests ──────────────────────────────────────────────────────────────

describe('zUuid', () => {
  it('accepts valid UUID v4', () => {
    expect(zUuid.parse('550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400-e29b-41d4-a716-446655440000')
  })
  it('rejects non-UUID strings', () => {
    expect(() => zUuid.parse('not-a-uuid')).toThrow()
    expect(() => zUuid.parse('')).toThrow()
  })
})

describe('zRupees', () => {
  it('accepts integer 0', () => {
    expect(zRupees.parse(0)).toBe(0)
  })
  it('accepts valid rupee amounts', () => {
    expect(zRupees.parse(500)).toBe(500)
    expect(zRupees.parse(100_000)).toBe(100_000)
  })
  it('rejects floats', () => {
    expect(() => zRupees.parse(159.99)).toThrow()
  })
  it('rejects negatives', () => {
    expect(() => zRupees.parse(-1)).toThrow()
  })
  it('rejects above cap', () => {
    expect(() => zRupees.parse(100_001)).toThrow()
  })
})

describe('zMinutes', () => {
  it('accepts 0 and valid values', () => {
    expect(zMinutes.parse(0)).toBe(0)
    expect(zMinutes.parse(30)).toBe(30)
    expect(zMinutes.parse(24 * 60)).toBe(24 * 60)
  })
  it('rejects above 1440', () => {
    expect(() => zMinutes.parse(24 * 60 + 1)).toThrow()
  })
  it('rejects floats', () => {
    expect(() => zMinutes.parse(30.5)).toThrow()
  })
})

describe('zGrams', () => {
  it('accepts 0 to 2000', () => {
    expect(zGrams.parse(0)).toBe(0)
    expect(zGrams.parse(150)).toBe(150)
    expect(zGrams.parse(2000)).toBe(2000)
  })
  it('rejects above 2000', () => {
    expect(() => zGrams.parse(2001)).toThrow()
  })
})

describe('zKcal', () => {
  it('accepts 0 to 10000', () => {
    expect(zKcal.parse(0)).toBe(0)
    expect(zKcal.parse(2500)).toBe(2500)
    expect(zKcal.parse(10_000)).toBe(10_000)
  })
  it('rejects above cap', () => {
    expect(() => zKcal.parse(10_001)).toThrow()
  })
})

describe('zConfidencePercent', () => {
  it('accepts integers 0–100', () => {
    expect(zConfidencePercent.parse(0)).toBe(0)
    expect(zConfidencePercent.parse(91)).toBe(91)
    expect(zConfidencePercent.parse(100)).toBe(100)
  })
  it('rejects 0.91 (API.md example is wrong — must be integer)', () => {
    expect(() => zConfidencePercent.parse(0.91)).toThrow()
  })
  it('rejects above 100', () => {
    expect(() => zConfidencePercent.parse(101)).toThrow()
  })
  it('rejects negatives', () => {
    expect(() => zConfidencePercent.parse(-1)).toThrow()
  })
})

describe('zFactConfidence', () => {
  it('accepts decimals 0.0 to 1.0', () => {
    expect(zFactConfidence.parse(0.0)).toBe(0.0)
    expect(zFactConfidence.parse(0.4)).toBe(0.4)
    expect(zFactConfidence.parse(0.85)).toBe(0.85)
    expect(zFactConfidence.parse(1.0)).toBe(1.0)
  })
  it('rejects above 1', () => {
    expect(() => zFactConfidence.parse(1.01)).toThrow()
  })
})

describe('zWriteTimeFactConfidence', () => {
  it('accepts the four quantized values', () => {
    expect(zWriteTimeFactConfidence.parse(0.4)).toBe(0.4)
    expect(zWriteTimeFactConfidence.parse(0.6)).toBe(0.6)
    expect(zWriteTimeFactConfidence.parse(0.8)).toBe(0.8)
    expect(zWriteTimeFactConfidence.parse(1.0)).toBe(1.0)
  })
  it('rejects intermediate values', () => {
    expect(() => zWriteTimeFactConfidence.parse(0.5)).toThrow()
    expect(() => zWriteTimeFactConfidence.parse(0.7)).toThrow()
    expect(() => zWriteTimeFactConfidence.parse(0.9)).toThrow()
    expect(() => zWriteTimeFactConfidence.parse(0.85)).toThrow()
  })
})

describe('zIsoDateTime', () => {
  it('accepts UTC datetime', () => {
    expect(zIsoDateTime.parse('2026-07-06T14:30:00Z')).toBe('2026-07-06T14:30:00Z')
  })
  it('accepts datetime with offset', () => {
    expect(zIsoDateTime.parse('2026-07-05T19:45:00+05:30')).toBe('2026-07-05T19:45:00+05:30')
  })
  it('rejects plain date', () => {
    expect(() => zIsoDateTime.parse('2026-07-06')).toThrow()
  })
  it('rejects non-datetime strings', () => {
    expect(() => zIsoDateTime.parse('not-a-date')).toThrow()
  })
})

describe('zIsoDate', () => {
  it('accepts YYYY-MM-DD format', () => {
    expect(zIsoDate.parse('2026-07-06')).toBe('2026-07-06')
  })
  it('rejects datetime strings', () => {
    expect(() => zIsoDate.parse('2026-07-06T14:30:00Z')).toThrow()
  })
  it('rejects non-padded dates', () => {
    expect(() => zIsoDate.parse('2026-7-6')).toThrow()
  })
})

describe('zSlotLabel', () => {
  it('accepts valid 12h IST slot labels', () => {
    expect(zSlotLabel.parse('7:30 PM')).toBe('7:30 PM')
    expect(zSlotLabel.parse('10:00 AM')).toBe('10:00 AM')
    expect(zSlotLabel.parse('12:45 PM')).toBe('12:45 PM')
    expect(zSlotLabel.parse('1:00 AM')).toBe('1:00 AM')
  })
  it('rejects zero-padded hours (AGENTS.md §4.6 rule)', () => {
    expect(() => zSlotLabel.parse('07:30 PM')).toThrow()
  })
  it('rejects 24h format', () => {
    expect(() => zSlotLabel.parse('19:30')).toThrow()
  })
  it('rejects 13 as hour', () => {
    expect(() => zSlotLabel.parse('13:30 PM')).toThrow()
  })
})

describe('zFactKey', () => {
  it('accepts all 18 defined fact keys', () => {
    const validKeys = [
      'dietary.restrictions', 'dietary.allergies',
      'budget.daily_food_target', 'budget.dining_out_budget',
      'location.home', 'location.work',
      'kitchen.skill_level', 'kitchen.equipment',
      'household.size',
      'fitness.protein_target', 'fitness.calorie_target', 'fitness.gym_days',
      'preference.cuisines.liked', 'preference.cuisines.disliked',
      'pantry.staples', 'ordering.frequent_restaurants',
      'cooking.can_cook', 'health.last_sick_day',
    ]
    for (const key of validKeys) {
      expect(zFactKey.parse(key)).toBe(key)
    }
  })
  it('rejects invented keys (Memory Agent guard)', () => {
    expect(() => zFactKey.parse('invented.key')).toThrow()
    expect(() => zFactKey.parse('user.name')).toThrow()
    expect(() => zFactKey.parse('')).toThrow()
  })
})

// ── Enum tests ────────────────────────────────────────────────────────────────

describe('zSituationType', () => {
  it('accepts all 11 situation types', () => {
    const types = [
      'sick', 'broke', 'date_planning', 'party_hosting', 'nutrition_goal',
      'quick_meal', 'meal_prep', 'office_lunch', 'family_dinner', 'late_night',
      'general',
    ]
    for (const t of types) {
      expect(zSituationType.parse(t)).toBe(t)
    }
  })
  it('rejects unknown types', () => {
    expect(() => zSituationType.parse('hungry')).toThrow()
  })
})

describe('zSituationStatus', () => {
  it('accepts all 10 statuses (including error and intent_extracted)', () => {
    // These 10 per API.md (TYPES.md §14 item 11)
    const statuses = [
      'created', 'intent_extracted', 'clarifying', 'context_ready', 'planning',
      'plan_ready', 'executing', 'completed', 'abandoned', 'error',
    ]
    for (const s of statuses) {
      expect(zSituationStatus.parse(s)).toBe(s)
    }
  })
})

describe('zPrimaryPath', () => {
  it('accepts lowercase path names', () => {
    expect(zPrimaryPath.parse('cook')).toBe('cook')
    expect(zPrimaryPath.parse('order')).toBe('order')
    expect(zPrimaryPath.parse('dineout')).toBe('dineout')
  })
  it('rejects uppercase (use zEnginePath for those)', () => {
    expect(() => zPrimaryPath.parse('COOK')).toThrow()
  })
})

describe('zEnginePath', () => {
  it('accepts uppercase engine path names', () => {
    expect(zEnginePath.parse('COOK')).toBe('COOK')
    expect(zEnginePath.parse('ORDER')).toBe('ORDER')
    expect(zEnginePath.parse('DINE_OUT')).toBe('DINE_OUT')
  })
  it('rejects lowercase (use zPrimaryPath for those)', () => {
    expect(() => zEnginePath.parse('cook')).toThrow()
    expect(() => zEnginePath.parse('dineout')).toThrow()
  })
})

describe('zMemorySource', () => {
  it('accepts all 6 sources (TYPES.md §14 item 7)', () => {
    const sources = [
      'onboarding', 'user_stated', 'user_edited',
      'clarification_answer', 'behavior_inferred', 'action_derived',
    ]
    for (const s of sources) {
      expect(zMemorySource.parse(s)).toBe(s)
    }
  })
})

// ── Composite building block tests ────────────────────────────────────────────

describe('NutritionInfoSchema', () => {
  it('accepts valid nutrition info', () => {
    const result = NutritionInfoSchema.parse({
      calories: 450,
      protein_g: 35,
      carbs_g: 60,
      fat_g: 12,
    })
    expect(result.calories).toBe(450)
    expect(result.protein_g).toBe(35)
  })
  it('rejects missing fields', () => {
    expect(() => NutritionInfoSchema.parse({ calories: 450 })).toThrow()
  })
  it('rejects floats', () => {
    expect(() => NutritionInfoSchema.parse({ calories: 450.5, protein_g: 35, carbs_g: 60, fat_g: 12 })).toThrow()
  })
})

describe('RecipeStepSchema', () => {
  it('accepts valid recipe step', () => {
    const step = {
      step: 1,
      instruction: 'Heat oil in a pan over medium flame.',
      duration_min: 3,
    }
    expect(RecipeStepSchema.parse(step).step).toBe(1)
  })
  it('accepts step with optional fields', () => {
    const step = {
      step: 2,
      instruction: 'Add onions and sauté until golden.',
      duration_min: 5,
      tip: 'Use a medium flame to avoid burning.',
      youtube_timestamp: '2:30',
    }
    expect(RecipeStepSchema.parse(step).youtube_timestamp).toBe('2:30')
  })
  it('rejects invalid youtube_timestamp format', () => {
    expect(() => RecipeStepSchema.parse({
      step: 1,
      instruction: 'Test',
      duration_min: 3,
      youtube_timestamp: '2:30:00',  // HH:MM:SS not allowed
    })).toThrow()
  })
  it('rejects step 0 (must be 1-based)', () => {
    expect(() => RecipeStepSchema.parse({ step: 0, instruction: 'Test', duration_min: 3 })).toThrow()
  })
  it('rejects step above 40', () => {
    expect(() => RecipeStepSchema.parse({ step: 41, instruction: 'Test', duration_min: 3 })).toThrow()
  })
})

describe('ClarificationQuestionSchema', () => {
  it('accepts valid single-choice question', () => {
    const q = {
      id: 'q1',
      text: 'Are you cooking for yourself or others?',
      field: 'alone',
      type: 'single_choice',
      options: [
        { label: 'Just me', value: true },
        { label: 'With others', value: false },
      ],
      required: true,
    }
    expect(ClarificationQuestionSchema.parse(q).id).toBe('q1')
  })
  it('rejects question id q4 (max is q3)', () => {
    expect(() => ClarificationQuestionSchema.parse({
      id: 'q4',
      text: 'Some question?',
      field: 'alone',
      type: 'freetext',
      options: [],
      required: false,
    })).toThrow()
  })
  it('accepts freetext question with empty options', () => {
    const q = {
      id: 'q2',
      text: 'What are you craving?',
      field: 'craving',
      type: 'freetext',
      options: [],
      required: false,
    }
    expect(ClarificationQuestionSchema.parse(q).options).toEqual([])
  })
  it('rejects options with 7 items (max is 6)', () => {
    const options = Array.from({ length: 7 }, (_, i) => ({ label: `Option ${i}`, value: `opt${i}` }))
    expect(() => ClarificationQuestionSchema.parse({
      id: 'q1',
      text: 'Pick one?',
      field: 'craving',
      type: 'single_choice',
      options,
      required: true,
    })).toThrow()
  })
})

describe('ClarificationAnswerValueSchema', () => {
  it('accepts string answers (freetext)', () => {
    expect(ClarificationAnswerValueSchema.parse('I want biryani')).toBe('I want biryani')
  })
  it('rejects freetext above 500 chars', () => {
    expect(() => ClarificationAnswerValueSchema.parse('a'.repeat(501))).toThrow()
  })
  it('accepts boolean (single_choice)', () => {
    expect(ClarificationAnswerValueSchema.parse(true)).toBe(true)
  })
  it('accepts integer (number type)', () => {
    expect(ClarificationAnswerValueSchema.parse(3)).toBe(3)
  })
  it('accepts string array (multi_choice)', () => {
    expect(ClarificationAnswerValueSchema.parse(['veg', 'jain'])).toEqual(['veg', 'jain'])
  })
  it('rejects float (number type should be int)', () => {
    // The schema uses z.number().int() for the number branch
    expect(() => ClarificationAnswerValueSchema.parse(3.5)).toThrow()
  })
})

describe('PathComparisonSchema', () => {
  it('accepts valid path comparison', () => {
    const pc = {
      score: 85,
      estimated_cost_inr: 250,
      estimated_time_min: 30,
      feasible: true,
      scoring_factors: {
        goal_match: 20,
        budget_fit: 18,
        time_fit: 22,
        preference_match: 15,
      },
      reason: 'Quick delivery within budget.',
    }
    expect(PathComparisonSchema.parse(pc).score).toBe(85)
  })
  it('accepts negative scoring_factors (wrong-fit paths)', () => {
    const pc = {
      score: 30,
      estimated_cost_inr: 1200,
      estimated_time_min: 90,
      feasible: true,
      scoring_factors: {
        goal_match: -10,
        budget_fit: -5,
        time_fit: -8,
        preference_match: 5,
      },
      reason: 'Too expensive for the budget.',
    }
    expect(PathComparisonSchema.parse(pc).scoring_factors.goal_match).toBe(-10)
  })
  it('rejects scoring_factor above 25', () => {
    expect(() => PathComparisonSchema.parse({
      score: 100,
      estimated_cost_inr: 200,
      estimated_time_min: 20,
      feasible: true,
      scoring_factors: { goal_match: 26, budget_fit: 0, time_fit: 0, preference_match: 0 },
      reason: 'Test',
    })).toThrow()
  })
})

describe('ComparisonScoresSchema', () => {
  const makePath = (score: number) => ({
    score,
    estimated_cost_inr: 200,
    estimated_time_min: 30,
    feasible: true,
    scoring_factors: { goal_match: score / 4, budget_fit: score / 4, time_fit: score / 4, preference_match: score / 4 },
    reason: 'Valid.',
  })

  it('accepts three-path comparison', () => {
    const result = ComparisonScoresSchema.parse({
      cook: makePath(80),
      order: makePath(65),
      dine_out: makePath(45),
    })
    expect(result.cook.score).toBe(80)
    expect(result.dine_out.score).toBe(45)
  })

  it('rejects missing cook path', () => {
    expect(() => ComparisonScoresSchema.parse({
      order: makePath(65),
      dine_out: makePath(45),
    })).toThrow()
  })
})
