import { Switch } from "@base-ui/react/switch"
import {
  Monitor,
  Moon,
  RotateCcw,
  Sun,
  Vibrate,
} from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { isIosTouchDevice } from "@/lib/is-ios"
import { APPEARANCES } from "@/lib/themes/theme-utils"
import { HAPTIC_CATEGORIES } from "@/lib/haptic-settings"
import {
  ANDROID_DIAGNOSTIC_PATTERN,
  describeDevice,
  predictVibratePattern,
} from "@/lib/android-haptic-diagnostic"
import { useAppSettings } from "@/hooks/useAppSettings"
import {
  getHapticDiagnostics,
  useMetriviaHaptics,
} from "@/hooks/useMetriviaHaptics"
import { Button } from "@/components/ui/button"
import { IosHapticSwitch } from "@/components/haptics/IosHapticSwitch"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ThemeGallery } from "@/components/settings/ThemeGallery"
import { HapticSlider } from "@/components/settings/HapticSlider"
import { version as appVersion } from "../../../package.json"

/**
 * Readout for the Phase A hardware diagnostic. Local-only, dev-safe: shows
 * what the last probe press observed (API availability, call result, skip
 * reason) without ever claiming physical vibration from JavaScript.
 */
function HapticProbeReadout({ report, isIos }) {
  if (!report) {
    return (
      <p className="text-xs text-muted-foreground">
        Press Test haptic to run the probe. Nothing is sent anywhere — the
        result appears here.
      </p>
    )
  }
  const { device, decision, skipReason, vibrate, diagnostics } = report
  const platformLabel = isIos
    ? "iOS"
    : device.looksAndroid
      ? "Android"
      : "Desktop / other"
  const touchLabel =
    device.touchPoints == null
      ? "unknown"
      : device.touchPoints > 0
        ? `yes (${device.touchPoints} touch points)`
        : "no"
  const attempted = vibrate?.attempted === true
  // Phase F: surface the raw navigator.vibrate() boolean return value.
  // `true` = browser ACCEPTED the call (never physical proof); `false` =
  // browser rejected it (policy, background tab, blocked gesture).
  const resultLabel = !attempted
    ? "— (not attempted)"
    : vibrate.error != null
      ? `threw: ${vibrate.error}`
      : `${String(vibrate.result)}${vibrate.result === true ? " (call accepted — not physical proof)" : " (browser rejected the call)"}`
  const visibilityLabel = device.visibility ?? "unknown"
  const focusLabel =
    device.hasFocus == null ? "unknown" : device.hasFocus ? "yes" : "no"
  const activation = device.userActivation
  const activationLabel =
    activation == null
      ? "unknown"
      : `active=${String(activation.isActive)} beenActive=${String(activation.hasBeenActive)}`
  const browserLabel = device.looksBrave
    ? "Brave (heuristic)"
    : device.looksChrome
      ? "Chrome/Chromium (heuristic)"
      : device.looksFirefox
        ? "Firefox (heuristic)"
        : device.looksSafari
          ? "Safari (heuristic)"
          : "unknown"
  const patternLabel =
    report.kind === "probe"
      ? `[${ANDROID_DIAGNOSTIC_PATTERN.join(", ")}]`
      : diagnostics.pattern != null
        ? JSON.stringify(diagnostics.pattern)
        : "— (suppressed)"
  const statusLine =
    decision === "triggered"
      ? report.kind === "probe"
        ? "Triggered: Android navigator.vibrate"
        : "Triggered: semantic tap via web-haptics"
      : (skipReason ?? "Skipped")
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-muted/40 p-3">
      <p
        className={cn(
          "text-sm font-semibold",
          decision === "triggered" ? "text-foreground" : "text-amber-600",
        )}
      >
        {statusLine}
      </p>
      <dl className="grid min-w-0 grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Platform</dt>
        <dd className="min-w-0 break-words text-foreground">
          {platformLabel} (user-agent heuristic)
        </dd>
        <dt className="text-muted-foreground">Touch device</dt>
        <dd className="text-foreground">{touchLabel}</dd>
        <dt className="text-muted-foreground">navigator.vibrate exists</dt>
        <dd className="text-foreground">
          {device.hasVibrate ? "yes" : "no"}
        </dd>
        <dt className="text-muted-foreground">navigator.vibrate result</dt>
        <dd className="min-w-0 break-words font-mono text-foreground">
          {resultLabel}
        </dd>
        <dt className="text-muted-foreground">Document visible</dt>
        <dd className="text-foreground">{visibilityLabel}</dd>
        <dt className="text-muted-foreground">Document focused</dt>
        <dd className="text-foreground">{focusLabel}</dd>
        <dt className="text-muted-foreground">User activation</dt>
        <dd className="min-w-0 break-words font-mono text-foreground">
          {activationLabel}
        </dd>
        <dt className="text-muted-foreground">Browser</dt>
        <dd className="text-foreground">{browserLabel}</dd>
        <dt className="text-muted-foreground">Reduced motion</dt>
        <dd className="text-foreground">
          {diagnostics.accessibility.prefersReducedMotion ? "on" : "off"}
        </dd>
        <dt className="text-muted-foreground">Haptics enabled</dt>
        <dd className="text-foreground">
          {diagnostics.settings.enabled ? "on" : "off"}
        </dd>
        <dt className="text-muted-foreground">Global intensity</dt>
        <dd className="text-foreground">
          {Math.round(diagnostics.settings.intensity * 100)}%
        </dd>
        <dt className="text-muted-foreground">Buttons intensity</dt>
        <dd className="text-foreground">
          {diagnostics.settings.categoryLevel == null
            ? "—"
            : `${Math.round(diagnostics.settings.categoryLevel * 100)}%`}
        </dd>
        <dt className="text-muted-foreground">Effective intensity</dt>
        <dd className="text-foreground">
          {diagnostics.scale == null
            ? "— (silent)"
            : `${Math.round(diagnostics.scale * 100)}%`}
        </dd>
        <dt className="text-muted-foreground">Selected pattern</dt>
        <dd className="min-w-0 break-words font-mono text-foreground">
          {patternLabel}
        </dd>
        {report.kind === "semantic" && report.expectedVibrate != null && (
          <>
            <dt className="text-muted-foreground">Expected vibrate()</dt>
            <dd className="min-w-0 break-words font-mono text-foreground">
              [{report.expectedVibrate.join(", ")}] (computed — no second call
              was made)
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">Trigger attempted</dt>
        <dd className="text-foreground">
          {report.kind === "probe"
            ? attempted
              ? "yes (direct probe)"
              : "no"
            : report.firedSemantic
              ? "yes (semantic tap)"
              : "no"}
        </dd>
      </dl>
      <p className="text-xs text-muted-foreground">
        {device.hasVibrate
          ? "Browser vibration API is available, but physical vibration cannot be verified from JavaScript — only you holding the phone can confirm it."
          : "Vibration API unavailable in this browser."}
      </p>
      {device.looksAndroid && attempted && vibrate?.result === true ? (
        <p className="text-xs text-muted-foreground">
          Call accepted but nothing felt? Check the physical chain: Android
          Settings → Sound & vibration (vibration on, not silent), battery
          saver off, Chrome/Brave site settings allow vibration, the tab is
          visible and tapped directly (not a background tab), and — for
          Brave — Shields are not blocking it. Async events (upload success)
          fire outside the tap gesture, so test with the buttons above first.
        </p>
      ) : null}
    </div>
  )
}

const APPEARANCE_OPTIONS = [
  { id: APPEARANCES.LIGHT, label: "Light", icon: Sun },
  { id: APPEARANCES.DARK, label: "Dark", icon: Moon },
  { id: APPEARANCES.SYSTEM, label: "System", icon: Monitor },
]

/**
 * Metrivia Settings: appearance (theme palette + light/dark/system),
 * haptic feedback preferences, and a small about/reset section.
 * Follows the app's page-state navigation (no router); layout matches the
 * upload/dashboard pages (comfortable max-width, single column on mobile).
 */
export function SettingsPage() {
  const {
    themeId,
    setTheme,
    appearance,
    setAppearance,
    haptics,
    setHapticsEnabled,
    setHapticIntensity,
    setHapticCategory,
    resetSettings,
  } = useAppSettings()
  const { tap, runHapticProbe } = useMetriviaHaptics()
  const [isIos] = useState(() => isIosTouchDevice())
  // Last diagnostic report (probe or semantic comparison). Local state only —
  // never sent anywhere.
  const [probeReport, setProbeReport] = useState(null)

  /**
   * Phase A hardware probe. MUST stay synchronous (no await/setTimeout):
   * runHapticProbe() calls navigator.vibrate in this same task so the
   * browser still sees the real user gesture.
   */
  const handleTestHaptic = () => {
    setProbeReport({
      kind: "probe",
      device: describeDevice(),
      ...runHapticProbe(),
    })
  }

  /**
   * Semantic-path comparison: fires the real tap() through web-haptics (one
   * vibrate call, same as every production interaction) and records what the
   * library was expected to hand to navigator.vibrate (computed — a second
   * call would cancel the buzz).
   */
  const handleTestSemanticTap = () => {
    const diagnostics = getHapticDiagnostics("tap", undefined)
    const expectedVibrate =
      diagnostics.pattern != null
        ? predictVibratePattern(diagnostics.pattern)
        : null
    if (diagnostics.triggerCalled) tap()
    setProbeReport({
      kind: "semantic",
      device: describeDevice(),
      decision: diagnostics.triggerCalled ? "triggered" : "skipped",
      skipReason: diagnostics.skipReason,
      vibrate: {
        available: diagnostics.platform.hasNavigatorVibrate,
        attempted: false,
        pattern: null,
        result: null,
        error: null,
      },
      expectedVibrate,
      firedSemantic: diagnostics.triggerCalled,
      diagnostics,
    })
  }

  const handleSelectTheme = (id) => {
    if (id === themeId) return
    setTheme(id)
    tap()
  }

  const handleAppearance = (mode) => {
    if (mode === appearance) return
    setAppearance(mode)
    tap()
  }

  const handleMasterToggle = (checked) => {
    setHapticsEnabled(checked)
    // Cache updates synchronously, so this confirms re-enabling and stays
    // silent when disabling — exactly one haptic per activation.
    if (checked) tap()
  }

  const handleReset = () => {
    resetSettings()
    tap()
  }

  const liveCategories = HAPTIC_CATEGORIES.filter(
    (category) => category.action !== null,
  )

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Tune how Metrivia looks and feels. Changes apply instantly and are
          stored only in this browser.
        </p>
      </div>

      {/* ------------------------------------------------ Appearance */}
      <section aria-labelledby="settings-appearance" className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle id="settings-appearance">Appearance</CardTitle>
            <CardDescription>
              Choose a color mode, then pick a visual theme below. Theme
              changes apply across the whole app and every workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-6">
            <div className="flex min-w-0 flex-col gap-3">
              <h3 className="text-sm font-semibold text-foreground">
                Color mode
              </h3>
              <div
                role="group"
                aria-label="Color scheme"
                className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-muted/60 p-1 sm:max-w-md"
              >
                {APPEARANCE_OPTIONS.map((option) => {
                  const Icon = option.icon
                  const selected = appearance === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => handleAppearance(option.id)}
                      className={cn(
                        "relative flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors outline-none",
                        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        selected
                          ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
                      )}
                    >
                      <Icon aria-hidden="true" className="size-4" />
                      {option.label}
                      {/* iOS only: direct-touch native tick for real mode
                          changes. Only on inactive options so re-tapping
                          the active mode stays silent. Null on
                          Android/desktop (which uses tap() above). */}
                      {selected ? null : (
                        <IosHapticSwitch
                          onActivate={() => handleAppearance(option.id)}
                        />
                      )}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                System follows your operating system and updates automatically
                when it changes.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ---------------------------------------------------- Themes */}
      <section aria-labelledby="settings-themes" className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle id="settings-themes">Themes</CardTitle>
            <CardDescription>
              Choose a visual theme for Metrivia. Previews show the real
              light and dark palettes with their chart colors.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0">
            <ThemeGallery
              activeThemeId={themeId}
              onSelectTheme={handleSelectTheme}
            />
          </CardContent>
        </Card>
      </section>

      {/* -------------------------------------------------- Haptics */}
      <section aria-labelledby="settings-haptics" className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle id="settings-haptics">Haptic feedback</CardTitle>
            <CardDescription>
              Control tactile feedback for taps, filters, charts, and alerts.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-6">
            {/* Master toggle row. iOS cannot host the native tick *inside*
                the Base UI switch (nested interactive controls), so the
                direct-touch switch covers this row instead — only while
                haptics are enabled (IosHapticSwitch renders null once they
                are off, when disabling must stay silent). The Base UI
                switch keeps its semantics for keyboard/AT; the overlay
                input is aria-hidden and unfocusable. The closure reads the
                current value — never the switch's change event — so the
                toggle cannot double-fire or invert the wrong way. */}
            <div className="relative flex items-center justify-between gap-4">
              <IosHapticSwitch
                onActivate={() => handleMasterToggle(!haptics.enabled)}
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span
                  id="haptics-master-label"
                  className="text-sm font-semibold text-foreground"
                >
                  Haptic feedback
                </span>
                <span className="text-xs text-muted-foreground">
                  {haptics.enabled
                    ? "On — interactions produce tactile feedback."
                    : "Off — the app works the same, just silently."}
                </span>
              </div>
              <Switch.Root
                checked={haptics.enabled}
                onCheckedChange={handleMasterToggle}
                aria-labelledby="haptics-master-label"
                className={cn(
                  "flex h-7 w-12 shrink-0 items-center rounded-full bg-muted px-0.5 transition-colors outline-none",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  "data-checked:bg-primary",
                )}
              >
                <Switch.Thumb
                  className={cn(
                    "block size-6 rounded-full bg-card shadow-sm transition-transform",
                    "data-checked:translate-x-5",
                  )}
                />
              </Switch.Root>
            </div>

            <div
              className={cn(
                "flex min-w-0 flex-col gap-5",
                !haptics.enabled && "pointer-events-none opacity-50",
              )}
              aria-disabled={!haptics.enabled}
            >
              <HapticSlider
                id="haptic-intensity"
                label="Overall intensity"
                hint="Scales every haptic. 0% is silent without turning feedback off."
                value={haptics.intensity}
                onChange={setHapticIntensity}
                disabled={!haptics.enabled}
              />

              <div>
                <p className="text-xs text-muted-foreground">
                  Use the hardware diagnostic below to test vibration — it
                  stays available even with feedback off so suppression stays
                  visible.
                </p>
              </div>

              <div className="flex min-w-0 flex-col gap-5 border-t border-border pt-5">
                <h3 className="text-sm font-semibold text-foreground">
                  Per-interaction intensity
                </h3>
                {liveCategories.map((category) => (
                  <HapticSlider
                    key={category.id}
                    id={`haptic-${category.id}`}
                    label={category.label}
                    hint={category.hint}
                    value={haptics.categories[category.id] ?? 1}
                    onChange={(value) =>
                      setHapticCategory(category.id, value)
                    }
                    disabled={!haptics.enabled}
                  />
                ))}
                <p className="text-xs text-muted-foreground">
                  Intensity controls apply to adjustable vibration where
                  supported (Android).
                  {isIos
                    ? " This iPhone/iPad uses the fixed system tick, so sliders don’t change its strength — only on/off applies here."
                    : " On iPhone/iPad haptics are a fixed system tick, so sliders don’t change their strength there — only on/off applies."}{" "}
                  Data-point feedback ticks as a finger drags across
                  scatter-chart points (touch only — mouse hover stays
                  silent).
                  {isIos &&
                    " Scatter drags have no haptic on this device: individual SVG points can’t host the system-tick target without breaking chart gestures."}
                </p>
              </div>
            </div>

            {/* Phase A hardware diagnostic. Deliberately OUTSIDE the dimmed
                intensities block above: the probe must stay pressable while
                feedback is off / intensity is 0 so the readout can show the
                skip reason instead of silently doing nothing. */}
            <div className="flex min-w-0 flex-col gap-3 border-t border-border pt-5">
              <h3 className="text-sm font-semibold text-foreground">
                Hardware diagnostic
              </h3>
              <p className="text-xs text-muted-foreground">
                Test haptic plays an unmistakable double-buzz hardware probe
                at full strength (ignores intensity sliders; still respects
                off and reduced motion). Play semantic tap fires the normal
                short tap through the regular path for comparison.
                {isIos &&
                  " iPhone/iPad has no vibration API — tap any button to feel the system tick instead."}
              </p>
              <div className="flex min-w-0 flex-wrap gap-2">
                <Button
                  variant="outline"
                  type="button"
                  onClick={handleTestHaptic}
                  className="min-h-11"
                >
                  <Vibrate aria-hidden="true" />
                  Test haptic
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={handleTestSemanticTap}
                  className="min-h-11"
                >
                  Play semantic tap
                </Button>
              </div>
              <HapticProbeReadout report={probeReport} isIos={isIos} />
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ----------------------------------------------------- About */}
      <section aria-labelledby="settings-about" className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle id="settings-about">About</CardTitle>
            <CardDescription>
              Metrivia {appVersion ? `v${appVersion} ` : ""}— responsive CSV
              data visualization.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-4">
            <p className="text-xs text-muted-foreground">
              Preferences (theme, appearance, haptics) are stored only in this
              browser&apos;s local storage. Uploaded data and dashboard state
              are never touched by settings.
            </p>
            <div>
              <Button
                variant="outline"
                type="button"
                onClick={handleReset}
                className="min-h-11"
              >
                <RotateCcw aria-hidden="true" />
                Reset to defaults
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
