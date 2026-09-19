import { useCallback, useMemo, useState } from "react"
import { PieChart } from "@/components/charts/pie-chart"
import { PieSlice } from "@/components/charts/pie-slice"
import { formatCount } from "@/lib/format"
import {
  clampTooltipAnchor,
  formatShare,
  pieSliceAnchor,
} from "@/lib/pie-tooltip"
import { cn } from "@/lib/utils"

// Slice colors cycle var(--chart-1)…var(--chart-5) in the Bklit pie
// component, so the legend below reuses the same tokens to stay in sync.
// Only chart-1…chart-5 exist in every theme (verified in the registry —
// there is no extended categorical token set), and sequential cycling
// guarantees adjacent slices never share a color; repeats land five apart
// and are disambiguated by the interactive legend + tooltip below. The
// Monochrome theme intentionally reuses one gray five times, so the legend
// highlight below never relies on color alone.
function sliceColor(index) {
  return `var(--chart-${(index % 5) + 1})`
}

/**
 * Renders prepared [{ label, value }] data with an interactive HTML legend.
 *
 * Slices stay unlabeled by design. Hover/focus linking works both ways:
 * hovering a slice highlights its legend entry (and quiets the rest);
 * hovering or keyboard-focusing a legend entry emphasizes its slice. The
 * shared identity is the category label — groupRows() keys groups by label
 * so labels are unique within this data; array indexes are derived at the
 * PieChart boundary only and never stored.
 *
 * Hover state is local to this view (useState): the dashboard, workspace
 * store, and chart configuration never see it, so hovering never
 * re-renders anything above this component. No new animation is added —
 * slice emphasis (pop-out + sibling fade) is the chart library's existing
 * behavior and the legend highlight is class-only.
 */
export function PieChartView({ data }) {
  const rows = Array.isArray(data) ? data : []
  const [activeLabel, setActiveLabel] = useState(null)

  const total = useMemo(
    () =>
      rows.reduce(
        (sum, d) => sum + (typeof d.value === "number" ? d.value : 0),
        0,
      ),
    [rows],
  )
  const activeIndex = useMemo(
    () => rows.findIndex((d) => d.label === activeLabel),
    [rows, activeLabel],
  )
  const activeDatum = activeIndex >= 0 ? rows[activeIndex] : null
  const activeShare = activeDatum ? formatShare(activeDatum.value, total) : null
  // Dynamic tooltip anchor (Phase I): the chart library exposes no cursor
  // position — only the hovered index — so the anchor is recomputed from
  // the slice's sector geometry (same d3 layout the chart uses) and
  // clamped inside the chart. Percentages of the square container, so it
  // tracks left/right/top/bottom slices at any rendered size, including
  // legend-focus activation where no pointer exists at all.
  const anchor = useMemo(
    () =>
      activeIndex >= 0
        ? clampTooltipAnchor(pieSliceAnchor(rows, activeIndex))
        : null,
    [rows, activeIndex],
  )

  // Slice → legend: the chart calls back with an index (or null on leave);
  // it is translated to the stable label immediately. Stable reference so
  // the memoized PieChart core keeps its props.
  const handleHoverChange = useCallback(
    (index) => {
      setActiveLabel(
        typeof index === "number" && rows[index] != null
          ? rows[index].label
          : null,
      )
    },
    [rows],
  )
  const activate = useCallback((label) => setActiveLabel(label), [])
  const clear = useCallback(() => setActiveLabel(null), [])

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="relative mx-auto w-full min-w-0 max-w-sm">
        <PieChart
          data={rows}
          hoveredIndex={activeIndex >= 0 ? activeIndex : null}
          onHoverChange={handleHoverChange}
        >
          {rows.map((d, index) => (
            <PieSlice key={d.label} index={index} />
          ))}
        </PieChart>
        {/* Tooltip: category + formatted value + share, anchored near the
            active slice's sector (percentages of the square container,
            clamped inside). The chart library exposes no cursor-anchored
            tooltip for pie; geometry anchoring also covers legend
            hover/focus, where no pointer exists. pointer-events-none so it
            can never steal slice hover, aria-live so keyboard/AT users get
            the same information as sighted hover users. Mounts only while
            a slice is active, so there is no layout shift; only a subtle
            opacity fade, no motion system. */}
        {activeDatum && anchor ? (
          <div
            role="status"
            aria-live="polite"
            style={{
              left: `${anchor.xPct}%`,
              top: `${anchor.yPct}%`,
              transform: "translate(-50%, -50%)",
            }}
            className="pointer-events-none absolute min-w-0 max-w-[12rem] rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-sm transition-opacity duration-150"
          >
            <p className="min-w-0 truncate font-semibold text-popover-foreground">
              {activeDatum.label}
            </p>
            <p className="mt-0.5 tabular-nums text-muted-foreground">
              {formatCount(activeDatum.value)}
              {activeShare ? ` · ${activeShare}` : ""}
            </p>
          </div>
        ) : null}
      </div>
      {/* Bounded scroll keeps a 20-category legend from pushing the page;
          buttons make every entry keyboard focusable (the SVG slices are
          not focusable in this chart library, so the legend is the
          accessible interaction surface). Active state combines background,
          outline, weight, and inactive dimming — never color alone. */}
      <ul className="grid max-h-72 min-w-0 grid-cols-1 gap-1 overflow-y-auto pr-0.5 sm:grid-cols-2">
        {rows.map((d, index) => {
          const isActive = d.label === activeLabel
          const dimmed = activeLabel !== null && !isActive
          const share = formatShare(d.value, total)
          return (
            <li key={d.label} className="min-w-0">
              <button
                type="button"
                onMouseEnter={() => activate(d.label)}
                onMouseLeave={clear}
                onFocus={() => activate(d.label)}
                onBlur={clear}
                aria-label={`${d.label}, ${formatCount(d.value)}${share ? `, ${share} of total` : ""}`}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "bg-accent font-semibold text-foreground ring-1 ring-ring ring-inset"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
                  dimmed && "opacity-50",
                )}
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: sliceColor(index) }}
                />
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {d.label}
                </span>
                <span className="shrink-0 tabular-nums">{formatCount(d.value)}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
