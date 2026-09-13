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
 * library can be replaced later without touching every component.
 *
 * Cross-platform notes:
 * - Android (Chrome and other supported browsers): `web-haptics` drives
 *   the Vibration API (`navigator.vibrate`) with intensity-shaped patterns.
 * - iOS (Safari): iOS does not expose `navigator.vibrate`, so
 *   `web-haptics` additionally drives a hidden switch element whose
 *   programmatic toggle produces the system haptic on iOS. Using the
 *   library (instead of calling `navigator.vibrate()` ourselves) is what
 *   gives us both platforms from a single API.
 * - Desktop / unsupported browsers: the library no-ops internally (its
 *   hidden switch stays `display: none`, `showSwitch`/`debug` stay off),
 *   and every action below is wrapped in try/catch with promise rejection
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
 */

/** Semantic Metrivia action → `web-haptics` preset. */
export const METRIVIA_HAPTIC_PRESETS = {
  tap: "light",
  select: "selection",
  success: "success",
  error: "error",
  warning: "warning",
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

function fireSafely(trigger, preset) {
  try {
    if (prefersReducedMotion()) return
    const result = trigger?.(preset)
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
    () => fireSafely(trigger, METRIVIA_HAPTIC_PRESETS.tap),
    [trigger],
  )
  const select = useCallback(
    () => fireSafely(trigger, METRIVIA_HAPTIC_PRESETS.select),
    [trigger],
  )
  const success = useCallback(
    () => fireSafely(trigger, METRIVIA_HAPTIC_PRESETS.success),
    [trigger],
  )
  const error = useCallback(
    () => fireSafely(trigger, METRIVIA_HAPTIC_PRESETS.error),
    [trigger],
  )
  const warning = useCallback(
    () => fireSafely(trigger, METRIVIA_HAPTIC_PRESETS.warning),
    [trigger],
  )

  return useMemo(
    () => ({ tap, select, success, error, warning, isSupported }),
    [tap, select, success, error, warning, isSupported],
  )
}
