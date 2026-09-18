import {
  Columns3,
  FileSpreadsheet,
  Gauge,
  Hash,
  Rows3,
} from "lucide-react"
import { memo, useCallback, useMemo } from "react"
import { formatCount, formatPercent } from "@/lib/format"
import {
  applyFilters,
  buildFilteredDataset,
  defaultFilterState,
  isFilterActive,
} from "@/lib/filter-data"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { EmptyState } from "@/components/states/EmptyState"
import { Button } from "@/components/ui/button"
import { useMetriviaHaptics } from "@/hooks/useMetriviaHaptics"
import { ChartBuilder } from "@/components/charts/ChartBuilder"
import { DataTable } from "@/components/dashboard/DataTable"
import { KpiCard } from "@/components/dashboard/KpiCard"
import { NumericSummary } from "@/components/dashboard/NumericSummary"

// The data viewer below renders every row and column inside a bounded
// scroll container (vertical + horizontal), so wide datasets stay usable on
// small screens and the page itself never overflows horizontally.
// Virtualization itself lives in DataTable (Phase G), which also owns the
// scroll state so scrolling the table never re-renders the KPIs, chart, or
// summary above it.

/**
 * Dataset dashboard (KPIs, chart, columns, full data viewer). Memoized so
 * unrelated Shell renders (e.g. chart-config edits flowing through the
 * workspace store, header state) never re-render the large table and chart
 * trees — props are referentially stable unless the workspace data changes.
 */
export const DashboardPlaceholder = memo(function DashboardPlaceholder({
  dataset,
  filters,
  onFiltersChange,
  onUpload,
  chartConfig,
  onChartConfigChange,
}) {
  // Hooks stay above the early return. All helpers tolerate a null
  // dataset; the empty branch below renders before any of it is used.
  const { tap } = useMetriviaHaptics()
  const columns = useMemo(
    () => (Array.isArray(dataset?.columns) ? dataset.columns : []),
    [dataset],
  )
  const preview = useMemo(
    () => (Array.isArray(dataset?.preview) ? dataset.preview : []),
    [dataset],
  )
  const filteredRows = useMemo(
    () => applyFilters(preview, filters),
    [preview, filters],
  )
  const filteredDataset = useMemo(
    () => buildFilteredDataset(dataset, filteredRows),
    [dataset, filteredRows],
  )
  const numericColumns = useMemo(
    () =>
      columns.filter(
        (col) => (dataset?.dtypes ?? {})[col] === "numeric",
      ),
    [columns, dataset],
  )
  // Filter helpers live above the early return (hooks discipline): they only
  // run meaningfully once a dataset exists, but their identity must be
  // stable across renders either way.
  const filtersActive = isFilterActive(filters)
  const resetFilters = useCallback(() => {
    tap()
    onFiltersChange(defaultFilterState(dataset))
  }, [dataset, onFiltersChange, tap])
  // Stable element identity so the memoized ChartBuilder does not see a new
  // `emptyAction` on every parent render.
  const emptyAction = useMemo(
    () =>
      filtersActive ? (
        <Button variant="outline" size="sm" onClick={resetFilters}>
          Clear filters
        </Button>
      ) : null,
    [filtersActive, resetFilters],
  )
  // Row windowing lives in DataTable (which owns the virtualizer hooks):
  // with no dataset the count is simply zero. Only rows near the viewport
  // become DOM nodes (~50 at a time regardless of dataset size), so a
  // 20 MiB upload cannot create hundreds of thousands of cells.
  // Top/bottom spacer rows preserve the full scroll height and keep every
  // column aligned with the sticky header — no absolute positioning, no
  // per-row measurement, no animation of the table itself. DataTable is
  // memoized on stable row/column references, so scrolling it never
  // re-renders this placeholder and chart-config-only changes skip it.
  const visibleRows = filteredRows
  const visibleColumns = columns
  // Completeness reflects the current (filtered) view; column metadata
  // below still describes the full uploaded dataset. Memoized (Phase G):
  // it is O(rows × columns) and must run only when the filtered rows or
  // the column list actually change — never on chart-config edits, table
  // scrolls, or other unrelated renders of this placeholder. Lives above
  // the early return (hooks discipline); without a dataset it is simply
  // null and unused.
  const completeness = useMemo(() => {
    const filteredCells = filteredRows.length * columns.length
    if (filteredCells === 0) return null
    let filteredMissing = 0
    for (const row of filteredRows) {
      if (row === null || typeof row !== "object") continue
      for (const col of columns) {
        const value = row[col]
        if (value === null || value === undefined || value === "") {
          filteredMissing += 1
        }
      }
    }
    return ((filteredCells - filteredMissing) / filteredCells) * 100
  }, [filteredRows, columns])

  if (!dataset) {
    const handleUpload = () => {
      tap()
      onUpload()
    }
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <EmptyState
          title="No dataset selected"
          description="Upload a CSV to see filters, KPIs, charts, and a data table. Placeholders below show where each module will live."
          action={
            <Button onClick={handleUpload}>
              <FileSpreadsheet aria-hidden="true" />
              Go to upload
            </Button>
          }
        />
        <div
          aria-hidden="true"
          className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          {["Rows", "Columns", "Numeric fields", "Completeness"].map((label) => (
            <div
              key={label}
              className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-5"
            >
              <div className="h-3 w-16 rounded bg-muted" />
              <div className="mt-3 h-6 w-12 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const dtypes = dataset.dtypes ?? {}
  const missing = dataset.missing ?? {}
  const unique = dataset.unique ?? {}

  const rowCount = Number(dataset.row_count) || 0
  const columnCount = Number(dataset.column_count) || columns.length
  const numericCount = columns.filter((col) => dtypes[col] === "numeric").length

  const kpis = [
    {
      icon: Rows3,
      label: "Rows",
      value: filtersActive
        ? `${formatCount(filteredRows.length)} of ${formatCount(rowCount)}`
        : formatCount(rowCount),
      hint: filtersActive
        ? "Filtered rows of the uploaded total"
        : "Data rows, excluding the header",
    },
    {
      icon: Columns3,
      label: "Columns",
      value: formatCount(columnCount),
      hint: "Detected from the header row",
    },
    {
      icon: Hash,
      label: "Numeric fields",
      value: formatCount(numericCount),
      hint: "Columns inferred as numeric",
    },
    {
      icon: Gauge,
      label: "Completeness",
      value: formatPercent(completeness),
      hint: "Share of non-empty cells in the current view",
    },
  ]

  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
      {/* 1. KPI summary row (filters live in the header drawer now) */}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiCard
            key={kpi.label}
            icon={kpi.icon}
            label={kpi.label}
            value={kpi.value}
            hint={kpi.hint}
          />
        ))}
      </div>

      {/* 2. Primary visualization */}
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Chart</CardTitle>
          <CardDescription>
            Configure the visualization — it updates instantly from the
            current view and respects active filters.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartBuilder
            dataset={filteredDataset}
            config={chartConfig}
            onConfigChange={onChartConfigChange}
            emptyAction={emptyAction}
          />
        </CardContent>
      </Card>

      {/* 3. Supporting analytics */}
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Columns</CardTitle>
            <CardDescription>
              Inferred types, missing values, and unique counts per column.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="min-w-0 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-0 border-collapse text-left text-sm">
                <caption className="sr-only">
                  Detected column details for {dataset.filename}
                </caption>
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted-foreground">
                      Name
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted-foreground">
                      Type
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted-foreground">
                      Missing
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted-foreground">
                      Unique
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map((col) => (
                    <tr
                      key={col}
                      className="border-b border-border last:border-0"
                    >
                      <td className="max-w-40 truncate px-3 py-2 font-medium">
                        {col}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary">{dtypes[col] ?? "—"}</Badge>
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatCount(Number(missing[col]) || 0)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatCount(Number(unique[col]) || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <NumericSummary rows={filteredRows} numericColumns={numericColumns} />
      </div>

      {/* 4. Data preview — every row and column of the current view */}
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Data preview</CardTitle>
          <CardDescription>
            {formatCount(visibleRows.length)} of {formatCount(rowCount)} rows
            {" · "}
            {formatCount(visibleColumns.length)} of {formatCount(columnCount)}{" "}
            columns{filtersActive ? " · filtered" : ""} — {dataset.filename}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={visibleRows}
            columns={visibleColumns}
            filename={dataset.filename}
            filtersActive={filtersActive}
          />
        </CardContent>
      </Card>
    </div>
  )
})
