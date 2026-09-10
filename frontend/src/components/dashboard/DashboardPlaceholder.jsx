import { BarChart3, FileSpreadsheet, Table } from "lucide-react"
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

const KPI_SLOTS = [
  { label: "Rows", hint: "Count appears after parsing" },
  { label: "Columns", hint: "Detected from header row" },
  { label: "Numeric fields", hint: "Detected from values" },
  { label: "Completeness", hint: "Share of non-empty cells" },
]

export function DashboardPlaceholder({ hasFile, fileName, onUpload }) {
  if (!hasFile) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <EmptyState
          title="No dataset selected"
          description="Upload a CSV to see this layout filled with KPIs, charts, and a data table. Placeholders below show where each module will live."
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
          {KPI_SLOTS.map((slot) => (
            <div
              key={slot.label}
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

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="min-w-0 truncate text-xs text-muted-foreground sm:text-sm">
        Showing shell for{" "}
        <span className="font-medium text-foreground">{fileName}</span> ·
        Values stay empty until parsing lands.
      </p>

      {/* KPI placeholders */}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {KPI_SLOTS.map((slot) => (
          <Card key={slot.label} className="min-w-0">
            <CardHeader>
              <CardDescription>{slot.label}</CardDescription>
              <CardTitle className="text-2xl" aria-label={`${slot.label}: pending`}>
                —
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{slot.hint}</p>
              <Badge variant="outline" className="mt-2">
                Awaiting parsing
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart + table placeholders */}
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
              First rows of the CSV will appear here after parsing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="min-w-0 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-0 border-collapse text-left text-sm">
                <caption className="sr-only">
                  Placeholder data table. Parsing is not implemented yet.
                </caption>
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    {["Column A", "Column B", "Column C"].map((col) => (
                      <th
                        key={col}
                        scope="col"
                        className="px-3 py-2 text-xs font-medium text-muted-foreground"
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
                  {[0, 1, 2].map((row) => (
                    <tr
                      key={row}
                      className="border-b border-border last:border-0"
                    >
                      {[0, 1, 2].map((cell) => (
                        <td key={cell} className="px-3 py-2.5">
                          <span
                            aria-hidden="true"
                            className="block h-3 w-full max-w-24 rounded bg-muted"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Preview is disabled until CSV parsing is implemented.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
