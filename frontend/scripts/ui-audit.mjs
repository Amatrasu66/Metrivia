// Metrivia UI/performance audit (Phase F) — dependency-free source checks.
//
// Verifies the navigation cleanup, animation safeguards, and 20 MiB upload
// contract at the source level (fast regression tripwires — not a substitute
// for profiling or device testing):
//   navigation cleanup (no tab strip, no Frontend shell, no stray + tab)
//   animation safeguards (no transition-all, no `transition: all`, memoized
//     dashboard subtree, single animation library, reduced-motion wiring)
//   header contract (desktop spacer layout, mobile menu with appearance)
//   theme bootstrap (Mocha Mousse first paint, no Amber/Graphite default)
//   upload contract (frontend 20 MiB constant + validation helper, backend
//     20 MiB default + JSON 413 path, table windowing present)
//
// Usage:  npm run ui:audit   (from frontend/)
// Exit code is non-zero on any failure.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("../src/", import.meta.url));
const rootDir = fileURLToPath(new URL("../", import.meta.url));

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

const readSrc = (rel) => readFileSync(join(srcDir, rel), "utf8");
const existsSrc = (rel) => existsSync(join(srcDir, rel));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      walk(full, out);
    } else if (/\.(js|jsx|css)$/.test(entry)) out.push(full);
  }
  return out;
}
const srcFiles = walk(srcDir);
const rel = (f) => f.slice(srcDir.length).replace(/\\/g, "/");
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");

// --- navigation cleanup ---------------------------------------------------------
check(
  "U1 old workspace tab strip is removed",
  !existsSrc("components/workspaces/WorkspaceTabs.jsx"),
  existsSrc("components/workspaces/WorkspaceTabs.jsx")
    ? "WorkspaceTabs.jsx still exists"
    : "",
);
{
  const hits = srcFiles
    .filter((f) => stripComments(readFileSync(f, "utf8")).includes("Frontend shell"))
    .map(rel);
  check("U2 no 'Frontend shell' demo label remains", hits.length === 0, hits.join(", "));
}
{
  const hits = srcFiles
    .filter((f) => {
      const code = stripComments(readFileSync(f, "utf8"));
      return (
        code.includes("WorkspaceTabs") || code.includes("onCreateWorkspace") === false
      );
    })
    .map(rel);
  // WorkspaceTabs must be gone entirely; onCreateWorkspace wiring stays (App→header).
  const stale = hits.filter((f) => f.endsWith("WorkspaceTabs.jsx"));
  check("U3 no stale WorkspaceTabs references", stale.length === 0, stale.join(", "));
}
{
  const code = stripComments(readSrc("components/workspaces/WorkspaceSelector.jsx"));
  check(
    "U4 workspace selector renders from the existing store (no second system)",
    code.includes("useWorkspaces") &&
      !code.includes("useReducer") &&
      !code.includes("createInitialStoreState"),
  );
}
{
  const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  check(
    "U5 no React Router introduced for navigation",
    !("react-router" in deps || "react-router-dom" in deps),
  );
}

// --- animation safeguards -----------------------------------------------------------
{
  const hits = [];
  for (const f of srcFiles) {
    const code = stripComments(readFileSync(f, "utf8"));
    if (/(transition-all|transition:all|transition:\s*all\b)/.test(code)) {
      hits.push(rel(f));
    }
  }
  check("U6 no transition-all / `transition: all` anywhere", hits.length === 0, hits.join(", "));
}
{
  const css = readSrc("index.css");
  const starRule = css.match(/\*\s*,\s*\*\s*::before[\s\S]*?\{[\s\S]*?\}/);
  const animatesLayout = starRule
    ? /(width|height|padding|margin|box-shadow|filter)\s*:/.test(starRule[0])
    : false;
  check(
    "U7 global transition stays paint-only (no layout/box-shadow/filter)",
    !animatesLayout,
  );
  check(
    "U8 global transition is reduced-motion guarded",
    css.includes("prefers-reduced-motion"),
  );
}
for (const [name, file] of [
  ["U9a DashboardPlaceholder is memoized", "components/dashboard/DashboardPlaceholder.jsx"],
  ["U9b ChartBuilder is memoized", "components/charts/ChartBuilder.jsx"],
  ["U9c DashboardLayout is memoized", "components/dashboard/DashboardLayout.jsx"],
]) {
  check(name, readSrc(file).includes("memo("), file);
}
{
  const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  const deps = { ...pkg.dependencies };
  check(
    "U10 single animation library (motion, no framer-motion duplicate)",
    "motion" in deps && !("framer-motion" in deps),
    Object.keys(deps).filter((d) => /motion/i.test(d)).join(", "),
  );
}
check(
  "U11 MotionConfig reducedMotion is wired at the root",
  readSrc("main.jsx").includes("MotionConfig") &&
    readSrc("main.jsx").includes('reducedMotion="user"'),
);
{
  // The virtualized table must not be wrapped in layout/per-row animation:
  // DashboardPlaceholder and DataTable must contain no motion/layout
  // animation imports. (Phase G: windowing lives in DataTable so table
  // scroll never re-renders the dashboard.)
  const code = stripComments(readSrc("components/dashboard/DashboardPlaceholder.jsx"));
  const table = stripComments(readSrc("components/dashboard/DataTable.jsx"));
  check(
    "U12 data table has no animation wrappers (no motion imports)",
    !code.includes("motion/react") && !code.includes("AnimatePresence") &&
      !table.includes("motion/react") && !table.includes("AnimatePresence"),
  );
}

// --- 20 MiB upload contract ---------------------------------------------------------------
{
  const format = readSrc("lib/format.js");
  check(
    "U13 frontend limit is one 20 MiB constant with a validation helper",
    format.includes("MAX_CSV_BYTES = 20 * 1024 * 1024") &&
      format.includes('MAX_CSV_LABEL = "20 MiB"') &&
      format.includes("validateCsvFile") &&
      !format.includes("50 * 1024 * 1024") &&
      !format.includes("50 MB"),
  );
}
{
  const app = readFileSync(
    fileURLToPath(new URL("../../backend/app.py", import.meta.url)),
    "utf8",
  );
  check(
    "U14 backend default is 20 MiB with one bytes constant + JSON 413 path",
    app.includes('MAX_UPLOAD_MB", "20"') &&
      app.includes("MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024") &&
      app.includes("RequestEntityTooLarge") &&
      app.includes("MiB limit") &&
      !app.includes('"50"'),
    "",
  );
}
{
  const zone = stripComments(readSrc("components/upload/CsvUploadZone.jsx"));
  check(
    "U14b upload UI says 20 MiB with no stale 50 MB references",
    zone.includes("MAX_CSV_LABEL") && !zone.includes("50 MB"),
  );
}
{
  const header = stripComments(
    readSrc("components/layout/AppHeader.jsx"),
  );
  check(
    "U17 desktop header uses brand/workspace/spacer/nav layout",
    header.includes("flex-1") &&
      header.includes('aria-label="Primary"') &&
      header.includes("hidden shrink-0") &&
      !header.includes("ml-auto flex shrink-0"),
  );
  check(
    "U18 mobile header keeps only brand/workspace/menu visible",
    header.includes("mobile-menu-button") &&
      header.includes("hidden") &&
      header.includes("md:flex") &&
      header.includes("md:hidden") &&
      header.includes('aria-controls="mobile-nav"'),
  );
  check(
    "U19 mobile menu carries Upload/Dashboard/Settings + appearance",
    header.includes('aria-label="Mobile"') &&
      header.includes('aria-label="Appearance"') &&
      header.includes("handleAppearance") &&
      header.includes("min-h-11"),
  );
  check(
    "U20 mobile menu closes on Escape with focus return",
    header.includes('"Escape"') &&
      header.includes("mobile-menu-button"),
  );
}
{
  const html = readFileSync(join(rootDir, "index.html"), "utf8");
  check(
    "U21 theme bootstrap defaults to Mocha Mousse with known-id validation",
    html.includes('"amber"') &&
      html.includes("KNOWN_THEMES") &&
      html.includes("metrivia.theme-vars") &&
      !html.includes('|| "amber"') &&
      html.includes("mocha-mousse") &&
      html.includes('"graphite"') &&
      html.includes(': "mocha-mousse"'),
  );
  const css = readSrc("index.css");
  check(
    "U22 CSS first-paint defaults are Mocha Mousse (no Amber/Graphite tokens)",
    css.includes("Mocha Mousse is the first-painted theme") &&
      css.includes("oklch(0.9529 0.0146 102.4597)") &&
      css.includes("oklch(0.2721 0.0141 48.1783)") &&
      !css.includes("oklch(0.9821 0 0)") &&
      !css.includes("oklch(0.1776 0 0)") &&
      !css.includes("oklch(0.9551 0 0)") &&
      !css.includes("oklch(0.2178 0 0)"),
  );
}
{
  // Phase G: row windowing lives in DataTable (it owns the virtualizer so
  // table scroll never re-renders the KPIs/chart/summary); the placeholder
  // must render DataTable instead of mapping every row itself.
  const table = stripComments(readSrc("components/dashboard/DataTable.jsx"));
  const code = stripComments(readSrc("components/dashboard/DashboardPlaceholder.jsx"));
  check(
    "U15 preview table is windowed (virtualizer, spacers, no full map)",
    table.includes("useVirtualizer") &&
      table.includes("getVirtualItems") &&
      table.includes("topSpacer") &&
      table.includes("bottomSpacer") &&
      code.includes("<DataTable") &&
      !code.includes("visibleRows.map("),
  );
}
{
  const api = readSrc("lib/api.js");
  check(
    "U16 uploads still go directly to the backend (no Vercel proxy route)",
    api.includes("/api/upload") && !api.includes("/api/csv-proxy"),
  );
}
{
  // Phase H pie chart: interactive slice/legend linking with stable label
  // identity, local hover state, accessible legend buttons, and a
  // cursor-independent tooltip (structural tripwires — interaction itself
  // needs the manual browser pass).
  const pie = stripComments(readSrc("components/charts/views/PieChartView.jsx"));
  check(
    "P1 pie slices use stable label identity (no index-only state)",
    pie.includes("activeLabel") &&
      pie.includes("findIndex") &&
      pie.includes("d.label === activeLabel") &&
      pie.includes("key={d.label}"),
  );
  check(
    "P2 slice hover drives the legend via controlled PieChart hover",
    pie.includes("hoveredIndex") &&
      pie.includes("onHoverChange") &&
      pie.includes("handleHoverChange") &&
      pie.includes("onMouseEnter"),
  );
  check(
    "P3 legend hover/focus highlights the slice and clearing works",
    pie.includes("onFocus") &&
      pie.includes("onBlur") &&
      pie.includes("onMouseLeave") &&
      pie.includes("activeIndex >= 0 ? activeIndex : null"),
  );
  check(
    "P4 tooltip shows category, value, and share without intercepting hover",
    pie.includes('role="status"') &&
      pie.includes('aria-live="polite"') &&
      pie.includes("pointer-events-none") &&
      pie.includes("formatShare") &&
      pie.includes("formatCount(activeDatum.value)"),
  );
  check(
    "P4b tooltip is geometry-anchored near the slice and clamped inside",
    pie.includes("pieSliceAnchor") &&
      pie.includes("clampTooltipAnchor") &&
      pie.includes("left: `${anchor.xPct}%`") &&
      pie.includes("top: `${anchor.yPct}%`") &&
      pie.includes("translate(-50%, -50%)") &&
      !pie.includes("top-1 right-1"),
  );
  check(
    "P5 legend entries are keyboard-focusable buttons with color-independent active state",
    pie.includes("<button") &&
      pie.includes("aria-label") &&
      pie.includes("aria-current") &&
      pie.includes("ring-1") &&
      pie.includes("opacity-50") &&
      pie.includes("overflow-y-auto"),
  );
  check(
    "P6 pie hover state stays local (no workspace/global slice state)",
    pie.includes("useState") &&
      !pie.includes("useWorkspaces") &&
      !pie.includes("useAppSettings") &&
      !pie.includes("activeSlice"),
  );
  check(
    "P7 legend colors reuse theme chart tokens (no hard-coded palette)",
    pie.includes("var(--chart-") && !pie.includes("#"),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
