import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { isIosTouchDevice } from "@/lib/is-ios"
import {
  getHapticSettings,
  getHapticSettingsVersion,
  subscribeHapticSettings,
} from "@/lib/haptic-settings"

function readReducedMotion() {
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

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(readReducedMotion)
  useEffect(() => {
    try {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return undefined
      }
      const query = window.matchMedia("(prefers-reduced-motion: reduce)")
      const onChange = () => setReduced(query.matches)
      if (typeof query.addEventListener === "function") {
        query.addEventListener("change", onChange)
        return () => query.removeEventListener("change", onChange)
      }
      return undefined
    } catch {
      return undefined
    }
  }, [])
  return reduced
}

/**
 * Direct-interaction iOS haptic layer.
 *
 * On iOS Safari, WebKit only produces the native switch haptic when a real
 * `<input type="checkbox" switch>` receives the user's physical touch —
 * programmatic `.click()` on a hidden switch no longer works reliably. This
 * component renders that native switch transparently over its parent
 * control (the parent must be positioned, e.g. `relative`), covering exactly
 * the control's bounds:
 *
 *   ONE physical tap
 *     → native switch toggles (iOS native haptic)
 *     → onChange fires the existing action exactly once
 *     → the bubbled click is stopped so the underlying control does NOT
 *       run the action a second time
 *
 * Design constraints honored:
 * - Real, full-bounds, physically tappable switch: `opacity: 0`, never
 *   `display: none` / `visibility: hidden` / zero-sized, never outside the
 *   control's bounds, no page-level hit area.
 * - Renders null on non-iOS devices (Android/desktop DOM is byte-identical
 *   to before), when reduced motion is preferred, when there is no action,
 *   or when the control is disabled.
 * - The haptics master switch (Settings) also removes this layer: when the
 *   user disables haptic feedback, no native tick is produced, but the
 *   underlying control keeps working normally through its click path.
 *   Intensity sliders cannot move the OS-controlled tick; only on/off
 *   applies here (documented in Settings, not faked).
 * - Accessibility: `aria-hidden` + `tabIndex={-1}` keep it out of the
 *   screen-reader control list, focus order, and keyboard path. The visible
 *   control remains the semantic control; keyboard/AT activation runs the
 *   same `onActivate` handler through the normal click path (silently on
 *   iOS, since haptics are never required).
 * - The `switch` attribute is applied via ref so no linter or JSX
 *   attribute allowlist can strip or misinterpret it.
 */
export function IosHapticSwitch({ onActivate, disabled = false }) {
  const reduceMotion = usePrefersReducedMotion()
  // Master haptics toggle: disabling haptics removes the native tick layer
  // (the control itself keeps working via its normal click path).
  const hapticVersion = useSyncExternalStore(
    subscribeHapticSettings,
    getHapticSettingsVersion,
    getHapticSettingsVersion,
  )

  const applySwitchAttribute = useCallback((node) => {
    try {
      node?.setAttribute?.("switch", "")
    } catch {
      // A missing attribute only loses the native look; never break render.
    }
  }, [])

  if (disabled || typeof onActivate !== "function") return null
  if (reduceMotion) return null
  // Subscribed above so toggling haptics in Settings adds/removes this
  // layer immediately; `void` keeps the linter honest about the subscription
  // being intentional even though only the snapshot below is read.
  void hapticVersion
  if (!getHapticSettings().enabled) return null
  if (!isIosTouchDevice()) return null

  const handleChange = (event) => {
    onActivate(event)
  }

  const handleClick = (event) => {
    // The tap already produced the native haptic + the action via change;
    // stop it here so the underlying control never fires a second action.
    event.stopPropagation()
  }

  return (
    <input
      ref={applySwitchAttribute}
      type="checkbox"
      aria-hidden="true"
      tabIndex={-1}
      onChange={handleChange}
      onClick={handleClick}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        margin: 0,
        padding: 0,
        border: 0,
        opacity: 0,
        outline: "none",
      }}
    />
  )
}
