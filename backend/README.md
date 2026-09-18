# Metrivia Backend

Lightweight Flask + Pandas analytics API. No database, no auth, no background
workers — intentionally minimal for Render's free tier.

## Endpoints

- `GET /api/health` — confirms the backend is running.
- `POST /api/upload` — accepts a CSV file as `multipart/form-data` field
  `file`, analyzes it in memory with Pandas, and returns dataset statistics
  plus the full row data (every row, every column). Files are never written to disk.

Upload response includes: `filename`, `row_count`, `column_count`,
`columns`, `dtypes` (numeric / categorical / datetime / boolean / text),
`missing` values per column, `unique` counts per column, `numeric_stats`
for numeric columns, and `preview` rows.

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
| `MAX_UPLOAD_MB`  | `10`                    | Max CSV size; larger requests get a JSON 413 |
| `FLASK_DEBUG`    | (off)                   | Set to `1` for debug mode in development |

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
- Oversized uploads get a JSON 413.
- Empty, header-only, malformed, or undecodable files get a JSON 400 with a
  plain-language message. Nothing is stored server-side.

## Deploy notes (Render free tier)

- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- Start command: `python app.py` (reads Render's `PORT` automatically)
