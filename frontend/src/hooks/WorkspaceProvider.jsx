import { useCallback, useMemo, useReducer } from "react"
import {
  createInitialStoreState,
  getActiveWorkspace,
  getWorkspaceDisplayNames,
  workspaceReducer,
} from "@/lib/workspace-store"
import { WorkspaceContext } from "@/hooks/useWorkspaces"

/**
 * Workspace provider: multiple independent in-session dataset workflows.
 *
 * - State lives here (React Context + reducer, in-memory only). No state
 *   library, no persistence: workspace objects hold raw `File` instances,
 *   which cannot go to localStorage — a reload intentionally starts fresh
 *   with one Untitled workspace.
 * - Global settings (theme, appearance, haptics) stay in SettingsProvider
 *   and apply across every workspace.
 * - `closeWorkspace` returns the id that becomes active so callers (tab
 *   bar, App) can sync navigation deterministically from pre-close state.
 */
export function WorkspaceProvider({ children }) {
  const [state, dispatch] = useReducer(
    workspaceReducer,
    undefined,
    createInitialStoreState,
  )

  const createWorkspace = useCallback(() => {
    const id = `ws-${state.nextId}`
    dispatch({ type: "create" })
    return id
  }, [state.nextId])

  const closeWorkspace = useCallback(
    (id) => {
      const target = state.workspaces.find((ws) => ws.id === id)
      if (!target) return state.activeId
      if (state.workspaces.length === 1) {
        const freshId = `ws-${state.nextId}`
        dispatch({ type: "close", id })
        return freshId
      }
      let nextActive = state.activeId
      if (state.activeId === id) {
        const index = state.workspaces.findIndex((ws) => ws.id === id)
        const remaining = state.workspaces.filter((ws) => ws.id !== id)
        const prev = index - 1
        nextActive =
          prev >= 0
            ? remaining[prev].id
            : (remaining[index]?.id ?? remaining[0].id)
      }
      dispatch({ type: "close", id })
      return nextActive
    },
    [state],
  )

  const setActiveWorkspace = useCallback((id) => {
    dispatch({ type: "activate", id })
  }, [])

  const renameWorkspace = useCallback((id, name) => {
    dispatch({ type: "rename", id, name })
  }, [])

  const updateWorkspace = useCallback((id, patch) => {
    dispatch({ type: "patch", id, patch })
  }, [])

  const resetWorkspace = useCallback((id) => {
    dispatch({ type: "reset-workspace", id })
  }, [])

  const value = useMemo(() => {
    const activeWorkspace = getActiveWorkspace(state)
    return {
      workspaces: state.workspaces,
      activeId: state.activeId,
      activeWorkspace,
      displayNames: getWorkspaceDisplayNames(state.workspaces),
      createWorkspace,
      closeWorkspace,
      setActiveWorkspace,
      renameWorkspace,
      updateWorkspace,
      resetWorkspace,
    }
  }, [
    state,
    createWorkspace,
    closeWorkspace,
    setActiveWorkspace,
    renameWorkspace,
    updateWorkspace,
    resetWorkspace,
  ])

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}
