import { Menu } from "@base-ui/react/menu"
import { Check, ChevronDown, Plus, X } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { IosHapticSwitch } from "@/components/haptics/IosHapticSwitch"
import { Button } from "@/components/ui/button"
import { useMetriviaHaptics } from "@/hooks/useMetriviaHaptics"
import { useWorkspaces } from "@/hooks/useWorkspaces"

/**
 * Compact workspace selector (Phase E): a dropdown over the EXISTING
 * workspace store — no second state system. Replaces the old full-width tab
 * strip and its standalone `+` tab.
 *
 * - Trigger shows the active workspace name (truncated, full name in title).
 * - Menu lists every open workspace with the active one checked; each row
 *   has its own close button that cannot trigger a switch (stopPropagation
 *   + explicit menu close; selection and close are sibling controls).
 * - "New workspace" item creates + activates (the caller navigates).
 * - Haptics use the existing semantic layer only: `select()` for switches,
 *   `tap()` for create/close. iOS ticks come from narrow native switches
 *   inside each row (never a menu-wide overlay). No haptics on hover,
 *   scroll, or open/close of the menu itself.
 * - Motion is limited to the popup's opacity/scale entrance via Base UI's
 *   data-attribute states (transform + opacity only, ~120 ms, disabled
 *   under reduced motion). No layout animation, no per-row animation.
 */
export function WorkspaceSelector({ onCreate, onSelect, onClose }) {
  const { workspaces, activeId, displayNames } = useWorkspaces()
  const { tap, select } = useMetriviaHaptics()
  const [open, setOpen] = useState(false)

  const activeLabel = displayNames[activeId] ?? "Workspace"

  const handleSelect = (id) => {
    if (id === activeId) {
      setOpen(false)
      return
    }
    select()
    setOpen(false)
    onSelect?.(id)
  }

  const handleClose = (event, id) => {
    // Sibling control: closing must never also select the row.
    event.stopPropagation()
    event.preventDefault()
    tap()
    setOpen(false)
    onClose?.(id)
  }

  const handleCreate = () => {
    tap()
    setOpen(false)
    onCreate?.()
  }

  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger
        render={
          <Button
            variant="outline"
            type="button"
            aria-label={`Workspace: ${activeLabel}. Open workspace menu.`}
            title={activeLabel}
            className="h-9 min-w-0 max-w-40 justify-between gap-1.5 px-2.5 sm:max-w-52"
          />
        }
      >
        <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">
          {activeLabel}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          sideOffset={6}
          align="start"
          className="z-50 outline-none"
        >
          <Menu.Popup
            aria-label="Workspaces"
            className={cn(
              "flex max-h-[min(24rem,70svh)] w-64 min-w-0 origin-top-left flex-col overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none",
              "transition-[opacity,scale] duration-150 ease-out",
              "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
              "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
              "motion-reduce:transition-none",
            )}
          >
            <div
              role="group"
              aria-label="Open workspaces"
              className="flex min-w-0 min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto"
            >
              {workspaces.map((ws) => {
                const label = displayNames[ws.id] ?? ws.id
                const isActive = ws.id === activeId
                return (
                  <div
                    key={ws.id}
                    className="flex min-w-0 items-center gap-0.5"
                  >
                    <Menu.Item
                      closeOnClick={false}
                      onClick={() => handleSelect(ws.id)}
                      aria-current={isActive ? "true" : undefined}
                      className={cn(
                        "relative flex h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-sm outline-none select-none",
                        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
                        "focus-visible:ring-2 focus-visible:ring-ring",
                        isActive
                          ? "font-semibold text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      <span
                        className="min-w-0 flex-1 truncate text-left"
                        title={label}
                      >
                        {label}
                      </span>
                      {isActive && (
                        <Check
                          aria-hidden="true"
                          className="size-4 shrink-0 text-primary"
                          strokeWidth={3}
                        />
                      )}
                      {/* iOS only: narrow direct-touch tick for switches.
                          Scoped to the row so the sibling close button stays
                          directly tappable. Null on Android/desktop. */}
                      {isActive ? null : (
                        <IosHapticSwitch
                          onActivate={() => handleSelect(ws.id)}
                        />
                      )}
                    </Menu.Item>
                    <button
                      type="button"
                      aria-label={`Close ${label}`}
                      title={`Close ${label}`}
                      onClick={(event) => handleClose(event, ws.id)}
                      className={cn(
                        "relative flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none",
                        "hover:bg-accent/60 hover:text-accent-foreground",
                        "focus-visible:ring-2 focus-visible:ring-ring",
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
            <Menu.Separator className="mx-1 my-1 h-px shrink-0 bg-border" />
            <Menu.Item
              onClick={handleCreate}
              className={cn(
                "flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-foreground outline-none select-none",
                "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
                "focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <Plus aria-hidden="true" className="size-4 shrink-0" />
              New workspace
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
