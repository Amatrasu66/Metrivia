"use client";;
import { bisector } from "d3-array";
import { scaleLinear, scaleTime } from "d3-scale";
import { Children, isValidElement, useCallback, useEffect, useId, useMemo, useState } from "react";
import { DEFAULT_ANIMATION_EASING } from "./animation";
import {
  isClipExcludedComponent,
  isPostOverlayComponent,
  isUnderlayComponent,
} from "./chart-child-passthrough";
import { ChartProvider } from "./chart-context";
import { isGradientDefComponent, isPatternDefComponent } from "./chart-defs";
import { shortDateFmt } from "./chart-formatters";
import { DEFAULT_CHART_LIFECYCLE } from "./chart-phase";
import { extractReferenceAreaConfigs } from "./reference-area-config";
import { useScatterChartInteraction } from "./use-scatter-chart-interaction";
import { buildYScalesForLines, getPrimaryYScale } from "./y-axis-scales";
import { resolveScatterYDomain } from "./scatter-domain";

export function ScatterChartInner({
  width,
  height,
  data,
  xDataKey,
  margin,
  animationDuration,
  animationEasing = DEFAULT_ANIMATION_EASING,
  enterTransition,
  revealSignature = "",
  children,
  containerRef,
  lines,
  onPhaseChange
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [revealEpoch, setRevealEpoch] = useState(0);

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const xAccessor = useCallback(
    d => {
      const value = d[xDataKey];
      return value instanceof Date ? value : new Date(value);
    },
    [xDataKey]
  );

  const bisectDate = useMemo(
    () => bisector((d) => xAccessor(d)).left,
    [xAccessor]
  );

  const xRangePadding = useMemo(() => {
    if (lines.length === 0) {
      return 12;
    }
    const maxRadius = Math.max(...lines.map((line) => line.strokeWidth ?? 5));
    return maxRadius + 10;
  }, [lines]);

  const xScale = useMemo(() => {
    const dates = data.map((d) => xAccessor(d));
    const minTime = Math.min(...dates.map((d) => d.getTime()));
    const maxTime = Math.max(...dates.map((d) => d.getTime()));

    return scaleTime()
      .range([
        xRangePadding,
        Math.max(xRangePadding, innerWidth - xRangePadding),
      ])
      .domain([minTime, maxTime]);
  }, [innerWidth, data, xAccessor, xRangePadding]);

  const columnWidth = useMemo(() => {
    if (data.length < 2) {
      return 0;
    }
    return innerWidth / (data.length - 1);
  }, [innerWidth, data.length]);

  const yScales = useMemo(
    () =>
      buildYScalesForLines({
        lines,
        data,
        innerHeight,
        resolveDomain: (dataKeys) => resolveScatterYDomain(data, dataKeys),
      }),
    [innerHeight, data, lines]
  );

  const yScale = getPrimaryYScale(
    yScales,
    scaleLinear().range([innerHeight, 0]).domain([0, 100])
  );

  const dateLabels = useMemo(
    () => data.map((d) => shortDateFmt.format(xAccessor(d))),
    [data, xAccessor]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: revealSignature
  useEffect(() => {
    setRevealEpoch((n) => n + 1);
    setIsLoaded(false);
    const timer = setTimeout(() => {
      setIsLoaded(true);
    }, animationDuration);
    return () => clearTimeout(timer);
  }, [animationDuration, revealSignature]);

  useEffect(() => {
    onPhaseChange?.(isLoaded ? "ready" : "revealing");
  }, [isLoaded, onPhaseChange]);

  const canInteract = isLoaded;

  const {
    tooltipData,
    setTooltipData,
    selection,
    clearSelection,
    interactionHandlers,
    interactionStyle,
  } = useScatterChartInteraction({
    xScale,
    yScale: yScale,
    yScales: yScales,
    data,
    lines,
    margin,
    xAccessor,
    bisectDate,
    canInteract,
  });

  const referenceAreas = useMemo(
    () => extractReferenceAreaConfigs(children),
    [children]
  );

  // Series containment clip (secondary defense, NOT the domain fix above).
  // Unique per mount via useId — deliberately not a hardcoded id, so two
  // scatter charts on one page can never share a clip rect (cf. bklit-ui
  // issue #226 for hardcoded clipPath ids). The pad only preserves marker
  // ring/highlight overhang at plot edges; far-out coordinates (the old
  // domain bug) are still clipped instead of spilling into later cards.
  // Grid/axes stay outside the clip (clipExcluded) and tooltip/XAxis are
  // HTML portals, so interaction is unaffected.
  const rawClipId = useId().replace(/:/g, "");
  const scatterClipId = `scatter-plot-clip-${rawClipId}`;
  const SCATTER_CLIP_PAD = 14;

  if (width < 10 || height < 10) {
    return null;
  }

  const defsChildren = [];
  const clipExcludedChildren = [];
  const underlayChildren = [];
  const preOverlayChildren = [];
  const postOverlayChildren = [];

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) {
      return;
    }

    if (isGradientDefComponent(child)) {
      defsChildren.push(child);
    } else if (isPatternDefComponent(child)) {
      preOverlayChildren.push(child);
    } else if (isPostOverlayComponent(child)) {
      postOverlayChildren.push(child);
    } else if (isClipExcludedComponent(child)) {
      clipExcludedChildren.push(child);
    } else if (isUnderlayComponent(child)) {
      underlayChildren.push(child);
    } else {
      preOverlayChildren.push(child);
    }
  });

  const contextValue = {
    ...DEFAULT_CHART_LIFECYCLE,
    data,
    renderData: data,
    xScale: xScale,
    yScale: yScale,
    yScales: yScales,
    width,
    height,
    innerWidth,
    innerHeight,
    margin,
    columnWidth,
    tooltipData,
    setTooltipData,
    containerRef,
    lines,
    referenceAreas,
    isLoaded,
    animationDuration,
    animationEasing,
    enterTransition,
    revealEpoch,
    xAccessor,
    dateLabels,
    selection,
    clearSelection,
  };

  return (
    <ChartProvider value={contextValue}>
      <svg
        aria-hidden="true"
        className="overflow-visible"
        height={height}
        width={width}
      >
        <defs>
          {defsChildren}
          <clipPath id={scatterClipId}>
            <rect
              height={innerHeight + SCATTER_CLIP_PAD * 2}
              width={innerWidth + SCATTER_CLIP_PAD * 2}
              x={-SCATTER_CLIP_PAD}
              y={-SCATTER_CLIP_PAD}
            />
          </clipPath>
        </defs>

        <rect fill="transparent" height={height} width={width} x={0} y={0} />

        <g
          {...interactionHandlers}
          style={interactionStyle}
          transform={`translate(${margin.left},${margin.top})`}
        >
          <rect
            fill="transparent"
            height={innerHeight}
            width={innerWidth}
            x={0}
            y={0}
          />

          {clipExcludedChildren}
          {underlayChildren}
          <g clipPath={`url(#${scatterClipId})`}>{preOverlayChildren}</g>
          {postOverlayChildren}
        </g>
      </svg>
    </ChartProvider>
  );
}
