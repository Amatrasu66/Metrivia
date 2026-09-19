import { pie as d3Pie } from "d3-shape"

/**
 * Pure pie-tooltip positioning for PieChartView (Phase I).
 *
 * The chart library (Bklit pie over d3-shape) exposes no cursor-anchored
 * tooltip and no hover coordinates — only a controlled hoveredIndex. So the
 * tooltip is anchored from the slice's own sector geometry, recomputed here
 * with the exact same layout the chart uses:
 *   d3.pie().value((d) => d.value).sort(null)
 *   startAngle = -PI/2, endAngle = 3*PI/2, padAngle = 0
 * (the PieChart defaults; PieChartView passes none of these explicitly).
 *
 * Coordinate system (verified against getSliceOffset in pie-slice.jsx and
 * d3-shape: angle 0 is at 12 o'clock, increasing clockwise, y growing
 * downward):
 *   x = cx + R * sin(mid),  y = cy - R * cos(mid)
 *
 * The chart container is square, so positions are expressed as percentages
 * of the container and stay correct at any rendered size (desktop/mobile).
 * No DOM, no React — safe to unit-test in node.
 */

// Must mirror the PieChart prop defaults exactly. If those defaults ever
// change, the tooltip anchor drifts from the slice — the pie:test script
// pins the cardinal-direction expectations that catch such a drift.
export const PIE_START_ANGLE = -Math.PI / 2
export const PIE_END_ANGLE = (3 * Math.PI) / 2
export const PIE_PAD_ANGLE = 0

// Anchor radius as a fraction of the half-size: inside the slice toward
// its outer third (the slice itself extends to ~0.93 after the chart's
// hover-offset padding on typical sizes).
export const TOOLTIP_RADIUS_FRACTION = 0.68

// Tooltip centers are clamped to this percentage box so the (translated)
// box stays inside the chart/card at any width. The box is centered on the
// anchor with translate(-50%, -50%) and capped at max-w-[12rem], so a
// 15–85 center range keeps it inside without page overflow.
export const TOOLTIP_MIN_PCT = 15
export const TOOLTIP_MAX_PCT = 85

function layoutArcs(values) {
  return d3Pie()
    .value((d) => d)
    .sort(null)
    .startAngle(PIE_START_ANGLE)
    .endAngle(PIE_END_ANGLE)
    .padAngle(PIE_PAD_ANGLE)(values)
}

/**
 * Anchor (percentages of the square chart container) for the slice at
 * `index` in `data` ([{ label, value }], same array/order handed to
 * PieChart). Returns null for empty data or an out-of-range index.
 */
export function pieSliceAnchor(data, index, radiusFraction = TOOLTIP_RADIUS_FRACTION) {
  if (!Array.isArray(data) || data.length === 0) return null
  if (!Number.isInteger(index) || index < 0 || index >= data.length) {
    return null
  }
  const values = data.map((d) =>
    typeof d?.value === "number" && Number.isFinite(d.value) ? d.value : 0,
  )
  const arcs = layoutArcs(values)
  const arc = arcs[index]
  if (!arc) return null
  const mid = (arc.startAngle + arc.endAngle) / 2
  return {
    xPct: 50 + Math.sin(mid) * 50 * radiusFraction,
    yPct: 50 - Math.cos(mid) * 50 * radiusFraction,
  }
}

/** Clamp an anchor so the centered tooltip box stays inside the chart. */
export function clampTooltipAnchor(pos) {
  if (pos == null) return null
  const clamp = (v) => Math.min(TOOLTIP_MAX_PCT, Math.max(TOOLTIP_MIN_PCT, v))
  return { xPct: clamp(pos.xPct), yPct: clamp(pos.yPct) }
}

/**
 * Share of `value` in `total` as "12.3%", or null when not reliably
 * calculable. (Moved here from PieChartView so tooltip content is
 * unit-testable; behavior unchanged.)
 */
export function formatShare(value, total) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    return null
  }
  return `${((value / total) * 100).toFixed(1)}%`
}
