# Metrivia Phase H --- Amber Default, Interactive Pie Legend, and Large-CSV Processing Investigation

## Objective

Phase G is complete. Do not start another broad redesign.

This phase focuses on three concrete issues discovered during real
usage:

1.  An approximately 11.5 MiB Spotify CSV (50,000 rows, 33 columns)
    reportedly took 30--40 minutes to process.
2.  Pie charts are difficult to interpret because slices have no direct
    labels and the legend does not clearly identify the hovered slice.
3.  The default theme should change from Graphite to Amber.

Do not undo successful Phase C--G work.

------------------------------------------------------------------------

## Part 1 --- Investigate the 11.5 MiB / 30--40 minute processing delay

This is the highest-priority issue.

Do not assume the delay is simply Render cold-start or Pandas.

Inspect the complete path:

``` text
HTTP request
→ multipart upload
→ CSV read
→ Pandas dataframe
→ analysis/statistics
→ chart metadata/transforms
→ response preparation
→ JSON encoding
→ response transfer
→ frontend parsing
```

Add lightweight timing instrumentation, using the existing logging style
where possible.

Measure at minimum:

-   request start
-   file receipt
-   `pd.read_csv`
-   analysis
-   serialization
-   response completion
-   total time

Log only safe metadata such as file size, row count, column count, and
stage durations. Do not log CSV contents.

### Search for expensive operations

Inspect for:

-   `to_dict`
-   `to_json`
-   `json.dumps`
-   `iterencode`
-   dataframe copies
-   repeated dtype inference
-   repeated `nunique`
-   repeated `value_counts`
-   repeated `describe`
-   per-row Python loops
-   nested loops
-   unnecessary sorting
-   repeated datetime parsing
-   high-cardinality unique-value calculations
-   chart data generated for charts the user never selected
-   duplicate full-data representations in memory

Identify the actual dominant stage.

The final report must not merely say "Render Free is slow."

If the delay cannot be reproduced, say so.

------------------------------------------------------------------------

## Part 2 --- Keep upload processing practical

Keep the hard upload limit at:

**20 MiB**

Do not raise it.

Render Free has limited CPU/RAM, so optimize the current supported range
rather than chasing larger uploads.

Do not introduce:

-   Redis
-   a database
-   persistent file storage
-   authentication
-   Redux
-   a new backend architecture

unless a concrete issue makes one genuinely necessary. This phase is not
a platform rewrite.

------------------------------------------------------------------------

## Part 3 --- Avoid unnecessary full-dataset work

Inspect whether the upload endpoint is calculating every possible chart
transformation during upload.

Upload should primarily establish:

-   row count
-   columns
-   dtypes
-   missing counts
-   useful summary statistics
-   metadata required by the dashboard

Chart-specific transformations should happen when the user actually
configures that chart, where practical.

Do not break existing chart behavior.

------------------------------------------------------------------------

## Part 4 --- Investigate full response serialization

Inspect whether the backend simultaneously holds:

``` text
DataFrame
+ Python representation of all rows
+ JSON string/buffer
+ HTTP response buffer
```

Avoid unnecessary copies.

If serialization is the bottleneck, optimize it.

If returning the complete dataset is itself the bottleneck, consider a
stateless chunked data endpoint for the virtualized table:

``` text
POST /api/upload
→ metadata/analysis

GET/POST dataset chunk
→ only rows needed by the virtualized table
```

However, do not implement this architecture unless measurements show
that the current response/serialization design is the bottleneck.

Preserve the user's ability to inspect the complete dataset.

------------------------------------------------------------------------

## Part 5 --- Separate Render cold-start from actual processing

The UI should distinguish:

``` text
Waking backend…
Uploading…
Analyzing CSV…
Preparing dashboard…
```

if these states already exist or can be improved safely.

Do not create fake progress percentages.

Measure:

-   Render wake time
-   actual upload time
-   actual processing time
-   response/download time

Keep the existing cold-start UX and retry behavior.

------------------------------------------------------------------------

# Part 6 --- Pie chart redesign

## Current problem

The pie chart currently has:

-   unlabeled slices
-   a legend below
-   repeated/limited colors
-   many categories
-   no clear slice → legend relationship

Keep the slices **unlabeled**. Do not place permanent names on the
slices.

Instead implement interactive linking.

### Required behavior

When the user hovers a pie slice:

``` text
slice hovered
→ matching legend item below becomes clearly highlighted
→ other legend items become visually quieter
→ matching slice remains emphasized
```

The relationship must also work in reverse:

``` text
legend item hovered/focused
→ matching pie slice becomes emphasized
```

------------------------------------------------------------------------

## Part 7 --- Stable slice/legend identity

Each slice must have a stable identity shared by:

-   slice
-   legend item
-   tooltip

Do not rely only on array indexes if sorting/reordering can change.

Inspect the existing chart-data model and use the project's actual
identifiers.

Hover state must remain local to the pie chart.

Do not put `activeSlice` into workspace/global state.

The desired architecture is conceptually:

``` text
Dashboard
 ├── KPIs
 ├── Filters
 ├── ChartBuilder
 │    └── PieChart
 │         ├── local active slice
 │         └── local legend interaction
 └── DataTable
```

------------------------------------------------------------------------

## Part 8 --- Legend highlighting

The active legend entry should be unmistakable without relying on color
alone.

Use a combination such as:

-   stronger text weight
-   visible background/outline
-   active indicator
-   controlled opacity of inactive entries

Do not use excessive animation.

Preserve the existing legend below the chart unless its layout needs a
small adjustment.

If the legend becomes too tall, use a bounded scrollable area rather
than removing useful information.

------------------------------------------------------------------------

## Part 9 --- Tooltip

Do not put permanent labels on pie slices.

Add or improve a tooltip if the existing chart library supports it
cleanly.

It should provide:

-   dimension/category name
-   formatted value
-   percentage where reliably calculable

Use actual chart data.

Do not hard-code example values.

The tooltip must not interfere with legend interaction.

------------------------------------------------------------------------

## Part 10 --- Repeated colors

The existing theme chart tokens should remain the source of the palette.

Inspect whether repeated adjacent colors make the chart ambiguous.

If necessary:

-   derive a larger deterministic categorical palette from existing
    theme tokens
-   avoid identical adjacent colors where possible
-   preserve theme compatibility

Do not replace the entire theme system.

Do not hard-code one palette that ignores the selected theme.

------------------------------------------------------------------------

## Part 11 --- Pie chart accessibility

Where supported:

-   slice hover and focus should behave consistently
-   legend items must be keyboard focusable
-   legend items need accessible names
-   active state must not depend on color alone

If the chart library does not provide usable keyboard focus for SVG
slices, make the legend the accessible interaction surface.

Do not make hover the only way to understand the chart.

------------------------------------------------------------------------

## Part 12 --- Pie chart performance

Do not cause the entire dashboard to rerender on every hover.

Keep active slice/legend state local to the chart.

Do not animate:

-   every legend item continuously
-   every chart data update
-   large layout regions
-   table rows

Respect the existing:

``` jsx
<MotionConfig reducedMotion="user">
```

If the chart library already animates slices, do not stack another
expensive animation system on top.

------------------------------------------------------------------------

# Part 13 --- Amber theme

Change the default theme from:

``` text
graphite
```

to:

``` text
amber
```

The supplied Amber screenshot is the visual reference.

Use the existing Amber theme tokens already present in the registry. Do
not recreate the palette from the screenshot.

Amber should become:

-   fresh-install default
-   invalid-theme fallback
-   first-paint fallback

Keep:

-   Graphite selectable
-   Monochrome selectable
-   Mocha selectable
-   all other existing themes
-   Light/Dark/System
-   saved valid theme persistence

------------------------------------------------------------------------

# Part 14 --- Amber first-paint bootstrap

The Phase F flash fix must remain intact.

Update all appropriate defaults/fallbacks:

-   `index.html`
-   synchronous bootstrap
-   theme resolver
-   registry
-   catalog
-   React initial state
-   CSS root fallback
-   theme cache
-   tests

Fresh install:

``` text
Amber
```

Invalid saved theme:

``` text
Amber
```

Valid saved theme:

``` text
preserve it
```

There must be no Amber → another theme or old Graphite/Mocha flash.

Do not solve this merely by disabling transitions. The correct theme
must be applied before first meaningful paint.

------------------------------------------------------------------------

# Part 15 --- Preserve Phase G performance work

Do not regress:

-   lazy DashboardLayout
-   lazy SettingsPage
-   virtualized DataTable
-   memoized components
-   scatter timestamp optimization
-   stable chart options
-   reduced dashboard rerenders
-   Motion reduced-motion configuration
-   workspace isolation

After changes, rerun the existing performance/build checks.

------------------------------------------------------------------------

# Part 16 --- Full audit during implementation

Continue checking for concrete issues in:

-   upload flow
-   CSV processing
-   charts
-   theme bootstrap
-   workspace switching
-   responsive layout
-   accessibility
-   performance
-   backend errors

If a new P0/P1 issue is found, fix it and report it.

If an unrelated P2/P3 issue is found, report it rather than
automatically expanding scope.

------------------------------------------------------------------------

# Part 17 --- Tests

Update/add tests for:

### Amber

-   default = Amber
-   invalid theme = Amber
-   saved valid theme preserved
-   Graphite remains selectable
-   Mocha remains selectable
-   bootstrap references Amber

### Pie chart

-   stable slice identity
-   slice hover highlights matching legend
-   legend hover/focus highlights matching slice
-   clearing active state works
-   tooltip uses correct category/value
-   repeated colors do not break identity

### Upload

-   20 MiB accepted

-   20 MiB rejected

-   413 retained

-   workspace ownership preserved

-   cold-start/retry flow preserved

### Performance

Add a targeted benchmark/test for the actual bottleneck discovered.

Do not add meaningless benchmarks.

------------------------------------------------------------------------

# Part 18 --- Required commands

Run:

``` bash
npm run lint
npm run build
npm run themes:test
npm run ui:audit
npm run haptics:audit
npm run workspaces:test
```

Run the existing backend test suite.

Run additional tests if the repository contains them.

Do not report unexecuted tests as passing.

------------------------------------------------------------------------

# Part 19 --- Manual production testing

## CSV timing

Test:

-   5 MiB

-   10 MiB

-   the 11.5 MiB Spotify dataset

-   15 MiB

-   20 MiB

-   20 MiB

Record:

  ----------------------------------------------------------------------------------------
  Size       Rows   Columns   Upload    Parse   Analysis   Serialization    Total Result
  ------ -------- --------- -------- -------- ---------- --------------- -------- --------

  ----------------------------------------------------------------------------------------

If Render testing cannot be performed from the implementation
environment, explicitly mark these as manual production tests still
required.

## Pie chart

Use a dataset with many categories.

Test:

1.  hover slice
2.  matching legend highlights
3.  hover another slice
4.  legend changes correctly
5.  hover/focus legend item
6.  matching slice highlights
7.  inspect tooltip
8.  test keyboard interaction
9.  test light/dark appearance
10. test responsive layout

## Theme

Fresh browser/session:

1.  open production URL
2.  confirm Amber is first visible theme
3.  confirm no flash
4.  select Graphite and reload
5.  select Mocha and reload
6.  select System and reload

------------------------------------------------------------------------

# Part 20 --- Required explanation of the 30--40 minute delay

The final report must explicitly fill:

``` text
Dominant delay:
____________________

Measured duration:
____________________

Root cause:
____________________

Fix:
____________________

Before:
____________________

After:
____________________
```

If the delay was mostly:

-   Render cold start --- quantify it
-   upload/network --- quantify it
-   Pandas parsing --- identify it
-   analysis --- identify the operation
-   JSON serialization --- quantify it
-   frontend response parsing --- quantify it

Do not provide a generic explanation.

------------------------------------------------------------------------

# Part 21 --- Final report

Provide:

1.  Files changed.
2.  Files added.
3.  Files removed.
4.  Exact CSV timing measurements.
5.  Root cause of the Spotify dataset delay.
6.  Exact optimization performed.
7.  Before/after processing results.
8.  Pie chart interaction design.
9.  Stable slice/legend mapping.
10. Tooltip behavior.
11. Repeated-color handling.
12. Accessibility changes.
13. Amber default implementation.
14. First-paint behavior.
15. Performance impact.
16. Exact test results.
17. Remaining P0/P1/P2/P3 issues.
18. Recommended next steps.

End with:

### Next

One highest-priority task.

### Then

Second priority.

### Later

Non-blocking work.

Do not invent feature work merely to continue development.

------------------------------------------------------------------------

# Success criteria

Phase H succeeds if:

-   the 11.5 MiB Spotify dataset bottleneck is measured and identified
-   the dominant code-controlled bottleneck is fixed or narrowed down
    with evidence
-   processing is materially faster if the bottleneck is
    application-controlled
-   20 MiB remains the hard upload limit
-   pie slices remain unlabeled
-   hovering a slice clearly highlights its matching legend entry
-   hovering/focusing a legend entry clearly highlights its matching
    slice
-   tooltip provides useful category/value information
-   pie hover does not rerender the entire dashboard
-   Amber is the default
-   Amber is first-painted
-   no old theme flash occurs
-   saved themes remain intact
-   Phase G performance improvements remain intact
-   all existing tests pass
-   manual production limitations are clearly reported
