import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Check } from "lucide-react"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import {
  WAKE_STAGES,
  formatWakeElapsed,
  wakeActiveStageIndex,
  wakeStageMessage,
} from "@/lib/wake-stages"
import { TetrisLoader } from "@/components/states/TetrisLoader"

function StageDot({ done, active, reduceMotion }) {
  if (done) {
    return (
      <span
        aria-hidden="true"
        className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
      >
        <Check aria-hidden="true" className="size-2.5" />
      </span>
    )
  }
  if (active && !reduceMotion) {
    return (
      <motion.span
        aria-hidden="true"
        animate={{ opacity: [1, 0.3, 1], scale: [1, 1.35, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        className="size-2 shrink-0 rounded-full bg-primary"
      />
    )
  }
  if (active) {
    return (
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full bg-primary"
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className="size-2 shrink-0 rounded-full border border-muted-foreground/50"
    />
  )
}

/**
 * Responsive Tetris dimensions for the wake card (placement/sizing only —
 * the Tetris algorithm itself is untouched).
 *
 * - Desktop (≥1024px): 18 columns × 9 rows, 12px cells — substantially
 *   larger than the previous 10×5 presentation.
 * - Tablet (640–1023px): 15 × 8, 10px cells.
 * - Mobile (<640px): 11 × 7, 8px cells, collapsing to a vertical layout.
 */
function wakeTetrisSizeForWidth(width) {
  if (width >= 1024) {
    return { columns: 18, rows: 9, cellSize: 12, gap: 3 }
  }
  if (width >= 640) {
    return { columns: 15, rows: 8, cellSize: 10, gap: 3 }
  }
  return { columns: 11, rows: 7, cellSize: 8, gap: 2 }
}

function useWakeTetrisSize() {
  const [size, setSize] = useState(() =>
    typeof window !== "undefined" && typeof window.innerWidth === "number"
      ? wakeTetrisSizeForWidth(window.innerWidth)
      : wakeTetrisSizeForWidth(1280),
  )
  useEffect(() => {
    if (typeof window === "undefined") return undefined
    const onResize = () => {
      setSize(wakeTetrisSizeForWidth(window.innerWidth))
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  return size
}

/**
 * Progressive Render cold-start state. Pure presentation: it receives the
 * wake `startedAt` timestamp (owned by the upload flow in App.jsx) and the
 * `phase`, and never touches the network itself.
 *
 * - Ticks once per second from wall-clock snapshots (never a blind
 *   counter); the displayed value is derived as `now - startedAt`, so it is
 *   monotonic by construction. The interval is cleaned up on unmount and
 *   never runs once `phase` leaves "waking".
 * - The parent remounts this component (via `key`) for each new wait, which
 *   is what resets the timer on retry — no cascading state syncs needed.
 * - Shows elapsed seconds and stage copy — no fake percentages, no ETA.
 * - `phase="ready"` renders the brief success state before the upload
 *   proceeds; the parent unmounts this component right after.
 * - Layout (Phase L): responsive two-column card — the large Tetris loader
 *   on the left, startup text/timer/status on the right with a divider on
 *   desktop; collapses to a centered vertical stack on narrow widths with
 *   no horizontal overflow.
 */
export function BackendWakeState({ startedAt, phase = "waking" }) {
  const reduceMotion = useReducedMotion()
  const [now, setNow] = useState(() => Date.now())
  const tetrisSize = useWakeTetrisSize()

  useEffect(() => {
    if (phase !== "waking") return undefined
    const id = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => clearInterval(id)
  }, [phase])

  const base = typeof startedAt === "number" ? startedAt : now
  const elapsed = Math.max(0, Math.floor((now - base) / 1000))

  const isReady = phase === "ready"
  const message = isReady ? "Backend ready" : wakeStageMessage(elapsed)
  const active = wakeActiveStageIndex(elapsed)

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-w-0 max-w-full flex-col items-center gap-5 overflow-hidden rounded-xl border border-border bg-muted/40 px-6 py-8 text-center md:flex-row md:items-center md:gap-8 md:text-left"
    >
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center overflow-hidden md:border-r md:border-border md:pr-8"
      >
        {isReady ? (
          reduceMotion ? (
            <span className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check aria-hidden="true" className="size-5" />
            </span>
          ) : (
            <motion.span
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 22 }}
              className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground"
            >
              <Check aria-hidden="true" className="size-5" />
            </motion.span>
          )
        ) : (
          <TetrisLoader
            columns={tetrisSize.columns}
            rows={tetrisSize.rows}
            cellSize={tetrisSize.cellSize}
            gap={tetrisSize.gap}
            speed={420}
            playing
            loop
            label="Backend is starting, Tetris blocks falling"
          />
        )}
      </span>

      <div className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center md:items-start md:text-left">
        <p className="text-sm font-semibold sm:text-base">
          {isReady ? "Backend ready" : "Starting Metrivia's backend"}
        </p>
        {reduceMotion ? (
          <p
            key={message}
            className="min-w-0 max-w-full text-xs break-words text-muted-foreground sm:text-sm"
          >
            {message}
          </p>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={message}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="min-w-0 max-w-full text-xs break-words text-muted-foreground sm:text-sm"
            >
              {message}
            </motion.p>
          </AnimatePresence>
        )}

        {!isReady ? (
          <>
            <p
              aria-hidden="true"
              className="mt-1 text-2xl font-semibold tracking-tight tabular-nums"
            >
              {formatWakeElapsed(elapsed)}
            </p>
            <p className="text-xs text-muted-foreground">
              Usually takes under a minute
            </p>
            <span className="sr-only">
              Elapsed waiting time. The timer counts up; Render usually finishes
              within a minute.
            </span>
            <ol className="mt-1 flex min-w-0 max-w-full flex-wrap items-center justify-center gap-x-4 gap-y-1.5 md:justify-start">
              {WAKE_STAGES.map((label, index) => {
                const done = isReady || index < active
                const current = !isReady && index === active
                return (
                  <li
                    key={label}
                    aria-current={current ? "step" : undefined}
                    className="flex min-w-0 items-center gap-1.5"
                  >
                    <StageDot
                      done={done}
                      active={current}
                      reduceMotion={reduceMotion}
                    />
                    <span
                      className={cn(
                        "text-xs",
                        done || current
                          ? "font-medium text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {label}
                    </span>
                  </li>
                )
              })}
            </ol>
          </>
        ) : null}
      </div>
    </div>
  )
}
