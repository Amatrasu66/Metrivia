import { FileSpreadsheet, ListFilter, Upload } from "lucide-react"
import { memo, useCallback, useMemo, useState } from "react"
import { formatCount } from "@/lib/format"
import {
  activeFilterCount,
  defaultFilterState,
  getFilterFields,
} from "@/lib/filter-data"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useMetriviaHaptics } from "@/hooks/useMetriviaHaptics"
import { DashboardPlaceholder } from "@/components/dashboard/DashboardPlaceholder"
import { FilterSheet } from "@/components/dashboard/FilterSheet"

/**
 * Dashboard shell: header actions, filter drawer, and the dataset modules.
 * Memoized (Phase E) with referentially stable props by contract, so chart
 * interactions (which update the workspace store and re-render Shell) do
 * not replay the table/chart trees unless their data actually changed.
 */
export const DashboardLayout = memo(function DashboardLayout({
  dataset,
  filters,
  onFiltersChange,
  chartConfig,
  onChartConfigChange,
  onBackToUpload,
  onRemoveFile,
}) {
  const hasDataset = Boolean(dataset)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const { tap } = useMetriviaHaptics()

  // Same filter state the dashboard already uses — the drawer only presents
  // it differently. No duplicated state, no second filtering system.
  const fields = useMemo(() => getFilterFields(dataset), [dataset])
  const showFilters = hasDataset && fields.length > 0
  const filterCount = showFilters ? activeFilterCount(filters) : 0
  const resetFilters = useCallback(
    () => onFiltersChange(defaultFilterState(dataset)),
    [dataset, onFiltersChange],
  )

  // Opening the drawer is the meaningful gesture: this single tap covers
  // both the Filters button feedback and the drawer-open feedback, so the
  // same interaction never fires twice.
  const handleOpenFilters = () => {
    tap()
    setFiltersOpen(true)
  }

  const handleBackToUpload = () => {
    tap()
    onBackToUpload()
  }

  // "Remove file" previously bypassed the semantic haptic layer entirely
  // (raw onRemoveFile prop): silent on Android. iOS already ticked via the
  // shared Button's native switch; this tap() makes Android match without
  // changing the removal behavior.
  const handleRemoveFile = () => {
    tap()
    onRemoveFile()
  }

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
        <div className="flex min-w-0 shrink-0 flex-col gap-1.5 sm:items-end">
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {showFilters ? (
              <Button
                variant="outline"
                size="sm"
                aria-haspopup="dialog"
                onClick={handleOpenFilters}
              >
                <ListFilter aria-hidden="true" />
                Filters
                {filterCount > 0 ? (
                  <Badge variant="default">{filterCount}</Badge>
                ) : null}
              </Button>
            ) : null}
            {hasDataset ? (
              <Button variant="outline" size="sm" onClick={handleRemoveFile}>
                Remove file
              </Button>
            ) : null}
            <Button size="sm" onClick={handleBackToUpload}>
              <Upload aria-hidden="true" />
              {hasDataset ? "Upload new" : "Go to upload"}
            </Button>
          </div>
          {showFilters && filterCount > 0 ? (
            <p className="text-xs text-muted-foreground" role="status">
              {filterCount} filter{filterCount === 1 ? "" : "s"} active
            </p>
          ) : null}
        </div>
      </div>

      {showFilters ? (
        <FilterSheet
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          fields={fields}
          filters={filters}
          onChange={onFiltersChange}
          onReset={resetFilters}
        />
      ) : null}

      <div aria-label="Dataset dashboard" role="region" className="min-w-0">
        <DashboardPlaceholder
          dataset={dataset}
          filters={filters}
          onFiltersChange={onFiltersChange}
          chartConfig={chartConfig}
          onChartConfigChange={onChartConfigChange}
          onUpload={onBackToUpload}
        />
      </div>
    </div>
  )
})
