import { Loader2 } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { useDelayedProgress } from "@/hooks/useDelayedProgress"

/**
 * Phase K analysis loading state.
 *
 * Smart spinner → progressive progress-bar experience:
 * - Fast operations: existing spinner only (never flashes the progress bar).
 * - Long operations (still running after ~800ms): promotes to an estimated
 *   staged progress bar that caps at 95% while waiting for the real API
 *   response, then the parent swaps to the dashboard (100% = complete).
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
}) {
  const { showProgress, value, stageLabel } = useDelayedProgress({
    active: true,
    resetKey,
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

  const rounded = Math.min(95, Math.floor(value))

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
      <Progress value={value} aria-label="Analysis progress (estimated)" />
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-xs text-muted-foreground sm:text-sm">
          {stageLabel} — estimated, waiting for the server
        </p>
        <p className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
          {rounded}%
        </p>
      </div>
      <p className="sr-only">
        Analysis in progress. Progress is estimated and caps at 95 percent
        until the server responds.
      </p>
    </div>
  )
}

export default AnalysisProgressState
