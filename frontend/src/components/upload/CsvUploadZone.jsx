import { FileSpreadsheet, Upload, X } from "lucide-react"
import { useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { formatFileSize } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ErrorState } from "@/components/states/ErrorState"
import { LoadingState } from "@/components/states/LoadingState"

export function CsvUploadZone({
  status,
  selectedFile,
  errorMessage,
  onFilesSelected,
  onRemove,
  onDismissError,
  onContinue,
}) {
  const inputRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)

  const openFileDialog = () => inputRef.current?.click()

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
          Files stay in your browser for now. Parsing and backend upload arrive
          later.
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
          Browse files
        </Button>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Badge variant="outline">.csv</Badge>
          <Badge variant="outline">UTF-8</Badge>
          <Badge variant="outline">Header row expected</Badge>
        </div>
      </div>

      <div aria-live="polite" className="flex min-w-0 flex-col gap-3">
        {status === "loading" ? (
          <LoadingState label="Checking file details…" />
        ) : null}

        {status === "error" ? (
          <ErrorState
            title="We could not accept that file"
            message={errorMessage}
            onRetry={openFileDialog}
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
                  <Badge>CSV ready</Badge>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Content is not parsed yet. This only confirms the file type.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={onRemove}>
                <X aria-hidden="true" />
                Remove
              </Button>
              <Button size="sm" onClick={onContinue}>
                Continue to dashboard
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
