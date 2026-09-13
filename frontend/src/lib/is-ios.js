/**
 * Conservative iOS touch-device detection for the haptic layer.
 *
 * Used to decide whether the direct-interaction native-switch haptic path
 * (`IosHapticSwitch`) applies. Deliberately narrow:
 * - iPhone / iPad / iPod via UA, plus iPadOS 13+ desktop-mode UA
 *   (`MacIntel` platform with multi-touch). All iOS browsers use WebKit,
 *   so Chrome/Firefox on iOS are intentionally included.
 * - macOS desktop Safari is excluded (MacIntel without multi-touch).
 * - Anything uncertain returns false: Android keeps the vibration path and
 *   desktop stays silent. A false negative only loses haptics, never
 *   behavior; a false positive on a non-haptic touchscreen still runs the
 *   action exactly once via the same handler.
 */

function readUserAgent() {
  try {
    return typeof navigator !== "undefined"
      ? navigator.userAgent || ""
      : ""
  } catch {
    return ""
  }
}

export function isIosTouchDevice() {
  try {
    if (typeof navigator === "undefined") return false
    if (/iPhone|iPad|iPod/i.test(readUserAgent())) return true
    // iPadOS 13+ reports a desktop Mac UA; multi-touch distinguishes it
    // from a real Mac.
    if (
      navigator.platform === "MacIntel" &&
      typeof navigator.maxTouchPoints === "number" &&
      navigator.maxTouchPoints > 1
    ) {
      return true
    }
    return false
  } catch {
    return false
  }
}
