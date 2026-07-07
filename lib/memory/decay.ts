/**
 * lib/memory/decay.ts
 * MealOS AI — Confidence Decay and Expiry Logic
 *
 * Rules (IMPLEMENTATION_PLAYBOOK.md M8 DoD + docs/AGENTS.md §5.5):
 *   - Confidence decays 0.05 per week for inferred facts (behavior_inferred, action_derived)
 *   - Facts with confidence < 0.3 are considered expired and must be excluded from reads
 *   - Stated/confirmed facts (user_stated, clarification_answer, onboarding, user_edited)
 *     do NOT decay — they represent explicit user intent
 *   - Expiry by date (expiresAt column) is enforced by the repository; this module
 *     handles the confidence-floor expiry used when updating stale inferred facts
 */

import type { MemorySource } from '@/types/memory'

/** Decay rate per week for inferred facts. */
export const DECAY_RATE_PER_WEEK = 0.05

/** Confidence floor below which a fact is considered expired and excluded from reads. */
export const CONFIDENCE_EXPIRY_THRESHOLD = 0.3

/** Sources that are subject to confidence decay. */
const INFERRED_SOURCES: ReadonlySet<MemorySource> = new Set<MemorySource>([
  'behavior_inferred',
  'action_derived',
])

/**
 * Returns true if the given source is subject to weekly confidence decay.
 */
export function isInferredSource(source: MemorySource): boolean {
  return INFERRED_SOURCES.has(source)
}

/**
 * Compute the decayed confidence for an inferred fact.
 *
 * @param currentConfidence - The fact's current confidence (0.0–1.0)
 * @param lastConfirmedAt - When the fact was last confirmed; null means never (use createdAt)
 * @param now - The reference time for decay calculation; defaults to Date.now()
 * @returns The decayed confidence, clamped to [0, 1]
 *
 * @example
 * // Fact confirmed 3 weeks ago at confidence 0.6
 * decayConfidence(0.6, threeWeeksAgo) // → 0.45
 * decayConfidence(0.6, sevenWeeksAgo) // → 0.25 (below threshold → expired)
 */
export function decayConfidence(
  currentConfidence: number,
  lastConfirmedAt: Date | null,
  now: Date = new Date()
): number {
  const referenceDate = lastConfirmedAt ?? now
  const msPerWeek = 7 * 24 * 60 * 60 * 1000
  const weeksElapsed = Math.max(0, (now.getTime() - referenceDate.getTime()) / msPerWeek)
  const decayed = currentConfidence - DECAY_RATE_PER_WEEK * weeksElapsed
  return Math.max(0, Math.min(1, decayed))
}

/**
 * Returns true if a fact is expired due to low confidence after decay.
 * Note: date-based expiry (expiresAt) is enforced at the DB layer by the repository.
 * This function handles the confidence-floor check only.
 *
 * @param source - The memory source; only inferred sources decay
 * @param currentConfidence - The current (pre-decay) confidence
 * @param lastConfirmedAt - When the fact was last confirmed
 * @param now - Reference time; defaults to new Date()
 */
export function isExpiredByConfidence(
  source: MemorySource,
  currentConfidence: number,
  lastConfirmedAt: Date | null,
  now: Date = new Date()
): boolean {
  if (!isInferredSource(source)) {
    // Stated/confirmed facts do not decay and are never expired by confidence
    return false
  }
  const decayed = decayConfidence(currentConfidence, lastConfirmedAt, now)
  return decayed < CONFIDENCE_EXPIRY_THRESHOLD
}

/**
 * Filter a list of fact summaries to exclude those that are confidence-expired.
 * The repository already excludes date-expired facts; this layer removes
 * inferred facts whose confidence has decayed below the threshold.
 *
 * @param facts - Array of facts (must include source, confidence, lastConfirmedAt)
 * @param now - Reference time for decay; defaults to new Date()
 */
export function filterExpiredByConfidence<
  T extends { source: MemorySource; confidence: number; lastConfirmedAt?: Date | string | null }
>(facts: T[], now: Date = new Date()): T[] {
  return facts.filter((fact) => {
    if (!isInferredSource(fact.source as MemorySource)) return true
    const lastConfirmedDate = fact.lastConfirmedAt
      ? new Date(fact.lastConfirmedAt as string | Date)
      : null
    return !isExpiredByConfidence(fact.source as MemorySource, fact.confidence, lastConfirmedDate, now)
  })
}

/**
 * Compute the post-decay confidence for display/write purposes.
 * Only applies to inferred sources; returns currentConfidence unchanged otherwise.
 */
export function getEffectiveConfidence(
  source: MemorySource,
  currentConfidence: number,
  lastConfirmedAt: Date | null,
  now: Date = new Date()
): number {
  if (!isInferredSource(source)) return currentConfidence
  return decayConfidence(currentConfidence, lastConfirmedAt, now)
}
