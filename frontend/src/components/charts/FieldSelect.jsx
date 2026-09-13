/**
 * Accessible labeled select following the project's input conventions
 * (border-input, focus-visible ring). Native <select> keeps full keyboard
 * support with zero extra dependencies.
 *
 * Haptics: a single `select()` fires only when a value is actually
 * committed. Opening the dropdown, hovering/focusing options, keyboard
 * navigation without committing, re-renders, and state initialization never
 * fire — the native `change` event plus the value-difference guard below
 * guarantee exactly one haptic per real selection.
 */
import { useMetriviaHaptics } from "@/hooks/useMetriviaHaptics"

export function FieldSelect({
  id,
  label,
  value,
  onChange,
  options,
  disabled = false,
  hint = null,
  placeholder = "Select…",
}) {
  const { select } = useMetriviaHaptics()

  const handleChange = (event) => {
    const next = event.target.value || null
    // Existing behavior is preserved verbatim: the parent always receives
    // the committed value. Only the haptic is gated on a real change.
    if (next !== (value ?? null)) {
      select()
    }
    onChange(next)
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        disabled={disabled}
        onChange={handleChange}
        className="h-10 w-full min-w-0 max-w-full truncate rounded-lg border border-input bg-background px-3 text-sm shadow-none transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p className="text-xs break-words text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}
