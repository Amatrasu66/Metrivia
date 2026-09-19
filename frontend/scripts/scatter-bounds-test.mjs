// Metrivia Phase K scatter-bounds tests — dependency-free node checks.
//
// Verifies the Scatter Y-domain fix for the 1,200-row sales dataset
// (Order Date × Profit Margin, min ≈ -1.3328, max ≈ 0.6321):
//
//   S1-S5  domain includes negatives for 50/100/200/500/1200 points
//   S6     positive-only data keeps [0, top] (no regression)
//   S7     all values map inside [0, innerHeight] (no spill)
//   S8     old [0, top] domain would push negatives outside (bug proof)
//   S9     shell uses the fixed resolver + unique clip (no hardcoded id)
//   S10    series clip contains points; tooltip/XAxis/Grid preserved
//   S11    dense-view glyphs are smaller without dropping data
//   S12    no library swap, no overflow-hidden-only fix
//
// Usage:  npm run scatter:test   (from frontend/)
// Exit code is non-zero on any failure.

import { readFileSync } from "node:fs";

const bust = () =>
  `?scatter=${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
const libUrl = (rel) =>
  String(new URL(`../src/components/charts/${rel}`, import.meta.url));
const srcFile = (rel) =>
  readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");

const domain = await import(`${libUrl("scatter-domain.js")}${bust()}`);
const { resolveScatterYDomain } = domain;

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ""}`);
  }
}

// Synthetic Profit Margin-like data: min -1.3328, max 0.6321, mean ~0.33.
function makeProfitData(n) {
  const data = [];
  for (let i = 0; i < n; i += 1) {
    const t = n === 1 ? 0 : i / (n - 1);
    // Mix: mostly positive cluster + some deep negatives (outliers).
    const y =
      i % 11 === 0
        ? -1.3328 + (i % 5) * 0.05
        : 0.05 + t * 0.55 + ((i * 37) % 13) * 0.004;
    data.push({ x: new Date(2023, 0, 1 + (i % 365)).toISOString(), y });
  }
  return data;
}

function yToPx(value, domainPair, innerHeight) {
  const [d0, d1] = domainPair;
  return innerHeight - ((value - d0) / (d1 - d0)) * innerHeight;
}

// --- S1-S5: negatives included at every dataset size -----------------------
for (const n of [50, 100, 200, 500, 1200]) {
  const data = makeProfitData(n);
  const [lo, hi] = resolveScatterYDomain(data, ["y"]);
  const ys = data.map((d) => d.y);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  check(
    `S${n === 50 ? 1 : n === 100 ? 2 : n === 200 ? 3 : n === 500 ? 4 : 5} ${n} points → domain covers negatives (${lo.toFixed(3)} → ${hi.toFixed(3)})`,
    lo < Math.min(0, min) + 1e-9 && hi > max - 1e-9 && lo < 0,
    `domain=[${lo}, ${hi}] min=${min} max=${max}`,
  );
}

// --- S6: positive-only keeps [0, top] ---------------------------------------
{
  const data = Array.from({ length: 200 }, (_, i) => ({
    x: new Date(2023, 0, 1 + (i % 60)).toISOString(),
    y: 5 + (i % 50),
  }));
  const [lo, hi] = resolveScatterYDomain(data, ["y"]);
  check(
    "S6 positive-only data keeps zero baseline (no regression)",
    lo === 0 && hi > 50,
    `domain=[${lo}, ${hi}]`,
  );
}

// --- S7: every value maps inside the plot ----------------------------------
{
  const innerHeight = 320;
  let worst = null;
  for (const n of [50, 100, 200, 500, 1200]) {
    const data = makeProfitData(n);
    const dom = resolveScatterYDomain(data, ["y"]);
    for (const d of data) {
      const py = yToPx(d.y, dom, innerHeight);
      if (!(py >= -1e-9 && py <= innerHeight + 1e-9)) {
        worst = `n=${n} y=${d.y} py=${py} domain=[${dom}]`;
        break;
      }
    }
    if (worst) break;
  }
  check("S7 all values map inside [0, innerHeight]", worst === null, worst ?? "");
}

// --- S8: old buggy domain would spill (proves the failure mechanism) -------
{
  const data = makeProfitData(1200);
  const ys = data.map((d) => d.y);
  const maxValue = Math.max(...ys.filter((v) => v > 0), 0);
  const buggy = [0, maxValue <= 0 ? 100 : maxValue * 1.1];
  const innerHeight = 320;
  const outside = data.filter((d) => yToPx(d.y, buggy, innerHeight) > innerHeight + 1e-9);
  check(
    "S8 old [0, top] domain pushes negatives below the plot (bug proof)",
    outside.length > 0,
    `outside=${outside.length} of ${data.length}`,
  );
}

// --- S9: shell wiring -------------------------------------------------------
{
  const shell = srcFile("components/charts/scatter-chart-shell.jsx");
  check(
    "S9a shell uses the fixed negative-aware resolver",
    shell.includes("resolveScatterYDomain") &&
      shell.includes('from "./scatter-domain"') &&
      !shell.includes("let maxValue = 0;"),
  );
  check(
    "S9b series clip uses a unique id (no hardcoded clipPath)",
    shell.includes("scatter-plot-clip-") &&
      shell.includes("useId()") &&
      shell.includes("<clipPath") &&
      !shell.includes('clipPathId="chart-grow-clip"') &&
      !shell.includes('id="chart-grow-clip"') &&
      !shell.includes('id="scatter-plot-clip"'),
    "",
  );
  check(
    "S9c clip wraps the series layer with marker padding",
    shell.includes("SCATTER_CLIP_PAD") &&
      shell.includes("clipPath={`url(#${scatterClipId})`}"),
  );
}

// --- S10: functionality preserved -------------------------------------------
{
  const view = srcFile("components/charts/views/ScatterChartView.jsx");
  const shell = srcFile("components/charts/scatter-chart-shell.jsx");
  const interaction = srcFile("components/charts/use-scatter-chart-interaction.js");
  check(
    "S10a tooltip / hover / crosshair / date axis wiring intact",
    view.includes("<ChartTooltip") &&
      view.includes("<XAxis") &&
      view.includes("<Grid horizontal") &&
      shell.includes("useScatterChartInteraction") &&
      interaction.includes('cursor: canInteract ? "crosshair"'),
  );
  check(
    "S10b Grid and axes stay outside the series clip (still visible)",
    shell.includes("clipExcludedChildren") &&
      shell.includes("isClipExcludedComponent"),
  );
  check(
    "S10c responsive measurement + workspace data flow intact",
    srcFile("components/charts/scatter-chart.jsx").includes("useMeasure") &&
      view.includes("ScatterChart") &&
      view.includes('xDataKey="x"'),
  );
}

// --- S11: density without data loss -----------------------------------------
{
  const view = srcFile("components/charts/views/ScatterChartView.jsx");
  check(
    "S11 dense 1,200-point view uses smaller glyphs (no aggregation)",
    view.includes("radius={3}") &&
      view.includes("strokeWidth={1}") &&
      view.includes("ringGap={1}") &&
      !view.includes("slice(0") &&
      !view.includes(".filter("),
  );
}

// --- S12: no library swap / no overflow-only fix -----------------------------
{
  const view = srcFile("components/charts/views/ScatterChartView.jsx");
  const shell = srcFile("components/charts/scatter-chart-shell.jsx");
  check(
    "S12a still Bklit Scatter (no Recharts/Chart.js/D3 rewrite)",
    view.includes("ScatterChart") &&
      view.includes("Scatter") &&
      !view.includes("recharts") &&
      !shell.includes("recharts") &&
      !view.includes("chart.js"),
  );
  check(
    "S12b fix is domain + clip, not overflow-hidden alone",
    shell.includes("resolveScatterYDomain") &&
      shell.includes("<clipPath") &&
      shell.includes('className="overflow-visible"') &&
      view.includes("overflow-x-clip"),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
