"""Metrivia backend — lightweight Flask analytics API.

Endpoints:
    GET  /api/health   Service health check.
    POST /api/upload   Accept a CSV file (multipart/form-data), analyze it
                       with pandas entirely in memory, and return dataset
                       statistics plus the full row data.

Uploaded files are never written to disk. No database, no auth, no
background workers — intentionally minimal for Render's free tier.
"""

import io
import json
import os

import pandas as pd
from flask import Flask, Response, jsonify, request
from flask_cors import CORS
from werkzeug.exceptions import RequestEntityTooLarge

from analysis import analyze_dataframe

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

        try:
            df = _read_csv_bytes(raw)
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
            result = analyze_dataframe(df, safe_name)
        except Exception:
            return _error("Failed to analyze the CSV file.", 500)
        finally:
            # The records list inside `result` is all the serializer needs;
            # drop the DataFrame (and its object-dtype columns) first.
            del df
        return _stream_json(result), 200

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
