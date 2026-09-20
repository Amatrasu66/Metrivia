"""Streaming backend-progress tests (Phase L).

Covers POST /api/upload?stream=progress — the same-request NDJSON progress
protocol that lets the frontend progress bar track real backend milestones
instead of an estimated animation:

- progress events are ordered and monotonic, within 0..90 (never 100: the
  client sets exactly 100 only after parsing a usable result);
- a result-start marker precedes the dataset, which is data-equivalent to
  the default JSON response (same shape, same rows);
- the streamed response stays chunked and uncompressed (gzip would buffer
  small progress events until the end);
- pre-validation failures still return JSON errors with HTTP status;
- post-validation failures (malformed CSV) terminate the stream with an
  error event and no result;
- small CSVs complete normally through the stream;
- the default (non-streaming) JSON + gzip path is untouched.

Run from the backend directory with:
    .venv\\Scripts\\python -m unittest test_upload_progress -v
"""

import gzip
import io
import json
import unittest

from app import app

SAMPLE_CSV = b"id,product,price\n1,Widget,10.5\n2,Gadget,20.0\n"
RESULT_MARKER = '{"type": "result-start"}'


def post_stream(client, payload, filename, headers=None):
    return client.post(
        "/api/upload?stream=progress",
        data={"file": (io.BytesIO(payload), filename)},
        content_type="multipart/form-data",
        headers=headers or {},
    )


def parse_stream(resp):
    """Split a streamed body into (progress_events, result_or_None, errors)."""
    body = b"".join(resp.response).decode("utf-8")
    assert RESULT_MARKER in body or '"type": "error"' in body, body[:200]
    if RESULT_MARKER in body:
        header, rest = body.split(RESULT_MARKER, 1)
        result = json.loads(rest.strip())
    else:
        header, result = body, None
    progress, errors = [], []
    for line in header.split("\n"):
        line = line.strip()
        if not line:
            continue
        obj = json.loads(line)
        if obj.get("type") == "progress":
            progress.append(obj)
        elif obj.get("type") == "error":
            errors.append(obj)
        else:
            raise AssertionError(f"unexpected stream line: {line[:120]}")
    return progress, result, errors


class UploadProgressTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()

    def test_progress_ordered_monotonic_bounded(self):
        resp = post_stream(self.client, SAMPLE_CSV, "sample.csv")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("application/x-ndjson", resp.content_type)
        progress, result, errors = parse_stream(resp)
        self.assertEqual(errors, [])
        self.assertGreaterEqual(len(progress), 4)
        values = [p["value"] for p in progress]
        for value in values:
            self.assertGreaterEqual(value, 0)
            self.assertLessEqual(value, 90)
        self.assertEqual(values, sorted(values))
        self.assertLess(max(values), 100)
        stages = [p["stage"] for p in progress]
        self.assertEqual(stages[0], "file_accepted")
        self.assertIn("csv_parsed", stages)
        self.assertIn("response_ready", stages)
        for event in progress:
            self.assertIn("label", event)
            self.assertTrue(event["label"].strip())

    def test_streamed_result_matches_default_json(self):
        plain = self.client.post(
            "/api/upload",
            data={"file": (io.BytesIO(SAMPLE_CSV), "sample.csv")},
            content_type="multipart/form-data",
        )
        self.assertEqual(plain.status_code, 200)
        plain_data = json.loads(b"".join(plain.response))
        resp = post_stream(self.client, SAMPLE_CSV, "sample.csv")
        _, result, _ = parse_stream(resp)
        self.assertIsNotNone(result)
        # Phase M1: each upload mints a unique opaque dataset_id, so the
        # two payloads differ only there — everything else must match.
        self.assertIn("dataset_id", plain_data)
        self.assertIn("dataset_id", result)
        plain_cmp = {k: v for k, v in plain_data.items() if k != "dataset_id"}
        result_cmp = {k: v for k, v in result.items() if k != "dataset_id"}
        self.assertEqual(
            json.dumps(result_cmp, sort_keys=True),
            json.dumps(plain_cmp, sort_keys=True),
        )
        for field in (
            "filename",
            "row_count",
            "column_count",
            "columns",
            "dtypes",
            "missing",
            "unique",
            "numeric_stats",
            "preview",
            "preview_count",
        ):
            self.assertIn(field, result)
        self.assertEqual(result["row_count"], 2)
        self.assertEqual(len(result["preview"]), 2)

    def test_stream_stays_chunked_and_uncompressed(self):
        resp = post_stream(self.client, SAMPLE_CSV, "sample.csv")
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.headers.get("Content-Length"))
        self.assertIsNone(resp.headers.get("Content-Encoding"))
        self.assertEqual(resp.headers.get("X-Accel-Buffering"), "no")

    def test_default_json_gzip_path_untouched(self):
        plain = self.client.post(
            "/api/upload",
            data={"file": (io.BytesIO(SAMPLE_CSV * 2000), "big.csv")},
            content_type="multipart/form-data",
        )
        gz = self.client.post(
            "/api/upload",
            data={"file": (io.BytesIO(SAMPLE_CSV * 2000), "big.csv")},
            content_type="multipart/form-data",
            headers={"Accept-Encoding": "gzip"},
        )
        self.assertEqual(plain.status_code, 200)
        self.assertEqual(gz.status_code, 200)
        self.assertEqual(gz.headers.get("Content-Encoding"), "gzip")
        plain_body = b"".join(plain.response)
        gz_body = json.loads(gzip.decompress(b"".join(gz.response)))
        plain_data = json.loads(plain_body)
        # Phase M1: each upload mints a unique dataset_id — compare the
        # gunzipped payload ignoring that one field.
        self.assertIn("dataset_id", plain_data)
        self.assertIn("dataset_id", gz_body)
        plain_cmp = {k: v for k, v in plain_data.items() if k != "dataset_id"}
        gz_cmp = {k: v for k, v in gz_body.items() if k != "dataset_id"}
        self.assertEqual(
            json.dumps(gz_cmp, sort_keys=True),
            json.dumps(plain_cmp, sort_keys=True),
        )

    def test_pre_validation_errors_stay_json(self):
        resp = post_stream(self.client, b"{}", "data.json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("error", resp.get_json())
        resp = post_stream(self.client, b"", "empty.csv")
        self.assertEqual(resp.status_code, 400)

    def test_malformed_csv_terminates_stream_with_error(self):
        resp = post_stream(
            self.client, b'a,b\n1,"unclosed\n', "bad.csv"
        )
        self.assertEqual(resp.status_code, 200)
        progress, result, errors = parse_stream(resp)
        self.assertIsNone(result)
        self.assertEqual(len(errors), 1)
        self.assertIn("error", errors[0])
        # The stream stops at the error: nothing usable follows it.
        body = b"".join(resp.response).decode("utf-8")
        self.assertNotIn(RESULT_MARKER, body)

    def test_small_csv_completes_through_stream(self):
        resp = post_stream(self.client, b"id,value\n1,2\n", "tiny.csv")
        self.assertEqual(resp.status_code, 200)
        progress, result, errors = parse_stream(resp)
        self.assertEqual(errors, [])
        self.assertIsNotNone(result)
        self.assertEqual(result["row_count"], 1)
        values = [p["value"] for p in progress]
        self.assertEqual(values, sorted(values))


if __name__ == "__main__":
    unittest.main(verbosity=2)
