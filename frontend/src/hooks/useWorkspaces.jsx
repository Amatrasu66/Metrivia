import { createContext, useContext } from "react"

/**
 * Workspace state context object. Exported from this hook-only module (no
 * components) so the provider component can live in WorkspaceProvider.jsx
 * without tripping react-refresh's component-only export rule.
 */
export const WorkspaceContext = createContext(null)

/** Access workspaces. Must be used inside <WorkspaceProvider>. */
export function useWorkspaces() {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) {
    throw new Error("useWorkspaces must be used inside <WorkspaceProvider>")
  }
  return ctx
}
