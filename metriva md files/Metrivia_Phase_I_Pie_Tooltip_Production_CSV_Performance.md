# Metrivia Phase I --- Dynamic Pie Tooltip and Production CSV Performance Fix

## Objective

Fix two real production issues from Phase H:

1.  The pie-chart tooltip remains in a fixed position instead of
    appearing near the slice being hovered.
2.  The real \~11.5 MiB Spotify CSV (50,000 rows, 33 columns) still
    takes about 10 minutes to process on production Render.

Also preserve the Amber default theme and all Phase G/H improvements.

Do not perform a broad redesign.

## 1. Pie tooltip: inspect the actual implementation

Inspect the real `PieChartView.jsx`, underlying `PieChart`, `PieSlice`,
tooltip, chart wrapper, and current active-slice handlers.

Do not assume the library is Recharts and do not replace the chart
library.

The current slice and legend highlighting works correctly. Keep it.

### Required behavior

When hovering any slice, the tooltip must dynamically move near that
actual slice.

Test left, right, top, and bottom slices. The tooltip must not stay in
one fixed location.

Prefer, in order:

1.  chart-library tooltip/mouse coordinates if available;
2.  actual sector geometry (`cx`, `cy`, angles, radius) if exposed;
3.  pointer coordinates relative to the chart container.

Adapt angle/coordinate conventions to the actual library.

Do not blindly paste a polar-coordinate formula without verifying the
library's coordinate system.

### Bounds

Clamp the tooltip so it stays inside the chart/card and does not create
page overflow.

Account for desktop and mobile widths.

### Content

Keep:

-   category/dimension name
-   formatted value
-   percentage/share when reliable

Use existing formatting utilities.

Keep permanent slice labels disabled.

### Interaction

Keep `pointer-events: none` unless there is a concrete reason otherwise.

The tooltip should update immediately with the active slice and
disappear when inactive.

Keep active-slice state local to `PieChartView`; do not put hover state
in workspace/global state.

### Accessibility

Keep the legend as the accessible interaction surface.

Keyboard focus on a legend item should emphasize the corresponding slice
and update tooltip behavior where practical.

Do not make hover the only way to understand the chart.

### Motion

Use only a subtle opacity/transform transition if useful. No large
spring, blur, filter, layout animation, or continuous motion. Respect
the existing:

``` jsx
<MotionConfig reducedMotion="user">
```

Do not stack a second animation system over the chart library's own
animation.

## 2. Critical production CSV investigation

The real Spotify dataset is approximately:

-   11.5 MiB
-   50,000 rows
-   33 columns

It still takes about 10 minutes in production.

Phase H measured locally:

-   `pd.read_csv` \~0.97s
-   classification \~3.14s
-   `df.to_dict()` \~3.76s
-   per-cell serialization \~6.39s
-   `json.dumps` \~1.4s

Phase H optimized the Python path to about 2.4--5.8s locally.

Therefore, do not assume Pandas is still the bottleneck.

### Measure these stages separately

Instrument the production path using the existing metadata-only logging:

-   Render wake
-   upload transfer
-   `pd.read_csv`
-   analysis
-   serialization
-   response size
-   response transfer
-   browser JSON parsing
-   dashboard initialization
-   total

Do not log CSV contents or user data.

The final report must identify the actual dominant stage.

## 3. Investigate the \~38 MiB JSON response

Phase H established that an \~11.5 MiB CSV can become \~38.4 MiB JSON.

If server processing is now only seconds but the user still waits
minutes, investigate:

``` text
38+ MiB response
→ network transfer
→ browser buffering
→ JSON.parse
→ large JS object graph
→ dashboard initialization
```

Measure rather than guess.

## 4. If transfer/parsing is the bottleneck

First evaluate response compression.

Compare uncompressed JSON with gzip/brotli where compatible with the
existing Flask/Render setup.

Consider:

-   Render Free CPU cost
-   bandwidth reduction
-   browser automatic decompression
-   implementation complexity

If compression is not sufficient, then consider a stateless chunked
dataset architecture for the virtualized table.

Possible direction:

``` text
POST /api/upload
→ metadata + analysis

GET/POST dataset rows chunk
→ only rows needed by the virtualized table
```

Before implementing chunking, inspect which parts of the frontend
genuinely require the complete dataset for:

-   filters
-   charts
-   summaries
-   table

Do not introduce Redis, a database, persistent storage, Redux,
authentication, or a new backend architecture.

Do not revert to a 100-row preview.

## 5. If Render CPU is the bottleneck

Identify the exact stage and optimize that operation.

Do not merely say "Render Free is slow."

Keep the 20 MiB hard upload limit.

Keep the existing cold-start UX.

## 6. Production benchmark

Test:

-   \~5 MiB
-   \~10 MiB
-   \~11.5 MiB Spotify dataset
-   \~15 MiB
-   \~20 MiB

Record:

  ---------------------------------------------------------------------------------------------------------------
  Size     Rows   Columns   Wake   Upload   Parse   Analysis   Serialize   Transfer   Browser   Dashboard   Total
                                                                                        parse       ready 
  ------ ------ --------- ------ -------- ------- ---------- ----------- ---------- --------- ----------- -------

  ---------------------------------------------------------------------------------------------------------------

Do not fabricate production measurements.

If production testing cannot be performed from OpenCode's environment,
expose the logging needed for manual testing and clearly mark those
results as pending.

## 7. Required before/after answer

The final report must explicitly state:

``` text
Original production time: ~10 minutes
Current production time: ______
Dominant stage: ______
Measured duration: ______
Root cause: ______
Fix: ______
```

If the issue cannot be reproduced, say so.

## 8. Preserve existing systems

Do not regress:

-   Amber default
-   synchronous theme bootstrap
-   Graphite/Mocha/other theme availability
-   20 MiB upload limit
-   413 handling
-   workspace isolation
-   virtualized DataTable
-   lazy Dashboard/Settings chunks
-   Phase G chart optimization
-   Phase H serialization optimization
-   Render cold-start UX
-   haptic architecture

## 9. Tests

Run:

``` bash
npm run lint
npm run build
npm run themes:test
npm run ui:audit
npm run haptics:audit
npm run workspaces:test
```

Run the existing backend tests.

Add focused tests for:

-   dynamic tooltip positions
-   tooltip bounds
-   slice/legend identity
-   tooltip content
-   no dashboard-wide rerender from hover
-   production timing instrumentation
-   response byte measurement
-   duplicate full-data serialization avoidance

Do not report tests that were not actually executed.

## 10. Manual pie test

At desktop and mobile widths:

1.  hover left slice → tooltip near left
2.  hover right slice → tooltip near right
3.  hover top slice → tooltip near top
4.  hover bottom slice → tooltip near bottom
5.  hover legend item → corresponding slice highlights
6.  keyboard-focus legend item
7.  test tooltip content
8.  test Amber and other theme modes

The tooltip must not remain at a fixed location.

## 11. Final report

Report:

1.  Files changed/added/removed.
2.  Tooltip positioning method.
3.  Bounds/clamping method.
4.  Accessibility behavior.
5.  Exact CSV stage timings.
6.  Production response size.
7.  Root cause of the 10-minute delay.
8.  Exact optimization.
9.  Before/after measurements.
10. Whether compression or chunking was necessary.
11. Test results.
12. Remaining P0/P1/P2/P3 issues.
13. Recommended next steps.

End with:

### Next

One highest-priority task.

### Then

Second priority.

### Later

Non-blocking work.

Do not invent feature work merely to continue development.

## Success criteria

-   Tooltip dynamically follows the actual hovered slice.
-   Left/right/top/bottom slices all position correctly.
-   Tooltip stays inside chart bounds.
-   Legend highlighting remains intact.
-   Pie hover does not rerender the whole dashboard.
-   The \~11.5 MiB Spotify production delay is measured by stage.
-   The actual dominant bottleneck is identified.
-   The code-controlled bottleneck is fixed where possible.
-   Production processing becomes materially faster if the application
    is responsible.
-   20 MiB remains the hard limit.
-   Phase G/H performance improvements remain intact.
-   Amber remains the first-painted default.
-   All existing functionality and tests remain intact.
