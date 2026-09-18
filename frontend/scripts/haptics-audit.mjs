// Metrivia haptics recovery audit — dependency-free focused checks.
//
// Covers the Android central trigger path (runtime, against the real
// installed web-haptics), the settings/sanitization layer, the diagnostic
// helper, and source-level iOS-coverage / nesting / central-layer rules.
//
// Usage:  npm run haptics:audit   (from frontend/)
// Exit code is non-zero on any failure.
import { register } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

register(new URL("./alias-hooks.mjs", import.meta.url));

const srcFile = (rel) =>
  readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");
const srcUrl = (rel) => String(new URL(`../src/${rel}`, import.meta.url));
const bust = () =>
  `?audit=${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const vibrateCalls = [];
const store = new Map();
const localStorageStub = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
const fakeNavigator = {
  userAgent: ANDROID_UA,
  platform: "Linux armv8l",
  maxTouchPoints: 5,
  vibrate: (pattern) => {
    vibrateCalls.push(Array.isArray(pattern) ? [...pattern] : pattern);
    return true;
  },
};
Object.defineProperty(globalThis, "navigator", {
  value: fakeNavigator,
  writable: true,
  configurable: true,
});
globalThis.window = {
  navigator: fakeNavigator,
  localStorage: localStorageStub,
  matchMedia: () => ({ matches: false }),
};
globalThis.localStorage = localStorageStub;

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

// ---------------------------------------------------------------------------
// A. Android central path (runtime, real modules + real web-haptics)
// ---------------------------------------------------------------------------
const { isIosTouchDevice } = await import(
  `${srcUrl("lib/is-ios.js")}${bust()}`
);
check("A1 android UA is not an iOS touch device", isIosTouchDevice() === false);

const hs = await import(`${srcUrl("lib/haptic-settings.js")}${bust()}`);
const defaults = hs.getHapticSettings();
check(
  "A2 default settings are enabled at full intensity everywhere",
  defaults.enabled === true &&
    defaults.intensity === 1 &&
    ["buttons", "filters", "charts", "dataPoints", "success", "errors"].every(
      (c) => defaults.categories[c] === 1,
    ),
);

const ACTIONS = [
  "tap",
  "select",
  "chartSelect",
  "dataPoint",
  "success",
  "error",
  "warning",
];
for (const action of ACTIONS) {
  check(
    `A3 computeHapticScale("${action}") allows the trigger by default`,
    hs.computeHapticScale(action, undefined) === 1,
  );
}

const hook = await import(`${srcUrl("hooks/useMetriviaHaptics.js")}${bust()}`);
const PATTERNS = hook.METRIVIA_HAPTIC_PATTERNS;
check(
  "A4 all 7 semantic patterns are non-empty Vibration[]",
  ACTIONS.every(
    (a) =>
      Array.isArray(PATTERNS[a]) &&
      PATTERNS[a].length > 0 &&
      PATTERNS[a].every((v) => Number.isFinite(v.duration)),
  ),
);

const { WebHaptics } = await import(
  `${String(new URL("../node_modules/web-haptics/dist/index.mjs", import.meta.url))}${bust()}`
);
check(
  "A5 web-haptics reports supported when navigator.vibrate exists",
  WebHaptics.isSupported === true,
);

// Exact replica of the hook's private scale/fire helpers (pure logic).
function scalePattern(action, options) {
  const scale = hs.computeHapticScale(action, options);
  if (scale == null) return null;
  const scaled = [];
  for (const vibration of PATTERNS[action] ?? []) {
    const intensity = Math.min(
      1,
      Math.max(0, (vibration.intensity ?? 1) * scale),
    );
    if (intensity <= 0.01) continue;
    scaled.push({ ...vibration, intensity });
  }
  return scaled.length > 0 ? scaled : null;
}

const wh = new WebHaptics();
for (const action of ACTIONS) {
  vibrateCalls.length = 0;
  const pattern = scalePattern(action, undefined);
  if (pattern) await wh.trigger(pattern);
  check(
    `A6 android gesture "${action}" reaches navigator.vibrate`,
    vibrateCalls.length === 1 && vibrateCalls[0].length > 0,
    JSON.stringify(vibrateCalls),
  );
}
wh.destroy();

// dataPoints is independent from charts (Part 22 requirement).
hs.updateHapticSettings({ categories: { charts: 0 } });
check(
  "A7 charts=0 silences chartSelect but not dataPoint",
  hs.computeHapticScale("chartSelect", undefined) == null &&
    hs.computeHapticScale("dataPoint", undefined) === 1,
);
hs.updateHapticSettings({ categories: { charts: 1, dataPoints: 0 } });
check(
  "A8 dataPoints=0 silences dataPoint but not chartSelect",
  hs.computeHapticScale("dataPoint", undefined) == null &&
    hs.computeHapticScale("chartSelect", undefined) === 1,
);
hs.resetHapticSettings();
hs.updateHapticSettings({ enabled: false });
check(
  "A9 master off suppresses every action",
  ACTIONS.every((a) => hs.computeHapticScale(a, undefined) == null),
);
hs.resetHapticSettings();

// ---------------------------------------------------------------------------
// B. Stale-storage sanitization
// ---------------------------------------------------------------------------
async function settingsWith(raw) {
  store.clear();
  if (raw !== null) store.set("metrivia.haptics", raw);
  return import(`${srcUrl("lib/haptic-settings.js")}${bust()}`);
}
check(
  "B1 missing storage falls back to safe defaults",
  (await settingsWith(null)).getHapticSettings().enabled === true,
);
{
  const s = (await settingsWith("not-json{{{")).getHapticSettings();
  check("B2 corrupt JSON falls back to safe defaults", s.enabled === true && s.intensity === 1);
}
{
  const s = (
    await settingsWith(JSON.stringify({ enabled: true }))
  ).getHapticSettings();
  check(
    "B3 missing categories backfill to 1 (no silent zero)",
    s.categories.charts === 1 && s.categories.dataPoints === 1,
  );
}
{
  const s = (
    await settingsWith(
      JSON.stringify({
        enabled: true,
        intensity: NaN,
        categories: { buttons: Infinity, filters: -2, charts: "x", dataPoints: null },
      }),
    )
  ).getHapticSettings();
  check(
    "B4 NaN/Infinity/negative/string/null clamp to safe values",
    s.intensity === 1 &&
      s.categories.buttons === 1 &&
      s.categories.filters === 0 &&
      s.categories.charts === 1 &&
      s.categories.dataPoints === 1,
  );
}
store.clear();

// ---------------------------------------------------------------------------
// C. Diagnostic helper (dev-only, source-testable, no logging)
// ---------------------------------------------------------------------------
const diag = hook.getHapticDiagnostics("tap", undefined);
check(
  "C1 diagnostics report triggerCalled on android defaults",
  diag.triggerCalled === true &&
    diag.skipped == null &&
    diag.scale === 1 &&
    Array.isArray(diag.pattern) &&
    diag.platform.isIosTouchDevice === false &&
    diag.platform.hasNavigatorVibrate === true,
  JSON.stringify(diag),
);
check(
  "C2 diagnostics expose no sensitive data (keys allowlisted)",
  Object.keys(diag).sort().join(",") ===
    "accessibility,action,category,pattern,platform,scale,settings,skipReason,skipped,triggerCalled",
);
fakeNavigator.userAgent = IPHONE_UA;
delete fakeNavigator.vibrate;
const diagIos = hook.getHapticDiagnostics("tap", undefined);
check(
  "C3 diagnostics report ios-direct silence on iPhone (no vibrate API)",
  diagIos.triggerCalled === false &&
    diagIos.skipped === "ios-direct" &&
    diagIos.platform.isIosTouchDevice === true &&
    diagIos.platform.hasNavigatorVibrate === false,
  JSON.stringify(diagIos.platform),
);
fakeNavigator.userAgent = ANDROID_UA;
fakeNavigator.vibrate = (pattern) => {
  vibrateCalls.push(Array.isArray(pattern) ? [...pattern] : pattern);
  return true;
};

// ---------------------------------------------------------------------------
// D. Source-structure rules
// ---------------------------------------------------------------------------
const hookSrc = srcFile("hooks/useMetriviaHaptics.js");
// Code-only view: prose comments legitimately name presets/APIs, so
// structural rules must ignore them.
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
const hookCode = stripComments(hookSrc);
check(
  "D1 semantic hook stays silent on iOS (iosDirect early return)",
  hookCode.includes("if (iosDirect) return"),
);
check(
  "D2 trigger() is only ever called with a Vibration[] pattern",
  !hookCode.includes('trigger("') && !hookCode.includes("trigger('"),
);

// Central-layer rule: only the hook may import web-haptics, and no
// component may call navigator.vibrate directly (portable file walk —
// no shell grep, so this runs on Windows/macOS/Linux).
function walkSrc(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = walkSrc(full, out);
    else if (/\.(js|jsx)$/.test(entry)) out.push(full);
  }
  return out;
}
const srcDir = fileURLToPath(new URL("../src/", import.meta.url));
const srcFiles = walkSrc(srcDir);
{
  // Only import statements count: comments legitimately discuss the library.
  const importRe = /from\s+["']web-haptics[^"']*["']/;
  const importers = srcFiles
    .filter((f) => importRe.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(srcDir.length).replace(/\\/g, "/"));
  check(
    "D3 only useMetriviaHaptics imports web-haptics",
    importers.length === 1 && importers[0] === "hooks/useMetriviaHaptics.js",
    importers.join(", "),
  );
}
{
  // Executable calls only — comments and `typeof x === "function"` reads
  // are not vibration requests. Exactly one file may call it: the central
  // Phase A diagnostic (lib/android-haptic-diagnostic.js), used only through
  // the hook's synchronous probe. Components must never call it directly.
  const allowedDirect = new Set(["lib/android-haptic-diagnostic.js"]);
  const direct = srcFiles
    .filter((f) => stripComments(readFileSync(f, "utf8")).includes("navigator.vibrate("))
    .map((f) => f.slice(srcDir.length).replace(/\\/g, "/"));
  const unexpected = direct.filter((f) => !allowedDirect.has(f));
  check(
    "D4 direct vibrate() lives only in the central diagnostic",
    direct.length === 1 && unexpected.length === 0,
    direct.join(", "),
  );
}

const iosSwitchSrc = srcFile("components/haptics/IosHapticSwitch.jsx");
check(
  "D5 native switch is suppressed when haptics are off / reduced motion / non-iOS",
  iosSwitchSrc.includes("if (!getHapticSettings().enabled) return null") &&
    iosSwitchSrc.includes("if (reduceMotion) return null") &&
    iosSwitchSrc.includes("if (!isIosTouchDevice()) return null"),
);

const themeCardSrc = srcFile("components/settings/ThemeCard.jsx");
check(
  "D6 ThemeCard has an iOS switch only on inactive cards (reselect silent)",
  themeCardSrc.includes("IosHapticSwitch") &&
    themeCardSrc.includes("{selected ? null : <IosHapticSwitch"),
);

const settingsSrc = srcFile("components/settings/SettingsPage.jsx");
check(
  "D7 appearance buttons have iOS switches only on inactive modes",
  settingsSrc.includes("{selected ? null : (") &&
    settingsSrc.includes("handleAppearance(option.id)"),
);
check(
  "D8 master-switch overlay uses a boolean closure (never the raw event)",
  settingsSrc.includes("onActivate={() => handleMasterToggle(!haptics.enabled)}") &&
    !settingsSrc.includes("onActivate={handleMasterToggle}"),
);
{
  // No nested switches: IosHapticSwitch must not render inside Switch.Root.
  const rootStart = settingsSrc.indexOf("<Switch.Root");
  const rootEnd = settingsSrc.indexOf("</Switch.Root>");
  const nested =
    rootStart !== -1 &&
    rootEnd !== -1 &&
    settingsSrc.slice(rootStart, rootEnd).includes("IosHapticSwitch");
  check("D9 no native switch nested inside the Base UI switch", !nested);
}

const buttonSrc = srcFile("components/ui/button.jsx");
check(
  "D10 shared Button carries exactly one iOS switch (no duplicates)",
  (buttonSrc.match(/<IosHapticSwitch/g) || []).length === 1,
);
const sheetSrc = srcFile("components/ui/sheet.jsx");
check(
  "D11 SheetClose carries exactly one iOS switch",
  (sheetSrc.match(/<IosHapticSwitch/g) || []).length === 1,
);

// ---------------------------------------------------------------------------
// E. Haptic coverage matrix (Part 20): every surface classified + wired
// ---------------------------------------------------------------------------
const MATRIX = [
  // [surface, file, evidence, android, ios]
  ["nav Upload/Dashboard", "components/layout/AppHeader.jsx", "tap()", "semantic tap", "native Button tick"],
  ["workspace select", "components/workspaces/WorkspaceSelector.jsx", "handleSelect", "semantic select", "native row tick"],
  ["workspace close", "components/workspaces/WorkspaceSelector.jsx", "handleClose", "semantic tap", "native close tick"],
  ["workspace new (+)", "components/workspaces/WorkspaceSelector.jsx", "handleCreate", "semantic tap", "native Button tick"],
  ["nav Settings (desktop+mobile)", "components/layout/AppHeader.jsx", "handleNavigate", "semantic tap", "native Button tick"],
  ["mobile menu toggle", "components/layout/AppHeader.jsx", "handleMenuToggle", "semantic tap", "native Button tick"],
  ["theme toggle", "components/theme/ThemeToggle.jsx", "tap()", "semantic tap", "native Button tick"],
  ["hero Upload a CSV", "components/landing/UploadPage.jsx", "scrollToUpload", "semantic tap", "native Button tick"],
  ["hero View dashboard", "components/landing/UploadPage.jsx", "handleViewDashboard", "semantic tap", "native Button tick"],
  ["file picker trigger", "components/upload/CsvUploadZone.jsx", "openFileDialog", "semantic tap", "native Button tick"],
  ["upload remove", "components/upload/CsvUploadZone.jsx", "handleRemove", "semantic tap", "native Button tick"],
  ["upload continue", "components/upload/CsvUploadZone.jsx", "handleContinue", "semantic tap", "native Button tick"],
  ["upload retry", "components/states/ErrorState.jsx", "handleRetry", "semantic tap", "native Button tick"],
  ["upload dismiss", "components/states/ErrorState.jsx", "handleDismiss", "semantic tap", "native Button tick"],
  ["dashboard open filters", "components/dashboard/DashboardLayout.jsx", "handleOpenFilters", "semantic tap", "native Button tick"],
  ["dashboard remove file", "components/dashboard/DashboardLayout.jsx", "handleRemoveFile", "semantic tap", "native Button tick"],
  ["dashboard upload new", "components/dashboard/DashboardLayout.jsx", "handleBackToUpload", "semantic tap", "native Button tick"],
  ["empty dashboard CTA", "components/dashboard/DashboardPlaceholder.jsx", "handleUpload", "semantic tap", "native Button tick"],
  ["empty chart clear filters", "components/dashboard/DashboardPlaceholder.jsx", "resetFilters", "semantic tap", "native Button tick"],
  ["filter drawer clear all", "components/dashboard/FilterSheet.jsx", "handleReset", "semantic tap", "native tick (link switch + Button)"],
  ["filter drawer done", "components/dashboard/FilterSheet.jsx", "handleDone", "semantic tap", "native Button tick"],
  ["filter drawer close (X)", "components/dashboard/FilterSheet.jsx", "handleClose", "semantic tap", "native SheetClose tick"],
  ["categorical checkbox", "components/dashboard/FilterPanel.jsx", "toggleValue", "semantic select", "intentionally silent (native input)"],
  ["date from/to", "components/dashboard/FilterPanel.jsx", "setBounds", "semantic select", "intentionally silent (native input)"],
  ["numeric min/max", "components/dashboard/FilterPanel.jsx", "setBounds", "semantic select", "intentionally silent (native input)"],
  ["chart type buttons", "components/charts/ChartBuilder.jsx", "handleChartTypeChange", "semantic chartSelect", "native tick (inactive only)"],
  ["dimension/measure/aggregation", "components/charts/FieldSelect.jsx", "chartSelect()", "semantic chartSelect", "intentionally silent (native select)"],
  ["bar mark", "components/charts/bar.jsx", "onClick={chartSelect}", "semantic chartSelect", "intentionally silent (SVG)"],
  ["pie slice", "components/charts/pie-slice.jsx", "onClick={chartSelect}", "semantic chartSelect", "intentionally silent (SVG)"],
  ["scatter point drag", "components/charts/use-scatter-point-haptics.js", "dataPoint()", "semantic dataPoint", "intentionally silent (SVG hit-test)"],
  ["theme palette cards", "components/settings/SettingsPage.jsx", "handleSelectTheme", "semantic tap", "native tick (inactive only)"],
  ["appearance light/dark/system", "components/settings/SettingsPage.jsx", "handleAppearance", "semantic tap", "native tick (inactive only)"],
  ["master haptic toggle", "components/settings/SettingsPage.jsx", "handleMasterToggle", "semantic tap (on-enable)", "native row tick (on-enable)"],
  ["settings reset", "components/settings/SettingsPage.jsx", "handleReset", "semantic tap (post-reset defaults)", "native Button tick"],
  ["settings test haptic", "components/settings/SettingsPage.jsx", "handleTestHaptic", "direct probe [100,50,100]", "API-unavailable message"],
  ["settings semantic tap", "components/settings/SettingsPage.jsx", "handleTestSemanticTap", "semantic tap", "intentionally silent (no programmatic tick)"],
  ["sliders", "components/settings/HapticSlider.jsx", "no haptics while dragging", "silent (no spam)", "silent (no spam)"],
  ["backend ready beat", "App.jsx", "hapticSuccess", "async effect (browser policy)", "intentionally silent (async)"],
  ["analysis success", "App.jsx", "hapticSuccess", "async effect (browser policy)", "intentionally silent (async)"],
  ["upload/backend error", "App.jsx", "hapticError", "async effect (browser policy)", "intentionally silent (async)"],
  ["drag-over highlight", "components/upload/CsvUploadZone.jsx", "setIsDragging", "silent (continuous)", "silent (continuous)"],
  ["line/area hover + brush", "components/charts/use-chart-interaction.js", "interactionHandlers", "silent (continuous)", "silent (continuous)"],
];
let wired = 0;
for (const [surface, file, evidence, android, ios] of MATRIX) {
  const ok = srcFile(file).includes(evidence);
  if (ok) wired += 1;
  else {
    fail += 1;
    console.log(`FAIL  E matrix "${surface}" missing evidence "${evidence}" in ${file}`);
  }
}
pass += wired;
console.log(`\nCoverage matrix: ${wired}/${MATRIX.length} surfaces wired as classified`);
for (const [surface, , , android, ios] of MATRIX) {
  console.log(`  - ${surface}: android=${android}; ios=${ios}`);
}

// ---------------------------------------------------------------------------
// F. Phase A Android diagnostic path (direct probe + suppression reasons)
// ---------------------------------------------------------------------------
const diagLib = await import(
  `${srcUrl("lib/android-haptic-diagnostic.js")}${bust()}`
);
check(
  "F1 diagnostic probe pattern is the unmistakable [100,50,100]",
  JSON.stringify([...diagLib.ANDROID_DIAGNOSTIC_PATTERN]) === "[100,50,100]",
);
check(
  "F2 minimal single-shot probe constant is 200",
  diagLib.ANDROID_DIAGNOSTIC_MINIMAL === 200,
);

// F3: synchronous direct call — no await between call and observation, so a
// regression into an async/deferred call would fail this check.
vibrateCalls.length = 0;
const probeResult = diagLib.runDirectVibrationTest();
check(
  "F3 direct probe calls navigator.vibrate synchronously and reports true",
  probeResult.available === true &&
    probeResult.attempted === true &&
    probeResult.result === true &&
    probeResult.error == null &&
    vibrateCalls.length === 1 &&
    JSON.stringify(vibrateCalls[0]) === "[100,50,100]",
  JSON.stringify({ probeResult, vibrateCalls }),
);

// F4: unavailable-API path never throws and reports honestly.
{
  const savedVibrate = fakeNavigator.vibrate;
  delete fakeNavigator.vibrate;
  let noApi = null;
  let threw = false;
  try {
    noApi = diagLib.runDirectVibrationTest();
  } catch {
    threw = true;
  }
  check(
    "F4 missing vibrate API reports available:false without throwing",
    threw === false &&
      noApi != null &&
      noApi.available === false &&
      noApi.attempted === false &&
      noApi.result == null &&
      diagLib.hasVibrationApi() === false,
    JSON.stringify(noApi),
  );
  fakeNavigator.vibrate = savedVibrate;
}
check(
  "F5 vibration API is reported available again after restore",
  diagLib.hasVibrationApi() === true,
);

// F6: suppression codes distinguish every silent-settings case.
hs.updateHapticSettings({ enabled: false });
check(
  "F6a master off suppresses with code disabled",
  hs.describeHapticSuppression("tap", undefined) === "disabled" &&
    hs.formatHapticSkipReason("disabled", "tap") ===
      "Skipped: haptics disabled",
);
hs.resetHapticSettings();
hs.updateHapticSettings({ intensity: 0 });
check(
  "F6b global intensity 0 suppresses with code intensity-zero",
  hs.describeHapticSuppression("tap", undefined) === "intensity-zero" &&
    hs.formatHapticSkipReason("intensity-zero", "tap") ===
      "Skipped: intensity = 0",
);
hs.resetHapticSettings();
hs.updateHapticSettings({ categories: { buttons: 0 } });
check(
  "F6c category intensity 0 suppresses with code category-zero",
  hs.describeHapticSuppression("tap", undefined) === "category-zero" &&
    hs.formatHapticSkipReason("category-zero", "tap") ===
      "Skipped: buttons intensity = 0",
);
hs.resetHapticSettings();
check(
  "F6d defaults allow firing (no suppression)",
  hs.describeHapticSuppression("tap", undefined) == null,
);

// F7: the pure predictor matches the REAL web-haptics conversion for every
// semantic action at 100% and 50% global intensity, plus a bare pattern
// (fallback-intensity parity). Drift (e.g. a library upgrade changing the
// PWM math) fails here — not on the phone.
{
  const wh2 = new WebHaptics();
  let predictorOk = true;
  const predictorMismatches = [];
  async function expectPrediction(label, vibrations) {
    vibrateCalls.length = 0;
    if (vibrations) await wh2.trigger(vibrations);
    const predicted = diagLib.predictVibratePattern(vibrations);
    const actual = vibrateCalls[0];
    if (JSON.stringify(predicted) !== JSON.stringify(actual)) {
      predictorOk = false;
      predictorMismatches.push(
        `${label}: predicted=${JSON.stringify(predicted)} actual=${JSON.stringify(actual)}`,
      );
    }
  }
  for (const action of ACTIONS) {
    await expectPrediction(`${action}@100%`, scalePattern(action, undefined));
  }
  hs.updateHapticSettings({ intensity: 0.5 });
  for (const action of ACTIONS) {
    await expectPrediction(`${action}@50%`, scalePattern(action, undefined));
  }
  hs.resetHapticSettings();
  await expectPrediction("bare-duration", [{ duration: 30 }]);
  wh2.destroy();
  check(
    "F7 predictor matches web-haptics vibrate() output (100%/50%/fallback)",
    predictorOk,
    predictorMismatches.join(" | "),
  );
}

// F8: structural rules — probe stays central and synchronous, UI only calls
// the hook, diagnostics carry the Phase A skip vocabulary.
{
  const hookCodeF8 = stripComments(hookSrc);
  check(
    "F8a hook exposes a synchronous central probe (no direct vibrate call)",
    hookSrc.includes("runHapticProbe") &&
      hookSrc.includes("runDirectVibrationTest") &&
      !hookCodeF8.includes("navigator.vibrate("),
  );
  check(
    "F8b hook diagnostics carry skipReason + Phase A vocabulary",
    hookSrc.includes("skipReason") &&
      hookSrc.includes("describeHapticSuppression") &&
      hookSrc.includes("Skipped: reduced motion") &&
      hookSrc.includes("iOS native-switch path"),
  );
  const settingsCode = stripComments(settingsSrc);
  check(
    "F8c settings test path goes through the hook probe only",
    settingsSrc.includes("handleTestHaptic") &&
      settingsSrc.includes("handleTestSemanticTap") &&
      settingsSrc.includes("runHapticProbe") &&
      !settingsCode.includes("navigator.vibrate("),
  );
  const hapticSettingsSrc = srcFile("lib/haptic-settings.js");
  check(
    "F8d settings module exposes suppression codes + skip reasons",
    hapticSettingsSrc.includes("describeHapticSuppression") &&
      hapticSettingsSrc.includes("Skipped: haptics disabled") &&
      hapticSettingsSrc.includes("Skipped: intensity = 0") &&
      hapticSettingsSrc.includes("intensity = 0"),
  );
}

// ---------------------------------------------------------------------------
// G. Phase F Android physical-chain diagnostics (return value + context)
// ---------------------------------------------------------------------------
{
  const device = diagLib.describeDevice();
  check(
    "G1 diagnostic exposes navigator.vibrate return value honest contract",
    probeResult.result === true &&
      probeResult.attempted === true &&
      diagLib.ANDROID_DIAGNOSTIC_PATTERN.join(",") === "100,50,100",
  );
  check(
    "G2 device report carries gesture/visibility/browser context",
    device &&
      "visibility" in device &&
      "hasFocus" in device &&
      "userActivation" in device &&
      "looksBrave" in device &&
      "looksChrome" in device &&
      "hasVibrate" in device &&
      "looksAndroid" in device,
  );
  const settingsCodeG = stripComments(settingsSrc);
  check(
    "G3 settings readout shows vibrate() return + chain (no physical claim)",
    settingsSrc.includes("navigator.vibrate result") &&
      settingsSrc.includes("call accepted — not physical proof") &&
      settingsSrc.includes("browser rejected the call") &&
      settingsSrc.includes("Document visible") &&
      settingsSrc.includes("User activation") &&
      settingsSrc.includes("only you holding the phone") &&
      !settingsCodeG.includes("navigator.vibrate("),
  );
  const hookCodeG = stripComments(hookSrc);
  check(
    "G4 direct probe still uses strong [100,50,100] synchronously",
    hookSrc.includes("runDirectVibrationTest") &&
      hookSrc.includes("ANDROID_DIAGNOSTIC_PATTERN") &&
      !hookCodeG.includes("navigator.vibrate("),
  );
  check(
    "G5 semantic haptics stay synchronous via central trigger",
    hookCodeG.includes("fireAction(trigger") &&
      !hookCodeG.includes("setTimeout") &&
      hookCode.includes('trigger("') === false,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
