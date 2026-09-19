/**
 * Phase K scatter Y-domain helper (pure, no React — safe to unit-test in node).
 *
 * Mirrors the installed time-series shell (`time-series-chart-shell.jsx`
 * `resolveTimeSeriesYDomain`): non-negative data keeps `[0, top]`; data with
 * negatives gets `[min - padding, max + padding]` (5% span). The scatter
 * shell previously always returned `[0, top]`, which pushed negative
 * Profit Margin values below the plot.
 */

export function collectScatterNumericExtents(data, dataKeys) {
  let minValue = Number.POSITIVE_INFINITY
  let maxValue = Number.NEGATIVE_INFINITY

  for (const d of data) {
    for (const key of dataKeys) {
      const value = d?.[key]
      if (typeof value === "number" && Number.isFinite(value)) {
        if (value < minValue) minValue = value
        if (value > maxValue) maxValue = value
      }
    }
  }

  if (minValue === Number.POSITIVE_INFINITY) {
    return { minValue: 0, maxValue: 100 }
  }

  return { minValue, maxValue }
}

export function resolveScatterYDomain(data, dataKeys) {
  const { minValue, maxValue } = collectScatterNumericExtents(data, dataKeys)

  if (minValue >= 0) {
    const top = maxValue <= 0 ? 100 : maxValue * 1.1
    return [0, top]
  }

  const padding = (maxValue - minValue) * 0.05 || 1
  return [minValue - padding, maxValue + padding]
}

export default resolveScatterYDomain
