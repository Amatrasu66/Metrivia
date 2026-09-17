import { APPEARANCES } from "@/lib/themes/theme-utils"
import { resolveAppearance, resolveThemeId } from "@/lib/themes"

export const THEME_ID_STORAGE_KEY = "metrivia.theme-id"
export const APPEARANCE_STORAGE_KEY = "metrivia.appearance"
/** Pre-multi-theme key that stored "light"/"dark" directly. */
export const LEGACY_THEME_STORAGE_KEY = "metrivia-theme"

function getStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null
  } catch {
    return null
  }
}

function readKey(key) {
  try {
    return getStorage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function writeSettingsKey(key, value) {
  try {
    getStorage()?.setItem(key, value)
  } catch {
    // Private mode etc. — settings still apply for this session.
  }
}

function removeKey(key) {
  try {
    getStorage()?.removeItem(key)
  } catch {
    // Non-fatal housekeeping.
  }
}

/** Legacy "metrivia-theme" (light/dark) migrates to the appearance setting. */
export function readInitialAppearance() {
  const stored = readKey(APPEARANCE_STORAGE_KEY)
  if (stored != null) return resolveAppearance(stored)
  const legacy = readKey(LEGACY_THEME_STORAGE_KEY)
  if (legacy === APPEARANCES.LIGHT || legacy === APPEARANCES.DARK) {
    writeSettingsKey(APPEARANCE_STORAGE_KEY, legacy)
    removeKey(LEGACY_THEME_STORAGE_KEY)
    return legacy
  }
  // No stored preference: follow the OS (the previous default behavior).
  return APPEARANCES.SYSTEM
}

export function readInitialThemeId() {
  const stored = readKey(THEME_ID_STORAGE_KEY)
  return resolveThemeId(stored)
}
