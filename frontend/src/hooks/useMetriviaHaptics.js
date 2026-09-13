import { useCallback, useMemo } from "react"
import { useWebHaptics } from "web-haptics/react"

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
 * Components must call the semantic actions (`tap`, `select`, `success`,
 * `error`, `warning`) and never import `web-haptics` directly, so the
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
 * Cross-platform notes:
 * - Android (Chrome and other supported browsers): `web-haptics` converts
 *   the per-vibration intensity into a pulse-width-modulated
 *   `navigator.vibrate()` pattern, so the stronger intensities above
 *   directly mean more motor on-time. Using the library (instead of calling
 *   `navigator.vibrate()` ourselves) is what keeps this cross-platform.
 * - iOS (Safari): iOS does not expose `navigator.vibrate`. The library's
 *   fallback appends a hidden `<label>Haptic feedback<input type="checkbox"
 *   switch></label>` to the body (both elements `display: none` when
 *   `showSwitch` is off, as configured here) and programmatically
 *   `.click()`s it on the pattern timeline. Two honest limitations follow:
 *   (1) iOS provides a fixed native switch tick per actuation — there is
 *   no API for custom intensity/duration, so iOS can never reproduce the
 *   Android intensity curve; (2) higher per-vibration intensity still helps
 *   on iOS because the library re-actuates the switch every
 *   `16 + (1 - intensity) * 184` ms during a segment, so stronger patterns
 *   produce denser actuation (e.g. error ≈ 9 actuations vs 6 before).
 *   No direct-interaction overlay switch was added: intercepting real taps
 *   with a transparent native control could not be verified without
 *   hardware and risks double activation, broken focus/AT behavior, and
 *   invisible hit-areas — while async beats (success/error/wake-ready)
 *   have no tap to intercept at all.
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
  // but lighter than tap. Target intensity 0.60–0.70.
  select: [{ duration: 15, intensity: 0.65 }],
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

export function useMetriviaHaptics() {
  // Defaults keep `debug`/`showSwitch` off, so no audio fallback and no
  // visible toggle is ever rendered for normal users.
  const { trigger, isSupported } = useWebHaptics()

  const tap = useCallback(
    () => fireSafely(trigger, METRIVIA_HAPTIC_PATTERNS.tap),
    [trigger],
  )
  const select = useCallback(
    () => fireSafely(trigger, METRIVIA_HAPTIC_PATTERNS.select),
    [trigger],
  )
  const success = useCallback(
    () => fireSafely(trigger, METRIVIA_HAPTIC_PATTERNS.success),
    [trigger],
  )
  const error = useCallback(
    () => fireSafely(trigger, METRIVIA_HAPTIC_PATTERNS.error),
    [trigger],
  )
  const warning = useCallback(
    () => fireSafely(trigger, METRIVIA_HAPTIC_PATTERNS.warning),
    [trigger],
  )

  return useMemo(
    () => ({ tap, select, success, error, warning, isSupported }),
    [tap, select, success, error, warning, isSupported],
  )
}
