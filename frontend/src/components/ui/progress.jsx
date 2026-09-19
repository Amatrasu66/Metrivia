import { cn } from "@/lib/utils"

/**
 * Shadcn-style progress bar (Phase K).
 *
 * Visual port of the supplied Radix/shadcn `Progress` component, without
 * adding a Radix dependency: the installed project uses `@base-ui/react`
 * and plain Tailwind tokens, so a lightweight native `role="progressbar"`
 * div pair keeps the bundle unchanged while preserving the supplied
 * look (`h-1.5`, `rounded-full`, `bg-secondary` track, `bg-primary` fill).
 *
 * Why not `transition-all`: the repo `ui:audit` (U6) forbids
 * `transition-all` / `transition: all` — the supplied snippet's
 * `transition-all` would fail the audit. We use
 * `transition-[transform]` (transform-only) which is paint-cheap and
 * audit-clean. Reduced-motion users get no transition (see caller).
 */
export function Progress({ className, indicatorClassName, value, ...props }) {
  const safeValue = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0
  const reduceMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(safeValue)}
      data-slot="progress"
      data-state={safeValue >= 100 ? "complete" : safeValue <= 0 ? "empty" : "loading"}
      data-value={Math.round(safeValue)}
      className={cn(
        "relative h-1.5 w-full overflow-hidden rounded-full bg-secondary",
        className,
      )}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className={cn(
          "h-full w-full flex-1 bg-primary",
          reduceMotion ? "" : "transition-[transform] duration-300 ease-out",
          indicatorClassName,
        )}
        style={{ transform: `translateX(-${100 - safeValue}%)` }}
      />
    </div>
  )
}

export default Progress
