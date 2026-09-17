/**
 * Labeled intensity slider built on a native range input: free keyboard
 * support, screen-reader value announcement, and a large touch target.
 * Deliberately fires no haptics while dragging (no vibration storms).
 */
export function HapticSlider({
  id,
  label,
  hint,
  value,
  onChange,
  disabled = false,
}) {
  const percent = Math.round(value * 100)
  const hintId = hint ? `${id}-hint` : undefined

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={id}
          className="min-w-0 truncate text-sm font-medium text-foreground"
        >
          {label}
        </label>
        <output
          htmlFor={id}
          aria-label={`${label} ${percent} percent`}
          className="shrink-0 text-sm font-semibold text-foreground tabular-nums"
        >
          {percent}%
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={percent}
        disabled={disabled}
        aria-describedby={hintId}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        className="h-8 w-full cursor-pointer touch-pan-y accent-primary disabled:cursor-not-allowed disabled:opacity-40"
      />
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}
