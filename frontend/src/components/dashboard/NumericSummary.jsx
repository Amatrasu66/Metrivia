import { memo, useMemo } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function formatStat(value, digits = 2) {
  if (!Number.isFinite(value)) return "—"
  return Number(value).toLocaleString("en-US", {
    maximumFractionDigits: digits,
  })
}

/**
 * Secondary analytics: min / mean / max per numeric column, computed from
 * the current (filtered) rows. Purely real data — no backend call.
 *
 * Memoized (Phase G): the parent re-renders on chart-config edits while
 * `rows` / `numericColumns` keep stable references, so the per-column list
 * diff below is skipped unless the filtered view actually changed.
 */
export const NumericSummary = memo(function NumericSummary({
  rows,
  numericColumns,
  scopeNote = null,
}) {
  const summaries = useMemo(() => {
    const list = Array.isArray(numericColumns) ? numericColumns : []
    const data = Array.isArray(rows) ? rows : []
    return list.map((column) => {
      const values = []
      for (const row of data) {
        if (row === null || typeof row !== "object") continue
        const num = toFiniteNumber(row[column])
        if (num !== null) values.push(num)
      }
      if (values.length === 0) {
        return { column, count: 0, min: null, mean: null, max: null }
      }
      const sum = values.reduce((total, v) => total + v, 0)
      return {
        column,
        count: values.length,
        min: Math.min(...values),
        mean: sum / values.length,
        max: Math.max(...values),
      }
    })
  }, [rows, numericColumns])

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Numeric summary</CardTitle>
        <CardDescription>
          {typeof scopeNote === "string" && scopeNote !== ""
            ? scopeNote
            : "Range and average for numeric columns in the current view."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {summaries.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
            No numeric columns in this dataset.
          </p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-2">
            {summaries.map((item) => (
              <li
                key={item.column}
                className="flex min-w-0 flex-col gap-1 rounded-lg border border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              >
                <p className="min-w-0 truncate text-sm font-medium">
                  {item.column}
                </p>
                {item.count === 0 ? (
                  <p className="shrink-0 text-xs text-muted-foreground">
                    No values in view
                  </p>
                ) : (
                  <dl className="flex shrink-0 items-center gap-4 text-xs">
                    <div className="flex items-baseline gap-1">
                      <dt className="text-muted-foreground">Min</dt>
                      <dd className="font-medium tabular-nums">
                        {formatStat(item.min)}
                      </dd>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <dt className="text-muted-foreground">Mean</dt>
                      <dd className="font-medium tabular-nums">
                        {formatStat(item.mean)}
                      </dd>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <dt className="text-muted-foreground">Max</dt>
                      <dd className="font-medium tabular-nums">
                        {formatStat(item.max)}
                      </dd>
                    </div>
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
})
