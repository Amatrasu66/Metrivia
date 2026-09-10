/**
 * Reusable application theme mechanism (light/dark).
 *
 * - Selection persists in localStorage; defaults to the OS preference.
 * - Applied via the `dark` class on document.documentElement (pairs with
 *   the Tailwind v4 `@custom-variant dark` in index.css).
 * - No third-party theme library. No re-renders, navigation, or requests.
 */

export const THEME_STORAGE_KEY = "metrivia-theme"

export const THEMES = {
  LIGHT: "light",
  DARK: "dark",
}

const META_COLORS = {
  [THEMES.LIGHT]: "#f5f0e6",
  [THEMES.DARK]: "#37291f",
}

function getDocument() {
  return typeof document === "undefined" ? null : document
}

function getWindow() {
  return typeof window === "undefined" ? null : window
}

export function getStoredTheme() {
  try {
    const value = getWindow()?.localStorage.getItem(THEME_STORAGE_KEY)
    return value === THEMES.DARK || value === THEMES.LIGHT ? value : null
  } catch {
    return null
  }
}

export function getSystemTheme() {
  try {
    return getWindow()?.matchMedia?.("(prefers-color-scheme: dark)")?.matches
      ? THEMES.DARK
      : THEMES.LIGHT
  } catch {
    return THEMES.LIGHT
  }
}

/** Stored preference wins; otherwise the OS scheme; otherwise light. */
export function resolveInitialTheme() {
  return getStoredTheme() ?? getSystemTheme()
}

/** Apply without side effects beyond DOM + storage (no reload/API). */
export function applyTheme(theme) {
  const mode = theme === THEMES.DARK ? THEMES.DARK : THEMES.LIGHT
  const doc = getDocument()
  doc?.documentElement.classList.toggle("dark", mode === THEMES.DARK)
  if (doc?.documentElement) {
    doc.documentElement.style.colorScheme = mode
  }
  const meta = doc?.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute("content", META_COLORS[mode])
  try {
    getWindow()?.localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    // Private mode etc. — theme still applies for this session.
  }
  return mode
}

export function oppositeTheme(theme) {
  return theme === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK
}
