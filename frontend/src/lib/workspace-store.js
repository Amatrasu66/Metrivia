/**
 * Central workspace store logic (Phase C) — pure functions only.
 *
 * A workspace owns one independent dataset workflow: upload/file state,
 * analysis payload, filters, and chart configuration. Global settings
 * (theme, appearance, haptics) intentionally live elsewhere
 * (`SettingsProvider`) and are never stored here.
 *
 * Session scope: workspaces hold raw browser `File` objects, which cannot
 * be serialized — so this state is deliberately in-memory only and does not
 * survive a page reload. No localStorage, no IndexedDB (see
 * WorkspaceProvider). The reducer never throws on unknown ids: stray async
 * completions for closed workspaces are dropped by the caller checking
 * membership first (or are no-ops here).
 */

import { defaultChartConfig } from "./chart-data.js"
import { defaultFilterState } from "./filter-data.js"

export const UNTITLED_LABEL = "Untitled"

/** Fresh per-workspace workflow state (no dataset yet). */
export function initialWorkspaceState() {
  return {
    // Raw uploaded File, kept only while needed (retry after network
    // errors). Cleared on success / reset. Never serialized.
    file: null,
    fileName: null,
    fileSize: 0,
    // Dataset analysis payload from POST /api/upload (null until success).
    dataset: null,
    filters: defaultFilterState(null),
    chartConfig: defaultChartConfig(null),
    // idle | waking | wake-ready | uploading | analyzing | ready | error
    status: "idle",
    wakeStartedAt: null,
    errorTitle: "",
    errorMessage: "",
    // Whether the error state may retry the preserved File.
    canRetry: false,
    // Operator-set label override (no UI yet); null follows the file name.
    customName: null,
  }
}

function createWorkspaceWithId(id) {
  return { id, ...initialWorkspaceState() }
}

export function createInitialStoreState() {
  const first = createWorkspaceWithId("ws-1")
  return { workspaces: [first], activeId: first.id, nextId: 2 }
}

export function getActiveWorkspace(state) {
  return (
    state.workspaces.find((ws) => ws.id === state.activeId) ??
    state.workspaces[0] ??
    null
  )
}

function isValidId(state, id) {
  return state.workspaces.some((ws) => ws.id === id)
}

/**
 * Base label for a tab: custom name, uploaded filename, selected filename,
 * or Untitled — never empty.
 */
export function getWorkspaceBaseName(ws) {
  if (ws.customName != null && String(ws.customName).trim() !== "") {
    return String(ws.customName).trim()
  }
  const uploaded = ws.dataset?.filename
  if (typeof uploaded === "string" && uploaded.trim() !== "") return uploaded
  if (typeof ws.fileName === "string" && ws.fileName.trim() !== "") {
    return ws.fileName
  }
  return UNTITLED_LABEL
}

/**
 * Display labels with deterministic duplicate disambiguation in workspace
 * order: sales.csv, sales.csv (2), sales.csv (3). Returns { [id]: label }.
 */
export function getWorkspaceDisplayNames(workspaces) {
  const seen = new Map()
  const labels = {}
  for (const ws of workspaces) {
    const base = getWorkspaceBaseName(ws)
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    labels[ws.id] = count === 1 ? base : `${base} (${count})`
  }
  return labels
}

/** Reset one workspace to empty, keeping its id (used by Remove file). */
function resetOne(state, id) {
  return {
    ...state,
    workspaces: state.workspaces.map((ws) =>
      ws.id === id ? { ...createWorkspaceWithId(id) } : ws,
    ),
  }
}

/**
 * Pure reducer. Close semantics: removing the active workspace activates
 * the nearest neighbor (previous tab preferred, else next); closing the
 * final workspace yields a fresh empty one so the app never has zero.
 */
export function workspaceReducer(state, action) {
  switch (action?.type) {
    case "create": {
      const id = `ws-${state.nextId}`
      return {
        workspaces: [...state.workspaces, createWorkspaceWithId(id)],
        activeId: id,
        nextId: state.nextId + 1,
      }
    }
    case "close": {
      const { id } = action
      if (!isValidId(state, id)) return state
      if (state.workspaces.length === 1) {
        const fresh = createWorkspaceWithId(`ws-${state.nextId}`)
        return {
          workspaces: [fresh],
          activeId: fresh.id,
          nextId: state.nextId + 1,
        }
      }
      const index = state.workspaces.findIndex((ws) => ws.id === id)
      const remaining = state.workspaces.filter((ws) => ws.id !== id)
      let activeId = state.activeId
      if (state.activeId === id) {
        // Nearest neighbor: previous tab wins, else the next one (which
        // shifts into the closed tab's index).
        const prev = index - 1
        activeId =
          prev >= 0 ? remaining[prev].id : (remaining[index]?.id ?? remaining[0].id)
      }
      return { ...state, workspaces: remaining, activeId }
    }
    case "activate": {
      if (!isValidId(state, action.id)) return state
      if (state.activeId === action.id) return state
      return { ...state, activeId: action.id }
    }
    case "rename": {
      if (!isValidId(state, action.id)) return state
      const name =
        typeof action.name === "string" && action.name.trim() !== ""
          ? action.name.trim()
          : null
      return {
        ...state,
        workspaces: state.workspaces.map((ws) =>
          ws.id === action.id ? { ...ws, customName: name } : ws,
        ),
      }
    }
    case "patch": {
      if (!isValidId(state, action.id)) return state
      const patch =
        action.patch && typeof action.patch === "object" ? action.patch : {}
      // `id` is identity and must never be overwritten by a patch.
      const safePatch = { ...patch }
      delete safePatch.id
      return {
        ...state,
        workspaces: state.workspaces.map((ws) =>
          ws.id === action.id ? { ...ws, ...safePatch } : ws,
        ),
      }
    }
    case "reset-workspace": {
      if (!isValidId(state, action.id)) return state
      return resetOne(state, action.id)
    }
    default:
      return state
  }
}
