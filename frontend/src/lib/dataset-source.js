/**
 * Metrivia Phase M2 — dataset data-source helpers (pure, no DOM/fetch).
 *
 * The upload payload (`dataset`) is still stored per workspace for
 * compatibility (charts/filters read `preview` until M3/M4), but large
 * datasets are NO LONGER complete in browser memory: `preview` is a bounded
 * head sample and `dataset_id` is the authoritative server source.
 *
 * Conceptual model:
 *   local/full-preview — small dataset, preview holds every row.
 *   server/paginated   — large dataset, DataTable pages through
 *                        GET /api/datasets/<id>/rows.
 *
 * No DOM, no fetch, no `@/` imports — safe to unit-test in node.
 */

/** Initial page size for server-backed tables (rows per request). */
export const SERVER_PAGE_SIZE_DEFAULT = 200

/** Maximum page size the backend accepts (single source for the frontend). */
export const SERVER_PAGE_SIZE_MAX = 500

/** How many fetched pages a table instance may retain (bounded memory). */
export const SERVER_PAGE_CACHE_LIMIT = 4

/** Backend preview sample size for large datasets (matches dataset_store). */
export const SERVER_SAMPLE_PREVIEW_ROWS = 500

/** Opaque dataset id, supporting both `dataset_id` and `datasetId`. */
export function getDatasetId(dataset) {
  const raw = dataset?.dataset_id ?? dataset?.datasetId
  return typeof raw === "string" && raw.trim() !== "" ? raw : null
}

/** Total row count from explicit backend fields (never preview.length). */
export function getDatasetRowCount(dataset) {
  const raw = dataset?.row_count ?? dataset?.rowCount
  const num = Number(raw)
  return Number.isFinite(num) && num >= 0 ? Math.floor(num) : 0
}

/** Rows actually returned in the upload payload (explicit field first). */
export function getDatasetPreviewCount(dataset) {
  if (dataset == null || typeof dataset !== "object") return 0
  const explicit = Number(dataset.preview_count ?? dataset.previewCount)
  if (Number.isFinite(explicit) && explicit >= 0) return Math.floor(explicit)
  const preview = dataset.preview ?? dataset.rows
  return Array.isArray(preview) ? preview.length : 0
}

/** Bounded upload preview (compat for charts/filters until M3/M4). */
export function getDatasetPreview(dataset) {
  const preview = dataset?.preview ?? dataset?.rows
  return Array.isArray(preview) ? preview : []
}

/** Backend-provided schema/column ordering (authoritative, not page-derived). */
export function getDatasetColumns(dataset) {
  const columns = dataset?.columns
  return Array.isArray(columns) ? columns.filter((c) => typeof c === "string") : []
}

/**
 * True when the table must page from the server instead of rendering the
 * (complete) preview. Uses explicit backend fields — never infers from
 * `preview.length` alone:
 *   - missing/blank dataset_id → local
 *   - zero rows → local (empty, nothing to page)
 *   - row_count > preview_count → server-backed (bounded sample)
 */
export function isServerBackedDataset(dataset) {
  if (dataset == null || typeof dataset !== "object") return false
  if (getDatasetId(dataset) == null) return false
  const rowCount = getDatasetRowCount(dataset)
  if (rowCount <= 0) return false
  return rowCount > getDatasetPreviewCount(dataset)
}

/** Total pages for rowCount at pageSize (zero rows → zero pages). */
export function getTotalPages(rowCount, pageSize) {
  const rows = Number(rowCount)
  const size = Number(pageSize)
  if (!Number.isFinite(rows) || rows <= 0) return 0
  if (!Number.isFinite(size) || size <= 0) return 0
  return Math.ceil(rows / Math.floor(size))
}

/** Normalize a page index: integers ≥ 0, anything else → 0. */
export function normalizePage(page) {
  const num = Number(page)
  if (!Number.isFinite(num)) return 0
  return Math.max(0, Math.floor(num))
}

/**
 * Normalize a page size: integers clamped to 1..SERVER_PAGE_SIZE_MAX,
 * anything invalid → SERVER_PAGE_SIZE_DEFAULT.
 */
export function normalizePageSize(pageSize) {
  const num = Number(pageSize)
  if (!Number.isFinite(num)) return SERVER_PAGE_SIZE_DEFAULT
  const floored = Math.floor(num)
  if (floored < 1 || floored > SERVER_PAGE_SIZE_MAX) {
    return SERVER_PAGE_SIZE_DEFAULT
  }
  return floored
}

/** Clamp a page into [0, totalPages - 1] (totalPages 0 → 0). */
export function clampPage(page, totalPages) {
  const total = Number(totalPages)
  if (!Number.isFinite(total) || total <= 0) return 0
  return Math.min(Math.max(0, normalizePage(page)), Math.ceil(total) - 1)
}

/**
 * Cache key for one fetched page (dataset + page + size + filter key).
 * The trailing filter segment keeps M2 unfiltered keys stable: empty
 * filter keys return the exact legacy `id:page:size` shape, while any
 * active filter appends `:<filterKey>` so filtered pages can never reuse
 * unfiltered entries (and vice versa).
 */
export function pageCacheKey(datasetId, page, pageSize, filterKey = "") {
  const base = `${datasetId ?? ""}:${normalizePage(page)}:${normalizePageSize(pageSize)}`
  return typeof filterKey === "string" && filterKey !== ""
    ? `${base}:${filterKey}`
    : base
}

/**
 * Centralized Phase M3 branch decision: small/full-preview datasets keep
 * existing client-side filtering; large/server-backed datasets must use
 * server-side filtering + pagination. Both paths consume the same
 * normalized UI filter state (see `toServerFilters`).
 */
export function shouldUseServerFiltering(dataset) {
  return isServerBackedDataset(dataset)
}

/** Authoritative filtered count from a filter-query response. */
export function getFilteredRowCount(body, fallback = 0) {
  const raw =
    body?.filtered_row_count ?? body?.filteredRowCount ?? body?.row_count
  const num = Number(raw)
  return Number.isFinite(num) && num >= 0 ? Math.floor(num) : fallback
}

/**
 * True when the retained upload preview can deterministically serve the
 * requested page without a network round-trip. The backend preview is
 * `df.head(SAMPLE)` and page 0 is `df.iloc[0:pageSize]`, so page 0 is
 * covered whenever the preview holds at least min(pageSize, rowCount) rows.
 * Only page 0 is ever served this way — later pages always fetch.
 */
export function canServePageFromPreview(dataset, page, pageSize) {
  if (normalizePage(page) !== 0) return false
  const size = normalizePageSize(pageSize)
  const rowCount = getDatasetRowCount(dataset)
  if (rowCount <= 0) return false
  const preview = getDatasetPreview(dataset)
  return preview.length >= Math.min(size, rowCount)
}

/** Slice page 0 out of the retained preview (no fetch, no flash). */
export function slicePreviewPage(preview, pageSize) {
  const rows = Array.isArray(preview) ? preview : []
  if (normalizePage(0) !== 0) return []
  return rows.slice(0, normalizePageSize(pageSize))
}

/** True for expired/missing server datasets (backend 404). */
export function isExpiredDatasetError(error) {
  return error != null && Number(error?.status) === 404
}
