# Metrivia — Phase C: Chrome-Style Workspace Tabs

## Objective

Work inside the existing **Metrivia** repository.

Phase A established the haptic architecture and Android diagnostic path.
Phase B cleaned the production landing page and changed the CSV preview to expose the complete dataset.

This phase has one primary product goal:

> Add Chrome-like Metrivia workspaces/tabs so users can work with multiple CSV datasets independently without losing their existing work.

Example:

```text
┌────────────────────────────────────────────────────────────────────┐
│ Metrivia                                                           │
├────────────────────────────────────────────────────────────────────┤
│ [ Sales.csv × ] [ Students.csv × ] [ Inventory.csv × ] [ + ]      │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│                    Active workspace                                │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

Clicking `+` creates a fresh Metrivia workspace where the user can upload another CSV.

Switching between tabs must restore the corresponding dataset, filters, chart configuration, and dashboard state.

Do not implement the theme redesign in this phase.
Do not rewrite the haptic library in this phase.
Do not redesign the dashboard visually unless required to integrate the tab bar.

---

# 1. Read the current architecture first

Before changing anything, inspect the current application architecture.

At minimum inspect:

- `frontend/src/App.jsx`
- `frontend/src/components/layout/AppLayout.jsx`
- `frontend/src/components/layout/AppHeader.jsx`
- `frontend/src/components/landing/UploadPage.jsx`
- `frontend/src/components/dashboard/DashboardLayout.jsx`
- `frontend/src/components/dashboard/DashboardPlaceholder.jsx`
- upload state management
- API layer
- hooks/state providers
- filter state
- chart configuration state
- analysis response handling
- navigation implementation
- Settings implementation
- localStorage usage

Search for:

```text
dataset
analysis
filters
chart
upload
navigate
Dashboard
UploadPage
useState
Context
localStorage
```

Understand where the current single-dataset state lives before designing the workspace state.

Do not assume that a particular router or state library exists.

---

# 2. Core workspace model

Introduce a central workspace model.

Each workspace should have at least:

```js
{
  id,
  name,
  fileName,
  file,
  dataset,
  analysis,
  filters,
  chartConfig,
  dashboardState
}
```

Use the actual existing state structure where possible rather than duplicating equivalent state.

The exact property names may differ based on the current codebase.

Each workspace must independently preserve:

- uploaded CSV
- file name
- complete dataset
- analysis metadata
- filters
- selected chart type
- dimension
- measure
- aggregation
- chart interaction state where applicable
- dashboard/visualization state

Global application settings must NOT become workspace-specific.

These remain global:

- theme
- Light/Dark/System
- haptic settings
- accessibility preferences

---

# 3. Workspace manager

Create a small centralized workspace state layer.

Prefer:

- React Context + reducer, or
- an existing project state mechanism

if one already exists.

Do NOT add Redux, Zustand, Jotai, or another state library unless the existing architecture genuinely requires it.

The workspace manager should support operations equivalent to:

```text
createWorkspace()
closeWorkspace(id)
setActiveWorkspace(id)
renameWorkspace(id, name)
updateWorkspace(id, patch)
```

Avoid putting workspace state directly into unrelated UI components.

---

# 4. Initial workspace

On a fresh Metrivia session, there should be exactly one workspace:

```text
Untitled
```

or another concise empty-workspace label.

The user should immediately be able to upload a CSV.

After uploading:

```text
Untitled
```

should become something useful such as:

```text
sales.csv
```

Use the actual file name when available.

Do not require the user to manually rename a workspace just to identify it.

---

# 5. Tab bar

Add a dedicated workspace tab bar to the application.

Conceptually:

```text
┌─────────────────────────────────────────────────────────────┐
│ Sales.csv × │ Students.csv × │ Inventory.csv × │    +      │
└─────────────────────────────────────────────────────────────┘
```

The active tab must be visually distinguishable using the current theme tokens.

Do not use hard-coded colors.

Each tab should show:

- concise workspace name
- close control

The `+` control creates a new workspace.

---

# 6. Where the tab bar belongs

Integrate the tabs into the main Metrivia application shell.

They should feel like application-level workspaces, not a component inside the dashboard.

Recommended hierarchy:

```text
Metrivia Header
       ↓
Workspace Tabs
       ↓
Current Page / Workspace
```

The header navigation:

```text
Upload
Dashboard
Settings
```

must continue to work.

The tabs represent datasets/workspaces, while the existing navigation represents application sections.

Do not replace the existing navigation with tabs.

---

# 7. New workspace behavior

When the user clicks:

```text
+
```

create a new empty workspace.

Then:

1. Make it active.
2. Navigate/show the Upload view for that workspace.
3. Focus the upload area/button if practical and accessible.
4. Do not alter the previous workspace.
5. Do not clear the previous workspace.

Example:

```text
Before:

[ sales.csv × ] [ + ]

Active:
sales.csv

After clicking +:

[ sales.csv × ] [ Untitled × ] [ + ]

Active:
Untitled
```

The user can now upload another CSV.

---

# 8. Switching workspaces

When clicking another tab:

```text
[ sales.csv × ] [ students.csv × ]
    ↑ active
```

switching to:

```text
[ sales.csv × ] [ students.csv × ]
                  ↑ active
```

must restore that workspace exactly.

For example:

### Sales workspace

```text
sales.csv
Region = North
Category = Electronics
Bar chart
Dimension = Region
Measure = Sales
```

### Students workspace

```text
students.csv
Department = BCA
Pie chart
Dimension = Department
Measure = Students
```

Switching back to Sales must restore the Sales state.

Do not use one shared filter/chart state across all workspaces.

---

# 9. Closing workspaces

Every tab must have a close control.

Example:

```text
Sales.csv ×
```

Clicking `×` should close only that workspace.

Do not let clicking the close icon also activate the tab.

Prevent event bubbling where necessary.

---

# 10. Active-tab closing behavior

Define deterministic behavior.

If the active workspace is closed:

- activate the nearest remaining workspace;
- prefer the previous tab if one exists;
- otherwise use the next tab;
- preserve all other workspaces.

Example:

```text
[ A ] [ B ] [ C ]
       ↑ active

Close B

[ A ] [ C ]
       ↑
```

If B was the active middle tab, A/C selection should be deterministic.

Do not leave the application with no workspace.

---

# 11. Closing the final workspace

The application must always have at least one workspace.

If the user closes the last remaining workspace:

1. Create a new empty workspace.
2. Make it active.
3. Show the upload state.

Result:

```text
[ Untitled × ] [ + ]
```

Do not leave a blank application with no active workspace.

---

# 12. Workspace naming

Workspace labels should be useful and compact.

Initial:

```text
Untitled
```

After upload:

```text
sales.csv
```

If duplicate file names exist:

```text
sales.csv
sales.csv (2)
sales.csv (3)
```

or another similarly clear convention.

Do not create unnecessarily long tab labels.

Use CSS truncation where needed.

The full file name should remain accessible through a tooltip/title or accessible label.

---

# 13. Duplicate files

Uploading the same CSV into two different workspaces must be allowed.

The workspaces remain independent.

For example:

```text
sales.csv
sales.csv (2)
```

are two separate workspaces.

Do not deduplicate or merge them.

---

# 14. Upload flow integration

The existing upload flow must become workspace-aware.

When a CSV is uploaded:

```text
current active workspace
        ↓
upload/analyze
        ↓
store response in active workspace
        ↓
show dashboard for that workspace
```

Be careful with asynchronous uploads.

If the user somehow changes workspace while an upload is in progress, the response must not be written into the wrong workspace.

Associate the upload request with the workspace ID that started it.

Example:

```text
Upload started:
workspace = A

User switches:
workspace = B

Upload completes:
result MUST be stored in A
```

This is an important correctness requirement.

---

# 15. File object handling

Inspect how the current app stores the uploaded `File`.

Do not assume browser `File` objects can or should be persisted to localStorage.

For this phase, in-memory React state is acceptable.

The workspace state should remain alive while the current Metrivia page/session is open.

Do not introduce IndexedDB unless the current architecture requires persistence across page reloads.

If you choose to persist metadata to localStorage, never attempt to serialize the raw `File` object.

Clearly document that workspace data is session/in-memory state unless persistent storage is explicitly implemented later.

---

# 16. Navigation behavior

The workspace system must coexist with existing routes/navigation.

If the app currently uses route-like state rather than React Router, preserve that architecture unless there is a compelling reason to change it.

The following should work:

```text
Workspace A
   ↓
Dashboard
   ↓
Workspace B tab
   ↓
Upload
   ↓
Workspace B
```

Switching workspaces should not unexpectedly reset the application section unless required for an empty workspace.

Recommended behavior:

- New empty workspace → Upload view.
- Existing analyzed workspace → preserve current section where practical.
- If a workspace has no dataset and user selects Dashboard → show the existing empty-dashboard/upload state.

Do not create a second routing system.

---

# 17. Settings remain global

Settings must not be duplicated per workspace.

Changing:

```text
Theme
Appearance
Haptics
```

while viewing Workspace A must immediately apply to Workspace B as well.

Keep the existing SettingsProvider/global settings architecture.

---

# 18. Haptic integration

Preserve the completed Phase A haptic architecture.

Use the existing semantic layer.

The workspace interactions should have sensible haptics where appropriate:

### `+` new workspace

Use the existing `tap()` semantic interaction.

### Selecting a workspace tab

Use a light/select-style semantic haptic if consistent with the existing interaction model.

### Closing a workspace

Use the existing `tap()` semantic interaction.

Do NOT add haptics to:

- tab hover
- mouse movement
- scrolling
- continuous dragging

Do not directly call `navigator.vibrate()` from the tab component.

Use:

```text
useMetriviaHaptics()
```

as the existing architecture requires.

Preserve iOS behavior according to the existing native-switch limitations. Do not place switch overlays over the entire tab strip if that interferes with normal tab interaction. If an iOS-native haptic treatment for tabs is technically safe, implement it narrowly; otherwise retain the Android semantic haptic and document the iOS limitation.

---

# 19. Accessibility

The tab bar must be keyboard accessible.

Use appropriate semantics.

A reasonable structure is:

```html
<div role="tablist">
  <button role="tab" ...>
```

if the UI genuinely represents tabs.

Each tab should expose:

- accessible workspace name
- active/inactive state
- close action

The close button must have an accessible label such as:

```text
Close sales.csv
```

The plus button should have:

```text
Create new workspace
```

Do not rely only on the visual `×` or `+`.

---

# 20. Keyboard behavior

Support useful keyboard interaction.

At minimum:

- Tab can reach workspace controls.
- Enter/Space activates a workspace.
- Close controls are separately reachable.
- Plus is keyboard accessible.
- Focus indicators remain visible.

If implementing full ARIA tab keyboard conventions such as ArrowLeft/ArrowRight, do so correctly rather than partially.

Do not create a keyboard trap.

---

# 21. Mobile behavior

The tab bar must work on narrow screens.

Do NOT allow the entire page to develop horizontal overflow.

Instead:

```text
[ Sales.csv × ][ Students... ][ + ]
        ← horizontal tab scrolling →
```

The workspace tab strip may horizontally scroll independently.

The `+` control should remain easy to access.

Possible structure:

```text
┌─────────────────────────────────────────┐
│ Sales ×  Students ×  Inventory ×   +   │
└─────────────────────────────────────────┘
```

Use touch-friendly target sizes.

Do not make tabs so narrow that their close controls become difficult to use.

---

# 22. Desktop behavior

On desktop:

- tabs should remain compact;
- active state should be obvious;
- the tab bar should not consume excessive vertical space;
- long names should truncate gracefully;
- the `+` button should be visually distinct but restrained.

Do not copy Chrome's exact styling.

The goal is:

> Chrome-like functionality, Metrivia-native visual design.

---

# 23. State cleanup

When a workspace is closed, ensure its state is actually removed.

Do not leave stale references in:

- workspace arrays
- active workspace ID
- upload callbacks
- filters
- chart state
- temporary analysis state

Be especially careful with asynchronous upload/analyze operations.

If an upload completes for a workspace that was closed before completion, handle that safely without recreating the closed workspace or writing into the active workspace.

---

# 24. Existing dashboard correctness

The existing dashboard must continue to work with the active workspace.

All dashboard components should read from the current workspace rather than an old global dataset state.

Check:

- KPIs
- filters
- data preview
- chart builder
- charts
- empty states
- remove file
- upload new
- clear filters

After switching tabs, these must operate on the active workspace only.

---

# 25. Existing "Upload new" behavior

The existing:

```text
Upload new
```

control must be considered carefully.

It should NOT unexpectedly destroy the current workspace.

Preferred behavior:

- either clear/restart the current workspace after an explicit user action;
- or, if the existing product semantics make more sense, create a new workspace.

Do not silently create a new workspace if that would surprise the user.

Inspect current behavior and preserve its meaning unless the workspace model requires a small adaptation.

Document the decision in the final report.

---

# 26. Do not add persistence yet

Do not implement:

- accounts
- backend workspace storage
- database persistence
- IndexedDB
- cloud synchronization
- cross-device workspaces

This phase is about **multiple in-session workspaces**.

Future persistence can be a separate phase.

---

# 27. Performance

The workspace architecture should not duplicate unnecessarily large datasets.

However, correctness is more important than premature optimization.

The current complete CSV preview intentionally exposes all rows/columns.

Do not reintroduce truncation to make tabs work.

For the current expected dataset sizes, in-memory workspace state is acceptable.

If you identify a concrete memory concern, document it rather than silently dropping data.

---

# 28. Do not redesign the themes yet

Do NOT implement:

- Monochrome as default
- theme categories
- new theme cards
- Tweaks drawer removal
- theme gallery redesign

That is the next dedicated theme phase.

The existing theme system must continue to work across all workspaces.

---

# 29. Do not redo Android haptics

Do NOT:

- replace `web-haptics`
- rewrite `useMetriviaHaptics`
- change production vibration patterns
- change Android diagnostic architecture
- add direct `navigator.vibrate()` calls to every new component

Only integrate the existing semantic haptic layer where workspace actions need feedback.

---

# 30. Validation

Run:

```bash
npm run haptics:audit
npm run lint
npm run build
```

Run existing tests as appropriate.

If there is a workspace-specific test setup, add focused tests for:

- creating a workspace
- switching workspace
- closing workspace
- closing active workspace
- closing final workspace
- duplicate file names
- isolated filters
- isolated chart configuration
- asynchronous upload response ownership
- global settings across workspaces

Do not weaken existing haptic checks.

---

# 31. Manual test matrix

Perform the following manually.

## Basic

- [ ] Fresh app starts with one empty workspace.
- [ ] Workspace tab is visible.
- [ ] `+` creates a new workspace.
- [ ] New workspace becomes active.
- [ ] New workspace shows upload state.

## Upload

- [ ] Upload CSV into Workspace A.
- [ ] Workspace A gets the file name.
- [ ] Dashboard/data preview works.
- [ ] Click `+`.
- [ ] Upload a different CSV into Workspace B.
- [ ] Workspace B is independent.

## Switching

- [ ] Switch A → B.
- [ ] B data is shown.
- [ ] Switch B → A.
- [ ] A data is shown.
- [ ] A filters remain.
- [ ] A chart configuration remains.
- [ ] B filters/chart configuration remain separate.

## Closing

- [ ] Close inactive workspace.
- [ ] Close active workspace.
- [ ] Correct neighboring workspace becomes active.
- [ ] Close final workspace.
- [ ] Fresh Untitled workspace appears.

## Duplicate names

- [ ] Upload two files with the same name.
- [ ] Both workspaces remain available.
- [ ] Labels are distinguishable.

## Async safety

- [ ] Start an upload.
- [ ] Switch workspace before completion if the UI permits.
- [ ] Verify result belongs to the original workspace.

## Navigation

- [ ] Upload navigation works.
- [ ] Dashboard navigation works.
- [ ] Settings navigation works.
- [ ] Workspace switching does not corrupt navigation state.

## Mobile

- [ ] Tabs are horizontally scrollable.
- [ ] Page itself does not gain unwanted horizontal overflow.
- [ ] Close controls are easy to tap.
- [ ] `+` is easy to tap.
- [ ] Active state remains obvious.

## Accessibility

- [ ] Keyboard can reach all tabs.
- [ ] Close buttons are reachable.
- [ ] Plus button is reachable.
- [ ] Accessible labels are meaningful.
- [ ] Focus states are visible.

## Haptics

- [ ] Existing `npm run haptics:audit` still passes.
- [ ] New workspace actions use the existing semantic layer.
- [ ] No direct `navigator.vibrate()` was added to UI components.

---

# 32. Final report

Return:

## Architecture

Explain where workspace state now lives and why.

## Workspace model

Show the effective workspace state shape.

## Files changed

List every changed file and purpose.

## Tab behavior

Explain:

- create
- switch
- close
- final-tab behavior
- naming
- duplicate names

## State isolation

Explain how these remain independent:

- dataset
- analysis
- filters
- chart configuration
- dashboard state

## Async safety

Explain how upload responses are associated with the correct workspace.

## Global settings

Confirm that theme/appearance/haptics remain global.

## Haptics

Explain which workspace actions use the existing semantic haptic layer.

## Validation

Report:

```text
haptics:audit: XX/XX
lint: PASS/FAIL
build: PASS/FAIL
tests: PASS/FAIL/NOT RUN
```

## Manual verification

List what was verified and anything that still requires browser/device testing.

## Important

Do not claim workspace state is persistent across page reloads unless you actually implement and test persistence.

The intended scope is **multiple independent workspaces during the current Metrivia session**.
