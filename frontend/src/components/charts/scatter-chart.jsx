"use client";;
import { Children, isValidElement, useMemo, useRef } from "react";
import useMeasure from "react-use-measure";
import { cn } from "@/lib/utils";
import { DEFAULT_CHART_ENTER_TRANSITION } from "./animation";
import { defaultScatterColors } from "./chart-context";
import { Scatter } from "./scatter";
import { ScatterChartInner } from "./scatter-chart-shell";

const DEFAULT_MARGIN = { top: 40, right: 40, bottom: 40, left: 40 };

function extractScatterConfigs(children) {
  const configs = [];
  let seriesIndex = 0;

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) {
      return;
    }

    const childType = child.type;
    const componentName =
      typeof child.type === "function"
        ? childType.displayName || childType.name || ""
        : "";

    const props = child.props;
    const isScatterComponent =
      componentName === "Scatter" ||
      child.type === Scatter ||
      (props && typeof props.dataKey === "string" && props.dataKey.length > 0);

    if (isScatterComponent && props?.dataKey) {
      const seriesColor =
        defaultScatterColors[seriesIndex % defaultScatterColors.length] ??
        defaultScatterColors[0];
      configs.push({
        dataKey: props.dataKey,
        stroke: props.fill || props.stroke || seriesColor,
        strokeWidth: props.radius ?? 5,
        yAxisId: props.yAxisId,
      });
      seriesIndex += 1;
    }
  });

  return configs;
}

function ChartInner({
  width,
  height,
  data,
  xDataKey,
  margin,
  animationDuration,
  animationEasing,
  enterTransition,
  revealSignature,
  children,
  containerRef,
  onPhaseChange
}) {
  const lines = useMemo(() => extractScatterConfigs(children), [children]);

  return (
    <ScatterChartInner
      animationDuration={animationDuration}
      animationEasing={animationEasing}
      containerRef={containerRef}
      data={data}
      enterTransition={enterTransition}
      height={height}
      lines={lines}
      margin={margin}
      onPhaseChange={onPhaseChange}
      revealSignature={revealSignature}
      width={width}
      xDataKey={xDataKey}
    >
      {children}
    </ScatterChartInner>
  );
}

export function ScatterChart({
  data,
  xDataKey = "date",
  margin: marginProp,
  animationDuration = 1100,
  animationEasing,
  enterTransition = DEFAULT_CHART_ENTER_TRANSITION,
  revealSignature,
  aspectRatio = "2 / 1",
  className = "",
  children,
  onPhaseChange
}) {
  const containerRef = useRef(null);
  const margin = { ...DEFAULT_MARGIN, ...marginProp };
  const [measureRef, bounds] = useMeasure({ debounce: 10 });

  const setContainerRef = (node) => {
    containerRef.current = node;
    measureRef(node);
  };

  const width = bounds.width ?? 0;
  const height = bounds.height ?? 0;

  return (
    <div
      className={cn("relative w-full", className)}
      ref={setContainerRef}
      style={{ aspectRatio, touchAction: "none" }}
    >
      {width > 0 && height > 0 ? (
        <ChartInner
          animationDuration={animationDuration}
          animationEasing={animationEasing}
          containerRef={containerRef}
          data={data}
          enterTransition={enterTransition}
          height={height}
          margin={margin}
          onPhaseChange={onPhaseChange}
          revealSignature={revealSignature}
          width={width}
          xDataKey={xDataKey}
        >
          {children}
        </ChartInner>
      ) : null}
    </div>
  );
}

ScatterChart.displayName = "ScatterChart";

export { Scatter } from "./scatter";

export default ScatterChart;
