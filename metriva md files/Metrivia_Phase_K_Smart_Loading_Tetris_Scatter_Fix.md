# Metrivia --- Phase K

## Smart Processing Loading UX + Tetris Backend Wake-Up + Scatter Chart Investigation/Fix

You are working on the Metrivia production codebase.

Metrivia is a React/Vite frontend + Flask/Pandas backend
data-visualization application using Bklit chart components.

The production app is currently fast enough for the tested CSV
workloads. Do **not** reopen the CSV transport/gzip architecture unless
the investigation below produces new evidence that it is necessary.

This phase has three tightly scoped objectives:

1.  Replace the current long-running CSV "Analyze" loading state with a
    smart spinner → progressive progress-bar experience.
2.  Replace the backend wake-up loading visual with the supplied Tetris
    loader while preserving useful backend status information.
3.  Investigate and fix the Scatter Chart rendering problem visible with
    the supplied 1,200-row test dataset, using the installed Bklit
    implementation rather than replacing the chart library.

------------------------------------------------------------------------

# 1. Important context

The user tested the production app at:

-   `https://metrivia.vercel.app`

Current observations:

### Backend startup

When Render's backend is waking up, Metrivia currently shows a card
similar to:

-   "Starting Metrivia's backend"
-   "Server is waking up..."
-   elapsed seconds
-   Connecting
-   Starting server
-   Ready

The user wants a more useful visual during this wait.

### CSV processing

For small files, the current spinner/loading state is acceptable.

For larger files, approximately 10 MiB or more, processing can take long
enough that a simple "Analyze" spinner feels inadequate.

The desired behavior is:

``` text
Fast operation:
existing spinner
        |
        +---- finishes quickly ----> done

Long operation:
existing spinner
        |
        +---- still running after ~800 ms
                              |
                              v
                     progressive progress bar
                              |
                              v
                           complete
```

Do NOT show the progress bar for every upload.

### Scatter chart

The user uploaded:

`metrivia_test_sales_dataset(1).csv`

This dataset has:

-   1,200 rows
-   21 columns
-   `Order Date` datetime-like values
-   `Profit Margin` numeric values
-   Profit Margin min approximately `-1.3328`
-   Profit Margin max approximately `0.6321`
-   Profit Margin mean approximately `0.3365`

The user selected:

-   Chart: Scatter
-   X axis: `Order Date`
-   Y axis: `Profit Margin`

The screenshot shows the scatter points extending visually beyond the
intended chart region/card, with points appearing to spill into the
sections below the chart.

The user believes the scatter implementation is not behaving correctly.

Do not assume the problem is caused by the data distribution alone.

------------------------------------------------------------------------

# 2. Objective A --- Smart CSV processing progress

## Desired UX

Keep the existing spinner for fast operations.

Only promote the loading UI to a progress bar if the operation is still
running after approximately **800 ms**.

Use the supplied Radix/shadcn-style `Progress` component rather than
inventing another progress implementation.

The user supplied this component:

``` tsx
'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Progress as ProgressPrimitive } from 'radix-ui';

function Progress({
  className,
  indicatorClassName,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  indicatorClassName?: string;
}) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-secondary', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn('h-full w-full flex-1 bg-primary transition-all', indicatorClassName)}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
```

The same supplied source also contains `ProgressCircle` and
`ProgressRadial`, but they are not required for this task.

## Important: progress is estimated, not real backend progress

Do NOT pretend that the frontend knows the backend's exact processing
percentage.

The existing upload API returns the completed result rather than
streaming individual processing stages.

Therefore implement a **staged estimated progress**.

Suggested stages:

``` text
0–15%    Starting analysis
15–35%   Reading CSV
35–55%   Detecting column types
55–75%   Calculating statistics
75–90%   Preparing chart data
90–95%   Finalizing
95%      Waiting for server response
100%     Complete
```

The exact timings/stage percentages can be adjusted after inspecting the
existing upload flow.

### Rules

-   Do not claim that 55% means the backend has literally completed 55%.
-   Progress should advance smoothly and plausibly.
-   Once it reaches approximately 90--95%, it should wait for the actual
    API response rather than reaching 100% prematurely.
-   On success, transition to 100% and then the dashboard.
-   On failure, stop the progress state and show the existing error UI.
-   Cancel timers/animation loops when the workspace closes, upload
    changes, component unmounts, or request finishes.
-   Preserve the existing workspace-ID-safe async behavior.
-   Do not introduce polling or SSE in this phase.
-   Do not change the backend API merely to obtain progress percentages.

### Avoid progress flashing

If the operation finishes before the \~800 ms threshold:

-   never render the progress bar
-   retain the existing spinner experience

If the progress bar has appeared, avoid instantly flashing it away if
the request completes a few milliseconds later. A small minimum visible
duration is acceptable, but do not introduce unnecessary artificial
delays to normal uploads.

### Implementation expectations

First inspect the existing upload/loading state implementation.

Likely areas include:

-   upload/dropzone component
-   workspace upload state
-   analysis/loading state
-   `Analyze` text
-   backend wake-up/health state
-   relevant hooks

Do not guess filenames. Find the actual implementation first.

Prefer a small reusable hook/helper if that makes the state logic
cleaner, for example:

``` text
useDelayedProgress(...)
```

but only introduce it if it genuinely reduces complexity.

Keep existing haptics, workspace behavior, error handling, and
accessibility intact.

The progress component should expose accessible status, e.g. appropriate
`role`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, or Radix's
native semantics where applicable.

------------------------------------------------------------------------

# 3. Objective B --- Backend startup Tetris loader

Use the supplied Tetris loader component as the visual loading indicator
for the backend wake-up state.

The supplied component is `TetrisLoader`.

It supports:

-   `columns`
-   `rows`
-   `cellSize`
-   `gap`
-   `speed`
-   `playing`
-   `loop`
-   `label`
-   reduced-motion behavior
-   `role="status"`
-   `aria-busy`

The supplied demo uses:

``` tsx
<TetrisLoader
  columns={columns}
  rows={rows}
  cellSize={cellSize}
  gap={gap}
  speed={speed}
  label="Building your app"
/>
```

Do not rewrite the Tetris algorithm unless the existing project has a
compatibility issue.

If the component is not already present in Metrivia:

1.  Locate the appropriate UI component directory.
2.  Add the supplied TetrisLoader implementation with the project's
    conventions.
3.  Preserve its reduced-motion behavior.
4.  Use Metrivia theme variables rather than introducing a new visual
    theme.
5.  Keep the loader lightweight.

## Desired backend card

Approximately:

``` text
┌─────────────────────────────────────────────┐
│                                             │
│              [ Tetris loader ]              │
│                                             │
│        Starting Metrivia's backend          │
│                                             │
│             Server is waking up...          │
│                                             │
│                  22 seconds                  │
│                                             │
│    ● Connecting   ● Starting server   ○ Ready│
│                                             │
└─────────────────────────────────────────────┘
```

The exact layout can follow the existing Metrivia card design.

Keep:

-   elapsed timer
-   connection/startup/ready state indicators
-   existing backend health logic
-   retry/error behavior
-   accessibility

The Tetris loader replaces the current generic visual; it does not
replace the backend state machine.

Do not make the Tetris animation itself represent backend percentage. It
is simply an engaging visual while Render wakes up.

Respect `prefers-reduced-motion`.

------------------------------------------------------------------------

# 4. Objective C --- Investigate Scatter Chart before changing it

This is the most important technical investigation in this phase.

The user is currently using:

``` text
Scatter
X: Order Date
Y: Profit Margin
```

with the 1,200-row supplied dataset.

The visible problem is that points appear to escape the intended
plotting/card region and continue into content below the chart.

Do NOT simply add `overflow-hidden` as the first fix.

Do NOT replace Bklit.

Do NOT replace the chart with Recharts, Chart.js, D3 from scratch, or
another library.

First identify whether the problem comes from:

1.  Metrivia data preparation
2.  Metrivia ScatterChart configuration
3.  Bklit's installed ScatterChart implementation
4.  SVG dimensions/viewBox
5.  scale/domain calculation
6.  responsive measurement
7.  clipPath behavior
8.  point coordinate calculation
9.  animation/transition
10. CSS overflow
11. interaction/highlight rendering

------------------------------------------------------------------------

# 5. Verify against current Bklit behavior

Current official Bklit documentation describes ScatterChart as a
composable time-series scatter chart.

Official docs currently show:

``` jsx
<ScatterChart data={data}>
  <Grid horizontal />
  <Scatter dataKey="users" />
  <XAxis />
  <ChartTooltip />
</ScatterChart>
```

and document:

-   `ScatterChart.data`
-   `ScatterChart.xDataKey`
-   `ScatterChart.margin`
-   `ScatterChart.aspectRatio`
-   `Scatter.dataKey`
-   `Scatter.radius`
-   `Scatter.strokeWidth`
-   `Scatter.ringGap`
-   `Scatter.fadeOnHover`
-   `Scatter.inactiveOpacity`
-   `Scatter.inactiveBlur`
-   `Scatter.showActiveHighlight`
-   `Scatter.yGradient`

Official Bklit docs: `https://bklit.com/docs/components/scatter-chart`

Bklit also documents shared `XAxis`, `YAxis`, `Grid`, and `ChartTooltip`
components.

Inspect the **actual installed/vendor source in this repository** rather
than relying only on documentation.

------------------------------------------------------------------------

# 6. Known Bklit clipping issue to investigate

Bklit's GitHub currently has an open issue about duplicate `clipPath`
IDs causing one chart to be clipped according to another chart's
dimensions:

`https://github.com/bklit/bklit-ui/issues/226`

This issue is specifically documented for charts using hardcoded
clipPath IDs.

Do NOT assume this is automatically the Metrivia bug.

However, explicitly inspect the installed ScatterChart implementation
for:

-   `<clipPath>`
-   hardcoded IDs
-   generated IDs
-   `url(#...)`
-   SVG `<defs>`
-   chart-specific clip rectangles
-   multiple charts mounted on the same page

Determine whether the Scatter implementation has a similar
vulnerability.

If a Bklit source bug is present in the vendored component, make the
smallest local compatibility fix necessary, and document why it is
required.

------------------------------------------------------------------------

# 7. Scatter diagnostic test matrix

Use the supplied dataset and build a small repeatable diagnostic if
useful.

Test at least:

### Dataset size

-   50 points
-   100 points
-   200 points
-   500 points
-   1,200 points

### Y values

-   original `Profit Margin`
-   positive-only subset
-   negative + positive values
-   synthetic evenly distributed values

### X values

-   actual `Order Date`
-   sorted `Order Date`
-   unsorted `Order Date`

### Rendering

Check:

-   SVG width/height
-   chart aspect ratio
-   plot bounds
-   margin
-   X scale range
-   Y scale range
-   point x/y coordinates
-   clip path bounds
-   parent card bounds
-   overflow
-   ResizeObserver/measurement result
-   animation transforms

The goal is to identify the actual failure mechanism.

------------------------------------------------------------------------

# 8. Do not mistake data outliers for a rendering bug

The supplied dataset genuinely has negative Profit Margin values and
positive values.

The Y range is approximately:

``` text
-1.3328 → 0.6321
```

This can make most points visually cluster in the upper/lower portion of
the chart depending on the scale.

That is valid chart behavior.

But **points drawing outside the chart's actual plotting region are not
valid merely because there are outliers**.

Separate these two questions:

``` text
Q1: Is the distribution visually compressed?
    Possibly yes — data/domain explains this.

Q2: Are points escaping the chart bounds?
    Investigate the renderer/clip/scales.
```

Do not "fix" Q1 by incorrectly deleting or clipping valid data.

------------------------------------------------------------------------

# 9. Dense scatter rendering

Bklit's current Scatter defaults include relatively large points/rings:

``` text
radius = 5
strokeWidth = 2
ringGap = 2
fadeOnHover = true
inactiveOpacity = 0.5
inactiveBlur = 2
showActiveHighlight = true
```

With 1,200 observations this can become visually dense.

After fixing the actual coordinate/clipping issue, evaluate whether
Metrivia should explicitly use a smaller visual configuration such as:

``` jsx
<Scatter
  dataKey={yAxis}
  radius={3}
  strokeWidth={1}
  ringGap={1}
/>
```

Do not make this change automatically unless testing shows it materially
improves readability without harming the existing design.

Do not sacrifice data fidelity merely to make the chart look less dense.

------------------------------------------------------------------------

# 10. Preserve current chart functionality

The Scatter fix must preserve:

-   tooltip
-   hover interaction
-   crosshair
-   date axis
-   numeric Y values
-   workspace state
-   active filters
-   theme colors
-   responsive layout
-   accessibility
-   existing Bklit architecture

Do not modify Bar, Line, Area, or Pie charts unless a shared Bklit fix
demonstrably requires it.

The recent Bar Chart Phase J changes are considered complete and should
not be disturbed.

------------------------------------------------------------------------

# 11. Production performance constraint

Metrivia's production CSV processing is already working well.

Do not:

-   remove gzip
-   replace the upload API
-   introduce SSE
-   introduce WebSockets
-   introduce polling
-   move CSV parsing to the browser
-   redesign workspace state

unless the investigation produces compelling evidence that one is
required for this phase.

The goal is UX improvement, not architectural expansion.

------------------------------------------------------------------------

# 12. Required tests

After implementation, run:

``` bash
npm run lint
npm run build
npm run themes:test
npm run ui:audit
npm run haptics:audit
npm run workspaces:test
npm run pie:test
npm run bar:test
```

If Scatter-specific tests do not exist, add a focused test script where
practical.

Test at minimum:

### Loading state

-   fast upload does not show progress bar
-   long upload transitions spinner → progress
-   progress does not exceed 95% while waiting for API
-   success reaches 100%
-   failure cleans up progress state
-   timers are cleaned up
-   workspace close does not leave timers running
-   reduced motion remains respected

### Backend loader

-   Tetris loader renders
-   backend state text remains correct
-   elapsed time remains correct
-   reduced-motion behavior works
-   no layout overflow
-   loader does not block retry/error controls

### Scatter

-   50 points
-   100 points
-   200 points
-   500 points
-   1,200 points
-   negative/positive Y values
-   correct X/Y mapping
-   points remain inside chart bounds
-   tooltip remains correct
-   responsive resize remains correct
-   no horizontal page overflow
-   no points spill into following cards

------------------------------------------------------------------------

# 13. Manual verification checklist

Because the Scatter issue is visual, automated tests are not sufficient.

After implementation, manually verify the production/local build at:

### Desktop

-   1440px
-   1366px
-   1280px

### Mobile

-   430px
-   390px

For Scatter specifically:

1.  Load `metrivia_test_sales_dataset(1).csv`.
2.  Open Dashboard.
3.  Select Scatter.
4.  Set X axis to `Order Date`.
5.  Set Y axis to `Profit Margin`.
6.  Wait for the chart to finish animating.
7.  Scroll around the chart.
8.  Confirm no points appear outside the chart/card.
9.  Hover points.
10. Confirm tooltip values remain correct.
11. Resize the browser.
12. Confirm points stay inside the plotting region.
13. Confirm the following "Columns" and "Numeric summary" cards remain
    visually clean.
14. Check 1,200-point density.
15. Check a positive-only subset if the UI makes this practical.

For CSV loading:

1.  Use a small CSV.
2.  Confirm only the spinner appears.
3.  Use the larger test CSV.
4.  Confirm spinner appears initially.
5.  If processing exceeds \~800 ms, confirm the progress bar replaces
    it.
6.  Confirm progress moves smoothly.
7.  Confirm it waits near the upper range until the actual response
    arrives.
8.  Confirm completion transitions cleanly to the dashboard.

For backend startup:

1.  Trigger a cold backend.
2.  Confirm Tetris loader appears.
3.  Confirm elapsed time still updates.
4.  Confirm connection/startup/ready states still update.
5.  Confirm reduced-motion behavior if available.

------------------------------------------------------------------------

# 14. Files and scope

Before editing:

1.  Inspect the repository.
2.  Find the real upload/loading components.
3.  Find the real backend startup/wake-up component.
4.  Find the installed Tetris loader location or add it according to
    project conventions.
5.  Find `ScatterChartView`.
6.  Find the installed/vendor Bklit ScatterChart source.
7.  Find shared chart measurement/scale utilities.
8.  Find any existing chart-specific tests.

Do not assume filenames.

Keep the final diff scoped to:

-   smart loading/progress implementation
-   Tetris backend loading implementation
-   Scatter diagnosis/fix
-   focused tests
-   necessary UI component addition

Do not refactor unrelated code.

------------------------------------------------------------------------

# 15. Final report required

When finished, report:

## Files changed

List exact files.

## Files added

List exact files.

## Root cause --- loading UX

Explain where the current loading state lived and how the delayed
progress transition works.

## Root cause --- backend startup

Explain what was replaced and how the Tetris loader integrates with the
existing startup state.

## Root cause --- Scatter

Explicitly answer:

``` text
Was the Scatter problem caused by:
A. Metrivia data preparation
B. Metrivia chart configuration
C. Bklit implementation
D. SVG/clipPath
E. scale/domain calculation
F. CSS/overflow
G. animation/measurement
H. combination
```

Do not simply say "fixed".

Explain the evidence.

## Bklit verification

State which installed Bklit source/API was inspected and whether the
behavior is consistent with the official Bklit implementation.

## Tests

Report exact results.

## Manual verification

Clearly distinguish:

-   actually tested
-   not tested

Do not claim browser verification if it was not performed.

## Performance

Report whether the implementation added any meaningful bundle/runtime
overhead.

## Regressions

Confirm whether Bar, Line, Area, Pie, workspace behavior, themes, and
haptics remained intact.

------------------------------------------------------------------------

# 16. Hard constraints

-   Do not replace Bklit.
-   Do not rewrite the Scatter chart from scratch.
-   Do not hide Scatter overflow as the first or only fix.
-   Do not delete valid data points.
-   Do not aggregate away the 1,200 scatter observations merely to make
    the chart look cleaner.
-   Do not introduce SSE/WebSockets/polling for progress.
-   Do not regress the production CSV processing implementation.
-   Do not remove existing accessibility behavior.
-   Do not add unnecessary animation.
-   Respect reduced motion.
-   Do not modify unrelated charts.
-   Keep the implementation production-ready.
-   Prefer the smallest correct fix over a broad refactor.

Start by inspecting the actual repository and installed Bklit source,
then implement the smallest correct solution.
