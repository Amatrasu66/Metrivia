/**
 * Tetris frame engine — the game behind the backend-wake loader.
 *
 * This is the supplied TetrisLoader implementation's frame generation,
 * housed here verbatim (no algorithm changes) so the component file keeps
 * exporting only the component (react-refresh gate) and the pure logic
 * stays dependency-free and directly testable:
 * seven tetrominoes, normalized rotations, collision detection, falling
 * logic, board stamping, line detection/collapse, board evaluation,
 * AI-selected landing positions, seven-bag randomization, line-clear and
 * game-over animation frames.
 *
 * One frame is a flat board, one entry per cell:
 * `0` empty, `1…7` a tetromino, `8` a line about to clear, `9` the game over fill.
 */

/** The seven tetrominoes, each rotation listed as `[x, y]` cells. */
const SHAPES = [
    {
        id: 1, // I
        rot: [
            [[0, 1], [1, 1], [2, 1], [3, 1]],
            [[2, 0], [2, 1], [2, 2], [2, 3]],
        ],
    },
    {
        id: 2, // O
        rot: [[[0, 0], [1, 0], [0, 1], [1, 1]]],
    },
    {
        id: 3, // T
        rot: [
            [[1, 0], [0, 1], [1, 1], [2, 1]],
            [[1, 0], [1, 1], [2, 1], [1, 2]],
            [[0, 1], [1, 1], [2, 1], [1, 2]],
            [[1, 0], [0, 1], [1, 1], [1, 2]],
        ],
    },
    {
        id: 4, // S
        rot: [
            [[1, 0], [2, 0], [0, 1], [1, 1]],
            [[0, 0], [0, 1], [1, 1], [1, 2]],
        ],
    },
    {
        id: 5, // Z
        rot: [
            [[0, 0], [1, 0], [1, 1], [2, 1]],
            [[1, 0], [0, 1], [1, 1], [0, 2]],
        ],
    },
    {
        id: 6, // J
        rot: [
            [[0, 0], [0, 1], [1, 1], [2, 1]],
            [[1, 0], [2, 0], [1, 1], [1, 2]],
            [[0, 1], [1, 1], [2, 1], [2, 2]],
            [[1, 0], [1, 1], [0, 2], [1, 2]],
        ],
    },
    {
        id: 7, // L
        rot: [
            [[2, 0], [0, 1], [1, 1], [2, 1]],
            [[1, 0], [1, 1], [1, 2], [2, 2]],
            [[0, 1], [1, 1], [2, 1], [0, 2]],
            [[0, 0], [1, 0], [1, 1], [1, 2]],
        ],
    },
];

/**
 * Pull every rotation back to the origin. Without this a rotation whose cells
 * start away from zero — the upright I, say — can never reach the left wall.
 */
const PIECES = SHAPES.map(({ id, rot }) => ({
    id,
    rot: rot.map((cells) => {
        const left = Math.min(...cells.map((c) => c[0]));
        const top = Math.min(...cells.map((c) => c[1]));
        return cells.map(([x, y]) => [x - left, y - top]);
    }),
}));

/** Cells above the ceiling are free; the walls and the floor are not. */
function hits(board, cells, ox, oy, w, h) {
    for (const [cx, cy] of cells) {
        const x = ox + cx;
        const y = oy + cy;
        if (x < 0 || x >= w || y >= h) return true;
        if (y >= 0 && board[y * w + x]) return true;
    }
    return false;
}

/** Lowest row the piece can reach from `from`. */
function fall(board, cells, ox, from, w, h) {
    let y = from;
    while (!hits(board, cells, ox, y + 1, w, h)) y++;
    return y;
}

function stamp(board, cells, ox, oy, id, w) {
    const next = [...board];
    for (const [cx, cy] of cells) {
        const y = oy + cy;
        if (y >= 0) next[y * w + ox + cx] = id;
    }
    return next;
}

function fullRows(board, w, h) {
    const rows = [];
    for (let r = 0; r < h; r++) {
        let full = true;
        for (let c = 0; c < w; c++) {
            if (!board[r * w + c]) {
                full = false;
                break;
            }
        }
        if (full) rows.push(r);
    }
    return rows;
}

/** Drops everything above the cleared rows down by as many rows. */
function collapse(board, rows, w, h) {
    const kept = [];
    for (let r = 0; r < h; r++) {
        if (rows.includes(r)) continue;
        kept.push(board.slice(r * w, r * w + w));
    }
    const next = new Array((h - kept.length) * w).fill(0);
    for (const row of kept) next.push(...row);
    return next;
}

/** Low stack, few holes, flat surface, cleared lines — the usual four terms. */
function rate(board, lines, w, h) {
    const heights = [];
    let holes = 0;

    for (let c = 0; c < w; c++) {
        let top = h;
        for (let r = 0; r < h; r++) {
            if (board[r * w + c]) {
                top = r;
                break;
            }
        }
        heights.push(h - top);
        for (let r = top + 1; r < h; r++) if (!board[r * w + c]) holes++;
    }

    let stack = 0;
    let bumps = 0;
    for (let c = 0; c < w; c++) {
        stack += heights[c];
        if (c) bumps += Math.abs(heights[c] - heights[c - 1]);
    }

    return -0.51 * stack + 0.76 * lines - 0.36 * holes - 0.18 * bumps;
}

/** Every landing spot for one piece, best first. */
function moves(board, piece, w, h) {
    const out = [];

    for (let r = 0; r < piece.rot.length; r++) {
        const cells = piece.rot[r];
        const span = Math.max(...cells.map((c) => c[0]));
        for (let x = 0; x + span < w; x++) {
            const y = fall(board, cells, x, -4, w, h);
            const landed = stamp(board, cells, x, y, piece.id, w);
            const lines = fullRows(landed, w, h);
            out.push({ rot: r, x, y, value: rate(collapse(landed, lines, w, h), lines.length, w, h) });
        }
    }

    return out.sort((a, b) => b.value - a.value);
}

/** Seven-bag randomiser, so every piece turns up. */
function bag() {
    const order = [0, 1, 2, 3, 4, 5, 6];
    for (let i = order.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

/** Frames of one whole game, from the first piece to the top out. */
export function generateTetrisFrames(w, h) {
    const cells = w * h;
    const frames = [];
    let board = new Array(cells).fill(0);
    let queue = [];
    let placed = 0;
    let alive = true;

    while (alive && placed < 60 && frames.length < 900) {
        if (!queue.length) queue = bag();
        const piece = PIECES[queue.shift()];
        const spots = moves(board, piece, w, h);
        if (!spots.length) break;

        // The player gets sloppier the longer it survives, so every game ends.
        const slip = Math.max(0, placed - 10) * 0.06;
        const spot = spots[Math.random() < slip ? Math.min(spots.length - 1, 1 + ((Math.random() * 2) | 0)) : 0];
        const shape = piece.rot[spot.rot];
        const tall = Math.max(...shape.map((c) => c[1])) + 1;

        // The piece drifts in from above the ceiling, a row per frame.
        for (let y = -tall; y <= spot.y; y++) {
            if (y + tall <= 0) continue;
            frames.push(stamp(board, shape, spot.x, y, piece.id, w));
        }

        board = stamp(board, shape, spot.x, spot.y, piece.id, w);
        if (shape.some(([, cy]) => spot.y + cy < 0)) alive = false;

        const rows = fullRows(board, w, h);
        if (rows.length) {
            const flash = [...board];
            for (const r of rows) for (let c = 0; c < w; c++) flash[r * w + c] = 8;
            frames.push(flash, [...board], flash);
            board = collapse(board, rows, w, h);
            frames.push([...board], [...board]);
        }

        placed++;
    }

    // Game over: the stack floods the board, then blinks out.
    const flood = [...board];
    for (let r = h - 1; r >= 0; r--) {
        for (let c = 0; c < w; c++) flood[r * w + c] = 9;
        frames.push([...flood]);
    }
    const empty = new Array(cells).fill(0);
    frames.push([...flood], empty, [...flood], empty, empty);

    return frames;
}
