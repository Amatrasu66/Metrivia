import { useEffect, useState } from "react"

/**
 * Shared responsive Tetris sizing for Metrivia's two Tetris surfaces —
 * the backend cold-start card (BackendWakeState) and the long-running CSV
 * analysis fallback (AnalysisTetrisState).
 *
 * Placement/sizing only; the Tetris implementation itself is untouched.
 *
 * - Desktop (≥1024px): 18 columns × 9 rows, 12px cells.
 * - Tablet (640–1023px): 15 × 8, 10px cells.
 * - Mobile (<640px): 11 × 7, 8px cells, collapsing to a vertical layout.
 */
export function wakeTetrisSizeForWidth(width) {
  if (width >= 1024) {
    return { columns: 18, rows: 9, cellSize: 12, gap: 2 }
  }
  if (width >= 640) {
    return { columns: 15, rows: 8, cellSize: 10, gap: 2 }
  }
  return { columns: 11, rows: 7, cellSize: 8, gap: 2 }
}

export function useWakeTetrisSize() {
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
