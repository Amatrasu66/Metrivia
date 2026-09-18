import { Table } from "lucide-react"
import { memo, useCallback, useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { formatCount } from "@/lib/format"

function formatCell(value) {
  if (value === null || value === undefined || value === "") return "—"
  return String(value)
}

// Fixed row height for the virtualized data viewer. Cells are single-line
// (whitespace-nowrap, text-sm, py-2) so every row measures the same — the
// virtualizer needs no per-row measurement pass over potentially hundreds
// of thousands of rows.
const PREVIEW_ROW_HEIGHT = 33

/**
 * Virtualized data viewer: every row and column of the current view inside
 * a bounded scroll container (vertical + horizontal), so wide datasets stay
 * usable on small screens and the page itself never overflows horizontally.
 *
 * Extracted from DashboardPlaceholder (Phase G) so table scroll state stays
 * local: the virtualizer re-renders this subtree on scroll, but KPIs, the
 * chart, and the numeric summary above never re-execute. Likewise a
 * chart-config-only change re-renders the placeholder while this memoized
 * subtree is skipped (props are referentially stable by contract).
 *
 * Preserved exactly: virtualization, sticky header, horizontal scrolling,
 * keyboard access (focusable scroll region with an accessible label),
 * theme-aware tokens, and no animation of table rows.
 */
export const DataTable = memo(function DataTable({
  rows,
  columns,
  filename,
  filtersActive,
}) {
  const visibleRows = Array.isArray(rows) ? rows : []
  const visibleColumns = Array.isArray(columns) ? columns : []
  const scrollRef = useRef(null)
  const getScrollElement = useCallback(() => scrollRef.current, [])
  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement,
    estimateSize: () => PREVIEW_ROW_HEIGHT,
    overscan: 12,
  })
  const virtualRows = rowVirtualizer.getVirtualItems()
  const topSpacer = virtualRows.length > 0 ? virtualRows[0].start : 0
  const bottomSpacer =
    visibleRows.length * PREVIEW_ROW_HEIGHT -
    (virtualRows.length > 0
      ? virtualRows[virtualRows.length - 1].end
      : 0)

  return (
    <div className="min-w-0">
      <div
        ref={scrollRef}
        role="region"
        aria-label={`Scrollable data table for ${filename}`}
        tabIndex={0}
        className="max-h-[32rem] min-w-0 overflow-auto rounded-lg border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <table className="w-full min-w-max border-collapse text-left text-sm">
          <caption className="sr-only">
            All rows and columns of {filename}
            {filtersActive ? " matching the active filters" : ""}
          </caption>
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border bg-muted">
              {visibleColumns.map((col) => (
                <th
                  key={col}
                  scope="col"
                  className="bg-muted px-3 py-2 text-xs font-medium whitespace-nowrap text-muted-foreground"
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
            {topSpacer > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={visibleColumns.length}
                  style={{ height: topSpacer, padding: 0, border: 0 }}
                />
              </tr>
            )}
            {virtualRows.map((virtualRow) => {
              const row = visibleRows[virtualRow.index]
              return (
                <tr
                  key={virtualRow.key}
                  className="border-b border-border bg-card"
                >
                  {visibleColumns.map((col) => (
                    <td
                      key={col}
                      className="px-3 py-2 whitespace-nowrap tabular-nums"
                    >
                      {formatCell(row[col])}
                    </td>
                  ))}
                </tr>
              )
            })}
            {bottomSpacer > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={visibleColumns.length}
                  style={{ height: bottomSpacer, padding: 0, border: 0 }}
                />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Showing all {formatCount(visibleRows.length)}
        {filtersActive ? " filtered" : ""} rows and all{" "}
        {formatCount(visibleColumns.length)} columns. Scroll vertically for
        more rows, horizontally for more columns.
      </p>
    </div>
  )
})
