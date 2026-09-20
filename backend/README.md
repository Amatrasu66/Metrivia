# Metrivia Backend

Lightweight Flask + Pandas analytics API. No database, no auth, no background
workers — intentionally minimal for Render's free tier.

## Endpoints

- `GET /api/health` — confirms the backend is running.
- `POST /api/upload` — accepts a CSV file as `multipart/form-data` field
  `file`, analyzes it in memory with Pandas, stores the DataFrame in the
  in-process dataset store, and returns dataset statistics plus a preview.
  Files are never written to disk. `POST /api/upload?stream=progress`
  streams the same result as NDJSON milestones + dataset (uncompressed).
- `GET /api/datasets/<dataset_id>` — metadata for a stored dataset
  (`dataset_id`, `row_count`, `column_count`, `columns`, `preview_count`,
  `metadata` with `filename`/`dtypes`/`missing`/`unique`/`numeric_stats`).
  Unknown/expired IDs return `{"error": "Not found."}` with HTTP 404.
- `GET /api/datasets/<dataset_id>/rows?page=0&page_size=100` — paginated
  rows (`dataset_id`, `page`, `page_size`, `row_count`, `rows`). Only the
  requested slice is serialized; a valid page past the end returns
  `"rows": []`. `page_size` max is 500. Unknown/expired IDs return 404.
- `POST /api/datasets/<dataset_id>/chart` — server-side chart aggregation
  over the full dataset (Phase M4). Small/local datasets keep the
  client-side transform; server-backed datasets must use this endpoint so
  the browser never receives 50k rows for charting. Unknown/expired IDs
  return 404; invalid requests return 400; failures return 500 without a
  stack trace.

Upload response includes: `dataset_id`, `filename`, `row_count` (total
rows), `column_count`, `columns`, `dtypes` (numeric / categorical /
datetime / boolean / text), `missing` values per column, `unique` counts
per column, `numeric_stats` for numeric columns, `preview` rows, and
`preview_count` (rows actually returned in `preview`).

Preview policy (centralized in `backend/dataset_store.py`): datasets with
at most 5000 rows AND 100000 cells keep the complete `preview` (backward
compatible); larger datasets return only the first 500 rows
(`df.head(500)`). `preview_count` is the preview size, `row_count` the
total. The DataFrame stays server-side as the canonical representation.

Dataset store: in-process only (see `backend/dataset_store.py`) — entries
disappear on process restart, are not shared between backend instances,
expire after `DATASET_TTL_SECONDS` (default 1800), hold at most
`MAX_DATASETS` (default 3, LRU-evicted), and are thread-safe. Temporary
workspace storage, not a database.

## Chart aggregation (Phase M4)

`POST /api/datasets/<dataset_id>/chart` with a JSON body:

```json
{
  "chart_type": "bar",
  "dimension": "genre",
  "measure": "stream_count",
  "aggregation": "sum",
  "filters": [{ "column": "genre", "operator": "in", "value": ["Pop"] }],
  "limit": 20,
  "sort": "descending",
  "date_granularity": "day"
}
```

- `chart_type`: `bar` | `line` | `area` | `pie` | `scatter` (one endpoint
  for all types). `dimension` accepts `x_column` / `category_column`
  aliases; `measure` accepts `y_column` / `value_column` aliases.
- `measure` may be `null` only when `aggregation` is `count` (grouped
  charts). Scatter requires a datetime `dimension` + numeric `measure` and
  ignores `aggregation` / `sort` / `date_granularity`.
- `aggregation`: `sum` | `average` (`avg` / `mean` accepted) | `min` |
  `max` | `count`. Non-count aggregations need a numeric `measure`;
  anything else is a 400 (never a misleading zero chart).
- `filters` reuses the M3 filter engine verbatim (same `{column,
  operator, value}` schema, AND semantics, missing-never-matches). Order
  is always DataFrame → filter mask → aggregation → bounded response.
- `limit` (optional): grouped charts default to and max out at
  `MAX_CHART_CATEGORIES = 20` (mirrors the UI's 20-category cap);
  scatter defaults to and maxes out at `MAX_SCATTER_POINTS = 2000`.
  Larger values are a 400 — a client cannot force an oversized response.
- `sort` (optional): `descending` (value, default for categorical) |
  `ascending` (value) | `category` (label ascending, default for
  datetime). Deterministic; ties break by label; the `"(blank)"` group
  always sorts last (frontend parity). No arbitrary sort expressions.
- `date_granularity` (optional): `day` (default) | `week` (Monday start) |
  `month` | `quarter` | `year` — bucketing for grouped charts on a
  datetime dimension only. Labels are period-start `YYYY-MM-DD` strings,
  so chronological order is lexicographic. Timestamps are naive wall time
  (no timezone conversion). Missing/invalid dates form `"(blank)"`.
- Grouped charts return `data: [{ label, value }]` (at most `limit`
  entries, sorted first, then sliced — documented top-N, no "Others"
  bucket; `truncated` flags slicing). Pie keeps only positive values.
- Scatter returns `data: [{ x, y }]` (ISO-8601 `x`, finite-number `y`),
  deterministically evenly-spaced over filtered row order, then
  chronological — no randomness, stable per dataset/filter/config.
- No matching rows → `200` with `data: []` (not an error).
  `filtered_row_count` uses the same semantics as the M3 Rows KPI.
- Never `eval` / `exec` / `df.query` with client strings; unknown fields
  are a 400. The stored DataFrame is never mutated and never fully
  serialized — only the bounded aggregation leaves the server.

Response:

```json
{
  "dataset_id": "abc123",
  "chart_type": "bar",
  "dimension": "genre",
  "measure": "stream_count",
  "aggregation": "sum",
  "filtered_row_count": 1427,
  "row_count": 50000,
  "data": [{ "label": "Pop", "value": 1234567 }],
  "total_groups": 30,
  "shown_groups": 20,
  "truncated": true,
  "sort": "descending",
  "date_granularity": null
}
```

Small vs server-backed behavior: the frontend keeps the client-side
transform for full-preview datasets and POSTs this endpoint for
server-backed ones (`frontend/src/lib/chart-data-source.js`, tested by
`npm run chart:test`). Backend aggregation tests:
`.venv\Scripts\python -m unittest test_chart_aggregation -v`.

## Performance architecture (Phase M5)

Hot paths (filter masks, chart aggregation) are vectorized: one
`Series.map` / `to_datetime` / `to_numeric` pass per column instead of
per-cell Python loops. Measured speedups on the 50k x 33 Spotify CSV
(interleaved old-vs-new, same machine): text `in` 2.4x, datetime `gte`
2.3x, datetime `in` (3 values) 6.8x, chart labels 1.7x, grouped bar
1.6x, scatter 4.3x. Per-operation transient memory fell too (scatter
15.3 MiB -> 2.0 MiB, datetime mask 3.8 MiB -> 1.7 MiB). Outputs are
byte-identical to the scalar implementations (see `test_performance_m5.py`
`VectorParityTest`, snapshotted before optimizing, including garbage
dates, floats, bools, `inf`, `None`/`""`).

Deliberately NOT done (measured, kept simple):

- No derived-data (parsed datetime/numeric) cache: a single vectorized
  parse costs ~50ms per 50k column; the added invalidation/thread-safety
  surface is not justified. Revisit only if datetime-heavy profiling
  demands it.
- No pandas `groupby` rewrite of the aggregation loop: the dict loop is
  ~25ms per 50k rows; replicating sum-keeps-empty / average-omits-empty /
  blank-last semantics in `groupby.agg` risks subtle drift for ~15ms.
- No gzip on chart/filter/rows responses: largest chart payload is
  ~88 KiB (scatter); gzip stays upload-only (level 1, streaming) and the
  NDJSON progress stream is never compressed (compression would buffer
  milestones). Verified by `EncodingBoundsTest`.
- No streaming CSV parse: upload holds raw bytes + parser buffers + the
  frame transiently (peak ~97 MiB for 11.5 MiB CSV); `raw` is released
  before analysis and only the 500-row preview is serialized. The 20 MiB
  cap, same-request progress streaming, and behavior are unchanged.
- No frontend changes: chart adaptation is O(<=2000 points), the chart
  cache holds at most 20 bounded payloads, table pages at most 4;
  nothing retains the full dataset in the browser.

Memory/lifecycle model:

- Stored DataFrames are immutable after creation: every filter/chart/
  rows/analysis path only reads (`df[col]`, `df.iloc`, boolean masks,
  `to_datetime`/`to_numeric` copies). All `fillna`/`astype` calls act on
  derived temporaries. A lifecycle test asserts the stored frame is
  bit-identical after chart/filter/rows traffic.
- `DatasetStore` (single `threading.Lock`, no reentrancy: public methods
  never call each other while holding it): at most `MAX_DATASETS`
  (default 3, LRU-evicted) DataFrames, TTL expiry on access, records
  handed out by reference so in-flight requests survive delete/evict
  (they finish on a detached record — 200, never 500 — and release it).
  Concurrency tests cover 24 mixed threaded requests, delete-during-read,
  and eviction isolation. Weakref tests prove deleted frames are freed.
- No unbounded caches anywhere: backend holds zero caches; frontend
  holds 20 chart payloads + 4 table pages max.

Limits (all still server-enforced): 20 MiB upload, 3 datasets / 30 min
TTL, page size <= 500, <= 20 chart groups, <= 2000 scatter points,
<= 20 filters, <= 100 `in` values, 500-char string values. A 41 MiB
100k x 33 CSV is correctly rejected with 413 at the door.

Stress methodology: A uses the real Spotify CSV through `/api/upload`;
B-E are generated in-process with fixed seeds (temporary, never
committed) and inserted via `analyze_dataframe` + store (real analysis
cost included); B additionally asserts the 413 upload rejection.
Results are printed by the tests (`[stress-B/C/D/E]`, `[budget]`).

Performance tests: `.venv\Scripts\python -m unittest test_performance_m5 -v`
(slow suite, ~2-4 min — real 50k/100k datasets; ordinary suites stay
fast). Budgets fail only on ~10x regressions (CI-noise-proof); the
datetime guard fails long before a return to per-cell parsing (~28s).

## Production hardening (Phase M6)

Final API contracts (all errors are JSON `{"error": "<message>"}` — never
HTML pages, never tracebacks/paths/secrets):

| Endpoint | Success | Client errors | Notes |
|---|---|---|---|
| `GET /api/health` | 200 `{status, service, message}` | — | Fast (<1s), no dataset/env/secret/memory data |
| `POST /api/upload` | 200 dataset payload | 400 bad CSV, 413 over 20 MiB | `?stream=progress` streams NDJSON milestones |
| `GET /api/datasets/<id>` | 200 metadata | 404 unknown/expired | No row data |
| `GET /api/datasets/<id>/rows` | 200 page | 400 bad page/size, 404 expired | `page_size` max 500 |
| `POST /api/datasets/<id>/filter` | 200 page + counts | 400 validation/JSON, 404 expired | `page_size` max 500 |
| `POST /api/datasets/<id>/chart` | 200 bounded payload | 400 validation/JSON, 404 expired | ≤20 groups, ≤2000 scatter points |

Framework-level failures (unknown route → 404, wrong method → 405, bad
multipart → 400, unhandled exception → generic 500) also return the same
JSON shape. The string shape is kept deliberately: the frontend parses
`body.error` as a string everywhere.

Upload hardening: the 20 MiB ceiling is enforced twice (Flask
`MAX_CONTENT_LENGTH` + an in-route byte cap, both from `MAX_UPLOAD_MB`).
Malformed/inconsistent-row CSVs → 400 "malformed"; empty files → 400;
header-only files → 400 naming headers; duplicate column names are mangled
by pandas (`a`, `a.1`) and stay usable; Unicode/quoted-newline/NaN/Inf/
invalid-date cells are accepted and normalized (NaN/Inf → null, missing
dates → `"(blank)"` group); over-long single fields return a clean
200 or 400, never a 500 with leakage. A local 18.56 MiB numeric CSV
(30k × 33) uploads in ~2.1s with a bounded 500-row preview.

Abuse/resource protection: no separate rate limiter was added — the
existing server-enforced bounds already cap every expensive path (20 MiB
upload, 3 datasets / 30 min TTL, page size ≤ 500, ≤ 20 filters, ≤ 100 `in`
values, ≤ 500-char values, ≤ 20 chart groups, ≤ 2000 scatter points), and
every endpoint is a short synchronous request with no amplification
(an attacker can only spend roughly what they send). A process-local
limiter would add shared-state complexity on a stateless free-tier service
without covering multi-instance deployments, so it was documented away
rather than built.

Structured logging (stdlib `logging`, Render captures stdout):
`event=request method=… path=… status=… duration_ms=…` for every API call
(health + table pages at DEBUG, uploads/filters/charts/metadata and ALL
4xx/5xx at INFO); `event=filter_query filters=… matched=… duration_ms=…`;
`event=chart_query chart_type=… aggregation=… filters=… groups/points=…
duration_ms=…`; `event=dataset_created/expired/pruned` with counts only.
Never logged: CSV contents, DataFrames, filter values, column data,
secrets, credentials, tracebacks. 404s on dataset endpoints specifically
surface expired/missing sessions.

Production checklist: set `CORS_ORIGINS` to the exact Vercel URL (replaces
dev defaults, no wildcards); `VITE_API_URL` at Vercel build time (never
localhost); `FLASK_DEBUG` unset (debug off by default); `render.yaml`
pins Python 3.13.0, free plan, `python app.py` (reads Render `PORT`).
Cold starts are expected on Render Free (backend sleeps when idle); the
frontend waits up to ~60s with "Starting the analysis server…" messaging
and no keep-alive ping was added.

M6 tests: `.venv\Scripts\python -m unittest test_m6_production -v`
(36 tests: health/error contracts, expiry 404s, upload hardening, chart
bounds, concurrency isolation, log safety, security audit).

## Run locally (Windows PowerShell)

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

macOS / Linux:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

The server listens on `http://127.0.0.1:5000` by default (or `HOST`/`PORT`
when set). Health check:

```powershell
curl.exe http://127.0.0.1:5000/api/health
```

Upload a CSV:

```powershell
curl.exe -F "file=@sample.csv;type=text/csv" http://127.0.0.1:5000/api/upload
```

## Configuration (environment variables)

| Variable         | Default                 | Purpose                                  |
| ---------------- | ----------------------- | ---------------------------------------- |
| `HOST`           | `0.0.0.0`               | Bind address (Render-compatible)         |
| `PORT`           | `5000`                  | Port (Render injects `PORT`)             |
| `CORS_ORIGINS`   | local dev allowlist (see below) | Comma-separated allowed origins          |
| `MAX_UPLOAD_MB`  | `20`                    | Max CSV size; larger requests get a JSON 413 |
| `FLASK_DEBUG`    | (off)                   | Set to `1` for debug mode in development |
| `DATASET_TTL_SECONDS` | `1800`             | Dataset-store entry TTL (seconds) |
| `MAX_DATASETS`   | `3`                     | Max stored datasets (LRU-evicted past this) |

## CORS origins

When `CORS_ORIGINS` is unset or blank, the backend allows local development
from an explicit allowlist (no wildcards):

- `http://localhost:5173`, `http://localhost:5174`
- `http://127.0.0.1:5173`, `http://127.0.0.1:5174`

Both Vite ports are covered because Vite falls back to 5174 when 5173 is
busy. To lock down production, set `CORS_ORIGINS` to a comma-separated list
— it **replaces** the defaults entirely:

```powershell
$env:CORS_ORIGINS = "https://app.example.com,https://admin.example.com"
python app.py
```

Format: comma-separated origins, whitespace is ignored, empty entries are
dropped. Run the CORS regression tests with:

```powershell
.venv\Scripts\python -m unittest test_cors -v
```

## Limits and error handling

- Only `.csv` files are accepted; other types get a JSON 400.
- Oversized uploads get a JSON 413 (limit: 20 MiB request body).
- Empty, header-only, malformed, or undecodable files get a JSON 400 with a
  plain-language message. Nothing is stored server-side.
- The upload response streams its JSON body (`iterencode`, 64 KiB chunks)
  so a large dataset does not sit in memory twice (records list + one
  giant string). Raw bytes are released before analysis; for large
  datasets only the bounded head-sample preview is converted (never full
  row dictionaries for the response). Pagination serializes only the
  requested page. The stored DataFrame is the canonical representation.

## Render Free memory note

20 MiB is a tested application limit, not a guarantee for every file on a
512 MB / 0.1 CPU Free instance: Pandas object-dtype amplification means a
string-heavy max-size CSV can still exhaust memory while parsing. Numeric
or modest files process comfortably; pathological files may fail despite
the limit. The in-process dataset store adds at most `MAX_DATASETS`
retained DataFrames (default 3, TTL 30 min, LRU-evicted) — no database,
no persistent state across restarts, and only the
`GET /api/datasets/<id>/rows` slice endpoint beyond the upload itself.

## Deploy notes (Render free tier)

- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- Start command: `python app.py` (reads Render's `PORT` automatically)
