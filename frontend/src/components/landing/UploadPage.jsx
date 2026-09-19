import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { CsvUploadZone } from "@/components/upload/CsvUploadZone"
import { useMetriviaHaptics } from "@/hooks/useMetriviaHaptics"

export function UploadPage({
  status,
  wakeStartedAt,
  selectedFile,
  dataset,
  uploadProgress = null,
  uploadStage = "",
  analysisStartedAt = null,
  errorTitle,
  errorMessage,
  onFilesSelected,
  onRemove,
  onDismissError,
  onRetryUpload,
  onContinue,
  onViewDashboard,
}) {
  const { tap } = useMetriviaHaptics()

  const scrollToUpload = () => {
    tap()
    document
      .getElementById("upload-card")
      ?.scrollIntoView({ behavior: "smooth", block: "start" })
    document.getElementById("csv-file-input")?.focus({ preventScroll: true })
  }

  const handleViewDashboard = () => {
    tap()
    onViewDashboard()
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-8 overflow-x-clip px-5 py-8 sm:px-6 sm:py-10 lg:gap-10 lg:py-12">
      {/* Hero — comfortable mobile reading width, no page-wide scroll. */}
      <section
        aria-labelledby="hero-heading"
        className="flex min-w-0 flex-col items-start gap-5 sm:gap-6"
      >
        <div className="flex min-w-0 max-w-3xl flex-col gap-3 sm:gap-4">
          <h1
            id="hero-heading"
            className="max-w-[20ch] text-[1.75rem] leading-[1.15] font-semibold tracking-tight text-balance sm:max-w-none sm:text-4xl sm:leading-tight lg:text-5xl"
          >
            Turn CSVs into clear, responsive dashboards
          </h1>
        </div>
        <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:gap-2">
          <Button
            size="lg"
            onClick={scrollToUpload}
            className="min-h-12 w-full sm:min-h-11 sm:w-auto"
          >
            Upload a CSV
            <ArrowRight aria-hidden="true" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={handleViewDashboard}
            className="min-h-12 w-full sm:min-h-11 sm:w-auto"
          >
            View dashboard
          </Button>
        </div>
      </section>

      {/* Upload */}
      <div className="grid min-w-0 grid-cols-1 gap-4">
        <Card id="upload-card" className="min-w-0 scroll-mt-20">
          <CardContent className="pt-5">
            <CsvUploadZone
              status={status}
              wakeStartedAt={wakeStartedAt}
              selectedFile={selectedFile}
              dataset={dataset}
              uploadProgress={uploadProgress}
              uploadStage={uploadStage}
              analysisStartedAt={analysisStartedAt}
              errorTitle={errorTitle}
              errorMessage={errorMessage}
              onFilesSelected={onFilesSelected}
              onRemove={onRemove}
              onDismissError={onDismissError}
              onRetryUpload={onRetryUpload}
              onContinue={onContinue}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
