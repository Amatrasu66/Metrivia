# Metrivia Phase E --- Graphite Default, Cleaner Navigation, Workspace Dropdown, Smoothness, and 50 MB CSV Support

## Objective

Implement the next Metrivia UX/performance pass.

The current production app is React + Vite + JavaScript + Tailwind CSS
v4 + shadcn/ui/Base UI + Lucide + Motion, with a Flask + Pandas backend
on Render Free.

The current UI has these problems:

1.  The default visual theme should be **Graphite**, not Monochrome.
2.  The workspace tab `+` button looks visually awkward. Remove the
    standalone `+` tab/new-tab treatment.
3.  Remove the visible **"Frontend shell"** navigation item.
4.  Replace the current workspace-tab presentation with a compact
    **workspace selector/dropdown** that contains all open
    workspaces/tabs.
5.  Replace the current top navigation treatment with a cleaner
    shadcn-style navigation menu.
6.  The application currently feels **jittery/clunky** compared with the
    smoother feel it had before. Diagnose the actual cause before adding
    animations blindly.
7.  Use Motion / Framer Motion-style primitives and shadcn components
    where they improve the experience, but do not turn the whole
    application into a heavily animated UI.
8.  Increase CSV upload support from **10 MB to 50 MB**, but do this
    without destabilizing the existing application.
9.  Preserve all existing functionality: workspaces, filters, chart
    configuration, theme system, haptics, dashboard, full CSV preview,
    Render cold-start handling, and current API contract unless a change
    is genuinely required.

------------------------------------------------------------------------

# Part 1 --- Inspect before modifying

Do not immediately rewrite components.

First inspect the existing codebase and identify:

-   current `Shell` / application layout
-   current top navigation component
-   current `WorkspaceTabs`
-   workspace store/context/reducer
-   upload flow in `App.jsx`
-   dashboard page
-   settings page
-   theme registry/catalog
-   current Motion usage
-   current Tailwind transitions/animations
-   current `web-haptics` usage
-   backend upload route
-   backend CSV analysis implementation
-   current `MAX_CONTENT_LENGTH`
-   current CSV preview response shape
-   current frontend API client
-   current Render/Vercel deployment assumptions

Create a short implementation plan based on the actual files found.

Do not remove working functionality just because a component name
differs from this prompt.

------------------------------------------------------------------------

# Part 2 --- Change the default theme to Graphite

The current theme system from Phase D must remain intact.

Change only the **new-user/default fallback theme** from Monochrome to:

-   Theme ID: Graphite

Requirements:

-   Existing saved valid theme selections must remain unchanged.
-   Invalid/missing theme selections should now fall back to Graphite.
-   Do not delete Monochrome.
-   Do not alter the source token values of existing themes.
-   Keep all existing theme categories/search/preview behavior.
-   The Graphite theme should visibly be the initial appearance for a
    clean/new installation.
-   Update tests that currently expect Monochrome as the default.

Do not introduce a second theme source of truth.

------------------------------------------------------------------------

# Part 3 --- Replace visible workspace tabs with a workspace selector

## Current problem

The current workspace bar visibly renders something similar to:

`[ metrivia_test_sales_d... × ]                         +`

The standalone `+` treatment looks awkward.

Remove that visual pattern.

## Desired behavior

Use a compact workspace selector/dropdown in the application
navigation/header.

The selector should:

-   show the currently active workspace name
-   allow switching between all open workspaces
-   show all open workspace names in the menu
-   visually indicate the active workspace
-   allow closing a workspace from its menu item without accidentally
    triggering an unwanted switch
-   provide an obvious action for creating a new workspace
-   preserve the existing workspace reducer/store behavior
-   preserve independent dataset/filter/chart state per workspace
-   preserve duplicate-name handling
-   preserve the existing active-workspace closing rules
-   preserve haptics where they already make sense

The old workspace tab strip should no longer occupy a full horizontal
row.

### Important

Do NOT create a second workspace state system.

The existing workspace context/reducer remains the source of truth.

The selector is only a UI representation of the existing workspace
state.

## shadcn NativeSelect reference supplied by the user

The user supplied this shadcn example:

``` jsx
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select"

export function NativeSelectDemo() {
  return (
    <NativeSelect>
      <NativeSelectOption value="">Select status</NativeSelectOption>
      <NativeSelectOption value="todo">Todo</NativeSelectOption>
      <NativeSelectOption value="in-progress">In Progress</NativeSelectOption>
      <NativeSelectOption value="done">Done</NativeSelectOption>
      <NativeSelectOption value="cancelled">Cancelled</NativeSelectOption>
    </NativeSelect>
  )
}
```

Adapt this to the existing Vite/React application.

Do not import Next.js-only APIs.

If `NativeSelect` is already available, use it. If it is not
installed/generated in the current shadcn setup, inspect the existing
component conventions and add the minimal compatible shadcn component
rather than introducing an unrelated select library.

The workspace selector should be accessible from keyboard and should
have a useful label/accessible name.

### Important UX decision

A native select cannot conveniently contain independent close buttons
inside every option.

Therefore:

-   Use `NativeSelect` if it provides the cleanest compact workspace
    switcher.
-   If closing individual workspaces requires a richer menu, use the
    existing shadcn/Base UI dropdown/menu primitive instead.
-   Do not force an awkward interaction merely to copy the supplied demo
    literally.

The functional requirement matters more than copying the demo
line-for-line.

------------------------------------------------------------------------

# Part 4 --- Remove "Frontend shell"

The current top navigation contains a visible item labeled:

`Frontend shell`

Remove it completely.

Do not replace it with another placeholder/demo label.

Search the codebase for any other references to:

-   `Frontend shell`
-   `Frontend Shell`
-   frontend shell demo/status UI

Remove only the user-facing navigation/demo representation that is no
longer useful.

Do not remove the actual application shell architecture if the term is
used internally as a component name.

------------------------------------------------------------------------

# Part 5 --- Replace the current navigation with a clean shadcn NavigationMenu

The user supplied the following shadcn NavigationMenu reference:

``` jsx
"use client"

import * as React from "react"
import Link from "next/link"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
} from "lucide-react"

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu"
```

The supplied example is from a Next.js/shadcn context.

This Metrivia project is Vite + React.

Therefore:

-   Do NOT import `next/link`.
-   Adapt the navigation to the application's existing page/navigation
    mechanism.
-   Do not introduce React Router just for this task if the application
    does not currently use it.
-   Reuse the existing navigation state/actions if the project uses
    local page state.
-   If React Router is already present, use it consistently.

## Desired navigation

The header should feel like a modern analytics application rather than a
demo shell.

Keep the useful destinations/actions that already exist, such as:

-   Upload
-   Dashboard
-   Settings

The workspace selector should live naturally in the same
header/navigation area.

Remove:

-   Frontend shell
-   demo/status labels
-   unnecessary navigation clutter

The navigation should remain compact on desktop and responsive on
smaller screens.

Use the supplied shadcn NavigationMenu pattern as the visual/interaction
reference, but adapt its contents to Metrivia.

Do not copy the unrelated "Getting started / Components / With Icon /
Docs" demo content into Metrivia.

------------------------------------------------------------------------

# Part 6 --- Recommended header structure

Aim for a structure conceptually similar to:

``` text
[ Metrivia ]   [ Workspace ▼ ]   [ Upload ] [ Dashboard ] [ Settings ]   [ appearance ]
```

Do not treat this as a pixel-perfect requirement.

The important characteristics are:

-   compact
-   balanced
-   no redundant tab strip
-   no ugly standalone plus button
-   workspace switching is easy to discover
-   primary application navigation is clear
-   settings/theme controls remain accessible
-   header works on desktop/tablet/mobile

On narrow screens, collapse gracefully rather than allowing horizontal
overflow.

------------------------------------------------------------------------

# Part 7 --- Diagnose and fix the jittery/clunky feel

This is important.

Do NOT simply add more animations.

First determine why the current app feels jittery.

Investigate for:

-   unnecessary React re-renders
-   workspace context causing broad tree re-renders
-   unstable object/array/function identities
-   animation triggering on every render
-   CSS transitions on too many properties
-   transitions on layout-affecting properties
-   repeated `transform`/`scale` interactions
-   animated height/width/padding/margin where transforms would be safer
-   layout animation measuring large DOM trees
-   table rendering cost from large CSV previews
-   chart re-rendering when unrelated workspace state changes
-   expensive theme CSS updates
-   large table DOM updates
-   scroll handlers
-   resize observers
-   animation loops
-   excessive box-shadow/filter transitions
-   duplicate Motion/Framer Motion systems
-   unnecessary `AnimatePresence`
-   animation of the entire dashboard when only one small component
    changes

Use React DevTools/profiling or code inspection where available.

Do not guess.

------------------------------------------------------------------------

# Part 8 --- Motion strategy

The project already uses Motion-related functionality.

Prefer the modern Motion for React API already compatible with the
project's dependencies.

Do NOT install both:

-   `framer-motion`
-   and `motion`

unless the codebase genuinely requires both.

Avoid dependency duplication.

## Animation principles

Use animation selectively for:

### Good candidates

-   workspace selector open/close
-   active navigation indicator
-   dropdown/menu appearance
-   button press feedback
-   small card hover/press states
-   upload progress/status transitions
-   page/content presence transitions where useful
-   chart configuration changes when the affected component is small
-   theme preview interactions
-   workspace switching indicator

### Avoid

-   animating the entire dashboard on every state update
-   animating large CSV tables
-   animating every table row
-   animating charts continuously
-   animating scroll
-   parallax
-   large blur/filter effects
-   expensive shadows
-   width/height/padding/margin animations for large containers
-   animations that delay interaction

Prefer:

-   `transform`
-   `opacity`

for performance-sensitive motion.

Motion's layout animations may be used for small UI elements where they
materially improve continuity, but do not apply `layout`
indiscriminately to large trees.

Use `layoutId` for a small shared active indicator only if it genuinely
improves the interaction.

Respect reduced motion.

Use Motion's reduced-motion support so users who prefer reduced motion
do not receive transform/layout-heavy animations.

A reasonable global configuration is:

``` jsx
<MotionConfig reducedMotion="user">
  {children}
</MotionConfig>
```

if this integrates cleanly with the existing application.

Use short, responsive transitions.

Avoid making every interaction slower.

------------------------------------------------------------------------

# Part 9 --- Preserve the "smooth" feeling

The target is not "more animation".

The target is:

-   immediate response
-   stable layout
-   minimal visual movement
-   smooth microinteractions
-   no accidental shifting
-   no animation fighting user input

When an interaction changes layout, prefer a small transform/opacity
animation or a narrowly scoped layout animation.

Do not animate elements that contain the large CSV table.

Do not animate a 50 MB dataset into the DOM.

------------------------------------------------------------------------

# Part 10 --- CSV upload limit: increase from 10 MB to 50 MB

## Current architecture

Frontend:

Vercel static/React application.

Backend:

Flask + Pandas API on Render Free.

The frontend sends CSV uploads directly to the Render backend.

The backend currently has a 10 MB application-level limit.

## Required change

Raise the application-level CSV limit to:

**50 MiB**

Use one explicit constant rather than scattered magic numbers.

For example:

``` python
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
```

and use it consistently.

The frontend should also validate the file size before beginning an
upload.

Do not rely only on the frontend check.

The backend must remain authoritative.

------------------------------------------------------------------------

# Part 11 --- Important Render/Vercel constraint analysis

The implementation must account for the following current platform
facts.

### Render Free

Render's current Free web service provides:

-   0.1 CPU
-   512 MB RAM
-   750 free instance hours/month
-   idle spin-down after 15 minutes
-   ephemeral filesystem
-   one free instance / no horizontal scaling on the Free plan

Render's documentation does not list a simple 50 MB application-upload
ceiling for normal Render web services in the way Vercel Functions
document a 4.5 MB function body limit.

Therefore the application can raise its Flask upload limit to 50 MiB,
but **50 MB CSV processing is not automatically safe on a 512 MB RAM /
0.1 CPU instance**.

The major risk is not merely receiving the HTTP body.

The major risk is Pandas memory amplification.

A 50 MB CSV can consume substantially more than 50 MB in memory after
parsing, especially with:

-   string-heavy columns
-   object dtype
-   many columns
-   large unique values
-   conversion to Python dictionaries
-   serialization to JSON

This is particularly important because the current Metrivia backend
returns the complete preview dataset and the frontend renders the
dataset.

Do not make the backend accept 50 MiB and then blindly call:

``` python
df.to_dict(...)
```

for an arbitrarily large dataset without measuring the consequences.

------------------------------------------------------------------------

# Part 12 --- Preserve the full CSV preview feature without making 50 MB uploads unsafe

The user previously requested that the dashboard preview the complete
CSV rather than limiting it to 100 rows.

Do not casually revert that requirement.

However, redesign the data transport/rendering if necessary.

Investigate the current response format and determine whether a 50 MB
CSV could produce an excessively large JSON response.

If the current architecture would turn a 50 MB CSV into an enormous JSON
payload, implement a safer architecture that preserves the user-visible
ability to inspect the complete dataset.

Possible approaches, depending on the existing architecture:

### Preferred direction

Keep the dataset server response lightweight and avoid duplicating the
entire CSV multiple times in memory.

Consider:

-   streaming/chunked CSV processing
-   server-side dataset session/chunk endpoints
-   paged/chunked row retrieval
-   virtualized table rendering
-   returning metadata separately from row chunks
-   lazy row retrieval as the user scrolls

Do not add a database just to solve this unless it is actually
necessary.

Do not introduce Redis just for this.

Do not turn Metrivia into a persistent-storage application.

The current project is intentionally stateless.

If a larger architectural change is required, explain why in the final
implementation report.

------------------------------------------------------------------------

# Part 13 --- Frontend file validation

Implement a reusable upload validation helper.

Requirements:

-   accept `.csv`
-   reject non-CSV files
-   reject files larger than 50 MiB
-   show a clear user-facing error
-   do not begin network upload for an invalid file
-   preserve existing upload/cold-start UX
-   preserve existing workspace association
-   do not break retry behavior

Use the file's actual size in bytes.

Do not trust only the filename extension.

The backend remains authoritative.

------------------------------------------------------------------------

# Part 14 --- Backend validation

Update Flask configuration/route handling so:

-   maximum request size is 50 MiB
-   the upload route explicitly handles `413 Request Entity Too Large`
-   the error returned to the frontend is understandable
-   the backend still rejects larger files
-   non-CSV uploads remain rejected
-   existing CORS behavior remains unchanged
-   existing health endpoint remains unchanged
-   existing upload response fields remain backward compatible unless a
    structural change is unavoidable

If using:

``` python
app.config["MAX_CONTENT_LENGTH"]
```

ensure the value is correctly set before request handling.

Add a dedicated error handler for `RequestEntityTooLarge` if the current
API does not already provide a useful JSON response.

------------------------------------------------------------------------

# Part 15 --- Pandas memory safety

Before implementing 50 MB support, inspect the current analysis
pipeline.

Avoid unnecessary copies.

Look for patterns such as:

``` python
df.copy()
df.to_dict()
df.to_json()
```

being held simultaneously.

Do not create multiple full representations of the dataset
unnecessarily.

If possible:

-   parse once
-   calculate metadata without duplicate full copies
-   release temporary objects
-   avoid Python-object expansion until actually needed
-   avoid converting the entire dataset to nested Python dictionaries
    unless the response architecture requires it

Do not sacrifice correctness of the existing analysis features.

------------------------------------------------------------------------

# Part 16 --- Table rendering

Inspect the current dashboard preview table.

If the complete CSV is rendered as one DOM node per cell, a large
dataset can make the browser itself jitter even if the backend is
healthy.

For large datasets, use virtualization/windowing if it can be introduced
without destabilizing the project.

Before adding a new dependency, check whether the project already has a
suitable table/virtualization primitive.

If a virtualization library is needed, choose a small, established
React-compatible library.

The table must preserve:

-   sticky header
-   horizontal scrolling for wide datasets
-   readable cells
-   keyboard accessibility
-   existing theme tokens
-   existing row/column counts

The goal is to avoid rendering tens/hundreds of thousands of DOM cells
simultaneously.

------------------------------------------------------------------------

# Part 17 --- Do not break charts

The workspace architecture already preserves chart configuration per
workspace.

Do not regress this.

Changing workspace selection must still restore:

-   dataset
-   filters
-   chart type
-   selected fields
-   chart configuration
-   error/retry state
-   upload state where applicable

Do not cause every chart to re-render when only the active workspace
selector opens.

Memoize or split context subscriptions where appropriate.

------------------------------------------------------------------------

# Part 18 --- Navigation interaction design

The new navigation should not feel like a demo component pasted into the
application.

Use the supplied shadcn NavigationMenu concepts, but adapt them to
Metrivia.

Suggested navigation:

-   Metrivia branding
-   Workspace selector
-   Upload
-   Dashboard
-   Settings
-   appearance/theme control

Do not add:

-   Docs
-   Getting Started
-   Components
-   Backlog
-   To Do
-   Done
-   Frontend Shell

unless an existing real Metrivia feature already uses that concept.

------------------------------------------------------------------------

# Part 19 --- Responsive behavior

Test at:

-   1440px desktop
-   1366px desktop
-   1024px tablet/laptop
-   768px tablet
-   430px mobile
-   390px mobile

The header must not:

-   overflow horizontally
-   cause the page width to expand
-   cause layout jumps when a dropdown opens
-   move the dashboard unexpectedly
-   create a second horizontal scrollbar

The workspace selector should truncate long filenames gracefully.

Example:

`metrivia_test_sales_dataset_2026.csv`

should not force the header wider.

Use accessible truncation/tooltips where useful.

------------------------------------------------------------------------

# Part 20 --- Haptics

Preserve the existing haptic architecture.

Do not add haptic feedback to:

-   hover
-   scroll
-   animation frames
-   every table row
-   every chart redraw

Use existing semantic haptic functions for:

-   workspace switch
-   create workspace
-   close workspace
-   primary navigation actions

Do not change the Android diagnostic work from Phase A unless required
by this task.

------------------------------------------------------------------------

# Part 21 --- Animation performance safeguards

After implementation, inspect the application for unnecessary
transitions.

In particular, do not leave broad CSS such as:

``` css
transition: all ...
```

on large containers or dashboard roots.

Prefer explicit properties such as:

``` css
transition:
  opacity 160ms ease,
  transform 160ms ease;
```

where appropriate.

Do not animate:

-   `width`
-   `height`
-   `padding`
-   `margin`
-   large `box-shadow`
-   large `filter`

unless there is a strong reason.

Use transform/opacity for interaction feedback.

------------------------------------------------------------------------

# Part 22 --- Prevent layout shift

The new navigation and workspace selector should have stable dimensions.

Avoid:

-   changing header height during open/close
-   replacing buttons with differently sized controls
-   adding/removing scrollbars that move the page
-   dropdowns affecting document flow

Prefer overlays/popovers for menus.

Reserve scrollbar space if necessary.

------------------------------------------------------------------------

# Part 23 --- Testing requirements

Add/update automated tests for:

### Theme

-   Graphite is the default.
-   Existing valid themes remain valid.
-   Monochrome remains selectable.

### Workspace selector

-   renders active workspace
-   lists all open workspaces
-   switches workspaces correctly
-   creates workspace
-   closes workspace
-   preserves state
-   handles duplicate filenames
-   handles final-workspace closure

### Navigation

-   Upload works
-   Dashboard works
-   Settings works
-   Frontend Shell is absent
-   no old workspace tab strip remains

### Upload

-   accepts CSV \<= 50 MiB
-   rejects \> 50 MiB
-   rejects non-CSV
-   backend rejects \> 50 MiB
-   backend returns useful 413 JSON
-   existing upload response remains compatible

### Performance

Add targeted checks where practical for:

-   no unnecessary full-tree animation
-   no `transition-all` on major dashboard containers
-   no accidental animation of the full CSV table
-   no repeated chart recreation caused by unrelated navigation state

------------------------------------------------------------------------

# Part 24 --- Manual test matrix

After automated validation, manually test:

## Desktop

1.  Open app with fresh local storage.
2.  Confirm Graphite is the default.
3.  Confirm old workspace tab strip is gone.
4.  Confirm standalone `+` tab is gone.
5.  Confirm Frontend Shell is gone.
6.  Open workspace selector.
7.  Create two additional workspaces.
8.  Upload different CSVs into them.
9.  Switch between them.
10. Confirm state remains isolated.
11. Close workspaces.
12. Confirm active workspace selection behavior.
13. Open Settings.
14. Change theme.
15. Switch workspaces.
16. Confirm theme remains global.
17. Navigate Upload → Dashboard repeatedly.
18. Observe whether the UI feels immediate and smooth.

## Large CSV

Test with:

-   10 MB CSV
-   20 MB CSV
-   30 MB CSV
-   40 MB CSV
-   50 MB CSV
-   slightly-over-limit CSV, e.g. 50.1 MiB

Record:

-   upload time
-   server response time
-   peak memory if visible in Render metrics
-   whether the Render service restarts
-   browser memory/CPU behavior
-   table scrolling smoothness
-   chart responsiveness
-   whether any request returns 413/5xx
-   whether the service becomes unresponsive

Do not claim 50 MB support is production-safe merely because the request
was accepted once.

------------------------------------------------------------------------

# Part 25 --- Render Free plan conclusion to encode in implementation

Treat 50 MiB as a **tested application limit**, not as a guarantee that
every 50 MiB CSV will process successfully on Render Free.

Render Free currently provides 512 MB RAM and 0.1 CPU. The backend uses
Pandas, so real memory consumption depends heavily on CSV contents and
the response representation.

The implementation should therefore:

-   support a 50 MiB request limit
-   minimize memory amplification
-   avoid duplicate full-dataset copies
-   avoid returning unnecessary duplicate representations
-   protect the browser from rendering an enormous DOM
-   preserve existing functionality
-   provide useful errors when resource limits are exceeded

If the implementation reveals that reliable 50 MiB processing cannot be
guaranteed on the Free instance, report that honestly rather than hiding
the problem.

Do not automatically upgrade the Render plan.

------------------------------------------------------------------------

# Part 26 --- Vercel consideration

The frontend is deployed as a Vercel frontend and the upload request is
sent to the Render Flask backend.

Do not route the CSV through a Vercel Function.

Vercel Functions have a documented 4.5 MB request/response body limit.

That limit does not mean the current architecture cannot accept 50 MiB,
because the upload should continue going directly from the browser to
Render.

Do not accidentally introduce a Vercel API route or serverless proxy for
CSV uploads.

------------------------------------------------------------------------

# Part 27 --- Preserve the current cold-start UX

The Render backend can spin down after inactivity on the Free plan.

Do not remove the existing cold-start detection/wake UX.

The upload flow should still:

-   detect the backend waking up
-   communicate progress/state
-   handle retries
-   associate the result with the correct workspace
-   avoid writing an upload result into a workspace that has since been
    closed/switched

------------------------------------------------------------------------

# Part 28 --- Code quality

Keep the implementation modular.

Prefer:

-   small components
-   existing utilities
-   existing context/store
-   existing design tokens
-   existing haptics
-   existing Motion dependency

Avoid:

-   giant components
-   duplicate state
-   duplicate animation libraries
-   duplicate theme registries
-   unnecessary dependencies
-   global event listeners without cleanup
-   broad CSS overrides

Do not rewrite unrelated parts of the application.

------------------------------------------------------------------------

# Part 29 --- Final validation commands

Run the project's actual validation commands.

At minimum, run:

``` bash
npm run lint
npm run build
```

Also run the existing project-specific tests/audits for:

-   haptics
-   themes
-   workspaces
-   backend CORS/upload behavior

If new tests are added, run them.

For the backend, run the project's existing Python test/validation
commands.

Do not claim tests passed unless they actually ran.

------------------------------------------------------------------------

# Part 30 --- Final report required from OpenCode

After implementation, report:

1.  Files changed.
2.  Files added.
3.  Files removed.
4.  Graphite default implementation.
5.  Workspace selector implementation.
6.  Navigation redesign.
7.  What caused the jitter/clunkiness.
8.  What was changed to fix it.
9.  Motion usage and where it was intentionally avoided.
10. Reduced-motion handling.
11. Upload limit changes.
12. How 50 MiB is enforced frontend/backend.
13. Any changes made to Pandas processing.
14. Any table virtualization/chunking changes.
15. Render Free risks discovered.
16. Vercel architecture confirmation that uploads do not pass through a
    Vercel Function.
17. Automated test results.
18. Build/lint results.
19. Any remaining manual tests that must be performed.

## Important final rule

Do not report "50 MB support is fully safe on Render Free" unless actual
testing demonstrates that it is reliable for representative datasets.

The goal is a cleaner Graphite-first Metrivia UI, a compact workspace
selector, a modern shadcn-style navigation system, smoother interaction
without animation bloat, and a carefully engineered path from 10 MiB to
50 MiB CSV uploads.
