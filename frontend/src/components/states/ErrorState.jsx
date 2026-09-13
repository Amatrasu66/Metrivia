import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useMetriviaHaptics } from "@/hooks/useMetriviaHaptics"

export function ErrorState({
  title,
  message,
  onRetry,
  retryLabel = "Choose a different file",
  onDismiss,
}) {
  const { tap } = useMetriviaHaptics()

  const handleRetry = () => {
    tap()
    onRetry()
  }

  const handleDismiss = () => {
    tap()
    onDismiss()
  }

  return (
    <div
      role="alert"
      className="flex min-w-0 flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive"
        >
          <AlertTriangle className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {message ? (
            <p className="mt-1 min-w-0 text-sm break-words text-muted-foreground">
              {message}
            </p>
          ) : null}
        </div>
      </div>
      {onRetry || onDismiss ? (
        <div className="flex flex-wrap items-center gap-2 pl-12">
          {onRetry ? (
            <Button variant="outline" size="sm" onClick={handleRetry}>
              {retryLabel}
            </Button>
          ) : null}
          {onDismiss ? (
            <Button variant="ghost" size="sm" onClick={handleDismiss}>
              Dismiss
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
