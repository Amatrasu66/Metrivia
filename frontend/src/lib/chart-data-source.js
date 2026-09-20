/**
 * Metrivia Phase M4 — server-side chart data source (pure, no DOM/fetch).
 *
 * Large server-backed datasets must aggregate charts in Flask
 * (POST /api/datasets/<id>/chart) instead of grouping 50k rows in React.
 * Small/local datasets keep the existing client-side `transformChartData`
 * path untouched.
 *
 * Responsibilities here (all unit-testable in node):
 *   - branch decision (`shouldUseServerChart`, same detection as tables)
 *   - request construction (`buildChartRequest`: chart config + the
 *     canonical `toServerFilters()` output — one filter language, M3 reused)
 *   - deterministic request identity (`buildChartRequestKey`: dataset id +
 *     chart type + dimension + measure + aggregation + limit + sort + date
 *     grouping + filter identity, so stale responses are detectable)
 *   - response adaptation (`adaptServerChartToPrepared`: bounded server
 *     payload → the exact `prepared` shape `transformChartData` returns, so
 *     the existing Bklit chart views render unchanged)
 *   - a small bounded frontend cache (max 20 entries, LRU-evicted).
 *
 * No DOM, no fetch, no `@/` imports — safe to unit-test in node.
 */

import { MAX_CHART_CATEGORIES } from "./chart-data.js"
import {
  getDatasetId,
  isServerBackedDataset,
} from "./dataset-source.js"
import { buildServerFilterKey } from "./filter-data.js"

/** Grouped charts return at most this many groups (mirrors the UI cap). */
export const SERVER_CHART_LIMIT = MAX_CHART_CATEGORIES

/** Scatter returns at most this many points (mirrors the backend cap). */
export const SERVER_SCATTER_LIMIT = 2000

/** Maximum cached chart results per session (bounded memory). */
export const CHART_CACHE_LIMIT = 20

const GROUPED_TYPES = new Set(["bar", "line", "area", "pie"])

/**
 * Centralized Phase M4 branch decision: small/full-preview datasets keep
 * the existing client-side transform; large/server-backed datasets must
 * use server-side aggregation. Same detection as tables/filters.
 */
export function shouldUseServerChart(dataset) {
  return isServerBackedDataset(dataset)
}

/**
 * Build the POST /api/datasets/<id>/chart body from a chart config plus
 * the canonical structured server filters. Returns a new object; inputs
 * are never mutated. `measure` is null for Count (no measure needed);
 * scatter omits `aggregation` (the backend ignores it — observations only).
 */
export function buildChartRequest(config, serverFilters) {
  const chartType = config?.chartType
  const filters = Array.isArray(serverFilters) ? serverFilters : []
  const isCount =
    config?.aggregation === "count" && chartType !== "scatter"
  const request = {
    chart_type: chartType,
    dimension: config?.dimension ?? null,
    measure: isCount ? null : (config?.measure ?? null),
    filters: filters.map((f) => ({ ...f })),
  }
  if (chartType !== "scatter") {
    request.aggregation = config?.aggregation ?? "sum"
    request.limit = SERVER_CHART_LIMIT
  } else {
    request.limit = SERVER_SCATTER_LIMIT
  }
  return request
}

/**
 * Deterministic key for a chart request (cache identity + stale-response
 * comparison). Covers dataset id, chart type, dimension, measure,
 * aggregation, limit, sort, date grouping, and the order-independent
 * filter identity. Changing any of these yields a different key.
 */
export function buildChartRequestKey(datasetId, request) {
  const normalized = {
    datasetId: datasetId ?? "",
    chart_type: request?.chart_type ?? null,
    dimension: request?.dimension ?? null,
    measure: request?.measure ?? null,
    aggregation: request?.aggregation ?? null,
    limit: request?.limit ?? null,
    sort: request?.sort ?? null,
    date_granularity: request?.date_granularity ?? null,
    filters: buildServerFilterKey(request?.filters),
  }
  return JSON.stringify(normalized)
}

/** True when a chart request actually carries a chartable configuration. */
export function isChartRequestComplete(request) {
  if (request === null || typeof request !== "object") return false
  if (typeof request.chart_type !== "string" || request.chart_type === "") {
    return false
  }
  if (typeof request.dimension !== "string" || request.dimension === "") {
    return false
  }
  if (request.chart_type === "scatter") {
    return typeof request.measure === "string" && request.measure !== ""
  }
  if (request.aggregation === "count") return true
  return typeof request.measure === "string" && request.measure !== ""
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
}

/**
 * Adapt a bounded server chart payload to the local `prepared` shape:
 *   { status: "ok", kind, data, dimension, measure, aggregation,
 *     totalGroups, shownGroups, server: true, filteredRowCount, truncated }
 * or { status: "empty", title, message, server: true }.
 *
 * Grouped data stays [{ label, value }]; scatter stays [{ x, y }] — the
 * Bklit views receive identical shapes from either source. Invalid entries
 * are dropped; a fully-invalid payload becomes an empty result, never a
 * crash. `filteredRowCount` carries the authoritative M3-count semantics.
 */
export function adaptServerChartToPrepared(body, config) {
  const chartType = body?.chart_type ?? config?.chartType
  const data = body?.data
  const filteredRowCount = Number(body?.filtered_row_count)
  const safeFiltered = Number.isFinite(filteredRowCount)
    ? Math.floor(filteredRowCount)
    : null
  const totalGroups = Number(body?.total_groups)
  const shownGroups = Number(body?.shown_groups)

  if (!Array.isArray(data) || data.length === 0) {
    if (safeFiltered === 0) {
      return {
        status: "empty",
        server: true,
        title: "No rows match the current filters",
        message:
          "The active filters removed every row. Clear them to restore the full dataset — your chart configuration is kept.",
      }
    }
    if (chartType === "pie") {
      return {
        status: "empty",
        server: true,
        title: "Nothing positive to show",
        message:
          "Pie slices need positive values. The selected fields produced none — try another measure or aggregation.",
      }
    }
    if (chartType === "scatter") {
      return {
        status: "empty",
        server: true,
        title: "No plottable points",
        message:
          "None of the filtered rows have both a valid datetime and a numeric value for the selected fields.",
      }
    }
    return {
      status: "empty",
      server: true,
      title: "No values to aggregate",
      message:
        "None of the groups have valid numeric values for the selected measure. Try another measure or aggregation.",
    }
  }

  if (chartType === "scatter") {
    const points = []
    for (const item of data) {
      if (item === null || typeof item !== "object") continue
      const y = item.y
      const x = item.x
      if (!isFiniteNumber(y)) continue
      if (typeof x !== "string" || x === "") continue
      points.push({ x, y })
    }
    if (points.length === 0) {
      return {
        status: "empty",
        server: true,
        title: "No plottable points",
        message:
          "None of the filtered rows have both a valid datetime and a numeric value for the selected fields.",
      }
    }
    return {
      status: "ok",
      kind: "scatter",
      data: points,
      dimension: body?.dimension ?? config?.dimension ?? null,
      measure: body?.measure ?? config?.measure ?? null,
      aggregation: null,
      totalGroups: Number.isFinite(totalGroups)
        ? Math.floor(totalGroups)
        : points.length,
      shownGroups: Number.isFinite(shownGroups)
        ? Math.floor(shownGroups)
        : points.length,
      server: true,
      filteredRowCount: safeFiltered,
      truncated: body?.truncated === true,
    }
  }

  const shaped = []
  for (const item of data) {
    if (item === null || typeof item !== "object") continue
    const label = typeof item.label === "string" ? item.label : null
    if (label === null) continue
    if (!isFiniteNumber(item.value)) continue
    shaped.push({ label, value: item.value })
  }
  if (shaped.length === 0) {
    if (chartType === "pie") {
      return {
        status: "empty",
        server: true,
        title: "Nothing positive to show",
        message:
          "Pie slices need positive values. The selected fields produced none — try another measure or aggregation.",
      }
    }
    return {
      status: "empty",
      server: true,
      title: "No values to aggregate",
      message:
        "None of the groups have valid numeric values for the selected measure. Try another measure or aggregation.",
    }
  }
  const aggregation = body?.aggregation ?? config?.aggregation ?? null
  return {
    status: "ok",
    kind: chartType,
    data: shaped,
    dimension: body?.dimension ?? config?.dimension ?? null,
    measure: aggregation === "count"
      ? null
      : (body?.measure ?? config?.measure ?? null),
    aggregation,
    totalGroups: Number.isFinite(totalGroups)
      ? Math.floor(totalGroups)
      : shaped.length,
    shownGroups: Number.isFinite(shownGroups)
      ? Math.floor(shownGroups)
      : shaped.length,
    server: true,
    filteredRowCount: safeFiltered,
    truncated: body?.truncated === true,
  }
}

function aggregationNoun(kind) {
  return kind === "pie" ? "slices" : kind === "scatter" ? "observations" : "groups"
}

/** Human caption for a server-aggregated chart (full-dataset scope). */
export function describeServerPrepared(prepared) {
  if (prepared?.status !== "ok") return ""
  const count = (value) =>
    Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 })
  if (prepared.kind === "scatter") {
    const scope =
      prepared.filteredRowCount === null || prepared.filteredRowCount === undefined
        ? `${count(prepared.shownGroups)} ${aggregationNoun("scatter")}`
        : `${count(prepared.shownGroups)} of ${count(prepared.filteredRowCount)} filtered rows`
    const sampled = prepared.truncated ? " · sampled" : ""
    return (
      `${scope}${sampled} · ` +
      `${prepared.measure} over ${prepared.dimension} (no aggregation, server-aggregated).`
    )
  }
  const labels = { sum: "Sum", average: "Average", min: "Min", max: "Max", count: "Count" }
  const agg = labels[prepared.aggregation] ?? prepared.aggregation
  const noun = aggregationNoun(prepared.kind)
  const scope =
    prepared.totalGroups > prepared.shownGroups
      ? `top ${prepared.shownGroups} of ${prepared.totalGroups} ${noun}`
      : `${prepared.totalGroups} ${noun}`
  const what =
    prepared.aggregation === "count"
      ? `Record count by ${prepared.dimension}`
      : `${agg} of ${prepared.measure} by ${prepared.dimension}`
  const rows =
    prepared.filteredRowCount === null || prepared.filteredRowCount === undefined
      ? ""
      : ` · ${count(prepared.filteredRowCount)} filtered rows`
  return `${what} · ${scope} from the full dataset${rows}.`
}

// ---------------------------------------------------------------------------
// Small bounded frontend chart cache (optional, LRU-evicted)
// ---------------------------------------------------------------------------

const chartCache = new Map()

/** Read a cached prepared result by request key (null on miss). */
export function getCachedChart(key) {
  if (typeof key !== "string" || key === "") return null
  return chartCache.has(key) ? chartCache.get(key) : null
}

/** Store a prepared result under its request key (bounded, LRU). */
export function setCachedChart(key, prepared) {
  if (typeof key !== "string" || key === "") return
  if (chartCache.has(key)) chartCache.delete(key)
  chartCache.set(key, prepared)
  while (chartCache.size > CHART_CACHE_LIMIT) {
    const oldest = chartCache.keys().next()
    if (oldest.done) break
    chartCache.delete(oldest.value)
  }
}

/** Clear the chart cache (workspace/dataset switches, tests). */
export function clearChartCache() {
  chartCache.clear()
}

/** Re-export for call sites that only import this module. */
export { getDatasetId }
export { GROUPED_TYPES }
