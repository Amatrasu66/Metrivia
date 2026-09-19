import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { LONG_RUNNING_MS, useDelayedProgress } from "@/hooks/useDelayedProgress"
import { AnalysisTetrisState } from "@/components/upload/AnalysisTetrisState"

/**
 * Phase L analysis loading state.
 *
 * Smart spinner → backend-aware progress-bar experience (same card, same
 * horizontal bar, same typography as Phase K — only the progress *source*
 * changed):
 * - Fast operations: existing spinner only (never flashes the progress bar).
 * - Long operations (still running after ~800ms): promotes to a progress
 *   bar driven by real backend milestones streamed over the same upload
 *   request (file accepted → CSV parsed → analyzing columns → converting
 *   records → assembling rows → response ready). The bar moves linearly
 *   toward the latest milestone, never backward, and reaches exactly 100%
 *   only once the parsed result is usable — no estimated easing, no
 *   permanent 95% stall.
 * - Very long operations (same request still pending after LONG_RUNNING_MS):
 *   the card hands off to AnalysisTetrisState — presentation only, the
 *   request continues untouched and completion/error unmount this component
 *   exactly as before. No percentage is shown alongside Tetris.
 *
 * Workspace-safe: `resetKey` must change per workspace upload (file identity
 * + wake timestamp) so timers never leak across workspaces. All timers live
 * in `useDelayedProgress` plus the single handoff timeout below, and are
 * cancelled on unmount / status change / `analysisStartedAt` change.
 * Error UI is owned by the parent — on failure this component simply
 * unmounts (no progress left behind).
 */
export function AnalysisProgressState({
  label = "Analyzing your data…",
  resetKey = "",
  delayMs,
  backendValue = null,
  backendStage = null,
  analysisStartedAt = null,
}) {
  const { showProgress, value, stageLabel } = useDelayedProgress({
    active: true,
    resetKey,
    backendValue,
    backendStage,
    ...(delayMs != null ? { delayMs } : {}),
  })

  // Long-running handoff: a single timeout for the remainder of the 30s
  // window measured from the actual request start (clamped at 0 so an
  // already-expired window flips on the next tick). New uploads remount via
  // `key={resetKey}` for inherently fresh state; timestamp changes and
  // unmounts (completion, error, workspace close/switch) restart or clear
  // it. No render loop, no polling.
  const [showTetris, setShowTetris] = useState(
    () =>
      typeof analysisStartedAt === "number" &&
      Date.now() - analysisStartedAt >= LONG_RUNNING_MS,
  )
  useEffect(() => {
    if (typeof analysisStartedAt !== "number") return undefined
    const remaining = Math.max(
      0,
      LONG_RUNNING_MS - (Date.now() - analysisStartedAt),
    )
    let cancelled = false
    const timer = setTimeout(() => {
      if (!cancelled) setShowTetris(true)
    }, remaining)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [analysisStartedAt, resetKey])

  // A usable result arrived (parent sets exactly 100 on parsed data): never
  // flash Tetris on the way out — the dashboard takes over from here.
  if (showTetris && backendValue !== 100) {
    return <AnalysisTetrisState analysisStartedAt={analysisStartedAt} />
  }

  if (!showProgress) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-w-0 items-center justify-center gap-3 rounded-xl border border-border bg-muted/40 px-6 py-10 text-center"
      >
        <Loader2 aria-hidden="true" className="size-5 shrink-0 animate-spin" />
        <div className="min-w-0">
          <p className="min-w-0 truncate text-sm font-medium">{label}</p>
        </div>
      </div>
    )
  }

  const rounded = Math.min(100, Math.floor(value))

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${label} ${stageLabel}, ${rounded} percent`}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-muted/40 px-6 py-6 text-center"
    >
      <div className="flex min-w-0 items-center justify-center gap-3">
        <Loader2 aria-hidden="true" className="size-5 shrink-0 animate-spin" />
        <p className="min-w-0 truncate text-sm font-medium">{label}</p>
      </div>
      <Progress value={value} aria-label="Analysis progress" />
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-xs text-muted-foreground sm:text-sm">
          {stageLabel}
        </p>
        <p className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
          {rounded}%
        </p>
      </div>
      <p className="sr-only">
        Analysis in progress. Progress follows the server&apos;s reported
        milestones and reaches 100 percent when the result is ready.
      </p>
    </div>
  )
}

export default AnalysisProgressState
