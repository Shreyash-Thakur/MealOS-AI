/**
 * lib/agents/orchestrator.ts
 * MealOS AI — Agent Pipeline Orchestrator (docs/AGENTS.md §7)
 *
 * Runs the full situation pipeline in response to a GET /stream request:
 *   ConversationAgent → ClarificationEngine → [pause for answers] →
 *   ToolAgent ∥ DecisionEngine → PlanningAgent → save recommendation
 *
 * All SSE events are emitted via the `send` callback injected by the stream
 * route handler. State transitions are written to the DB after each stage.
 *
 * Recovery contract (AGENTS.md §7.5):
 *   The orchestrator never throws. Every failure mode produces a typed result
 *   and the user always receives a plan (possibly a degraded one).
 *
 * Clarification pause (AGENTS.md §7.3 step 2):
 *   If missingRequired.length > 0, the orchestrator emits `clarification_needed`
 *   and awaits `waitForClarificationAnswers(situationId)`. POST /clarify calls
 *   `deliverClarificationAnswers(situationId, answers)` to unblock it.
 *
 * ⚠ V1 in-process clarification bus — see lib/sse.ts for the production note.
 */

import { runConversationAgent } from '@/lib/agents/conversation'
import { runClarificationEngine } from '@/lib/agents/clarification'
import { runToolAgent } from '@/lib/agents/tool'
import { runPlanningAgent } from '@/lib/agents/planning'
import { computeDecision } from '@/lib/engine/scorer'
import { buildScoringContext, buildPathInputs } from '@/lib/engine/contextBuilder'
import { waitForClarificationAnswers } from '@/lib/sse'
import {
  transitionToClarifying,
  transitionToContextReady,
  transitionToPlanning,
  transitionToPlanReady,
  updateClarificationData,
  setSituationType,
} from '@/lib/repositories/situationRepo'
import { createRecommendation } from '@/lib/repositories/recommendationRepo'
import { getMemoryContext, buildMemorySummary, getPlanningMemory } from '@/lib/memory/retrieval'
import { runMemoryAgent } from '@/lib/agents/memory'
import { getFactsForUser } from '@/lib/repositories/memoryFactRepo'
import type { SituationContext } from '@/types/situation'
import type { FactKey } from '@/types/memory'
import type { FactConfidence } from '@/types/primitives'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OrchestratorInput {
  situationId: string
  userId: string
  rawInput: string
  timestamp: string
  userTimezone: string
}

export interface OrchestratorOutput {
  pipelineStatus: 'complete' | 'degraded' | 'failed'
  recommendationId: string | null
  totalLatencyMs: number
}

type SseSend = (eventName: string, data: unknown) => void

// Clarification timeout: 5 minutes from when the event is emitted
const CLARIFICATION_TIMEOUT_MS = 5 * 60 * 1000

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extracts the known-context map for the ClarificationEngine from a
 * SituationContext — everything already filled in should not be asked again.
 */
function extractKnownContext(ctx: {
  explicit: Record<string, unknown>
  inferred: Record<string, unknown>
  fromMemory: Record<string, unknown>
}): Record<string, unknown> {
  return {
    ...Object.fromEntries(
      Object.entries(ctx.fromMemory).filter(([, v]) => v !== undefined),
    ),
    ...Object.fromEntries(
      Object.entries(ctx.explicit).filter(([, v]) => v !== undefined),
    ),
    ...Object.fromEntries(
      Object.entries(ctx.inferred).filter(([, v]) => v !== undefined),
    ),
  }
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

/**
 * Runs the full MealOS agent pipeline for one situation.
 *
 * @param input - Situation identifiers and the raw user text.
 * @param send  - SSE event emitter provided by the stream route handler.
 * @returns     - Typed pipeline result; never throws.
 */
export async function runOrchestrator(
  input: OrchestratorInput,
  send: SseSend,
): Promise<OrchestratorOutput> {
  const start = Date.now()
  const { situationId, userId, rawInput, timestamp, userTimezone } = input

  // ── [1] Conversation Agent ──────────────────────────────────────────────────
  const [memorySummary, memCtx] = await Promise.all([
    buildMemorySummary(userId),
    getMemoryContext(userId),
  ])

  const convResult = await runConversationAgent({
    rawInput,
    timestamp: timestamp as import('@/types/primitives').ISODateTime,
    userTimezone: userTimezone as import('@/types/primitives').IANATimezone,
    userMemorySummary: memorySummary,
    sessionSituationCount: 1,
  })

  await setSituationType(situationId, convResult.output.situationType as never)

  send('context_understood', {
    situation_type: convResult.output.situationType,
    understood_as: rawInput.slice(0, 100),
    confidence: convResult.output.confidence,
    known_fields: Object.keys(convResult.output.explicit ?? {}).filter(
      (k) => convResult.output.explicit[k as keyof typeof convResult.output.explicit] !== undefined,
    ),
    assumptions: convResult.output.ambiguities?.map((a) => ({
      field: a,
      value: 'assumed',
      source: 'inference' as const,
    })) ?? [],
  })

  // nonFoodInput: stop here, redirect the user
  if (convResult.output.nonFoodInput) {
    send('non_food_redirect', {
      message: 'This doesn\'t look like a food-related request. Try asking about what to eat!',
    })
    return { pipelineStatus: 'complete', recommendationId: null, totalLatencyMs: Date.now() - start }
  }

  // ── [2] Build initial SituationContext ─────────────────────────────────────
  let situationContext: SituationContext = {
    situationType: convResult.output.situationType,
    explicit: convResult.output.explicit as SituationContext['explicit'],
    inferred: convResult.output.inferred as SituationContext['inferred'],
    fromMemory: {
      dietType: memCtx.dietType,
      allergies: memCtx.allergies,
      budget: memCtx.budget as SituationContext['fromMemory']['budget'],
      cookingSkill: memCtx.cookingSkill,
      kitchenEquipment: memCtx.kitchenEquipment,
      homeLoc: memCtx.homeLoc,
      preferredCuisines: memCtx.preferredCuisines,
    },
  }

  // ── [3] Clarification Engine ───────────────────────────────────────────────
  const memoryFacts = Object.fromEntries(
    Object.entries(memCtx).filter(([, v]) => v !== undefined),
  ) as Parameters<typeof runClarificationEngine>[0]['memoryFacts']

  for (let pass = 1; pass <= 2; pass++) {
    const clarResult = await runClarificationEngine({
      situationType: situationContext.situationType,
      missingRequired: convResult.output.missingRequired,
      missingSoft: convResult.output.missingSoft ?? [],
      knownContext: extractKnownContext(situationContext as never),
      memoryFacts,
      userMemorySummary: memorySummary,
      confidence: convResult.output.confidence,
      passNumber: pass as 1 | 2,
    })

    if (clarResult.questions.length === 0) {
      // No questions needed — proceed to planning
      break
    }

    // Persist clarification state
    const clarificationId = crypto.randomUUID()
    const clarificationData = {
      passes: [{
        passNumber: pass,
        questions: clarResult.questions,
        answers: {},
        askedAt: new Date().toISOString(),
        answeredAt: null,
        clarificationId,
      }],
    }

    await transitionToClarifying(situationId, { clarificationData })

    const expiresAt = new Date(Date.now() + CLARIFICATION_TIMEOUT_MS).toISOString()
    send('clarification_needed', {
      clarification_id: clarificationId,
      pass_number: pass,
      questions: clarResult.questions,
      assumptions_stated: clarResult.assumptionStatements.map((a) => a.text ?? String(a)),
      expires_at: expiresAt,
    })

    // Wait for user answers
    const answers = await waitForClarificationAnswers(situationId, CLARIFICATION_TIMEOUT_MS)

    // Merge answers into the context
    const mergedExplicit = { ...situationContext.explicit, ...answers }
    situationContext = { ...situationContext, explicit: mergedExplicit as SituationContext['explicit'] }

    // Update persisted clarification data
    const updatedData = {
      passes: clarificationData.passes.map((p) =>
        p.passNumber === pass
          ? { ...p, answers, answeredAt: new Date().toISOString() }
          : p,
      ),
    }
    await updateClarificationData(situationId, updatedData)

    if (pass === 2) break
  }

  // Context is now fully assembled
  await transitionToContextReady(situationId, {
    context: situationContext,
    situationType: situationContext.situationType as never,
  })

  // ── [4] Tool Agent + Decision Engine (parallel in spirit; tool is async) ───
  send('planning_started', {
    agents_running: ['swiggy', 'budget'],
    estimated_seconds: 8,
  })

  await transitionToPlanning(situationId)

  // Run Tool Agent with the situation context (location defaulted to Mumbai for V1)
  const toolResult = await runToolAgent({
    situationType: situationContext.situationType,
    pathAvailability: { cook: true, order: true, dineout: true },
    location: { lat: 19.076, lng: 72.877 }, // Mumbai default for V1
    budget: typeof situationContext.explicit.budget === 'number'
      ? situationContext.explicit.budget
      : typeof situationContext.fromMemory.budget === 'number'
        ? situationContext.fromMemory.budget
        : undefined,
    dietaryFilter:
      situationContext.fromMemory.dietType === 'vegetarian' ? 'vegetarian' :
      situationContext.fromMemory.dietType === 'vegan' ? 'vegan' :
      'none',
    craving: situationContext.explicit.craving,
    // A stated craving is V1's recipe identification for the cook path — it
    // gates the youtube_search_recipe call (AGENTS.md §4.3 Tool 4).
    ...(situationContext.explicit.craving !== undefined
      ? { recipeName: situationContext.explicit.craving }
      : {}),
    ...(situationContext.explicit.timeConstraintMinutes !== undefined
      ? { timeConstraintMinutes: situationContext.explicit.timeConstraintMinutes as number }
      : {}),
    ...(situationContext.fromMemory.cookingSkill !== undefined
      ? { cookingSkill: situationContext.fromMemory.cookingSkill }
      : {}),
  }, {
    onProgress: (event) => {
      send('agent_progress', {
        agent: 'swiggy',
        status: event.status,
        message: event.message,
      })
    },
  })

  // Build Decision Engine inputs
  const pantryItems: { id: string }[] = []
  const scoringCtx = buildScoringContext(situationContext, toolResult, pantryItems)
  const { cook, order, dineOut } = buildPathInputs(situationContext, toolResult, pantryItems)
  const decision = computeDecision(scoringCtx, cook, order, dineOut)

  // Translate DecisionResult to the compact ScoreResult the Planning Agent needs
  const preCalculatedScores = {
    cook: decision.cookScore.finalScore,
    order: decision.orderScore.finalScore,
    dineout: decision.dineOutScore.finalScore,
  }
  const pathAvailability = {
    cook: decision.cookScore.available,
    order: decision.orderScore.available,
    dineout: decision.dineOutScore.available,
  }

  // ── [5] Planning Agent ──────────────────────────────────────────────────────
  const planningMemory = await getPlanningMemory(userId)
  const isDegradedMode = toolResult.swiggyError === 'SWIGGY_UNAVAILABLE'

  const planResult = await runPlanningAgent({
    situationContext,
    userMemory: {
      diet: planningMemory.diet,
      budget: planningMemory.budget as never,
      allergies: planningMemory.allergies,
      cookingSkill: planningMemory.cookingSkill,
      kitchenEquipment: planningMemory.kitchenEquipment,
      householdSize: planningMemory.householdSize,
      fitnessGoals: planningMemory.fitnessGoals as never,
      preferredCuisines: planningMemory.preferredCuisines,
      dislikedCuisines: planningMemory.dislikedCuisines,
      frequentRestaurants: planningMemory.frequentRestaurants,
      pantryStaples: planningMemory.pantryStaples,
    },
    preCalculatedScores,
    pathAvailability,
    swiggyResults: toolResult.swiggyError
      ? null
      : {
          restaurants: toolResult.restaurants as never,
          instamartItems: toolResult.instamartItems as never,
          dineoutVenues: toolResult.dineoutVenues as never,
        },
    youtubeResult: toolResult.youtube as never,
    pantryItems: [] as never,
    isDegradedMode,
  })

  send('agent_progress', {
    agent: 'planning',
    status: planResult.status === 'completed' ? 'completed' : 'failed',
    message: planResult.status === 'completed' ? 'Plan ready' : 'Using fallback plan',
  })

  // ── [6] Save recommendation ────────────────────────────────────────────────
  const plan = planResult.output
  const pipelineStatus: OrchestratorOutput['pipelineStatus'] =
    planResult.status === 'completed' ? 'complete' :
    planResult.status === 'timeout' || planResult.status === 'schema_failed' ? 'degraded' :
    'failed'

  const rec = await createRecommendation({
    situationId,
    userId,
    comparisonScores: { cook: preCalculatedScores.cook, order: preCalculatedScores.order, dineout: preCalculatedScores.dineout },
    primaryPath: plan.primaryPath.toUpperCase().replace('DINEOUT', 'DINE_OUT') as never,
    explanation: plan.explanation,
    confidenceScore: decision.confidence,
    title: plan.recommendation.title,
    estimatedCost: plan.recommendation.estimatedCost as unknown as number,
    estimatedTimeMin: plan.recommendation.estimatedTime as unknown as number,
    recipeSteps: plan.recommendation.recipeSteps ?? null,
    // Cache the recipe video on the row (M7 DoD; column is COOK-path only)
    youtubeUrl: plan.primaryPath === 'cook' && toolResult.youtube
      ? `https://www.youtube.com/watch?v=${toolResult.youtube.videoId}`
      : null,
    swiggyData: plan.recommendation.restaurantId
      ? { restaurantId: plan.recommendation.restaurantId, restaurantName: plan.recommendation.restaurantName }
      : null,
  })

  await transitionToPlanReady(situationId, {
    situationType: situationContext.situationType as never,
  })

  send('plan_ready', {
    recommendation_id: rec.id,
    headline: plan.recommendation.title,
    plan_type: plan.primaryPath,
    preview: {
      primary_service: plan.primaryPath === 'cook' ? 'recipe' :
                        plan.primaryPath === 'order' ? 'swiggy_food' : 'dineout',
      primary_title: plan.recommendation.title,
      primary_cost: plan.recommendation.estimatedCost,
      primary_time: plan.recommendation.estimatedTime,
      alternatives_count: plan.whyNotAlternatives.length,
    },
  })

  // Fire-and-forget: extract facts from this interaction for long-term memory.
  // Runs after plan is delivered; failures are swallowed — never impacts the user.
  void (async () => {
    try {
      const existingFacts = await getFactsForUser(userId)
      await runMemoryAgent(userId, {
        completedSituation: {
          rawInput,
          situationType: situationContext.situationType,
          explicit: situationContext.explicit as never,
          inferred: situationContext.inferred as never,
          recommendation: {
            primaryPath: plan.primaryPath as never,
            title: plan.recommendation.title,
            estimatedCost: plan.recommendation.estimatedCost as never,
          },
        },
        clarificationAnswers: [],
        executedPath: plan.primaryPath,
        userRating: null,
        existingFacts: existingFacts.map((f) => ({
          factKey: f.factKey as FactKey,
          factValue: f.factValue,
          confidence: f.confidence as FactConfidence,
        })),
      })
    } catch {
      // Silent failure — memory trigger never impacts the user
    }
  })()

  return {
    pipelineStatus,
    recommendationId: rec.id,
    totalLatencyMs: Date.now() - start,
  }
}
