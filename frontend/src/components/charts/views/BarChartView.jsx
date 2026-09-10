import { Bar } from "@/components/charts/bar"
import { BarChart } from "@/components/charts/bar-chart"
import { BarXAxis } from "@/components/charts/bar-x-axis"
import { Grid } from "@/components/charts/grid"
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip"

/** Renders prepared [{ label, value }] data. No transformation here. */
export function BarChartView({ data }) {
  return (
    <div className="min-w-0">
      <BarChart data={data} xDataKey="label">
        <Grid horizontal />
        <Bar dataKey="value" />
        <BarXAxis />
        <ChartTooltip />
      </BarChart>
    </div>
  )
}
