import { FileSpreadsheet, Upload } from "lucide-react"
import { formatCount } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { DashboardPlaceholder } from "@/components/dashboard/DashboardPlaceholder"

export function DashboardLayout({
  dataset,
  filters,
  onFiltersChange,
  onBackToUpload,
  onRemoveFile,
}) {
  const hasDataset = Boolean(dataset)

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Dashboard
          </p>
          <h1 className="mt-1 min-w-0 truncate text-2xl font-semibold tracking-tight sm:text-3xl">
            {hasDataset ? dataset.filename : "Dataset overview"}
          </h1>
          <p className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm break-words text-muted-foreground">
            {hasDataset ? (
              <>
                <span className="inline-flex items-center gap-1.5">
                  <FileSpreadsheet
                    aria-hidden="true"
                    className="size-4 shrink-0"
                  />
                  {formatCount(dataset.row_count)} rows ×{" "}
                  {formatCount(dataset.column_count)} columns
                </span>
                <span aria-hidden="true" className="text-border">
                  •
                </span>
                <span>Analyzed by the Flask backend</span>
              </>
            ) : (
              "No dataset yet. This is the empty state the dashboard shows before upload."
            )}
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

      <div aria-label="Dataset dashboard" role="region" className="min-w-0">
        <DashboardPlaceholder
          dataset={dataset}
          filters={filters}
          onFiltersChange={onFiltersChange}
          onUpload={onBackToUpload}
        />
      </div>
    </div>
  )
}
