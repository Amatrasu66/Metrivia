/**
 * Miniature live preview of a theme, rendered from the registry's actual
 * token values (never a fake palette). Shows the light variant on the left
 * and the dark variant on the right so one glance covers both appearances.
 */
export function ThemePreview({ theme }) {
  return (
    <span
      aria-hidden="true"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border"
    >
      <PreviewPane tokens={theme.light} />
      <PreviewPane tokens={theme.dark} />
    </span>
  )
}

function PreviewPane({ tokens }) {
  const bars = [
    tokens["--chart-1"],
    tokens["--chart-2"],
    tokens["--chart-3"],
    tokens["--chart-4"],
    tokens["--chart-5"],
  ]
  return (
    <span
      className="flex flex-col gap-1.5 p-2"
      style={{ backgroundColor: tokens["--background"] }}
    >
      <span
        className="truncate text-[11px] leading-none font-semibold"
        style={{ color: tokens["--foreground"] }}
      >
        Ag
      </span>
      <span
        className="inline-flex h-4 w-14 items-center justify-center rounded-full text-[9px] leading-none font-semibold"
        style={{
          backgroundColor: tokens["--primary"],
          color: tokens["--primary-foreground"],
        }}
      >
        Aa
      </span>
      <span className="flex h-6 items-end gap-0.5">
        {bars.map((color, i) => (
          <span
            key={i}
            className="w-full rounded-[1px]"
            style={{
              backgroundColor: color,
              height: `${35 + ((i * 37) % 65)}%`,
            }}
          />
        ))}
      </span>
    </span>
  )
}
