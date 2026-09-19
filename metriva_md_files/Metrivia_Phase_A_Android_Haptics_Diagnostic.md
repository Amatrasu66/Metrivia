# Metrivia — Phase A: Android Haptics Runtime Diagnosis & Repair

## Objective

Work inside the existing **Metrivia** repository.

The previous static audit reported that the semantic haptic layer and 77/77 checks passed, but physical testing on an Android device produced **zero haptic feedback anywhere**.

Treat the physical result as the source of truth for this phase.

Do not blindly increase vibration durations, replace `web-haptics`, or rewrite the entire haptic architecture before identifying the failure point.

---

## 1. Inspect the current implementation

Before changing anything, inspect the current repository.

At minimum inspect:

- `frontend/package.json`
- `frontend/src/hooks/useMetriviaHaptics.js`
- `frontend/src/lib/is-ios.js`
- `frontend/src/lib/haptic-settings.js`
- all haptic-related components
- `package-lock.json` / installed `web-haptics@0.0.6`
- existing haptic audit scripts
- Settings page and Test Haptic control
- reduced-motion logic
- localStorage haptic settings/sanitization
- Android/iOS detection

Search the whole frontend for:

```text
useMetriviaHaptics
navigator.vibrate
web-haptics
isIosTouchDevice
trigger(
dataPoint
chartSelect
haptic
vibrate
```

Verify the actual current source rather than assuming the previous report is correct.

---

## 2. Establish a minimal Android vibration test

Create a development-safe diagnostic path triggered synchronously by the existing **Test Haptic** button.

First test:

```js
navigator.vibrate(200)
```

Then test a clearly perceptible pattern:

```js
navigator.vibrate([100, 50, 100])
```

Do not trigger these tests from:

- `useEffect`
- `setTimeout`
- promises
- async callbacks
- page load
- animation callbacks

The purpose is to test the browser/device API during a real user gesture.

---

## 3. Add useful diagnostics

Extend the existing haptic diagnostics rather than creating a second unrelated haptic system.

Expose enough information to distinguish:

```text
Platform
Touch device
navigator.vibrate exists
navigator.vibrate result
Reduced motion
Haptics enabled
Global intensity
Effective intensity
Selected pattern
Trigger attempted
Trigger result
Skip reason
```

If possible, record the return value from `navigator.vibrate(...)`.

Important:

```text
API available
API call accepted
Physical vibration confirmed
```

are three different things.

JavaScript cannot confirm that the phone physically vibrated. Never claim physical confirmation when only an API call was observed.

Do not send diagnostics to a server or add analytics/tracking.

---

## 4. Inspect the installed web-haptics package

Inspect the actual installed `web-haptics@0.0.6` source in `node_modules`.

Determine:

1. How Android is detected.
2. How Android vibration is triggered.
3. Whether `navigator.vibrate` is called directly.
4. Whether it happens synchronously during the user gesture.
5. How custom vibration patterns are transformed.
6. Whether intensity scaling can produce zero/invalid durations.
7. Whether exceptions are swallowed.
8. Whether another browser API is required.
9. Whether the Metrivia wrapper passes patterns in the correct format.

Do not rely only on the README.

---

## 5. Temporarily bypass the abstraction if necessary

If evidence points to `web-haptics` as the failure point, add a temporary direct Android diagnostic inside the central Metrivia haptic layer:

```js
navigator.vibrate([100, 50, 100])
```

Do not scatter direct `navigator.vibrate()` calls across UI components.

Use this only to isolate:

```text
Test button
→ Metrivia hook
→ web-haptics
→ navigator.vibrate
→ Android device
```

If direct vibration works but `web-haptics` does not, identify and repair the central implementation.

If direct vibration also fails, do not keep rewriting application code without evidence.

---

## 6. Make Test Haptic unmistakable

For the diagnostic test only, use a clearly perceptible pattern equivalent to:

```js
[100, 50, 100]
```

or:

```js
200
```

Do not use the existing subtle 10–20 ms interaction patterns for this diagnostic.

After the base path is proven, production interaction patterns can remain short and semantic.

---

## 7. Preserve the semantic API

Do not break or rename these unless absolutely necessary:

```text
tap()
select()
chartSelect()
dataPoint()
success()
error()
warning()
```

Keep:

```text
UI interaction
→ useMetriviaHaptics()
→ platform-specific implementation
```

Do not scatter direct browser vibration calls throughout components.

---

## 8. Preserve iOS behavior

Do not regress the current iOS native-switch workaround.

Keep Android and iOS paths separate where necessary.

Do not place HTML switch overlays over:

- native `<select>`
- checkboxes
- range sliders
- SVG chart marks
- scrollable controls

because this can interfere with interaction.

---

## 9. Verify suppression conditions

Check whether Test Haptic or Android interactions are accidentally blocked by:

- master haptics disabled
- global intensity = 0
- category intensity = 0
- reduced motion
- stale localStorage
- incorrect iOS detection
- disabled controls
- event propagation
- swallowed exceptions

For diagnostics, expose the actual skip reason.

Examples:

```text
Skipped: haptics disabled
Skipped: intensity = 0
Skipped: reduced motion
Skipped: iOS native-switch path
Triggered: Android navigator.vibrate
```

---

## 10. Check Android/browser runtime assumptions

Detect:

```js
typeof navigator !== "undefined" &&
typeof navigator.vibrate === "function"
```

If unavailable, report:

> Vibration API unavailable in this browser.

If available but no physical vibration is observed, report:

> Browser vibration API is available, but physical vibration cannot be verified from JavaScript.

Do not fabricate support.

---

## 11. Settings behavior

Verify that Test Haptic works when:

- Haptics enabled
- intensity 100%
- Test button is enabled

The diagnostic must make it obvious if settings intentionally suppress the vibration.

Keep the existing settings model intact.

---

## 12. Physical-device limitation

You cannot physically test my Android phone.

Therefore:

- Do not claim Android physical haptics are fixed merely because lint/build/audit passes.
- Do not claim that a vibration occurred on hardware unless actually tested.
- Clearly distinguish code verification from physical verification.

My physical test sequence will be:

1. Open Metrivia on the Android phone.
2. Open Settings.
3. Ensure Haptic Feedback is enabled.
4. Set intensity to 100%.
5. Press **Test Haptic**.
6. Test the obvious `[100, 50, 100]` pattern.
7. Test a normal Metrivia interaction.

---

## 13. If direct navigator.vibrate works

If the physical Android device vibrates with:

```js
navigator.vibrate([100, 50, 100])
```

but normal semantic haptics do not:

- identify the exact failing layer;
- repair the central haptic implementation;
- keep the semantic API;
- preserve settings/intensity behavior;
- verify:

```text
tap
select
chartSelect
dataPoint
success
error
warning
```

through representative interactions.

---

## 14. If direct navigator.vibrate does not work

If `navigator.vibrate` exists but the physical device still produces no vibration:

1. Report the API availability.
2. Report the call return value if available.
3. Verify the call is synchronous and user-gesture initiated.
4. Verify Metrivia is not suppressing it.
5. Check the browser/runtime constraints relevant to the actual environment.
6. Do not perform a large application rewrite.
7. Clearly state that physical vibration remains unverified from code.

---

## 15. Regression protection

Update the existing haptic audit if necessary.

Keep checks for:

- Android detection
- iOS detection
- settings sanitization
- intensity scaling
- zero-intensity suppression
- master-toggle suppression
- semantic action reachability
- data-point independence
- iOS silence rules
- switch/interactive-control rules
- complete interaction coverage

Add checks for the new Android diagnostic path.

Do not weaken or delete existing checks merely to make them pass.

---

## 16. Do not change unrelated UI

This phase must NOT implement:

- Metrivia tabs/workspaces
- CSV preview redesign
- landing-page cleanup
- theme redesign
- Monochrome default
- Tweaks drawer removal
- new chart types
- dashboard redesign

Those are separate phases.

---

## 17. Validation

Run:

```bash
npm run haptics:audit
npm run lint
npm run build
```

Also run relevant existing tests if present.

Fix all errors caused by your changes.

A pre-existing build warning is acceptable only if it is unchanged and clearly reported.

---

## 18. Final report

Return:

### Root cause
The exact failure point.

### Changes made
Files changed and purpose.

### Android runtime path
Show:

```text
User gesture
→ Metrivia hook
→ implementation
→ navigator.vibrate
```

or identify exactly where it stops.

### Direct API test

Report:

```text
navigator.vibrate available: yes/no
navigator.vibrate(200) call result: ...
navigator.vibrate([100,50,100]) call result: ...
Physical vibration verified: NO
```

Do not claim physical verification unless performed on actual hardware.

### iOS
What was preserved/changed.

### Regression

```text
haptics:audit: XX/XX
lint: PASS/FAIL
build: PASS/FAIL
```

### Physical Android test checklist
Give a short exact checklist for testing on the phone.

---

## Critical instruction

Do not stop at:

> "The code looks correct."

The original problem is a **physical Android device producing no vibration**.

The purpose of this phase is to identify the actual runtime boundary causing that failure and either repair it or provide a precise diagnosis showing that the browser/device is rejecting the vibration path.
