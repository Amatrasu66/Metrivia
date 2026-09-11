import { useEffect, useRef, useState } from "react"
import { AppLayout } from "@/components/layout/AppLayout"
import { UploadPage } from "@/components/landing/UploadPage"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { ApiError, uploadCsv, waitForBackendHealthy } from "@/lib/api"
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
  const [view, setView] = useState("upload")
  // idle | waking | wake-ready | uploading | analyzing | ready | error
  const [status, setStatus] = useState("idle")
  // Wall-clock moment the current backend wait started; drives the
  // progressive cold-start timer. Reset on every new upload flow.
  const [wakeStartedAt, setWakeStartedAt] = useState(null)
  const [selectedFile, setSelectedFile] = useState(null)
  // Dataset analysis payload returned by POST /api/upload (null until success).
  const [dataset, setDataset] = useState(null)
  // Global dashboard filters (reset on every upload/remove alongside dataset).
  const [filters, setFilters] = useState(() => defaultFilterState(null))
  const [errorTitle, setErrorTitle] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  // Whether the error state may retry the preserved File without reselection.
  const [canRetryUpload, setCanRetryUpload] = useState(false)
  const abortRef = useRef(null)
  const flowRef = useRef(0)
  // The actual File being uploaded, preserved across backend cold starts so
  // "Try again" never forces the user to re-choose the CSV.
  const pendingFileRef = useRef(null)

  useEffect(() => {
    return () => {
      flowRef.current += 1
      abortRef.current?.abort()
    }
  }, [])

  const handleNavigate = (nextView) => {
    setView(nextView)
    window.scrollTo({ top: 0 })
  }

  const failWith = (message, { title = UPLOAD_FAILED_TITLE, retryable = false } = {}) => {
    setDataset(null)
    setFilters(defaultFilterState(null))
    setStatus("error")
    setErrorTitle(title)
    setErrorMessage(message)
    setCanRetryUpload(retryable && pendingFileRef.current != null)
  }

  const handleFilesSelected = async (fileList) => {
    const file = fileList?.[0]
    if (!file) return

    // Cancel any in-flight upload before starting a new one.
    abortRef.current?.abort()
    flowRef.current += 1
    const flow = flowRef.current
    const controller = new AbortController()
    abortRef.current = controller
    const { signal } = controller
    const isCurrent = () => flowRef.current === flow && !signal.aborted

    // Basic client-side checks first — no network needed for these.
    if (!isCsvFileName(file.name)) {
      setSelectedFile(null)
      pendingFileRef.current = null
      failWith(
        `“${file.name}” is not a .csv file. Please choose a file ending in .csv and try again.`,
        { title: INVALID_FILE_TITLE },
      )
      return
    }
    if (file.size > MAX_CSV_BYTES) {
      setSelectedFile(null)
      pendingFileRef.current = null
      failWith(
        `“${file.name}” exceeds the 10 MB limit. Please choose a smaller CSV file.`,
        { title: INVALID_FILE_TITLE },
      )
      return
    }

    pendingFileRef.current = file
    setSelectedFile({ name: file.name, size: file.size })
    setDataset(null)
    setErrorTitle("")
    setErrorMessage("")
    setCanRetryUpload(false)
    setWakeStartedAt(Date.now())
    setStatus("uploading")

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
          if (isCurrent()) setStatus("waking")
        },
      })
      if (!isCurrent()) return
      if (didWake) {
        // Cold start that recovered: show the brief "Backend ready" beat,
        // then continue with the preserved File automatically.
        setStatus("wake-ready")
        await delay(WAKE_SUCCESS_MS, signal)
        if (!isCurrent()) return
      }
      setStatus("uploading")

      // While the upload request is pending, a slow response almost always
      // means the backend has the file and Pandas is analyzing it.
      analyzingTimer = setTimeout(() => {
        if (isCurrent()) setStatus("analyzing")
      }, ANALYZING_GRACE_MS)

      const result = await uploadCsv(file, { signal })
      if (!isCurrent()) return
      // The response has arrived: make the analyzing stage explicit while
      // the dashboard state is finalized so it can actually paint.
      setStatus("analyzing")
      await delay(ANALYZING_MIN_VISIBLE_MS, signal)
      if (!isCurrent()) return

      setDataset(result)
      setFilters(defaultFilterState(result))
      setSelectedFile({
        name: result?.filename ?? file.name,
        size: file.size,
      })
      pendingFileRef.current = null
      setCanRetryUpload(false)
      setStatus("ready")
    } catch (err) {
      // Ignore cancellations from Remove / a newer selection / unmount.
      if (!isCurrent() || err?.name === "AbortError" || signal.aborted) return
      if (err instanceof ApiError && err.isNetworkError) {
        // Cold start that never finished (or a dropped connection): keep the
        // File so "Try again" resumes without reselection.
        failWith(BACKEND_UNAVAILABLE_MESSAGE, {
          title: BACKEND_UNAVAILABLE_TITLE,
          retryable: true,
        })
        return
      }
      pendingFileRef.current = null
      setDataset(null)
      setStatus("error")
      setErrorTitle(UPLOAD_FAILED_TITLE)
      setCanRetryUpload(false)
      setErrorMessage(
        err instanceof ApiError
          ? err.message
          : "Something went wrong while uploading. Please try again.",
      )
    } finally {
      if (analyzingTimer !== null) clearTimeout(analyzingTimer)
    }
  }

  const handleRetryUpload = () => {
    const file = pendingFileRef.current
    if (!file) return
    handleFilesSelected([file])
  }

  const resetUpload = () => {
    flowRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    pendingFileRef.current = null
    setSelectedFile(null)
    setDataset(null)
    setFilters(defaultFilterState(null))
    setErrorTitle("")
    setErrorMessage("")
    setCanRetryUpload(false)
    setWakeStartedAt(null)
    setStatus("idle")
  }

  const handleContinue = () => setView("dashboard")

  return (
    <AppLayout activeView={view} onNavigate={handleNavigate}>
      {view === "upload" ? (
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
          onFiltersChange={setFilters}
          onBackToUpload={() => handleNavigate("upload")}
          onRemoveFile={resetUpload}
        />
      )}
    </AppLayout>
  )
}
