/**
 * Central Android vibration diagnostic (Phase A).
 *
 * This module is the ONLY place in Metrivia (outside the third-party
 * `web-haptics` library) that calls `navigator.vibrate()` directly — and it
 * exists solely to isolate the physical-device failure:
 *
 *   Test button → useMetriviaHaptics().runHapticProbe()
 *               → runDirectVibrationTest() → navigator.vibrate([100, 50, 100])
 *
 * Rules:
 * - `runDirectVibrationTest()` MUST be called synchronously from a real user
 *   gesture (no `await` / `setTimeout` / promise / effect before it). The
 *   hook's probe callback is synchronous by construction for this reason.
 * - The probe pattern is deliberately unmistakable ([100, 50, 100]): it must
 *   never be confused with the short 10–25 ms semantic ticks. It intentionally
 *   ignores intensity sliders (a hardware-path probe, not a semantic action)
 *   but still respects the master toggle, reduced motion, and iOS silence —
 *   those gates live in the hook, not here.
 * - `predictVibratePattern()` is pure (no vibration): it mirrors
 *   web-haptics@0.0.6's internal conversion (PWM quantum 20 ms, per-vibration
 *   `intensity ?? fallback`, delay merging) so Settings can show what the
 *   semantic path WOULD hand to `navigator.vibrate` without firing a second
 *   vibrate call (which would cancel the probe buzz). The audit verifies this
 *   mirror against the real library at runtime.
 * - Honesty contract: `navigator.vibrate()` returning `true` means the call
 *   was ACCEPTED, not that the motor moved. Nothing here can confirm physical
 *   vibration — only the person holding the phone can.
 */

export const ANDROID_DIAGNOSTIC_PATTERN = Object.freeze([100, 50, 100])

/** Minimal single-shot probe from the Phase A spec (kept as a fallback). */
export const ANDROID_DIAGNOSTIC_MINIMAL = 200

/** PWM quantum used by web-haptics@0.0.6 (verified against dist bundle). */
const PWM_QUANTUM_MS = 20

/** Maximum single vibration duration accepted by web-haptics@0.0.6. */
const MAX_VIBRATION_MS = 1000

/** True when the browser exposes the Vibration API (lazy — call-time read). */
export function hasVibrationApi() {
  try {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.vibrate === "function"
    )
  } catch {
    return false
  }
}

function readUserAgent() {
  try {
    return typeof navigator !== "undefined" ? navigator.userAgent || "" : ""
  } catch {
    return ""
  }
}

function readTouchPoints() {
  try {
    return typeof navigator !== "undefined" &&
      typeof navigator.maxTouchPoints === "number"
      ? navigator.maxTouchPoints
      : null
  } catch {
    return null
  }
}

/**
 * Best-effort device description for the diagnostic readout. The platform
 * label is a UA heuristic (labeled as such in the UI), never a claim about
 * the motor.
 */
export function describeDevice() {
  const ua = readUserAgent()
  const touchPoints = readTouchPoints()
  return {
    userAgentSnippet: ua ? ua.slice(0, 120) : "",
    touchPoints,
    touchDevice: typeof touchPoints === "number" ? touchPoints > 0 : null,
    looksAndroid: /Android/i.test(ua),
    hasVibrate: hasVibrationApi(),
  }
}

/**
 * Synchronous hardware-path probe. Calls `navigator.vibrate()` in the same
 * task (keeps the user gesture) and records the call outcome.
 *
 * Returns a plain record — never throws:
 *   { available, attempted, pattern, result, error }
 * - `available: false` → no Vibration API in this browser; nothing attempted.
 * - `result` is the raw `navigator.vibrate()` return value (`true` = call
 *   accepted by the browser, NOT physical confirmation).
 * - `error` is a string only when the call itself threw.
 */
export function runDirectVibrationTest(
  pattern = ANDROID_DIAGNOSTIC_PATTERN,
) {
  const probe = Array.isArray(pattern) ? [...pattern] : pattern
  if (!hasVibrationApi()) {
    return {
      available: false,
      attempted: false,
      pattern: Array.isArray(probe) ? probe : null,
      result: null,
      error: null,
    }
  }
  try {
    const result = navigator.vibrate(probe)
    return {
      available: true,
      attempted: true,
      pattern: Array.isArray(probe) ? [...probe] : probe,
      result,
      error: null,
    }
  } catch (error) {
    return {
      available: true,
      attempted: true,
      pattern: Array.isArray(probe) ? [...probe] : probe,
      result: null,
      error:
        error instanceof Error
          ? error.message
          : String(error ?? "unknown error"),
    }
  }
}

function pwmSplit(duration, intensity) {
  if (intensity >= 1) return [duration]
  if (intensity <= 0) return []
  const on = Math.max(1, Math.round(PWM_QUANTUM_MS * intensity))
  const off = PWM_QUANTUM_MS - on
  const out = []
  let remaining = duration
  while (remaining >= PWM_QUANTUM_MS) {
    out.push(on)
    out.push(off)
    remaining -= PWM_QUANTUM_MS
  }
  if (remaining > 0) {
    const head = Math.max(1, Math.round(remaining * intensity))
    out.push(head)
    const tail = remaining - head
    if (tail > 0) out.push(tail)
  }
  return out
}

/**
 * Pure mirror of web-haptics@0.0.6's Vibration[] → navigator.vibrate(number[])
 * conversion. Returns the exact array the library would pass (or null for an
 * invalid/empty pattern, mirroring the library's warn-and-abort). Verified
 * against the real `WebHaptics.trigger` by the haptics audit — if the library
 * is ever upgraded, the audit (not the phone) catches drift first.
 */
export function predictVibratePattern(vibrations, fallbackIntensity = 0.5) {
  if (!Array.isArray(vibrations) || vibrations.length === 0) return null
  const fallback = Math.max(0, Math.min(1, fallbackIntensity ?? 0.5))
  const out = []
  for (const vibration of vibrations) {
    if (!vibration || typeof vibration !== "object") return null
    let duration = vibration.duration
    const delay = vibration.delay ?? 0
    if (typeof duration !== "number" || !Number.isFinite(duration)) return null
    if (duration > MAX_VIBRATION_MS) duration = MAX_VIBRATION_MS
    if (duration < 0) return null
    if (
      vibration.delay !== undefined &&
      (!Number.isFinite(delay) || delay < 0)
    ) {
      return null
    }
    const intensity = Math.max(
      0,
      Math.min(1, vibration.intensity ?? fallback),
    )
    if (delay > 0) {
      if (out.length > 0 && out.length % 2 === 0) {
        out[out.length - 1] += delay
      } else {
        if (out.length === 0) out.push(0)
        out.push(delay)
      }
    }
    const pwm = pwmSplit(duration, intensity)
    if (pwm.length === 0) {
      if (out.length > 0 && out.length % 2 === 0) {
        out[out.length - 1] += duration
      } else if (duration > 0) {
        out.push(0)
        out.push(duration)
      }
      continue
    }
    for (const segment of pwm) out.push(segment)
  }
  return out
}
