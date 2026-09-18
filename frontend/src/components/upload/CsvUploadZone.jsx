import { FileSpreadsheet, Upload, X } from "lucide-react"
import { useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { formatCount, formatFileSize } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useMetriviaHaptics } from "@/hooks/useMetriviaHaptics"
import { BackendWakeState } from "@/components/states/BackendWakeState"
import { ErrorState } from "@/components/states/ErrorState"
import { LoadingState } from "@/components/states/LoadingState"

export function CsvUploadZone({
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
}) {
  const inputRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const { tap } = useMetriviaHaptics()

  const openFileDialog = () => {
    tap()
    inputRef.current?.click()
  }

  // Removing the selected file is a discrete destructive gesture: it needs
  // the same semantic tap as every other button (previously it reached the
  // central haptic method on no platform — the shared Button only carries
  // the iOS native switch, so Android was silent here).
  const handleRemove = () => {
    tap()
    onRemove()
  }

  const handleContinue = () => {
    tap()
    onContinue()
  }

  const handleDrop = (event) => {
    event.preventDefault()
    setIsDragging(false)
    if (event.dataTransfer?.files?.length) {
      onFilesSelected(event.dataTransfer.files)
    }
  }

  return (
    <section
      aria-labelledby="upload-heading"
      className="flex min-w-0 flex-col gap-4"
    >
      <div>
        <h2 id="upload-heading" className="text-lg font-semibold tracking-tight">
          Upload a CSV file
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sent to the Metrivia backend for analysis. Files are not stored.
        </p>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "flex min-w-0 flex-col items-center gap-4 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors sm:px-8 sm:py-10",
          isDragging
            ? "border-primary bg-accent"
            : "border-border bg-muted/30",
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-full bg-secondary text-secondary-foreground"
        >
          <Upload className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col items-center gap-1">
          <p className="text-sm font-medium sm:text-base">
            Drag and drop your CSV here
          </p>
          <p className="text-xs text-muted-foreground sm:text-sm">
            or use the button below · .csv only · up to 10 MB
          </p>
        </div>

        <input
          ref={inputRef}
          id="csv-file-input"
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          aria-label="Choose a CSV file"
          onChange={(event) => {
            if (event.target.files?.length) {
              onFilesSelected(event.target.files)
            }
            event.target.value = ""
          }}
        />
        <Button onClick={openFileDialog}>
          <Upload aria-hidden="true" />
          Upload CSV
        </Button>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Badge variant="outline">.csv</Badge>
          <Badge variant="outline">UTF-8</Badge>
          <Badge variant="outline">Header row expected</Badge>
        </div>
      </div>

      <div aria-live="polite" className="flex min-w-0 flex-col gap-3">
        {status === "waking" ? (
          <BackendWakeState
            key={wakeStartedAt ?? "waking"}
            startedAt={wakeStartedAt}
            phase="waking"
          />
        ) : null}

        {status === "wake-ready" ? (
          <BackendWakeState
            key={wakeStartedAt ?? "wake-ready"}
            startedAt={wakeStartedAt}
            phase="ready"
          />
        ) : null}

        {status === "uploading" || status === "loading" ? (
          <LoadingState label="Uploading CSV…" />
        ) : null}

        {status === "analyzing" ? (
          <LoadingState label="Analyzing your data…" />
        ) : null}

        {status === "error" ? (
          <ErrorState
            title={errorTitle || "Could not process this file"}
            message={errorMessage}
            onRetry={onRetryUpload ?? openFileDialog}
            retryLabel={onRetryUpload ? "Try again" : undefined}
            onDismiss={onDismissError}
          />
        ) : null}

        {status === "ready" && selectedFile ? (
          <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground"
              >
                <FileSpreadsheet className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="min-w-0 truncate text-sm font-medium">
                  {selectedFile.name}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{formatFileSize(selectedFile.size)}</span>
                  <Badge>Dashboard ready</Badge>
                </p>
                {dataset ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatCount(dataset.row_count)} rows ·{" "}
                    {formatCount(dataset.column_count)} columns detected by the
                    backend.
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleRemove}>
                <X aria-hidden="true" />
                Remove
              </Button>
              <Button size="sm" onClick={handleContinue}>
                Continue to dashboard
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
