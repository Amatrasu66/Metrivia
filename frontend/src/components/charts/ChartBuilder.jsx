import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { EmptyState } from "@/components/states/EmptyState"
import {
  AGGREGATIONS,
  CHART_TYPES,
  coerceConfigForType,
  defaultChartConfig,
  describePrepared,
  getDimensionOptions,
  getMeasureOptions,
  transformChartData,
} from "@/lib/chart-data"
import { FieldSelect } from "@/components/charts/FieldSelect"
import { AreaChartView } from "@/components/charts/views/AreaChartView"
import { BarChartView } from "@/components/charts/views/BarChartView"
import { LineChartView } from "@/components/charts/views/LineChartView"
import { PieChartView } from "@/components/charts/views/PieChartView"
import { ScatterChartView } from "@/components/charts/views/ScatterChartView"

const VIEW_BY_TYPE = {
  bar: BarChartView,
  line: LineChartView,
  area: AreaChartView,
  pie: PieChartView,
  scatter: ScatterChartView,
}

/**
 * Interactive chart builder: configuration state lives here and every
 * change re-renders from the already-uploaded dataset — no re-upload, no
 * extra Flask requests. Defaults to a sensible bar chart (dimension +
 * numeric measure + Sum) when the dataset supports it.
 */
export function ChartBuilder({ dataset }) {
  const [config, setConfig] = useState(() => defaultChartConfig(dataset))

  // A new upload replaces the dataset object: restart from fresh defaults.
  useEffect(() => {
    setConfig(defaultChartConfig(dataset))
  }, [dataset])

  const dimensionOptions = useMemo(
    () => getDimensionOptions(dataset, config.chartType),
    [dataset, config.chartType],
  )
  const measureOptions = useMemo(() => getMeasureOptions(dataset), [dataset])
  const prepared = useMemo(
    () => transformChartData(dataset, config),
    [dataset, config],
  )

  const isScatter = config.chartType === "scatter"
  const isCount = config.aggregation === "count"
  const ChartView = VIEW_BY_TYPE[config.chartType] ?? BarChartView

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className="px-0 text-xs font-medium text-muted-foreground">
          Chart type
        </legend>
        <div className="flex min-w-0 flex-wrap gap-1.5" role="group" aria-label="Chart type">
          {CHART_TYPES.map((type) => (
            <button
              key={type.id}
              type="button"
              aria-pressed={config.chartType === type.id}
              onClick={() =>
                setConfig((prev) => coerceConfigForType(dataset, prev, type.id))
              }
              className={cn(
                "h-9 shrink-0 rounded-lg border px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                config.chartType === type.id
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {type.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FieldSelect
          id="chart-dimension"
          label={isScatter ? "X axis (datetime)" : "Dimension"}
          value={config.dimension}
          options={dimensionOptions}
          onChange={(value) =>
            setConfig((prev) => ({ ...prev, dimension: value }))
          }
          hint={
            dimensionOptions.length === 0
              ? `No suitable ${isScatter ? "datetime" : "grouping"} columns in this dataset.`
              : null
          }
        />
        <FieldSelect
          id="chart-measure"
          label={isScatter ? "Y axis (numeric)" : "Measure"}
          value={config.measure}
          options={measureOptions}
          disabled={isCount && !isScatter}
          onChange={(value) =>
            setConfig((prev) => ({ ...prev, measure: value }))
          }
          hint={
            isCount && !isScatter
              ? "Count uses record counts — no measure needed."
              : null
          }
        />
        {isScatter ? (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs break-words text-muted-foreground sm:col-span-2 lg:col-span-1">
            Scatter plots show individual row observations — no aggregation is
            applied.
          </p>
        ) : (
          <FieldSelect
            id="chart-aggregation"
            label="Aggregation"
            value={config.aggregation}
            options={AGGREGATIONS.map((a) => ({ value: a.id, label: a.label }))}
            onChange={(value) =>
              setConfig((prev) => ({ ...prev, aggregation: value ?? "sum" }))
            }
          />
        )}
      </div>

      <div aria-live="polite" className="min-w-0">
        {prepared.status === "ok" ? (
          <div className="flex min-w-0 flex-col gap-2">
            <ChartView data={prepared.data} />
            <p className="text-xs break-words text-muted-foreground">
              {describePrepared(prepared)}
            </p>
          </div>
        ) : (
          <EmptyState title={prepared.title} description={prepared.message} />
        )}
      </div>
    </div>
  )
}
