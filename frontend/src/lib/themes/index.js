/**
 * Central theme module — the single import point for theme data + helpers.
 * Components must use this (or `useAppSettings()`) instead of hard-coding
 * palettes or reaching into localStorage directly.
 */
export {
  BUILTIN_THEMES,
  DEFAULT_THEME_ID,
  THEMES,
} from "./theme-registry.js"
export {
  APPEARANCES,
  THEME_DATA_ATTR,
  applyThemeTokens,
  buildThemeCssVars,
  getSystemMode,
  getThemeById,
  isValidAppearance,
  isValidThemeId,
  resolveAppearance,
  resolveEffectiveMode,
  resolveTheme,
  resolveThemeId,
  subscribeToSystemMode,
  withFontFallback,
} from "./theme-utils.js"
