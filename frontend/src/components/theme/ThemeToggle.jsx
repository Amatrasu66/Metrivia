import { Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAppSettings } from "@/hooks/useAppSettings"
import { useMetriviaHaptics } from "@/hooks/useMetriviaHaptics"
import { APPEARANCES } from "@/lib/themes/theme-utils"

/**
 * Light/dark toggle for the application header (shared by the landing and
 * dashboard views). Flips the *appearance* between light and dark — the
 * active theme palette is unchanged, only its variant switches. Picking an
 * explicit mode here also leaves "System" (choosable in Settings).
 * Switching only rewrites documentElement tokens + persisted preference —
 * dataset, filters, chart config, and route are untouched.
 */
export function ThemeToggle() {
  const { effectiveMode, setAppearance } = useAppSettings()
  const { tap } = useMetriviaHaptics()

  const next =
    effectiveMode === APPEARANCES.DARK ? APPEARANCES.LIGHT : APPEARANCES.DARK
  const label = `Switch to ${next} mode`

  const handleToggle = () => {
    tap()
    setAppearance(next)
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      aria-label={label}
      title={label}
      onClick={handleToggle}
    >
      {effectiveMode === APPEARANCES.DARK ? (
        <Sun aria-hidden="true" />
      ) : (
        <Moon aria-hidden="true" />
      )}
    </Button>
  )
}
