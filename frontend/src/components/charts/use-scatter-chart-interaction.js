"use client";;
import { useCallback, useRef, useState } from "react";
import { localPointFromSvg } from "./scatter-svg";
import { useScheduledTooltip } from "./use-scheduled-tooltip";
import { useScatterPointHaptics } from "./use-scatter-point-haptics";
import { normalizeYAxisId } from "./y-axis-scales";

export function useScatterChartInteraction(
  {
    xScale,
    yScale,
    yScales,
    data,
    lines,
    margin,
    xAccessor,
    bisectDate,
    canInteract
  }
) {
  const [selection, setSelection] = useState(null);
  const {
    tooltipData,
    setTooltipData,
    scheduleTooltip,
    clearTooltip,
    resetTooltipDedupe,
  } = useScheduledTooltip();

  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);

  // Point-drag haptics (touch only). Refs-only, stable callbacks — no
  // renders, no timers, no extra listeners. The mouse path below never
  // touches it, which keeps desktop hover silent by construction.
  const { maybeFirePointHaptic, resetPointHaptic } = useScatterPointHaptics({
    xScale,
    yScale,
    yScales,
    data,
    lines,
    xAccessor,
    bisectDate,
  });

  const resolveTooltipFromX = useCallback(
    pixelX => {
      const x0 = xScale.invert(pixelX);
      const index = bisectDate(data, x0, 1);
      const d0 = data[index - 1];
      const d1 = data[index];

      if (!d0) {
        return null;
      }

      let d = d0;
      let finalIndex = index - 1;
      if (d1) {
        const d0Time = xAccessor(d0).getTime();
        const d1Time = xAccessor(d1).getTime();
        if (x0.getTime() - d0Time > d1Time - x0.getTime()) {
          d = d1;
          finalIndex = index;
        }
      }

      const yPositions = {};
      for (const line of lines) {
        const value = d[line.dataKey];
        if (typeof value === "number") {
          const axisScale = yScales[normalizeYAxisId(line.yAxisId)] ?? yScale;
          yPositions[line.dataKey] = axisScale(value) ?? 0;
        }
      }

      return {
        point: d,
        index: finalIndex,
        x: xScale(xAccessor(d)) ?? 0,
        yPositions,
      };
    },
    [xScale, yScale, yScales, data, lines, xAccessor, bisectDate]
  );

  const resolveIndexFromX = useCallback(
    pixelX => {
      const x0 = xScale.invert(pixelX);
      const index = bisectDate(data, x0, 1);
      const d0 = data[index - 1];
      const d1 = data[index];
      if (!d0) {
        return 0;
      }
      if (d1) {
        const d0Time = xAccessor(d0).getTime();
        const d1Time = xAccessor(d1).getTime();
        if (x0.getTime() - d0Time > d1Time - x0.getTime()) {
          return index;
        }
      }
      return index - 1;
    },
    [xScale, data, xAccessor, bisectDate]
  );

  // Chart-space position (margins removed). getChartX is the legacy
  // X-only view kept for the drag/selection paths; touch haptics use the
  // full point so hit-testing sees the real 2D finger position.
  const getChartPoint = useCallback(
    (event, touchIndex = 0) => {
      const svg = event.currentTarget.ownerSVGElement;
      let clientX;
      let clientY;

      if ("touches" in event) {
        const touch = event.touches[touchIndex];
        if (!touch) {
          return null;
        }
        clientX = touch.clientX;
        clientY = touch.clientY;
      } else {
        clientX = event.clientX;
        clientY = event.clientY;
      }

      const point = localPointFromSvg(svg, clientX, clientY);
      if (!point) {
        return null;
      }
      return { x: point.x - margin.left, y: point.y - margin.top };
    },
    [margin.left, margin.top]
  );

  const getChartX = useCallback(
    (event, touchIndex = 0) => {
      const chartPoint = getChartPoint(event, touchIndex);
      return chartPoint === null ? null : chartPoint.x;
    },
    [getChartPoint]
  );

  const handleMouseMove = useCallback(
    (event) => {
      const chartX = getChartX(event);
      if (chartX === null) {
        return;
      }

      if (isDraggingRef.current) {
        const startX = Math.min(dragStartXRef.current, chartX);
        const endX = Math.max(dragStartXRef.current, chartX);
        setSelection({
          startX,
          endX,
          startIndex: resolveIndexFromX(startX),
          endIndex: resolveIndexFromX(endX),
          active: true,
        });
        return;
      }

      // NOTE: no point haptics on the mouse path — desktop hover stays
      // silent by never calling maybeFirePointHaptic.
      const tooltip = resolveTooltipFromX(chartX);
      if (tooltip) {
        scheduleTooltip(tooltip);
      }
    },
    [getChartX, resolveTooltipFromX, resolveIndexFromX, scheduleTooltip]
  );

  const handleMouseLeave = useCallback(() => {
    clearTooltip();
    resetPointHaptic();
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
    }
    setSelection(null);
  }, [clearTooltip, resetPointHaptic]);

  const handleMouseDown = useCallback(
    (event) => {
      const chartX = getChartX(event);
      if (chartX === null) {
        return;
      }
      isDraggingRef.current = true;
      dragStartXRef.current = chartX;
      clearTooltip();
      resetPointHaptic();
      setSelection(null);
    },
    [getChartX, clearTooltip, resetPointHaptic]
  );

  const handleMouseUp = useCallback(() => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
    }
    setSelection(null);
  }, []);

  const handleTouchStart = useCallback(
    (event) => {
      if (event.touches.length === 1) {
        event.preventDefault();
        const chartX = getChartX(event, 0);
        if (chartX === null) {
          return;
        }
        const tooltip = resolveTooltipFromX(chartX);
        if (tooltip) {
          scheduleTooltip(tooltip);
        }
        // Single-finger touch on a real point ticks (deduped + throttled
        // inside the tracker). Touchscreen pen arrives here too.
        const chartPoint = getChartPoint(event, 0);
        if (chartPoint !== null) {
          maybeFirePointHaptic(chartPoint.x, chartPoint.y);
        }
      } else if (event.touches.length === 2) {
        event.preventDefault();
        resetTooltipDedupe();
        clearTooltip();
        resetPointHaptic();
        const x0 = getChartX(event, 0);
        const x1 = getChartX(event, 1);
        if (x0 === null || x1 === null) {
          return;
        }
        const startX = Math.min(x0, x1);
        const endX = Math.max(x0, x1);
        setSelection({
          startX,
          endX,
          startIndex: resolveIndexFromX(startX),
          endIndex: resolveIndexFromX(endX),
          active: true,
        });
      }
    },
    [
      getChartX,
      getChartPoint,
      resolveTooltipFromX,
      resolveIndexFromX,
      scheduleTooltip,
      resetTooltipDedupe,
      clearTooltip,
      maybeFirePointHaptic,
      resetPointHaptic,
    ]
  );

  const handleTouchMove = useCallback(
    (event) => {
      if (event.touches.length === 1) {
        event.preventDefault();
        const chartX = getChartX(event, 0);
        if (chartX === null) {
          return;
        }
        const tooltip = resolveTooltipFromX(chartX);
        if (tooltip) {
          scheduleTooltip(tooltip);
        }
        // Finger drag across points: one tick per newly-entered point, at
        // most one tick per throttle window. Same point = silent.
        const chartPoint = getChartPoint(event, 0);
        if (chartPoint !== null) {
          maybeFirePointHaptic(chartPoint.x, chartPoint.y);
        }
      } else if (event.touches.length === 2) {
        event.preventDefault();
        resetPointHaptic();
        const x0 = getChartX(event, 0);
        const x1 = getChartX(event, 1);
        if (x0 === null || x1 === null) {
          return;
        }
        const startX = Math.min(x0, x1);
        const endX = Math.max(x0, x1);
        setSelection({
          startX,
          endX,
          startIndex: resolveIndexFromX(startX),
          endIndex: resolveIndexFromX(endX),
          active: true,
        });
      }
    },
    [
      getChartX,
      getChartPoint,
      resolveTooltipFromX,
      resolveIndexFromX,
      scheduleTooltip,
      maybeFirePointHaptic,
      resetPointHaptic,
    ]
  );

  const handleTouchEnd = useCallback(() => {
    clearTooltip();
    resetPointHaptic();
    setSelection(null);
  }, [clearTooltip, resetPointHaptic]);

  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  const interactionHandlers = canInteract
    ? {
        onMouseMove: handleMouseMove,
        onMouseLeave: handleMouseLeave,
        onMouseDown: handleMouseDown,
        onMouseUp: handleMouseUp,
        onTouchStart: handleTouchStart,
        onTouchMove: handleTouchMove,
        onTouchEnd: handleTouchEnd,
      }
    : {};

  const interactionStyle = {
    cursor: canInteract ? "crosshair" : "default",
    touchAction: "none",
  };

  return {
    tooltipData,
    setTooltipData,
    selection,
    clearSelection,
    interactionHandlers,
    interactionStyle,
  };
}
