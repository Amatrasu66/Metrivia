/**
 * Accessible labeled select following the project's input conventions
 * (border-input, focus-visible ring). Native <select> keeps full keyboard
 * support with zero extra dependencies.
 */
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
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value || null)}
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
