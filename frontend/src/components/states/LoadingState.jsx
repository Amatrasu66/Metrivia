import { Loader2 } from "lucide-react"

export function LoadingState({ label = "Loading…" }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-w-0 items-center justify-center gap-3 rounded-xl border border-border bg-muted/40 px-6 py-10 text-center"
    >
      <Loader2 aria-hidden="true" className="size-5 shrink-0 animate-spin" />
      <p className="min-w-0 truncate text-sm font-medium">{label}</p>
    </div>
  )
}
