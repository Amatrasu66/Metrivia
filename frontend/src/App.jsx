import { useEffect, useRef, useState } from "react"
import { AppLayout } from "@/components/layout/AppLayout"
import { UploadPage } from "@/components/landing/UploadPage"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { SettingsPage } from "@/components/settings/SettingsPage"
import { SettingsProvider } from "@/hooks/SettingsProvider"
import { WorkspaceProvider } from "@/hooks/WorkspaceProvider"
import { useWorkspaces } from "@/hooks/useWorkspaces"
import { useMetriviaHaptics } from "@/hooks/useMetriviaHaptics"
import { ApiError, uploadCsv, waitForBackendHealthy } from "@/lib/api"
import { defaultChartConfig } from "@/lib/chart-data"
import { defaultFilterState } from "@/lib/filter-data"
import { MAX_CSV_BYTES, isCsvFileName } from "@/lib/format"

// Upload lifecycle. "uploading" covers the fetch to POST /api/upload;
// "analyzing" is shown only once the request has reached the backend
// (slow responses) or the response has arrived (finalizing the dashboard).
// "waking" means Render is still starting the free-tier backend, and
// "wake-ready" is the brief success beat before the upload proceeds.
const ANALYZING_GRACE_MS = 2500
const ANALYZING_MIN_VISIBLE_MS = 350
const WAKE_SUCCESS_MS = 1100

const INVALID_FILE_TITLE = "We could not accept that file"
const UPLOAD_FAILED_TITLE = "Could not process this file"
const BACKEND_UNAVAILABLE_TITLE = "Backend unavailable"
const BACKEND_UNAVAILABLE_MESSAGE =
  "We couldn't reach the analysis server. Please try again."

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(Object.assign(new Error("Aborted"), { name: "AbortError" }))
    }
    signal?.addEventListener?.("abort", onAbort, { once: true })
  })
}

export default function App() {
  return (
    <SettingsProvider>
      <WorkspaceProvider>
        <Shell />
      </WorkspaceProvider>
    </SettingsProvider>
  )
}

// Page-state navigation (no router): "upload" | "dashboard" | "settings".
// Settings is reachable from everywhere and never touches dataset state.
// The view is global (sections, not datasets); per-workspace workflow state
// (upload status, dataset, filters, chart config) lives in the workspace
// store and follows the active tab.
function Shell() {
  const [view, setView] = useState("upload")
  const {
    workspaces,
    activeId,
    activeWorkspace,
    createWorkspace,
    closeWorkspace,
    setActiveWorkspace,
    updateWorkspace,
    resetWorkspace,
  } = useWorkspaces()
  // Active workflow state (all per-workspace; Settings stays global).
  const status = activeWorkspace?.status ?? "idle"
  const wakeStartedAt = activeWorkspace?.wakeStartedAt ?? null
  const dataset = activeWorkspace?.dataset ?? null
  const filters = activeWorkspace?.filters ?? defaultFilterState(null)
  const chartConfig =
    activeWorkspace?.chartConfig ?? defaultChartConfig(null)
  const errorTitle = activeWorkspace?.errorTitle ?? ""
  const errorMessage = activeWorkspace?.errorMessage ?? ""
  // The file card shows the in-flight file, else the uploaded dataset name.
  const selectedFile = activeWorkspace?.file
    ? {
        name: activeWorkspace.file.name,
        size: activeWorkspace.file.size,
      }
    : dataset
      ? {
          name: dataset.filename,
          size: activeWorkspace?.fileSize ?? 0,
        }
      : null
  const canRetryUpload =
    activeWorkspace?.canRetry === true && activeWorkspace?.file != null
  // Single-flight upload machine: starting a new upload anywhere aborts the
  // previous one (same as before workspaces). The async flow is tagged with
  // the originating workspace id so a late response can never land in the
  // wrong workspace; results for closed workspaces are dropped safely.
  const abortRef = useRef(null)
  const flowRef = useRef(0)
  const workspacesRef = useRef(workspaces)
  useEffect(() => {
    workspacesRef.current = workspaces
  })
  const { success: hapticSuccess, error: hapticError } = useMetriviaHaptics()
  // Haptic guards: each success/error/wake-ready beat must fire exactly once
  // per event, never on re-renders. Object/key identity (not status alone)
  // is what makes the guards Strict Mode safe.
  const lastSuccessDatasetRef = useRef(null)
  const lastWakeReadyKeyRef = useRef(null)
  const lastErrorKeyRef = useRef(null)
  const prevStatusRef = useRef("idle")

  useEffect(() => {
    return () => {
      flowRef.current += 1
      abortRef.current?.abort()
    }
  }, [])

  // Workspace switches must never fire transition haptics: re-baseline the
  // guards to the newly active workspace before the firing effects below
  // run (declaration order). An upload that finished while its workspace
  // was inactive stays silent — haptics confirm the action you are viewing.
  useEffect(() => {
    prevStatusRef.current = status
    if (status === "ready" && dataset) {
      lastSuccessDatasetRef.current = dataset
    }
    if (status === "error") {
      lastErrorKeyRef.current = `${errorTitle}::${errorMessage}`
    }
    lastWakeReadyKeyRef.current = wakeStartedAt
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  // CSV analysis success: fire once per successful operation. `dataset` is a
  // fresh object per success, so identity comparison suppresses re-renders
  // and Strict Mode double-effects.
  useEffect(() => {
    if (status === "ready" && dataset && lastSuccessDatasetRef.current !== dataset) {
      lastSuccessDatasetRef.current = dataset
      hapticSuccess()
    }
  }, [status, dataset, hapticSuccess])

  // Backend cold-start recovery: `wake-ready` only exists when the flow
  // actually went through waking (immediately-available backends never enter
  // it), so firing here means a real waking → ready transition. Keyed by the
  // flow's start timestamp so polling/re-renders cannot refire it, and the
  // existing animation/timing is untouched.
  useEffect(() => {
    if (
      status === "wake-ready" &&
      lastWakeReadyKeyRef.current !== wakeStartedAt
    ) {
      lastWakeReadyKeyRef.current = wakeStartedAt
      hapticSuccess()
    }
  }, [status, wakeStartedAt, hapticSuccess])

  // User-facing errors: fire once per error event. The status-transition
  // check covers new errors; the message-key check covers consecutive errors
  // without an intermediate status change.
  useEffect(() => {
    if (status === "error") {
      const key = `${errorTitle}::${errorMessage}`
      const transitioned = prevStatusRef.current !== "error"
      if (transitioned || lastErrorKeyRef.current !== key) {
        lastErrorKeyRef.current = key
        hapticError()
      }
    }
    prevStatusRef.current = status
  }, [status, errorTitle, errorMessage, hapticError])

  const handleNavigate = (nextView) => {
    setView(nextView)
    window.scrollTo({ top: 0 })
  }

  const workspaceExists = (id) =>
    workspacesRef.current.some((ws) => ws.id === id)

  const failWith = (
    targetId,
    message,
    { title = UPLOAD_FAILED_TITLE, retryable = false } = {},
  ) => {
    if (!workspaceExists(targetId)) return
    const target = workspacesRef.current.find((ws) => ws.id === targetId)
    const keepFile = retryable && target?.file != null
    updateWorkspace(targetId, {
      dataset: null,
      filters: defaultFilterState(null),
      status: "error",
      errorTitle: title,
      errorMessage: message,
      // A retryable network error keeps the File so "Try again" resumes
      // without reselection; anything else drops it.
      file: keepFile ? target.file : null,
      fileName: keepFile ? target.fileName : null,
      fileSize: keepFile ? target.fileSize : 0,
      canRetry: keepFile,
    })
  }

  const handleFilesSelected = async (fileList) => {
    const file = fileList?.[0]
    if (!file) return
    // The upload belongs to whichever workspace is active right now, even
    // if the user switches tabs before it finishes.
    const targetId = activeId

    // Cancel any in-flight upload before starting a new one.
    abortRef.current?.abort()
    flowRef.current += 1
    const flow = flowRef.current
    const controller = new AbortController()
    abortRef.current = controller
    const { signal } = controller
    const isCurrent = () =>
      flowRef.current === flow &&
      !signal.aborted &&
      workspaceExists(targetId)

    // Basic client-side checks first — no network needed for these.
    if (!isCsvFileName(file.name)) {
      updateWorkspace(targetId, {
        file: null,
        fileName: null,
        fileSize: 0,
      })
      failWith(
        targetId,
        `“${file.name}” is not a .csv file. Please choose a file ending in .csv and try again.`,
        { title: INVALID_FILE_TITLE },
      )
      return
    }
    if (file.size > MAX_CSV_BYTES) {
      updateWorkspace(targetId, {
        file: null,
        fileName: null,
        fileSize: 0,
      })
      failWith(
        targetId,
        `“${file.name}” exceeds the 10 MB limit. Please choose a smaller CSV file.`,
        { title: INVALID_FILE_TITLE },
      )
      return
    }

    updateWorkspace(targetId, {
      file,
      fileName: file.name,
      fileSize: file.size,
      dataset: null,
      errorTitle: "",
      errorMessage: "",
      canRetry: false,
      wakeStartedAt: Date.now(),
      status: "uploading",
    })

    let analyzingTimer = null
    let didWake = false
    try {
      // Render Free may have stopped the backend after inactivity. Wait for
      // GET /api/health before sending the user's file; switch to the waking
      // state if the wait looks like a cold start.
      await waitForBackendHealthy({
        signal,
        onWaking: () => {
          didWake = true
          if (isCurrent()) updateWorkspace(targetId, { status: "waking" })
        },
      })
      if (!isCurrent()) return
      if (didWake) {
        // Cold start that recovered: show the brief "Backend ready" beat,
        // then continue with the preserved File automatically.
        updateWorkspace(targetId, { status: "wake-ready" })
        await delay(WAKE_SUCCESS_MS, signal)
        if (!isCurrent()) return
      }
      updateWorkspace(targetId, { status: "uploading" })

      // While the upload request is pending, a slow response almost always
      // means the backend has the file and Pandas is analyzing it.
      analyzingTimer = setTimeout(() => {
        if (isCurrent()) updateWorkspace(targetId, { status: "analyzing" })
      }, ANALYZING_GRACE_MS)

      const result = await uploadCsv(file, { signal })
      if (!isCurrent()) return
      // The response has arrived: make the analyzing stage explicit while
      // the dashboard state is finalized so it can actually paint.
      updateWorkspace(targetId, { status: "analyzing" })
      await delay(ANALYZING_MIN_VISIBLE_MS, signal)
      if (!isCurrent()) return

      // The result lands in the workspace that started the upload — never
      // the currently active one. Fresh filters + chart defaults match the
      // new file; the tab label follows the actual filename.
      updateWorkspace(targetId, {
        dataset: result,
        filters: defaultFilterState(result),
        chartConfig: defaultChartConfig(result),
        file: null,
        fileName: result?.filename ?? file.name,
        fileSize: file.size,
        errorTitle: "",
        errorMessage: "",
        canRetry: false,
        status: "ready",
      })
    } catch (err) {
      // Ignore cancellations from Remove / a newer selection / unmount, and
      // silently drop results for workspaces closed mid-upload.
      if (!isCurrent() || err?.name === "AbortError" || signal.aborted) return
      if (err instanceof ApiError && err.isNetworkError) {
        // Cold start that never finished (or a dropped connection): keep the
        // File so "Try again" resumes without reselection.
        failWith(targetId, BACKEND_UNAVAILABLE_MESSAGE, {
          title: BACKEND_UNAVAILABLE_TITLE,
          retryable: true,
        })
        return
      }
      updateWorkspace(targetId, {
        file: null,
        fileName: null,
        fileSize: 0,
        dataset: null,
        status: "error",
        errorTitle: UPLOAD_FAILED_TITLE,
        canRetry: false,
        errorMessage:
          err instanceof ApiError
            ? err.message
            : "Something went wrong while uploading. Please try again.",
      })
    } finally {
      if (analyzingTimer !== null) clearTimeout(analyzingTimer)
    }
  }

  const handleRetryUpload = () => {
    const file = activeWorkspace?.file
    if (!file) return
    handleFilesSelected([file])
  }

  // "Remove file" clears the ACTIVE workspace back to Untitled (aborting any
  // upload it started). Other workspaces are untouched.
  const resetUpload = () => {
    flowRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    resetWorkspace(activeId)
  }

  const handleContinue = () => setView("dashboard")

  // Workspace tab actions (the tab bar itself owns haptics + a11y).
  const handleCreateWorkspace = () => {
    createWorkspace()
    setView("upload")
    window.scrollTo({ top: 0 })
  }

  const handleSelectWorkspace = (id) => {
    setActiveWorkspace(id)
    const target = workspaces.find((ws) => ws.id === id)
    // Empty workspaces always land on Upload; workspaces with data keep the
    // current section so tab switches never yank the view away.
    if (target && !target.dataset) setView("upload")
    window.scrollTo({ top: 0 })
  }

  const handleCloseWorkspace = (id) => {
    const nextActiveId = closeWorkspace(id)
    const next =
      nextActiveId === id
        ? null
        : workspaces.find((ws) => ws.id === nextActiveId)
    // The close reducer never leaves zero workspaces; a missing entry means
    // the final tab was replaced by a fresh empty one → show Upload.
    if (!next || !next.dataset) setView("upload")
  }

  return (
    <AppLayout
      activeView={view}
      onNavigate={handleNavigate}
      onCreateWorkspace={handleCreateWorkspace}
      onSelectWorkspace={handleSelectWorkspace}
      onCloseWorkspace={handleCloseWorkspace}
    >
      {view === "settings" ? (
        <SettingsPage />
      ) : view === "upload" ? (
        <UploadPage
          status={status}
          wakeStartedAt={wakeStartedAt}
          selectedFile={selectedFile}
          dataset={dataset}
          errorTitle={errorTitle}
          errorMessage={errorMessage}
          onFilesSelected={handleFilesSelected}
          onRemove={resetUpload}
          onDismissError={resetUpload}
          onRetryUpload={canRetryUpload ? handleRetryUpload : null}
          onContinue={handleContinue}
          onViewDashboard={() => handleNavigate("dashboard")}
        />
      ) : (
        <DashboardLayout
          dataset={dataset}
          filters={filters}
          onFiltersChange={(next) =>
            updateWorkspace(activeId, { filters: next })
          }
          chartConfig={chartConfig}
          onChartConfigChange={(next) =>
            updateWorkspace(activeId, { chartConfig: next })
          }
          onBackToUpload={() => handleNavigate("upload")}
          onRemoveFile={resetUpload}
        />
      )}
    </AppLayout>
  )
}
