import { RotateCcw } from "lucide-react"
import { FilterPanelContent } from "@/components/dashboard/FilterPanel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { activeFilterCount } from "@/lib/filter-data"
import { IosHapticSwitch } from "@/components/haptics/IosHapticSwitch"
import { useMetriviaHaptics } from "@/hooks/useMetriviaHaptics"
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetDescription,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

/**
 * Right-side filter drawer. A presentation layer only: filter state stays
 * with the parent and every control updates it instantly (no Apply step —
 * "Done" merely closes the drawer). KPIs, preview, and charts react to the
 * same state as before.
 */
export function FilterSheet({
  open,
  onOpenChange,
  fields,
  filters,
  onChange,
  onReset,
}) {
  const count = activeFilterCount(filters)
  const { tap } = useMetriviaHaptics()

  const handleReset = () => {
    tap()
    onReset()
  }

  const handleDone = () => {
    tap()
    onOpenChange(false)
  }

  const handleClose = () => {
    tap()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader className="flex-row items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>
              Refine your dataset — KPIs, charts, and preview update
              instantly.
            </SheetDescription>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <Badge variant={count > 0 ? "default" : "secondary"}>
                {count > 0 ? `${count} active` : "All rows"}
              </Badge>
              {count > 0 ? (
                <button
                  type="button"
                  onClick={handleReset}
                  className="relative rounded-md text-xs font-medium text-muted-foreground underline-offset-4 transition-colors outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Clear all
                  {/* iOS direct-touch haptic over this button's exact
                      bounds. Null on Android/desktop. */}
                  <IosHapticSwitch onActivate={handleReset} />
                </button>
              ) : null}
            </div>
          </div>
          <SheetClose onClick={handleClose} />
        </SheetHeader>

        <SheetBody>
          <FilterPanelContent
            fields={fields}
            filters={filters}
            onChange={onChange}
          />
        </SheetBody>

        <SheetFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={count === 0}
          >
            <RotateCcw aria-hidden="true" />
            Clear all
          </Button>
          <Button size="sm" onClick={handleDone}>
            Done
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
