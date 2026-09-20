"""Metrivia backend — lightweight Flask analytics API.

Endpoints:
    GET  /api/health   Service health check.
    POST /api/upload   Accept a CSV file (multipart/form-data), analyze it
                       with pandas entirely in memory, and return dataset
                       statistics plus the full row data.
    POST /api/upload?stream=progress
                       Same analysis, but streams NDJSON backend milestones
                       (`progress` events) followed by the dataset result,
                       so the frontend progress bar tracks real processing
                       instead of an estimated animation.

Uploaded files are never written to disk. No database, no auth, no
background workers — intentionally minimal for Render's free tier.
"""

import io
import json
import logging
import os
import time
import zlib

import pandas as pd
from flask import Flask, Response, jsonify, request
from flask_cors import CORS
from werkzeug.exceptions import RequestEntityTooLarge

from analysis import (
    PROGRESS_CSV_PARSED,
    PROGRESS_FILE_ACCEPTED,
    PROGRESS_RESPONSE_READY,
    _analyze_iter,
    analyze_dataframe,
    slice_to_records,
)
import dataset_store
from dataset_store import (
    PAGE_DEFAULT,
    PAGE_SIZE_DEFAULT,
    PAGE_SIZE_MAX,
)

logger = logging.getLogger("metrivia.app")

# Phase I response compression: the upload payload repeats every column
# name in every row, so an 11.5 MiB CSV becomes ~38 MiB of JSON. Browsers
# always send Accept-Encoding (fetch adds it automatically) and decompress
# transparently, so gzipping the streamed response only shrinks transfer +
# browser buffering with zero frontend changes. Stdlib only (no new
# dependency), level 1: measured 38.4 MiB -> 10.1 MiB in 0.50s locally
# vs 5.7 MiB in 2.23s at level 6 — on Render Free's 0.1 CPU the faster
# level wins back far more transfer time than the extra ~4 MiB costs.
# Only applied above GZIP_MIN_BYTES of raw upload (small uploads skip the
# overhead); health/errors stay uncompressed.
GZIP_COMPRESSLEVEL = 1
GZIP_MIN_BYTES = 64 * 1024

# Application CSV ceiling: 20 MiB. ONE explicit constant — the route, the
# manual read cap, and the Flask backstop below all derive from it.
# NOTE (Render Free honesty): 512 MB RAM / 0.1 CPU means a pathological
# string-heavy 20 MiB CSV can still exhaust memory during pandas parsing
# (object-dtype amplification). The pipeline below minimizes duplicate
# full-dataset copies (single parse, temporaries released, streamed JSON
# instead of one giant string), but 20 MiB is a tested application limit,
# not a guarantee for every possible file on the Free instance.
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "20"))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "5000"))
DEBUG = os.environ.get("FLASK_DEBUG", "") == "1"

# Explicit allowlist for local development. Covers the default Vite port
# (5173) and the fallback port Vite picks when 5173 is busy (5174), on both
# `localhost` and `127.0.0.1` spellings (browsers treat them as different
# origins). No wildcards, no regexes.
DEFAULT_DEV_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
]


def _resolve_cors_origins(explicit=None):
    """Resolve the CORS allowlist.

    An explicit list (e.g. in tests) always wins. Otherwise `CORS_ORIGINS`,
    when set to a non-blank comma-separated value like
    "https://app.example.com,https://admin.example.com", replaces the local
    development defaults entirely — that is how production locks down
    origins. When `CORS_ORIGINS` is unset or blank, the local development
    allowlist above is used.
    """
    if explicit is not None:
        return list(explicit)
    raw = os.environ.get("CORS_ORIGINS", "")
    if raw.strip() == "":
        return list(DEFAULT_DEV_ORIGINS)
    # Strip whitespace and trailing slashes: browsers send
    # `Origin: https://app.example.com` (no trailing slash), so a pasted
    # value like "https://app.example.com/" would otherwise never match.
    return [
        origin.strip().rstrip("/")
        for origin in raw.split(",")
        if origin.strip().rstrip("/")
    ]


CORS_ORIGINS = _resolve_cors_origins()


class UploadError(Exception):
    """A client-facing upload failure with an HTTP status code."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def create_app(cors_origins=None):
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
    CORS(app, resources={r"/api/*": {"origins": _resolve_cors_origins(cors_origins)}})

    @app.get("/api/health")
    def health():
        return (
            jsonify(
                {
                    "status": "ok",
                    "service": "metrivia-backend",
                    "message": "Metrivia backend is running",
                }
            ),
            200,
        )

    @app.post("/api/upload")
    def upload():
        # Phase H stage timing: request receipt → parse → analysis →
        # (serialization streams during transfer). Safe metadata only —
        # never file contents. Logged as one line per upload so slow
        # production uploads can be attributed to a stage.
        request_started = time.perf_counter()
        if "file" not in request.files:
            return _error(
                "No file provided. Send a CSV file as multipart form field 'file'.",
                400,
            )

        storage = request.files["file"]
        filename = (storage.filename or "").strip()
        if not filename:
            return _error("No file selected.", 400)

        safe_name = os.path.basename(filename)
        if not safe_name.lower().endswith(".csv"):
            return _error(
                f"Invalid file type for '{safe_name}'. Only .csv files are accepted.",
                400,
            )

        # Read with a hard cap so oversized bodies get a JSON 413 instead
        # of being buffered unbounded. Nothing is written to disk.
        raw = storage.read(MAX_UPLOAD_BYTES + 1)
        if len(raw) > MAX_UPLOAD_BYTES:
            return _error(
                f"File exceeds the {MAX_UPLOAD_MB} MiB limit. "
                "Please upload a smaller CSV file.",
                413,
            )
        if len(raw) == 0:
            return _error("The uploaded file is empty.", 400)
        if b"\x00" in raw:
            return _error(
                "Could not decode the file. Please upload a UTF-8 encoded CSV file.",
                400,
            )

        # Phase L: same-request backend progress. `?stream=progress` (or an
        # NDJSON Accept header) streams real milestones from this same
        # upload request — no job endpoint, no polling, no Redis/Celery/DB,
        # no WebSocket. Pre-read validation above still returns normal JSON
        # errors with HTTP status; only post-validation processing streams.
        # The streamed response is intentionally NOT gzipped: gzip buffers
        # small progress events until its 64 KiB window fills, which would
        # delay every milestone until the end. The default JSON path below
        # keeps Phase I gzip untouched.
        if _wants_progress_stream():
            raw_size = request.content_length or 0
            return _progress_stream_response(
                raw, safe_name, raw_size, request_started
            )

        try:
            read_started = time.perf_counter()
            df = _read_csv_bytes(raw)
            read_ms = (time.perf_counter() - read_started) * 1000
        except UploadError as exc:
            return _error(exc.message, exc.status)
        except Exception:
            return _error(
                "Failed to analyze the CSV file due to an unexpected error.",
                500,
            )
        finally:
            # Release the raw body before analysis/serialization: at 20 MiB
            # it is the largest single object we can drop early.
            del raw

        try:
            analysis_started = time.perf_counter()
            result = analyze_dataframe(df, safe_name)
            analysis_ms = (time.perf_counter() - analysis_started) * 1000
        except Exception:
            return _error("Failed to analyze the CSV file.", 500)
        # Phase M1: store the DataFrame server-side and return an opaque
        # dataset_id + bounded preview. Small datasets keep the complete
        # preview (compatibility); large datasets return only the head
        # sample (analysis.py bounds it — never 50k row dicts here).
        # TODO (Phase M2): the current frontend still reads dataset.preview
        # for DataTable/filtering/charts. M2 migrates it to dataset_id +
        # GET /api/datasets/<id>/rows server-side pagination instead of
        # relying on the (now bounded for large files) preview.
        try:
            store_ms_start = time.perf_counter()
            result = _store_and_augment(df, result)
            store_ms = (time.perf_counter() - store_ms_start) * 1000
        except Exception:
            return _error("Failed to analyze the CSV file.", 500)
        # The store now owns the DataFrame reference; release our local
        # name (no full row-dict copy is held beyond the bounded preview
        # inside `result`).
        del df
        row_count = result.get("row_count")
        column_count = result.get("column_count")
        raw_size = request.content_length or 0
        response = _stream_json(result)
        use_gzip = raw_size >= GZIP_MIN_BYTES and _accepts_gzip()
        if use_gzip:
            response = _gzip_response(response)
        logger.info(
            "upload filename=%s size_bytes=%d rows=%s cols=%s read_ms=%.1f analysis_ms=%.1f store_ms=%.1f gzip=%d total_ms=%.1f",
            safe_name,
            raw_size,
            row_count,
            column_count,
            read_ms,
            analysis_ms,
            store_ms,
            1 if use_gzip else 0,
            (time.perf_counter() - request_started) * 1000,
        )
        return response, 200

    @app.get("/api/datasets/<dataset_id>")
    def dataset_metadata(dataset_id):
        """Phase M1: metadata for a stored dataset (no row data)."""
        record = dataset_store.get_dataset(dataset_id)
        if record is None:
            return jsonify({"error": "Not found."}), 404
        meta = record.metadata
        return (
            jsonify(
                {
                    "dataset_id": record.dataset_id,
                    "row_count": meta.get("row_count"),
                    "column_count": meta.get("column_count"),
                    "columns": meta.get("columns", []),
                    "preview_count": meta.get("preview_count"),
                    "metadata": {
                        "filename": meta.get("filename"),
                        "dtypes": meta.get("dtypes", {}),
                        "missing": meta.get("missing", {}),
                        "unique": meta.get("unique", {}),
                        "numeric_stats": meta.get("numeric_stats", {}),
                    },
                }
            ),
            200,
        )

    @app.get("/api/datasets/<dataset_id>/rows")
    def dataset_rows(dataset_id):
        """Phase M1: paginated rows for a stored dataset.

        Query params: page (default 0), page_size (default 100, max 500).
        Only the requested slice is serialized; a valid page beyond the
        dataset returns {"rows": []}. The DataFrame is never mutated.
        """
        record = dataset_store.get_dataset(dataset_id)
        if record is None:
            return jsonify({"error": "Not found."}), 404
        page_raw = request.args.get("page", str(PAGE_DEFAULT))
        size_raw = request.args.get("page_size", str(PAGE_SIZE_DEFAULT))
        try:
            page = int(page_raw)
        except (TypeError, ValueError):
            return _error(
                "Invalid 'page'. It must be an integer >= 0.", 400
            )
        try:
            page_size = int(size_raw)
        except (TypeError, ValueError):
            return _error(
                "Invalid 'page_size'. It must be an integer between 1 and "
                f"{PAGE_SIZE_MAX}.",
                400,
            )
        if page < 0:
            return _error(
                "Invalid 'page'. It must be an integer >= 0.", 400
            )
        if page_size < 1 or page_size > PAGE_SIZE_MAX:
            return _error(
                "Invalid 'page_size'. It must be an integer between 1 and "
                f"{PAGE_SIZE_MAX}.",
                400,
            )
        row_count = int(len(record.dataframe))
        start = page * page_size
        end = min(start + page_size, row_count)
        rows = (
            slice_to_records(record.dataframe, start, end)
            if start < row_count
            else []
        )
        return (
            jsonify(
                {
                    "dataset_id": record.dataset_id,
                    "page": page,
                    "page_size": page_size,
                    "row_count": row_count,
                    "rows": rows,
                }
            ),
            200,
        )

    @app.errorhandler(RequestEntityTooLarge)
    def handle_too_large(_exc):
        return (
            jsonify(
                {
                    "error": f"Request exceeds the {MAX_UPLOAD_MB} MiB limit. "
                    "Please upload a smaller CSV file."
                }
            ),
            413,
        )

    @app.errorhandler(404)
    def handle_not_found(_exc):
        return jsonify({"error": "Not found."}), 404

    return app


def _error(message, status):
    return jsonify({"error": message}), status


def _wants_progress_stream():
    """True when the client asked for same-request backend progress.

    Explicit `?stream=progress` wins; an NDJSON Accept header is honored
    too so generic SSE/NDJSON clients get progress without the query param.
    """
    try:
        if request.args.get("stream") == "progress":
            return True
    except Exception:
        pass
    try:
        return "application/x-ndjson" in request.headers.get("Accept", "").lower()
    except Exception:
        return False


def _progress_line(value, stage, label):
    return (
        json.dumps(
            {
                "type": "progress",
                "value": round(float(value), 1),
                "stage": stage,
                "label": label,
            }
        )
        + "\n"
    )


def _progress_error_line(message, status):
    return (
        json.dumps({"type": "error", "error": message, "status": status}) + "\n"
    )


def _build_stored_metadata(result):
    """Extract the storable metadata subset from an analysis payload."""
    return {
        "filename": result.get("filename"),
        "row_count": result.get("row_count"),
        "column_count": result.get("column_count"),
        "columns": list(result.get("columns", [])),
        "dtypes": dict(result.get("dtypes", {})),
        "missing": dict(result.get("missing", {})),
        "unique": dict(result.get("unique", {})),
        "numeric_stats": dict(result.get("numeric_stats", {})),
        "preview_count": result.get("preview_count"),
    }


def _store_and_augment(df, result):
    """Store ``df`` + metadata and inject the opaque dataset_id.

    Single shared helper for both the normal JSON upload and the NDJSON
    progress upload so the two paths can never diverge in storage logic.
    The DataFrame is stored by reference (canonical server-side
    representation); only the already-bounded ``preview`` inside ``result``
    is ever serialized to the client.
    """
    record = dataset_store.create_dataset(df, _build_stored_metadata(result))
    result["dataset_id"] = record.dataset_id
    return result


def _progress_stream_response(raw, safe_name, raw_size, request_started):
    """Stream real backend milestones + the dataset from one upload request.

    Protocol (each progress/error line ends with `\\n`):
        {"type":"progress","value":5,...}   ... one per real milestone,
                                            ordered, monotonic, 0..90
        {"type":"result-start"}              marker: backend work is done
        <raw dataset JSON>                    same shape as POST /api/upload,
                                            chunked via iterencode (Phase H
                                            streaming preserved, never one
                                            giant string on the server)
        \\n
      or, after streaming started:
        {"type":"error","error":msg,"status":400}

    The dataset JSON contains no literal newlines (json encoder escapes
    them), so `\\n` unambiguously delimits the small header lines. Progress
    never reaches 100 here — the client sets exactly 100 only after it has
    parsed the result (i.e. the result is actually usable).
    """

    def generate():
        state = {"raw": raw}
        read_ms = 0.0
        analysis_ms = 0.0
        store_ms = 0.0
        try:
            yield _progress_line(
                PROGRESS_FILE_ACCEPTED, "file_accepted", "File received"
            )
            raw_bytes = state.pop("raw")
            try:
                read_started = time.perf_counter()
                df = _read_csv_bytes(raw_bytes)
                read_ms = (time.perf_counter() - read_started) * 1000
            except UploadError as exc:
                yield _progress_error_line(exc.message, exc.status)
                return
            except Exception:
                yield _progress_error_line(
                    "Failed to analyze the CSV file due to an unexpected error.",
                    500,
                )
                return
            finally:
                del raw_bytes
            yield _progress_line(
                PROGRESS_CSV_PARSED, "csv_parsed", "CSV parsed"
            )

            analysis_started = time.perf_counter()
            result = None
            df_for_store = None
            try:
                for item in _analyze_iter(df, safe_name):
                    if item[0] == "progress":
                        yield _progress_line(item[1], item[2], item[3])
                    elif item[0] == "result":
                        result = item[1]
                # Keep the frame for the store; the local name is released
                # below (the store owns the reference).
                df_for_store = df
            except Exception:
                yield _progress_error_line(
                    "Failed to analyze the CSV file.", 500
                )
                return
            finally:
                try:
                    del df
                except Exception:
                    pass
            analysis_ms = (time.perf_counter() - analysis_started) * 1000
            if result is None:
                yield _progress_error_line(
                    "Failed to analyze the CSV file.", 500
                )
                return
            # Phase M1: same storage logic as the normal JSON upload —
            # bounded preview only, never full row-dict construction for
            # large datasets. The final streamed result carries dataset_id,
            # preview_count, and row_count.
            try:
                store_started = time.perf_counter()
                result = _store_and_augment(df_for_store, result)
                store_ms = (time.perf_counter() - store_started) * 1000
            except Exception:
                yield _progress_error_line(
                    "Failed to analyze the CSV file.", 500
                )
                return
            finally:
                try:
                    del df_for_store
                except Exception:
                    pass
            yield _progress_line(
                PROGRESS_RESPONSE_READY,
                "response_ready",
                "Preparing response",
            )
            yield json.dumps({"type": "result-start"}) + "\n"
            for chunk in json.JSONEncoder().iterencode(result):
                yield chunk.encode("utf-8")
            yield b"\n"
            logger.info(
                "upload stream=1 filename=%s size_bytes=%d rows=%s cols=%s "
                "read_ms=%.1f analysis_ms=%.1f store_ms=%.1f gzip=0 total_ms=%.1f",
                safe_name,
                raw_size,
                result.get("row_count"),
                result.get("column_count"),
                read_ms,
                analysis_ms,
                store_ms,
                (time.perf_counter() - request_started) * 1000,
            )
        finally:
            state.pop("raw", None)

    response = Response(generate(), mimetype="application/x-ndjson")
    response.headers["Cache-Control"] = "no-cache"
    # Tell buffering proxies (nginx, Render's edge) to forward each chunk
    # immediately instead of holding small progress events.
    response.headers["X-Accel-Buffering"] = "no"
    return response, 200


def _stream_json(payload):
    """Serialize a large upload payload without building one giant string.

    `jsonify` materializes the entire body in memory on top of the records
    list; iterencode yields it in chunks so peak memory stays at roughly
    one dataset representation instead of two. The encoder is created
    inside the generator so no reference cycle survives the response.
    """

    def generate():
        for chunk in json.JSONEncoder().iterencode(payload):
            yield chunk.encode("utf-8")

    return Response(generate(), content_type="application/json")


def _accepts_gzip():
    """True when the client advertised gzip support (browsers always do)."""
    return "gzip" in request.headers.get("Accept-Encoding", "").lower()


def _gzip_response(response):
    """Wrap a streamed JSON response in gzip without buffering it.

    Compresses chunk-by-chunk as iterencode produces them, so the 38 MiB
    worst case is never held as one giant string AND never held compressed
    whole either — memory stays bounded while transfer shrinks ~4x.
    """

    # Capture the upstream iterable before rebinding: looking it up lazily
    # inside generate() would resolve to this wrapper itself.
    upstream = response.response

    def generate():
        # iterencode yields thousands of tiny tokens; one zlib call per
        # token would drown in per-call overhead, so buffer to ~64 KiB
        # before compressing (still bounded, still streaming).
        compressor = zlib.compressobj(GZIP_COMPRESSLEVEL, zlib.DEFLATED, 31)
        buffered = []
        buffered_bytes = 0
        for chunk in upstream:
            if isinstance(chunk, str):
                chunk = chunk.encode("utf-8")
            buffered.append(chunk)
            buffered_bytes += len(chunk)
            if buffered_bytes >= 65536:
                out = compressor.compress(b"".join(buffered))
                if out:
                    yield out
                buffered = []
                buffered_bytes = 0
        if buffered:
            out = compressor.compress(b"".join(buffered))
            if out:
                yield out
        tail = compressor.flush()
        if tail:
            yield tail

    response.response = generate()
    response.headers["Content-Encoding"] = "gzip"
    response.headers["Vary"] = "Accept-Encoding"
    response.headers.pop("Content-Length", None)
    return response


def _read_csv_bytes(raw):
    """Parse uploaded CSV bytes into a DataFrame or raise UploadError."""
    df = None
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            df = pd.read_csv(io.BytesIO(raw), encoding=encoding)
            break
        except UnicodeDecodeError:
            continue
        except pd.errors.EmptyDataError:
            raise UploadError(
                "The CSV file is empty. Please upload a file with a header row "
                "and at least one data row."
            ) from None
        except pd.errors.ParserError:
            raise UploadError(
                "The CSV file is malformed and could not be parsed. "
                "Please check delimiters and quoting, then try again."
            ) from None
        except UploadError:
            raise
        except Exception as exc:
            raise UploadError(
                f"Could not parse the CSV file: {exc}"
            ) from None

    if df is None:
        raise UploadError(
            "Could not decode the file. Please upload a UTF-8 encoded CSV file."
        )
    if len(df.columns) == 0:
        raise UploadError("The CSV file has no columns.")
    names = [str(c) for c in df.columns]
    if any(name.strip() == "" or name.startswith("Unnamed: ") for name in names):
        raise UploadError(
            "The CSV file is missing headers. The first row must contain a "
            "name for every column."
        )
    if len(df) == 0:
        raise UploadError(
            "The CSV file contains headers but no data rows."
        )
    return df


app = create_app()


if __name__ == "__main__":
    app.run(host=HOST, port=PORT, debug=DEBUG)
