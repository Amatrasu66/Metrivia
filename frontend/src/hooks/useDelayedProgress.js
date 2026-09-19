import { useEffect, useRef, useState } from "react"

/**
 * Phase L backend-aware loading: spinner first, truthful progress only if
 * the operation is still running after `delayMs` (~800ms).
 *
 * The upload API streams real backend milestones over the same request
 * (`POST /api/upload?stream=progress`): ordered, monotonic values in 0..90
 * (file accepted → CSV parsed → per-column analysis → per-column
 * conversion → row assembly → response ready). The caller forwards the
 * latest milestone as `backendValue` (+ truthful `backendStage` label);
 * this hook only *displays* it:
 *
 * - Never renders progress before `delayMs` (fast uploads keep the spinner;
 *   early backend events are buffered and the bar initializes from the
 *   latest known milestone instead of starting at 0 and jumping).
 * - Moves the bar LINEARLY toward the latest backend milestone — no
 *   ease-out, no exponential curve, no estimated 0→95% timer. Each tick
 *   advances at most `LINEAR_RATE_PER_SEC`, never overshoots the target,
 *   and never moves backward.
 * - Never exceeds `cap` (99) while waiting and never reaches 100 until the
 *   caller reports a usable result (`backendValue={100}` on parsed dataset
 *   or `complete()`), so 100% always means "result usable".
 * - All timers are cancelled on unmount, `active` false, or `resetKey`
 *   change (workspace close / new file / retry), so no timer outlives its
 *   workspace. Pair with `key={resetKey}` upstream for fresh state.
 * - Workspace-ID safety lives with the caller: pass a `resetKey` that
 *   changes per workspace upload (e.g. file name + wake timestamp).
 */

export const PROGRESS_DELAY_MS = 800
export const PROGRESS_CAP = 99
export const PROGRESS_MIN_VISIBLE_MS = 400
export const PROGRESS_SMOOTH_INTERVAL_MS = 100
export const PROGRESS_LINEAR_RATE_PER_SEC = 50
// Long-running CSV fallback: once the SAME analysis request has been
// pending this long, the progress card hands off to the Tetris loading
// state (presentation only — the request continues untouched). Consumed by
// AnalysisProgressState's single-timeout switch.
export const LONG_RUNNING_MS = 30_000

export function stageLabelForValue(value) {
  if (value < 5) return "Starting analysis"
  if (value < 20) return "File received"
  if (value < 60) return "Analyzing columns"
  if (value < 80) return "Converting records"
  if (value < 85) return "Assembling rows"
  if (value < 100) return "Preparing response"
  return "Complete"
}

function clampToCap(value, cap) {
  if (!Number.isFinite(value)) return 0
  return Math.min(cap, Math.max(0, value))
}

/**
 * @param {object} options
 * @param {boolean} options.active — true while the upload/analysis is in flight
 * @param {string} [options.resetKey] — changes restart timers (use with key={resetKey})
 * @param {number|null} [options.backendValue] — latest backend milestone (0..100) or null
 * @param {string|null} [options.backendStage] — truthful backend label for the milestone
 * @param {number} [options.delayMs] — spinner-only window before progress
 * @param {number} [options.cap] — max value while waiting (default 99; 100 only via result)
 */
export function useDelayedProgress({
  active,
  resetKey = "",
  backendValue = null,
  backendStage = null,
  delayMs = PROGRESS_DELAY_MS,
  cap = PROGRESS_CAP,
} = {}) {
  const [showProgress, setShowProgress] = useState(false)
  const [value, setValue] = useState(0)
  // Latest backend milestone seen (monotonic: decreases are ignored so the
  // bar can never move backward even if a chunk ever arrived out of order).
  const targetRef = useRef(0)

  useEffect(() => {
    if (typeof backendValue === "number" && Number.isFinite(backendValue)) {
      const clamped = clampToCap(backendValue, cap)
      if (clamped > targetRef.current) {
        targetRef.current = clamped
      }
    }
  }, [backendValue, cap])

  // Spinner-only window. When the bar promotes, it initializes from the
  // latest known backend milestone (never 0-then-jump, never backward).
  useEffect(() => {
    if (!active) {
      return undefined
    }
    targetRef.current =
      typeof backendValue === "number" && Number.isFinite(backendValue)
        ? Math.max(0, clampToCap(backendValue, cap))
        : 0
    let delayTimer = null
    let cancelled = false
    delayTimer = setTimeout(() => {
      if (cancelled) return
      setValue(targetRef.current)
      setShowProgress(true)
    }, delayMs)
    return () => {
      cancelled = true
      if (delayTimer !== null) clearTimeout(delayTimer)
    }
    // backendValue/cap intentionally excluded: promotion reads the latest
    // via targetRef at fire time; including them would restart the 800ms
    // window on every milestone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, resetKey, delayMs])

  // Linear smoothing toward the latest milestone. Fixed step per tick, no
  // easing curve, no overshoot past the target, never backward.
  useEffect(() => {
    if (!active || !showProgress) {
      return undefined
    }
    let cancelled = false
    const step = PROGRESS_LINEAR_RATE_PER_SEC * (PROGRESS_SMOOTH_INTERVAL_MS / 1000)
    const tickTimer = setInterval(() => {
      if (cancelled) return
      const target = targetRef.current
      setValue((prev) => {
        if (target <= prev) return prev
        return Math.min(target, prev + step)
      })
    }, PROGRESS_SMOOTH_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(tickTimer)
    }
  }, [active, resetKey, showProgress])

  const complete = () => {
    // Success path: the result has been received AND parsed, so 100% means
    // "usable" — never a prediction. The caller unmounts right after
    // (dashboard replaces the loader).
    // Called from event handlers, never during render.
    targetRef.current = 100
    setValue(100)
    return 100
  }

  const stageLabel =
    typeof backendStage === "string" && backendStage.trim() !== ""
      ? backendStage
      : stageLabelForValue(value)

  return { showProgress, value, stageLabel, complete }
}

export default useDelayedProgress
