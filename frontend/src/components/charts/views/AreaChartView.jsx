import { Area } from "@/components/charts/area"
import { AreaChart } from "@/components/charts/area-chart"
import { Grid } from "@/components/charts/grid"
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip"
import { XAxis } from "@/components/charts/x-axis"

/** Renders prepared [{ label, value }] data on a time scale. */
export function AreaChartView({ data }) {
  return (
    <div className="min-w-0">
      <AreaChart data={data} xDataKey="label">
        <Grid horizontal />
        <Area dataKey="value" />
        <XAxis />
        <ChartTooltip />
      </AreaChart>
    </div>
  )
}
