import { BarChart3, Menu, Monitor, Moon, Settings, Sun, X } from "lucide-react"
import { motion } from "motion/react"
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { useAppSettings } from "@/hooks/useAppSettings"
import { useMetriviaHaptics } from "@/hooks/useMetriviaHaptics"
import { APPEARANCES } from "@/lib/themes/theme-utils"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme/ThemeToggle"
import { WorkspaceSelector } from "@/components/workspaces/WorkspaceSelector"

const NAV_ITEMS = [
  { id: "upload", label: "Upload" },
  { id: "dashboard", label: "Dashboard" },
]

export function BrandMark({ compact = false }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
      >
        <BarChart3 className="size-5" />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-base font-semibold tracking-tight">
          Metrivia
        </span>
        {!compact && (
          <span className="truncate text-xs text-muted-foreground">
            CSV data visualization
          </span>
        )}
      </span>
    </span>
  )
}

const MOBILE_APPEARANCE_OPTIONS = [
  { id: APPEARANCES.LIGHT, label: "Light", icon: Sun },
  { id: APPEARANCES.DARK, label: "Dark", icon: Moon },
  { id: APPEARANCES.SYSTEM, label: "System", icon: Monitor },
]

/**
 * Application header (Phase F): deliberate brand/workspace/spacer/nav layout.
 * - Desktop: [brand][workspace][flexible spacer][Upload/Dashboard][Settings][Theme]
 *   so primary navigation sits comfortably toward the right, not mid-header.
 * - Mobile (~390/430px): only [brand][workspace][menu] stay visible; Upload,
 *   Dashboard, Settings, and appearance move into the menu panel.
 * Motion is limited to the desktop nav indicator (transform-only); nothing
 * else animates. Reduced motion is handled globally via MotionConfig.
 */
export function AppHeader({
  activeView,
  onNavigate,
  onCreateWorkspace,
  onSelectWorkspace,
  onCloseWorkspace,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { tap } = useMetriviaHaptics()
  const { appearance, setAppearance } = useAppSettings()
  const menuRef = useRef(null)

  const handleNavigate = (view) => {
    tap()
    onNavigate(view)
    setMenuOpen(false)
  }

  const handleMenuToggle = () => {
    tap()
    setMenuOpen((open) => !open)
  }

  const handleAppearance = (mode) => {
    if (mode === appearance) return
    setAppearance(mode)
    tap()
  }

  // Escape closes the mobile menu; focus returns to the menu button.
  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault()
        setMenuOpen(false)
        document
          .getElementById("mobile-menu-button")
          ?.focus({ preventScroll: true })
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [menuOpen])

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
        {/* Brand area (always visible, never shrinks away). */}
        <div className="min-w-0 shrink-0">
          <BrandMark compact />
        </div>

        {/* Workspace selector near the brand (truncates on narrow screens). */}
        <div className="min-w-0 max-w-40 shrink sm:max-w-52">
          <WorkspaceSelector
            onCreate={onCreateWorkspace}
            onSelect={onSelectWorkspace}
            onClose={onCloseWorkspace}
          />
        </div>

        {/* Flexible spacer: pushes primary nav + controls to the right. */}
        <div aria-hidden="true" className="min-w-0 flex-1" />

        {/* Primary navigation: desktop only, comfortably right-aligned. */}
        <nav
          aria-label="Primary"
          className="hidden shrink-0 items-center gap-0.5 rounded-xl border border-border bg-muted/60 p-1 md:flex"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeView === item.id
            return (
              <button
                key={item.id}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => handleNavigate(item.id)}
                className={cn(
                  "relative rounded-lg px-4 py-1.5 text-sm font-medium transition-colors outline-none",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-accent-foreground",
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="metrivia-nav-pill"
                    aria-hidden="true"
                    transition={{ type: "spring", stiffness: 550, damping: 40 }}
                    className="absolute inset-0 rounded-lg bg-card shadow-sm ring-1 ring-border"
                  />
                )}
                <span className="relative">{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Far-right secondary controls: desktop only. */}
        <span className="hidden shrink-0 items-center gap-1 md:flex">
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label="Open settings"
            aria-current={activeView === "settings" ? "page" : undefined}
            title="Open settings"
            onClick={() => handleNavigate("settings")}
            className={cn(
              activeView === "settings" && "bg-secondary text-secondary-foreground",
            )}
          >
            <Settings aria-hidden="true" />
          </Button>
          <ThemeToggle />
        </span>

        {/* Mobile menu button: the only control besides brand/workspace. */}
        <span className="flex shrink-0 items-center md:hidden">
          <Button
            id="mobile-menu-button"
            variant="outline"
            size="icon"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={handleMenuToggle}
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </Button>
        </span>
      </div>

      <div
        id="mobile-nav"
        ref={menuRef}
        className={cn("border-t border-border md:hidden", !menuOpen && "hidden")}
      >
        <nav
          aria-label="Mobile"
          className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-1 overflow-x-clip px-4 py-3"
        >
          {NAV_ITEMS.map((item) => (
            <Button
              key={item.id}
              variant={activeView === item.id ? "secondary" : "ghost"}
              className="min-h-11 w-full justify-start"
              aria-current={activeView === item.id ? "page" : undefined}
              onClick={() => handleNavigate(item.id)}
            >
              {item.label}
            </Button>
          ))}
          <Button
            variant={activeView === "settings" ? "secondary" : "ghost"}
            className="min-h-11 w-full justify-start"
            aria-current={activeView === "settings" ? "page" : undefined}
            onClick={() => handleNavigate("settings")}
          >
            <Settings aria-hidden="true" />
            Settings
          </Button>
          <div
            role="group"
            aria-label="Appearance"
            className="mt-1 flex min-w-0 flex-col gap-2 border-t border-border pt-3"
          >
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Appearance
            </p>
            <div className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-muted/60 p-1">
              {MOBILE_APPEARANCE_OPTIONS.map((option) => {
                const Icon = option.icon
                const selected = appearance === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => handleAppearance(option.id)}
                    className={cn(
                      "flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium transition-colors outline-none",
                      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      selected
                        ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                        : "text-muted-foreground hover:text-accent-foreground",
                    )}
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    <span className="truncate">{option.label}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              System follows your device. More themes live in Settings.
            </p>
          </div>
        </nav>
      </div>
    </header>
  )
}
