import { useCallback, useMemo } from "react"
import { useWebHaptics } from "web-haptics/react"
import { isIosTouchDevice } from "@/lib/is-ios"
import {
  ANDROID_DIAGNOSTIC_PATTERN,
  runDirectVibrationTest,
} from "@/lib/android-haptic-diagnostic"
import {
  HAPTIC_ACTION_CATEGORY,
  computeHapticScale,
  describeHapticSuppression,
  formatHapticSkipReason,
  getHapticSettings,
} from "@/lib/haptic-settings"

/**
 * Metrivia-specific haptic feedback abstraction.
 *
 * Architecture:
 *
 *   UI component
 *       ↓
 *   useMetriviaHaptics()   (this file — the only place that knows about
 *       ↓                   the third-party library)
 *   web-haptics
 *       ↓
 *   iOS / Android browser haptics
 *
 * Components must call the semantic actions (`tap`, `select`,
 * `chartSelect`, `dataPoint`, `success`, `error`, `warning`) and never import
 * `web-haptics` directly, so the
 * library can be replaced later without touching every component. The
 * intensity lives here, not at the call sites: `tap()` is correct,
 * `trigger("light", { intensity: 0.8 })` in a component is not.
 *
 * Why custom patterns instead of `trigger(preset, { intensity })`:
 * - Verified against the installed web-haptics@0.0.6 bundle: every built-in
 *   preset vibration carries its own per-vibration intensity, and the
 *   library resolves each vibration as `vibration.intensity ??
 *   options.intensity`. The trigger-level `{ intensity }` option therefore
 *   has NO effect on preset names (probed: `trigger("light")` and
 *   `trigger("light", { intensity: 0.75 })` produce the byte-identical
 *   `navigator.vibrate([6, 9])` — a 6 ms buzz). Passing an intensity
 *   alongside a preset name would be a placebo, so each semantic action
 *   below passes an explicit Vibration[] modeled on the preset's rhythm
 *   with stronger per-vibration intensities. Measured Android output:
 *     select  → vibrate [10, 5]            (was [2, 6])
 *     tap     → vibrate [15, 5, 4, 1]      (was [6, 9])
 *     success → vibrate [15, 5, 8, 62, 18, 2, 18, 2, 5]
 *     error   → vibrate [40, 40, 40, 40, 40]  (three solid 40 ms taps)
 *     warning → vibrate [17, 3, 17, 103, 17, 3, 17, 3]
 *   Nothing is long or continuous (longest total: error at 200 ms); only
 *   `error` uses intensity 1.0. Hierarchy is preserved:
 *   select < tap < warning / success / error.
 *
 * Why `chartSelect()` exists alongside `select()`:
 * - Inspection proved every analytics interaction (chart type, dimension,
 *   measure, aggregation, bars, pie slices) already called the exact
 *   strengthened `select()` pattern — the pattern was never the problem.
 * - The real cause is masking: each of those interactions fires at the
 *   exact onset of a visual transient (full chart re-transform + reveal
 *   replay, tooltip pop-in with sibling dimming, OS picker dismissal),
 *   while the filter-drawer baseline fires in a visually quiet context.
 *   A threshold-level 10 ms tick gets perceptually buried under the
 *   transient, so analytics selections need more on-time for the SAME
 *   perceived strength (not a stronger feeling — an equal one).
 * - `chartSelect` is a single short tick of the same character (never a
 *   double-tap, never `tap`'s pattern). Measured Android output:
 *     chartSelect → vibrate [15, 5]  (15 ms on-time)
 *   Hierarchy stays intact: select (10 ms) < chartSelect (15 ms) < tap
 *   (19 ms) < warning / success / error. On iOS both `select` and
 *   `chartSelect` remain a single native switch tick (fixed-tick
 *   limitation); the denser 0.75 actuation interval is the most the
 *   existing mechanism can express.
 *
 * Cross-platform notes:
 * - Android (Chrome and other supported browsers): `web-haptics` converts
 *   the per-vibration intensity into a pulse-width-modulated
 *   `navigator.vibrate()` pattern, so the stronger intensities above
 *   directly mean more motor on-time. Using the library (instead of calling
 *   `navigator.vibrate()` ourselves) is what keeps this cross-platform.
 * - iOS (Safari): iOS does not expose `navigator.vibrate`, and current
 *   iOS/WebKit no longer reliably produces a haptic from a programmatic
 *   `.click()` on the library's hidden switch — the native switch must
 *   receive the user's direct touch. That path lives in `IosHapticSwitch`:
 *   a real, full-bounds, `opacity: 0` (never `display: none`) native
 *   `<input type="checkbox" switch>` rendered inside tappable controls on
 *   iOS only. One physical tap toggles it (native tick) and fires the
 *   existing action exactly once via `onChange`, while the bubbled click is
 *   stopped. Accordingly, every action in this hook is a silent no-op on
 *   iOS: gesture haptics come from the native toggle (so a tick can never
 *   double), and gesture-less events (success/error/wake-ready) are
 *   legitimately silent there. Honest iOS limitations: one fixed native
 *   tick per toggle — no custom intensity/duration — and no haptics for
 *   async events, native selects, filter inputs, or chart marks (SVG cannot
 *   host the switch; those stay Android-only).
 * - Desktop / unsupported browsers: the library no-ops internally, and
 *   every action below is wrapped in try/catch with promise rejection
 *   swallowing, so haptics can never throw an application-level error or
 *   produce any visible change.
 *
 * Accessibility:
 * - `web-haptics` itself does not consult `prefers-reduced-motion`, so this
 *   abstraction suppresses all haptics when the user prefers reduced motion
 *   rather than bypassing that preference.
 *
 * React rules:
 * - Never call these actions during render. Fire them from event handlers
 *   or from effects that detect a real state transition (with a ref guard
 *   so Strict Mode / re-renders cannot double-fire success/error events).
 *   One user action produces one haptic call — there is no overlay switch,
 *   so there is no second haptic source to suppress.
 *
 * Settings layer (Phase 1):
 * - Every action consults the centralized haptic settings
 *   (`@/lib/haptic-settings`) at fire time: the master toggle, the global
 *   intensity, and the action's category level multiply into one scale that
 *   is applied to each vibration's per-vibration intensity (the only
 *   amplitude knob web-haptics exposes — see above). A scale of 0 (or a
 *   disabled master switch) skips the trigger entirely.
 * - Per-call `opts.intensityMultiplier` (default 1) lets special contexts
 *   (Phase 2 scatter drags) scale without touching the global settings.
 * - iOS behavior is unchanged: programmatic actions stay silent there
 *   (native-switch path), and the master toggle additionally suppresses the
 *   native switch via `IosHapticSwitch`. Intensity sliders cannot move the
 *   OS-controlled iOS tick — documented in Settings, not faked here.
 * - Call sites are unchanged: `tap()` etc. with no args keep working.
 */

/**
 * Semantic Metrivia action → explicit Vibration[] pattern.
 * Each pattern keeps its preset's rhythm family (`light`, `selection`,
 * `success`, `error`, `warning`) with stronger per-vibration intensities —
 * see the module comment for why the intensity must live here.
 */
export const METRIVIA_HAPTIC_PATTERNS = {
  // Firm short tap for important buttons, drawer open/close, clears, theme
  // toggle, and navigation. Target intensity 0.70–0.80.
  tap: [{ duration: 25, intensity: 0.75 }],
  // Deliberate tactile click for filter value changes; clearly perceptible
  // but lighter than tap. Target intensity 0.60–0.70. This is the quiet-
  // context baseline — analytics interactions that fire under a visual
  // transient use chartSelect instead (see module comment).
  select: [{ duration: 15, intensity: 0.65 }],
  // Same single-tick character as select, with more on-time so chart
  // configuration and chart-mark taps survive visual-transient masking and
  // read at the same perceived strength as the select baseline.
  chartSelect: [{ duration: 20, intensity: 0.75 }],
  // Scatter point-drag tick: same single-tick family, deliberately lighter
  // than chartSelect. Drags can cross many points in one gesture, so each
  // tick stays small — perceptible alone, never spammy in sequence. Fires
  // at most once per throttle window (see use-scatter-point-haptics).
  dataPoint: [{ duration: 15, intensity: 0.7 }],
  // Unmistakable ascending two-tap for completed operations. Stronger first
  // tap than the preset; no long buzz.
  success: [
    { duration: 30, intensity: 0.75 },
    { delay: 60, duration: 45, intensity: 0.9 },
  ],
  // Three solid taps for failures. The only action at 1.0 (the preset was
  // already 0.9, so solidity — not a number tweak — is the real step up).
  error: [
    { duration: 40, intensity: 1 },
    { delay: 40, duration: 40, intensity: 1 },
    { delay: 40, duration: 40, intensity: 1 },
  ],
  // Two firm taps with the preset's hesitation gap.
  warning: [
    { duration: 40, intensity: 0.85 },
    { delay: 100, duration: 40, intensity: 0.85 },
  ],
}

function prefersReducedMotion() {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
  } catch {
    return false
  }
}

function fireSafely(trigger, pattern) {
  try {
    if (prefersReducedMotion()) return
    const result = trigger?.(pattern)
    // `trigger` resolves when the pattern completes; a rejection must never
    // surface as an application error.
    if (result && typeof result.catch === "function") {
      result.catch(() => {})
    }
  } catch {
    // Unsupported device/browser or any internal failure: fail silently.
  }
}

/**
 * Scale a semantic pattern by the effective settings scale. Returns null
 * when nothing should fire (settings resolve to silence).
 */
function scalePatternForSettings(action, options) {
  const scale = computeHapticScale(action, options)
  if (scale == null) return null
  const scaled = []
  for (const vibration of METRIVIA_HAPTIC_PATTERNS[action] ?? []) {
    const intensity = Math.min(
      1,
      Math.max(0, (vibration.intensity ?? 1) * scale),
    )
    // Drop vibrations scaled to silence; keep duration/delay (rhythm).
    if (intensity <= 0.01) continue
    scaled.push({ ...vibration, intensity })
  }
  return scaled.length > 0 ? scaled : null
}

function fireAction(trigger, iosDirect, action, options) {
  if (iosDirect) return
  const pattern = scalePatternForSettings(action, options)
  if (!pattern) return
  fireSafely(trigger, pattern)
}

/**
 * Development/diagnostic helper (pure, no logging, no side effects).
 *
 * Reports every stage of the central haptic path for one semantic action
 * so an on-device failure can be localized without noisy production logs:
 *
 *   platform.isIosTouchDevice → platform.hasNavigatorVibrate →
 *   platform.webHapticsSupported → accessibility.prefersReducedMotion →
 *   settings (master / global / category) → scale → pattern →
 *   triggerCalled (whether fireAction would invoke the library trigger)
 *
 * - `triggerCalled: true` means the hook handed a pattern to web-haptics;
 *   whether the motor moves then depends on the browser/library stage
 *   (user activation, `navigator.vibrate` policy), which this layer does
 *   not control and does not claim.
 * - `skipReason` is the human-readable Phase A status line for the same
 *   decision (`null` while firing is not a state — when the action fires,
 *   `skipReason` is null and the UI renders "Triggered: …" from
 *   `triggerCalled` instead).
 * - On iOS, `triggerCalled` is always false by design: gesture haptics
 *   come from the direct-touch native switch (`IosHapticSwitch`), never
 *   from programmatic triggers.
 * - Never throws; never exposes anything beyond local haptic state.
 */
export function getHapticDiagnostics(action = "tap", options) {
  try {
    const iosTouch = isIosTouchDevice()
    const hasNavigatorVibrate =
      typeof navigator !== "undefined" &&
      typeof navigator.vibrate === "function"
    const settings = getHapticSettings()
    const category = HAPTIC_ACTION_CATEGORY[action] ?? null
    const categoryLevel =
      category != null ? (settings.categories?.[category] ?? 1) : null
    let reducedMotion = false
    try {
      reducedMotion = prefersReducedMotion()
    } catch {
      reducedMotion = false
    }
    const scale = computeHapticScale(action, options)
    const pattern = scalePatternForSettings(action, options)
    const suppression = describeHapticSuppression(action, options)
    let skipped = null
    let skipReason = null
    if (iosTouch) {
      skipped = "ios-direct"
      skipReason = "iOS native-switch path"
    } else if (reducedMotion) {
      skipped = "reduced-motion"
      skipReason = "Skipped: reduced motion"
    } else if (pattern == null) {
      skipped = "settings-silent"
      skipReason = formatHapticSkipReason(suppression, action)
    }
    return {
      action,
      category,
      platform: {
        isIosTouchDevice: iosTouch,
        hasNavigatorVibrate,
        // Same definition as web-haptics' static `isSupported`.
        webHapticsSupported: hasNavigatorVibrate,
      },
      accessibility: { prefersReducedMotion: reducedMotion },
      settings: {
        enabled: settings.enabled,
        intensity: settings.intensity,
        categoryLevel,
      },
      scale,
      pattern,
      skipped,
      skipReason,
      triggerCalled: skipped == null,
    }
  } catch {
    return {
      action,
      category: null,
      platform: {
        isIosTouchDevice: false,
        hasNavigatorVibrate: false,
        webHapticsSupported: false,
      },
      accessibility: { prefersReducedMotion: false },
      settings: { enabled: false, intensity: 0, categoryLevel: null },
      scale: null,
      pattern: null,
      skipped: "diagnostic-error",
      skipReason: "Skipped: diagnostic error",
      triggerCalled: false,
    }
  }
}

export function useMetriviaHaptics() {
  // Defaults keep `debug`/`showSwitch` off, so no audio fallback and no
  // visible toggle is ever rendered for normal users.
  const { trigger, isSupported } = useWebHaptics()
  // iOS delivers gesture haptics through the direct-touch native switch
  // (`IosHapticSwitch`), never through programmatic trigger calls — and
  // async events (success/error/wake-ready) have no gesture to attach to,
  // so they are legitimately silent there. Suppressing the programmatic
  // path on iOS also guarantees a native tick can never double with a
  // library tick for the same tap. Android/desktop behavior is unchanged.
  const iosDirect = useMemo(() => isIosTouchDevice(), [])

  const tap = useCallback(
    (options) => {
      fireAction(trigger, iosDirect, "tap", options)
    },
    [trigger, iosDirect],
  )
  const select = useCallback(
    (options) => {
      fireAction(trigger, iosDirect, "select", options)
    },
    [trigger, iosDirect],
  )
  const chartSelect = useCallback(
    (options) => {
      fireAction(trigger, iosDirect, "chartSelect", options)
    },
    [trigger, iosDirect],
  )
  // Scatter point-drag haptic. Consumes the `dataPoints` settings category
  // (NOT `charts`): drag intensity is tuned independently of discrete
  // chart taps. Same call-site contract as the other actions.
  const dataPoint = useCallback(
    (options) => {
      fireAction(trigger, iosDirect, "dataPoint", options)
    },
    [trigger, iosDirect],
  )
  const success = useCallback(
    (options) => {
      fireAction(trigger, iosDirect, "success", options)
    },
    [trigger, iosDirect],
  )
  const error = useCallback(
    (options) => {
      fireAction(trigger, iosDirect, "error", options)
    },
    [trigger, iosDirect],
  )
  const warning = useCallback(
    (options) => {
      fireAction(trigger, iosDirect, "warning", options)
    },
    [trigger, iosDirect],
  )

  /**
   * Phase A hardware-path probe (Settings → Test haptic).
   *
   * Synchronously fires the unmistakable direct pattern ([100, 50, 100])
   * through the central layer, bypassing web-haptics' PWM conversion, so a
   * physical test distinguishes "browser/device rejects vibration" from
   * "semantic patterns are too subtle to feel".
   *
   * MUST stay synchronous: call it directly from the click handler (no
   * await/setTimeout before it) so `navigator.vibrate` runs inside the user
   * gesture. Never throws; returns a plain record for the Settings readout:
   *   { decision, skipReason, vibrate, diagnostics }
   * - `vibrate.result === true` means the browser ACCEPTED the call, never
   *   that the motor moved — physical confirmation needs a human.
   * - Intensity sliders do not scale the probe (hardware probe, not a
   *   semantic action); master toggle, reduced motion, and iOS silence do.
   */
  const runHapticProbe = useCallback(() => {
    const diagnostics = getHapticDiagnostics("tap", undefined)
    if (iosDirect) {
      return {
        decision: "skipped",
        skipReason: "iOS native-switch path",
        vibrate: {
          available: diagnostics.platform.hasNavigatorVibrate,
          attempted: false,
          pattern: null,
          result: null,
          error: null,
        },
        diagnostics,
      }
    }
    if (diagnostics.accessibility.prefersReducedMotion) {
      return {
        decision: "skipped",
        skipReason: "Skipped: reduced motion",
        vibrate: {
          available: diagnostics.platform.hasNavigatorVibrate,
          attempted: false,
          pattern: null,
          result: null,
          error: null,
        },
        diagnostics,
      }
    }
    const suppression = describeHapticSuppression("tap", undefined)
    if (suppression != null) {
      return {
        decision: "skipped",
        skipReason: formatHapticSkipReason(suppression, "tap"),
        vibrate: {
          available: diagnostics.platform.hasNavigatorVibrate,
          attempted: false,
          pattern: null,
          result: null,
          error: null,
        },
        diagnostics,
      }
    }
    const vibrate = runDirectVibrationTest(ANDROID_DIAGNOSTIC_PATTERN)
    return {
      decision: vibrate.attempted ? "triggered" : "skipped",
      skipReason: vibrate.attempted
        ? null
        : "Vibration API unavailable in this browser.",
      vibrate,
      diagnostics,
    }
  }, [iosDirect])

  return useMemo(
    () => ({
      tap,
      select,
      chartSelect,
      dataPoint,
      success,
      error,
      warning,
      runHapticProbe,
      isSupported,
    }),
    [
      tap,
      select,
      chartSelect,
      dataPoint,
      success,
      error,
      warning,
      runHapticProbe,
      isSupported,
    ],
  )
}
