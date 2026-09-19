"use client";;
import { motion } from "motion/react";
import { memo, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useChart, useChartStable } from "./chart-context";

function BarXAxisLabel({
  label,
  displayLabel,
  maxLabelWidth,
  x,
  crosshairX,
  isHovering,
  tickerHalfWidth
}) {
  const fadeBuffer = 20;
  const fadeRadius = tickerHalfWidth + fadeBuffer;

  let opacity = 1;
  if (isHovering && crosshairX !== null) {
    const distance = Math.abs(x - crosshairX);
    if (distance < tickerHalfWidth) {
      opacity = 0;
    } else if (distance < fadeRadius) {
      opacity = (distance - tickerHalfWidth) / fadeBuffer;
    }
  }

  const fullLabel = String(label ?? "");
  const visibleLabel = displayLabel ?? fullLabel;

  // Zero-width container approach for perfect centering.
  // Phase J: each label is clipped to its own column budget (maxLabelWidth)
  // so showing all 20 desktop labels cannot severely overlap or push the
  // page horizontally. The full category stays in `title`/`aria-label` and
  // in the Bklit tooltip + hover ticker pill.
  return (
    <div
      className="absolute"
      style={{
        left: x,
        bottom: 12,
        width: 0,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <motion.span
        animate={{ opacity }}
        aria-label={fullLabel}
        className={cn("whitespace-nowrap text-chart-label text-xs")}
        initial={{ opacity: 1 }}
        title={fullLabel}
        transition={{ duration: 0.4, ease: "easeInOut" }}
        style={
          maxLabelWidth != null
            ? {
                display: "inline-block",
                maxWidth: maxLabelWidth,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }
            : undefined
        }
      >
        {visibleLabel}
      </motion.span>
    </div>
  );
}

export function BarXAxis(props) {
  const { containerRef, barScale } = useChartStable();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const container = containerRef.current;
  if (!(mounted && container)) {
    return null;
  }

  if (!barScale) {
    return null;
  }

  return <BarXAxisInner {...props} container={container} />;
}

const BarXAxisInner = memo(function BarXAxisInner({
  tickerHalfWidth = 50,
  showAllLabels = false,
  maxLabels = 12,
  // Phase J readability additions (backward compatible — existing
  // `showAllLabels` / `maxLabels` behavior is unchanged on desktop).
  // `responsive` keeps the intentional mobile strategy inside the vendored
  // axis: very narrow charts decimate to `mobileMaxLabels` instead of
  // overlapping, with the full category in tooltip + ticker + title.
  responsive = true,
  mobileBreakpoint = 560,
  mobileMaxLabels = 8,
  maxLabelChars = 16,
  truncateLabels = true,
  container
}) {
  const {
    margin,
    tooltipData,
    barScale,
    bandWidth,
    barXAccessor,
    data,
    innerWidth,
    columnWidth,
  } = useChart();

  // Generate labels for each bar
  const { labelsToShow, maxLabelWidth } = useMemo(() => {
    if (!(barScale && bandWidth && barXAccessor)) {
      return { labelsToShow: [], maxLabelWidth: null };
    }

    const allLabels = data.map((d) => {
      const label = barXAccessor(d);
      const bandX = barScale(label) ?? 0;
      // Center the label under the bar group
      const x = bandX + bandWidth / 2 + margin.left;
      return { label, x };
    });

    // Intentional responsive fallback: on very narrow charts showing every
    // label would collide unreadably, so decimate to a small readable
    // subset. Desktop widths keep the caller's `showAllLabels` verbatim.
    let effectiveShowAll = showAllLabels;
    let effectiveMax = maxLabels;
    if (
      responsive &&
      Number.isFinite(innerWidth) &&
      innerWidth < mobileBreakpoint &&
      allLabels.length > mobileMaxLabels
    ) {
      effectiveShowAll = false;
      effectiveMax = Math.min(mobileMaxLabels, maxLabels);
    }

    let visible = allLabels;
    // If showAllLabels is true or we have fewer than maxLabels, show all
    if (!(effectiveShowAll || allLabels.length <= effectiveMax)) {
      // Otherwise, skip some labels to avoid crowding
      const step = Math.ceil(allLabels.length / effectiveMax);
      visible = allLabels.filter((_, i) => i % step === 0);
    }

    // Column budget prevents severe overlap when all 20 desktop labels are
    // shown: each label clips to its own column (cheap arithmetic, no
    // per-label measurement). Null when width is unknown (first frame).
    const widthSource = Number.isFinite(columnWidth) && columnWidth > 0
      ? columnWidth
      : Number.isFinite(innerWidth) && innerWidth > 0 && allLabels.length > 0
        ? innerWidth / allLabels.length
        : null;
    const budget =
      widthSource != null ? Math.max(24, Math.floor(widthSource - 8)) : null;

    return { labelsToShow: visible, maxLabelWidth: budget };
  }, [
    barScale,
    bandWidth,
    barXAccessor,
    data,
    margin.left,
    showAllLabels,
    maxLabels,
    responsive,
    mobileBreakpoint,
    mobileMaxLabels,
    innerWidth,
    columnWidth,
  ]);

  const isHovering = tooltipData !== null;
  const crosshairX = tooltipData ? tooltipData.x + margin.left : null;

  return createPortal(
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {labelsToShow.map((item) => {
        const text = String(item.label ?? "");
        const displayLabel =
          truncateLabels && text.length > maxLabelChars
            ? `${text.slice(0, Math.max(1, maxLabelChars - 1))}…`
            : text;
        return (
          <BarXAxisLabel
            crosshairX={crosshairX}
            displayLabel={displayLabel}
            isHovering={isHovering}
            key={`${item.label}-${item.x}`}
            label={item.label}
            maxLabelWidth={maxLabelWidth}
            tickerHalfWidth={tickerHalfWidth}
            x={item.x}
          />
        );
      })}
    </div>,
    container
  );
});

BarXAxis.displayName = "BarXAxis";

export default BarXAxis;
