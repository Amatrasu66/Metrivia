import { Grid } from "@/components/charts/grid"
import { Scatter } from "@/components/charts/scatter"
import { ScatterChart } from "@/components/charts/scatter-chart"
import { ChartTooltip } from "@/components/charts/tooltip/chart-tooltip"
import { XAxis } from "@/components/charts/x-axis"

/** Renders prepared raw [{ x, y }] observations. No grouping here. */
export function ScatterChartView({ data }) {
  return (
    <div className="min-w-0 overflow-x-clip">
      <ScatterChart data={data} xDataKey="x">
        <Grid horizontal />
        {/* Phase K density: 1,200-point views stay readable with smaller
            markers (radius 3 / stroke 1 / gap 1). Data fidelity unchanged —
            all observations still render; only the glyph size is reduced. */}
        <Scatter dataKey="y" radius={3} strokeWidth={1} ringGap={1} />
        <XAxis />
        <ChartTooltip />
      </ScatterChart>
    </div>
  )
}
