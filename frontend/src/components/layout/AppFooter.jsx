export function AppFooter() {
  return (
    <footer className="w-full border-t border-border bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="min-w-0">
          <span className="font-medium text-foreground">Metrivia</span> —
          responsive CSV visualization shell.
        </p>
        <p className="shrink-0 text-xs sm:text-sm">
          Upload stays local · No parsing yet · Backend arrives later
        </p>
      </div>
    </footer>
  )
}
