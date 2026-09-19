import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { generateTetrisFrames } from "@/lib/tetris-frames";

/* -------------------------------------------------------------------------- */
/*                                  component                                 */
/* -------------------------------------------------------------------------- */

/**
 * I, O, T, S, Z, J, L. Each one reads a theme variable, so a light and a dark
 * board get their own shade; the literal after the comma keeps the component
 * working on its own, without the stylesheet.
 */
const PALETTE = [
    "var(--tetris-1, oklch(0.797 0.134 211.5))",
    "var(--tetris-2, oklch(0.861 0.173 91.9))",
    "var(--tetris-3, oklch(0.709 0.159 293.5))",
    "var(--tetris-4, oklch(0.800 0.182 151.7))",
    "var(--tetris-5, oklch(0.711 0.166 22.2))",
    "var(--tetris-6, oklch(0.714 0.143 254.6))",
    "var(--tetris-7, oklch(0.758 0.159 55.9))",
];

/** A number is read as pixels; a string goes through as written, `0.4em` and all. */
const size = (value) => (typeof value === "number" ? `${value}px` : value);

/** True while the reader asks for less movement. */
function useReducedMotion() {
    const [reduced, setReduced] = useState(false);

    useEffect(() => {
        const query = window.matchMedia("(prefers-reduced-motion: reduce)");
        const read = () => setReduced(query.matches);
        read();
        query.addEventListener("change", read);
        return () => query.removeEventListener("change", read);
    }, []);

    return reduced;
}

/**
 * A loading indicator that plays tetris. A bot stacks the pieces, clears the
 * lines, and eventually tops out — then the board wipes and a new game starts.
 * Readers who ask for less movement get one still board instead.
 *
 * Props:
 * - `columns` (default `8`, minimum `4`), `rows` (default `16`, minimum `6`)
 * - `cellSize` (default `6`), `gap` (default `2`) — numbers read as pixels
 * - `speed` (default `40`, ms per frame), `playing` (default `true`),
 *   `loop` (default `true`), `onComplete`, `label` (default `"Loading"`),
 *   `colors`, `flashColor`, `deadColor`, `dotClassName`, plus `className`,
 *   `style`, and remaining DOM props.
 */
export function TetrisLoader({
    columns = 8,
    rows = 16,
    cellSize = 6,
    gap = 2,
    speed = 40,
    playing = true,
    loop = true,
    onComplete,
    label = "Loading",
    colors = PALETTE,
    flashColor = "var(--tetris-flash, var(--foreground, currentColor))",
    deadColor = "var(--tetris-dead, color-mix(in oklab, var(--foreground, currentColor) 45%, transparent))",
    dotClassName,
    className,
    style,
    ...props
}) {
    const width = Math.max(4, Math.round(columns));
    const height = Math.max(6, Math.round(rows));

    const gridRef = useRef(null);
    const frame = useRef(0);

    const reduced = useReducedMotion();
    const [round, setRound] = useState(0);
    // Memoized (not state-in-effect): a fresh game per size/round, generated
    // on the client so the server and the first paint agree. `round` is
    // read so each loop restarts play from a fresh deal.
    const game = useMemo(() => {
        void round;
        return generateTetrisFrames(width, height);
    }, [width, height, round]);
    useEffect(() => {
        frame.current = 0;
    }, [width, height, round]);

    // Held in a ref so an inline callback does not restart the animation.
    const completeRef = useRef(onComplete);
    useEffect(() => {
        completeRef.current = onComplete;
    });

    const paint = useCallback(
        (dots, index) => {
            const board = game?.[index];
            if (!board) return;

            dots.forEach((dot, i) => {
                const value = board[i] ?? 0;
                dot.style.backgroundColor = value ? `var(--tetris-cell-${value})` : "";
            });
        },
        [game],
    );

    useEffect(() => {
        if (!game) return;

        const grid = gridRef.current;
        if (!grid) return;
        const dots = Array.from(grid.children);

        if (frame.current >= game.length) frame.current = 0;

        // One still board, a good way in, for anyone who asked for less movement.
        if (reduced) {
            paint(dots, Math.floor(game.length * 0.55));
            return;
        }

        paint(dots, frame.current);
        if (!playing) return;

        // A clock, not a timer: a background tab freezes the game instead of
        // banking up frames it has to rush through on the way back.
        let request = 0;
        let last = performance.now();
        let owed = 0;

        const tick = (now) => {
            owed += now - last;
            last = now;
            if (owed > speed * 4) owed = speed;

            let ended = false;
            while (owed >= speed) {
                owed -= speed;
                frame.current++;
                if (frame.current >= game.length) {
                    ended = true;
                    break;
                }
            }

            paint(dots, Math.min(frame.current, game.length - 1));

            if (!ended) {
                request = requestAnimationFrame(tick);
                return;
            }

            completeRef.current?.();
            // A new round replaces the frames, which restarts this effect.
            if (loop) setRound((r) => r + 1);
            else frame.current = game.length - 1;
        };

        request = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(request);
    }, [game, playing, speed, loop, paint, reduced]);

    const vars = {
        "--tetris-cell": size(cellSize),
        "--tetris-gap": size(gap),
        "--tetris-cell-8": flashColor,
        "--tetris-cell-9": deadColor,
    };
    for (let i = 0; i < 7; i++) vars[`--tetris-cell-${i + 1}`] = colors[i] ?? PALETTE[i];

    return (
        <div
            ref={gridRef}
            role="status"
            aria-label={label}
            aria-busy={playing && !reduced}
            className={cn("grid w-fit", className)}
            style={
                {
                    gridTemplateColumns: `repeat(${width}, var(--tetris-cell))`,
                    gap: "var(--tetris-gap)",
                    ...vars,
                    ...style,
                }
            }
            {...props}
        >
            {Array.from({ length: width * height }).map((_, i) => (
                <div
                    key={i}
                    style={{
                        height: "var(--tetris-cell)",
                        borderRadius: "calc(var(--tetris-cell) / 3)",
                        // The rAF loop repaints cells via inline backgroundColor
                        // up to every frame: opt out of the global `*`
                        // background-color transition so frames snap crisply
                        // instead of smearing mid-transition (and churning
                        // paint for the whole time the loader is visible).
                        transition: "none",
                    }}
                    className={cn("bg-foreground/10", dotClassName)}
                />
            ))}
        </div>
    );
}

export default TetrisLoader;
