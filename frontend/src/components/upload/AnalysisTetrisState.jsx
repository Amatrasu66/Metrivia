import { motion } from "motion/react"
import { useEffect, useState } from "react"
import { TetrisLoader } from "@/components/states/TetrisLoader"
import { useWakeTetrisSize } from "@/lib/tetris-size"

/**
 * Long-running CSV analysis fallback (30s+ pending).
 *
 * Pure presentation for the SAME in-flight upload request: it never starts,
 * cancels, retries, or observes completion of the request — the parent
 * unmounts it the moment the backend stream resolves or errors, and the
 * existing success/error flows take over exactly as before. Internal
 * backend milestones may keep arriving while this is visible; they are
 * deliberately NOT rendered here (no fake percentage alongside Tetris).
 *
 * - Tetris animation runs via the existing TetrisLoader (algorithm,
 *   reduced-motion, and status semantics untouched; wrapped aria-hidden so
 *   the card owns the single live region).
 * - Two-column composition mirroring BackendWakeState: Tetris centered in
 *   the left column, status text + elapsed timer balanced in the right
 *   column; collapses to one centered column on narrow widths.
 * - Elapsed time ticks once per second from `analysisStartedAt` (visual
 *   only, aria-hidden, right column); screen readers get one static status
 *   announcement.
 * - The 1s interval lives only while this fallback is mounted and is
 *   cleaned up on unmount.
 */
function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

export function AnalysisTetrisState({ analysisStartedAt = null }) {
  const tetrisSize = useWakeTetrisSize()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const base = typeof analysisStartedAt === "number" ? analysisStartedAt : now
  const elapsed = formatElapsed(now - base)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      role="status"
      aria-busy="true"
      aria-label="Still analyzing your data"
      className="flex min-w-0 max-w-full flex-col items-center gap-6 overflow-hidden rounded-xl border border-border bg-muted/40 px-6 py-8 text-center md:flex-row md:items-center md:gap-8"
    >
      <div
        aria-hidden="true"
        className="flex min-w-0 flex-1 items-center justify-center overflow-hidden md:border-r md:border-border md:pr-8"
      >
        <TetrisLoader
          columns={tetrisSize.columns}
          rows={tetrisSize.rows}
          cellSize={tetrisSize.cellSize}
          gap={tetrisSize.gap}
          speed={40}
          playing
          loop
          label="Still analyzing your data"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm font-medium sm:text-base">
          Still analyzing your data…
        </p>
        <p className="max-w-full text-xs break-words text-muted-foreground sm:text-sm">
          Large datasets can take a little longer.
        </p>
        <p
          aria-hidden="true"
          className="mt-1 text-2xl font-semibold tracking-tight tabular-nums"
        >
          {elapsed}
        </p>
        <p aria-hidden="true" className="text-xs text-muted-foreground">
          elapsed
        </p>
        <p className="sr-only">
          Still analyzing your data. The request continues in the background
          and the dashboard will appear when the result is ready.
        </p>
      </div>
    </motion.div>
  )
}

export default AnalysisTetrisState
