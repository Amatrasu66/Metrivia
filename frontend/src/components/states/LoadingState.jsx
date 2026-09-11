import { Loader2 } from "lucide-react"

export function LoadingState({ label = "Loading…", description }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-w-0 items-center justify-center gap-3 rounded-xl border border-border bg-muted/40 px-6 py-10 text-center"
    >
      <Loader2 aria-hidden="true" className="size-5 shrink-0 animate-spin" />
      <div className="min-w-0">
        <p className="min-w-0 truncate text-sm font-medium">{label}</p>
        {description ? (
          <p className="mt-1 min-w-0 text-xs break-words text-muted-foreground sm:text-sm">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  )
}
