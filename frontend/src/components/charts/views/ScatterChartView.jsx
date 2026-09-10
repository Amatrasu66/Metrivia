import { Grid } from "@/components/charts/grid"
import { Scatter } from "@/components/charts/scatter"
import { ScatterChart } from "@/components/charts/scatter-chart"
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip"
import { XAxis } from "@/components/charts/x-axis"

/** Renders prepared raw [{ x, y }] observations. No grouping here. */
export function ScatterChartView({ data }) {
  return (
    <div className="min-w-0">
      <ScatterChart data={data} xDataKey="x">
        <Grid horizontal />
        <Scatter dataKey="y" />
        <XAxis />
        <ChartTooltip />
      </ScatterChart>
    </div>
  )
}
