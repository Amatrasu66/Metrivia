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
import { THEMES } from "@/lib/themes"
import { APPEARANCES } from "@/lib/themes/theme-utils"
import { HAPTIC_CATEGORIES } from "@/lib/haptic-settings"
import { useAppSettings } from "@/hooks/useAppSettings"
import { useMetriviaHaptics } from "@/hooks/useMetriviaHaptics"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ThemeCard } from "@/components/settings/ThemeCard"
import { HapticSlider } from "@/components/settings/HapticSlider"
import { version as appVersion } from "../../../package.json"

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
  const { tap } = useMetriviaHaptics()
  const [isIos] = useState(() => isIosTouchDevice())

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
              Pick a theme palette, then choose light, dark, or follow your
              system.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-6">
            <div className="flex min-w-0 flex-col gap-3">
              <h3 className="text-sm font-semibold text-foreground">Theme</h3>
              <div
                role="group"
                aria-label="Theme palette"
                className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
              >
                {THEMES.map((theme) => (
                  <ThemeCard
                    key={theme.id}
                    theme={theme}
                    selected={theme.id === themeId}
                    onSelect={() => handleSelectTheme(theme.id)}
                  />
                ))}
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-3">
              <h3 className="text-sm font-semibold text-foreground">
                Appearance
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
                        "flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors outline-none",
                        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        selected
                          ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                          : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
                      )}
                    >
                      <Icon aria-hidden="true" className="size-4" />
                      {option.label}
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
            <div className="flex items-center justify-between gap-4">
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
                <Button
                  variant="outline"
                  type="button"
                  disabled={!haptics.enabled}
                  onClick={() => tap()}
                  className="min-h-11"
                >
                  <Vibrate aria-hidden="true" />
                  Test haptic
                </Button>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Plays one tap with your current settings.
                  {isIos &&
                    " iPhone/iPad has no test tick — tap any button to feel the system tick instead."}
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
                  Data-point intensity is reserved for scatter point-drag
                  haptics arriving in Phase 2.
                </p>
              </div>
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
