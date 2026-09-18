import { AppHeader } from "@/components/layout/AppHeader"

export function AppLayout({
  activeView,
  onNavigate,
  onCreateWorkspace,
  onSelectWorkspace,
  onCloseWorkspace,
  children,
}) {
  return (
    <div className="flex min-h-svh w-full max-w-full flex-col overflow-x-clip bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <AppHeader
        activeView={activeView}
        onNavigate={onNavigate}
        onCreateWorkspace={onCreateWorkspace}
        onSelectWorkspace={onSelectWorkspace}
        onCloseWorkspace={onCloseWorkspace}
      />
      <main id="main-content" className="w-full max-w-full flex-1">
        {children}
      </main>
    </div>
  )
}
