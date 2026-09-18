# Metrivia Phase F --- Final UX Audit, Theme Flash Fix, Mobile Header Redesign, Upload Limit 20 MiB, and Android Haptics Investigation

## Objective

Perform a comprehensive audit of the current Metrivia codebase and fix
the issues identified below.

This phase is intentionally different from a normal feature phase.

The goal is to:

1.  eliminate the initial theme/color flash
2.  make Graphite the only initial rendered theme
3.  improve desktop header alignment
4.  redesign the mobile header so it is not cramped/squashed
5.  move secondary mobile navigation/actions into the
    hamburger/three-dot menu
6.  reduce the CSV upload maximum to **20 MiB**
7.  investigate why Android haptics still do not physically vibrate
8.  audit the entire project for additional issues
9.  fix high-confidence, user-facing issues discovered by the audit
10. produce a prioritized roadmap for what should happen next

Do not perform a large architectural rewrite.

Preserve all successful Phase C, D, and E functionality unless the audit
demonstrates that a change is necessary.

------------------------------------------------------------------------

# Part 1 --- Current project context

Metrivia is:

### Frontend

-   React
-   Vite
-   JavaScript
-   Tailwind CSS v4
-   shadcn/ui / Base UI
-   Lucide
-   Motion
-   TanStack React Virtual

### Backend

-   Python
-   Flask
-   Pandas
-   Flask-CORS

### Hosting

-   Frontend: Vercel
-   Backend: Render Free

### Existing functionality

-   CSV upload
-   dashboard
-   charts
-   filters
-   complete CSV inspection
-   virtualized table
-   independent workspaces
-   workspace selector
-   themes
-   Light/Dark/System appearance
-   Graphite default
-   haptic feedback system
-   Android haptic diagnostics
-   Render cold-start handling
-   frontend/backend upload validation

Do not assume the file names in this prompt are unchanged. Inspect the
actual repository.

------------------------------------------------------------------------

# Part 2 --- Perform a full project audit FIRST

Before changing code, inspect the entire repository.

Do not limit the audit to the header.

Audit at least:

## Frontend architecture

-   App entry
-   routing/page-state architecture
-   providers
-   workspace context/reducer
-   state ownership
-   component boundaries
-   unnecessary renders
-   stale closures
-   unstable callbacks
-   duplicated state
-   error handling
-   loading states
-   empty states
-   upload flow
-   dashboard flow
-   settings
-   themes
-   haptics
-   responsive behavior

## UI/UX

-   desktop layout
-   tablet layout
-   mobile layout
-   typography
-   spacing
-   alignment
-   truncation
-   overflow
-   touch targets
-   keyboard navigation
-   focus states
-   ARIA labels
-   menu behavior
-   dialogs
-   dropdowns
-   tooltips
-   disabled states
-   loading states
-   error states
-   success states

## Performance

Inspect for: - unnecessary renders - broad context subscriptions -
expensive effects - unnecessary memoization - missing memoization where
useful - large object creation - expensive chart recalculation - table
rendering - unnecessary DOM - expensive CSS - `transition: all` - layout
animation - excessive box shadows - expensive filters - animation
loops - scroll listeners - resize listeners - unnecessary network
calls - duplicate API calls

## Backend

Inspect: - Flask configuration - upload handling - CSV parsing - Pandas
memory use - response serialization - error handling - CORS - security -
validation - timeouts - request handling - malformed CSV behavior -
empty CSV behavior - very wide CSV behavior - very tall CSV behavior -
encoding issues - delimiter assumptions - NaN/Infinity handling - JSON
serialization - large responses

## Deployment

Inspect: - Vercel configuration - Render configuration - environment
variables - production API URL handling - CORS configuration - build
configuration - Python version - Node version - package versions -
dependency duplication - unnecessary dependencies - production-only
failures

## Accessibility

Audit: - keyboard navigation - focus visibility - screen-reader labels -
buttons vs links - native controls - menus - dialogs - tables - form
inputs - upload zone - color contrast - reduced motion - touch targets

## Security

Audit: - API keys - environment variables - exposed secrets - unsafe
HTML - file handling - path handling - CORS - upload validation -
request size validation - malicious CSV concerns - formula-injection
concerns if files can ever be exported - dependency risks

Do not invent vulnerabilities.

Only report a security issue if there is a concrete code path or
configuration problem.

------------------------------------------------------------------------

# Part 3 --- Classify audit findings

Every finding must be classified:

### P0 --- Critical

Could break the application, expose secrets, corrupt data, or create a
serious security/reliability problem.

### P1 --- High

Major UX, performance, deployment, accessibility, or reliability
problem.

### P2 --- Medium

Meaningful quality issue but not blocking normal usage.

### P3 --- Low

Polish, maintainability, minor UX improvement.

Do not inflate severity.

At the end, produce a table:

  Priority   Issue   Evidence   Recommended action
  ---------- ------- ---------- --------------------

------------------------------------------------------------------------

# Part 4 --- Fix the initial theme flash

## Current problem

When opening:

`https://metrivia.vercel.app/`

the page initially renders the old **Mocha** appearance and then changes
to the current **Graphite** appearance.

This creates a visible flash/jump.

The goal is:

**Graphite should be the first theme painted.**

There should be no visible Mocha → Graphite transition on initial page
load.

## Diagnose first

Inspect:

-   `index.css`
-   theme initialization
-   `theme-registry.js`
-   theme provider
-   `main.jsx`
-   localStorage access
-   React effects
-   CSS defaults
-   SSR/pre-render behavior if relevant to Vercel static hosting

Identify exactly why the old theme is painted before the saved/current
theme is applied.

## Preferred fix

Apply the correct theme before the browser's first meaningful paint.

A robust approach may be a tiny synchronous initialization script in the
HTML document that:

1.  reads the saved theme preference
2.  resolves Light/Dark/System
3.  resolves the selected theme ID
4.  validates it against known theme IDs if practical
5.  defaults to Graphite
6.  writes the required theme attributes/CSS variables before React
    mounts

Then React should hydrate/use the same value rather than applying a
second conflicting theme.

Do not simply add:

``` css
transition: none;
```

as the only fix.

That may hide the transition while still painting the wrong theme.

## Important

Do not remove Light/Dark/System.

The initial bootstrap must respect:

-   selected theme
-   appearance mode
-   system preference when System is selected

For a fresh installation:

**Graphite must be the initial theme.**

For an existing user:

**their saved valid theme must remain intact.**

If their saved theme is invalid:

**fall back to Graphite.**

------------------------------------------------------------------------

# Part 5 --- Desktop header alignment

The current desktop screenshot shows:

``` text
[Metrivia] [Workspace] [Upload] [Dashboard]                         [Settings] [Theme]
```

but Upload/Dashboard are too far toward the left.

Improve the desktop header so the main navigation/actions are visually
balanced and aligned toward the right side.

Target concept:

``` text
[Metrivia] [Workspace]                 [Upload] [Dashboard] [Settings] [Theme]
```

Do not blindly use `justify-between` if it causes awkward spacing.

Use a deliberate layout with:

-   brand area
-   workspace selector
-   flexible spacer
-   primary navigation/actions
-   secondary controls

The exact pixel placement is not fixed.

The visual goal is:

-   brand clearly left
-   workspace selector near brand
-   primary navigation comfortably toward the right
-   settings/appearance at the far-right control area
-   no accidental empty region
-   no horizontal overflow

Preserve the current desktop visual language.

------------------------------------------------------------------------

# Part 6 --- Mobile header redesign

The current mobile screenshot shows the header becoming cramped.

The current layout attempts to display too many controls simultaneously.

Do not simply reduce font sizes.

## Mobile target

At approximately:

-   390px
-   430px

The header should prioritize:

``` text
[logo/brand] [workspace] [menu]
```

The menu button should open the secondary actions.

Move these into the mobile menu:

-   Upload
-   Dashboard
-   Settings
-   appearance/theme
-   other secondary actions currently competing for header space

Keep only the highest-priority identity/workspace/menu controls visible.

## Mobile menu

Use the existing shadcn/Base UI menu/sheet/dropdown conventions.

Do not add a new UI library.

The menu should:

-   open smoothly
-   be keyboard accessible
-   have clear labels
-   have adequate touch targets
-   close after selecting an action when appropriate
-   not cause horizontal overflow
-   not alter page width
-   preserve existing page navigation behavior

If a Sheet/Drawer is already available in the project, prefer it for
mobile navigation if it produces a better result than a small dropdown.

Do not copy unrelated demo content.

------------------------------------------------------------------------

# Part 7 --- Mobile content layout

Audit the upload page shown in the screenshot.

The mobile version currently feels too compressed.

Fix:

-   horizontal padding
-   hero width
-   heading line-height
-   paragraph width
-   button stacking
-   upload card spacing
-   upload drop zone
-   badges/helper text
-   button heights
-   font sizes

Do not make everything tiny.

Use responsive layout rules.

The goal is a comfortable mobile reading width.

Example target behavior:

### Desktop

``` text
Large hero
horizontal actions
wide upload card
```

### Mobile

``` text
Hero
full-width primary button
full-width secondary button
comfortable upload card
compact drop zone
```

Do not introduce page-wide horizontal scrolling.

------------------------------------------------------------------------

# Part 8 --- Upload size: reduce to 20 MiB

The user wants the practical upload limit reduced from 50 MiB.

Set the hard maximum to:

**20 MiB**

Use one source of truth per application layer:

Frontend:

``` js
MAX_CSV_BYTES = 20 * 1024 * 1024
```

Backend:

``` python
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
```

Do not use decimal MB in one place and MiB in another.

The UI should consistently say:

**Maximum file size: 20 MiB**

or:

**Maximum CSV size: 20 MiB**

Do not say "50 MB" anywhere in active UI/help text.

Search the entire repository for:

-   `50 MB`
-   `50MB`
-   `50 MiB`
-   `50 * 1024`
-   `10 MB`
-   `10MB`
-   old upload-limit constants

Remove stale user-facing references.

Update tests accordingly.

------------------------------------------------------------------------

# Part 9 --- Keep upload processing safe

The 20 MiB limit is a deliberate practical limit for the current Render
Free architecture.

Render's current Free web service provides:

-   0.1 CPU
-   512 MB RAM

Render documents the Free tier as intended for testing/hobby usage
rather than production. citeturn0search3turn0search13

Therefore:

-   keep backend validation authoritative
-   retain 413 handling
-   retain frontend preflight validation
-   preserve workspace association
-   preserve retry/cold-start handling
-   do not remove table virtualization
-   do not revert to a 100-row preview

Do not claim that 20 MiB guarantees every CSV will process successfully.

------------------------------------------------------------------------

# Part 10 --- Android haptics: investigate instead of guessing

## Current problem

The user has physically tested an Android phone and reports:

**No vibration is felt.**

Previous Phase A diagnostics already established that:

-   `navigator.vibrate()` is called synchronously
-   the haptic library reaches the browser vibration API
-   production patterns reach Android
-   a strong diagnostic probe exists
-   desktop/browser code audits pass

Now the problem is specifically **physical Android behavior**.

## Audit the complete chain

Inspect:

``` text
user gesture
→ haptic hook
→ web-haptics
→ navigator.vibrate
→ Android browser
→ Android system vibration settings
```

Check:

-   exact browser/runtime
-   whether `navigator.vibrate` exists
-   return value of `navigator.vibrate`
-   whether the browser is allowed to vibrate
-   whether the document is focused/visible
-   whether calls happen inside user gestures
-   whether a PWA/installed mode changes behavior
-   whether the test runs in Chrome/Brave/another browser
-   whether Android battery saver affects behavior
-   whether system vibration/haptic settings can suppress browser
    vibration

Do not speculate about the user's phone hardware.

## Add a useful diagnostic

The app should expose enough information in the existing haptic
diagnostic to distinguish:

1.  API unavailable
2.  API available but browser rejected the call
3.  API accepted the call but physical vibration was not perceived
4.  production semantic pattern too weak
5.  direct strong pattern works but semantic pattern does not

Where supported, display the boolean return value of:

``` js
navigator.vibrate(pattern)
```

alongside the existing diagnostic information.

Do not claim that a `true` return proves physical vibration occurred.

## Test sequence

Preserve:

``` js
runDirectVibrationTest([100, 50, 100])
```

Then test:

-   direct diagnostic
-   semantic tap
-   workspace switch
-   workspace close
-   workspace creation

Do not increase every production haptic to huge vibration patterns.

If the strong direct test fails on the actual Android browser,
investigate browser/platform support before redesigning the entire
haptic architecture.

If direct test works but semantic taps fail, adjust semantic patterns to
clearly perceptible but still restrained durations.

------------------------------------------------------------------------

# Part 11 --- Browser compatibility

The app is currently hosted at:

`https://metrivia.vercel.app/`

Audit the production behavior in:

-   desktop Chrome/Chromium
-   Android Chrome
-   Android Brave if that is where the user tests
-   mobile Safari if practical
-   desktop Brave if practical

Do not assume behavior is identical between Chromium browsers.

Record browser-specific problems separately.

------------------------------------------------------------------------

# Part 12 --- Theme architecture audit

Inspect all theme initialization and persistence.

Ensure there is exactly one authoritative flow:

``` text
stored theme preference
        ↓
theme resolver
        ↓
HTML/CSS variables
        ↓
React theme state
```

Avoid:

``` text
CSS default
    ↓
React mounts
    ↓
effect runs
    ↓
theme changes
```

if that produces the visible flash.

Ensure Graphite is used consistently in:

-   fresh install
-   invalid theme
-   missing theme
-   bootstrap
-   React provider
-   theme catalog
-   tests

Do not remove Mocha Mousse.

It should remain selectable if it is part of the theme catalog.

------------------------------------------------------------------------

# Part 13 --- Full performance audit

The application should feel smooth without excessive animation.

Audit the changes from Phase E again.

Pay particular attention to:

-   workspace context updates
-   dashboard rerenders
-   chart rerenders
-   table virtualization
-   filter changes
-   theme changes
-   menu open/close
-   mobile menu
-   initial page load

Use profiling/code inspection rather than subjective guessing.

Do not add animation to solve a rendering-performance problem.

Motion's documentation recommends prioritizing compositor-friendly
`transform` and `opacity`, and notes that layout animation can become
expensive when re-renders are involved. citeturn0search9turn0search6

The existing `MotionConfig reducedMotion="user"` should remain. Motion
documents this as the site-wide mechanism for respecting the user's
reduced-motion preference. citeturn0search0turn0search5

------------------------------------------------------------------------

# Part 14 --- Navigation audit

Verify:

-   Upload
-   Dashboard
-   Settings
-   workspace selector
-   appearance control
-   mobile menu

Do not leave demo/navigation remnants such as:

-   Frontend Shell
-   Docs
-   Components
-   Getting Started
-   Backlog
-   To Do
-   Done

unless they are genuine Metrivia features.

Search the repository for these strings.

------------------------------------------------------------------------

# Part 15 --- Upload UX audit

Check:

-   drag/drop
-   file picker
-   invalid extension
-   oversized file
-   empty file
-   malformed CSV
-   encoding errors
-   backend unavailable
-   Render cold start
-   retry
-   switching workspace during upload
-   closing workspace during upload
-   duplicate filename
-   successful upload
-   server 413

Make sure asynchronous upload results cannot update the wrong workspace.

Preserve the Phase C protection against stale workspace results.

------------------------------------------------------------------------

# Part 16 --- CSV/data audit

Inspect behavior for:

-   1 row
-   10 rows
-   1,000 rows
-   100,000+ rows
-   wide CSVs
-   numeric-only CSV
-   string-heavy CSV
-   mixed types
-   missing values
-   empty columns
-   duplicate column names
-   unusual Unicode
-   quoted commas
-   newline-containing fields
-   malformed CSV

Do not promise support for cases that Pandas/parser configuration does
not actually support.

Document any important limitations.

------------------------------------------------------------------------

# Part 17 --- Accessibility audit

Verify:

-   keyboard-only navigation
-   visible focus
-   workspace selector keyboard behavior
-   mobile menu keyboard behavior
-   escape-to-close
-   correct menu roles
-   correct button labels
-   upload input labeling
-   table accessibility
-   sufficient touch target size
-   color contrast
-   reduced motion

Do not use color alone to communicate:

-   active workspace
-   errors
-   success
-   selected theme

------------------------------------------------------------------------

# Part 18 --- Dependency audit

Inspect:

``` bash
npm outdated
npm audit
```

and the Python dependency files.

Do not blindly upgrade dependencies.

Report:

-   vulnerable dependency
-   outdated dependency
-   unused dependency
-   duplicate functionality
-   unnecessary library

Only upgrade if it is low-risk and directly relevant to this phase.

Do not add another animation library.

The project should continue using the existing `motion` package.

------------------------------------------------------------------------

# Part 19 --- Build/deployment audit

Verify:

``` bash
npm run lint
npm run build
```

Run the existing:

-   haptics audit
-   themes test
-   workspace test
-   UI audit
-   backend upload tests
-   backend CORS tests

Also verify production configuration:

-   `VITE_API_URL`
-   Render CORS
-   no accidental Vercel API proxy
-   no exposed API keys
-   no environment variables committed

Vercel's current serverless-function payload limit is 4.5 MB, so do not
route CSV uploads through a Vercel Function. Direct browser → Render
remains the correct architecture for the current app.
citeturn0search2turn0search11

------------------------------------------------------------------------

# Part 20 --- Security audit

Inspect specifically for:

-   secrets committed to Git
-   API keys in frontend source
-   unsafe file paths
-   arbitrary file writes
-   unsafe file execution
-   dangerous CSV parsing options
-   unrestricted request bodies
-   overly broad CORS
-   verbose production errors
-   stack traces exposed to users

Do not create a database or persistent upload storage as part of this
audit.

The application remains intentionally stateless.

------------------------------------------------------------------------

# Part 21 --- Do not over-fix

This is important.

Do NOT:

-   rewrite the entire header architecture
-   replace React state management
-   replace Tailwind
-   replace shadcn/Base UI
-   replace Motion
-   add Redux
-   add a database
-   add Redis
-   add authentication
-   add a file-storage service
-   redesign the entire dashboard
-   rewrite all charts
-   replace Pandas

unless the audit finds a concrete P0/P1 problem requiring it.

------------------------------------------------------------------------

# Part 22 --- Tests to add/update

Add/update automated tests for:

## Theme bootstrap

-   fresh load → Graphite
-   saved Graphite → Graphite
-   saved other valid theme → preserved
-   invalid theme → Graphite
-   System appearance still resolves correctly

## Header

-   desktop alignment structure
-   mobile menu
-   Upload available in mobile menu
-   Dashboard available in mobile menu
-   Settings available in mobile menu
-   appearance available in mobile menu
-   no Frontend Shell
-   no old workspace tab strip
-   no standalone plus tab

## Upload

-   \<=20 MiB accepted

-   20 MiB rejected

-   correct 413

-   UI says 20 MiB

-   no stale 50 MiB references

## Haptics

-   diagnostic API availability
-   return value captured where available
-   direct probe still uses strong pattern
-   semantic haptics remain synchronous

## Accessibility

-   keyboard workspace switching
-   keyboard mobile menu
-   escape close
-   focus restoration where appropriate

------------------------------------------------------------------------

# Part 23 --- Manual testing matrix

After automated tests:

## Desktop

Test:

-   1440×900
-   1366×768
-   1280×720

Check:

-   no theme flash
-   header alignment
-   workspace selector
-   Upload
-   Dashboard
-   Settings
-   appearance
-   dashboard performance

## Mobile

Test:

-   390px
-   430px

Check:

-   header
-   hamburger
-   workspace selector
-   mobile menu
-   upload buttons
-   upload card
-   dashboard
-   table
-   charts
-   settings

There must be no horizontal page scrolling caused by the header or hero.

## Android

Test:

1.  Open production URL.
2.  Open Settings → Haptics.
3.  Set intensity to 100%.
4.  Run direct vibration test.
5.  Record:
    -   browser
    -   API availability
    -   `navigator.vibrate()` return value
    -   diagnostic skip reason
    -   whether physical vibration was felt
6.  Test semantic tap.
7.  Test workspace switch.
8.  Test workspace close.
9.  Test workspace creation.

------------------------------------------------------------------------

# Part 24 --- Render upload testing

Test:

-   5 MiB
-   10 MiB
-   15 MiB
-   20 MiB
-   20.1 MiB

Record:

-   HTTP status
-   upload duration
-   processing duration
-   Render logs
-   whether the process restarts
-   table responsiveness
-   chart responsiveness

Do not claim 20 MiB is universally safe merely because one file
succeeds.

The practical recommendation should be based on actual test results.

------------------------------------------------------------------------

# Part 25 --- Final audit report

After implementation, provide:

## A. Executive summary

State whether the application is:

-   healthy
-   has remaining P1 issues
-   has remaining P2 issues
-   has known platform limitations

Do not hide unresolved issues.

## B. Complete issue inventory

Use:

  Priority   Area   Issue   Evidence   Status
  ---------- ------ ------- ---------- --------

## C. Files changed

List every changed file.

## D. Files added

List every new file.

## E. Files removed

List every removed file.

## F. Theme flash

Explain:

-   root cause
-   exact fix
-   how first paint now gets the correct theme
-   how saved themes are preserved

## G. Mobile redesign

Explain:

-   what remains visible
-   what moved into the menu
-   responsive breakpoints
-   overflow solution

## H. Upload limit

Confirm:

-   frontend = 20 MiB
-   backend = 20 MiB
-   413 behavior
-   test results

## I. Android haptics

Report:

-   browser/API findings
-   return value behavior
-   direct test result
-   semantic test result
-   remaining uncertainty

Do not claim physical vibration works unless it was physically tested.

## J. Performance

Explain:

-   major rerender causes
-   table behavior
-   chart behavior
-   Motion usage
-   any remaining bottlenecks

## K. Test results

Report exact results for:

-   lint
-   build
-   themes
-   workspaces
-   haptics
-   UI
-   backend
-   accessibility checks
-   dependency audit

Do not fabricate passing results.

## L. Recommended next steps

After the audit, give a prioritized roadmap:

### Next

The single most important next development task.

### Then

Second most important.

### Later

Useful improvements that are not currently blocking.

Do not recommend additional features merely for feature count.

Prioritize stability, UX, performance, and reliability first.

------------------------------------------------------------------------

# Success criteria

This phase is successful only if:

-   opening Metrivia no longer visibly flashes Mocha before Graphite
-   Graphite is the first rendered appearance for fresh users
-   saved valid themes still work
-   desktop header feels balanced
-   Upload/Dashboard are no longer awkwardly positioned
-   mobile header is not squashed
-   mobile secondary controls are accessible through the menu
-   page has no horizontal overflow at 390px/430px
-   upload limit is consistently 20 MiB
-   backend remains authoritative
-   Android haptics are either fixed or diagnostically narrowed down to
    a platform/browser issue
-   the full audit produces concrete findings
-   P0/P1 issues are addressed where safely possible
-   no unrelated architecture is rewritten
-   all existing functionality remains intact
