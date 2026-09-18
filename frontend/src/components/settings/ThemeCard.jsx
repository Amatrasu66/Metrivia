import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { IosHapticSwitch } from "@/components/haptics/IosHapticSwitch"
import { ThemePreview } from "@/components/settings/ThemePreview"

/**
 * Selectable theme card. A real <button> (keyboard accessible by default);
 * the selected card exposes aria-pressed + a visible check badge.
 *
 * Content is product-facing only: token-derived preview, human-readable
 * name, short description, and the theme's actual chart palette as dots.
 * No source-library labels, no token names.
 *
 * Haptics: Android fires through `onSelect` (the Settings handler calls
 * the semantic `tap()`). On iOS the programmatic path is silent by design,
 * so a direct-touch native switch covers this card's exact bounds — but
 * only while the theme is NOT active: re-tapping the selected card stays
 * silent, the action still runs exactly once (the switch stops the bubbled
 * click), and keyboard/AT users keep the plain button path.
 */
export function ThemeCard({ theme, selected, onSelect }) {
  const chartDots = [
    theme.light["--chart-1"],
    theme.light["--chart-2"],
    theme.light["--chart-3"],
    theme.light["--chart-4"],
    theme.light["--chart-5"],
  ]
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${theme.name} theme${selected ? " (selected)" : ""}. ${theme.description ?? ""}`}
      onClick={onSelect}
      className={cn(
        "group relative flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-2.5 text-left transition-colors outline-none",
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
      <span className="flex min-w-0 flex-col gap-1 px-0.5 pb-0.5">
        <span className="flex min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-semibold text-foreground">
            {theme.name}
          </span>
          {selected && (
            <Check
              aria-hidden="true"
              className="size-4 shrink-0 text-primary"
              strokeWidth={3}
            />
          )}
        </span>
        {theme.description ? (
          <span className="line-clamp-2 min-h-8 text-xs break-words text-muted-foreground">
            {theme.description}
          </span>
        ) : null}
        <span className="flex items-center gap-1.5 pt-0.5" aria-hidden="true">
          {chartDots.map((color, index) => (
            <PaletteDot key={index} color={color} />
          ))}
        </span>
      </span>
      {/* iOS only: direct-touch native tick for real theme changes.
          Rendered only on inactive cards so re-selecting the active theme
          stays silent. Null on Android/desktop. */}
      {selected ? null : <IosHapticSwitch onActivate={onSelect} />}
    </button>
  )
}

function PaletteDot({ color }) {
  return (
    <span
      aria-hidden="true"
      className="size-3 shrink-0 rounded-full border border-black/10 dark:border-white/20"
      style={{ backgroundColor: color }}
    />
  )
}
