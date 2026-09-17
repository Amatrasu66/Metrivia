import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { ThemePreview } from "@/components/settings/ThemePreview"

/**
 * Selectable theme card. A real <button> (keyboard accessible by default);
 * the selected card exposes aria-pressed + a visible check badge.
 */
export function ThemeCard({ theme, selected, onSelect }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${theme.name} theme${selected ? " (selected)" : ""}`}
      onClick={onSelect}
      className={cn(
        "group flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-2.5 text-left transition-colors outline-none",
        "hover:border-primary/60 hover:bg-accent/40",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        selected
          ? "border-primary ring-1 ring-primary"
          : "border-border",
      )}
    >
      <span className="relative block">
        <ThemePreview theme={theme} />
        {selected && (
          <span
            aria-hidden="true"
            className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm"
          >
            <Check className="size-3" strokeWidth={3} />
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 px-0.5 pb-0.5">
        <span className="truncate text-sm font-semibold text-foreground">
          {theme.name}
        </span>
        <span className="flex items-center gap-1.5">
          <Swatch color={theme.light["--primary"]} />
          <Swatch color={theme.light["--accent"]} />
          <Swatch color={theme.dark["--primary"]} />
          <span className="truncate text-xs text-muted-foreground">
            {theme.id === "mocha-mousse" ? "Default" : "Tweaks CN"}
          </span>
        </span>
      </span>
    </button>
  )
}

function Swatch({ color }) {
  return (
    <span
      aria-hidden="true"
      className="size-3 shrink-0 rounded-full border border-black/10 dark:border-white/20"
      style={{ backgroundColor: color }}
    />
  )
}
