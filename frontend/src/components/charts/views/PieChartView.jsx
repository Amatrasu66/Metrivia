import { PieChart } from "@/components/charts/pie-chart"
import { PieSlice } from "@/components/charts/pie-slice"
import { formatCount } from "@/lib/format"

// Slice colors cycle var(--chart-1)…var(--chart-5) in the Bklit pie
// component, so the legend below reuses the same tokens to stay in sync.
function sliceColor(index) {
  return `var(--chart-${(index % 5) + 1})`
}

/** Renders prepared [{ label, value }] data with a synced HTML legend. */
export function PieChartView({ data }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="mx-auto w-full min-w-0 max-w-sm">
        <PieChart data={data}>
          {data.map((_, index) => (
            <PieSlice key={index} index={index} />
          ))}
        </PieChart>
      </div>
      <ul className="grid min-w-0 grid-cols-1 gap-1 sm:grid-cols-2">
        {data.map((d, index) => (
          <li
            key={`${d.label}-${index}`}
            className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
          >
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: sliceColor(index) }}
            />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              {d.label}
            </span>
            <span className="shrink-0 tabular-nums">{formatCount(d.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
