import { ArrowRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { CsvUploadZone } from "@/components/upload/CsvUploadZone"
import { useMetriviaHaptics } from "@/hooks/useMetriviaHaptics"

export function UploadPage({
  status,
  wakeStartedAt,
  selectedFile,
  dataset,
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
    <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10 lg:gap-10 lg:py-12">
      {/* Hero */}
      <section
        aria-labelledby="hero-heading"
        className="flex min-w-0 flex-col items-start gap-5"
      >
        <Badge>Responsive CSV visualization shell</Badge>
        <div className="flex min-w-0 max-w-3xl flex-col gap-3">
          <h1
            id="hero-heading"
            className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl lg:text-5xl"
          >
            Turn CSVs into clear, responsive dashboards
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
            Metrivia is a modern analytics workspace. Start by uploading a
            dataset, then explore it in a dashboard layout built for desktop,
            laptop, tablet, and mobile.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button size="lg" onClick={scrollToUpload} className="w-full sm:w-auto">
            Upload a CSV
            <ArrowRight aria-hidden="true" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={handleViewDashboard}
            className="w-full sm:w-auto"
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
