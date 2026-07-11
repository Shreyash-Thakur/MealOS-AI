/**
 * components/cooking/format.ts
 * MealOS AI — Cooking UI formatting helpers (ISSUE-132)
 */

/**
 * Format a duration in seconds as "MM:SS" for the YouTubeCard duration badge.
 * Durations over an hour stay in MM:SS (e.g. 3723 → "62:03") — recipe videos
 * are filtered to videoDuration=medium upstream, so hours never occur in
 * practice and a second format would be dead code.
 */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
