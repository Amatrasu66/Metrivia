import { Bar } from "@/components/charts/bar"
import { BarChart } from "@/components/charts/bar-chart"
import { BarXAxis } from "@/components/charts/bar-x-axis"
import { Grid } from "@/components/charts/grid"
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip"

/** Renders prepared [{ label, value }] data. No transformation here. */
export function BarChartView({ data }) {
  return (
    <div className="min-w-0 overflow-x-clip">
      <BarChart data={data} xDataKey="label">
        <Grid horizontal />
        <Bar dataKey="value" />
        {/* Phase J: show every category label on desktop (1-20). Uses the
            installed Bklit API (`showAllLabels` + `maxLabels`); readability
            (column clipping, truncation with full title, intentional mobile
            decimation) lives in BarXAxis defaults. Tooltip untouched. */}
        <BarXAxis showAllLabels maxLabels={20} />
        <ChartTooltip />
      </BarChart>
    </div>
  )
}
