import { BarChart3, Menu, Settings, X } from "lucide-react"
import { motion } from "motion/react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { useMetriviaHaptics } from "@/hooks/useMetriviaHaptics"
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

/**
 * Application header (Phase E): brand, workspace selector, and a compact
 * segmented Upload/Dashboard menu with a small shared active indicator.
 * Motion is limited to that indicator (transform-only layout animation on
 * two buttons); nothing else in the header animates. Reduced motion is
 * handled globally via MotionConfig (see main.jsx).
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

  const handleNavigate = (view) => {
    tap()
    onNavigate(view)
    setMenuOpen(false)
  }

  const handleMenuToggle = () => {
    tap()
    setMenuOpen((open) => !open)
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <div className="min-w-0 shrink-0">
          <BrandMark compact />
        </div>

        <div className="min-w-0 shrink">
          <WorkspaceSelector
            onCreate={onCreateWorkspace}
            onSelect={onSelectWorkspace}
            onClose={onCloseWorkspace}
          />
        </div>

        <nav
          aria-label="Primary"
          className="ml-1 hidden items-center gap-0.5 rounded-xl border border-border bg-muted/60 p-1 md:flex"
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

        <span className="ml-auto flex shrink-0 items-center gap-1">
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
          <Button
            variant="outline"
            size="icon"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={handleMenuToggle}
            className="md:hidden"
          >
            {menuOpen ? <X /> : <Menu />}
          </Button>
        </span>
      </div>

      <div
        id="mobile-nav"
        className={cn("border-t border-border md:hidden", !menuOpen && "hidden")}
      >
        <nav
          aria-label="Mobile"
          className="mx-auto flex w-full max-w-7xl flex-col gap-1 px-4 py-3"
        >
          {NAV_ITEMS.map((item) => (
            <Button
              key={item.id}
              variant={activeView === item.id ? "secondary" : "ghost"}
              className="w-full justify-start"
              aria-current={activeView === item.id ? "page" : undefined}
              onClick={() => handleNavigate(item.id)}
            >
              {item.label}
            </Button>
          ))}
          <Button
            variant={activeView === "settings" ? "secondary" : "ghost"}
            className="w-full justify-start"
            aria-current={activeView === "settings" ? "page" : undefined}
            onClick={() => handleNavigate("settings")}
          >
            <Settings aria-hidden="true" />
            Settings
          </Button>
        </nav>
      </div>
    </header>
  )
}
