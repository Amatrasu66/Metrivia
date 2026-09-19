import { useEffect, useMemo, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * Phase K Tetris backend wake-up visual.
 *
 * Lightweight Tetris loader: a small theme-colored tetromino falls on a
 * muted grid, locks, and the next piece spawns. Pure presentation — it never
 * represents backend percentage; the parent card owns elapsed time and
 * Connecting / Starting server / Ready stages.
 *
 * Props mirror the supplied component contract:
 * - columns / rows / cellSize / gap / speed / playing / loop / label
 * - `role="status"` + `aria-busy` semantics
 * - `prefers-reduced-motion` renders a static settled pattern (no timers).
 *
 * Theme: only Metrivia CSS variables (`--primary`, `--chart-*`, `--muted`,
 * `--border`) — no new palette. No animation library; a single interval.
 */

const TETROMINOES = [
  { cells: [[0, 0], [1, 0], [2, 0], [3, 0]], color: "var(--chart-1)" },
  { cells: [[0, 0], [1, 0], [0, 1], [1, 1]], color: "var(--chart-2)" },
  { cells: [[0, 0], [1, 0], [2, 0], [1, 1]], color: "var(--primary)" },
  { cells: [[0, 0], [0, 1], [0, 2], [1, 2]], color: "var(--chart-4)" },
  { cells: [[1, 0], [1, 1], [1, 2], [0, 2]], color: "var(--chart-5)" },
  { cells: [[1, 0], [2, 0], [0, 1], [1, 1]], color: "var(--chart-3)" },
  { cells: [[0, 0], [1, 0], [1, 1], [2, 1]], color: "var(--secondary)" },
]

function emptyBoard(columns, rows) {
  return Array.from({ length: rows }, () => Array(columns).fill(null))
}

function canPlace(board, cells, ox, oy) {
  const rows = board.length
  const cols = board[0]?.length ?? 0
  for (const [dx, dy] of cells) {
    const x = ox + dx
    const y = oy + dy
    if (x < 0 || x >= cols || y < 0 || y >= rows) return false
    if (board[y][x] != null) return false
  }
  return true
}

function lockPiece(board, cells, ox, oy, color) {
  const next = board.map((row) => [...row])
  for (const [dx, dy] of cells) {
    const x = ox + dx
    const y = oy + dy
    if (y >= 0 && y < next.length && x >= 0 && x < next[0].length) {
      next[y][x] = color
    }
  }
  return next
}

export function TetrisLoader({
  columns = 10,
  rows = 6,
  cellSize = 14,
  gap = 3,
  speed = 450,
  playing = true,
  loop = true,
  label = "Loading",
  className,
}) {
  const safeColumns = Math.max(4, Math.min(14, Math.floor(columns) || 10))
  const safeRows = Math.max(4, Math.min(10, Math.floor(rows) || 6))
  const safeCell = Math.max(8, Math.min(22, cellSize || 14))
  const safeGap = Math.max(1, Math.min(6, gap ?? 3))
  const safeSpeed = Math.max(120, Math.min(2000, speed || 450))

  const [reduceMotion, setReduceMotion] = useState(() =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  )
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const onChange = (event) => setReduceMotion(event.matches)
    query.addEventListener?.("change", onChange)
    return () => query.removeEventListener?.("change", onChange)
  }, [])

  const animated = playing && !reduceMotion

  // Grid shape is stable per mount (the wake card passes fixed 10×5); board
  // state is initialized once. If the shape ever needs to change, the parent
  // should remount via `key` for a fresh board.
  const [board, setBoard] = useState(() => emptyBoard(safeColumns, safeRows))
  const [pieceIndex, setPieceIndex] = useState(0)
  const [offset, setOffset] = useState(() => ({
    x: Math.max(0, Math.floor(safeColumns / 2) - 1),
    y: 0,
  }))

  useEffect(() => {
    if (!animated) return undefined
    const id = setInterval(() => {
      setBoard((prevBoard) => {
        const piece = TETROMINOES[pieceIndex % TETROMINOES.length]
        let ox = offset.x
        let oy = offset.y
        // Keep the spawn inside the board for narrow grids.
        const maxDx = Math.max(...piece.cells.map(([dx]) => dx))
        ox = Math.min(ox, safeColumns - maxDx - 1)
        if (canPlace(prevBoard, piece.cells, ox, oy + 1)) {
          setOffset({ x: ox, y: oy + 1 })
          return prevBoard
        }
        // Lock the piece.
        let next = lockPiece(prevBoard, piece.cells, ox, oy, piece.color)
        const filled = next.flat().filter(Boolean).length
        const boardFull = filled >= safeColumns * safeRows * 0.55
        if (boardFull) {
          next = loop ? emptyBoard(safeColumns, safeRows) : next
          if (!loop) {
            clearInterval(id)
          }
        }
        const nextIndex = pieceIndex + 1
        const nextPiece = TETROMINOES[nextIndex % TETROMINOES.length]
        const spawnX = Math.max(
          0,
          Math.min(Math.floor(safeColumns / 2) - 1, safeColumns - 2),
        )
        setPieceIndex(nextIndex)
        setOffset({ x: spawnX, y: 0 })
        // If the spawn is blocked and looping, clear instead of jamming.
        if (!canPlace(next, nextPiece.cells, spawnX, 0) && loop) {
          return emptyBoard(safeColumns, safeRows)
        }
        return next
      })
    }, safeSpeed)
    return () => clearInterval(id)
  }, [animated, safeSpeed, safeColumns, safeRows, loop, pieceIndex, offset.x, offset.y])

  const activeCells = useMemo(() => {
    if (!animated) return new Map()
    const piece = TETROMINOES[pieceIndex % TETROMINOES.length]
    const map = new Map()
    for (const [dx, dy] of piece.cells) {
      const x = Math.min(offset.x, safeColumns - 1) + dx
      const y = offset.y + dy
      if (x >= 0 && x < safeColumns && y >= 0 && y < safeRows) {
        map.set(`${x}:${y}`, piece.color)
      }
    }
    return map
  }, [animated, pieceIndex, offset, safeColumns, safeRows])

  // Reduced-motion / paused: a static settled pattern, no timers running.
  const staticBoard = useMemo(() => {
    if (animated) return null
    const next = emptyBoard(safeColumns, safeRows)
    const bottom = safeRows - 1
    for (let x = 0; x < safeColumns; x += 1) {
      if (x % 3 !== 2) next[bottom][x] = "var(--chart-1)"
      if (x % 4 === 0 && safeRows > 1) next[bottom - 1][x] = "var(--chart-4)"
    }
    const cx = Math.floor(safeColumns / 2) - 1
    if (cx >= 0 && cx + 2 < safeColumns && safeRows > 3) {
      next[1][cx] = "var(--primary)"
      next[1][cx + 1] = "var(--primary)"
      next[1][cx + 2] = "var(--primary)"
      next[2][cx + 1] = "var(--primary)"
    }
    return next
  }, [animated, safeColumns, safeRows])

  const renderBoard = animated ? board : staticBoard ?? board

  return (
    <div
      role="status"
      aria-busy={animated ? "true" : "false"}
      aria-label={label}
      className={cn("flex min-w-0 max-w-full justify-center overflow-hidden", className)}
    >
      <div
        aria-hidden="true"
        className="grid shrink-0"
        style={{
          gridTemplateColumns: `repeat(${safeColumns}, ${safeCell}px)`,
          gap: `${safeGap}px`,
        }}
      >
        {renderBoard.map((row, y) =>
          row.map((filled, x) => {
            const active = activeCells.get(`${x}:${y}`)
            const color = active ?? filled
            return (
              <span
                key={`${x}:${y}`}
                style={{
                  width: safeCell,
                  height: safeCell,
                  borderRadius: 3,
                  background: color ?? "var(--muted)",
                  opacity: color ? 1 : 0.55,
                  border: color ? "none" : "1px solid var(--border)",
                  boxSizing: "border-box",
                }}
              />
            )
          }),
        )}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  )
}

export default TetrisLoader
