import { Loader2 } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { useDelayedProgress } from "@/hooks/useDelayedProgress"

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
 *
 * Workspace-safe: `resetKey` must change per workspace upload (file identity
 * + wake timestamp) so timers never leak across workspaces. All timers live
 * in `useDelayedProgress` and are cancelled on unmount / status change.
 * Error UI is owned by the parent — on failure this component simply
 * unmounts (no progress left behind).
 */
export function AnalysisProgressState({
  label = "Analyzing your data…",
  resetKey = "",
  delayMs,
  backendValue = null,
  backendStage = null,
}) {
  const { showProgress, value, stageLabel } = useDelayedProgress({
    active: true,
    resetKey,
    backendValue,
    backendStage,
    ...(delayMs != null ? { delayMs } : {}),
  })

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
