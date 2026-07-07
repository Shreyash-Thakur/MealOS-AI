/**
 * lib/memory/retrieval.ts
 * MealOS AI — Memory Read Service
 *
 * Assembles MemoryContext for the Conversation pipeline (the `fromMemory` block
 * that ConversationAgent receives as `userMemorySummary`) and the Planning pipeline
 * (the `userMemory` block that PlanningAgent receives).
 *
 * This is a read-only module. It does NOT write to user_memory_facts.
 * All reads go through memoryFactRepo (the only permitted DB access path).
 *
 * References:
 *   - docs/BACKEND_DESIGN.md §7 (Memory Service interface)
 *   - docs/AGENTS.md §2.3 (ConversationAgent.userMemorySummary)
 *   - docs/AGENTS.md §3.3 (PlanningAgent.userMemory shape)
 */

import { getFactsForUser } from '@/lib/repositories/memoryFactRepo'
import { filterExpiredByConfidence } from './decay'
import { isValidFactKey } from './factKeys'
import type { FactKey, FactValueByKey, MemorySource } from '@/types/memory'
import type { DietType, CookingSkill } from '@/types/memory'

// ── MemoryContext — what the Conversation pipeline sees ───────────────────────

/**
 * Structured memory passed into the Conversation Service and then to
 * ConversationAgent as `userMemorySummary`.
 * Mirrors the MemoryContextSchema in lib/schemas/agents.ts.
 */
export interface MemoryContext {
  dietType?: DietType
  allergies?: string[]
  budget?: number
  cookingSkill?: CookingSkill
  kitchenEquipment?: string[]
  homeLoc?: string
  proteinTarget?: number
  preferredCuisines?: string[]
}

/**
 * Planning-layer memory — richer shape consumed by PlanningAgentInput.userMemory.
 * Mirrors docs/AGENTS.md §3.3 userMemory shape.
 */
export interface PlanningMemory {
  diet: DietType | null
  budget: number | null
  allergies: string[]
  cookingSkill: CookingSkill | null
  kitchenEquipment: string[]
  householdSize: number
  fitnessGoals: {
    dailyProteinG?: number
    dailyCalorieTarget?: number
    gymDays?: string[]
  }
  preferredCuisines: string[]
  dislikedCuisines: string[]
  frequentRestaurants: string[]
  pantryStaples: string[]
}

// ── Internal helper ───────────────────────────────────────────────────────────

type FactMap = Partial<{ [K in FactKey]: FactValueByKey[K] }>

/**
 * Maps DB source values to domain MemorySource for the decay filter.
 * The Prisma memory_source enum (4 values: ONBOARDING, CLARIFICATION,
 * AGENT_INFERRED, USER_EDITED) differs from types/memory.ts MemorySource
 * (6 values) — a known spec conflict, reported not forked. Identity entries
 * keep domain-typed callers (and tests) working unchanged.
 */
const TO_DOMAIN_SOURCE: Record<string, MemorySource> = {
  // Prisma enum values
  ONBOARDING: 'onboarding',
  CLARIFICATION: 'clarification_answer',
  AGENT_INFERRED: 'behavior_inferred',
  USER_EDITED: 'user_edited',
  // Domain identity mappings
  onboarding: 'onboarding',
  user_stated: 'user_stated',
  user_edited: 'user_edited',
  clarification_answer: 'clarification_answer',
  behavior_inferred: 'behavior_inferred',
  action_derived: 'action_derived',
}

/**
 * Load and validate all non-expired facts for a user, returning a typed map.
 * Unknown keys (should not happen in production, but guards against DB drift) are skipped.
 */
async function loadFactMap(userId: string): Promise<FactMap> {
  const raw = await getFactsForUser(userId)

  // Apply confidence-decay expiry filter (date-expiry already handled by repo)
  const live = filterExpiredByConfidence(
    raw.map((f) => ({
      factKey: f.factKey as string,
      factValue: f.factValue as unknown,
      confidence: f.confidence,
      // Conservative default for unknown source strings: 'user_stated' (never decays)
      source: TO_DOMAIN_SOURCE[String(f.source)] ?? 'user_stated',
      // getFactsForUser returns FactSummary which lacks lastConfirmedAt;
      // pass null so decay uses "now" as reference (conservative: no staleness info available)
      lastConfirmedAt: null,
    }))
  )

  const map: FactMap = {}
  for (const fact of live) {
    if (!isValidFactKey(fact.factKey)) continue
    // Type assertion is safe here: the repo and DB ensure factValue matches the key's type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(map as any)[fact.factKey] = fact.factValue
  }
  return map
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the MemoryContext for the Conversation pipeline.
 * Called before ConversationAgent to populate `fromMemory` in SituationContext.
 *
 * Returns an empty object for first-time users (no stored facts).
 */
export async function getMemoryContext(userId: string): Promise<MemoryContext> {
  const map = await loadFactMap(userId)
  const ctx: MemoryContext = {}

  if (map['dietary.restrictions'] !== undefined) {
    const restrictions = map['dietary.restrictions'] as string[]
    // Map first restriction to dietType if recognizable
    const first = restrictions[0]?.toLowerCase()
    if (first === 'vegetarian') ctx.dietType = 'vegetarian'
    else if (first === 'vegan') ctx.dietType = 'vegan'
    else if (first === 'jain') ctx.dietType = 'jain'
    else if (first === 'pescatarian') ctx.dietType = 'pescatarian'
  }
  if (map['dietary.allergies'] !== undefined) {
    ctx.allergies = map['dietary.allergies'] as string[]
  }
  if (map['budget.daily_food_target'] !== undefined) {
    ctx.budget = map['budget.daily_food_target'] as number
  }
  if (map['kitchen.skill_level'] !== undefined) {
    ctx.cookingSkill = map['kitchen.skill_level'] as CookingSkill
  }
  if (map['kitchen.equipment'] !== undefined) {
    ctx.kitchenEquipment = map['kitchen.equipment'] as string[]
  }
  if (map['location.home'] !== undefined) {
    ctx.homeLoc = map['location.home'] as string
  }
  if (map['fitness.protein_target'] !== undefined) {
    ctx.proteinTarget = map['fitness.protein_target'] as number
  }
  if (map['preference.cuisines.liked'] !== undefined) {
    ctx.preferredCuisines = map['preference.cuisines.liked'] as string[]
  }
  return ctx
}

/**
 * Build the natural-language summary string passed to ConversationAgent
 * as `userMemorySummary`. Returns null when the user has no stored facts.
 *
 * The format is intentionally terse — the agent uses it to avoid re-asking
 * known fields in `missingRequired`.
 *
 * @example
 * // "Vegetarian, daily food budget Rs 350, home in Bandra, cooks at intermediate level"
 */
export async function buildMemorySummary(userId: string): Promise<string | null> {
  const map = await loadFactMap(userId)
  if (Object.keys(map).length === 0) return null

  const parts: string[] = []

  const restrictions = map['dietary.restrictions'] as string[] | undefined
  if (restrictions && restrictions.length > 0) {
    parts.push(restrictions.join(', '))
  }

  const allergies = map['dietary.allergies'] as string[] | undefined
  if (allergies && allergies.length > 0) {
    parts.push(`allergic to ${allergies.join(', ')}`)
  }

  const budget = map['budget.daily_food_target'] as number | undefined
  if (budget !== undefined) {
    parts.push(`daily food budget Rs ${budget}`)
  }

  const dineoutBudget = map['budget.dining_out_budget'] as number | undefined
  if (dineoutBudget !== undefined) {
    parts.push(`dining-out budget Rs ${dineoutBudget} per outing`)
  }

  const homeLocation = map['location.home'] as string | undefined
  if (homeLocation) {
    parts.push(`home in ${homeLocation}`)
  }

  const skill = map['kitchen.skill_level'] as CookingSkill | undefined
  if (skill) {
    parts.push(`cooks at ${skill} level`)
  }

  const protein = map['fitness.protein_target'] as number | undefined
  if (protein !== undefined) {
    parts.push(`${protein}g daily protein target`)
  }

  const cuisines = map['preference.cuisines.liked'] as string[] | undefined
  if (cuisines && cuisines.length > 0) {
    parts.push(`prefers ${cuisines.join(', ')}`)
  }

  const household = map['household.size'] as number | undefined
  if (household !== undefined && household > 1) {
    parts.push(`household of ${household}`)
  }

  if (parts.length === 0) return null
  return parts.join(', ')
}

/**
 * Build the PlanningMemory shape consumed by PlanningAgentInput.userMemory.
 * Provides a complete struct with safe defaults for all fields.
 */
export async function getPlanningMemory(userId: string): Promise<PlanningMemory> {
  const map = await loadFactMap(userId)

  let diet: DietType | null = null
  const restrictions = map['dietary.restrictions'] as string[] | undefined
  if (restrictions && restrictions.length > 0) {
    const first = restrictions[0]?.toLowerCase()
    if (
      first === 'vegetarian' || first === 'vegan' ||
      first === 'jain' || first === 'pescatarian' || first === 'non_vegetarian'
    ) {
      diet = first as DietType
    }
  }

  const fitnessGoals: PlanningMemory['fitnessGoals'] = {}
  const proteinTarget = map['fitness.protein_target'] as number | undefined
  if (proteinTarget !== undefined) fitnessGoals.dailyProteinG = proteinTarget

  const calorieTarget = map['fitness.calorie_target'] as number | undefined
  if (calorieTarget !== undefined) fitnessGoals.dailyCalorieTarget = calorieTarget

  const gymDays = map['fitness.gym_days'] as string[] | undefined
  if (gymDays) fitnessGoals.gymDays = gymDays

  return {
    diet,
    budget: (map['budget.daily_food_target'] as number | undefined) ?? null,
    allergies: (map['dietary.allergies'] as string[] | undefined) ?? [],
    cookingSkill: (map['kitchen.skill_level'] as CookingSkill | undefined) ?? null,
    kitchenEquipment: (map['kitchen.equipment'] as string[] | undefined) ?? [],
    householdSize: (map['household.size'] as number | undefined) ?? 1,
    fitnessGoals,
    preferredCuisines: (map['preference.cuisines.liked'] as string[] | undefined) ?? [],
    dislikedCuisines: (map['preference.cuisines.disliked'] as string[] | undefined) ?? [],
    frequentRestaurants: (map['ordering.frequent_restaurants'] as string[] | undefined) ?? [],
    pantryStaples: (map['pantry.staples'] as string[] | undefined) ?? [],
  }
}
