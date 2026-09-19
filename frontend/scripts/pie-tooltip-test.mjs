// Metrivia pie-tooltip positioning tests — dependency-free node checks.
//
// Verifies the pure geometry in src/lib/pie-tooltip.js that anchors the
// pie tooltip near the hovered slice: cardinal directions, clamping,
// stable identity mapping, share formatting, and edge cases. The expected
// percentages below are hard-coded from the d3-pie layout by hand (4 equal
// slices starting at -90°, 90° each, anchor at 0.68 of the half-size), so
// they catch a drift in either the helper or the PieChart defaults it
// mirrors — not just regressions against itself.
//
// Usage:  npm run pie:test   (from frontend/)
// Exit code is non-zero on any failure.

import {
  clampTooltipAnchor,
  formatShare,
  pieSliceAnchor,
  PIE_END_ANGLE,
  PIE_PAD_ANGLE,
  PIE_START_ANGLE,
  TOOLTIP_MAX_PCT,
  TOOLTIP_MIN_PCT,
  TOOLTIP_RADIUS_FRACTION,
} from "../src/lib/pie-tooltip.js";

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

const approx = (a, b, eps = 0.5) => Math.abs(a - b) <= eps;
const inBox = (p) =>
  p.xPct >= 0 && p.xPct <= 100 && p.yPct >= 0 && p.yPct <= 100;

// The layout constants must mirror the PieChart prop defaults exactly.
check(
  "PT0 helper mirrors PieChart layout defaults",
  PIE_START_ANGLE === -Math.PI / 2 &&
    PIE_END_ANGLE === (3 * Math.PI) / 2 &&
    PIE_PAD_ANGLE === 0 &&
    TOOLTIP_RADIUS_FRACTION === 0.68,
);

// Four equal slices: [-90,0],[0,90],[90,180],[180,270] degrees, mids at
// -45/45/135/225°. Anchor = 50 ± sin/cos(45°) * 50 * 0.68 = 50 ± 24.04.
const quad = [
  { label: "a", value: 1 },
  { label: "b", value: 1 },
  { label: "c", value: 1 },
  { label: "d", value: 1 },
];
const anchors = [0, 1, 2, 3].map((i) => pieSliceAnchor(quad, i));
check(
  "PT1 top-left slice anchors top-left",
  approx(anchors[0].xPct, 25.96) && approx(anchors[0].yPct, 25.96),
  JSON.stringify(anchors[0]),
);
check(
  "PT2 top-right slice anchors top-right",
  approx(anchors[1].xPct, 74.04) && approx(anchors[1].yPct, 25.96),
  JSON.stringify(anchors[1]),
);
check(
  "PT3 bottom-right slice anchors bottom-right",
  approx(anchors[2].xPct, 74.04) && approx(anchors[2].yPct, 74.04),
  JSON.stringify(anchors[2]),
);
check(
  "PT4 bottom-left slice anchors bottom-left",
  approx(anchors[3].xPct, 25.96) && approx(anchors[3].yPct, 74.04),
  JSON.stringify(anchors[3]),
);

// A dominant slice plus a sliver: the sliver's raw anchor sits far out and
// low, and clamping keeps the centered box inside the chart.
const skewed = [
  { label: "big", value: 97 },
  { label: "sliver", value: 3 },
];
const sliver = pieSliceAnchor(skewed, 1);
check(
  "PT5 sliver anchor is inside the container box",
  sliver !== null && inBox(sliver),
  JSON.stringify(sliver),
);
const clamped = clampTooltipAnchor({ xPct: 2, yPct: 99 });
check(
  "PT6 clamping keeps centers inside the safe box",
  clamped.xPct === TOOLTIP_MIN_PCT && clamped.yPct === TOOLTIP_MAX_PCT,
  JSON.stringify(clamped),
);
const inner = clampTooltipAnchor({ xPct: 50, yPct: 50 });
check(
  "PT7 clamping leaves interior anchors untouched",
  inner.xPct === 50 && inner.yPct === 50,
);
check("PT8 clamp maps null to null", clampTooltipAnchor(null) === null);

// Identity: the anchor follows data order, so the view's label→index
// translation always addresses the slice the chart drew at that index.
const mixed = [
  { label: "zeta", value: 5 },
  { label: "alpha", value: 15 },
  { label: "mid", value: 10 },
];
const byLabel = Object.fromEntries(
  mixed.map((d, i) => [d.label, pieSliceAnchor(mixed, i)]),
);
check(
  "PT9 anchors follow data order (stable label identity)",
  byLabel.alpha.xPct !== byLabel.zeta.xPct &&
    Object.values(byLabel).every((p) => p !== null && inBox(p)),
  JSON.stringify(byLabel),
);

// Content formatting.
check(
  "PT10 share formats to one decimal",
  formatShare(1, 4) === "25.0%" && formatShare(2, 3) === "66.7%",
);
check(
  "PT11 share is null when not reliably calculable",
  formatShare(5, 0) === null &&
    formatShare(NaN, 10) === null &&
    formatShare("3", 10) === null &&
    formatShare(3, null) === null,
);

// Edge cases: no crash, null out.
check(
  "PT12 empty/bad input returns null",
  pieSliceAnchor([], 0) === null &&
    pieSliceAnchor(null, 0) === null &&
    pieSliceAnchor(quad, -1) === null &&
    pieSliceAnchor(quad, 4) === null &&
    pieSliceAnchor(quad, 1.5) === null,
);
check(
  "PT13 single-slice pie anchors (full circle mid at 90°)",
  (() => {
    const p = pieSliceAnchor([{ label: "only", value: 10 }], 0);
    // Arc spans -90°..270°, mid = 90° → right center.
    return p !== null && approx(p.xPct, 84) && approx(p.yPct, 50) && inBox(p);
  })(),
);
check(
  "PT14 every anchor of a 20-category pie stays in the box",
  (() => {
    const data = Array.from({ length: 20 }, (_, i) => ({
      label: `cat-${i}`,
      value: (i * 37) % 100 + 1,
    }));
    return data.every((_, i) => {
      const p = pieSliceAnchor(data, i);
      return p !== null && inBox(p);
    });
  })(),
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
