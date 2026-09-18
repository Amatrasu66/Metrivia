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
  THEME_CATALOG,
  THEME_CATEGORY_META,
  THEME_CATEGORY_ORDER,
} from "./theme-catalog.js"
export {
  APPEARANCES,
  THEME_DATA_ATTR,
  THEME_VARS_STORAGE_KEY,
  applyThemeTokens,
  buildThemeCssVars,
  getFeaturedThemes,
  getSystemMode,
  getThemeById,
  getThemeCategory,
  getThemeCategoryLabel,
  getThemesByCategory,
  isThemeFeatured,
  isValidAppearance,
  isValidThemeId,
  resolveAppearance,
  resolveEffectiveMode,
  resolveTheme,
  resolveThemeId,
  searchThemes,
  subscribeToSystemMode,
  withFontFallback,
} from "./theme-utils.js"
