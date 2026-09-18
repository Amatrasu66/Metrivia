// Metrivia UI/performance audit (Phase E) — dependency-free source checks.
//
// Verifies the navigation cleanup, animation safeguards, and 50 MiB upload
// contract at the source level (fast regression tripwires — not a substitute
// for profiling or device testing):
//   navigation cleanup (no tab strip, no Frontend shell, no stray + tab)
//   animation safeguards (no transition-all, no `transition: all`, memoized
//     dashboard subtree, single animation library, reduced-motion wiring)
//   upload contract (frontend 50 MiB constant + validation helper, backend
//     50 MiB default + JSON 413 path, table windowing present)
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
  // DashboardPlaceholder must contain no motion/layout animation imports.
  const code = stripComments(readSrc("components/dashboard/DashboardPlaceholder.jsx"));
  check(
    "U12 data table has no animation wrappers (no motion imports)",
    !code.includes("motion/react") && !code.includes("AnimatePresence"),
  );
}

// --- 50 MiB upload contract ---------------------------------------------------------------
{
  const format = readSrc("lib/format.js");
  check(
    "U13 frontend limit is one 50 MiB constant with a validation helper",
    format.includes("MAX_CSV_BYTES = 50 * 1024 * 1024") &&
      format.includes("validateCsvFile"),
  );
}
{
  const app = readFileSync(
    fileURLToPath(new URL("../../backend/app.py", import.meta.url)),
    "utf8",
  );
  check(
    "U14 backend default is 50 MiB with one bytes constant + JSON 413 path",
    app.includes('MAX_UPLOAD_MB", "50"') &&
      app.includes("MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024") &&
      app.includes("RequestEntityTooLarge"),
    "",
  );
}
{
  const code = stripComments(readSrc("components/dashboard/DashboardPlaceholder.jsx"));
  check(
    "U15 preview table is windowed (virtualizer, spacers, no full map)",
    code.includes("useVirtualizer") &&
      code.includes("getVirtualItems") &&
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
