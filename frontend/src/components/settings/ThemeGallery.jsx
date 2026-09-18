import { Search, X } from "lucide-react"
import { useMemo, useState } from "react"
import { getFeaturedThemes, getThemesByCategory, searchThemes } from "@/lib/themes"
import { Button } from "@/components/ui/button"
import { ThemeCard } from "@/components/settings/ThemeCard"

/**
 * Theme gallery (Phase D): search + featured rail + category sections over
 * the centralized registry. Selecting a theme calls `onSelectTheme(id)`;
 * the parent owns persistence + haptics (reselect stays silent there).
 *
 * - Search filters name, description, category, and keywords
 *   (case-insensitive); empty results show a clear action.
 * - Cards render in a responsive grid (1 → 2 → 3 columns) with no
 *   page-wide horizontal overflow.
 */
export function ThemeGallery({ activeThemeId, onSelectTheme }) {
  const [query, setQuery] = useState("")
  const trimmed = query.trim()
  const searching = trimmed !== ""

  const results = useMemo(() => searchThemes(trimmed), [trimmed])
  const featured = useMemo(() => getFeaturedThemes(), [])
  const groups = useMemo(() => getThemesByCategory(), [])

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="relative min-w-0 sm:max-w-sm">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <label htmlFor="theme-search" className="sr-only">
          Search themes
        </label>
        <input
          id="theme-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search themes..."
          autoComplete="off"
          className="h-10 w-full rounded-lg border border-input bg-background pr-9 pl-9 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
        />
        {searching && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery("")}
            className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent/60 hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>

      {searching ? (
        <ThemeSection
          title={`Results for “${trimmed}”`}
          blurb={`${results.length} of ${searchThemes("").length} themes`}
          themes={results}
          activeThemeId={activeThemeId}
          onSelectTheme={onSelectTheme}
          empty={
            <div className="flex min-w-0 flex-col items-start gap-2 rounded-xl border border-dashed border-border px-4 py-6">
              <p className="text-sm font-medium text-foreground">
                No themes found
              </p>
              <p className="text-xs text-muted-foreground">
                Try a different name, color, or style.
              </p>
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setQuery("")}
              >
                Clear search
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <ThemeSection
            title="Featured"
            blurb="Polished starting points, including the default."
            themes={featured}
            activeThemeId={activeThemeId}
            onSelectTheme={onSelectTheme}
          />
          {groups.map((group) => (
            <ThemeSection
              key={group.id}
              title={group.label}
              blurb={group.blurb}
              themes={group.themes}
              activeThemeId={activeThemeId}
              onSelectTheme={onSelectTheme}
            />
          ))}
        </>
      )}
    </div>
  )
}

function ThemeSection({ title, blurb, themes, activeThemeId, onSelectTheme, empty = null }) {
  return (
    <section aria-label={`${title} themes`} className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {blurb ? (
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            {blurb}
          </p>
        ) : null}
      </div>
      {themes.length === 0 ? (
        empty
      ) : (
        <div
          role="group"
          aria-label={`${title} themes`}
          className="grid min-w-0 grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3"
        >
          {themes.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              selected={theme.id === activeThemeId}
              onSelect={() => onSelectTheme(theme.id)}
            />
          ))}
        </div>
      )}
    </section>
  )
}
