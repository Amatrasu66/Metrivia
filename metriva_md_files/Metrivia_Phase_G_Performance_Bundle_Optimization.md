# Metrivia Phase G --- Performance Optimization and Bundle Splitting

## Objective

Phase F found the application healthy with no P0 issues and all required
P1 items fixed.

Do NOT redesign the UI or add new product features in this phase.

The only goal is to address the remaining documented performance risks:

1.  the approximately 941 kB largest frontend bundle/chunk
2.  large chart re-transforms/re-renders when filters change
3.  any additional concrete performance bottlenecks discovered during
    implementation

Preserve the current UX exactly unless a performance optimization
requires a small behavioral adjustment.

------------------------------------------------------------------------

# Part 1 --- Inspect before changing

Inspect the actual production build and source tree.

Run:

``` bash
npm run build
```

Record the current chunk sizes.

Identify which dependencies/components contribute most to the largest
chunk.

In particular inspect:

-   chart libraries
-   dashboard components
-   Bklit chart components
-   Motion
-   shadcn/Base UI
-   Lucide
-   TanStack React Virtual
-   theme system
-   workspace system

Do not remove dependencies simply because they appear in the bundle.

------------------------------------------------------------------------

# Part 2 --- Bundle splitting

Implement code splitting where it provides a measurable benefit.

The dashboard/chart area is the primary candidate.

Prefer dynamic imports for heavy chart/dashboard modules that are not
required to render:

-   initial landing/upload page
-   settings
-   basic shell/header

For example, use React lazy loading or the existing Vite-compatible
approach.

Requirements:

-   initial upload page should not eagerly load every chart
    implementation
-   charts should load when the dashboard actually needs them
-   loading state should be visually stable
-   avoid layout shift
-   preserve error handling
-   preserve workspace state
-   preserve chart configuration
-   preserve theme tokens
-   preserve reduced-motion behavior

Do not introduce a routing library just to obtain code splitting.

------------------------------------------------------------------------

# Part 3 --- Chart performance

Phase F identified:

> large-chart re-transform on filter change

Inspect the actual cause.

Determine:

-   whether chart data is recomputed unnecessarily
-   whether unchanged chart configuration causes recalculation
-   whether filters recreate large arrays
-   whether chart components receive unstable props
-   whether chart transforms happen even when the selected chart is not
    visible
-   whether all charts update when only one chart changes

Use:

-   `useMemo`
-   stable callbacks
-   memoized components
-   derived-data caching

only where they materially reduce work.

Do not add memoization everywhere.

------------------------------------------------------------------------

# Part 4 --- Avoid premature optimization

Do not optimize based only on code appearance.

Measure before/after where practical.

At minimum compare:

-   initial JS bundle size
-   largest chunk
-   dashboard chunk
-   time to initial usable upload UI
-   time to first dashboard render
-   chart update latency after a filter change
-   table scrolling performance

Do not claim a performance improvement unless the build/profiling
evidence supports it.

------------------------------------------------------------------------

# Part 5 --- Preserve the virtualized CSV table

Do not remove or weaken the Phase E/F table virtualization.

The table must remain:

-   virtualized
-   sticky-header compatible
-   horizontally scrollable
-   keyboard accessible
-   theme-aware

Do not animate table rows.

Do not eagerly render the full dataset.

Do not replace virtualization with pagination unless there is a concrete
reason.

------------------------------------------------------------------------

# Part 6 --- Motion

Keep the current Motion architecture.

Do not add another animation library.

Do not add:

-   Framer Motion alongside Motion
-   animation wrappers around the dashboard
-   table animations
-   chart animations on every data update
-   scroll animations
-   parallax

Preserve:

``` jsx
<MotionConfig reducedMotion="user">
```

and the existing narrow navigation/menu animations.

If code splitting causes a component to mount later, use only a subtle
opacity transition if needed.

Do not make loading feel slower.

------------------------------------------------------------------------

# Part 7 --- Theme performance

The Phase F theme bootstrap fix must remain intact.

Do not regress:

-   synchronous theme bootstrap
-   `metrivia.theme-vars`
-   Graphite default
-   Light/Dark/System
-   saved theme persistence
-   invalid-theme fallback

After code splitting, verify that dynamically loaded dashboard/chart
components immediately use the correct theme tokens without a visual
flash.

------------------------------------------------------------------------

# Part 8 --- Workspace performance

The existing workspace architecture must remain unchanged conceptually.

Switching workspace must still preserve:

-   dataset
-   filters
-   chart configuration
-   upload state
-   errors/retry state

Avoid causing unrelated workspaces/components to re-render.

Do not replace the existing workspace reducer/context with Redux or
another state library.

------------------------------------------------------------------------

# Part 9 --- React render audit

Use React profiling or source inspection to identify:

-   dashboard-wide renders from local UI state
-   chart renders from navigation/menu state
-   table renders from chart changes
-   chart renders from table scroll
-   workspace selector causing dashboard work
-   theme selector causing unnecessary data processing

Fix only concrete issues.

Prefer narrower context subscriptions/component boundaries if required.

------------------------------------------------------------------------

# Part 10 --- Backend performance

Do not redesign the Flask/Pandas architecture in this phase unless
profiling reveals a direct performance regression.

Preserve:

-   20 MiB upload limit
-   backend authoritative validation
-   413 handling
-   Render cold-start UX
-   existing analysis results
-   existing CORS behavior
-   stateless architecture

If backend performance is clearly a bottleneck, document it rather than
silently introducing a database or persistent storage.

------------------------------------------------------------------------

# Part 11 --- Production build validation

Run:

``` bash
npm run lint
npm run build
```

Then run all existing project tests:

``` bash
npm run themes:test
npm run ui:audit
npm run haptics:audit
npm run workspaces:test
```

Run backend tests using the existing project command.

Do not report results that were not actually executed.

------------------------------------------------------------------------

# Part 12 --- Compare build output

Report before/after:

  Metric                 Before Phase G   After Phase G
  -------------------- ---------------- ---------------
  Largest JS chunk                      
  Total JS assets                       
  Initial page JS                       
  Dashboard/chart JS                    
  Build time                            

If code splitting does not materially improve the initial load, explain
why.

Do not artificially split tiny modules just to increase the number of
chunks.

------------------------------------------------------------------------

# Part 13 --- Manual performance verification

Test at:

### Desktop

-   1440px
-   1366px
-   1280px

### Mobile

-   430px
-   390px

### Dataset sizes

-   small CSV
-   medium CSV
-   large CSV near the 20 MiB limit

Check:

-   initial load
-   upload UI responsiveness
-   dashboard opening
-   chart creation
-   filter changes
-   workspace switching
-   table scrolling
-   theme switching
-   settings opening
-   mobile menu opening

The UI should feel immediate.

------------------------------------------------------------------------

# Part 14 --- Success criteria

Phase G succeeds if:

-   the initial application loads less unnecessary JavaScript
-   chart/dashboard code is loaded when needed
-   the largest chunk is materially reduced where technically practical
-   chart filtering does not perform unnecessary transformations
-   table virtualization remains intact
-   Motion remains lightweight
-   Graphite theme bootstrap remains flash-free
-   workspace state remains isolated
-   all existing tests pass
-   no P0/P1 regressions are introduced

------------------------------------------------------------------------

# Part 15 --- Final report

Report:

1.  Files changed.
2.  Files added.
3.  Files removed.
4.  Before/after bundle sizes.
5.  What was code-split.
6.  Why each split was chosen.
7.  What caused chart re-transform overhead.
8.  What was changed.
9.  React render improvements.
10. Manual performance results.
11. Test results.
12. Any remaining performance bottlenecks.
13. Whether another optimization phase is actually justified.

Do not recommend additional optimization work merely because it is
technically possible.

If the remaining performance is acceptable, explicitly say that further
optimization should stop and product work can resume.
