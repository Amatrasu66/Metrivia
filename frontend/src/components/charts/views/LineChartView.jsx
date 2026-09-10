import { Grid } from "@/components/charts/grid"
import { Line } from "@/components/charts/line"
import { LineChart } from "@/components/charts/line-chart"
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip"
import { XAxis } from "@/components/charts/x-axis"

/** Renders prepared [{ label, value }] data on a time scale. */
export function LineChartView({ data }) {
  return (
    <div className="min-w-0">
      <LineChart data={data} xDataKey="label">
        <Grid horizontal />
        <Line dataKey="value" />
        <XAxis />
        <ChartTooltip />
      </LineChart>
    </div>
  )
}
