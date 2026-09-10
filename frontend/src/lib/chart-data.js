/**
 * Generic chart-data layer for the Metrivia chart builder.
 *
 * Data flows one way:
 *   dataset (/api/upload payload)
 *     → chart configuration { chartType, dimension, measure, aggregation }
 *     → generic transformation (this module)
 *     → chart-specific rendering component
 *     → Bklit
 *
 * Rendering components receive already-prepared data in a fixed shape and
 * stay dumb. All validation, grouping, aggregation, shaping, and
 * missing/null handling live here. Nothing here crashes on unsuitable
 * datasets — problems are reported as { status: "empty", ... } results.
 *
 * No hardcoded chart data: everything originates from the dataset.
 */

export const MAX_CHART_CATEGORIES = 20

export const CHART_TYPES = [
  { id: "bar", label: "Bar" },
  { id: "line", label: "Line" },
  { id: "area", label: "Area" },
  { id: "pie", label: "Pie" },
  { id: "scatter", label: "Scatter" },
]

export const AGGREGATIONS = [
  { id: "sum", label: "Sum" },
  { id: "average", label: "Average" },
  { id: "min", label: "Min" },
  { id: "max", label: "Max" },
  { id: "count", label: "Count" },
]

export const BLANK_LABEL = "(blank)"

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function uniqueCount(dataset, column) {
  const value = Number(dataset?.unique?.[column])
  return Number.isFinite(value) ? value : null
}

function isIdentifierColumn(column) {
  return (
    /^id$/i.test(column) || /[_-]id$/i.test(column) || /[a-z]Id$/.test(column)
  )
}

function columnsOfKind(dataset, kinds) {
  const columns = Array.isArray(dataset?.columns) ? dataset.columns : []
  const dtypes = dataset?.dtypes ?? {}
  return columns.filter((col) => kinds.includes(dtypes[col]))
}

/** Finite number or null. Accepts numeric strings; rejects null/blank/NaN. */
function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function labelFor(value) {
  return value === null || value === undefined || value === ""
    ? BLANK_LABEL
    : String(value)
}

function aggregationLabel(id) {
  return AGGREGATIONS.find((a) => a.id === id)?.label ?? id
}

// ---------------------------------------------------------------------------
// Field selection
// ---------------------------------------------------------------------------

/** Categorical/boolean columns usable as a grouped dimension for bar & pie. */
function groupedDimensionCandidates(dataset) {
  return columnsOfKind(dataset, ["categorical", "boolean"]).filter((col) => {
    const count = uniqueCount(dataset, col)
    return count === null || count > 1
  })
}

/** First suitable grouped dimension (legacy bar default semantics). */
function firstSuitableGroupedDimension(dataset) {
  const candidates = columnsOfKind(dataset, ["categorical"]).filter((col) => {
    const count = uniqueCount(dataset, col)
    return count === null || (count > 1 && count <= 50)
  })
  return (
    candidates[0] ??
    columnsOfKind(dataset, ["categorical"]).find(
      (col) => (uniqueCount(dataset, col) ?? 0) > 1,
    ) ??
    null
  )
}

/** Datetime columns usable as an X axis for line, area, and scatter. */
function datetimeCandidates(dataset) {
  return columnsOfKind(dataset, ["datetime"]).filter((col) => {
    const count = uniqueCount(dataset, col)
    return count === null || count > 1
  })
}

/**
 * Dimension options for a chart type, as { value, label, kind }.
 * - bar/pie: categorical + boolean dimensions (band-friendly groups).
 * - line/area/scatter: datetime dimensions (installed Bklit line, area, and
 *   scatter components render on a time scale).
 */
export function getDimensionOptions(dataset, chartType) {
  const dtypes = dataset?.dtypes ?? {}
  const withMeta = (cols) =>
    cols.map((col) => {
      const count = uniqueCount(dataset, col)
      return {
        value: col,
        label: count === null ? col : `${col} · ${count} values`,
        kind: dtypes[col] ?? "unknown",
      }
    })
  if (chartType === "line" || chartType === "area" || chartType === "scatter") {
    return withMeta(datetimeCandidates(dataset))
  }
  return withMeta(groupedDimensionCandidates(dataset))
}

/**
 * Genuinely numeric measure options, skipping obvious ID-like columns
 * (summing IDs is meaningless). Falls back to every numeric column when
 * that is all the dataset has.
 */
export function getMeasureOptions(dataset) {
  const numeric = columnsOfKind(dataset, ["numeric"])
  const nonId = numeric.filter((col) => !isIdentifierColumn(col))
  const pool = nonId.length > 0 ? nonId : numeric
  return pool.map((col) => ({ value: col, label: col }))
}

// ---------------------------------------------------------------------------
// Configuration: defaults, coercion, validation
// ---------------------------------------------------------------------------

/**
 * Sensible initial configuration: bar + first suitable dimension +
 * first suitable numeric measure + Sum. Mirrors the legacy automatic bar
 * chart, so an uploaded sample CSV shows a useful chart immediately.
 */
export function defaultChartConfig(dataset) {
  const dimension =
    firstSuitableGroupedDimension(dataset) ??
    groupedDimensionCandidates(dataset)[0] ??
    null
  const measures = getMeasureOptions(dataset)
  return {
    chartType: "bar",
    dimension,
    measure: measures[0]?.value ?? null,
    aggregation: "sum",
  }
}

/**
 * Keep the user's dimension/measure when still valid for the new chart
 * type, otherwise fall back to that type's defaults. Aggregation is
 * preserved verbatim (scatter simply ignores it).
 */
export function coerceConfigForType(dataset, config, chartType) {
  const dims = getDimensionOptions(dataset, chartType)
  const measures = getMeasureOptions(dataset)
  const fallback = defaultChartConfig(dataset)
  return {
    chartType,
    dimension: dims.some((d) => d.value === config?.dimension)
      ? config.dimension
      : (dims[0]?.value ?? fallback.dimension),
    measure: measures.some((m) => m.value === config?.measure)
      ? config.measure
      : (measures[0]?.value ?? null),
    aggregation: AGGREGATIONS.some((a) => a.id === config?.aggregation)
      ? config.aggregation
      : "sum",
  }
}

/**
 * Validate a configuration against the dataset. Never throws; unsuitable
 * combinations come back as { ok: false, title, message } so the UI can
 * show an instructional empty state instead of crashing.
 */
export function validateChartConfig(dataset, config) {
  const columns = Array.isArray(dataset?.columns) ? dataset.columns : []
  if (columns.length === 0) {
    return {
      ok: false,
      title: "No dataset to chart",
      message: "Upload a CSV file to configure a chart.",
    }
  }
  const chartType = config?.chartType
  if (!CHART_TYPES.some((t) => t.id === chartType)) {
    return {
      ok: false,
      title: "Unknown chart type",
      message: "Pick Bar, Line, Area, Pie, or Scatter.",
    }
  }
  const rows = Array.isArray(dataset?.preview) ? dataset.preview : []
  if (rows.length === 0) {
    return {
      ok: false,
      title: "No rows to chart",
      message: "The uploaded dataset contains no preview rows.",
    }
  }

  if (chartType === "scatter") {
    if (!getDimensionOptions(dataset, "scatter").some((d) => d.value === config?.dimension)) {
      return {
        ok: false,
        title: "Scatter needs a datetime X axis",
        message:
          "In this version scatter plots show row-level observations against a datetime X axis. Upload a CSV with a datetime column to use Scatter.",
      }
    }
    if (!getMeasureOptions(dataset).some((m) => m.value === config?.measure)) {
      return {
        ok: false,
        title: "Scatter needs a numeric Y axis",
        message:
          "Pick a numeric column for the Y axis to plot individual observations.",
      }
    }
    return { ok: true }
  }

  const needsMeasure = config?.aggregation !== "count"
  if (!getDimensionOptions(dataset, chartType).some((d) => d.value === config?.dimension)) {
    const need =
      chartType === "pie"
        ? "a categorical dimension"
        : chartType === "bar"
          ? "a categorical dimension"
          : "a datetime dimension"
    return {
      ok: false,
      title: `This ${chartType} chart needs ${need}`,
      message: `Upload a CSV containing ${need} to use this chart type, or pick another type above.`,
    }
  }
  if (needsMeasure && !getMeasureOptions(dataset).some((m) => m.value === config?.measure)) {
    return {
      ok: false,
      title: "A numeric measure is required",
      message:
        "This aggregation needs a numeric column. Upload a CSV with numeric data, switch to Count, or pick another chart type.",
    }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Transformation
// ---------------------------------------------------------------------------

function applyAggregation(values, aggregation) {
  if (aggregation === "min") return Math.min(...values)
  if (aggregation === "max") return Math.max(...values)
  if (aggregation === "average") {
    return values.reduce((sum, v) => sum + v, 0) / values.length
  }
  return values.reduce((sum, v) => sum + v, 0)
}

/**
 * Group preview rows by dimension label. Each group keeps its valid numeric
 * values (missing/non-numeric entries are skipped) and its row count for
 * the Count aggregation.
 */
function groupRows(rows, dimension, measure) {
  const groups = new Map()
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue
    const label = labelFor(row[dimension])
    let group = groups.get(label)
    if (!group) {
      group = { label, values: [], count: 0 }
      groups.set(label, group)
    }
    group.count += 1
    const num = toFiniteNumber(row[measure])
    if (num !== null) group.values.push(num)
  }
  return [...groups.values()]
}

/**
 * Transform a dataset + configuration into render-ready data.
 *
 * Returns either:
 *   { status: "ok", kind, data, dimension, measure, aggregation,
 *     totalGroups, shownGroups }
 *   { status: "empty", title, message }
 *
 * Shapes by kind:
 *   bar/line/area/pie → data: [{ label, value }]
 *   scatter           → data: [{ x, y }] (raw row-level observations)
 */
export function transformChartData(dataset, config) {
  const validity = validateChartConfig(dataset, config)
  if (!validity.ok) {
    return { status: "empty", title: validity.title, message: validity.message }
  }

  const { chartType, dimension, measure, aggregation } = config
  const rows = dataset.preview
  const dtypes = dataset?.dtypes ?? {}

  if (chartType === "scatter") {
    const points = []
    for (const row of rows) {
      if (row === null || typeof row !== "object") continue
      const rawX = row[dimension]
      if (rawX === null || rawX === undefined || rawX === "") continue
      const time = new Date(rawX).getTime()
      const y = toFiniteNumber(row[measure])
      if (!Number.isFinite(time) || y === null) continue
      points.push({ x: String(rawX), y })
    }
    points.sort((a, b) => new Date(a.x).getTime() - new Date(b.x).getTime())
    if (points.length === 0) {
      return {
        status: "empty",
        title: "No plottable points",
        message:
          "None of the preview rows have both a valid datetime and a numeric value for the selected fields.",
      }
    }
    return {
      status: "ok",
      kind: "scatter",
      data: points,
      dimension,
      measure,
      aggregation: null,
      totalGroups: points.length,
      shownGroups: points.length,
    }
  }

  // Grouped charts: bar, line, area, pie.
  const groups = groupRows(rows, dimension, measure)
  let shaped = []
  for (const group of groups) {
    if (aggregation === "count") {
      shaped.push({ label: group.label, value: group.count })
    } else if (aggregation === "sum") {
      // Sum of nothing is 0 (missing values contribute 0), so every group
      // appears — identical to the original automatic bar chart.
      shaped.push({
        label: group.label,
        value: applyAggregation(group.values, aggregation),
      })
    } else if (group.values.length > 0) {
      shaped.push({
        label: group.label,
        value: applyAggregation(group.values, aggregation),
      })
    }
    // Average/Min/Max of no valid values is undefined, so such groups are
    // omitted; Count never hits this branch.
  }

  if (chartType === "pie") {
    // Arcs cannot represent zero/negative values.
    shaped = shaped.filter((d) => d.value > 0)
    if (shaped.length === 0) {
      return {
        status: "empty",
        title: "Nothing positive to show",
        message:
          "Pie slices need positive values. The selected fields produced none — try another measure or aggregation.",
      }
    }
  } else if (shaped.length === 0) {
    return {
      status: "empty",
      title: "No values to aggregate",
      message:
        "None of the groups have valid numeric values for the selected measure. Try another measure or aggregation.",
    }
  }

  const isDatetime = dtypes[dimension] === "datetime"
  shaped.sort((a, b) => {
    if (a.label === BLANK_LABEL) return 1
    if (b.label === BLANK_LABEL) return -1
    // Chronological order for datetime dimensions (ISO labels sort
    // lexicographically); value order otherwise.
    return isDatetime
      ? (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)
      : b.value - a.value
  })

  const totalGroups = shaped.length
  const shown = shaped.slice(0, MAX_CHART_CATEGORIES)

  return {
    status: "ok",
    kind: chartType,
    data: shown,
    dimension,
    measure: aggregation === "count" ? null : measure,
    aggregation,
    totalGroups,
    shownGroups: shown.length,
  }
}

/** Human caption for a successful transform (used under the chart). */
export function describePrepared(prepared) {
  if (prepared?.status !== "ok") return ""
  if (prepared.kind === "scatter") {
    return (
      `${prepared.totalGroups} observations · ` +
      `${prepared.measure} over ${prepared.dimension} (no aggregation).`
    )
  }
  const agg = aggregationLabel(prepared.aggregation)
  const noun = prepared.kind === "pie" ? "slices" : "groups"
  const scope =
    prepared.totalGroups > prepared.shownGroups
      ? `top ${prepared.shownGroups} of ${prepared.totalGroups} ${noun}`
      : `${prepared.totalGroups} ${noun}`
  const what =
    prepared.aggregation === "count"
      ? `Record count by ${prepared.dimension}`
      : `${agg} of ${prepared.measure} by ${prepared.dimension}`
  return `${what} · ${scope} from the uploaded preview.`
}

// ---------------------------------------------------------------------------
// Legacy exports (preserve the original automatic bar chart behavior)
// ---------------------------------------------------------------------------

/**
 * Pick the default X/Y fields: the first suitable categorical column and
 * the first suitable numeric column. (Original milestone-4 semantics.)
 */
export function selectBarChartFields(dataset) {
  const dimension = firstSuitableGroupedDimension(dataset)
  const measures = getMeasureOptions(dataset)
  return {
    categoryKey: dimension,
    numericKey: measures[0]?.value ?? null,
  }
}

/**
 * Aggregate preview rows by category with a Sum of the numeric field.
 * Missing/non-numeric values contribute 0. Output is sorted by sum
 * descending and capped so the chart stays readable on small screens.
 * (Original milestone-4 implementation, kept verbatim.)
 */
export function aggregateSumByCategory(rows, categoryKey, numericKey) {
  if (!Array.isArray(rows) || !categoryKey || !numericKey) return []

  const totals = new Map()
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue
    const rawCategory = row[categoryKey]
    const label =
      rawCategory === null || rawCategory === undefined || rawCategory === ""
        ? "(blank)"
        : String(rawCategory)
    const value = Number(row[numericKey])
    totals.set(label, (totals.get(label) ?? 0) + (Number.isFinite(value) ? value : 0))
  }

  return [...totals.entries()]
    .map(([label, sum]) => ({ [categoryKey]: label, [numericKey]: sum }))
    .sort((a, b) => b[numericKey] - a[numericKey])
    .slice(0, MAX_CHART_CATEGORIES)
}
