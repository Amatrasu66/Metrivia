import { Moon, Sun } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  THEMES,
  applyTheme,
  oppositeTheme,
  resolveInitialTheme,
} from "@/lib/theme"

/**
 * Light/dark toggle for the application header (shared by the landing and
 * dashboard views). Switching only flips the `dark` class + persisted
 * preference — dataset, filters, chart config, and route are untouched.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState(() => resolveInitialTheme())

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const next = oppositeTheme(theme)
  const label = `Switch to ${next} mode`

  return (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setTheme(next)}
    >
      {theme === THEMES.DARK ? (
        <Sun aria-hidden="true" />
      ) : (
        <Moon aria-hidden="true" />
      )}
    </Button>
  )
}
