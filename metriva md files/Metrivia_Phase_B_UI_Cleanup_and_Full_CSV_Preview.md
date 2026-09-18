# Metrivia — Phase B: Production UI Cleanup + Complete CSV Data Preview

## Objective

Work inside the existing **Metrivia** repository.

Phase A (Android haptics runtime diagnosis) is complete. Do not revisit or rewrite the haptic architecture in this phase unless a regression is directly caused by the changes below.

This phase has exactly two goals:

1. Clean the production UI by removing the sections/components marked with red lines in the supplied screenshots.
2. Make the CSV data preview provide access to **all rows and all columns** of the uploaded dataset instead of showing only a fixed subset.

Do not implement Metrivia tabs/workspaces or the theme redesign in this phase. Those are separate phases.

---

# 1. Read and audit the current implementation first

Before changing code, inspect the current frontend.

Relevant areas are likely:

- `frontend/src/App.jsx`
- landing/upload page components
- `DashboardLayout.jsx`
- `DashboardPlaceholder.jsx`
- data preview/table components
- upload components
- footer components
- navigation/header
- any interface-state/demo components
- any "What happens next" components
- any feature/status cards

Search for the visible strings from the screenshots:

```text
Interface states
Empty
Loading
Error
Dashboard layout is ready
Open dashboard
Responsive by default
Accessible controls
Real Flask backend
What happens next
Showing 8 of
more columns not shown
```

Do not assume the component names from this prompt are exact. Trace the rendered UI.

---

# 2. Remove the red-marked Interface States section

The screenshot shows a section titled:

> Interface states

with:

- Empty
- Loading
- Error
- Dashboard layout is ready
- Open dashboard

This is internal/demo/showcase content and should not be visible on the production landing page.

Remove the entire rendered section from the normal user experience.

Important:

- Do not delete reusable state components if the real upload/dashboard flow still uses them.
- Delete only the **showcase/demo presentation** of those states.
- Real loading and error states must continue to work where the application actually needs them.

For example:

```text
Demo Empty state → remove from landing page
Real empty dashboard state → preserve if actually used
Demo Loading state → remove from landing page
Real upload/loading state → preserve
Demo Error state → remove from landing page
Real error state → preserve
```

Do not break the upload flow.

---

# 3. Remove the "Dashboard layout is ready" strip

The screenshot shows a separate large strip:

> Dashboard layout is ready

with:

> KPI cards, a live bar chart, and the data table adapt from mobile to desktop.

and:

> Open dashboard

This is not needed in the production landing page.

Remove this entire visible strip.

Do not remove the actual Dashboard route/page or its functionality.

The Dashboard navigation/header must continue to work.

---

# 4. Remove the feature/status cards from the landing page

The screenshot shows the cards:

```text
Responsive by default
Accessible controls
Real Flask backend
```

Remove these cards from the production landing page.

Do not replace them with another large row of informational cards in this phase.

The landing page should become simpler and more focused.

---

# 5. Remove "What happens next"

The screenshot shows a right-hand panel titled:

> What happens next

containing:

1. Upload
2. Preview
3. Visualize

and additional implementation notes.

Remove this entire panel/section from the production landing page.

Do not remove the actual upload functionality or dashboard functionality.

---

# 6. Remove the production footer shown in the screenshots

The screenshot shows a footer containing text such as:

> Metrivia — responsive CSV visualization shell.

and implementation/status text.

Remove that footer from the production UI.

Do not remove the application itself or the page's required bottom spacing.

After removal, the landing page should end naturally without a development-status footer.

---

# 7. Preserve the useful landing-page content

After cleanup, the landing page should still contain the core product experience:

- Metrivia branding/header
- navigation
- hero heading
- concise description
- Upload CSV action
- dashboard action if still appropriate
- actual CSV upload area
- any genuinely necessary product information

Do not redesign the entire landing page.

The goal is:

```text
less demo/status UI
more actual product UI
```

---

# 8. CSV preview: remove artificial row/column truncation

The screenshot currently shows something like:

> First rows of metrivia_test_sales_dataset.csv (up to 8 shown).

and:

> Showing 8 of 100 rows · 9 more columns not shown

This behavior must be removed.

The application must no longer intentionally limit the preview to:

```text
8 rows
10 columns
```

or any similar fixed preview subset.

The user must be able to access:

```text
ALL rows
ALL columns
```

from the uploaded CSV.

For example:

```text
100 rows × 19 columns
```

must expose all 100 rows and all 19 columns.

Do not merely change the text from "8" to "100" while still rendering only 8 rows.

Trace the actual data passed from the backend/analysis response to the table and remove the truncation at the correct layer.

---

# 9. Backend data contract

Inspect the current `/api/upload` response and determine whether the backend already returns enough data for the complete preview.

Do not duplicate or unnecessarily redesign the backend.

If the backend currently truncates preview data, modify it so the complete dataset needed by the frontend is available, while preserving:

- CSV validation
- 10 MB upload limit
- Pandas analysis
- current analysis metadata
- CORS
- error format
- in-memory/stateless behavior

If the backend already returns all rows/columns and only the frontend truncates them, fix the frontend only.

Do not introduce a database.

---

# 10. Data table requirements

Replace the current limited preview behavior with a proper complete-data viewer.

It should support:

### All rows

Every uploaded CSV row must be accessible.

### All columns

Every uploaded CSV column must be accessible.

### Vertical scrolling

The table must be contained in a bounded viewport so 100+ rows do not make the entire dashboard enormous.

### Horizontal scrolling

Wide CSVs must remain usable.

### Sticky header

Keep column headers visible while vertically scrolling where practical.

### Row/column count

Show useful metadata such as:

```text
100 rows × 19 columns
```

Use the actual dataset dimensions dynamically.

Do not show misleading text such as:

```text
Showing 8 of 100
9 more columns not shown
```

---

# 11. "Show all" means accessible, not necessarily all DOM nodes

Do not blindly render thousands of rows into the DOM if that creates a performance problem.

The requirement is:

> Every row and column must be accessible to the user.

For normal datasets, a simple scrollable table is acceptable.

If the existing project already has or can safely use a lightweight virtualization approach, it may be used for large datasets.

However:

- do not add a heavy dependency just for this phase unless clearly necessary;
- do not complicate the architecture unnecessarily;
- do not hide data behind pagination unless pagination is required for performance and still provides access to every row;
- do not silently drop rows/columns.

A reasonable implementation is preferred.

---

# 12. Mobile behavior

The data table must remain usable on:

- desktop
- laptop
- tablet
- mobile

On narrow screens:

- allow horizontal scrolling inside the table container;
- do not cause the entire page to overflow horizontally;
- preserve readable row/column content;
- keep the table's scroll area visually obvious.

Do not shrink 19+ columns into unreadable text merely to avoid horizontal scrolling.

---

# 13. Data correctness

Do not alter the values returned by the CSV.

Preserve:

- strings
- numbers
- dates
- empty values
- column names
- row order

Do not accidentally convert values into display-only approximations.

If a value is null/empty, preserve the current sensible empty-value presentation.

---

# 14. Table layout

Use the existing Metrivia design system and current theme variables.

Do not introduce a completely new visual language.

The preview should feel like part of the analytics dashboard.

Recommended structure:

```text
Data preview
sales.csv

100 rows × 19 columns

┌──────────────────────────────────────────────────────────┐
│ Order ID │ Order Date │ Region │ State │ City │ ...     │
├──────────┼────────────┼────────┼───────┼──────┼─────────┤
│ ...      │ ...        │ ...    │ ...   │ ...  │ ...     │
│ ...      │ ...        │ ...    │ ...   │ ...  │ ...     │
│ ...      │ ...        │ ...    │ ...   │ ...  │ ...     │
└──────────────────────────────────────────────────────────┘
          vertical scroll
                    +
          horizontal scroll
```

Use existing borders, typography, radius and theme tokens.

Do not hard-code the current Mocha Mousse colors.

---

# 15. Accessibility

Preserve or improve:

- keyboard accessibility
- visible focus
- semantic table markup where appropriate
- accessible labels
- usable scrolling
- sufficient contrast
- reduced-motion behavior

Do not introduce inaccessible custom scrolling controls if native scrolling is sufficient.

---

# 16. Haptics regression protection

Phase A established the haptic architecture.

Do not remove haptic calls from existing real controls while deleting the demo UI.

If any remaining real control is modified, preserve:

```text
tap()
select()
chartSelect()
dataPoint()
success()
error()
warning()
```

where they already belong.

Do not add new haptics merely for table scrolling or hover.

Do not add haptics to continuous scroll movement.

---

# 17. Landing page layout after cleanup

The resulting landing page should feel intentionally sparse and product-focused.

Conceptually:

```text
┌─────────────────────────────────────────────────────────────┐
│ Metrivia                         Upload Dashboard Settings │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Turn CSVs into clear,                                        │
│ responsive dashboards                                       │
│                                                             │
│ Short product description                                   │
│                                                             │
│ [ Upload a CSV ]   [ View dashboard ]                      │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Upload a CSV file                                           │
│                                                             │
│             Drag & drop / Upload                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

This is a direction, not a demand to rewrite the whole layout.

---

# 18. Do not implement these yet

Do NOT implement:

- Chrome-style Metrivia tabs/workspaces
- `+` new workspace button
- multiple simultaneous datasets
- Monochrome default theme
- theme gallery redesign
- Tweaks drawer removal
- new theme categories
- haptic library replacement
- new chart functionality
- database
- authentication

These will be handled in later phases.

---

# 19. Validation

Run the appropriate checks after implementation.

At minimum:

```bash
npm run lint
npm run build
```

Also run:

```bash
npm run haptics:audit
```

because this phase must not regress the completed haptic system.

If backend code was modified, run the backend's existing tests/checks as well.

Fix all errors caused by your changes.

---

# 20. Manual verification

Use the existing test CSV and verify:

### Landing page

- [ ] Interface states section is gone.
- [ ] Dashboard layout ready strip is gone.
- [ ] Responsive/Accessible/Flask feature cards are gone.
- [ ] What happens next panel is gone.
- [ ] Development/status footer is gone.
- [ ] Upload still works.
- [ ] Dashboard navigation still works.
- [ ] Mobile layout still works.

### Data preview

Upload the test CSV.

Verify:

- [ ] Every row is accessible.
- [ ] Every column is accessible.
- [ ] Vertical scrolling works.
- [ ] Horizontal scrolling works.
- [ ] Header remains usable while scrolling.
- [ ] Actual row count is displayed.
- [ ] Actual column count is displayed.
- [ ] No "8 rows shown" limitation remains.
- [ ] No "9 more columns not shown" limitation remains.
- [ ] No CSV values are lost or reordered.
- [ ] Mobile table does not cause page-wide horizontal overflow.

### Haptics regression

- [ ] `npm run haptics:audit` passes.

---

# 21. Final report

Return a concise but complete report with:

## Files changed

List every changed file and why.

## Landing cleanup

List exactly what was removed.

## CSV preview

Explain:

- where the previous truncation occurred;
- whether backend changes were necessary;
- how all rows/columns are now exposed;
- how scrolling/performance is handled.

## Validation

Report:

```text
lint: PASS/FAIL
build: PASS/FAIL
haptics:audit: XX/XX
backend tests: PASS/FAIL/NOT RUN
```

## Manual verification

Report what was verified locally and what still requires browser/device testing.

## Important

Do not claim "all data is shown" merely because the UI text says so.

Verify the actual data path and table rendering.

The requirement is that the user can access **every row and every column in the uploaded CSV**.
