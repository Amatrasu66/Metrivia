import { BarChart3, FileSpreadsheet, Table } from "lucide-react"
import { formatCount, formatPercent } from "@/lib/format"
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

// Keep wide datasets usable on small screens: the table scrolls inside its
// card, so the page itself never overflows horizontally.
const MAX_PREVIEW_COLUMNS = 12
const MAX_PREVIEW_ROWS = 8

function formatCell(value) {
  if (value === null || value === undefined || value === "") return "—"
  return String(value)
}

export function DashboardPlaceholder({ dataset, onUpload }) {
  if (!dataset) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <EmptyState
          title="No dataset selected"
          description="Upload a CSV to see this layout filled with KPIs, column details, and a data table. Placeholders below show where each module will live."
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

  const columns = Array.isArray(dataset.columns) ? dataset.columns : []
  const dtypes = dataset.dtypes ?? {}
  const missing = dataset.missing ?? {}
  const unique = dataset.unique ?? {}
  const preview = Array.isArray(dataset.preview) ? dataset.preview : []

  const rowCount = Number(dataset.row_count) || 0
  const columnCount = Number(dataset.column_count) || columns.length
  const numericCount = columns.filter((col) => dtypes[col] === "numeric").length
  const totalCells = rowCount * columnCount
  const missingTotal = columns.reduce(
    (sum, col) => sum + (Number(missing[col]) || 0),
    0,
  )
  const completeness =
    totalCells > 0 ? ((totalCells - missingTotal) / totalCells) * 100 : null

  const kpis = [
    {
      label: "Rows",
      value: formatCount(rowCount),
      hint: "Data rows, excluding the header",
    },
    {
      label: "Columns",
      value: formatCount(columnCount),
      hint: "Detected from the header row",
    },
    {
      label: "Numeric fields",
      value: formatCount(numericCount),
      hint: "Columns inferred as numeric",
    },
    {
      label: "Completeness",
      value: formatPercent(completeness),
      hint: "Share of non-empty cells",
    },
  ]

  const shownColumns = columns.slice(0, MAX_PREVIEW_COLUMNS)
  const hiddenColumnCount = Math.max(0, columns.length - shownColumns.length)
  const shownRows = preview.slice(0, MAX_PREVIEW_ROWS)

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="min-w-0 truncate text-xs text-muted-foreground sm:text-sm">
        Showing analysis for{" "}
        <span className="font-medium text-foreground">{dataset.filename}</span>{" "}
        · live from the Flask backend.
      </p>

      {/* KPI cards with real values */}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="min-w-0">
            <CardHeader>
              <CardDescription>{kpi.label}</CardDescription>
              <CardTitle className="text-2xl">{kpi.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{kpi.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Detected column types */}
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

      {/* Chart + data preview */}
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Trend chart</CardTitle>
            <CardDescription>
              Visualization layer will render here. No chart library installed
              yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex min-w-0 flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-10 text-center">
              <BarChart3
                aria-hidden="true"
                className="size-8 text-muted-foreground"
              />
              <p className="text-sm font-medium">Chart placeholder</p>
              <p className="max-w-sm text-xs text-muted-foreground sm:text-sm">
                A line, bar, or area view of the uploaded dataset will appear
                here.
              </p>
              <Badge variant="secondary">Bklit arrives later</Badge>
            </div>
          </CardContent>
        </Card>

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
              Showing {shownRows.length} of {formatCount(dataset.preview_count ?? preview.length)} preview
              rows
              {hiddenColumnCount > 0
                ? ` · ${hiddenColumnCount} more column${hiddenColumnCount === 1 ? "" : "s"} not shown`
                : ""}
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
