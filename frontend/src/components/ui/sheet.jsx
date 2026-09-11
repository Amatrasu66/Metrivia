import { Dialog } from "@base-ui/react/dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Right-side Sheet built on Base UI Dialog (the same primitive shadcn's
 * Sheet uses). Dialog supplies modal semantics for free: Escape closes,
 * focus is trapped while open and returned to the trigger on close, the
 * backdrop dismisses on outside press, and page scroll is locked.
 *
 * Enter/exit animations use Base UI's `data-starting-style` /
 * `data-ending-style` transition states, so no JS animation code is needed.
 */

export function Sheet({ ...props }) {
  return <Dialog.Root {...props} />
}

export function SheetTrigger({ ...props }) {
  return <Dialog.Trigger {...props} />
}

export function SheetBackdrop({ className, ...props }) {
  return (
    <Dialog.Backdrop
      data-slot="sheet-backdrop"
      className={cn(
        "fixed inset-0 z-50 bg-black/40 transition-opacity duration-300",
        "data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
        "motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  )
}

/**
 * Right-anchored panel: ~420px on desktop, nearly full-width on mobile.
 * Fixed positioning keeps it out of document flow, so the page can never
 * scroll horizontally because of the drawer.
 */
export function SheetContent({ className, children, ...props }) {
  return (
    <Dialog.Portal>
      <SheetBackdrop />
      <Dialog.Popup
        data-slot="sheet-content"
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-[min(92vw,420px)] flex-col overflow-hidden rounded-l-2xl border-l border-border bg-background shadow-xl transition-transform duration-300 ease-out",
          "data-[ending-style]:translate-x-full data-[starting-style]:translate-x-full",
          "motion-reduce:transition-none",
          className,
        )}
        {...props}
      >
        {children}
      </Dialog.Popup>
    </Dialog.Portal>
  )
}

export function SheetHeader({ className, ...props }) {
  return (
    <div
      data-slot="sheet-header"
      className={cn(
        "flex min-w-0 flex-col gap-1 border-b border-border px-5 py-4",
        className,
      )}
      {...props}
    />
  )
}

export function SheetTitle({ className, ...props }) {
  return (
    <Dialog.Title
      data-slot="sheet-title"
      className={cn("text-base leading-tight font-semibold", className)}
      {...props}
    />
  )
}

export function SheetDescription({ className, ...props }) {
  return (
    <Dialog.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

/** Independently scrollable body between the fixed header and footer. */
export function SheetBody({ className, ...props }) {
  return (
    <div
      data-slot="sheet-body"
      className={cn("min-w-0 flex-1 overflow-y-auto px-5 py-4", className)}
      {...props}
    />
  )
}

export function SheetFooter({ className, ...props }) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        "flex min-w-0 items-center justify-between gap-2 border-t border-border bg-background px-5 py-3",
        className,
      )}
      {...props}
    />
  )
}

export function SheetClose({ className, ...props }) {
  return (
    <Dialog.Close
      data-slot="sheet-close"
      aria-label="Close"
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      <X aria-hidden="true" className="size-4" />
    </Dialog.Close>
  )
}
