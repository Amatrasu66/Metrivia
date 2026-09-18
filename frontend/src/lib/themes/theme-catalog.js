/**
 * Theme catalog metadata (Phase D) — presentation layer for the registry.
 *
 * The registry (`theme-registry.js`, generated from theme.md — do not edit
 * token values there) owns ids, names, descriptions, and light/dark tokens.
 * This module owns ONLY how the gallery organizes them: one primary
 * category per theme, a small featured set, and search keywords. No token
 * definitions are duplicated here.
 */

export const THEME_CATEGORY_ORDER = [
  "featured",
  "cool",
  "warm",
  "vibrant",
  "neutral",
]

export const THEME_CATEGORY_META = {
  featured: {
    label: "Featured",
    blurb: "Polished starting points, including the default.",
  },
  cool: {
    label: "Cool",
    blurb: "Blues, violets, and greens. Calm and focused.",
  },
  warm: {
    label: "Warm",
    blurb: "Earth, paper, and cocoa tones. Soft and readable.",
  },
  vibrant: {
    label: "Vibrant",
    blurb: "Bold, playful color with high energy.",
  },
  neutral: {
    label: "Neutral",
    blurb: "Grayscale and minimal. Maximum contrast, no hue.",
  },
}

/**
 * Per-theme presentation metadata, keyed by registry id:
 * { category: "cool"|"warm"|"vibrant"|"neutral", featured?: true,
 *   keywords?: string[] }
 * Every BUILTIN_THEMES id must appear here (enforced by themes:test).
 */
export const THEME_CATALOG = {
  "mocha-mousse": {
    category: "warm",
    featured: true,
    keywords: ["cocoa", "brown", "espresso", "original", "default"],
  },
  nebula: {
    category: "cool",
    keywords: ["violet", "purple", "sky", "blue", "periwinkle"],
  },
  monochrome: {
    category: "neutral",
    featured: true,
    keywords: ["black", "white", "minimal", "grayscale", "default"],
  },
  lavender: {
    category: "cool",
    keywords: ["lilac", "purple", "rose", "light", "pastel"],
  },
  candy: {
    category: "vibrant",
    keywords: ["pink", "playful", "pop", "bright", "aqua"],
  },
  amber: {
    category: "warm",
    keywords: ["bronze", "honey", "earth", "earthy", "gold"],
  },
  "warm-paper": {
    category: "warm",
    keywords: ["cream", "paper", "terracotta", "orange"],
  },
  iris: {
    category: "cool",
    keywords: ["indigo", "blue", "rounded", "soft"],
  },
  twilight: {
    category: "cool",
    keywords: ["violet", "dusk", "glow", "purple", "evening"],
  },
  arcade: {
    category: "vibrant",
    keywords: ["red", "retro", "game", "square", "neon", "green"],
  },
  graphite: {
    category: "neutral",
    keywords: ["gray", "grey", "workstation", "contrast", "minimal"],
  },
  sage: {
    category: "warm",
    keywords: ["olive", "green", "khaki", "editorial", "serif"],
  },
  terminal: {
    category: "neutral",
    keywords: ["mono", "monospace", "hacker", "black", "code", "brutalist"],
  },
  emerald: {
    category: "cool",
    keywords: ["green", "botanical", "cream", "fresh"],
  },
  brutalist: {
    category: "vibrant",
    keywords: ["pop", "bold", "red", "cobalt", "lime", "black"],
  },
  doodle: {
    category: "vibrant",
    keywords: ["sketch", "handwritten", "playful", "yellow", "fun"],
  },
  orchid: {
    category: "vibrant",
    keywords: ["pink", "soft", "round", "friendly"],
  },
  moss: {
    category: "cool",
    keywords: ["teal", "sage", "calm", "natural", "green"],
  },
  parchment: {
    category: "warm",
    keywords: ["bronze", "paper", "editorial", "serif", "literary", "aged"],
  },
  mint: {
    category: "cool",
    keywords: ["green", "fresh", "blue", "pastel"],
  },
}
