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
 * - Elapsed time ticks once per second from `analysisStartedAt` (visual
 *   only, aria-hidden); screen readers get one static status announcement.
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
      className="flex min-w-0 flex-col items-center gap-3 rounded-xl border border-border bg-muted/40 px-6 py-6 text-center"
    >
      <span aria-hidden="true" className="flex min-w-0 max-w-full justify-center overflow-hidden">
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
      </span>
      <div className="flex min-w-0 flex-col items-center gap-1">
        <p className="text-sm font-medium">Still analyzing your data…</p>
        <p className="text-xs text-muted-foreground sm:text-sm">
          Large datasets can take a little longer.
        </p>
        <p
          aria-hidden="true"
          className="mt-1 text-xs font-medium tabular-nums text-muted-foreground"
        >
          {elapsed} elapsed
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
