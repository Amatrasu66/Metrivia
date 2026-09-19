import { useMemo } from "react"
import { Bar } from "@/components/charts/bar"
import { BarChart } from "@/components/charts/bar-chart"
import { BarXAxis } from "@/components/charts/bar-x-axis"
import { Grid } from "@/components/charts/grid"
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip"
import { EmptyState } from "@/components/states/EmptyState"
import {
  aggregateSumByCategory,
  selectBarChartFields,
} from "@/lib/chart-data"

/**
 * Reusable bar chart fed by the real /api/upload analysis payload.
 *
 * - X axis: first suitable categorical column
 * - Y axis: first numeric column, aggregated with Sum
 * - Renders an empty state (never crashes) when no suitable field pair
 *   exists in the dataset.
 */
export function DatasetBarChart({ dataset }) {
  const { categoryKey, numericKey, data } = useMemo(() => {
    const fields = selectBarChartFields(dataset)
    if (!fields.categoryKey || !fields.numericKey) {
      return { ...fields, data: [] }
    }
    return {
      ...fields,
      data: aggregateSumByCategory(
        dataset.preview,
        fields.categoryKey,
        fields.numericKey,
      ),
    }
  }, [dataset])

  if (!categoryKey || !numericKey || data.length === 0) {
    return (
      <EmptyState
        title="Not enough to chart yet"
        description="This dataset needs at least one categorical column and one numeric column for the bar chart. Upload a CSV with both to see it here."
      />
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="min-w-0 overflow-x-clip">
        <BarChart data={data} xDataKey={categoryKey}>
          <Grid horizontal />
          <Bar dataKey={numericKey} />
          {/* Phase J: same all-labels policy as BarChartView — Bklit
              `showAllLabels` + `maxLabels={20}` on desktop, intentional
              decimation on very narrow charts (see bar-x-axis.jsx). */}
          <BarXAxis showAllLabels maxLabels={20} />
          <ChartTooltip />
        </BarChart>
      </div>
      <p className="text-xs text-muted-foreground">
        Sum of <span className="font-medium">{numericKey}</span> by{" "}
        <span className="font-medium">{categoryKey}</span> · top {data.length}{" "}
        {data.length === 1 ? "group" : "groups"} from the uploaded preview.
      </p>
    </div>
  )
}
