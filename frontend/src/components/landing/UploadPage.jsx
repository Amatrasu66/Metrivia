import {
  ArrowRight,
  BarChart3,
  Check,
  Keyboard,
  MonitorSmartphone,
  Plug,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { CsvUploadZone } from "@/components/upload/CsvUploadZone"
import { EmptyState } from "@/components/states/EmptyState"
import { ErrorState } from "@/components/states/ErrorState"
import { LoadingState } from "@/components/states/LoadingState"
import { useMetriviaHaptics } from "@/hooks/useMetriviaHaptics"

const HIGHLIGHTS = [
  {
    icon: MonitorSmartphone,
    title: "Responsive by default",
    description:
      "One layout that adapts from mobile to desktop with no horizontal overflow.",
  },
  {
    icon: Keyboard,
    title: "Accessible controls",
    description:
      "Semantic landmarks, visible focus states, and keyboard-friendly upload.",
  },
  {
    icon: Plug,
    title: "Real Flask backend",
    description:
      "Uploads are analyzed by Pandas and the results feed the dashboard.",
  },
]

const STEPS = [
  {
    title: "Upload",
    description: "Choose a .csv file. It is sent to Flask for analysis.",
    status: "Available now",
  },
  {
    title: "Preview",
    description: "Column types, stats, and row preview from the backend.",
    status: "Available now",
  },
  {
    title: "Visualize",
    description: "Charts and tables arrive with the visualization layer.",
    status: "Coming later",
  },
]

/**
 * Single pipeline step. Availability is hidden by default and revealed on
 * hover, keyboard focus, or touch tap (tapping a `tabIndex` element moves
 * focus to it, triggering the same `focus-within` reveal — no hover
 * required). The full text, including status, is always in the accessible
 * name so screen-reader users never depend on the visual reveal.
 */
function PipelineStep({ index, title, description, status }) {
  return (
    <li
      tabIndex={0}
      aria-label={`${index + 1}. ${title}. ${description} Status: ${status}.`}
      className="group flex min-w-0 items-start gap-3 rounded-lg border border-border px-3 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold"
      >
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs break-words text-muted-foreground sm:text-sm">
          {description}
        </p>
        <p
          aria-hidden="true"
          className="grid grid-rows-[0fr] opacity-0 transition-all duration-200 group-hover:grid-rows-[1fr] group-hover:opacity-100 group-focus-within:grid-rows-[1fr] group-focus-within:opacity-100 motion-reduce:transition-none"
        >
          <span className="min-w-0 overflow-hidden text-xs font-medium text-muted-foreground">
            {status}
          </span>
        </p>
      </div>
    </li>
  )
}

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
            View dashboard layout
          </Button>
        </div>

        <dl className="grid w-full min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
          {HIGHLIGHTS.map((item) => (
            <div
              key={item.title}
              className="flex min-w-0 items-start gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground"
              >
                <item.icon className="size-4" />
              </span>
              <div className="min-w-0">
                <dt className="text-sm font-medium">{item.title}</dt>
                <dd className="mt-0.5 text-xs break-words text-muted-foreground sm:text-sm">
                  {item.description}
                </dd>
              </div>
            </div>
          ))}
        </dl>
      </section>

      {/* Upload + next steps */}
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
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

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>What happens next</CardTitle>
            <CardDescription>
              A simple pipeline the UI is already designed around.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex min-w-0 flex-col gap-3">
              {STEPS.map((step, index) => (
                <PipelineStep
                  key={step.title}
                  index={index}
                  title={step.title}
                  description={step.description}
                  status={step.status}
                />
              ))}
            </ol>
            <ul className="mt-4 flex min-w-0 flex-col gap-1.5 text-xs text-muted-foreground sm:text-sm">
              <li className="flex items-start gap-2">
                <Check
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0"
                />
                No account or database. Files are analyzed, never stored.
              </li>
              <li className="flex items-start gap-2">
                <Check
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0"
                />
                CSV analysis runs in Flask. No chart library yet.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* State previews */}
      <section
        aria-labelledby="states-heading"
        className="flex min-w-0 flex-col gap-4"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <h2
            id="states-heading"
            className="text-xl font-semibold tracking-tight sm:text-2xl"
          >
            Interface states
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            The same components used by the live upload flow and dashboard,
            shown here for review.
          </p>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Empty</CardTitle>
              <CardDescription>Shown before a dataset exists.</CardDescription>
            </CardHeader>
            <CardContent>
              <EmptyState
                title="No dataset yet"
                description="Upload a CSV to unlock the dashboard preview."
              />
            </CardContent>
          </Card>
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Loading</CardTitle>
              <CardDescription>
                Shown while the backend analyzes the upload.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LoadingState label="Uploading and analyzing…" />
            </CardContent>
          </Card>
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Error</CardTitle>
              <CardDescription>
                Shown when a file cannot be accepted.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ErrorState
                title="Unsupported file type"
                message="Please choose a file ending in .csv and try again."
              />
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Dashboard teaser */}
      <Card className="min-w-0">
        <CardContent className="flex min-w-0 flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary"
            >
              <BarChart3 className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight">
                Dashboard layout is ready
              </h2>
              <p className="mt-0.5 text-sm break-words text-muted-foreground">
                KPI cards, a live bar chart, and the data table adapt from
                mobile to desktop.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={handleViewDashboard}
            className="w-full shrink-0 sm:w-auto"
          >
            Open dashboard
            <ArrowRight aria-hidden="true" />
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
