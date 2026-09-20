import { Table } from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { formatCount } from "@/lib/format"
import { getDatasetRows } from "@/lib/api"
import {
  buildServerFilterKey,
  isServerFilterActive,
  toServerFilters,
} from "@/lib/filter-data"
import {
  SERVER_PAGE_CACHE_LIMIT,
  SERVER_PAGE_SIZE_DEFAULT,
  canServePageFromPreview,
  clampPage,
  getDatasetId,
  getDatasetPreview,
  getDatasetRowCount,
  getFilteredRowCount,
  getTotalPages,
  isExpiredDatasetError,
  isServerBackedDataset,
  normalizePageSize,
  pageCacheKey,
  slicePreviewPage,
} from "@/lib/dataset-source"

function formatCell(value) {
  if (value === null || value === undefined || value === "") return "—"
  return String(value)
}

// Fixed row height for the virtualized data viewer. Cells are single-line
// (whitespace-nowrap, text-sm, py-2) so every row measures the same — the
// virtualizer needs no per-row measurement pass. In server mode the
// virtualizer still runs, but only over the currently loaded page
// (~200 rows), never over the full dataset.
const PREVIEW_ROW_HEIGHT = 33

// M2: no server-side sorting. There is no client sort UI either, so there
// is nothing to disable — this comment records the intentional omission:
// page-local sorting would falsely imply a global order. Global sorting
// belongs to a later phase.
const EXPIRED_MESSAGE = "This dataset session has expired. Please upload the CSV again."

/**
 * Virtualized data viewer with two data sources (Phase M2) + Phase M3
 * server-side filtering:
 *
 * - local/full-preview: small datasets keep the complete preview; every
 *   row renders inside the bounded scroll container exactly as before
 *   (client-side `rows` prop already filtered by the parent).
 * - server/paginated: large datasets page through the backend (one bounded
 *   ~200-row page at a time) with TanStack virtualization applied only to
 *   the loaded page. Without filters this is GET
 *   /api/datasets/<id>/rows; with filters it is POST
 *   /api/datasets/<id>/filter over the FULL dataset, and pagination uses
 *   the authoritative `filtered_row_count`.
 *
 * Filter lifecycle (server mode): the UI filter state normalizes to a
 * structured list, serializes deterministically to a filter key, cancels
 * the in-flight page, clears incompatible cache entries, resets to page 0,
 * and fetches filtered page 0. Request identity + AbortController keep
 * only the latest filter/page response.
 *
 * Server request lifecycle: table-local loading (never the Tetris loader),
 * local error + Retry, silent AbortError on cancellation, and request
 * identity so a stale page can never overwrite a newer one. Page state is
 * scoped to the dataset id + filter key: switching/closing/replacing a
 * workspace or changing filters aborts in-flight requests and clears the
 * (small, per-instance, max-4-page) cache.
 *
 * Preserved exactly: virtualization, sticky header, horizontal scrolling,
 * keyboard access, theme-aware tokens, and no animation of table rows.
 */
export const DataTable = memo(function DataTable({
  rows,
  columns,
  filename,
  filtersActive,
  filters,
  dataset,
  onFilteredCountChange,
}) {
  const serverBacked = isServerBackedDataset(dataset)
  const datasetId = getDatasetId(dataset)
  const serverRowCount = serverBacked ? getDatasetRowCount(dataset) : 0
  const pageSize = SERVER_PAGE_SIZE_DEFAULT

  // Phase M3: structured server filters derived from the same UI state the
  // local path filters client-side. Small datasets ignore this (parent
  // already filtered `rows`); large datasets send it to the backend.
  const serverFilters = useMemo(
    () => (serverBacked ? toServerFilters(filters) : []),
    [serverBacked, filters],
  )
  const filterKey = useMemo(
    () => (serverBacked ? buildServerFilterKey(serverFilters) : ""),
    [serverBacked, serverFilters],
  )
  const serverFiltering = isServerFilterActive(serverFilters)

  // Authoritative filtered count (server mode only). Starts at the total
  // so the first paint has stable pagination; filtered responses replace
  // it. Unfiltered pages keep it at the total.
  const [filteredCount, setFilteredCount] = useState(() => serverRowCount)
  const effectiveRowCount = serverBacked
    ? serverFiltering
      ? (filteredCount ?? serverRowCount)
      : serverRowCount
    : 0
  const totalPages = serverBacked ? getTotalPages(effectiveRowCount, pageSize) : 0

  // --- Local mode source (unchanged behavior) ---
  const visibleRows = Array.isArray(rows) ? rows : []
  const visibleColumns = Array.isArray(columns) ? columns : []

  // --- Server mode state (unused in local mode, hooks stay unconditional) ---
  const [page, setPage] = useState(0)
  const [pageRows, setPageRows] = useState(() =>
    serverBacked && dataset && canServePageFromPreview(dataset, 0, pageSize)
      ? slicePreviewPage(getDatasetPreview(dataset), pageSize)
      : [],
  )
  const [pageStatus, setPageStatus] = useState(() =>
    serverBacked && dataset && canServePageFromPreview(dataset, 0, pageSize)
      ? "ready"
      : "loading",
  )
  const [pageError, setPageError] = useState(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const requestIdRef = useRef(0)
  const abortRef = useRef(null)
  const cacheRef = useRef(new Map())
  const datasetIdRef = useRef(datasetId)
  const filterKeyRef = useRef(filterKey)
  const scrollRef = useRef(null)
  const getScrollElement = useCallback(() => scrollRef.current, [])

  // Keep the authoritative total in sync when the dataset itself changes
  // (new upload replaces the workspace dataset object).
  useEffect(() => {
    if (!serverBacked) return
    setFilteredCount((prev) => {
      // When unfiltered, the count is trivially the total. When filtered,
      // keep the last authoritative value until the filtered fetch below
      // replaces it (avoids flashing 0 pages mid-filter).
      if (!serverFiltering) return serverRowCount
      return prev ?? serverRowCount
    })
  }, [serverBacked, serverRowCount, serverFiltering])

  // Lift the authoritative counts for KPI use (parent shows "X of Y").
  // Fires only when the values actually change; a missing callback is fine.
  const lastLiftedRef = useRef(null)
  useEffect(() => {
    if (!serverBacked) return
    if (typeof onFilteredCountChange !== "function") return
    const key = `${effectiveRowCount}:${serverRowCount}:${serverFiltering ? 1 : 0}`
    if (lastLiftedRef.current === key) return
    lastLiftedRef.current = key
    onFilteredCountChange(effectiveRowCount, serverRowCount)
  }, [serverBacked, effectiveRowCount, serverRowCount, serverFiltering, onFilteredCountChange])

  // Workspace/dataset lifecycle: a new dataset id resets page state,
  // abandons in-flight requests, and clears the page cache. Deterministic
  // initial page: the retained bounded preview IS page 0 (backend preview
  // is df.head(sample)), so serve it directly with no fetch and no flash —
  // but only when no server filters are active; filtered page 0 always
  // fetches. Otherwise the fetch effect below loads page 0.
  useEffect(() => {
    if (!serverBacked) return
    if (datasetIdRef.current === datasetId && filterKeyRef.current === filterKey) return
    const datasetChanged = datasetIdRef.current !== datasetId
    datasetIdRef.current = datasetId
    filterKeyRef.current = filterKey
    abortRef.current?.abort()
    requestIdRef.current += 1
    cacheRef.current = new Map()
    const totalForClamp = serverFiltering
      ? (filteredCount ?? getDatasetRowCount(dataset))
      : getDatasetRowCount(dataset)
    const clamped = clampPage(0, getTotalPages(totalForClamp, pageSize))
    setPage(clamped)
    // A filter change must never leave the user on page 17 of a 2-page
    // result: always restart at page 0 (clamped above).
    if (!serverFiltering && dataset && canServePageFromPreview(dataset, clamped, pageSize)) {
      const slice = slicePreviewPage(getDatasetPreview(dataset), pageSize)
      cacheRef.current.set(pageCacheKey(datasetId, clamped, pageSize, ""), slice)
      setPageRows(slice)
      setPageStatus("ready")
      setPageError(null)
      if (!datasetChanged) {
        // Unfiltered dataset switch already synced above; keep counts.
      }
    } else {
      setPageRows([])
      setPageStatus(
        clamped >= getTotalPages(totalForClamp, pageSize) && getTotalPages(totalForClamp, pageSize) === 0
          ? "ready"
          : "loading",
      )
      setPageError(null)
    }
    scrollRef.current?.scrollTo?.({ top: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, filterKey, serverBacked])

  // Keep the page in bounds if the effective total changes (filtered count
  // arrives after the reset above, or datasets are immutable per upload).
  useEffect(() => {
    if (!serverBacked) return
    setPage((prev) => clampPage(prev, totalPages))
  }, [serverBacked, totalPages])

  // Server page fetch: cache-first, then bounded network page. Abort +
  // request identity guarantee rapid page 2 → 3 → 4 and filter A → B → C
  // sequences never let an older response overwrite a newer one, and
  // workspace switches never leak rows. Cache identity includes the
  // filter key so unfiltered pages are never reused for filtered data.
  useEffect(() => {
    if (!serverBacked || datasetId == null) return
    if (totalPages === 0) {
      // Zero pages: either an empty dataset or zero filter matches. Only
      // mark ready when the zero is authoritative (dataset empty, or a
      // filtered count of 0 already arrived); otherwise keep loading so a
      // pending filtered count does not flash "no rows" prematurely.
      const authoritativeZero =
        !serverFiltering || (filteredCount !== null && filteredCount !== undefined)
      if (serverRowCount === 0 || authoritativeZero) {
        setPageRows([])
        setPageStatus("ready")
        setPageError(null)
      }
      return
    }
    const safePage = clampPage(page, totalPages)
    if (safePage !== page) {
      setPage(safePage)
      return
    }
    const key = pageCacheKey(datasetId, safePage, pageSize, filterKey)
    const cached = cacheRef.current.get(key)
    if (cached) {
      setPageRows(cached)
      setPageStatus("ready")
      setPageError(null)
      return
    }
    // Deterministic page-0 shortcut: serve the retained preview slice with
    // no duplicate request and no flash between two page sources. Only for
    // unfiltered page 0 — filtered results never come from the preview.
    if (!serverFiltering && safePage === 0 && dataset && canServePageFromPreview(dataset, 0, pageSize)) {
      const slice = slicePreviewPage(getDatasetPreview(dataset), pageSize)
      cacheRef.current.set(key, slice)
      setPageRows(slice)
      setPageStatus("ready")
      setPageError(null)
      return
    }
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const requestFilterKey = filterKey
    const requestFilters = serverFiltering ? serverFilters : []
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setPageStatus("loading")
    setPageError(null)
    getDatasetRows(datasetId, {
      page: safePage,
      pageSize: normalizePageSize(pageSize),
      filters: requestFilters.length > 0 ? requestFilters : null,
      signal: controller.signal,
    }).then(
      (body) => {
        if (requestIdRef.current !== requestId) return
        if (datasetIdRef.current !== datasetId) return
        if (filterKeyRef.current !== requestFilterKey) return
        const nextRows = Array.isArray(body?.rows) ? body.rows : []
        // Authoritative counts: filtered endpoint returns both totals;
        // legacy GET returns only row_count (== total).
        if (requestFilters.length > 0) {
          const nextFiltered = getFilteredRowCount(body, 0)
          const nextTotal = getDatasetRowCount({ row_count: body?.row_count }) || serverRowCount
          setFilteredCount(nextFiltered)
          void nextTotal
        } else {
          setFilteredCount(serverRowCount)
        }
        cacheRef.current.set(key, nextRows)
        while (cacheRef.current.size > SERVER_PAGE_CACHE_LIMIT) {
          const oldest = cacheRef.current.keys().next()
          if (oldest.done) break
          cacheRef.current.delete(oldest.value)
        }
        setPageRows(nextRows)
        setPageStatus("ready")
        scrollRef.current?.scrollTo?.({ top: 0 })
      },
      (err) => {
        if (requestIdRef.current !== requestId) return
        if (datasetIdRef.current !== datasetId) return
        if (filterKeyRef.current !== requestFilterKey) return
        if (err?.name === "AbortError" || controller.signal.aborted) return
        setPageStatus("error")
        setPageError(err)
      },
    )
    return () => {
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverBacked, datasetId, page, pageSize, totalPages, filterKey, retryNonce])

  // Abandon any in-flight page request on unmount (workspace close).
  useEffect(
    () => () => {
      abortRef.current?.abort()
    },
    [],
  )

  const goToPage = useCallback(
    (next) => {
      if (!serverBacked) return
      setPage(clampPage(next, getTotalPages(effectiveRowCount, pageSize)))
    },
    [serverBacked, effectiveRowCount, pageSize],
  )
  const handleRetry = useCallback(() => {
    cacheRef.current.delete(pageCacheKey(datasetId, page, pageSize, filterKey))
    setRetryNonce((n) => n + 1)
  }, [datasetId, page, pageSize, filterKey])

  // Virtualization always applies to the rows actually rendered: the full
  // preview in local mode, exactly one bounded page in server mode.
  const effectiveRows = serverBacked ? pageRows : visibleRows
  const rowVirtualizer = useVirtualizer({
    count: effectiveRows.length,
    getScrollElement,
    estimateSize: () => PREVIEW_ROW_HEIGHT,
    overscan: 12,
  })
  const virtualRows = rowVirtualizer.getVirtualItems()
  const topSpacer = virtualRows.length > 0 ? virtualRows[0].start : 0
  const bottomSpacer =
    effectiveRows.length * PREVIEW_ROW_HEIGHT -
    (virtualRows.length > 0
      ? virtualRows[virtualRows.length - 1].end
      : 0)

  // ---------------- Local mode (small datasets, unchanged) ----------------
  if (!serverBacked) {
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
                const row = effectiveRows[virtualRow.index]
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
  }

  // ---------------- Server mode (large datasets, paginated + filtered) ----------------
  const expired = pageStatus === "error" && isExpiredDatasetError(pageError)
  const safePage = clampPage(page, totalPages)
  // Navigation stays enabled during loading (except at the bounds) so rapid
  // page 2 → 3 → 4 and filter A → B → C sequences abort stale requests
  // instead of queueing; request identity + AbortController keep only the
  // latest page/filter.
  const canPrev = safePage > 0
  const canNext = safePage < totalPages - 1
  const loadingLabel = serverFiltering
    ? `Filtering… page ${safePage + 1}`
    : `Loading page ${safePage + 1}…`
  const emptyLabel =
    serverRowCount === 0
      ? "No rows in this dataset."
      : serverFiltering
        ? "No rows match the current filters."
        : "No rows in this dataset."

  return (
    <div className="min-w-0">
      <div
        ref={scrollRef}
        role="region"
        aria-label={`Scrollable data table for ${filename}, page ${totalPages === 0 ? 0 : safePage + 1} of ${totalPages}`}
        aria-busy={pageStatus === "loading"}
        tabIndex={0}
        className="max-h-[32rem] min-h-[16rem] min-w-0 overflow-auto rounded-lg border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <table className="w-full min-w-max border-collapse text-left text-sm">
          <caption className="sr-only">
            Page {totalPages === 0 ? 0 : safePage + 1} of {totalPages} of {filename}
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
            {pageStatus === "loading" && effectiveRows.length === 0 ? (
              <tr>
                <td
                  colSpan={Math.max(visibleColumns.length, 1)}
                  className="px-3 py-10 text-center text-sm text-muted-foreground"
                >
                  <span role="status" aria-live="polite">
                    {loadingLabel}
                  </span>
                </td>
              </tr>
            ) : pageStatus === "error" ? (
              <tr>
                <td
                  colSpan={Math.max(visibleColumns.length, 1)}
                  className="px-3 py-10 text-center"
                >
                  <p role="alert" className="text-sm font-medium">
                    {expired
                      ? "This dataset session has expired."
                      : "Could not load this page."}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {expired
                      ? EXPIRED_MESSAGE
                      : (pageError?.message || "Please try again.")}
                  </p>
                  {expired ? null : (
                    <button
                      type="button"
                      onClick={handleRetry}
                      className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Retry
                    </button>
                  )}
                </td>
              </tr>
            ) : effectiveRows.length === 0 ? (
              <tr>
                <td
                  colSpan={Math.max(visibleColumns.length, 1)}
                  className="px-3 py-10 text-center text-sm text-muted-foreground"
                >
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              <>
                {topSpacer > 0 && (
                  <tr aria-hidden="true">
                    <td
                      colSpan={visibleColumns.length}
                      style={{ height: topSpacer, padding: 0, border: 0 }}
                    />
                  </tr>
                )}
                {virtualRows.map((virtualRow) => {
                  const row = effectiveRows[virtualRow.index]
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
              </>
            )}
          </tbody>
        </table>
      </div>
      {totalPages === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {serverFiltering ? "No rows match the current filters." : "No rows to display."}
        </p>
      ) : (
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
          <nav
            aria-label={`Table pagination for ${filename}`}
            className="flex items-center gap-2"
          >
            <button
              type="button"
              onClick={() => goToPage(safePage - 1)}
              disabled={!canPrev}
              aria-label="Previous page"
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
              Page {safePage + 1} of {totalPages}
              {pageStatus === "loading" ? " · Loading…" : ""}
            </p>
            <button
              type="button"
              onClick={() => goToPage(safePage + 1)}
              disabled={!canNext}
              aria-label="Next page"
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </nav>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {serverFiltering ? (
          <>
            Showing {formatCount(effectiveRows.length)} rows on this page ·{" "}
            {formatCount(effectiveRowCount)} filtered rows of{" "}
            {formatCount(serverRowCount)} total ·{" "}
            {formatCount(visibleColumns.length)} columns. Scroll vertically for
            more rows on this page, horizontally for more columns.
          </>
        ) : (
          <>
            Showing {formatCount(effectiveRows.length)} rows on this page ·{" "}
            {formatCount(serverRowCount)} rows total ·{" "}
            {formatCount(visibleColumns.length)} columns. Scroll vertically for
            more rows on this page, horizontally for more columns.
          </>
        )}
      </p>
    </div>
  )
})
