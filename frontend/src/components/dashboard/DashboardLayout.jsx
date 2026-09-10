import { FileSpreadsheet, Upload } from "lucide-react"
import { formatCount } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { DashboardPlaceholder } from "@/components/dashboard/DashboardPlaceholder"

const PIPELINE = [
  { label: "Upload", detail: "CSV sent to the backend", state: "done" },
  { label: "Parse", detail: "Columns, types, and stats", state: "pending" },
  { label: "Visualize", detail: "Charts and tables", state: "soon" },
]

export function DashboardLayout({ dataset, onBackToUpload, onRemoveFile }) {
  const hasDataset = Boolean(dataset)

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-5 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Dashboard
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Dataset overview
          </h1>
          <p className="mt-1 max-w-2xl text-sm break-words text-muted-foreground">
            {hasDataset
              ? `Analyzed by the Flask backend · ${formatCount(dataset.row_count)} rows × ${formatCount(dataset.column_count)} columns.`
              : "No dataset yet. This is the empty state the dashboard shows before upload."}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {hasDataset ? (
            <Button variant="outline" size="sm" onClick={onRemoveFile}>
              Remove file
            </Button>
          ) : null}
          <Button size="sm" onClick={onBackToUpload}>
            <Upload aria-hidden="true" />
            {hasDataset ? "Upload new" : "Go to upload"}
          </Button>
        </div>
      </div>

      {/* Future view tabs — visual only, no routing complexity */}
      <div
        role="tablist"
        aria-label="Dashboard views (preview)"
        className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-lg border border-border bg-muted/40 p-1"
      >
        <span
          role="tab"
          aria-selected="true"
          className="shrink-0 rounded-md bg-background px-3 py-1.5 text-sm font-medium shadow-none ring-1 ring-border"
        >
          Overview
        </span>
        {["Table", "Charts"].map((tab) => (
          <span
            key={tab}
            role="tab"
            aria-selected="false"
            aria-disabled="true"
            className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground"
          >
            {tab}
            <Badge variant="outline">Soon</Badge>
          </span>
        ))}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Sidebar */}
        <aside
          aria-label="Dataset details"
          className="flex min-w-0 flex-col gap-4"
        >
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Current file</CardTitle>
              <CardDescription>
                Analyzed by the backend. Files are never stored.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {dataset ? (
                <div className="flex min-w-0 items-start gap-3 rounded-lg border border-border px-3 py-2.5">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary"
                  >
                    <FileSpreadsheet className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="min-w-0 truncate text-sm font-medium">
                      {dataset.filename}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatCount(dataset.row_count)} rows ·{" "}
                      {formatCount(dataset.column_count)} columns · CSV
                    </p>
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
                  No file selected yet.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Pipeline</CardTitle>
              <CardDescription>Upload and parsing are live.</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="flex min-w-0 flex-col gap-2">
                {PIPELINE.map((step) => {
                  const state =
                    step.state === "pending"
                      ? hasDataset
                        ? "done"
                        : "soon"
                      : step.state
                  return (
                    <li
                      key={step.label}
                      className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {step.label}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {step.detail}
                        </p>
                      </div>
                      <Badge
                        variant={state === "done" ? "default" : "secondary"}
                      >
                        {state === "done" ? "Done" : "Soon"}
                      </Badge>
                    </li>
                  )
                })}
              </ol>
            </CardContent>
          </Card>
        </aside>

        {/* Main panels */}
        <section aria-label="Dashboard panels" className="min-w-0">
          <DashboardPlaceholder dataset={dataset} onUpload={onBackToUpload} />
        </section>
      </div>
    </div>
  )
}
