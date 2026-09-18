import { Plus, X } from "lucide-react"
import { useRef } from "react"
import { cn } from "@/lib/utils"
import { IosHapticSwitch } from "@/components/haptics/IosHapticSwitch"
import { Button } from "@/components/ui/button"
import { useMetriviaHaptics } from "@/hooks/useMetriviaHaptics"
import { useWorkspaces } from "@/hooks/useWorkspaces"

/**
 * Chrome-like workspace tab bar (Phase C): one tab per in-session dataset
 * workflow, plus a `+` control for a fresh workspace.
 *
 * - Tabs are application-level workspaces (datasets); the header nav
 *   (Upload / Dashboard / Settings) is untouched and keeps working.
 * - Haptics use the existing semantic layer only: `select()` for switching,
 *   `tap()` for create/close. iOS ticks come from narrow native switches
 *   inside each tab button and the close buttons (never a strip-wide
 *   overlay — the close controls stay directly tappable). No haptics on
 *   hover/scroll, no direct `navigator.vibrate()` calls.
 * - Keyboard: tabs and close buttons are plain buttons (Tab/Enter/Space
 *   work natively); ArrowLeft/ArrowRight/Home/End move focus between tabs
 *   with automatic activation, matching the tabstrip convention.
 * - Mobile: the strip scrolls horizontally on its own; the `+` control is
 *   pinned at the trailing edge. Touch targets stay ≥ 40 px tall.
 */
export function WorkspaceTabs({ onCreate, onSelect, onClose }) {
  const { workspaces, activeId, displayNames } = useWorkspaces()
  const { tap, select } = useMetriviaHaptics()
  const listRef = useRef(null)

  const focusTab = (index) => {
    const tabs =
      listRef.current?.querySelectorAll?.('[role="tab"]') ?? []
    const clamped = Math.max(0, Math.min(tabs.length - 1, index))
    const node = tabs[clamped]
    if (node) {
      node.focus()
      if (typeof onSelect === "function") {
        const id = node.getAttribute("data-workspace-id")
        if (id) {
          select()
          onSelect(id)
        }
      }
    }
  }

  const handleTabListKeyDown = (event) => {
    const tabs = listRef.current?.querySelectorAll?.('[role="tab"]') ?? []
    if (tabs.length === 0) return
    const current = Array.prototype.indexOf.call(
      tabs,
      document.activeElement,
    )
    if (current === -1) return
    if (event.key === "ArrowRight") {
      event.preventDefault()
      focusTab((current + 1) % tabs.length)
    } else if (event.key === "ArrowLeft") {
      event.preventDefault()
      focusTab((current - 1 + tabs.length) % tabs.length)
    } else if (event.key === "Home") {
      event.preventDefault()
      focusTab(0)
    } else if (event.key === "End") {
      event.preventDefault()
      focusTab(tabs.length - 1)
    }
  }

  const handleSelect = (id) => {
    if (id === activeId) return
    select()
    onSelect?.(id)
  }

  const handleClose = (event, id) => {
    // The close button sits next to (never inside) the tab button, but stop
    // propagation anyway so closing can never also activate the tab.
    event.stopPropagation()
    tap()
    onClose?.(id)
  }

  const handleCreate = () => {
    tap()
    onCreate?.()
  }

  return (
    <div className="w-full border-b border-border bg-background">
      <div className="mx-auto flex w-full max-w-7xl items-stretch gap-1 px-4 sm:px-6">
        <div
          ref={listRef}
          role="tablist"
          aria-label="Workspaces"
          onKeyDown={handleTabListKeyDown}
          className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto py-1.5"
        >
          {workspaces.map((ws) => {
            const label = displayNames[ws.id] ?? ws.id
            const isActive = ws.id === activeId
            return (
              <div
                key={ws.id}
                role="presentation"
                className="flex min-w-0 shrink-0 items-stretch"
              >
                <button
                  type="button"
                  role="tab"
                  data-workspace-id={ws.id}
                  aria-selected={isActive}
                  aria-label={`${label} workspace`}
                  title={label}
                  onClick={() => handleSelect(ws.id)}
                  className={cn(
                    "relative flex min-h-10 min-w-0 max-w-44 flex-1 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors outline-none",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    isActive
                      ? "border-border bg-secondary text-secondary-foreground"
                      : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-left">
                    {label}
                  </span>
                  {/* iOS only: narrow direct-touch tick for tab selection.
                      Null on Android/desktop (which uses select() above).
                      Scoped to this tab button so the sibling close button
                      stays directly tappable. */}
                  <IosHapticSwitch
                    onActivate={() => handleSelect(ws.id)}
                  />
                </button>
                <button
                  type="button"
                  aria-label={`Close ${label}`}
                  title={`Close ${label}`}
                  onClick={(event) => handleClose(event, ws.id)}
                  className={cn(
                    "relative ml-0.5 flex min-h-10 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none",
                    "hover:bg-accent/60 hover:text-accent-foreground",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  )}
                >
                  <X aria-hidden="true" className="size-4" />
                  <IosHapticSwitch
                    onActivate={(event) => handleClose(event, ws.id)}
                  />
                </button>
              </div>
            )
          })}
        </div>
        <div className="sticky right-0 flex shrink-0 items-center bg-background py-1.5 pl-1">
          <Button
            variant="ghost"
            size="icon"
            type="button"
            aria-label="Create new workspace"
            title="Create new workspace"
            onClick={handleCreate}
            className="min-h-10 min-w-10"
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  )
}
