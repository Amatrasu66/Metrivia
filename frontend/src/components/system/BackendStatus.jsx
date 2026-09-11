import { LoaderCircle, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { BACKEND_STATUS, useBackendStatus } from "@/hooks/useBackendStatus"

const STATUS_META = {
  [BACKEND_STATUS.CHECKING]: {
    dotClassName: "bg-muted-foreground/60",
    label: "Checking backend…",
    title: "Checking whether the analysis server is reachable.",
    spin: true,
  },
  [BACKEND_STATUS.ONLINE]: {
    dotClassName: "bg-emerald-500",
    label: "Backend online",
    title: "The analysis server is reachable.",
    spin: false,
  },
  [BACKEND_STATUS.WAKING]: {
    dotClassName: "bg-amber-500",
    label: "Backend is waking up…",
    title:
      "Render is starting the analysis server. This may take up to a minute.",
    spin: true,
  },
  [BACKEND_STATUS.OFFLINE]: {
    dotClassName: "bg-destructive",
    label: "Backend unavailable",
    title: "We couldn't reach the analysis server. Please try again.",
    spin: false,
  },
}

/**
 * Presentational backend availability pill for the application header (one
 * instance covers desktop and mobile via responsive label). Theme-aware via
 * design tokens. Rendered twice in the header (desktop nav + mobile bar),
 * so it takes `status`/`onRetry` as props — the header owns the single
 * `useBackendStatus` subscription and shares it, keeping exactly one
 * in-flight health request at a time.
 */
export function BackendStatusIndicator({ status, onRetry, className }) {
  const meta = STATUS_META[status] ?? STATUS_META[BACKEND_STATUS.CHECKING]
  const isOffline = status === BACKEND_STATUS.OFFLINE

  return (
    <span
      role="status"
      title={meta.title}
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-muted/40 py-1 pr-2 pl-2.5",
        className,
      )}
    >
      {meta.spin ? (
        <LoaderCircle
          aria-hidden="true"
          className="size-3 shrink-0 animate-spin text-muted-foreground"
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn("size-2 shrink-0 rounded-full", meta.dotClassName)}
        />
      )}
      <span className="hidden truncate text-xs text-muted-foreground min-[420px]:inline">
        {meta.label}
      </span>
      <span className="sr-only">{meta.label}</span>
      {isOffline ? (
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={onRetry}
          aria-label="Retry backend health check"
          title="Retry backend health check"
          className="h-5 shrink-0 px-1.5 text-xs"
        >
          <RotateCcw aria-hidden="true" />
          <span className="hidden min-[420px]:inline">Retry</span>
        </Button>
      ) : null}
    </span>
  )
}

/**
 * Self-subscribed variant for one-off placements. Prefer
 * `BackendStatusIndicator` with a shared subscription when rendering the
 * pill more than once on the same screen.
 */
export function BackendStatus({ className }) {
  const { status, retry } = useBackendStatus()
  return (
    <BackendStatusIndicator status={status} onRetry={retry} className={className} />
  )
}
