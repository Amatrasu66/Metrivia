/**
 * Centralized Metrivia haptic-settings store.
 *
 * This owns the *semantic* settings layer only:
 *
 *   UI (Settings page)
 *     ↓
 *   useAppSettings() / this store
 *     ↓
 *   useMetriviaHaptics()   (reads the store at fire time)
 *     ↓
 *   platform implementation (web-haptics / iOS native switch)
 *
 * The existing haptic architecture (patterns, iOS native-switch path,
 * reduced-motion suppression) is untouched — this only decides *whether* a
 * semantic action fires and at what *scale*.
 *
 * Platform honesty:
 * - Android (navigator.vibrate path): per-vibration `intensity` scaling is
 *   real — the global/category/call-site multipliers below directly change
 *   motor on-time via web-haptics' PWM conversion.
 * - iOS: gesture haptics come from the OS-controlled native switch tick
 *   (`IosHapticSwitch`), which exposes no amplitude control to JavaScript.
 *   Intensity sliders therefore cannot affect the iOS tick; the master
 *   toggle DOES apply on iOS by suppressing the native switch entirely.
 */

export const HAPTIC_STORAGE_KEY = "metrivia.haptics"

/**
 * Categories shown in Settings. `action` names the semantic
 * useMetriviaHaptics() method it scales. Every category has a live consumer.
 */
export const HAPTIC_CATEGORIES = [
  {
    id: "buttons",
    label: "Buttons",
    hint: "Navigation, toggles and primary actions.",
    action: "tap",
  },
  {
    id: "filters",
    label: "Filters",
    hint: "Filter value changes.",
    action: "select",
  },
  {
    id: "charts",
    label: "Charts",
    hint: "Chart controls and chart-mark taps.",
    action: "chartSelect",
  },
  {
    id: "dataPoints",
    label: "Data points",
    hint: "Touches on individual scatter points while dragging across the chart.",
    action: "dataPoint",
  },
  {
    id: "success",
    label: "Success",
    hint: "Completed uploads and backend recovery.",
    action: "success",
  },
  {
    id: "errors",
    label: "Errors",
    hint: "Failures and warnings.",
    action: "error",
  },
]

/** Semantic action → settings category (warning shares the errors level). */
export const HAPTIC_ACTION_CATEGORY = {
  tap: "buttons",
  select: "filters",
  chartSelect: "charts",
  dataPoint: "dataPoints",
  success: "success",
  error: "errors",
  warning: "errors",
}

export const DEFAULT_HAPTIC_SETTINGS = Object.freeze({
  enabled: true,
  intensity: 1,
  categories: Object.freeze({
    buttons: 1,
    filters: 1,
    charts: 1,
    dataPoints: 1,
    success: 1,
    errors: 1,
  }),
})

function toUnit(value, fallback) {
  // null/undefined/"" mean "missing" (fall back); anything else goes
  // through Number() so numeric strings still work, while NaN/Infinity
  // and out-of-range values clamp safely. Note Number(null) === 0, hence
  // the explicit missing check first.
  if (value == null || value === "") return fallback
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

/**
 * Validate + clamp a raw (possibly hostile) stored object. Never throws,
 * never propagates NaN/Infinity/negatives/malformed shapes.
 */
export function sanitizeHapticSettings(raw) {
  const fallback = DEFAULT_HAPTIC_SETTINGS
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      enabled: fallback.enabled,
      intensity: fallback.intensity,
      categories: { ...fallback.categories },
    }
  }
  const rawCategories =
    raw.categories && typeof raw.categories === "object"
      ? raw.categories
      : {}
  const categories = {}
  for (const { id } of HAPTIC_CATEGORIES) {
    categories[id] = toUnit(rawCategories[id], fallback.categories[id])
  }
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
    intensity: toUnit(raw.intensity, fallback.intensity),
    categories,
  }
}

function readStored() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null
    const raw = window.localStorage.getItem(HAPTIC_STORAGE_KEY)
    if (raw == null) return null
    return sanitizeHapticSettings(JSON.parse(raw))
  } catch {
    return null
  }
}

function writeStored(settings) {
  try {
    window?.localStorage?.setItem(
      HAPTIC_STORAGE_KEY,
      JSON.stringify(settings),
    )
  } catch {
    // Private mode etc. — settings still apply for this session.
  }
}

// In-memory cache is the source of truth at fire time; persistence is
// debounced for slider drags so rapid moves don't spam localStorage.
let cache = readStored() ?? sanitizeHapticSettings(null)
let version = 0
let persistTimer = null
const listeners = new Set()

function notify() {
  version += 1
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // A settings listener must never break haptics.
    }
  }
}

function schedulePersist(immediate) {
  if (immediate) {
    if (persistTimer !== null) {
      clearTimeout(persistTimer)
      persistTimer = null
    }
    writeStored(cache)
    return
  }
  if (persistTimer !== null) return
  try {
    persistTimer = setTimeout(() => {
      persistTimer = null
      writeStored(cache)
    }, 200)
  } catch {
    writeStored(cache)
  }
}

/** Current settings snapshot (sanitized; safe to read at fire time). */
export function getHapticSettings() {
  return cache
}

/**
 * Machine-readable reason a semantic action would stay silent, or null when
 * it is allowed to fire. Pure function of the store + per-call options.
 * Codes: "disabled" | "unknown-action" | "intensity-zero" | "category-zero"
 * | "silent" (defensive fallback — unreachable with sanitized settings).
 */
export function describeHapticSuppression(action, options) {
  const settings = getHapticSettings()
  if (!settings.enabled) return "disabled"
  const category = HAPTIC_ACTION_CATEGORY[action]
  if (!category) return "unknown-action"
  if (!(settings.intensity > 0)) return "intensity-zero"
  if (!((settings.categories?.[category] ?? 1) > 0)) return "category-zero"
  if (computeHapticScale(action, options) == null) return "silent"
  return null
}

/**
 * Human-readable skip reason for diagnostics UI. Mirrors the Phase A
 * vocabulary ("Skipped: …") so on-device reports are unambiguous.
 */
export function formatHapticSkipReason(code, action) {
  if (code === "disabled") return "Skipped: haptics disabled"
  if (code === "unknown-action") return "Skipped: unknown action"
  if (code === "intensity-zero") return "Skipped: intensity = 0"
  if (code === "category-zero") {
    const category = HAPTIC_ACTION_CATEGORY[action] ?? "category"
    return `Skipped: ${category} intensity = 0`
  }
  return "Skipped: silent (settings)"
}

/** Monotonic counter for useSyncExternalStore subscriptions. */
export function getHapticSettingsVersion() {
  return version
}

export function subscribeHapticSettings(listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Merge a partial update ({ enabled?, intensity?, categories? }) into the
 * store. Category updates merge per-key. Options: { persist: "immediate" |
 * "debounced" } — sliders use debounced, toggles/reset use immediate.
 */
export function updateHapticSettings(patch, { persist = "immediate" } = {}) {
  if (!patch || typeof patch !== "object") return cache
  const next = sanitizeHapticSettings({
    enabled: patch.enabled ?? cache.enabled,
    intensity: patch.intensity ?? cache.intensity,
    categories: { ...cache.categories, ...(patch.categories ?? {}) },
  })
  cache = next
  schedulePersist(persist === "immediate")
  notify()
  return cache
}

/** Restore factory defaults (master on, full intensity everywhere). */
export function resetHapticSettings() {
  cache = sanitizeHapticSettings(null)
  schedulePersist(true)
  notify()
  return cache
}

/** Flush any pending debounced write (e.g. before unload in tests). */
export function flushHapticSettingsPersist() {
  if (persistTimer !== null) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  writeStored(cache)
}

function normalizeCallMultiplier(value) {
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.min(n, 4)
}

/**
 * Effective 0..1 firing scale for a semantic action, or null when it must
 * stay silent (master off, unknown action, or a zero scale). Pure function
 * of the store + per-call options; the hook applies it to its patterns.
 */
export function computeHapticScale(action, options) {
  const settings = getHapticSettings()
  if (!settings.enabled) return null
  const category = HAPTIC_ACTION_CATEGORY[action]
  if (!category) return null
  const categoryLevel = settings.categories?.[category] ?? 1
  const scale =
    settings.intensity *
    categoryLevel *
    normalizeCallMultiplier(options?.intensityMultiplier)
  if (!Number.isFinite(scale) || scale <= 0) return null
  return Math.min(scale, 1)
}
