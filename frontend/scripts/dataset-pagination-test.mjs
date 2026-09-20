// Metrivia Phase M2 dataset-pagination tests — dependency-free node checks.
//
// Covers the frontend large-dataset pagination migration:
//   API      metadata/rows requests, query encoding, AbortSignal, errors
//   SOURCE   local vs server-backed detection, pagination math, page sizes
//   PAGE     first/middle/final/beyond, exact multiples, partial + empty
//   LIFECYCLE/CACHE/ISOLATION + regression guards at the source level
//            (DataTable request identity, abort, bounded cache, no fetch-all,
//             TanStack virtualization preserved, no Tetris in the table)
//
// Usage:  npm run pagination:test   (from frontend/)
// Exit code is non-zero on any failure.
import { readFileSync } from "node:fs"

const bust = () =>
  `?pg=${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
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
// Data-source helpers (pure)
// ---------------------------------------------------------------------------
const source = await import(`${libUrl("dataset-source.js")}${bust()}`)
const {
  SERVER_PAGE_CACHE_LIMIT,
  SERVER_PAGE_SIZE_DEFAULT,
  SERVER_PAGE_SIZE_MAX,
  canServePageFromPreview,
  clampPage,
  getDatasetId,
  getDatasetRowCount,
  getTotalPages,
  isExpiredDatasetError,
  isServerBackedDataset,
  normalizePage,
  normalizePageSize,
  pageCacheKey,
  slicePreviewPage,
} = source

const smallDataset = (over = {}) => ({
  dataset_id: "abc123",
  filename: "sales.csv",
  row_count: 1200,
  column_count: 4,
  columns: ["a", "b", "c", "d"],
  preview_count: 1200,
  preview: Array.from({ length: 1200 }, (_, i) => ({ a: i })),
  ...over,
})
const largeDataset = (over = {}) => ({
  dataset_id: "deadbeef".padEnd(32, "0"),
  filename: "spotify.csv",
  row_count: 50000,
  column_count: 33,
  columns: ["c0", "c1"],
  preview_count: 500,
  preview: Array.from({ length: 500 }, (_, i) => ({ c0: i })),
  ...over,
})

check("D1 small/full-preview dataset stays local", isServerBackedDataset(smallDataset()) === false)
check("D2 large/bounded-preview dataset is server-backed", isServerBackedDataset(largeDataset()) === true)
check("D3 missing datasetId is local", isServerBackedDataset({ row_count: 50000, preview_count: 500, preview: [] }) === false)
check("D4 zero-row dataset is local", isServerBackedDataset(largeDataset({ row_count: 0, preview_count: 0, preview: [] })) === false)
check("D5 null dataset is local", isServerBackedDataset(null) === false && isServerBackedDataset(undefined) === false)
check(
  "D6 detection uses explicit counts, not preview.length",
  isServerBackedDataset(largeDataset({ preview: Array.from({ length: 500 }, (_, i) => ({ c0: i })) })) === true &&
    isServerBackedDataset(smallDataset({ preview: smallDataset().preview.slice(0, 10) })) === false,
  "row_count vs preview_count decides",
)
check("D7 blank/whitespace id is local", isServerBackedDataset(largeDataset({ dataset_id: "   " })) === false)
check("D8 datasetId alias supported", getDatasetId({ datasetId: "x1" }) === "x1" && getDatasetId({ dataset_id: "x2" }) === "x2")
check("D9 expired error is 404-only", isExpiredDatasetError({ status: 404 }) === true && isExpiredDatasetError({ status: 500 }) === false && isExpiredDatasetError(null) === false)
check("D10 row count never negative/NaN", getDatasetRowCount({ row_count: -5 }) === 0 && getDatasetRowCount({}) === 0)

// --- pagination math ---------------------------------------------------------
check("G1 default page size is 200", SERVER_PAGE_SIZE_DEFAULT === 200, String(SERVER_PAGE_SIZE_DEFAULT))
check("G2 maximum page size is 500", SERVER_PAGE_SIZE_MAX === 500, String(SERVER_PAGE_SIZE_MAX))
check("G3 50000 rows at 200 → 250 pages", getTotalPages(50000, 200) === 250)
check("G4 first page index 0 of 250", clampPage(0, 250) === 0)
check("G5 middle page stays (124 of 250)", clampPage(124, 250) === 124)
check("G6 final page index 249 of 250", clampPage(249, 250) === 249)
check("G7 beyond-final clamps to last page", clampPage(999, 250) === 249)
check("G8 exact multiple: 400 rows at 200 → 2 pages", getTotalPages(400, 200) === 2)
check("G9 partial final: 501 rows at 200 → 3 pages", getTotalPages(501, 200) === 3)
check("G10 empty dataset → 0 pages", getTotalPages(0, 200) === 0)
check("G11 negative page clamps to 0", clampPage(-3, 10) === 0)
check("G12 invalid sizes fall back to default", normalizePageSize(0) === 200 && normalizePageSize(501) === 200 && normalizePageSize("nope") === 200 && normalizePageSize(500) === 500)
check("G13 invalid pages normalize to 0", normalizePage("x") === 0 && normalizePage(-2) === 0 && normalizePage(2.9) === 2)
check("G14 cache key covers dataset+page+size", pageCacheKey("a", 1, 200) !== pageCacheKey("a", 2, 200) && pageCacheKey("a", 1, 200) !== pageCacheKey("b", 1, 200) && pageCacheKey("a", 1, 200) !== pageCacheKey("a", 1, 100))
check("G15 cache limit is bounded (3–5)", SERVER_PAGE_CACHE_LIMIT >= 3 && SERVER_PAGE_CACHE_LIMIT <= 5, String(SERVER_PAGE_CACHE_LIMIT))
check(
  "G16 preview serves page 0 deterministically",
  canServePageFromPreview(largeDataset(), 0, 200) === true &&
    canServePageFromPreview(largeDataset(), 1, 200) === false &&
    slicePreviewPage(largeDataset().preview, 200).length === 200,
)

// ---------------------------------------------------------------------------
// API client (mocked fetch)
// ---------------------------------------------------------------------------
const realFetch = globalThis.fetch
const calls = []
let nextResponse = null
let nextError = null
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init: { ...init } })
  if (nextError) {
    const err = nextError
    nextError = null
    throw err
  }
  const body = nextResponse
  nextResponse = null
  return { ok: true, status: 200, json: async () => body }
}
const api = await import(`${libUrl("api.js")}${bust()}`)
const { ApiError, getDatasetMetadata, getDatasetRows } = api
const lastCall = () => calls[calls.length - 1]
const resetCalls = () => {
  calls.length = 0
}

check("A0 pagination functions exist", typeof getDatasetMetadata === "function" && typeof getDatasetRows === "function")

// A1 metadata request
resetCalls()
nextResponse = { dataset_id: "abc", row_count: 10 }
await getDatasetMetadata("abc", { baseUrl: "http://x:5000" })
check(
  "A1 metadata hits GET /api/datasets/<id>",
  lastCall()?.url === "http://x:5000/api/datasets/abc" && lastCall()?.init?.method !== "POST",
  lastCall()?.url ?? "no call",
)

// A2 rows request query encoding
resetCalls()
nextResponse = { rows: [] }
await getDatasetRows("abc", { page: 2, pageSize: 200, baseUrl: "http://x:5000" })
{
  const url = new URL(lastCall()?.url)
  check(
    "A2 rows request encodes page + page_size",
    url.pathname === "/api/datasets/abc/rows" && url.searchParams.get("page") === "2" && url.searchParams.get("page_size") === "200",
    lastCall()?.url ?? "no call",
  )
}

// A3 id encoding
resetCalls()
nextResponse = { dataset_id: "a/b c" }
await getDatasetMetadata("a/b c", { baseUrl: "http://x:5000" })
check(
  "A3 dataset id is URL-encoded",
  lastCall()?.url === "http://x:5000/api/datasets/a%2Fb%20c",
  lastCall()?.url ?? "no call",
)

// A4 AbortSignal passthrough + silent abort
resetCalls()
{
  const controller = new AbortController()
  controller.abort()
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: { ...init } })
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError")
    return { ok: true, status: 200, json: async () => ({}) }
  }
  let aborted = false
  try {
    await getDatasetRows("abc", { page: 0, pageSize: 200, baseUrl: "http://x:5000", signal: controller.signal })
  } catch (err) {
    aborted = err?.name === "AbortError" && !(err instanceof ApiError)
  }
  check("A4 aborted request rejects with AbortError (no ApiError wrap)", aborted === true)
  // restore script fetch mock
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: { ...init } })
    if (nextError) {
      const err = nextError
      nextError = null
      throw err
    }
    const body = nextResponse
    nextResponse = null
    return { ok: true, status: 200, json: async () => body }
  }
}

// A5 HTTP error mapping (404 preserved for expired UX)
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init: { ...init } })
  return { ok: false, status: 404, json: async () => ({ error: "Not found." }) }
}
{
  let status = null
  let message = ""
  try {
    await getDatasetMetadata("gone", { baseUrl: "http://x:5000" })
  } catch (err) {
    status = err?.status
    message = err?.message
  }
  check("A5 404 maps to ApiError with status 404", status === 404, `status=${status} msg=${message}`)
}
{
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: { ...init } })
    return { ok: false, status: 400, json: async () => ({ error: "Invalid 'page'." }) }
  }
  let err = null
  try {
    await getDatasetRows("abc", { page: -1, pageSize: 200, baseUrl: "http://x:5000" })
  } catch (e) {
    err = e
  }
  check("A5b 400 maps with backend message", err instanceof ApiError && err.status === 400 && /page/i.test(err.message ?? ""))
}

// A6 network failure → isNetworkError
globalThis.fetch = async () => {
  throw new TypeError("fetch failed")
}
{
  let err = null
  try {
    await getDatasetRows("abc", { page: 0, baseUrl: "http://x:5000" })
  } catch (e) {
    err = e
  }
  check("A6 network failure flags isNetworkError", err instanceof ApiError && err.isNetworkError === true)
}

// A7 missing id throws without fetch
{
  let fetched = false
  globalThis.fetch = async () => {
    fetched = true
    return { ok: true, status: 200, json: async () => ({}) }
  }
  let threw = false
  try {
    await getDatasetRows("   ", { baseUrl: "http://x:5000" })
  } catch {
    threw = true
  }
  check("A7 missing dataset id throws before fetch", threw === true && fetched === false)
}
globalThis.fetch = realFetch

// ---------------------------------------------------------------------------
// Source-level contracts: lifecycle, cache, isolation, regressions
// ---------------------------------------------------------------------------
const tableSrc = srcFile("components/dashboard/DataTable.jsx")
const placeholderSrc = srcFile("components/dashboard/DashboardPlaceholder.jsx")
const apiSrc = srcFile("lib/api.js")
const has = (src, re) => re.test(src)

check("R1 abort protection (AbortController + unmount cleanup)", has(tableSrc, /AbortController/) && has(tableSrc, /controller\.abort\(\)/) && has(tableSrc, /abortRef\.current\?\.abort\(\)/))
check("R2 stale-response guard (request identity)", /requestIdRef|requestId|requestSeq|latestRequest/i.test(tableSrc) && /requestIdRef\.current !== requestId/.test(tableSrc))
check("R3 loading state is table-local", /Loading page/.test(tableSrc) && !/import.*Tetris|<Tetris|TetrisLoader/.test(tableSrc))
check("R4 error + Retry action", /Could not load this page/.test(tableSrc) && /Retry/.test(tableSrc))
check("R5 expired dataset state without auto-retry", /This dataset session has expired/.test(tableSrc) && /Please upload the CSV again/.test(tableSrc))
check("R6 cancellation stays silent", /AbortError/.test(tableSrc))
check("R7 pagination controls with disabled bounds", /Previous/.test(tableSrc) && /Next/.test(tableSrc) && /Page \{/.test(tableSrc) && /disabled/.test(tableSrc))
check("R8 total pages via Math.ceil", /Math\.ceil/.test(srcFile("lib/dataset-source.js")))
check("R9 bounded page cache (key + limit + eviction)", /pageCacheKey/.test(tableSrc) && /SERVER_PAGE_CACHE_LIMIT/.test(tableSrc) && /cacheRef\.current\.delete/.test(tableSrc))
check("R10 page state scoped to dataset id", /\[datasetId/.test(tableSrc) && /cacheRef\.current = new Map\(\)|cacheRef\.current\.clear\(\)/.test(tableSrc))
check("R11 no whole-dataset fetch (single page only)", !/Promise\.all\(\s*pages|fetchAllPages|while\s*\(.*hasMore|for\s*\(.*totalPages.*fetch/i.test(tableSrc) && /getDatasetRows\(datasetId,\s*\{\s*page:\s*safePage/.test(tableSrc))
check("R12 TanStack virtualization preserved on the page", /useVirtualizer/.test(tableSrc) && /estimateSize/.test(tableSrc))
check("R13 no Tetris in the table module", !/import.*Tetris|<Tetris|TetrisLoader|AnalysisTetris|AnalysisProgress/.test(tableSrc))
check("R14 columns from schema, not the page", /visibleColumns\.map/.test(tableSrc) && !/Object\.keys\(.*pageRows|Object\.keys\(.*effectiveRows/.test(tableSrc))
check("R15 placeholder passes dataset to the table", /<DataTable[\s\S]*dataset=\{dataset\}/.test(placeholderSrc))
check("R16 api exposes metadata + rows with signal", /export async function getDatasetMetadata/.test(apiSrc) && /export async function getDatasetRows/.test(apiSrc) && /signal/.test(apiSrc))
check("R17 no new HTTP library", !/from ["']axios["']|require\(["']axios["']\)|from ["']ky["']|from ["']superagent["']/.test(apiSrc))
check("R18 preview retained for chart/filter consumers", /dataset\.preview/.test(placeholderSrc) || /preview/.test(srcFile("lib/chart-data.js")))
check("R19 filters scoped honestly on server tables (M3: server-filtered pagination)", /filtered rows of/.test(tableSrc) && /server-filtered pagination|serverFiltering|filterKey/.test(tableSrc))
check("R20 page size centralized (200 default, 500 max)", /SERVER_PAGE_SIZE_DEFAULT/.test(tableSrc) && /200/.test(srcFile("lib/dataset-source.js")) && /500/.test(srcFile("lib/dataset-source.js")))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exitCode = 1
