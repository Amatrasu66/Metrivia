import { cn } from "@/lib/utils"

export function Card({ className, ...props }) {
  return (
    <div
      data-slot="card"
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card py-5 text-card-foreground shadow-none",
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex min-w-0 flex-col gap-1.5 px-5", className)}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }) {
  return (
    <h3
      data-slot="card-title"
      className={cn("text-base leading-tight font-semibold", className)}
      {...props}
    />
  )
}

export function CardDescription({ className, ...props }) {
  return (
    <p
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export function CardContent({ className, ...props }) {
  return (
    <div
      data-slot="card-content"
      className={cn("min-w-0 px-5", className)}
      {...props}
    />
  )
}

export function CardFooter({ className, ...props }) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-2 px-5",
        className,
      )}
      {...props}
    />
  )
}
