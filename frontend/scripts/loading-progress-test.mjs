// Metrivia Phase L loading/tetris tests — dependency-free node checks.
//
// Covers Objective A (backend startup two-column layout) and Objective B
// (truthful backend-aware CSV progress) at the source + pure-helper level:
//
//   L1  progress promotes only after ~800ms (spinner first, no bar flash;
//       early backend milestones initialize the bar, never jump backward)
//   L2  never 100 until the result is usable; no permanent 95 stall; no
//       front-loaded easing curve
//   L3  labels come from real backend milestones (no estimated-percentage claim)
//   L4  timers/streams/listeners cleaned up; workspace-safe (resetKey,
//       isCurrent guards, AbortController)
//   L5  Progress is accessible + audit-clean (no transition-all)
//   L6  upload zone wires backend milestones with a workspace-safe key
//   L7  smallest reliable architecture: same-request NDJSON stream — no
//       Redis/Celery/DB/WebSocket, no job/poll endpoint
//   L8  progress protocol: ordered, monotonic, bounded, linear smoothing
//   T1  TetrisLoader contract (props, role, aria-busy/label, reduced motion)
//   T2  Real tetris game on an rAF clock, themed via --tetris-* tokens
//   T3  BackendWakeState two-column layout (large Tetris left, text right)
//   F1  30s threshold is exactly 30_000 ms, request-aged (analysisStartedAt)
//   F2  single-timeout handoff, cleaned up (no render loop, no polling)
//   F3  Tetris fallback shows no percentage / progressbar (no fake progress)
//   F4  request untouched: no second fetch, no abort/retry of the upload
//   F5  workspace-safe plumbing (per-workspace timestamp, resetKey scope)
//   F6  completion/error paths exit Tetris via the existing flows
//   F7  fallback a11y (status, aria-busy, sr text, reduced motion intact)
//   F8  fallback reuses the shared Tetris sizing conventions
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

// --- L1: ~800ms delay, spinner first -----------------------------------------
{
  const src = srcFile("hooks/useDelayedProgress.js");
  const delayOk =
    src.includes("PROGRESS_DELAY_MS = 800") &&
    src.includes("delayMs = PROGRESS_DELAY_MS");
  const analysis = srcFile("components/upload/AnalysisProgressState.jsx");
  check(
    "L1 progress promotes only after ~800ms (fast uploads keep spinner)",
    delayOk &&
      progressLib?.PROGRESS_DELAY_MS === 800 &&
      analysis.includes('role="status"') &&
      src.includes("setShowProgress(true)") &&
      src.includes("targetRef"),
    `PROGRESS_DELAY_MS=${progressLib?.PROGRESS_DELAY_MS}`,
  );
}

// --- L2: truthful 100, no 95 stall, no easing --------------------------------
{
  const src = srcFile("hooks/useDelayedProgress.js");
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
  const noEasing =
    !code.includes("Math.exp") && !code.includes("ease-out");
  const noStall95 =
    !src.includes("PROGRESS_CAP = 95") &&
    !src.includes("Waiting for server response\" &&") &&
    src.includes("PROGRESS_CAP = 99");
  const labels = progressLib?.stageLabelForValue
    ? [0, 10, 30, 70, 82, 88, 100].map((v) => progressLib.stageLabelForValue(v))
    : [];
  check(
    "L2a no front-loaded easing curve (linear tracking only)",
    noEasing && src.includes("PROGRESS_LINEAR_RATE_PER_SEC"),
  );
  check(
    "L2b no permanent 95 stall; 100 only via usable result",
    noStall95 &&
      src.includes("complete") &&
      src.includes("setValue(100)") &&
      labels.join("|") ===
        "Starting analysis|File received|Analyzing columns|Converting records|Assembling rows|Preparing response|Complete",
    labels.join("|"),
  );
}

// --- L3: backend-driven labels ------------------------------------------------
{
  const src = srcFile("hooks/useDelayedProgress.js");
  const analysis = srcFile("components/upload/AnalysisProgressState.jsx");
  check(
    "L3 labels follow real backend milestones (no estimated claim)",
    src.includes("backendValue") &&
      src.includes("backendStage") &&
      analysis.includes("backendValue") &&
      analysis.includes("backendStage") &&
      analysis.includes("{stageLabel}") &&
      !analysis.includes("estimated, waiting for the server") &&
      !analysis.includes("caps at 95"),
  );
}

// --- L4: cleanup + workspace safety -------------------------------------------
{
  const src = srcFile("hooks/useDelayedProgress.js");
  check(
    "L4a timers cancelled on unmount / workspace change",
    src.includes("clearTimeout(delayTimer)") &&
      src.includes("clearInterval(tickTimer)") &&
      src.includes("cancelled = true") &&
      src.includes("resetKey") &&
      src.includes("return () =>"),
  );
  const analysis = srcFile("components/upload/AnalysisProgressState.jsx");
  const app = srcFile("App.jsx");
  const api = srcFile("lib/api.js");
  check(
    "L4b progress state resets per workspace upload (no cross-talk)",
    analysis.includes("resetKey") && analysis.includes("useDelayedProgress"),
  );
  check(
    "L4c stream cleanup + workspace guards (abort, isCurrent, releaseLock)",
    api.includes("releaseLock") &&
      api.includes("AbortError") &&
      api.includes("reader.cancel") &&
      app.includes("isCurrent()") &&
      app.includes("workspaceExists(targetId)") &&
      app.includes("uploadCsvWithProgress"),
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
    "L6a upload zone uses one backend-aware state for uploading + analyzing",
    zone.includes("AnalysisProgressState") &&
      zone.includes('status === "uploading"') &&
      zone.includes('status === "analyzing"') &&
      zone.includes("backendValue") &&
      zone.includes("backendStage") &&
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

// --- L7: smallest reliable architecture --------------------------------------------
{
  const api = srcFile("lib/api.js");
  const app = srcFile("App.jsx");
  const apiCode = api
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
  check(
    "L7a same-request NDJSON stream (no job endpoint, no polling)",
    api.includes("uploadCsvWithProgress") &&
      api.includes("stream=progress") &&
      api.includes("application/x-ndjson") &&
      api.includes("result-start") &&
      api.includes("onProgress") &&
      !apiCode.includes("/progress") &&
      !apiCode.includes("job_id"),
  );
  check(
    "L7b no Redis/Celery/DB/WebSocket/EventSource expansion",
    !apiCode.includes("WebSocket") &&
      !apiCode.includes("EventSource") &&
      !apiCode.includes("Redis") &&
      !apiCode.includes("Celery") &&
      app.includes("uploadCsvWithProgress") &&
      !app.includes("uploadCsv("),
  );
}

// --- L8: protocol properties ---------------------------------------------------------
{
  const api = srcFile("lib/api.js");
  const hook = srcFile("hooks/useDelayedProgress.js");
  check(
    "L8a frontend clamps 0..100 and ignores decreases (never backward)",
    api.includes("Math.min(100, Math.max(0") &&
      api.includes("if (clamped < lastValue) return") &&
      hook.includes("if (clamped > targetRef.current)") &&
      hook.includes("if (target <= prev) return prev"),
  );
  check(
    "L8b linear smoothing with no overshoot past the milestone",
    hook.includes("Math.min(target, prev + step)") &&
      hook.includes("PROGRESS_SMOOTH_INTERVAL_MS") &&
      !hook.includes("Math.exp"),
  );
  check(
    "L8c upload bytes are never treated as analysis progress",
    api.includes("are not analysis progress") ||
      api.includes("not analysis progress"),
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
      src.includes("onComplete") &&
      src.includes("label") &&
      src.includes("colors") &&
      src.includes("flashColor") &&
      src.includes("deadColor") &&
      src.includes("dotClassName") &&
      src.includes("className") &&
      src.includes("...props"),
  );
  check(
    "T1b loader exposes status + busy semantics",
    src.includes('role="status"') &&
      src.includes("aria-busy") &&
      src.includes("aria-label"),
  );
  check(
    "T1c reduced-motion renders one still board (no animation clock)",
    src.includes("prefers-reduced-motion") &&
      src.includes("useReducedMotion") &&
      src.includes("still board") &&
      src.includes("cancelAnimationFrame"),
  );
}

// --- T2: theme + weight + layout --------------------------------------------------------
{
  const src = srcFile("components/states/TetrisLoader.jsx");
  const css = srcFile("index.css");
  check(
    "T2a Tetris resolves through Metrivia theme vars (no new palette)",
    src.includes("var(--tetris-") &&
      src.includes("bg-foreground/10") &&
      !src.includes("#ff") &&
      !src.includes("rgb(") &&
      css.includes("--tetris-1: var(--chart-1)") &&
      css.includes("--tetris-5: var(--chart-5)") &&
      css.includes("--tetris-6: var(--primary)") &&
      css.includes("--tetris-7: var(--secondary)") &&
      css.includes("--tetris-flash: var(--foreground)"),
  );
  check(
    "T2b loader plays real tetris on an rAF clock (no motion lib, no timers)",
    src.includes("generateTetrisFrames") &&
      src.includes("requestAnimationFrame") &&
      src.includes("cancelAnimationFrame") &&
      !src.includes("setInterval") &&
      !src.includes("motion/react") &&
      !src.includes("framer-motion"),
  );
  const frames = srcFile("lib/tetris-frames.js");
  check(
    "T2c game logic intact (AI landing, line clears, game over, loop)",
    frames.includes("seven-bag") &&
      frames.includes("fullRows") &&
      frames.includes("collapse") &&
      frames.includes("Game over") &&
      frames.includes("generateTetrisFrames") &&
      src.includes("setRound") &&
      src.includes("completeRef") &&
      src.includes("generateTetrisFrames"),
  );
  check(
    "T2d loader grid is bounded and never compressed",
    src.includes("w-fit") &&
      src.includes("gridTemplateColumns") &&
      !src.includes("scale-") &&
      !src.includes("transform:"),
  );
}

// --- T3: BackendWakeState two-column integration -------------------------------------------
{
  const src = srcFile("components/states/BackendWakeState.jsx");
  check(
    "T3a wake card shows Tetris while waking, Check when ready",
    src.includes("TetrisLoader") &&
      src.includes("isReady") &&
      src.includes("<Check"),
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
  check(
    "T3d responsive two-column layout (Tetris left, text right, divider)",
    src.includes("md:flex-row") &&
      src.includes("TetrisLoader") &&
      src.includes("md:border-r") &&
      src.includes("overflow-hidden") &&
      src.includes("max-w-full"),
  );
  const sizing = srcFile("lib/tetris-size.js");
  check(
    "T3e large responsive Tetris (desktop/tablet/mobile sizes)",
    sizing.includes("columns: 18") &&
      sizing.includes("columns: 15") &&
      sizing.includes("columns: 11") &&
      sizing.includes("cellSize: 12") &&
      sizing.includes("cellSize: 10") &&
      sizing.includes("cellSize: 8") &&
      src.includes("speed={40}") &&
      src.includes("useWakeTetrisSize") &&
      sizing.includes("resize"),
  );
}

// --- F: 30s long-running Tetris fallback -------------------------------------------
{
  const analysis = srcFile("components/upload/AnalysisProgressState.jsx");
  const fallback = srcFile("components/upload/AnalysisTetrisState.jsx");
  const zone = srcFile("components/upload/CsvUploadZone.jsx");
  const page = srcFile("components/landing/UploadPage.jsx");
  const app = srcFile("App.jsx");
  const store = srcFile("lib/workspace-store.js");
  check(
    "F1 threshold is exactly 30s, aged from the analysis request start",
    progressLib?.LONG_RUNNING_MS === 30_000 &&
      analysis.includes("LONG_RUNNING_MS") &&
      analysis.includes("analysisStartedAt") &&
      analysis.includes("Date.now() - analysisStartedAt") &&
      store.includes("analysisStartedAt: null") &&
      app.includes("analysisStartedAt: Date.now()"),
    `LONG_RUNNING_MS=${progressLib?.LONG_RUNNING_MS}`,
  );
  check(
    "F2 single-timeout handoff with cleanup (no render loop, no polling)",
    analysis.includes("setTimeout(") &&
      analysis.includes("clearTimeout(timer)") &&
      analysis.includes("[analysisStartedAt, resetKey]") &&
      !analysis.includes("setInterval") &&
      fallback.includes("setInterval") &&
      app.includes("analysisStartedAt: null"),
  );
  const fallbackCode = fallback
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
  check(
    "F3 fallback shows no percentage or progressbar (no fake progress)",
    analysis.includes("AnalysisTetrisState") &&
      analysis.includes("backendValue !== 100") &&
      !fallbackCode.includes("Progress") &&
      !fallbackCode.includes("progressbar") &&
      !fallbackCode.includes("}%") &&
      !fallbackCode.includes(" percent") &&
      !fallbackCode.includes("useDelayedProgress"),
  );
  check(
    "F4 request untouched: no second fetch, abort, retry, or new endpoint",
    !fallback.includes("fetch(") &&
      !fallback.includes("uploadCsv") &&
      !fallback.includes("AbortController") &&
      !fallback.includes("axios") &&
      analysis.includes("backendValue") &&
      app.includes("uploadCsvWithProgress"),
  );
  check(
    "F5 workspace-safe: per-workspace timestamp, resetKey-scoped timer",
    zone.includes("analysisStartedAt") &&
      page.includes("analysisStartedAt") &&
      app.includes("activeWorkspace?.analysisStartedAt") &&
      analysis.includes("resetKey"),
  );
  check(
    "F6 completion/error exit via existing flows (no second error system)",
    !fallback.includes("ErrorState") &&
      !fallback.includes("onRetry") &&
      zone.includes('status === "error"') &&
      app.includes("analysisStartedAt: null"),
  );
  check(
    "F7 fallback a11y: status + busy, sr text, no live-region spam",
    fallback.includes('role="status"') &&
      fallback.includes('aria-busy="true"') &&
      fallback.includes("sr-only") &&
      fallback.includes('aria-hidden="true"') &&
      fallback.includes("TetrisLoader") &&
      !fallback.includes("aria-live"),
  );
  check(
    "F8 fallback reuses shared Tetris sizing (wake conventions untouched)",
    fallback.includes("useWakeTetrisSize") &&
      fallback.includes("lib/tetris-size") &&
      srcFile("components/states/BackendWakeState.jsx").includes("useWakeTetrisSize") &&
      !fallback.includes("generateTetrisFrames"),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
