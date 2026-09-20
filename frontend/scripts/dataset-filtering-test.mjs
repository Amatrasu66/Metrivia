// Metrivia Phase M3 server-side filtering tests — dependency-free node checks.
//
// Covers the frontend large-dataset filtered-pagination migration:
//   NORMALIZE  UI state → structured list (categorical/datetime/numeric)
//   KEY        deterministic filter key (order-independent, empty → "")
//   API        GET without filters, POST /filter with filters, abort, errors
//   SOURCE     filter-aware cache key, filtered page count, branch decision
//   TABLE      page reset, cache invalidation, cancellation, stale guard,
//              zero-result vs empty, expired, workspace/filter lifecycle
//
// Usage:  npm run filtering:test   (from frontend/)
// Exit code is non-zero on any failure.
import { readFileSync } from "node:fs"

const bust = () =>
  `?mf=${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
const libUrl = (rel) => String(new URL(`../src/lib/${rel}`, import.meta.url))
const srcFile = (rel) =>
  readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8")

let pass = 0
let fail = 0
function check(name, ok, detail = "") {
  if (ok) {
    pass += 1
    console.log(`PASS  ${name}`)
  } else {
    fail += 1
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ""}`)
  }
}

// ---------------------------------------------------------------------------
// Filter normalization (pure)
// ---------------------------------------------------------------------------
const filterData = await import(`${libUrl("filter-data.js")}${bust()}`)
const { toServerFilters, buildServerFilterKey, isServerFilterActive } =
  filterData

const uiFilters = {
  categorical: { genre: ["Pop", "Rock"], empty: [] },
  datetime: {
    release_date: { from: "2021-01-01", to: "2021-12-31" },
    other: { from: "", to: "" },
  },
  numeric: {
    popularity: { min: "50", max: "80" },
    streams: { min: "", max: "" },
    bad: { min: "abc", max: "" },
  },
}
const list = toServerFilters(uiFilters)
check(
  "F1 categorical maps to single in-filter (OR within column)",
  list.some(
    (f) =>
      f.column === "genre" &&
      f.operator === "in" &&
      Array.isArray(f.value) &&
      f.value.includes("Pop") &&
      f.value.includes("Rock"),
  ),
  JSON.stringify(list),
)
check(
  "F2 empty categorical skipped",
  !list.some((f) => f.column === "empty"),
)
check(
  "F3 datetime from/to map to gte/lte",
  list.some(
    (f) => f.column === "release_date" && f.operator === "gte" && f.value === "2021-01-01",
  ) &&
    list.some(
      (f) => f.column === "release_date" && f.operator === "lte" && f.value === "2021-12-31",
    ),
)
check(
  "F4 empty datetime skipped",
  !list.some((f) => f.column === "other"),
)
check(
  "F5 numeric min/max map to gte/lte numbers",
  list.some(
    (f) => f.column === "popularity" && f.operator === "gte" && f.value === 50,
  ) &&
    list.some(
      (f) => f.column === "popularity" && f.operator === "lte" && f.value === 80,
    ),
)
check(
  "F6 empty/invalid numeric skipped",
  !list.some((f) => f.column === "streams") && !list.some((f) => f.column === "bad"),
)
check(
  "F7 blank label preserved for backend",
  JSON.stringify(
    toServerFilters({ categorical: { c: ["(blank)"] }, datetime: {}, numeric: {} }),
  ).includes("(blank)"),
)
check(
  "F8 empty UI state → empty list",
  toServerFilters({ categorical: {}, datetime: {}, numeric: {} }).length === 0 &&
    toServerFilters(null).length === 0,
)

// --- deterministic key -------------------------------------------------------
const a = [
  { column: "b", operator: "gte", value: 1 },
  { column: "a", operator: "in", value: ["x"] },
]
const b = [
  { column: "a", operator: "in", value: ["x"] },
  { column: "b", operator: "gte", value: 1 },
]
check("K1 empty list → empty key", buildServerFilterKey([]) === "")
check(
  "K2 key order-independent",
  buildServerFilterKey(a) === buildServerFilterKey(b),
)
check(
  "K3 key changes with value",
  buildServerFilterKey(a) !==
    buildServerFilterKey([{ column: "b", operator: "gte", value: 2 }]),
)
check(
  "K4 active flag",
  isServerFilterActive(a) === true && isServerFilterActive([]) === false,
)

// ---------------------------------------------------------------------------
// Source helpers (pure)
// ---------------------------------------------------------------------------
const source = await import(`${libUrl("dataset-source.js")}${bust()}`)
const {
  getFilteredRowCount,
  getTotalPages,
  isServerBackedDataset,
  pageCacheKey,
  shouldUseServerFiltering,
} = source

check(
  "S1 cache key filter-aware (unfiltered stable, filtered distinct)",
  pageCacheKey("id", 1, 200) === "id:1:200" &&
    pageCacheKey("id", 1, 200, "") === "id:1:200" &&
    pageCacheKey("id", 1, 200, "k1") !== pageCacheKey("id", 1, 200) &&
    pageCacheKey("id", 1, 200, "k1") !== pageCacheKey("id", 1, 200, "k2"),
)
check(
  "S2 filtered page count: 1732 rows at 200 → 9 pages",
  getTotalPages(1732, 200) === 9,
)
check(
  "S3 zero filtered rows → zero pages",
  getTotalPages(0, 200) === 0,
)
check(
  "S4 filtered count reader prefers filtered_row_count",
  getFilteredRowCount({ filtered_row_count: 1732, row_count: 50000 }) === 1732 &&
    getFilteredRowCount({ row_count: 50000 }) === 50000,
)
const big = {
  dataset_id: "x".padEnd(32, "0"),
  row_count: 50000,
  preview_count: 500,
  preview: [],
}
const small = { dataset_id: "y", row_count: 100, preview_count: 100, preview: [] }
check(
  "S5 branch decision centralized (big → server, small → local)",
  shouldUseServerFiltering(big) === true &&
    shouldUseServerFiltering(small) === false &&
    shouldUseServerFiltering(big) === isServerBackedDataset(big),
)

// ---------------------------------------------------------------------------
// API client (mocked fetch)
// ---------------------------------------------------------------------------
const realFetch = globalThis.fetch
const calls = []
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init: { ...(init ?? {}) } })
  return { ok: true, status: 200, json: async () => ({ rows: [] }) }
}
const api = await import(`${libUrl("api.js")}${bust()}`)
const { ApiError, getDatasetRows, queryFilteredDatasetRows } = api
const lastCall = () => calls[calls.length - 1]
const resetCalls = () => {
  calls.length = 0
}

check(
  "A0 filter query function exists",
  typeof queryFilteredDatasetRows === "function" && typeof getDatasetRows === "function",
)

// Unfiltered → legacy GET
resetCalls()
await getDatasetRows("abc", { page: 1, pageSize: 200, baseUrl: "http://x:5000" })
{
  const url = new URL(lastCall()?.url)
  check(
    "A1 no filters → GET /rows with page + page_size",
    (lastCall()?.init?.method ?? "GET") !== "POST" &&
      url.pathname === "/api/datasets/abc/rows" &&
      url.searchParams.get("page") === "1",
    lastCall()?.url ?? "no call",
  )
}

// With filters → POST /filter
resetCalls()
await getDatasetRows("abc", {
  page: 0,
  pageSize: 200,
  filters: [{ column: "genre", operator: "in", value: ["Pop"] }],
  baseUrl: "http://x:5000",
})
{
  let body = null
  try {
    body = JSON.parse(lastCall()?.init?.body ?? "{}")
  } catch {
    body = null
  }
  check(
    "A2 filters → POST /filter with structured body",
    lastCall()?.url === "http://x:5000/api/datasets/abc/filter" &&
      lastCall()?.init?.method === "POST" &&
      Array.isArray(body?.filters) &&
      body?.filters[0]?.operator === "in" &&
      body?.page === 0 &&
      body?.page_size === 200,
    lastCall()?.url ?? "no call",
  )
}

// Abort passthrough
resetCalls()
{
  const controller = new AbortController()
  controller.abort()
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: { ...(init ?? {}) } })
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError")
    return { ok: true, status: 200, json: async () => ({}) }
  }
  let aborted = false
  try {
    await queryFilteredDatasetRows("abc", {
      page: 0,
      pageSize: 200,
      filters: [{ column: "a", operator: "eq", value: 1 }],
      baseUrl: "http://x:5000",
      signal: controller.signal,
    })
  } catch (err) {
    aborted = err?.name === "AbortError" && !(err instanceof ApiError)
  }
  check("A3 aborted filter request rejects with AbortError", aborted === true)
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: { ...(init ?? {}) } })
    return { ok: true, status: 200, json: async () => ({ rows: [] }) }
  }
}

// 404 preserved for expired UX
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init: { ...(init ?? {}) } })
  return { ok: false, status: 404, json: async () => ({ error: "Not found." }) }
}
{
  let status = null
  try {
    await queryFilteredDatasetRows("gone", {
      page: 0,
      pageSize: 200,
      filters: [{ column: "a", operator: "eq", value: 1 }],
      baseUrl: "http://x:5000",
    })
  } catch (err) {
    status = err?.status
  }
  check("A4 404 maps to ApiError status 404 (expired)", status === 404)
}
globalThis.fetch = realFetch

// ---------------------------------------------------------------------------
// Source-level contracts: table lifecycle, cache, honesty, regressions
// ---------------------------------------------------------------------------
const tableSrc = srcFile("components/dashboard/DataTable.jsx")
const placeholderSrc = srcFile(
  "components/dashboard/DashboardPlaceholder.jsx",
)
const apiSrc = srcFile("lib/api.js")
const filterSrc = srcFile("lib/filter-data.js")
const has = (src, re) => re.test(src)

check(
  "T1 filter change resets to page 0",
  /filterKey/.test(tableSrc) && /setPage\(clamped\)|setPage\(0\)/.test(tableSrc),
)
check(
  "T2 page cache is filter-aware",
  /pageCacheKey\(datasetId, .*filterKey\)/.test(tableSrc) &&
    /SERVER_PAGE_CACHE_LIMIT/.test(tableSrc),
)
check(
  "T3 filtered pagination uses filtered count",
  /effectiveRowCount|filteredCount/.test(tableSrc) &&
    /getTotalPages\(effectiveRowCount/.test(tableSrc),
)
check(
  "T4 zero-result vs empty distinguished",
  /No rows match the current filters/.test(tableSrc) &&
    /No rows in this dataset/.test(tableSrc),
)
check(
  "T5 cancellation (AbortController + silent AbortError)",
  has(tableSrc, /AbortController/) && has(tableSrc, /AbortError/),
)
check(
  "T6 stale-response rejection covers filter key",
  /requestIdRef\.current !== requestId/.test(tableSrc) &&
    /filterKeyRef\.current !== requestFilterKey/.test(tableSrc),
)
check(
  "T7 workspace + filter lifecycle clears cache and aborts",
  /\[datasetId, filterKey/.test(tableSrc) &&
    /cacheRef\.current = new Map\(\)/.test(tableSrc) &&
    /abortRef\.current\?\.abort\(\)/.test(tableSrc),
)
check(
  "T8 expired dataset without auto-retry",
  /This dataset session has expired/.test(tableSrc) &&
    /Please upload the CSV again/.test(tableSrc),
)
check(
  "T9 small-dataset local path preserved",
  /Local mode \(small datasets, unchanged\)/.test(tableSrc) &&
    /applyFilters\(preview, filters\)/.test(placeholderSrc),
)
check(
  "T10 table fetches bounded single pages only",
  /getDatasetRows\(datasetId,/.test(tableSrc) &&
    !/Promise\.all\(\s*pages|fetchAllPages|for\s*\(.*totalPages.*fetch/i.test(tableSrc),
)
check(
  "T11 preview shortcut only when unfiltered",
  /!serverFiltering && safePage === 0/.test(tableSrc),
)
check(
  "T12 no Tetris loader in table/filter path",
  !/import.*Tetris|<Tetris|TetrisLoader|AnalysisTetris|AnalysisProgress/.test(tableSrc),
)
check(
  "T13 placeholder passes filters + lifts filtered count",
  /<DataTable[\s\S]*filters=\{filters\}/.test(placeholderSrc) &&
    /onFilteredCountChange/.test(placeholderSrc) &&
    /onFilteredCountChange/.test(tableSrc),
)
check(
  "T14 KPIs use authoritative filtered count (no fake full stats)",
  /serverFilteredCount/.test(placeholderSrc) &&
    /Authoritative filtered rows/.test(placeholderSrc),
)
// Phase M4 intentionally changed this: server-backed charts now aggregate
// the full dataset in Flask (POST /api/datasets/<id>/chart); only the
// numeric summary stays preview-scoped. See dataset-chart-test.mjs T14.
check(
  "T15 charts aggregate server-side on large datasets (M4)",
  /aggregated server-side from the/.test(placeholderSrc) &&
    /sourceDataset=\{dataset\}/.test(placeholderSrc),
)
check(
  "T16 numeric summary carries preview-scope note on server",
  /scopeNote/.test(srcFile("components/dashboard/NumericSummary.jsx")),
)
check(
  "T17 API posts JSON without new HTTP library",
  /Content-Type.*application\/json/.test(apiSrc) &&
    !/from ["']axios["']|from ["']ky["']/.test(apiSrc),
)
check(
  "T18 normalization helpers exported and pure",
  /export function toServerFilters/.test(filterSrc) &&
    /export function buildServerFilterKey/.test(filterSrc),
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exitCode = 1
