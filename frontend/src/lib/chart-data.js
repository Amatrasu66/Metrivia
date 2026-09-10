/**
 * Pure data helpers for the dataset bar chart.
 *
 * Input is the real analysis payload from POST /api/upload
 * (see src/lib/api.js). No hardcoded chart data lives here.
 */

export const MAX_CHART_CATEGORIES = 20

function uniqueCount(dataset, column) {
  const value = Number(dataset?.unique?.[column])
  return Number.isFinite(value) ? value : null
}

/**
 * Pick the default X/Y fields: the first suitable categorical column and
 * the first suitable numeric column. A categorical column is "suitable"
 * when it has more than one distinct value and a plottable cardinality.
 * Identifier columns (id, user_id, …) are skipped for the numeric default
 * because summing IDs is meaningless — unless nothing else exists.
 * Returns { categoryKey, numericKey } with nulls when no pair exists.
 */
export function selectBarChartFields(dataset) {
  const columns = Array.isArray(dataset?.columns) ? dataset.columns : []
  const dtypes = dataset?.dtypes ?? {}

  const categorical = columns.filter((col) => dtypes[col] === "categorical")
  const numeric = columns.filter((col) => dtypes[col] === "numeric")

  const suitable =
    categorical.find((col) => {
      const count = uniqueCount(dataset, col)
      return count === null || (count > 1 && count <= 50)
    }) ?? categorical.find((col) => (uniqueCount(dataset, col) ?? 0) > 1)

  const nonId = numeric.filter((col) => !isIdentifierColumn(col))

  return {
    categoryKey: suitable ?? null,
    numericKey: nonId[0] ?? numeric[0] ?? null,
  }
}

function isIdentifierColumn(column) {
  return (
    /^id$/i.test(column) || /[_-]id$/i.test(column) || /[a-z]Id$/.test(column)
  )
}

/**
 * Aggregate preview rows by category with a Sum of the numeric field.
 * Missing/non-numeric values contribute 0. Output is sorted by sum
 * descending and capped so the chart stays readable on small screens.
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
