// Metrivia Phase M4 server-side chart aggregation tests — dependency-free node checks.
//
// Covers the frontend large-dataset chart migration:
//   REQUEST  chart config + canonical toServerFilters() → POST body
//   KEY      deterministic request key (dataset + config + filter identity)
//   ADAPT    bounded server payload → local `prepared` shape (Bklit unchanged)
//   API      POST /chart path/body, abort, expired, validation errors
//   SOURCE   server branch decision, bounded cache, lifecycle + isolation
//   TABLE    ChartBuilder request identity, cancellation, stale guard,
//            workspace isolation, loading/error/empty states, local compat
//
// Usage:  npm run chart:test   (from frontend/)
// Exit code is non-zero on any failure.
import { readFileSync } from "node:fs"

const bust = () =>
  `?mc=${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
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
// Request construction (pure)
// ---------------------------------------------------------------------------
const source = await import(`${libUrl("chart-data-source.js")}${bust()}`)
const {
  CHART_CACHE_LIMIT,
  SERVER_CHART_LIMIT,
  SERVER_SCATTER_LIMIT,
  adaptServerChartToPrepared,
  buildChartRequest,
  buildChartRequestKey,
  clearChartCache,
  describeServerPrepared,
  getCachedChart,
  isChartRequestComplete,
  setCachedChart,
  shouldUseServerChart,
} = source

const barConfig = {
  chartType: "bar",
  dimension: "genre",
  measure: "streams",
  aggregation: "sum",
}
const serverFilters = [{ column: "genre", operator: "in", value: ["Pop"] }]

{
  const req = buildChartRequest(barConfig, serverFilters)
  check(
    "R1 grouped request carries config + canonical filters",
    req.chart_type === "bar" &&
      req.dimension === "genre" &&
      req.measure === "streams" &&
      req.aggregation === "sum" &&
      Array.isArray(req.filters) &&
      req.filters[0]?.operator === "in" &&
      req.limit === SERVER_CHART_LIMIT,
    JSON.stringify(req),
  )
}
{
  const req = buildChartRequest(
    { chartType: "bar", dimension: "g", measure: "v", aggregation: "count" },
    [],
  )
  check(
    "R2 count sends null measure",
    req.measure === null && req.aggregation === "count",
    JSON.stringify(req),
  )
}
{
  const req = buildChartRequest(
    { chartType: "scatter", dimension: "when", measure: "v", aggregation: "sum" },
    serverFilters,
  )
  check(
    "R3 scatter uses bounded point limit + keeps filters",
    req.limit === SERVER_SCATTER_LIMIT &&
      req.limit <= 2000 &&
      req.filters.length === 1,
    JSON.stringify(req),
  )
}
check(
  "R4 grouped limit matches the UI cap (20)",
  SERVER_CHART_LIMIT === 20,
  String(SERVER_CHART_LIMIT),
)
check(
  "R5 scatter limit is bounded (≤ 2000)",
  SERVER_SCATTER_LIMIT <= 2000 && SERVER_SCATTER_LIMIT >= 500,
  String(SERVER_SCATTER_LIMIT),
)
check(
  "R6 request completeness gate",
  isChartRequestComplete(buildChartRequest(barConfig, [])) === true &&
    isChartRequestComplete({ chart_type: "bar", dimension: "", measure: "v" }) === false &&
    isChartRequestComplete(null) === false,
)

// --- deterministic key -------------------------------------------------------
{
  const a = buildChartRequest(barConfig, [
    { column: "b", operator: "gte", value: 1 },
    { column: "a", operator: "in", value: ["x"] },
  ])
  const b = buildChartRequest(barConfig, [
    { column: "a", operator: "in", value: ["x"] },
    { column: "b", operator: "gte", value: 1 },
  ])
  const changed = buildChartRequest(
    { ...barConfig, aggregation: "average" },
    [{ column: "b", operator: "gte", value: 1 }],
  )
  check(
    "K1 key covers dataset id",
    buildChartRequestKey("id-a", a) !== buildChartRequestKey("id-b", a),
  )
  check(
    "K2 key order-independent over filters",
    buildChartRequestKey("id", a) === buildChartRequestKey("id", b),
  )
  check(
    "K3 key changes with config / filters / limit / sort / granularity",
    buildChartRequestKey("id", a) !== buildChartRequestKey("id", changed) &&
      buildChartRequestKey("id", a) !==
        buildChartRequestKey("id", { ...a, limit: 5 }) &&
      buildChartRequestKey("id", a) !==
        buildChartRequestKey("id", { ...a, sort: "ascending" }) &&
      buildChartRequestKey("id", a) !==
        buildChartRequestKey("id", { ...a, date_granularity: "month" }),
  )
}

// --- branch decision ----------------------------------------------------------
{
  const big = {
    dataset_id: "x".padEnd(32, "0"),
    row_count: 50000,
    preview_count: 500,
    preview: [],
  }
  const small = { dataset_id: "y", row_count: 100, preview_count: 100, preview: [] }
  check(
    "S0 server branch matches table detection (big → server, small → local)",
    shouldUseServerChart(big) === true && shouldUseServerChart(small) === false,
  )
}

// ---------------------------------------------------------------------------
// Response adaptation (pure)
// ---------------------------------------------------------------------------
{
  const body = {
    dataset_id: "abc",
    chart_type: "bar",
    dimension: "genre",
    measure: "streams",
    aggregation: "sum",
    filtered_row_count: 1427,
    row_count: 50000,
    data: [
      { label: "Pop", value: 1234567 },
      { label: "Rock", value: 42 },
    ],
    total_groups: 30,
    shown_groups: 2,
    truncated: true,
  }
  const prepared = adaptServerChartToPrepared(body, barConfig)
  check(
    "P1 grouped payload adapts to the local prepared shape",
    prepared.status === "ok" &&
      prepared.kind === "bar" &&
      prepared.data.length === 2 &&
      prepared.data[0].label === "Pop" &&
      prepared.dimension === "genre" &&
      prepared.totalGroups === 30 &&
      prepared.truncated === true &&
      prepared.filteredRowCount === 1427,
    JSON.stringify(prepared).slice(0, 200),
  )
}
{
  const body = {
    chart_type: "scatter",
    dimension: "when",
    measure: "streams",
    filtered_row_count: 50000,
    row_count: 50000,
    data: [
      { x: "2021-01-05T00:00:00", y: 10 },
      { x: "2021-02-10T00:00:00", y: 20 },
    ],
    total_groups: 50000,
    shown_groups: 2,
    truncated: true,
  }
  const prepared = adaptServerChartToPrepared(body, {
    chartType: "scatter",
    dimension: "when",
    measure: "streams",
  })
  check(
    "P2 scatter payload adapts to [{ x, y }] observations",
    prepared.status === "ok" &&
      prepared.kind === "scatter" &&
      prepared.data[0].x === "2021-01-05T00:00:00" &&
      prepared.aggregation === null,
  )
}
{
  const empty = adaptServerChartToPrepared(
    { chart_type: "bar", filtered_row_count: 0, data: [] },
    barConfig,
  )
  check(
    "P3 empty filtered result keeps the Clear-filters title",
    empty.status === "empty" &&
      empty.title === "No rows match the current filters",
  )
  const pieEmpty = adaptServerChartToPrepared(
    { chart_type: "pie", filtered_row_count: 10, data: [] },
    { chartType: "pie" },
  )
  check(
    "P4 empty pie keeps the positive-values message",
    pieEmpty.status === "empty" && pieEmpty.title === "Nothing positive to show",
  )
  const dirty = adaptServerChartToPrepared(
    {
      chart_type: "bar",
      filtered_row_count: 5,
      data: [
        { label: "ok", value: 3 },
        { label: "bad", value: NaN },
        null,
        { label: 42, value: 1 },
      ],
    },
    barConfig,
  )
  check(
    "P5 invalid entries are dropped, never crash",
    dirty.status === "ok" && dirty.data.length === 1,
    JSON.stringify(dirty.data),
  )
}
{
  const caption = describeServerPrepared({
    status: "ok",
    kind: "bar",
    aggregation: "sum",
    dimension: "genre",
    measure: "streams",
    totalGroups: 30,
    shownGroups: 20,
    filteredRowCount: 1427,
  })
  check(
    "P6 server caption claims full-dataset scope (never preview)",
    caption.includes("full dataset") && !caption.includes("preview"),
    caption,
  )
}

// --- bounded cache --------------------------------------------------------------
{
  clearChartCache()
  for (let i = 0; i < CHART_CACHE_LIMIT + 5; i += 1) {
    setCachedChart(`k-${i}`, { status: "ok", kind: "bar", data: [] })
  }
  check(
    "C1 cache is bounded (LRU-evicted)",
    getCachedChart("k-0") === null &&
      getCachedChart(`k-${CHART_CACHE_LIMIT + 4}`) !== null,
  )
  clearChartCache()
  check("C2 cache clears", getCachedChart("k-1") === null)
  check(
    "C3 cache limit is small and bounded",
    CHART_CACHE_LIMIT >= 5 && CHART_CACHE_LIMIT <= 50,
    String(CHART_CACHE_LIMIT),
  )
}

// ---------------------------------------------------------------------------
// API client (mocked fetch)
// ---------------------------------------------------------------------------
const realFetch = globalThis.fetch
const calls = []
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init: { ...(init ?? {}) } })
  return { ok: true, status: 200, json: async () => ({ data: [] }) }
}
const api = await import(`${libUrl("api.js")}${bust()}`)
const { ApiError, queryChartData } = api
const lastCall = () => calls[calls.length - 1]
const resetCalls = () => {
  calls.length = 0
}

check("A0 chart query function exists", typeof queryChartData === "function")

resetCalls()
await queryChartData(
  "abc",
  { chart_type: "bar", dimension: "g", measure: "v", aggregation: "sum", filters: [] },
  { baseUrl: "http://x:5000" },
)
{
  let body = null
  try {
    body = JSON.parse(lastCall()?.init?.body ?? "{}")
  } catch {
    body = null
  }
  check(
    "A1 chart posts structured body to POST /chart",
    lastCall()?.url === "http://x:5000/api/datasets/abc/chart" &&
      lastCall()?.init?.method === "POST" &&
      body?.chart_type === "bar" &&
      Array.isArray(body?.filters),
    lastCall()?.url ?? "no call",
  )
}

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
    await queryChartData(
      "abc",
      { chart_type: "bar", dimension: "g", measure: "v", aggregation: "sum", filters: [] },
      { baseUrl: "http://x:5000", signal: controller.signal },
    )
  } catch (err) {
    aborted = err?.name === "AbortError" && !(err instanceof ApiError)
  }
  check("A2 aborted chart request rejects with AbortError", aborted === true)
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: { ...(init ?? {}) } })
    return { ok: true, status: 200, json: async () => ({ data: [] }) }
  }
}

globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init: { ...(init ?? {}) } })
  return { ok: false, status: 404, json: async () => ({ error: "Not found." }) }
}
{
  let status = null
  try {
    await queryChartData(
      "gone",
      { chart_type: "bar", dimension: "g", measure: "v", aggregation: "sum", filters: [] },
      { baseUrl: "http://x:5000" },
    )
  } catch (err) {
    status = err?.status
  }
  check("A3 404 maps to ApiError status 404 (expired)", status === 404)
}
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init: { ...(init ?? {}) } })
  return { ok: false, status: 400, json: async () => ({ error: "Invalid aggregation." }) }
}
{
  let err = null
  try {
    await queryChartData(
      "abc",
      { chart_type: "bar", dimension: "g", measure: "v", aggregation: "nope", filters: [] },
      { baseUrl: "http://x:5000" },
    )
  } catch (e) {
    err = e
  }
  check(
    "A4 400 surfaces the backend validation message",
    err instanceof ApiError && err.status === 400 && /aggregation/i.test(err.message ?? ""),
  )
}
{
  let fetched = false
  globalThis.fetch = async () => {
    fetched = true
    return { ok: true, status: 200, json: async () => ({}) }
  }
  let threw = false
  try {
    await queryChartData("   ", { chart_type: "bar" }, { baseUrl: "http://x:5000" })
  } catch {
    threw = true
  }
  check("A5 missing dataset id throws before fetch", threw === true && fetched === false)
}
globalThis.fetch = realFetch

// ---------------------------------------------------------------------------
// Source-level contracts: builder lifecycle, isolation, honesty, regressions
// ---------------------------------------------------------------------------
const builderSrc = srcFile("components/charts/ChartBuilder.jsx")
const placeholderSrc = srcFile("components/dashboard/DashboardPlaceholder.jsx")
const chartApiSrc = srcFile("lib/api.js")
const chartSourceSrc = srcFile("lib/chart-data-source.js")
const has = (src, re) => re.test(src)

check(
  "T1 server branch uses the shared detection (never preview.length)",
  /shouldUseServerChart\(/.test(builderSrc) &&
    /isServerBackedDataset/.test(chartSourceSrc),
)
check(
  "T2 request carries the canonical M3 filters",
  /toServerFilters\(filters\)/.test(builderSrc) &&
    /buildChartRequest\(config, serverFilters\)/.test(builderSrc),
)
check(
  "T3 request identity covers type + fields + aggregation + filters + limit",
  /buildChartRequestKey\(datasetId, chartRequest\)/.test(builderSrc) &&
    /datasetId.*chart_type.*dimension.*measure.*aggregation.*limit.*sort.*date_granularity/s.test(chartSourceSrc),
)
check(
  "T4 cancellation (AbortController + silent AbortError)",
  has(builderSrc, /AbortController/) && has(builderSrc, /AbortError/),
)
check(
  "T5 stale-response rejection covers dataset + request key",
  /requestIdRef\.current !== requestId/.test(builderSrc) &&
    /datasetIdRef\.current !== activeDatasetId/.test(builderSrc) &&
    /requestKeyRef\.current !== activeKey/.test(builderSrc),
)
check(
  "T6 workspace/dataset lifecycle aborts and resets",
  /abortRef\.current\?\.abort\(\)/.test(builderSrc) &&
    /datasetIdRef\.current !== datasetId/.test(builderSrc),
)
check(
  "T7 detection uses the original dataset (filtered views never false-trigger)",
  /sourceDataset/.test(builderSrc) && /sourceDataset=\{dataset\}/.test(placeholderSrc),
)
check(
  "T8 expired dataset without auto-retry",
  /This dataset session has expired/.test(builderSrc) &&
    /Please upload the CSV again/.test(builderSrc),
)
check(
  "T9 small-dataset local path preserved (no fetch)",
  /transformChartData\(dataset, config\)/.test(builderSrc) &&
    /serverBacked \? null : transformChartData/.test(builderSrc),
)
check(
  "T10 chart fetches one bounded aggregation (never full rows)",
  /queryChartData\(activeDatasetId,/.test(builderSrc) &&
    !/getDatasetRows\(.*chart|fetchAllPages|for\s*\(.*totalPages.*fetch/i.test(builderSrc),
)
check(
  "T11 bounded frontend cache keyed by full request identity",
  /getCachedChart\(requestKey\)/.test(builderSrc) &&
    /setCachedChart\(activeKey/.test(builderSrc) &&
    /CHART_CACHE_LIMIT/.test(chartSourceSrc),
)
check(
  "T12 no global loader in the chart path",
  !/import.*Tetris|<Tetris|TetrisLoader|AnalysisTetris|AnalysisProgress/.test(builderSrc),
)
check(
  "T13 placeholder passes filters + original dataset to the builder",
  /<ChartBuilder[\s\S]*filters=\{filters\}/.test(placeholderSrc) &&
    /sourceDataset=\{dataset\}/.test(placeholderSrc),
)
check(
  "T14 server caption claims full-dataset scope",
  /aggregated server-side from the/.test(placeholderSrc) &&
    /describeServerPrepared/.test(builderSrc),
)
check(
  "T15 empty filtered charts keep Clear-filters recovery",
  /No rows match the current filters/.test(chartSourceSrc) &&
    /action=\{noRows \? emptyAction : null\}/.test(builderSrc),
)
check(
  "T16 validation errors stay friendly (no raw backend bodies)",
  /Could not build this chart/.test(builderSrc) &&
    /Could not load the chart/.test(builderSrc),
)
check(
  "T17 Bklit views preserved (no library swap)",
  /BarChartView/.test(builderSrc) &&
    /LineChartView/.test(builderSrc) &&
    /AreaChartView/.test(builderSrc) &&
    /PieChartView/.test(builderSrc) &&
    /ScatterChartView/.test(builderSrc) &&
    !/recharts|chart\.js/i.test(builderSrc),
)
check(
  "T18 chart API posts JSON without a new HTTP library",
  /\/chart/.test(chartApiSrc) &&
    !/from ["']axios["']|from ["']ky["']/.test(chartApiSrc),
)
check(
  "T19 local datasets never hit the chart endpoint",
  /serverBacked && chartRequest/.test(builderSrc) &&
    /serverBacked \? buildChartRequest/.test(builderSrc),
)
check(
  "T20 retry refetches without touching unrelated state",
  /handleRetry/.test(builderSrc) && /setRetryNonce/.test(builderSrc),
)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exitCode = 1
