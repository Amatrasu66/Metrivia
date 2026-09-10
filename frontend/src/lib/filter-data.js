/**
 * Pure filtering layer for the Metrivia dashboard.
 *
 * Flow: dataset (/api/upload payload, immutable)
 *   → filter state (plain object, created by defaultFilterState)
 *   → applyFilters → filtered rows (new array, original untouched)
 *   → buildFilteredDataset → derived dataset view for KPIs, preview, charts.
 *
 * Everything runs in React/JavaScript. Filter changes never touch Flask.
 * Components must use these helpers instead of implementing filtering
 * themselves. No DOM, no fetch, no `@/` imports — safe to unit-test in node.
 */

// Deterministic cap: first N suitable columns in dataset order. Keeps the
// UI compact even for wide datasets; extend by raising this number.
export const MAX_FILTER_FIELDS = 6

export const BLANK_LABEL = "(blank)"

function columnsOfKind(dataset, kinds) {
  const columns = Array.isArray(dataset?.columns) ? dataset.columns : []
  const dtypes = dataset?.dtypes ?? {}
  return columns.filter((col) => kinds.includes(dtypes[col]))
}

function uniqueCount(dataset, column) {
  const value = Number(dataset?.unique?.[column])
  return Number.isFinite(value) ? value : null
}

function isIdentifierColumn(column) {
  return (
    /^id$/i.test(column) || /[_-]id$/i.test(column) || /[a-z]Id$/.test(column)
  )
}

/** Display label for a raw cell value (missing → "(blank)"). */
function valueLabel(value) {
  return value === null || value === undefined || value === ""
    ? BLANK_LABEL
    : String(value)
}

/**
 * Distinct values of a column across the given rows, sorted
 * deterministically (alphabetical, blanks last).
 */
function distinctLabels(rows, column) {
  const seen = new Set()
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue
    seen.add(valueLabel(row[column]))
  }
  return [...seen].sort((a, b) => {
    if (a === BLANK_LABEL) return 1
    if (b === BLANK_LABEL) return -1
    return a.localeCompare(b)
  })
}

/**
 * Columns eligible for filtering, in dataset order, capped
 * deterministically at MAX_FILTER_FIELDS. Each entry:
 * { column, kind: 'categorical' | 'datetime' | 'numeric', values? }
 * (`values` only for categorical kinds, derived from preview rows.)
 */
export function getFilterFields(dataset) {
  const rows = Array.isArray(dataset?.preview) ? dataset.preview : []
  const fields = []
  const push = (column, kind, extra = {}) => {
    if (fields.length < MAX_FILTER_FIELDS) {
      fields.push({ column, kind, ...extra })
    }
  }

  for (const column of columnsOfKind(dataset, ["categorical", "boolean"])) {
    const count = uniqueCount(dataset, column)
    // Skip degenerate single-value columns and unbounded text-like ones.
    if (count !== null && (count <= 1 || count > 50)) continue
    push(column, "categorical", { values: distinctLabels(rows, column) })
  }
  for (const column of columnsOfKind(dataset, ["datetime"])) {
    push(column, "datetime")
  }
  const numeric = columnsOfKind(dataset, ["numeric"])
  const pool = numeric.some((col) => !isIdentifierColumn(col))
    ? numeric.filter((col) => !isIdentifierColumn(col))
    : numeric
  for (const column of pool) {
    push(column, "numeric")
  }
  return fields
}

/**
 * Default (inactive) filter state for a dataset:
 * { categorical: { col: [] }, datetime: { col: { from: "", to: "" } },
 *   numeric: { col: { min: "", max: "" } } }
 * Empty selections/bounds mean "no restriction".
 */
export function defaultFilterState(dataset) {
  const state = { categorical: {}, datetime: {}, numeric: {} }
  for (const field of getFilterFields(dataset)) {
    if (field.kind === "categorical") state.categorical[field.column] = []
    else if (field.kind === "datetime") {
      state.datetime[field.column] = { from: "", to: "" }
    } else {
      state.numeric[field.column] = { min: "", max: "" }
    }
  }
  return state
}

/** Normalize a serialized datetime cell to "YYYY-MM-DD", or null. */
function toDayString(value) {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (match) return `${match[1]}-${match[2]}-${match[3]}`
  }
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return null
  const d = new Date(time)
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function parseBound(value) {
  if (value === null || value === undefined || value === "") return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function matchesCategorical(row, column, selected) {
  if (!Array.isArray(selected) || selected.length === 0) return true
  return selected.includes(valueLabel(row[column]))
}

function matchesDatetime(row, column, { from, to }) {
  const hasFrom = typeof from === "string" && from !== ""
  const hasTo = typeof to === "string" && to !== ""
  if (!hasFrom && !hasTo) return true
  const day = toDayString(row[column])
  if (day === null) return false
  if (hasFrom && day < from) return false
  if (hasTo && day > to) return false
  return true
}

function matchesNumeric(row, column, { min, max }) {
  const lo = parseBound(min)
  const hi = parseBound(max)
  if (lo === null && hi === null) return true
  const num = toFiniteNumber(row[column])
  if (num === null) return false
  if (lo !== null && num < lo) return false
  if (hi !== null && num > hi) return false
  return true
}

/**
 * Apply filter state to rows. AND across columns, OR within a categorical
 * column's selected values. Returns a NEW array; inputs are never mutated.
 */
export function applyFilters(rows, filters) {
  if (!Array.isArray(rows)) return []
  const categorical = filters?.categorical ?? {}
  const datetime = filters?.datetime ?? {}
  const numeric = filters?.numeric ?? {}
  return rows.filter((row) => {
    if (row === null || typeof row !== "object") return false
    for (const [column, selected] of Object.entries(categorical)) {
      if (!matchesCategorical(row, column, selected)) return false
    }
    for (const [column, bounds] of Object.entries(datetime)) {
      if (
        bounds !== null &&
        typeof bounds === "object" &&
        !matchesDatetime(row, column, bounds)
      ) {
        return false
      }
    }
    for (const [column, bounds] of Object.entries(numeric)) {
      if (
        bounds !== null &&
        typeof bounds === "object" &&
        !matchesNumeric(row, column, bounds)
      ) {
        return false
      }
    }
    return true
  })
}

/** True when at least one restriction is set. */
export function isFilterActive(filters) {
  return activeFilterCount(filters) > 0
}

/** Number of active restrictions (badge count + per-field dots). */
export function activeFilterCount(filters) {
  let count = 0
  for (const selected of Object.values(filters?.categorical ?? {})) {
    if (Array.isArray(selected) && selected.length > 0) count += 1
  }
  for (const bounds of Object.values(filters?.datetime ?? {})) {
    if (bounds !== null && typeof bounds === "object") {
      if (bounds.from !== "" || bounds.to !== "") count += 1
    }
  }
  for (const bounds of Object.values(filters?.numeric ?? {})) {
    if (bounds !== null && typeof bounds === "object") {
      if (parseBound(bounds.min) !== null || parseBound(bounds.max) !== null) {
        count += 1
      }
    }
  }
  return count
}

/** True when the given field currently restricts rows. */
export function isFieldActive(filters, field) {
  if (field.kind === "categorical") {
    const selected = filters?.categorical?.[field.column]
    return Array.isArray(selected) && selected.length > 0
  }
  if (field.kind === "datetime") {
    const bounds = filters?.datetime?.[field.column]
    return (
      bounds !== null &&
      typeof bounds === "object" &&
      (bounds.from !== "" || bounds.to !== "")
    )
  }
  const bounds = filters?.numeric?.[field.column]
  return (
    bounds !== null &&
    typeof bounds === "object" &&
    (parseBound(bounds.min) !== null || parseBound(bounds.max) !== null)
  )
}

/**
 * Derive a filtered dataset view for KPIs, preview, and ChartBuilder.
 * The original dataset object is never mutated. `row_count` keeps the
 * original total; `filtered_row_count` reports the filtered rows so the UI
 * can show "X of Y". Column metadata (columns, dtypes, missing, unique)
 * still describes the full uploaded dataset.
 */
export function buildFilteredDataset(dataset, filteredRows) {
  const rows = Array.isArray(filteredRows) ? filteredRows : []
  return {
    ...dataset,
    preview: rows,
    preview_count: rows.length,
    filtered_row_count: rows.length,
  }
}
