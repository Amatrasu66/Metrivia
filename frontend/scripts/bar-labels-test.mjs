// Metrivia Phase J bar-label tests — dependency-free node checks.
//
// Verifies the bar-chart x-axis shows every category label for manageable
// counts (4/8/12/15/20 on desktop) while keeping an intentional responsive
// fallback on narrow/mobile widths. Covers the pure policy helper
// (src/lib/bar-label-policy.js) plus source-level contracts on the vendored
// Bklit axis and its two Metrivia call sites:
//
//   B1-B5  desktop counts render all labels (helper + showAllLabels API)
//   B6     20 categories on mobile decimates intentionally (documented)
//   B7     25+ categories decimate even on desktop (overflow fallback)
//   B8     long labels truncate visually but keep the full category
//   B9     tooltip still carries the full category (no second tooltip)
//   B10    no horizontal overflow (column budget + ellipsis + clip)
//   B11    existing chart configuration intact (no library swap)
//
// Usage:  npm run bar:test   (from frontend/)
// Exit code is non-zero on any failure.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const bust = () =>
  `?bar=${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
const libUrl = (rel) =>
  String(new URL(`../src/lib/${rel}`, import.meta.url));
const srcFile = (rel) =>
  readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");

const policy = await import(`${libUrl("bar-label-policy.js")}${bust()}`);
const {
  BAR_ALL_LABELS_MAX,
  BAR_DEFAULT_MAX_LABELS,
  BAR_MAX_LABEL_CHARS,
  BAR_MOBILE_BREAKPOINT,
  BAR_MOBILE_MAX_LABELS,
  getBarLabelMaxWidth,
  getVisibleBarLabelCount,
  resolveBarLabelProps,
  truncateBarLabel,
} = policy;

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

// Desktop widths from the Phase J matrix.
const DESKTOP_WIDTHS = [1280, 1366, 1440];
// Representative desktop inner width: full width minus the default
// BarChart margins (left 40 + right 40).
const desktopInner = (w) => w - 80;
// Representative mobile inner widths for 430px / 390px viewports.
const MOBILE_INNER = { 430: 350, 390: 310 };

const visibleOnDesktop = (count) => {
  const props = resolveBarLabelProps({ count, innerWidth: desktopInner(1366) });
  return getVisibleBarLabelCount({ count, ...props });
};

// --- B1-B5: desktop shows all labels for manageable counts -----------------
for (const count of [4, 8, 12, 15, 20]) {
  check(
    `B${count === 4 ? 1 : count === 8 ? 2 : count === 12 ? 3 : count === 15 ? 4 : 5} ${count} categories → all visible on desktop`,
    visibleOnDesktop(count) === count,
    `got ${visibleOnDesktop(count)} of ${count}`,
  );
}

// All desktop breakpoints show all 20.
{
  const results = DESKTOP_WIDTHS.map((w) => {
    const props = resolveBarLabelProps({ count: 20, innerWidth: desktopInner(w) });
    return getVisibleBarLabelCount({ count: 20, ...props });
  });
  check(
    "B5b 20 categories → all visible at 1280/1366/1440px",
    results.every((v) => v === 20),
    results.join(","),
  );
}

// --- B6: mobile intentionally decimates (documented, with alternatives) ----
{
  const narrow390 = resolveBarLabelProps({ count: 20, innerWidth: MOBILE_INNER[390] });
  const narrow430 = resolveBarLabelProps({ count: 20, innerWidth: MOBILE_INNER[430] });
  const v390 = getVisibleBarLabelCount({ count: 20, ...narrow390 });
  const v430 = getVisibleBarLabelCount({ count: 20, ...narrow430 });
  check(
    "B6 20 categories on mobile decimates intentionally (fewer, readable)",
    narrow390.mode === "decimated-mobile" &&
      narrow430.mode === "decimated-mobile" &&
      v390 < 20 && v430 < 20 && v390 >= 5 && v430 >= 5,
    `390→${v390} (${narrow390.mode}), 430→${v430} (${narrow430.mode})`,
  );
}

// --- B7: 25+ categories decimate even on desktop ---------------------------
{
  const props = resolveBarLabelProps({ count: 25, innerWidth: desktopInner(1440) });
  const v = getVisibleBarLabelCount({ count: 25, ...props });
  check(
    "B7 25 categories decimate on desktop (overflow fallback)",
    props.showAllLabels === false && v < 25 && v <= BAR_DEFAULT_MAX_LABELS,
    `mode=${props.mode} visible=${v}`,
  );
}

// --- B8: long labels stay identifiable -------------------------------------
{
  const longs = [
    "Alternative Rock",
    "Electronic Dance Music",
    "Hip-Hop",
    "R&B",
    "Classical",
    "Afrobeats",
  ];
  const truncated = longs.map((l) => truncateBarLabel(l));
  const edm = truncateBarLabel("Electronic Dance Music");
  check(
    "B8 long labels truncate visually but keep identity",
    truncated.every((t) => t.length <= BAR_MAX_LABEL_CHARS) &&
      edm.includes("…") &&
      truncateBarLabel("Hip-Hop") === "Hip-Hop" &&
      truncateBarLabel("R&B") === "R&B",
    JSON.stringify(truncated),
  );
  const axis = srcFile("components/charts/bar-x-axis.jsx");
  check(
    "B8b axis preserves the full label in title + aria-label",
    axis.includes("title={fullLabel}") && axis.includes("aria-label={fullLabel}"),
  );
}

// --- B9: tooltip still carries the full category ----------------------------
{
  const tooltip = srcFile("components/charts/tooltip/chart-tooltip.jsx");
  check(
    "B9 Bklit tooltip resolves its title from the full category accessor",
    tooltip.includes("barXAccessor(tooltipData.point)") &&
      tooltip.includes("TooltipContent") &&
      !tooltip.includes("truncateBarLabel"),
    "",
  );
  const axis = srcFile("components/charts/bar-x-axis.jsx");
  check(
    "B9b no second tooltip system introduced in the axis",
    !axis.includes("TooltipContent") && !axis.includes("TooltipBox"),
  );
}

// --- B10: no horizontal overflow --------------------------------------------
{
  const axis = srcFile("components/charts/bar-x-axis.jsx");
  check(
    "B10 labels clip to their column (no severe overlap / page scroll)",
    axis.includes("maxLabelWidth") &&
      axis.includes("textOverflow") &&
      axis.includes("overflow-hidden") &&
      axis.includes("maxWidth: maxLabelWidth"),
  );
  const view = srcFile("components/charts/views/BarChartView.jsx");
  const dataset = srcFile("components/charts/DatasetBarChart.jsx");
  check(
    "B10b bar views guard horizontal overflow without breaking card height",
    view.includes("min-w-0") &&
      view.includes("overflow-x-clip") &&
      dataset.includes("min-w-0") &&
      dataset.includes("overflow-x-clip") &&
      !view.includes("overflow-x-auto") &&
      !dataset.includes("overflow-x-auto"),
  );
  check(
    "B10c label font is not shrunk (stays text-xs)",
    axis.includes("text-xs") && !axis.includes("text-[10px") && !axis.includes("text-[9px"),
  );
}

// --- B11: existing configuration intact --------------------------------------
{
  const view = srcFile("components/charts/views/BarChartView.jsx");
  const dataset = srcFile("components/charts/DatasetBarChart.jsx");
  const axis = srcFile("components/charts/bar-x-axis.jsx");
  check(
    "B11a views use the installed Bklit API (showAllLabels + maxLabels 20)",
    view.includes("<BarXAxis showAllLabels") &&
      view.includes("maxLabels={20}") &&
      dataset.includes("<BarXAxis showAllLabels") &&
      dataset.includes("maxLabels={20}"),
  );
  check(
    "B11b Bklit axis API preserved (no replacement, still portal + motion)",
    axis.includes("BarXAxis") &&
      axis.includes("showAllLabels = false") &&
      axis.includes("maxLabels = 12") &&
      axis.includes("createPortal") &&
      axis.includes("motion.span"),
  );
  check(
    "B11c no chart library swap (still Bklit/visx, no Recharts)",
    !view.includes("recharts") &&
      !dataset.includes("recharts") &&
      !axis.includes("recharts") &&
      view.includes("BarChart") &&
      view.includes("ChartTooltip"),
  );
  check(
    "B11d policy constants match the documented behavior",
    BAR_ALL_LABELS_MAX === 20 &&
      BAR_DEFAULT_MAX_LABELS === 12 &&
      BAR_MOBILE_BREAKPOINT === 560 &&
      BAR_MOBILE_MAX_LABELS === 8,
  );
  const budget = getBarLabelMaxWidth({ innerWidth: desktopInner(1366), count: 20 });
  check(
    "B11e column budget is a cheap arithmetic bound (no measuring)",
    Number.isFinite(budget) && budget >= 24 && budget <= 80,
    `budget=${budget}`,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
