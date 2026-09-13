import { BarChart3, Menu, X } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { useMetriviaHaptics } from "@/hooks/useMetriviaHaptics"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme/ThemeToggle"

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

export function AppHeader({ activeView, onNavigate }) {
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
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <BrandMark />

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => (
            <Button
              key={item.id}
              variant={activeView === item.id ? "secondary" : "ghost"}
              size="sm"
              aria-current={activeView === item.id ? "page" : undefined}
              onClick={() => handleNavigate(item.id)}
            >
              {item.label}
            </Button>
          ))}
          <Badge variant="outline" className="ml-2 hidden lg:inline-flex">
            Frontend shell
          </Badge>
          <span className="ml-1">
            <ThemeToggle />
          </span>
        </nav>

        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <Button
            variant="outline"
            size="icon"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={handleMenuToggle}
          >
            {menuOpen ? <X /> : <Menu />}
          </Button>
        </div>
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
        </nav>
      </div>
    </header>
  )
}
