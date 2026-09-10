import { useEffect, useRef, useState } from "react"
import { AppLayout } from "@/components/layout/AppLayout"
import { UploadPage } from "@/components/landing/UploadPage"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { MAX_CSV_BYTES, isCsvFileName } from "@/lib/format"

const CHECK_DELAY_MS = 900

export default function App() {
  const [view, setView] = useState("upload")
  const [status, setStatus] = useState("idle")
  const [selectedFile, setSelectedFile] = useState(null)
  const [errorMessage, setErrorMessage] = useState("")
  const timerRef = useRef(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleNavigate = (nextView) => {
    setView(nextView)
    window.scrollTo({ top: 0 })
  }

  const handleFilesSelected = (fileList) => {
    const file = fileList?.[0]
    if (!file) return

    if (timerRef.current) clearTimeout(timerRef.current)
    setSelectedFile(null)
    setErrorMessage("")
    setStatus("loading")

    // Local metadata check only: no parsing, no upload, no fake data.
    timerRef.current = setTimeout(() => {
      if (!isCsvFileName(file.name)) {
        setStatus("error")
        setErrorMessage(
          `“${file.name}” is not a .csv file. Please choose a file ending in .csv and try again.`,
        )
        return
      }
      if (file.size > MAX_CSV_BYTES) {
        setStatus("error")
        setErrorMessage(
          `“${file.name}” exceeds the 10 MB shell limit. Please choose a smaller CSV file.`,
        )
        return
      }
      setSelectedFile({ name: file.name, size: file.size })
      setStatus("ready")
    }, CHECK_DELAY_MS)
  }

  const handleRemove = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setSelectedFile(null)
    setErrorMessage("")
    setStatus("idle")
  }

  const handleDismissError = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
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
          errorMessage={errorMessage}
          onFilesSelected={handleFilesSelected}
          onRemove={handleRemove}
          onDismissError={handleDismissError}
          onContinue={handleContinue}
          onViewDashboard={() => handleNavigate("dashboard")}
        />
      ) : (
        <DashboardLayout
          selectedFile={selectedFile}
          onBackToUpload={() => handleNavigate("upload")}
          onRemoveFile={handleRemove}
        />
      )}
    </AppLayout>
  )
}
