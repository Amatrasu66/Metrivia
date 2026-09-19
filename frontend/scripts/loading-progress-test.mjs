// Metrivia Phase K loading/tetris tests — dependency-free node checks.
//
// Covers Objective A (smart spinner → estimated progress) and Objective B
// (Tetris backend loader) at the source + pure-helper level:
//
//   L1  progress delay is ~800ms (no flash for fast uploads)
//   L2  progress caps at 95 while waiting (never 100 prematurely)
//   L3  staged labels cover the estimated pipeline
//   L4  timers are cleaned up (unmount / workspace close / finish)
//   L5  Progress is accessible + audit-clean (no transition-all)
//   L6  upload zone promotes spinner → progress with a workspace-safe key
//   L7  no polling/SSE/WebSocket/progress API change
//   T1  TetrisLoader contract (props, role, aria-busy, reduced motion)
//   T2  Tetris uses theme vars, stays lightweight, clips layout
//   T3  BackendWakeState keeps elapsed/stages/retry behavior with Tetris
//
// Usage:  npm run loading:test   (from frontend/)
// Exit code is non-zero on any failure.

import { readFileSync } from "node:fs";

const bust = () =>
  `?loading=${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
const srcFile = (rel) =>
  readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");

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

// Pure helper import (no hooks called — safe in node even though the module
// imports React for the hook itself).
let progressLib = null;
try {
  progressLib = await import(`../src/hooks/useDelayedProgress.js${bust()}`);
} catch (err) {
  console.log(`INFO  useDelayedProgress import failed, using source checks: ${err?.message ?? err}`);
}

// --- L1: ~800ms delay ---------------------------------------------------------
{
  const src = srcFile("hooks/useDelayedProgress.js");
  const delayOk =
    src.includes("PROGRESS_DELAY_MS = 800") &&
    src.includes("delayMs = PROGRESS_DELAY_MS");
  const zone = srcFile("components/upload/CsvUploadZone.jsx");
  check(
    "L1 progress promotes only after ~800ms (fast uploads keep spinner)",
    delayOk && progressLib?.PROGRESS_DELAY_MS === 800,
    `PROGRESS_DELAY_MS=${progressLib?.PROGRESS_DELAY_MS}`,
  );
  void zone;
}

// --- L2: cap at 95 ------------------------------------------------------------
{
  const src = srcFile("hooks/useDelayedProgress.js");
  check(
    "L2 progress never exceeds 95 while waiting for the API",
    src.includes("PROGRESS_CAP = 95") &&
      src.includes("Math.min(cap") &&
      progressLib?.PROGRESS_CAP === 95,
    `PROGRESS_CAP=${progressLib?.PROGRESS_CAP}`,
  );
}

// --- L3: staged labels ---------------------------------------------------------
{
  const labels = progressLib?.stageLabelForValue
    ? [0, 10, 20, 40, 60, 80, 92, 95].map((v) => progressLib.stageLabelForValue(v))
    : [];
  const src = srcFile("hooks/useDelayedProgress.js");
  check(
    "L3 staged estimated labels (no backend-percentage claim)",
    labels.join("|") ===
      "Starting analysis|Starting analysis|Reading CSV|Detecting column types|Calculating statistics|Preparing chart data|Finalizing|Waiting for server response" &&
      src.includes("Waiting for server response") &&
      src.includes("estimated") &&
      !src.includes("backend has literally"),
  );
}

// --- L4: timer cleanup ----------------------------------------------------------
{
  const src = srcFile("hooks/useDelayedProgress.js");
  check(
    "L4 timers cancelled on unmount / workspace change / finish",
    src.includes("clearTimeout(delayTimer)") &&
      src.includes("clearTimeout(tickTimer)") &&
      src.includes("cancelled = true") &&
      src.includes("resetKey") &&
      src.includes("return () =>"),
  );
  const analysis = srcFile("components/upload/AnalysisProgressState.jsx");
  check(
    "L4b progress state resets per workspace upload (no cross-talk)",
    analysis.includes("resetKey") && analysis.includes("useDelayedProgress"),
  );
}

// --- L5: accessible + audit-clean Progress ---------------------------------------
{
  const src = srcFile("components/ui/progress.jsx");
  check(
    "L5a Progress exposes progressbar semantics",
    src.includes('role="progressbar"') &&
      src.includes("aria-valuenow") &&
      src.includes("aria-valuemin") &&
      src.includes("aria-valuemax"),
  );
  check(
    "L5b Progress keeps shadcn look without transition-all (ui:audit U6)",
    src.includes("bg-secondary") &&
      src.includes("bg-primary") &&
      src.includes("rounded-full") &&
      src.includes("h-1.5") &&
      !src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|\s)\/\/.*$/gm, "$1")
        .includes("transition-all"),
  );
  check(
    "L5c reduced motion respected in progress + analysis state",
    src.includes("prefers-reduced-motion") &&
      srcFile("components/upload/AnalysisProgressState.jsx").includes('role="status"'),
  );
}

// --- L6: upload zone wiring -------------------------------------------------------
{
  const zone = srcFile("components/upload/CsvUploadZone.jsx");
  check(
    "L6a upload zone uses one smart state for uploading + analyzing",
    zone.includes("AnalysisProgressState") &&
      zone.includes('status === "uploading"') &&
      zone.includes('status === "analyzing"') &&
      !zone.includes('<LoadingState label="Uploading CSV'),
  );
  check(
    "L6b progress key is workspace-upload scoped (no timer leaks)",
    zone.includes("resetKey") &&
      zone.includes("wakeStartedAt") &&
      zone.includes("selectedFile"),
  );
  check(
    "L6c error / ready UI untouched (failure cleans up progress)",
    zone.includes("ErrorState") && zone.includes('status === "error"') && zone.includes('status === "ready"'),
  );
}

// --- L7: no architecture expansion --------------------------------------------------
{
  const hook = srcFile("hooks/useDelayedProgress.js");
  const app = srcFile("App.jsx");
  const api = srcFile("lib/api.js");
  check(
    "L7 no polling/SSE/WebSocket, no upload API change for progress",
    !hook.includes("EventSource") &&
      !hook.includes("WebSocket") &&
      !hook.includes("fetch(") &&
      !hook.includes("setInterval") &&
      api.includes("/api/upload") &&
      !api.includes("progress") &&
      app.includes("uploadCsv"),
  );
}

// --- T1: TetrisLoader contract -------------------------------------------------------
{
  const src = srcFile("components/states/TetrisLoader.jsx");
  check(
    "T1a TetrisLoader supports the supplied prop contract",
    src.includes("columns") &&
      src.includes("rows") &&
      src.includes("cellSize") &&
      src.includes("gap") &&
      src.includes("speed") &&
      src.includes("playing") &&
      src.includes("loop") &&
      src.includes("label"),
  );
  check(
    "T1b loader exposes status + busy semantics",
    src.includes('role="status"') && src.includes("aria-busy"),
  );
  check(
    "T1c reduced-motion renders a static pattern (no timers)",
    src.includes("prefers-reduced-motion") &&
      src.includes("reduceMotion") &&
      src.includes("clearInterval"),
  );
}

// --- T2: theme + weight + layout --------------------------------------------------------
{
  const src = srcFile("components/states/TetrisLoader.jsx");
  check(
    "T2a Tetris uses Metrivia theme vars (no new palette)",
    src.includes("var(--primary)") &&
      src.includes("var(--chart-") &&
      src.includes("var(--muted)") &&
      !src.includes("#ff") &&
      !src.includes("rgb("),
  );
  check(
    "T2b loader is lightweight (single interval, no motion lib)",
    src.includes("setInterval") &&
      !src.includes("motion/react") &&
      !src.includes("framer-motion"),
  );
  check(
    "T2c no layout overflow (bounded, centered, non-blocking)",
    src.includes("overflow-hidden") &&
      src.includes("max-w-full") &&
      src.includes("justify-center"),
  );
}

// --- T3: BackendWakeState integration ------------------------------------------------------
{
  const src = srcFile("components/states/BackendWakeState.jsx");
  check(
    "T3a wake card shows Tetris while waking, Check when ready",
    src.includes("TetrisLoader") &&
      src.includes("isReady") &&
      src.includes("<Check") &&
      !src.includes("Server"),
  );
  check(
    "T3b elapsed + Connecting/Starting/Ready stages preserved",
    src.includes("formatWakeElapsed") &&
      src.includes("WAKE_STAGES") &&
      src.includes("wakeStageMessage") &&
      src.includes("wakeActiveStageIndex"),
  );
  check(
    "T3c wake state stays pure presentation (no fetch, timer cleanup)",
    src.includes("setInterval") &&
      src.includes("clearInterval") &&
      !src.includes("fetch(") &&
      src.includes('role="status"'),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
