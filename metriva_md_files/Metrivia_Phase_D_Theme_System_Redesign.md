# Metrivia — Phase D: Theme System Redesign + Monochrome Default

## Objective

Work inside the existing **Metrivia** repository.

Phase C added Chrome-style in-session workspace tabs.

This phase is dedicated to the **theme/settings experience**.

The goals are:

1. Make **Monochrome** the default Metrivia theme for new users.
2. Keep all themes supplied in the existing `theme.md` source.
3. Remove the visible **"Tweaks" / "Tweaks CN"** presentation from the user-facing theme UI.
4. Replace the current cluttered theme gallery with a polished, organized, easy-to-scan theme selector.
5. Keep Light / Dark / System appearance selection available in Settings.
6. Make theme changes apply to the entire Metrivia application and all workspaces.
7. Preserve the existing haptic architecture and workspace behavior.
8. Do not implement custom user-created themes yet.

The visual direction should match the provided Metrivia theme-selector reference:

- clean
- minimal
- modern
- organized
- generous but controlled spacing
- compact preview cards
- theme name + short description
- palette dots
- selected check indicator
- search
- responsive grid
- no source-library branding/clutter

---

# 1. Source of truth: theme.md

There is an existing file named:

```text
theme.md
```

It contains the theme definitions supplied for Metrivia.

**Read the entire file before implementing the theme registry.**

Do not infer that there are only the themes shown in screenshots.

The source contains a larger collection of theme definitions, including themes numbered through the later sections of the file.

Extract **every actual theme definition** from `theme.md`.

Preserve the complete token sets supplied by the source.

Do not silently discard themes because they are visually similar.

Do not replace source themes with newly invented palettes.

The user specifically supplied these themes to be available in the Metrivia Settings page.

---

# 2. Existing implementation audit

Before changing anything, inspect the current theme/settings architecture.

At minimum inspect:

- `frontend/src/lib/theme.js`
- `frontend/src/components/settings/SettingsPage.jsx`
- `frontend/src/components/settings/ThemeCard.jsx`
- `frontend/src/components/settings/ThemeToggle.jsx` if relevant
- `frontend/src/providers/SettingsProvider.jsx` or equivalent
- `frontend/src/index.css`
- `frontend/src/App.jsx`
- workspace provider/store
- all uses of:
  - `data-theme`
  - `--background`
  - `--foreground`
  - `--primary`
  - `--chart-1`
  - etc.

Search for:

```text
theme
data-theme
ThemeCard
Tweaks
Tweaks CN
appearance
Light
Dark
System
localStorage
--chart-1
--chart-2
--chart-3
--chart-4
--chart-5
```

Understand the current implementation before modifying it.

---

# 3. Theme registry

Create or refine a centralized theme registry.

Each theme should have structured metadata such as:

```js
{
  id,
  name,
  description,
  category,
  light,
  dark,
  preview
}
```

Use the actual architecture that best fits the existing codebase.

The registry must be the single source of truth for the theme selector.

Do not duplicate theme definitions across:

- SettingsPage
- ThemeCard
- CSS files
- multiple components

---

# 4. Preserve every source token

For each theme from `theme.md`, preserve the relevant design tokens.

At minimum ensure the registry can represent:

```text
background
foreground
card
card-foreground
popover
popover-foreground
primary
primary-foreground
secondary
secondary-foreground
muted
muted-foreground
accent
accent-foreground
destructive
destructive-foreground
border
input
ring
chart-1
chart-2
chart-3
chart-4
chart-5
radius
font family / typography tokens
shadow tokens
tracking tokens
other supplied theme tokens
```

If a source theme includes additional tokens, preserve them.

Do not reduce a theme to five colors.

---

# 5. Human-readable theme names

The source uses labels such as:

```text
theme 1
theme 2
theme 3
...
```

These should NOT be shown to users.

Give every theme a distinct human-readable name based on its actual visual characteristics.

Names must be:

- unique
- concise
- memorable
- appropriate for a professional analytics application

Do not use:

```text
Theme 1
Theme 2
Theme 3
```

Do not use:

```text
Tweaks 1
Tweaks 2
```

Do not expose the source numbering as the primary user-facing label.

If a theme already has a meaningful name in the current Metrivia implementation, preserve it unless the source/theme mapping proves it is wrong.

---

# 6. Remove "Tweaks" / "Tweaks CN" from user-facing UI

The user should never see source-library branding such as:

```text
Tweaks
Tweaks CN
Tweaks CN theme
```

inside the Metrivia theme selector.

Remove:

- Tweaks drawer
- Tweaks navigation label
- Tweaks CN labels on theme cards
- source attribution labels that make the selector look like a copied theme gallery

This does NOT mean deleting the underlying theme definitions.

The source themes remain part of Metrivia's theme system.

---

# 7. Monochrome must become the default

The default Metrivia theme should be:

```text
Monochrome
```

New users should start with Monochrome.

Important persistence rule:

### New user

```text
No saved theme
→ Monochrome
```

### Existing user

```text
Saved theme exists
→ preserve saved theme
```

Do not overwrite an existing user's saved preference merely because the application default changed.

If the current default is represented by a constant, change the default there.

Do not simply make the Monochrome card visually selected while another theme is actually active.

---

# 8. Existing theme migration

If the current application stores a theme ID in localStorage, inspect the existing IDs before changing them.

Do not break users who already have saved theme selections.

If IDs need to change because the registry is being reorganized:

- provide an explicit migration map;
- preserve old selections;
- fall back safely to Monochrome only for unknown/invalid IDs.

Do not silently turn every existing user's saved theme into Monochrome.

---

# 9. Appearance selector

Keep:

```text
Light
Dark
System
```

as an independent appearance setting.

The theme determines the token palette.

Appearance determines which theme mode is active.

Conceptually:

```text
Theme = Monochrome
Appearance = Dark
```

means:

```text
Monochrome dark tokens
```

while:

```text
Theme = Lavender
Appearance = Light
```

means:

```text
Lavender light tokens
```

And:

```text
Appearance = System
```

follows the operating system preference.

Do not couple a theme selection permanently to Light or Dark.

---

# 10. Settings page information architecture

The Settings page should become substantially cleaner.

Recommended structure:

```text
Settings
────────────────────────────────────────────

Appearance
Choose how Metrivia looks.

Color mode
[ Light ] [ Dark ] [ System ]


Themes
Choose a visual theme for Metrivia.

[ Search themes... ]

Featured
────────────────────────────────────────────
[ Monochrome ] [ Mocha Mousse ]


Cool
────────────────────────────────────────────
[ Nebula ] [ Lavender ] [ Iris ] [ Twilight ]


Warm
────────────────────────────────────────────
[ Amber ] [ Warm Paper ] [ Sage ] ...


Vibrant
────────────────────────────────────────────
[ Candy ] [ Arcade ] ...


Haptic Feedback
────────────────────────────────────────────
...
```

The exact category membership must be based on the actual source palettes.

Do not force every theme into an arbitrary category if the palette does not fit.

---

# 11. Theme organization

Use a small number of meaningful categories.

Possible categories include:

```text
Featured
Cool
Warm
Vibrant
Neutral
```

But choose the final categories based on the actual theme definitions.

Do not create dozens of categories.

The goal is to make a large theme collection easy to scan.

If a theme reasonably fits more than one category, choose one primary category rather than duplicating it.

---

# 12. Featured themes

The top/featured section should include:

```text
Monochrome
```

because it is the default.

A small number of other polished/high-visibility themes may be featured if appropriate.

Do not put every theme into Featured.

The rest should appear in their category sections.

---

# 13. Search

Add:

```text
Search themes...
```

to the theme selector.

Search should filter by:

- theme name
- short description
- category

Case-insensitive.

If no theme matches:

```text
No themes found
```

with a simple way to clear the search.

Do not create a separate page just for search.

---

# 14. Theme cards

Redesign the existing theme cards.

The current screenshot shows cards that are visually cluttered and expose source-oriented labels.

The new card should be closer to:

```text
┌─────────────────────────────┐
│                             │
│      THEME PREVIEW          │
│                             │
│  ● ● ● ● ●                 │
├─────────────────────────────┤
│ Monochrome              ✓   │
│ Neutral and focused         │
└─────────────────────────────┘
```

Each card should contain:

1. Theme preview.
2. Theme name.
3. Short description.
4. Small palette indication.
5. Selected state when active.

Do NOT include:

```text
Tweaks CN
Theme 1
Theme 2
source code
technical token names
```

---

# 15. Theme preview

The preview should be generated from the actual theme tokens.

Do not manually draw a fake preview with unrelated colors.

The preview should communicate:

- background
- card
- primary/accent
- text
- chart palette

A small miniature analytics-style preview is appropriate:

```text
┌──────────────────────┐
│ Ag       Ag          │
│ ━━━━━    ━━━━━       │
│ ▂ ▅ ▃ ▇ ▆            │
└──────────────────────┘
```

Use the theme's actual:

```text
--background
--foreground
--primary
--card
--chart-1 ... --chart-5
```

or equivalent registry values.

This is important because users should be able to understand the theme before selecting it.

---

# 16. Selected state

The currently active theme should have a clear but restrained selected state.

For example:

- stronger border
- subtle ring
- check icon
- slight elevation

Do not make selected cards visually enormous.

Only one theme may be selected at a time.

Clicking the already-selected theme should not unnecessarily reapply it or fire duplicate feedback.

---

# 17. Theme selection haptics

Preserve the existing Metrivia haptic system.

Current intended behavior:

- Android: semantic `tap()` for actual theme changes.
- iOS: native-switch haptic workaround only where technically safe.
- reselecting the active theme should remain silent.

Do not add direct:

```js
navigator.vibrate()
```

to ThemeCard.

Use the existing haptic hook.

Do not add haptics to:

- hover
- pointer movement
- theme preview animation
- scrolling

---

# 18. Appearance haptics

Preserve the current behavior:

```text
Light / Dark / System
```

should provide semantic feedback on actual changes according to the existing platform rules.

Do not fire duplicate haptics because both a parent and child handle the same selection.

Do not fire when selecting the already-active appearance.

---

# 19. Haptic settings must remain intact

Do not redesign the haptic architecture in this phase.

Keep:

- master enable/disable
- global intensity
- category intensities
- semantic actions
- Android diagnostic
- iOS native-switch workaround
- reduced-motion behavior

The theme redesign must not break them.

If the Settings page is being reorganized, preserve the current Haptics section.

---

# 20. Theme application must cover the entire application

Selecting a theme must update:

- header
- navigation
- upload page
- workspace tabs
- dashboard
- KPI cards
- filters
- filter drawer
- data table
- chart builder
- charts
- Settings
- buttons
- dialogs/sheets
- empty/error/loading states
- footer if any future component reintroduces one

No page should remain permanently hard-coded to Mocha Mousse colors.

Search for hard-coded colors such as:

```text
#...
rgb(...)
hsl(...)
oklch(...)
```

inside UI components.

Replace theme-dependent hard-coded colors with the existing token system where appropriate.

Do not blindly replace colors that are intentionally semantic (for example, a specific status indicator) unless they should genuinely respond to the theme.

---

# 21. Chart colors

All analytics charts must respond to the selected theme.

Use:

```text
--chart-1
--chart-2
--chart-3
--chart-4
--chart-5
```

or the existing equivalent.

Verify:

- Bar
- Line
- Area
- Pie
- Scatter

all update correctly when the theme changes.

Do not hard-code a single Mocha Mousse chart palette.

---

# 22. Typography

Some supplied themes include typography/font tokens.

Preserve those where the current architecture supports them.

Use robust fallbacks:

```text
theme font
→ system fallback
```

Do not load external fonts from a new third-party service unless the existing application already does so.

Do not introduce network-dependent fonts merely for theme previews.

---

# 23. Theme transitions

Theme switching should feel polished but must remain accessible.

A subtle transition is acceptable for:

- background
- border
- text
- cards

Do not animate every element individually.

Respect:

```text
prefers-reduced-motion
```

When reduced motion is enabled:

- disable nonessential theme transitions;
- preserve immediate theme changes.

Do not make theme switching slow.

---

# 24. Responsive theme gallery

Desktop:

- multi-column grid
- compact cards
- clear category headings

Tablet:

- fewer columns

Mobile:

- 1–2 columns depending on width
- cards remain readable
- search remains usable
- no page-wide horizontal overflow

Do not create a horizontally scrolling theme gallery unless necessary.

---

# 25. Settings layout

If the current Settings page uses a sidebar, retain it only if it is genuinely useful.

The desired information architecture is:

```text
Settings
├── Appearance
├── Themes
├── Haptics
└── About
```

If a sidebar is already implemented and works well, refine it rather than replacing the entire navigation architecture.

On mobile, use the existing responsive settings navigation pattern.

Do not create duplicate Settings navigation.

---

# 26. Remove clutter, not functionality

Do NOT remove:

- Haptic controls
- appearance controls
- theme selection
- About section if already useful
- accessibility controls
- reset settings

Only remove the source-library clutter and unnecessary duplication.

---

# 27. Reset settings

Keep the existing Reset Settings behavior.

After reset, verify:

```text
Theme → Monochrome
Appearance → existing intended default
Haptics → existing intended default
```

The reset behavior should match the centralized settings defaults.

Do not implement a separate theme reset mechanism.

---

# 28. Workspace integration

Phase C introduced workspace tabs.

Themes are global.

Verify:

```text
Workspace A
→ choose Lavender

Workspace B
→ Lavender is also active
```

Changing theme must affect all workspaces because theme is an application-level preference.

Do not store theme selection inside workspace state.

---

# 29. Persistence

Theme and appearance preferences should continue to persist using the existing SettingsProvider/localStorage architecture.

Verify:

1. Select a theme.
2. Reload.
3. Theme remains selected.
4. Select Light/Dark/System.
5. Reload.
6. Appearance remains selected.

If localStorage is unavailable or malformed, fall back safely to:

```text
Theme = Monochrome
```

without crashing.

---

# 30. Do not implement custom themes yet

Do NOT implement:

- theme editor
- custom colors
- custom token editing
- user-created themes
- import/export themes
- theme sharing

Those are future functionality.

This phase is selection and presentation only.

---

# 31. Do not change workspace behavior

Do not modify:

- tab creation
- tab closing
- tab switching
- workspace state
- CSV upload ownership
- filters
- chart configuration persistence

unless a theme integration change absolutely requires it.

---

# 32. Do not change CSV behavior

Do not modify:

- complete CSV preview
- backend upload response
- row/column availability
- scrolling behavior

unless a theme token integration requires a tiny presentation-only change.

---

# 33. Theme registry tests

Add focused tests for the theme system.

At minimum verify:

- every source theme exists in the registry;
- every theme has a unique ID;
- every theme has a unique user-facing name;
- every theme has light/dark token sets where supplied/required;
- required tokens exist;
- chart-1 through chart-5 exist;
- Monochrome is the default;
- saved valid theme IDs survive migration;
- invalid saved theme IDs fall back safely;
- search works;
- category metadata is valid.

Do not write tests that merely assert the UI text without checking the underlying registry.

---

# 34. Haptic regression tests

Run the existing:

```bash
npm run haptics:audit
```

Do not weaken it.

Theme work must not remove haptic coverage.

---

# 35. Validation

Run:

```bash
npm run haptics:audit
npm run lint
npm run build
```

Run any existing theme/settings/workspace tests.

Run the new theme tests.

Fix all errors caused by your changes.

A pre-existing build warning is acceptable only if unchanged and clearly reported.

---

# 36. Manual test matrix

## Default

- [ ] Fresh session uses Monochrome.
- [ ] Monochrome is visually selected.
- [ ] Existing saved theme preference is preserved.

## Appearance

- [ ] Light works.
- [ ] Dark works.
- [ ] System works.
- [ ] Theme + appearance combinations work correctly.

## Themes

- [ ] Every source theme is available.
- [ ] Every theme has a distinct human-readable name.
- [ ] No "Theme 1/2/3" labels remain.
- [ ] No "Tweaks" label remains.
- [ ] No "Tweaks CN" label remains.
- [ ] Search works.
- [ ] Categories are clear.
- [ ] Selected state works.
- [ ] Reselecting active theme does not cause duplicate action.

## Preview

- [ ] Preview colors actually correspond to the theme.
- [ ] Chart palette preview is derived from theme tokens.
- [ ] Light and dark previews are understandable.

## Application

After selecting several themes, verify changes appear throughout:

- [ ] Header
- [ ] Workspace tabs
- [ ] Upload
- [ ] Dashboard
- [ ] KPI cards
- [ ] Filters
- [ ] Data table
- [ ] Chart builder
- [ ] Bar chart
- [ ] Line chart
- [ ] Area chart
- [ ] Pie chart
- [ ] Scatter chart
- [ ] Settings

## Charts

- [ ] chart-1 through chart-5 respond to theme changes.
- [ ] No chart remains permanently Mocha Mousse.

## Persistence

- [ ] Reload preserves theme.
- [ ] Reload preserves appearance.

## Workspaces

- [ ] Theme remains global across tabs.
- [ ] Switching workspace does not reset theme.

## Haptics

- [ ] Theme selection uses existing semantic layer.
- [ ] Appearance selection uses existing semantic layer.
- [ ] Haptic settings still work.
- [ ] Android diagnostic remains available.
- [ ] iOS native-switch behavior is not regressed.

## Responsive

- [ ] Desktop gallery is clean.
- [ ] Tablet layout works.
- [ ] Mobile layout works.
- [ ] No page-wide horizontal overflow.

## Accessibility

- [ ] Theme cards are keyboard accessible.
- [ ] Search is keyboard accessible.
- [ ] Appearance controls are keyboard accessible.
- [ ] Selected state is exposed accessibly.
- [ ] Focus states remain visible.
- [ ] Reduced motion is respected.

---

# 37. Important quality requirement

Do not treat the theme selector as a simple list of CSS variables.

It is a user-facing product feature.

The finished selector should feel intentionally designed:

```text
Settings
  ↓
Appearance
  ↓
Themes
  ↓
Search / Categories
  ↓
Visual preview cards
  ↓
One-click selection
```

The user should be able to scan the available themes quickly without being confronted with implementation/source-library terminology.

---

# 38. Final report

Return:

## Theme source audit

Report:

```text
Source themes found: XX
Themes implemented: XX
Missing: none / list
```

Confirm that the complete `theme.md` source was read and represented.

## Theme registry

Explain the registry structure and how source tokens are preserved.

## Theme names

List the final human-readable names and their categories.

Do not omit themes.

## Default

Confirm:

```text
New user default: Monochrome
Existing saved preferences: preserved
```

## Settings UI

Describe:

- Appearance selector
- Search
- Categories
- Theme cards
- Selected state
- Removed Tweaks UI

## Application integration

Explain how themes propagate across the application and workspaces.

## Charts

Explain how chart colors respond to theme changes.

## Persistence

Explain how theme/appearance persistence works.

## Haptics

Explain what was preserved and how theme/appearance interactions use the existing haptic architecture.

## Tests

Report:

```text
theme tests: PASS/FAIL
haptics:audit: XX/XX
lint: PASS/FAIL
build: PASS/FAIL
workspace tests: PASS/FAIL
```

## Manual verification

List what was verified and what still requires browser/device testing.

## Important

Do not claim every theme is implemented unless you verified the complete `theme.md` source against the final registry.
