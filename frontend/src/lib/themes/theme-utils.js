import { DEFAULT_THEME_ID, THEMES } from "./theme-registry.js"
import {
  THEME_CATALOG,
  THEME_CATEGORY_META,
  THEME_CATEGORY_ORDER,
} from "./theme-catalog.js"

/**
 * Pure theme helpers + global theme application.
 *
 * Design:
 * - The registry (`theme-registry.js`) is the single source of truth for
 *   which themes exist and what their light/dark tokens are.
 * - `buildThemeCssVars()` is pure (easy to reason about / test): it merges
 *   the active token set with Metrivia-specific derived tokens.
 * - `applyThemeTokens()` writes the result to `document.documentElement` as
 *   inline CSS custom properties, so Tailwind v4's `@theme inline` mappings
 *   (`bg-background`, `text-primary`, `var(--chart-1)` …) follow instantly
 *   with no reload and no per-component switching logic.
 * - Theme (which palette) and appearance (light/dark/system) are orthogonal:
 *   appearance only selects which of the theme's two token sets is applied.
 */

export const APPEARANCES = {
  LIGHT: "light",
  DARK: "dark",
  SYSTEM: "system",
}

/** Attribute on <html> carrying the active theme id. */
export const THEME_DATA_ATTR = "data-theme"

// ---------------------------------------------------------------------------
// Registry lookups
// ---------------------------------------------------------------------------

export function getThemeById(id) {
  return THEMES.find((t) => t.id === id) ?? null
}

export function isValidThemeId(id) {
  return typeof id === "string" && THEMES.some((t) => t.id === id)
}

/** Unknown/missing ids fall back to the default theme (never throw). */
export function resolveThemeId(raw) {
  return isValidThemeId(raw) ? raw : DEFAULT_THEME_ID
}

export function resolveTheme(raw) {
  return getThemeById(resolveThemeId(raw))
}

// ---------------------------------------------------------------------------
// Catalog: categories, featured rail, search (presentation metadata only —
// tokens always come from the registry).
// ---------------------------------------------------------------------------

/** Primary gallery category id for a theme ("neutral" fallback, never null). */
export function getThemeCategory(id) {
  const entry = THEME_CATALOG[id]
  const category = entry?.category
  return category != null && THEME_CATEGORY_META[category] != null
    ? category
    : "neutral"
}

/** Human-readable category label for a theme. */
export function getThemeCategoryLabel(id) {
  return THEME_CATEGORY_META[getThemeCategory(id)].label
}

export function isThemeFeatured(id) {
  return THEME_CATALOG[id]?.featured === true
}

/** Featured themes first in registry order (small, curated rail). */
export function getFeaturedThemes() {
  return THEMES.filter((theme) => isThemeFeatured(theme.id))
}

/**
 * Non-featured themes grouped by primary category, in
 * THEME_CATEGORY_ORDER (featured excluded — it is a highlight rail, not a
 * second home). Returns [{ id, label, blurb, themes }], skipping empties.
 */
export function getThemesByCategory() {
  const groups = []
  for (const id of THEME_CATEGORY_ORDER) {
    if (id === "featured") continue
    const themes = THEMES.filter(
      (theme) => getThemeCategory(theme.id) === id,
    )
    if (themes.length === 0) continue
    groups.push({ id, ...THEME_CATEGORY_META[id], themes })
  }
  return groups
}

/**
 * Case-insensitive search across name, description, category label, and
 * catalog keywords. Blank queries return every theme in registry order.
 * Pure — safe to unit-test in node.
 */
export function searchThemes(query) {
  const needle = String(query ?? "").trim().toLowerCase()
  if (needle === "") return [...THEMES]
  return THEMES.filter((theme) => {
    const haystack = [
      theme.name,
      theme.description,
      getThemeCategoryLabel(theme.id),
      ...(THEME_CATALOG[theme.id]?.keywords ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
    return needle
      .split(/\s+/)
      .filter(Boolean)
      .every((word) => haystack.includes(word))
  })
}

// ---------------------------------------------------------------------------
// Appearance (light / dark / system)
// ---------------------------------------------------------------------------

export function isValidAppearance(value) {
  return (
    value === APPEARANCES.LIGHT ||
    value === APPEARANCES.DARK ||
    value === APPEARANCES.SYSTEM
  )
}

/** Unknown/missing values fall back to following the OS (existing behavior). */
export function resolveAppearance(raw) {
  return isValidAppearance(raw) ? raw : APPEARANCES.SYSTEM
}

function getWindow() {
  return typeof window === "undefined" ? null : window
}

function getDocument() {
  return typeof document === "undefined" ? null : document
}

export function getSystemMode() {
  try {
    return getWindow()?.matchMedia?.("(prefers-color-scheme: dark)")?.matches
      ? APPEARANCES.DARK
      : APPEARANCES.LIGHT
  } catch {
    return APPEARANCES.LIGHT
  }
}

/** Map an appearance setting to the concrete mode to render right now. */
export function resolveEffectiveMode(appearance) {
  const resolved = resolveAppearance(appearance)
  if (resolved === APPEARANCES.SYSTEM) return getSystemMode()
  return resolved
}

/** Invoke `cb(mode)` whenever the OS color-scheme preference changes. */
export function subscribeToSystemMode(cb) {
  try {
    const win = getWindow()
    const query = win?.matchMedia?.("(prefers-color-scheme: dark)")
    if (!query || typeof cb !== "function") return () => {}
    const onChange = () => cb(getSystemMode())
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", onChange)
      return () => query.removeEventListener("change", onChange)
    }
    return () => {}
  } catch {
    return () => {}
  }
}

// ---------------------------------------------------------------------------
// Fonts — registry values are preserved verbatim; only the *applied* sans
// stack gains a local fallback so palettes that name fonts Metrivia does not
// ship (Montserrat, Poppins, …) degrade to the bundled DM Sans instead of a
// generic system font. No external font requests are added.
// ---------------------------------------------------------------------------

const SANS_FALLBACK_INSERT = ['"DM Sans"', "system-ui"]
const GENERIC_FAMILIES = new Set([
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
])

export function withFontFallback(stack, kind = "sans") {
  if (!stack || typeof stack !== "string") return stack
  if (kind !== "sans") return stack
  if (/dm sans/i.test(stack) || /system-ui/i.test(stack)) return stack
  const parts = stack
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return stack
  const last = parts[parts.length - 1].replace(/["']/g, "").toLowerCase()
  if (GENERIC_FAMILIES.has(last)) {
    parts.splice(parts.length - 1, 0, ...SANS_FALLBACK_INSERT)
  } else {
    parts.push(...SANS_FALLBACK_INSERT, "sans-serif")
  }
  return parts.join(", ")
}

// ---------------------------------------------------------------------------
// Token assembly
// ---------------------------------------------------------------------------

/**
 * Metrivia-specific tokens the supplied themes do not define
 * (chart chrome, marker/tooltip surfaces), derived from the active core
 * palette. Keys the theme DOES define always win — the default
 * (mocha-mousse) theme defines all of these itself, so it is applied
 * byte-for-byte with zero visual change.
 */
const DERIVED_TOKEN_SOURCES = {
  "--chart-background": "--card",
  "--chart-foreground": "--card-foreground",
  "--chart-foreground-muted": "--muted-foreground",
  "--chart-line-primary": "--chart-1",
  "--chart-line-secondary": "--chart-2",
  "--chart-crosshair": "--primary",
  "--chart-grid": "--border",
  "--chart-brush-border": "--border",
  "--chart-tooltip-background": "--popover",
  "--chart-tooltip-foreground": "--popover-foreground",
  "--chart-tooltip-muted": "--muted-foreground",
  "--chart-marker-background": "--card",
  "--chart-marker-border": "--border",
  "--chart-marker-foreground": "--card-foreground",
  "--chart-label": "--muted-foreground",
  // Neutral ramp reusing the theme's own surfaces (light→dark safe in both
  // modes, no color-mix needed).
  "--chart-scale-01": "--card",
  "--chart-scale-02": "--secondary",
  "--chart-scale-03": "--muted",
  "--chart-scale-04": "--border",
  "--chart-scale-05": "--muted-foreground",
  "--chart-scale-pattern-color": "--muted",
  // Supplied themes use the older --shadow-x/--shadow-y naming.
  "--shadow-offset-x": "--shadow-x",
  "--shadow-offset-y": "--shadow-y",
  "--letter-spacing": "--tracking-normal",
}

/**
 * Build the complete custom-property map for a theme + mode without touching
 * the DOM. Missing derivation sources resolve to "" and are skipped.
 *
 * Cascade model mirrors the stylesheets the tokens came from: the light set
 * is the base and the dark set overlays it (exactly what `.dark { … }` does
 * over `:root { … }`). This matters because the default theme intentionally
 * leaves some keys (e.g. `--chart-tooltip-background`) defined only in
 * light — today's dark rendering inherits those light values, and so must
 * we, otherwise the default theme would visibly change.
 */
export function buildThemeCssVars(themeId, mode) {
  const theme = resolveTheme(themeId)
  const vars = { ...(theme.light ?? {}) }
  if (mode === APPEARANCES.DARK) Object.assign(vars, theme.dark ?? {})

  for (const [target, source] of Object.entries(DERIVED_TOKEN_SOURCES)) {
    if (vars[target] == null || vars[target] === "") {
      const value = vars[source]
      if (value != null && value !== "") vars[target] = value
    }
  }

  if (vars["--font-sans"]) {
    vars["--font-sans"] = withFontFallback(vars["--font-sans"], "sans")
  }

  const out = {}
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value === "string" && value !== "") out[key] = value
  }
  return out
}

// ---------------------------------------------------------------------------
// Global application
// ---------------------------------------------------------------------------

/** Apply a theme + mode to the whole app immediately (no reload). */
export function applyThemeTokens(themeId, mode) {
  const resolvedId = resolveThemeId(themeId)
  const resolvedMode =
    mode === APPEARANCES.DARK ? APPEARANCES.DARK : APPEARANCES.LIGHT
  const vars = buildThemeCssVars(resolvedId, resolvedMode)
  const doc = getDocument()

  if (doc?.documentElement) {
    const el = doc.documentElement
    el.setAttribute(THEME_DATA_ATTR, resolvedId)
    el.classList.toggle("dark", resolvedMode === APPEARANCES.DARK)
    el.style.colorScheme = resolvedMode
    for (const [key, value] of Object.entries(vars)) {
      try {
        el.style.setProperty(key, value)
      } catch {
        // A single bad token must never break theme application.
      }
    }
    const meta = doc.querySelector('meta[name="theme-color"]')
    if (meta && vars["--background"]) {
      meta.setAttribute("content", vars["--background"])
    }
  } else {
    // No DOM (SSR/tests): still persist nothing, just report the resolution.
  }

  return { themeId: resolvedId, mode: resolvedMode }
}
