/**
 * Bar x-axis label policy (Phase J).
 *
 * Pure, dependency-free helpers that decide how many category labels a
 * vertical bar chart shows. The vendored Bklit `BarXAxis` (`src/components/charts/bar-x-axis.jsx`,
 * installed via `shadcn add`) already supports `showAllLabels` / `maxLabels`;
 * this module is the Metrivia-side policy that drives those props so:
 *
 * - 1-20 categories: show ALL labels on desktop when readable.
 * - Narrow (mobile) widths: intentionally decimate to a readable subset
 *   instead of overlapping; the full category stays available in the Bklit
 *   tooltip, the hover date-ticker pill, and each label's `title`/`aria-label`.
 * - 25+ categories (synthetic; real transforms cap at MAX_CHART_CATEGORIES=20):
 *   decimate even on desktop.
 *
 * No DOM, no React — importable directly from node test scripts.
 */

export const BAR_ALL_LABELS_MAX = 20
export const BAR_DEFAULT_MAX_LABELS = 12
export const BAR_MOBILE_BREAKPOINT = 560
export const BAR_MOBILE_MAX_LABELS = 8
export const BAR_MIN_MOBILE_LABELS = 5
export const BAR_MAX_LABEL_CHARS = 16

/**
 * Visible display string for a category label. The full value is never
 * altered upstream — callers must keep the original in `title`/`aria-label`
 * and in the tooltip.
 */
export function truncateBarLabel(label, maxChars = BAR_MAX_LABEL_CHARS) {
  const text = String(label ?? "")
  const limit = Number.isFinite(maxChars) && maxChars > 1 ? Math.floor(maxChars) : BAR_MAX_LABEL_CHARS
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 1)}…`
}

/** How many labels the current Bklit decimation would render. */
export function getVisibleBarLabelCount({ count, showAllLabels, maxLabels }) {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  if (n === 0) return 0
  const max = Math.max(1, Math.floor(Number(maxLabels) || BAR_DEFAULT_MAX_LABELS))
  if (showAllLabels || n <= max) return n
  const step = Math.ceil(n / max)
  return Math.ceil(n / step)
}

/**
 * Resolve the effective Bklit props for a given category count + layout width.
 *
 * - innerWidth: chart inner width in px (width - margins). When null/unknown
 *   (SSR, first frame) we assume desktop so the 20-category desktop case
 *   shows all labels.
 */
export function resolveBarLabelProps({ count, innerWidth = null } = {}) {
  const n = Math.max(0, Math.floor(Number(count) || 0))

  if (n === 0) {
    return { showAllLabels: true, maxLabels: BAR_ALL_LABELS_MAX, mode: "empty" }
  }

  // Synthetic overflow: real pipelines cap at 20 via MAX_CHART_CATEGORIES.
  if (n > BAR_ALL_LABELS_MAX) {
    if (innerWidth != null && innerWidth < BAR_MOBILE_BREAKPOINT) {
      return {
        showAllLabels: false,
        maxLabels: BAR_MOBILE_MAX_LABELS,
        mode: "decimated-overflow-mobile",
      }
    }
    return {
      showAllLabels: false,
      maxLabels: BAR_DEFAULT_MAX_LABELS,
      mode: "decimated-overflow",
    }
  }

  // 1-20 categories on desktop (or unknown width): show all.
  if (innerWidth == null || innerWidth >= BAR_MOBILE_BREAKPOINT) {
    return { showAllLabels: true, maxLabels: BAR_ALL_LABELS_MAX, mode: "all" }
  }

  // Narrow mobile: intentional decimation. Scale the cap modestly with width
  // so 430px shows slightly more than 390px, clamped to a readable range.
  const scaled = Math.floor(innerWidth / 48)
  const mobileMax = Math.min(
    BAR_MOBILE_MAX_LABELS,
    Math.max(BAR_MIN_MOBILE_LABELS, Number.isFinite(scaled) ? scaled : BAR_MOBILE_MAX_LABELS),
  )
  if (n <= mobileMax) {
    return { showAllLabels: true, maxLabels: BAR_ALL_LABELS_MAX, mode: "all-mobile" }
  }
  return { showAllLabels: false, maxLabels: mobileMax, mode: "decimated-mobile" }
}

/**
 * Per-label CSS width budget that prevents severe overlap: each label is
 * clipped to its own column (minus a small gutter). Callers apply it as
 * `maxWidth` with ellipsis; the full category stays in `title` + tooltip.
 */
export function getBarLabelMaxWidth({ innerWidth, count }) {
  const n = Math.max(1, Math.floor(Number(count) || 1))
  const w = Number(innerWidth)
  if (!Number.isFinite(w) || w <= 0) return null
  const column = w / n
  return Math.max(24, Math.floor(column - 8))
}
