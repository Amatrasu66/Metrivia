import { useEffect, useRef, useState } from "react"
import { AppLayout } from "@/components/layout/AppLayout"
import { UploadPage } from "@/components/landing/UploadPage"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { ApiError, uploadCsv } from "@/lib/api"
import { defaultFilterState } from "@/lib/filter-data"
import { MAX_CSV_BYTES, isCsvFileName } from "@/lib/format"

export default function App() {
  const [view, setView] = useState("upload")
  // idle | loading | ready | error
  const [status, setStatus] = useState("idle")
  const [selectedFile, setSelectedFile] = useState(null)
  // Dataset analysis payload returned by POST /api/upload (null until success).
  const [dataset, setDataset] = useState(null)
  // Global dashboard filters (reset on every upload/remove alongside dataset).
  const [filters, setFilters] = useState(() => defaultFilterState(null))
  const [errorMessage, setErrorMessage] = useState("")
  const abortRef = useRef(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const handleNavigate = (nextView) => {
    setView(nextView)
    window.scrollTo({ top: 0 })
  }

  const failWith = (message) => {
    setDataset(null)
    setFilters(defaultFilterState(null))
    setStatus("error")
    setErrorMessage(message)
  }

  const handleFilesSelected = async (fileList) => {
    const file = fileList?.[0]
    if (!file) return

    // Cancel any in-flight upload before starting a new one.
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    // Basic client-side checks first — no network needed for these.
    if (!isCsvFileName(file.name)) {
      setSelectedFile(null)
      failWith(
        `“${file.name}” is not a .csv file. Please choose a file ending in .csv and try again.`,
      )
      return
    }
    if (file.size > MAX_CSV_BYTES) {
      setSelectedFile(null)
      failWith(
        `“${file.name}” exceeds the 10 MB limit. Please choose a smaller CSV file.`,
      )
      return
    }

    setSelectedFile({ name: file.name, size: file.size })
    setDataset(null)
    setErrorMessage("")
    setStatus("loading")

    try {
      const result = await uploadCsv(file, { signal: controller.signal })
      setDataset(result)
      setFilters(defaultFilterState(result))
      setSelectedFile({
        name: result?.filename ?? file.name,
        size: file.size,
      })
      setStatus("ready")
    } catch (err) {
      // Ignore cancellations from Remove / a newer selection / unmount.
      if (err?.name === "AbortError") return
      setDataset(null)
      setStatus("error")
      setErrorMessage(
        err instanceof ApiError
          ? err.message
          : "Something went wrong while uploading. Please try again.",
      )
    }
  }

  const resetUpload = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setSelectedFile(null)
    setDataset(null)
    setFilters(defaultFilterState(null))
    setErrorMessage("")
    setStatus("idle")
  }

  const handleContinue = () => setView("dashboard")

  return (
    <AppLayout activeView={view} onNavigate={handleNavigate}>
      {view === "upload" ? (
        <UploadPage
          status={status}
          selectedFile={selectedFile}
          dataset={dataset}
          errorMessage={errorMessage}
          onFilesSelected={handleFilesSelected}
          onRemove={resetUpload}
          onDismissError={resetUpload}
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
