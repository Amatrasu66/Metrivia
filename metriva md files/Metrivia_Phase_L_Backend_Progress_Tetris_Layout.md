# Metrivia --- Phase L

## Backend-accurate CSV progress + redesigned backend wake-up layout

Phase K is complete and has been manually browser-tested. The user
approved the current visual direction:

-   Backend startup: **large Tetris loader on the left, startup
    text/timer/status on the right**.
-   CSV analysis: **keep the existing Metrivia horizontal progress-bar
    UI** from Phase K. Do NOT replace it with the generated reference's
    stage-marker/timeline design.
-   Main change: make CSV progress reflect actual backend processing
    instead of the current front-loaded estimated/eased animation.

## 1. Objective A --- Backend startup layout

Current Phase K backend wake-up is too congested: the Tetris loader is
tiny and stacked with the text/timer.

Change the card to a responsive two-column layout:

``` text
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   [ LARGE TETRIS GRID ]     │  Starting Metrivia's backend  │
│   [ LARGE TETRIS GRID ]     │  Server is waking up...      │
│                             │                              │
│                             │       17 seconds              │
│                             │  Usually takes under a minute │
│                             │                              │
│                             │ Connecting Starting Ready     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Desktop/tablet: - Tetris occupies the left portion. - Text, timer,
elapsed description, and `WAKE_STAGES` occupy the right. - Use a divider
or clear spacing. - Make the Tetris substantially larger than the
current Phase K presentation. - Do not squash it. - Preserve the
existing timer, messages, Connecting → Starting → Ready state,
retry/error behavior, and reduced-motion support.

Suggested starting dimensions, to be tuned to the actual card: -
desktop: 18--20 columns, 8--10 rows, 10--14px cells, 2--4px gap -
tablet: 14--16 columns, 8--10 rows, 8--11px cells - mobile: 10--12
columns, 7--9 rows, 7--9px cells

At narrow widths, collapse to a vertical layout rather than causing
overflow.

Inspect the real `BackendWakeState.jsx` and current `TetrisLoader`
before editing. Change placement/sizing/layout only; do not redesign the
Tetris algorithm.

## 2. Objective B --- truthful backend-aware CSV progress

Current Phase K behavior: - spinner for first \~800ms - then
`AnalysisProgressState` - `useDelayedProgress.js` estimates/eases
progress and caps at 95% - final API response completes it

The user specifically dislikes the current motion: - progress shoots
forward quickly at the beginning - then slows excessively near the end -
sometimes appears to stall while backend work continues

The desired behavior is:

``` text
backend actually processing
0% → 10% → 20% → 30% → ... → 90% → 100%
```

If processing takes 60 seconds, the bar should broadly track those 60
seconds rather than reaching 70% in the first few seconds and crawling
afterward.

### Critical rule

Do NOT fake exact backend progress.

The current single-request API cannot know true intermediate backend
completion unless the server communicates progress while processing.

Distinguish:

1.  browser upload progress --- not backend analysis
2.  backend processing progress --- what the user wants
3.  network response download progress --- not backend analysis

## 3. Inspect the actual current implementation first

Locate and inspect the real files rather than assuming names:

Frontend: - `CsvUploadZone.jsx` - `AnalysisProgressState.jsx` -
`useDelayedProgress.js` - upload/API helper - workspace upload
state/reducer

Backend: - Flask app - upload route - CSV parser - classification -
statistics - serialization - gzip response - Phase H/I performance
logging/instrumentation

Reuse existing Phase H/I measurements where useful.

Do not regress the optimized Pandas/serialization/gzip path.

## 4. Choose the smallest reliable backend-progress mechanism

Preferred:

### Option A --- stream progress from the same upload request

If practical with the current Flask/Render stack:

``` text
POST /api/upload

receive file
  ↓ progress event
read CSV
  ↓ progress event
classify columns
  ↓ progress event
calculate statistics
  ↓ progress event
serialize
  ↓ progress event
prepare response
  ↓ progress event
completed result
```

Use the simplest reliable streaming protocol compatible with the
existing architecture (SSE-style events, NDJSON, or another appropriate
stream).

If the final dataset response cannot coexist cleanly with the progress
stream, use a clearly documented two-channel approach only if necessary.

### Option B --- job + status endpoint

Only if streaming is not reliable/compatible:

``` text
POST /api/upload → job_id
GET /api/upload/<job_id>/progress
GET /api/upload/<job_id>/result
```

This introduces lifecycle/concurrency/cleanup complexity, so do not
choose it automatically.

Do NOT add Redis, Celery, a database, WebSockets, or a cloud queue
unless technically unavoidable.

Before implementing either option, inspect the existing deployment/API
constraints and choose the smallest production-safe solution.

## 5. Backend stage mapping

Progress should originate from actual backend milestones.

Possible stages:

``` text
file accepted
CSV parsed
columns classified
statistics calculated
records converted/serialized
response prepared
complete
```

Do NOT blindly assign arbitrary percentages.

Use Phase H/I measured timings to determine sensible weights where
possible. If a stage is known to dominate runtime, it should receive
more progress range.

A reasonable model might look like:

``` text
0–10    file accepted / setup
10–25   CSV parsing
25–40   column classification
40–60   statistics
60–90   record conversion/serialization
90–100  response preparation/completion
```

These percentages are examples only. Inspect actual timings and adjust.

If a stage has no internal progress signal, it may interpolate
**linearly** within that stage's known range, but must never pass the
next real backend milestone.

## 6. Progress motion

Remove the current front-loaded easing.

Do not use: - ease-out - exponential acceleration/deceleration - fake
0→95% timer - a timer that reaches 95% long before the server is done

If smoothing is needed:

``` text
backend reports 20%
frontend smoothly moves 15 → 20

backend reports 40%
frontend smoothly moves 20 → 40

backend reports 60%
frontend smoothly moves 40 → 60
```

Use linear interpolation between actual milestones, with no overshoot.

The bar must never decrease.

The bar must never reach 100 until the actual result is usable.

Do not permanently stall at 95%.

## 7. Keep the current CSV UI

The user explicitly approved the existing Phase K progress-bar visual.

Keep: - current card - current horizontal bar - current typography -
current styling - existing spinner → progress behavior - current staged
labels where useful

Only change the progress source from estimated/eased frontend timing to
backend-aware progress.

Do NOT add the generated reference image's timeline/stage-marker UI.

## 8. Preserve the 800ms behavior

Keep:

``` text
<800ms:
  existing spinner

>=800ms:
  existing progress bar
```

If backend events arrive before 800ms, retain spinner visibility until
the threshold.

When the bar appears, initialize it from the latest known backend
progress and never jump backward.

If the request completes before 800ms, no progress bar should flash.

## 9. ETA

An ETA is optional.

If added, derive it from real observations such as: - elapsed processing
time - current backend stage - file size - row/column count - historical
timing

Do not show a hardcoded "1 minute remaining."

A simple stage message is preferable to a misleading ETA.

## 10. Completion/errors/cancellation

On actual success: - reach exactly 100% - transition cleanly to the
dashboard

On error: - stop progress - preserve existing error UI

Handle: - network failure - backend failure - cancellation - workspace
close - workspace switch - component unmount - retry

Clean up: - timers - streams - listeners - AbortControllers - progress
state

Preserve the existing workspace-ID-safe async behavior.

## 11. Backend progress transport must preserve response correctness

The existing CSV response must remain byte/data equivalent from the
client's perspective.

Preserve: - gzip behavior - CSV limits - existing JSON shape - existing
chart/table/filter data - Phase H/I optimizations

Do not move CSV parsing into the browser.

## 12. Tests

Run:

``` bash
npm run lint
npm run build
npm run themes:test
npm run ui:audit
npm run haptics:audit
npm run workspaces:test
npm run pie:test
npm run bar:test
npm run scatter:test
npm run loading:test
```

Add focused tests for the progress protocol.

Verify: - progress events are ordered - progress never decreases -
progress stays within 0--100 - completion reaches exactly 100 - backend
errors terminate correctly - cancellation cleans up - final
dataset/result remains correct - small CSV still completes normally -
gzip still works - spinner remains for \<800ms - backend progress
initializes correctly when bar appears - no front-loaded easing - no
permanent 95% stall - workspace switching remains safe

For the backend layout: - desktop two-column structure - large Tetris -
right-side timer/text/status - responsive collapse - no horizontal
overflow - reduced-motion behavior

## 13. Manual verification

Use the production/local browser.

### Backend startup

Trigger a cold backend and verify: - Tetris is clearly on the left -
Tetris is substantially larger - startup text is on the right - timer is
on the right - status steps are on the right - no overlap/congestion -
card height remains reasonable - mobile remains usable

### CSV

Small CSV:

``` text
spinner → dashboard
```

No progress-bar flash.

Large CSV:

``` text
spinner → existing progress bar → backend milestones → 100% → dashboard
```

Use the supplied 1,200-row dataset and a larger file if available.

Watch for: - no early jump to a large percentage - consistent movement -
no long stall at 95% - 100% coinciding with actual completion - correct
result after completion

## 14. Final report

Provide: - exact files changed - exact files added - chosen backend
progress architecture and why - exact backend stages driving progress -
how progress smoothing works - why 100% is truthful - backend startup
layout changes - performance impact - all test results - manual browser
verification results - API compatibility/regressions

Clearly distinguish browser-tested behavior from automated-only
verification.

## 15. Hard constraints

-   Keep the existing CSV progress-bar visual.
-   Do not use the generated reference's stage-marker/timeline UI.
-   Do not fake actual backend progress.
-   Do not treat browser upload progress as analysis progress.
-   Do not use a front-loaded easing curve.
-   Do not permanently stop at 95%.
-   Do not show 100% before actual completion.
-   Keep the Tetris loader and its animation.
-   Do not redesign the Tetris algorithm.
-   Preserve Phase H/I performance and gzip.
-   Preserve workspace-safe async behavior.
-   Preserve error/retry behavior.
-   Preserve reduced motion.
-   Do not modify Bar, Pie, Line, or Area charts.
-   Prefer the smallest production-safe architecture.
-   Start by inspecting the actual Phase K code and current Flask API
    before deciding whether streaming or a job/status mechanism is
    required.
