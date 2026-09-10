import {
  Columns3,
  FileSpreadsheet,
  Gauge,
  Hash,
  Rows3,
  Table,
} from "lucide-react"
import { useMemo } from "react"
import { formatCount, formatPercent } from "@/lib/format"
import {
  applyFilters,
  buildFilteredDataset,
  defaultFilterState,
  getFilterFields,
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
import { ChartBuilder } from "@/components/charts/ChartBuilder"
import { FilterPanel } from "@/components/dashboard/FilterPanel"
import { KpiCard } from "@/components/dashboard/KpiCard"
import { NumericSummary } from "@/components/dashboard/NumericSummary"

// Keep wide datasets usable on small screens: the table scrolls inside its
// card, so the page itself never overflows horizontally.
const MAX_PREVIEW_COLUMNS = 12
const MAX_PREVIEW_ROWS = 8

function formatCell(value) {
  if (value === null || value === undefined || value === "") return "—"
  return String(value)
}

export function DashboardPlaceholder({
  dataset,
  filters,
  onFiltersChange,
  onUpload,
}) {
  // Hooks stay above the early return. All helpers tolerate a null
  // dataset; the empty branch below renders before any of it is used.
  const columns = useMemo(
    () => (Array.isArray(dataset?.columns) ? dataset.columns : []),
    [dataset],
  )
  const preview = useMemo(
    () => (Array.isArray(dataset?.preview) ? dataset.preview : []),
    [dataset],
  )
  const fields = useMemo(() => getFilterFields(dataset), [dataset])
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

  if (!dataset) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <EmptyState
          title="No dataset selected"
          description="Upload a CSV to see filters, KPIs, charts, and a data table. Placeholders below show where each module will live."
          action={
            <Button onClick={onUpload}>
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

  // Global filters: the uploaded dataset stays immutable; everything below
  // derives from the filtered rows without another backend request.
  const filtersActive = isFilterActive(filters)
  const resetFilters = () => onFiltersChange(defaultFilterState(dataset))

  const rowCount = Number(dataset.row_count) || 0
  const columnCount = Number(dataset.column_count) || columns.length
  const numericCount = columns.filter((col) => dtypes[col] === "numeric").length

  // Completeness reflects the current (filtered) view; column metadata
  // below still describes the full uploaded dataset.
  const filteredCells = filteredRows.length * columns.length
  const filteredMissing = filteredRows.reduce((sum, row) => {
    if (row === null || typeof row !== "object") return sum
    return (
      sum +
      columns.filter((col) => {
        const value = row[col]
        return value === null || value === undefined || value === ""
      }).length
    )
  }, 0)
  const completeness =
    filteredCells > 0
      ? ((filteredCells - filteredMissing) / filteredCells) * 100
      : null

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

  const shownColumns = columns.slice(0, MAX_PREVIEW_COLUMNS)
  const hiddenColumnCount = Math.max(0, columns.length - shownColumns.length)
  const shownRows = filteredRows.slice(0, MAX_PREVIEW_ROWS)

  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
      {/* 1. Filters */}
      {fields.length > 0 ? (
        <FilterPanel
          fields={fields}
          filters={filters}
          onChange={onFiltersChange}
          onReset={resetFilters}
        />
      ) : null}

      {/* 2. KPI summary row */}
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

      {/* 3. Primary visualization */}
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
            emptyAction={
              filtersActive ? (
                <Button variant="outline" size="sm" onClick={resetFilters}>
                  Clear filters
                </Button>
              ) : null
            }
          />
        </CardContent>
      </Card>

      {/* 4. Supporting analytics */}
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

      {/* 5. Data preview */}
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Data preview</CardTitle>
          <CardDescription>
            First rows of {dataset.filename} (up to {MAX_PREVIEW_ROWS}{" "}
            shown).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="min-w-0 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-0 border-collapse text-left text-sm">
              <caption className="sr-only">
                Preview of the first rows of {dataset.filename}
              </caption>
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  {shownColumns.map((col) => (
                    <th
                      key={col}
                      scope="col"
                      className="max-w-40 truncate px-3 py-2 text-xs font-medium text-muted-foreground"
                    >
                      <span className="flex items-center gap-1.5">
                        <Table
                          aria-hidden="true"
                          className="size-3.5 shrink-0"
                        />
                        {col}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shownRows.map((row, rowIndex) => (
                  <tr
                    key={rowIndex}
                    className="border-b border-border last:border-0"
                  >
                    {shownColumns.map((col) => (
                      <td
                        key={col}
                        className="max-w-40 truncate px-3 py-2 tabular-nums"
                      >
                        {formatCell(row[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Showing {shownRows.length} of {formatCount(filteredRows.length)}
            {filtersActive ? " filtered" : ""} rows
            {hiddenColumnCount > 0
              ? ` · ${hiddenColumnCount} more column${hiddenColumnCount === 1 ? "" : "s"} not shown`
              : ""}
            .
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
