"use client";;
import { useCallback, useEffect, useRef } from "react";
import { useMetriviaHaptics } from "@/hooks/useMetriviaHaptics";
import { normalizeYAxisId } from "./y-axis-scales";

/**
 * Scatter point-drag haptics.
 *
 * Data flow (all through the semantic haptic layer, never web-haptics):
 *
 *   touch handlers (use-scatter-chart-interaction)
 *       ↓  chart-space (x, y)
 *   resolveScatterPointHit()   → nearest rendered point within radius, or null
 *       ↓  stable point id (`${dataKey}:${index}`)
 *   createScatterPointTracker() → dedupe + throttle state machine
 *       ↓  fire decision
 *   useMetriviaHaptics().dataPoint() → `dataPoints` settings category
 *
 * Deliberately NOT covered:
 * - Mouse hover/drag: the mouse interaction path never calls into this
 *   module, so desktop stays silent and responsive.
 * - iOS: `dataPoint()` is programmatic, hence silent on iOS by design
 *   (same as every other programmatic action). Per-point HTML switch
 *   overlays would cost hundreds of nodes and a full-chart overlay would
 *   break scrolling/selection gestures, so scatter drags are Android-only
 *   haptics. Documented honestly in Settings; never faked.
 */

// Finger-sized hit target: ~2x the default marker visual extent (~13px),
// so a fingertip reliably "lands on" a 5px-radius point without requiring
// pixel precision. Compared in SVG user units (1 unit = 1 CSS px here:
// the svg sets explicit width/height with no viewBox, and
// localPointFromSvg maps through the real screen matrix, so DPR and page
// zoom are already accounted for — no manual scaling needed).
export const SCATTER_POINT_HIT_RADIUS_PX = 24;

// Minimum gap between two fired ticks. A single tick is ~15 ms of motor
// on-time; 100 ms keeps rapid crossings perceptible yet distinct (max
// ~10 ticks/sec) instead of merging into an uncontrolled buzz. Skipped
// points are legitimate — the tracker always advances to the latest point,
// so feedback tracks the finger rather than queuing stale ticks.
export const SCATTER_HAPTIC_MIN_INTERVAL_MS = 100;

// How many datum neighbours around the X-bisected index take part in the
// 2D nearest-point search. Bisect finds the closest column by X; the window
// covers the common case where the 2D-nearest point sits one column over
// (dense time series). Bounded and tiny — no full-array scan per event.
const HIT_SEARCH_WINDOW = { before: 2, after: 1 };

/** Stable point identity: series key + dataset index. Never pixel-based,
 *  never random — the same logical point keeps its id across moves and
 *  re-renders (mirrors the marker React keys `${dataKey}-${index}`). */
export function buildScatterPointId(dataKey, index) {
  return `${dataKey}:${index}`;
}

/**
 * Real 2D hit-test against rendered point positions. Uses the exact same
 * scale math as SeriesMarkers (`xScale(xAccessor(d))`, per-series y scale),
 * so a "hit" always corresponds to an actual visible point.
 * Returns `{ id, dataKey, index }` or null.
 */
export function resolveScatterPointHit({
  chartX,
  chartY,
  data,
  lines,
  xScale,
  yScale,
  yScales,
  xAccessor,
  bisectDate,
  hitRadius = SCATTER_POINT_HIT_RADIUS_PX,
}) {
  if (
    typeof chartX !== "number" ||
    typeof chartY !== "number" ||
    !Array.isArray(data) ||
    data.length === 0 ||
    !Array.isArray(lines) ||
    lines.length === 0 ||
    typeof xScale?.invert !== "function" ||
    typeof xAccessor !== "function" ||
    typeof bisectDate !== "function"
  ) {
    return null;
  }

  let insertion;
  try {
    insertion = bisectDate(data, xScale.invert(chartX), 1);
  } catch {
    return null;
  }

  const radiusSq = hitRadius * hitRadius;
  let best = null;

  for (
    let i = insertion - HIT_SEARCH_WINDOW.before;
    i <= insertion + HIT_SEARCH_WINDOW.after;
    i += 1
  ) {
    if (i < 0 || i >= data.length) {
      continue;
    }
    const d = data[i];
    let cx;
    try {
      cx = xScale(xAccessor(d));
    } catch {
      continue;
    }
    if (typeof cx !== "number" || Number.isNaN(cx)) {
      continue;
    }
    for (const line of lines) {
      const value = d[line.dataKey];
      if (typeof value !== "number") {
        continue;
      }
      const axisScale = yScales?.[normalizeYAxisId(line.yAxisId)] ?? yScale;
      if (typeof axisScale !== "function") {
        continue;
      }
      let cy;
      try {
        cy = axisScale(value);
      } catch {
        continue;
      }
      if (typeof cy !== "number" || Number.isNaN(cy)) {
        continue;
      }
      const dx = cx - chartX;
      const dy = cy - chartY;
      const distSq = dx * dx + dy * dy;
      if (distSq <= radiusSq && (!best || distSq < best.distSq)) {
        best = {
          distSq,
          index: i,
          dataKey: line.dataKey,
        };
      }
    }
  }

  if (!best) {
    return null;
  }
  return {
    id: buildScatterPointId(best.dataKey, best.index),
    dataKey: best.dataKey,
    index: best.index,
  };
}

/**
 * Framework-free dedupe + throttle state machine. Pure logic (no React) so
 * it is directly unit-testable; the React hook below is a thin binding.
 *
 * Rules:
 * - `pointId == null` (finger over empty chart space) clears the active
 *   point WITHOUT firing — re-entering a point later fires again.
 * - Same id as the active point: silent (no repeat vibration).
 * - New id: becomes active immediately; fires unless inside the throttle
 *   window (skipped points are legitimate under rapid movement).
 */
export function createScatterPointTracker({
  onPointFire,
  getTime = () => performance.now(),
}) {
  let lastId = null;
  let lastFireTime = -Infinity;

  return {
    /** Current active point id (null = none). Exposed for tests. */
    getLastId: () => lastId,
    handleMove({ pointId = null, hapticAllowed = true } = {}) {
      if (!hapticAllowed) {
        return { fired: false };
      }
      if (pointId == null) {
        lastId = null;
        return { fired: false };
      }
      if (pointId === lastId) {
        return { fired: false };
      }
      lastId = pointId;
      let now = 0;
      try {
        now = getTime();
      } catch {
        now = 0;
      }
      if (
        typeof now !== "number" ||
        Number.isNaN(now) ||
        now - lastFireTime < SCATTER_HAPTIC_MIN_INTERVAL_MS
      ) {
        return { fired: false, throttled: true };
      }
      lastFireTime = now;
      try {
        onPointFire?.();
      } catch {
        // A haptic failure must never break chart interaction.
      }
      return { fired: true };
    },
    reset() {
      lastId = null;
    },
  };
}

/**
 * React binding for the scatter interaction hook. All transient state lives
 * in refs: pointer movement never triggers a React render. Hit-test inputs
 * are read from a ref at call time, so the returned callbacks are stable
 * and never churn the chart's event handlers. No timers, no listeners —
 * nothing to leak on unmount (refs die with the component).
 */
export function useScatterPointHaptics({
  data,
  lines,
  xScale,
  yScale,
  yScales,
  xAccessor,
  bisectDate,
}) {
  const { dataPoint } = useMetriviaHaptics();

  const fireRef = useRef(dataPoint);
  fireRef.current = dataPoint;

  const inputsRef = useRef(null);
  inputsRef.current = {
    data,
    lines,
    xScale,
    yScale,
    yScales,
    xAccessor,
    bisectDate,
  };

  const trackerRef = useRef(null);
  if (trackerRef.current === null) {
    trackerRef.current = createScatterPointTracker({
      onPointFire: () => fireRef.current(),
    });
  }

  // Hygiene only (refs need no cleanup): a remount starts with no active
  // point so a stale id can never suppress the first tick.
  useEffect(() => {
    const tracker = trackerRef.current;
    return () => {
      tracker?.reset();
    };
  }, []);

  // Touch-path only — the mouse path in use-scatter-chart-interaction never
  // calls this, which is exactly what keeps desktop hover silent.
  const maybeFirePointHaptic = useCallback((chartX, chartY) => {
    const hit = resolveScatterPointHit({
      chartX,
      chartY,
      ...inputsRef.current,
    });
    return trackerRef.current.handleMove({
      pointId: hit ? hit.id : null,
      hapticAllowed: true,
    });
  }, []);

  const resetPointHaptic = useCallback(() => {
    trackerRef.current?.reset();
  }, []);

  return { maybeFirePointHaptic, resetPointHaptic };
}
