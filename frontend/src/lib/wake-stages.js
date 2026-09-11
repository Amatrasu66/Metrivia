/**
 * Pure cold-start stage helpers for the Render backend wake UI.
 *
 * Driven by REAL elapsed seconds only — never a percentage, never a
 * remaining-time claim, since Render's internal startup progress is
 * unknowable. No DOM, no fetch, no `@/` imports — safe to unit-test in node.
 */

export const WAKE_STAGES = ["Connecting", "Starting server", "Ready"]

/** Progressive status copy for the given elapsed seconds. */
export function wakeStageMessage(elapsedSeconds) {
  const elapsed = Math.max(0, Math.floor(elapsedSeconds))
  if (elapsed <= 3) return "Connecting to the analysis server…"
  if (elapsed <= 10) return "Starting the analysis server…"
  if (elapsed <= 30) return "Server is waking up…"
  if (elapsed <= 60) return "Still starting — this can take a little longer…"
  return "Still waiting for the server…"
}

/**
 * Index into WAKE_STAGES currently in progress. The final stage only counts
 * as done once health actually succeeds (handled by the UI phase), so long
 * waits keep pulsing "Ready" without implying completion.
 */
export function wakeActiveStageIndex(elapsedSeconds) {
  const elapsed = Math.max(0, Math.floor(elapsedSeconds))
  if (elapsed < 4) return 0
  if (elapsed < 31) return 1
  return 2
}

/** "08 seconds" / "01 second" — padded, correctly pluralized. */
export function formatWakeElapsed(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  return `${String(seconds).padStart(2, "0")} ${seconds === 1 ? "second" : "seconds"}`
}
