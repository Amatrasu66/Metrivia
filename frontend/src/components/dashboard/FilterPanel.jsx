import { RotateCcw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { activeFilterCount, isFieldActive } from "@/lib/filter-data"

const INPUT_CLASS =
  "h-10 w-full min-w-0 max-w-full rounded-lg border border-input bg-background px-3 text-sm shadow-none transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring"

const CHECKBOX_CLASS = "size-4 shrink-0 accent-primary"

function safeId(column, suffix) {
  return `filter-${String(column).replace(/[^a-zA-Z0-9_-]/g, "-")}-${suffix}`
}

function CategoricalGroup({ field, selected, onToggle }) {
  const values = Array.isArray(field.values) ? field.values : []
  return (
    <fieldset className="min-w-0">
      <legend className="flex items-center gap-1.5 px-0 text-xs font-medium text-muted-foreground">
        <span className="truncate">{field.column}</span>
        {selected.length > 0 ? (
          <Badge variant="secondary">{selected.length}</Badge>
        ) : null}
      </legend>
      <div className="mt-1.5 flex max-h-40 min-w-0 flex-col gap-1 overflow-y-auto rounded-lg border border-border px-2.5 py-2">
        {values.length === 0 ? (
          <p className="text-xs text-muted-foreground">No values found.</p>
        ) : (
          values.map((value) => {
            const id = safeId(field.column, value)
            const checked = selected.includes(value)
            return (
              <label
                key={value}
                htmlFor={id}
                className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent"
              >
                <input
                  id={id}
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(field.column, value)}
                  className={CHECKBOX_CLASS}
                />
                <span className="min-w-0 flex-1 truncate">{value}</span>
              </label>
            )
          })
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {selected.length === 0
          ? "All values included."
          : "Matching any selected value."}
      </p>
    </fieldset>
  )
}

function DatetimeGroup({ field, bounds, onBounds }) {
  return (
    <fieldset className="min-w-0">
      <legend className="px-0 text-xs font-medium text-muted-foreground">
        {field.column}
      </legend>
      <div className="mt-1.5 grid min-w-0 grid-cols-2 gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <label
            htmlFor={safeId(field.column, "from")}
            className="text-xs text-muted-foreground"
          >
            From
          </label>
          <input
            id={safeId(field.column, "from")}
            type="date"
            value={bounds.from}
            onChange={(event) =>
              onBounds(field.column, { ...bounds, from: event.target.value })
            }
            className={INPUT_CLASS}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label
            htmlFor={safeId(field.column, "to")}
            className="text-xs text-muted-foreground"
          >
            To
          </label>
          <input
            id={safeId(field.column, "to")}
            type="date"
            value={bounds.to}
            min={bounds.from || undefined}
            onChange={(event) =>
              onBounds(field.column, { ...bounds, to: event.target.value })
            }
            className={INPUT_CLASS}
          />
        </div>
      </div>
    </fieldset>
  )
}

function NumericGroup({ field, bounds, onBounds }) {
  return (
    <fieldset className="min-w-0">
      <legend className="px-0 text-xs font-medium text-muted-foreground">
        {field.column}
      </legend>
      <div className="mt-1.5 grid min-w-0 grid-cols-2 gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <label
            htmlFor={safeId(field.column, "min")}
            className="text-xs text-muted-foreground"
          >
            Min
          </label>
          <input
            id={safeId(field.column, "min")}
            type="number"
            inputMode="decimal"
            placeholder="No min"
            value={bounds.min}
            onChange={(event) =>
              onBounds(field.column, { ...bounds, min: event.target.value })
            }
            className={INPUT_CLASS}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label
            htmlFor={safeId(field.column, "max")}
            className="text-xs text-muted-foreground"
          >
            Max
          </label>
          <input
            id={safeId(field.column, "max")}
            type="number"
            inputMode="decimal"
            placeholder="No max"
            value={bounds.max}
            onChange={(event) =>
              onBounds(field.column, { ...bounds, max: event.target.value })
            }
            className={INPUT_CLASS}
          />
        </div>
      </div>
    </fieldset>
  )
}

/**
 * Reusable dashboard filter area. Controlled via `filters` state owned by
 * the parent; all filtering math lives in `@/lib/filter-data`.
 */
export function FilterPanel({ fields, filters, onChange, onReset }) {
  const count = activeFilterCount(filters)

  const toggleValue = (column, value) => {
    const selected = filters.categorical[column] ?? []
    onChange({
      ...filters,
      categorical: {
        ...filters.categorical,
        [column]: selected.includes(value)
          ? selected.filter((v) => v !== value)
          : [...selected, value],
      },
    })
  }

  const setBounds = (kind, column, next) => {
    onChange({
      ...filters,
      [kind]: { ...filters[kind], [column]: next },
    })
  }

  return (
    <Card className="min-w-0 border-border/70 bg-muted/20">
      <CardHeader>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <CardTitle>Filters</CardTitle>
            <Badge variant={count > 0 ? "default" : "secondary"}>
              {count > 0 ? `${count} active` : "All rows"}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={count === 0}
          >
            <RotateCcw aria-hidden="true" />
            Clear filters
          </Button>
        </div>
        <CardDescription>
          Filter the uploaded dataset — KPIs, preview, and chart update
          instantly. Nothing is sent back to the backend.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {fields.map((field) => (
            <div
              key={field.column}
              className={
                isFieldActive(filters, field)
                  ? "min-w-0 rounded-lg ring-1 ring-ring"
                  : "min-w-0"
              }
            >
              {field.kind === "categorical" ? (
                <CategoricalGroup
                  field={field}
                  selected={filters.categorical[field.column] ?? []}
                  onToggle={toggleValue}
                />
              ) : field.kind === "datetime" ? (
                <DatetimeGroup
                  field={field}
                  bounds={
                    filters.datetime[field.column] ?? { from: "", to: "" }
                  }
                  onBounds={(column, next) => setBounds("datetime", column, next)}
                />
              ) : (
                <NumericGroup
                  field={field}
                  bounds={filters.numeric[field.column] ?? { min: "", max: "" }}
                  onBounds={(column, next) => setBounds("numeric", column, next)}
                />
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
