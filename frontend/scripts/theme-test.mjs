// Metrivia theme system tests — dependency-free focused checks.
//
// Covers the Phase D theme registry + catalog + helpers (no React, no DOM):
// source completeness, unique ids/names, required tokens, chart palette,
// Amber default, saved-preference migration, search, categories, and
// pure token assembly. theme-utils.js has no top-level DOM access, so node
// can import it directly (relative paths — no alias hook needed).
//
// Usage:  npm run themes:test   (from frontend/)
// Exit code is non-zero on any failure.

const bust = () =>
  `?th=${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
const libUrl = (rel) =>
  String(new URL(`../src/lib/themes/${rel}`, import.meta.url));

const registry = await import(`${libUrl("theme-registry.js")}${bust()}`);
const utils = await import(`${libUrl("theme-utils.js")}${bust()}`);
const catalog = await import(`${libUrl("theme-catalog.js")}${bust()}`);

const { BUILTIN_THEMES, DEFAULT_THEME_ID, THEMES } = registry;
const {
  buildThemeCssVars,
  getFeaturedThemes,
  getThemeById,
  getThemeCategory,
  getThemesByCategory,
  isValidThemeId,
  resolveThemeId,
  searchThemes,
  withFontFallback,
} = utils;
const { THEME_CATALOG, THEME_CATEGORY_META, THEME_CATEGORY_ORDER } = catalog;

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ""}`);
  }
}

const REQUIRED_TOKENS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--border",
  "--input",
  "--ring",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--radius",
  "--font-sans",
];

// --- source completeness ------------------------------------------------------
// theme.md Themes 1..20 must all be represented (provenance lives in each
// entry's `source` field; Themes 8+9 share the twilight entry). Mocha Mousse
// comes from src/index.css.
{
  const covered = new Set();
  for (const theme of THEMES) {
    for (const m of String(theme.source ?? "").matchAll(/Theme (\d+)/g)) {
      covered.add(Number(m[1]));
    }
  }
  const missing = [];
  for (let n = 1; n <= 20; n += 1) {
    if (!covered.has(n)) missing.push(n);
  }
  check(
    "T1 every theme.md theme (1..20) is represented in the registry",
    missing.length === 0,
    missing.length > 0 ? `missing: ${missing.join(", ")}` : "",
  );
  check(
    "T2 registry holds the 19 source palettes + mocha-mousse (20 total)",
    THEMES.length === 20 && BUILTIN_THEMES.length === 20,
    `got ${THEMES.length}`,
  );
}

// --- identity -------------------------------------------------------------------
{
  const ids = THEMES.map((t) => t.id);
  check("T3 every theme has a unique id", new Set(ids).size === ids.length);
  const names = THEMES.map((t) => String(t.name ?? "").trim().toLowerCase());
  check(
    "T4 every theme has a unique, non-blank human-readable name",
    names.every((n) => n !== "") && new Set(names).size === names.length,
    names.filter((n, i) => names.indexOf(n) !== i).join(", "),
  );
  const banned = names.filter((n) => /^(theme|tweaks)\s*\d+/i.test(n));
  check(
    "T5 no user-facing Theme N / Tweaks N labels",
    banned.length === 0,
    banned.join(", "),
  );
  const descriptions = THEMES.map((t) => t.description);
  check(
    "T6 every theme has a short description",
    descriptions.every(
      (d) => typeof d === "string" && d.trim().length > 0,
    ),
  );
}

// --- tokens -----------------------------------------------------------------------
{
  const problems = [];
  for (const theme of THEMES) {
    for (const mode of ["light", "dark"]) {
      const tokens = theme[mode];
      if (!tokens || typeof tokens !== "object") {
        problems.push(`${theme.id} missing ${mode} set`);
        continue;
      }
      for (const key of REQUIRED_TOKENS) {
        if (typeof tokens[key] !== "string" || tokens[key] === "") {
          problems.push(`${theme.id}.${mode} missing ${key}`);
        }
      }
    }
  }
  check(
    "T7 every theme carries full light+dark sets incl. chart-1..5",
    problems.length === 0,
    problems.slice(0, 8).join(" | "),
  );
}

// --- default + migration ------------------------------------------------------------
check("T8 Amber is the default theme", DEFAULT_THEME_ID === "amber");
check(
  "T9 saved valid theme ids survive (no forced migration to default)",
  ["mocha-mousse", "monochrome", "lavender", "terminal", "mint", "graphite"].every(
    (id) => resolveThemeId(id) === id && isValidThemeId(id),
  ),
);
check(
  "T10 unknown/blank saved ids fall back safely to Amber",
  resolveThemeId("nope") === "amber" &&
    resolveThemeId("") === "amber" &&
    resolveThemeId(null) === "amber" &&
    resolveThemeId(undefined) === "amber",
);
check(
  "T10b Graphite and Mocha remain selectable (never removed)",
  isValidThemeId("graphite") &&
    isValidThemeId("mocha-mousse") &&
    getThemeById("graphite")?.name === "Graphite" &&
    getThemeById("mocha-mousse")?.name === "Mocha Mousse" &&
    getThemeById("amber")?.name === "Amber",
);

// --- catalog --------------------------------------------------------------------------
{
  const registryIds = new Set(THEMES.map((t) => t.id));
  const catalogIds = Object.keys(THEME_CATALOG);
  const uncatalogued = [...registryIds].filter((id) => !(id in THEME_CATALOG));
  const orphaned = catalogIds.filter((id) => !registryIds.has(id));
  const badCategory = catalogIds.filter(
    (id) =>
      !["cool", "warm", "vibrant", "neutral"].includes(
        THEME_CATALOG[id]?.category,
      ),
  );
  check(
    "T11 every registry theme has valid catalog metadata (no orphans)",
    uncatalogued.length === 0 &&
      orphaned.length === 0 &&
      badCategory.length === 0,
    [...uncatalogued, ...orphaned, ...badCategory].join(", "),
  );
  const featured = getFeaturedThemes();
  check(
    "T12 featured rail is small and includes Graphite",
    featured.length >= 1 &&
      featured.length <= 4 &&
      featured.some((t) => t.id === "graphite"),
    featured.map((t) => t.id).join(", "),
  );
  const groups = getThemesByCategory();
  const groupedCount = groups.reduce((n, g) => n + g.themes.length, 0);
  const groupIds = groups.map((g) => g.id);
  check(
    "T13 category groups cover every theme exactly once (featured excluded)",
    groupedCount === THEMES.length &&
      groupIds.every((id) => THEME_CATEGORY_ORDER.includes(id)) &&
      groups.every((g) => THEME_CATEGORY_META[g.id]?.label === g.label),
    `grouped=${groupedCount} total=${THEMES.length}`,
  );
}

// --- search -----------------------------------------------------------------------------
check(
  "T14 blank search returns every theme in registry order",
  (() => {
    const r = searchThemes("  ");
    return (
      r.length === THEMES.length &&
      r.every((t, i) => t.id === THEMES[i].id)
    );
  })(),
);
check(
  "T15 search matches name, description, category, keywords (case-insensitive)",
  searchThemes("MONOCHROME").some((t) => t.id === "monochrome") &&
    searchThemes("terracotta").some((t) => t.id === "warm-paper") &&
    searchThemes("neutral").length >= 3 &&
    searchThemes("hacker").some((t) => t.id === "terminal"),
);
check(
  "T16 multi-word search intersects terms; no match returns []",
  searchThemes("violet glow").some((t) => t.id === "twilight") &&
    searchThemes("zzz-no-such-theme").length === 0,
);

// --- pure token assembly ------------------------------------------------------------------
{
  const vars = buildThemeCssVars("monochrome", "dark");
  check(
    "T17 token assembly resolves Monochrome dark incl. chart palette",
    vars["--chart-1"] != null &&
      vars["--chart-5"] != null &&
      vars["--background"] != null &&
      vars["--font-sans"] != null,
  );
  const fallback = buildThemeCssVars("bogus-id", "light");
  const amberLight = buildThemeCssVars("amber", "light");
  check(
    "T18 unknown theme ids assemble as Amber (safe fallback)",
    JSON.stringify(fallback) === JSON.stringify(amberLight),
  );
  check(
    "T19 font fallback keeps bundled fonts local (no external requests)",
    withFontFallback("Montserrat, sans-serif").includes("DM Sans") &&
      withFontFallback("DM Sans, sans-serif") === "DM Sans, sans-serif",
  );
  check(
    "T20 category labels resolve for every theme",
    THEMES.every((t) => {
      const label = getThemeCategory(t.id);
      return THEME_CATEGORY_META[label]?.label != null;
    }),
  );
}

// --- Phase H bootstrap: Amber first paint ---------------------------------
{
  const { readFileSync: readSync } = await import("node:fs");
  const { fileURLToPath: toPath } = await import("node:url");
  const root = toPath(new URL("../", import.meta.url));
  const html = readSync(`${root}index.html`, "utf8");
  const css = readSync(`${root}src/index.css`, "utf8");
  const utilsSrc = readSync(`${root}src/lib/themes/theme-utils.js`, "utf8");
  check(
    "T21 bootstrap defaults to Amber (graphite + mocha stay selectable, never default)",
    html.includes('"amber"') &&
      html.includes('"graphite"') &&
      html.includes('"mocha-mousse"') &&
      !html.includes('|| "mocha-mousse"') &&
      !html.includes(': "graphite"'),
  );
  check(
    "T22 bootstrap validates saved id against known themes + resolves system",
    html.includes("KNOWN_THEMES") &&
      html.includes("prefers-color-scheme") &&
      html.includes("metrivia.theme-id") &&
      html.includes("metrivia.appearance"),
  );
  check(
    "T23 bootstrap re-applies cached CSS vars before React mounts",
    html.includes("metrivia.theme-vars") &&
      html.includes("setProperty") &&
      utilsSrc.includes("THEME_VARS_STORAGE_KEY") &&
      utilsSrc.includes("metrivia.theme-vars"),
  );
  check(
    "T24 CSS :root/.dark defaults are Amber (no Mocha/Graphite first paint)",
    css.includes("Amber is the first-painted theme") &&
      css.includes("oklch(0.9821 0 0)") &&
      css.includes("oklch(0.1776 0 0)") &&
      !css.includes("oklch(0.9529 0.0146 102.4597)") &&
      !css.includes("oklch(0.9551 0 0)") &&
      !css.includes("oklch(0.2178 0 0)"),
  );
  check(
    "T25 Amber fresh load resolves to itself in both modes",
    JSON.stringify(buildThemeCssVars("amber", "light")) !== "{}" &&
      JSON.stringify(buildThemeCssVars("amber", "dark")) !== "{}" &&
      resolveThemeId("amber") === "amber",
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
