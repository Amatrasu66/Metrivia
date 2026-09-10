import { Database } from "lucide-react"

export function EmptyState({ title, description, action }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center">
      <span
        aria-hidden="true"
        className="flex size-11 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
      >
        <Database className="size-5" />
      </span>
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      {description ? (
        <p className="w-full max-w-md min-w-0 text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  )
}
