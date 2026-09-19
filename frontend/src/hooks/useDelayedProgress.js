import { useEffect, useState } from "react"

/**
 * Phase K smart loading: spinner first, staged estimated progress only if
 * the operation is still running after `delayMs` (~800ms).
 *
 * The upload API returns the completed result (no streaming stages), so
 * progress is *estimated*, never a backend percentage claim. Stages are
 * fixed labels mapped from the estimated value:
 *
 *   0–15%    Starting analysis
 *   15–35%   Reading CSV
 *   35–55%   Detecting column types
 *   55–75%   Calculating statistics
 *   75–90%   Preparing chart data
 *   90–95%   Finalizing
 *   95%      Waiting for server response (cap — waits for the real response)
 *
 * Rules enforced here:
 * - Never renders progress before `delayMs` (fast uploads keep the spinner).
 * - Never exceeds `cap` (95) while `active` — success sets 100 via `complete()`.
 * - All timers are cancelled on unmount, `active` false, or `resetKey` change
 *   (workspace close / new file / retry), so no timer outlives its workspace.
 * - Workspace-ID safety lives with the caller: pass a `resetKey` that changes
 *   per workspace upload (e.g. file name + wake timestamp) and mount with
 *   `key={resetKey}` so a new upload remounts with fresh state — a late timer
 *   from another workspace can never promote this one.
 * - No polling, no SSE, no backend API change.
 */

export const PROGRESS_DELAY_MS = 800
export const PROGRESS_CAP = 95
export const PROGRESS_MIN_VISIBLE_MS = 400

export function stageLabelForValue(value) {
  if (value < 15) return "Starting analysis"
  if (value < 35) return "Reading CSV"
  if (value < 55) return "Detecting column types"
  if (value < 75) return "Calculating statistics"
  if (value < 90) return "Preparing chart data"
  if (value < 95) return "Finalizing"
  return "Waiting for server response"
}

/**
 * @param {object} options
 * @param {boolean} options.active — true while the upload/analysis is in flight
 * @param {string} [options.resetKey] — changes restart timers (use with key={resetKey})
 * @param {number} [options.delayMs] — spinner-only window before progress
 * @param {number} [options.cap] — max value while waiting (default 95)
 */
export function useDelayedProgress({
  active,
  resetKey = "",
  delayMs = PROGRESS_DELAY_MS,
  cap = PROGRESS_CAP,
} = {}) {
  const [showProgress, setShowProgress] = useState(false)
  const [value, setValue] = useState(0)

  // The parent mounts this hook with `active: true` and unmounts on status
  // change (success/failure/workspace close), so unmount discards state —
  // no reset effect needed. `resetKey` restarts timers; pair with
  // `key={resetKey}` upstream for fresh state per upload. All setState calls
  // below run inside timer callbacks (never synchronously in the effect
  // body), and cleanup clears every timer.
  useEffect(() => {
    if (!active) {
      return undefined
    }
    let delayTimer = null
    let tickTimer = null
    let cancelled = false
    const startedAt = Date.now()

    const advance = () => {
      if (cancelled) return
      const elapsed = Date.now() - startedAt
      // Eased approach to `cap`: fast early, slow near the cap. Time constant
      // ~4.5s reaches ~90% of cap in ~10s — plausible for a 10 MiB CSV without
      // ever claiming backend percentages.
      const target = cap * (1 - Math.exp(-elapsed / 4500))
      // Small floor so the bar visibly moves right after promotion.
      const next = Math.min(cap, Math.max(2, target))
      setValue((prev) => (next > prev ? next : prev))
      tickTimer = setTimeout(advance, 120)
    }

    delayTimer = setTimeout(() => {
      if (cancelled) return
      setShowProgress(true)
      advance()
    }, delayMs)

    return () => {
      cancelled = true
      if (delayTimer !== null) clearTimeout(delayTimer)
      if (tickTimer !== null) clearTimeout(tickTimer)
    }
  }, [active, resetKey, delayMs, cap])

  const complete = () => {
    // Success path: jump to 100%. The caller unmounts immediately after
    // (dashboard replaces the loader), so no artificial delay is added —
    // this only ensures the value never sticks at 95 on completion.
    // Called from event handlers, never during render.
    setValue(100)
    return 100
  }

  const stageLabel = stageLabelForValue(value)

  return { showProgress, value, stageLabel, complete }
}

export default useDelayedProgress
