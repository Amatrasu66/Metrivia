import { Card, CardContent } from "@/components/ui/card"

/**
 * Premium KPI card: icon + label row, large tabular value, quiet hint.
 * Values are always real dataset figures passed in by the parent.
 */
export function KpiCard({ icon: Icon, label, value, hint }) {
  return (
    <Card className="min-w-0">
      <CardContent className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm text-muted-foreground">
            {label}
          </span>
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <Icon className="size-4" />
          </span>
        </div>
        <p className="text-2xl font-semibold tracking-tight break-words tabular-nums">
          {value}
        </p>
        <p className="text-xs break-words text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}
