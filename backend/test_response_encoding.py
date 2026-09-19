"""Response-encoding tests for the Metrivia backend (Phase I).

Covers gzip compression of the upload response (stdlib only, no new
dependency) and the byte-level streaming contract:
- large uploads with Accept-Encoding: gzip get Content-Encoding: gzip +
  Vary, and gunzipping yields byte-exactly the identity payload;
- small uploads skip gzip (no overhead where there is nothing to save);
- clients without Accept-Encoding get the identity stream;
- the upload response stays chunked (no Content-Length), i.e. no giant
  buffered string on top of the records list;
- the Phase H timing log fires with the gzip flag for manual production
  attribution.

Run from the backend directory with:
    .venv\\Scripts\\python -m unittest test_response_encoding -v
"""

import gzip
import io
import json
import unittest

from app import GZIP_MIN_BYTES, app


def make_csv(rows):
    lines = ["id,name,value,day"]
    for i in range(rows):
        lines.append(f"{i},name-{i},{i * 1.5},2021-{(i % 12) + 1:02d}-01")
    return ("\n".join(lines) + "\n").encode("utf-8")


# ~140 KB raw: comfortably above the gzip threshold, tiny to analyze.
BIG_CSV = make_csv(3000)
SMALL_CSV = b"id,value\n1,2\n"

assert len(BIG_CSV) > GZIP_MIN_BYTES
assert len(SMALL_CSV) < GZIP_MIN_BYTES


def post_csv(client, payload, filename, headers=None):
    return client.post(
        "/api/upload",
        data={"file": (io.BytesIO(payload), filename)},
        content_type="multipart/form-data",
        headers=headers or {},
    )


def body_bytes(resp):
    return b"".join(resp.response)


class ResponseEncodingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()

    def test_gzip_roundtrip_is_byte_exact(self):
        plain = post_csv(self.client, BIG_CSV, "big.csv")
        self.assertEqual(plain.status_code, 200)
        self.assertNotIn("Content-Encoding", plain.headers)
        gz = post_csv(
            self.client, BIG_CSV, "big.csv", {"Accept-Encoding": "gzip"}
        )
        self.assertEqual(gz.status_code, 200)
        self.assertEqual(gz.headers.get("Content-Encoding"), "gzip")
        self.assertIn("Accept-Encoding", gz.headers.get("Vary", ""))
        # One-shot generators: capture each body exactly once.
        gz_body = body_bytes(gz)
        plain_body = body_bytes(plain)
        self.assertLess(len(gz_body), len(plain_body))
        self.assertEqual(gzip.decompress(gz_body), plain_body)
        payload = json.loads(plain_body)
        self.assertEqual(payload["row_count"], 3000)
        self.assertEqual(len(payload["preview"]), 3000)

    def test_small_upload_skips_gzip(self):
        resp = post_csv(
            self.client, SMALL_CSV, "small.csv", {"Accept-Encoding": "gzip"}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("Content-Encoding", resp.headers)
        self.assertEqual(resp.get_json()["row_count"], 1)

    def test_no_accept_encoding_gets_identity_stream(self):
        resp = post_csv(self.client, BIG_CSV, "big.csv")
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("Content-Encoding", resp.headers)
        self.assertEqual(resp.content_type, "application/json")
        self.assertEqual(resp.get_json()["row_count"], 3000)

    def test_upload_stays_chunked_without_content_length(self):
        # No Content-Length: the body streams (iterencode + gzip chunks),
        # never materialized as one giant string beside the records list.
        for headers in ({}, {"Accept-Encoding": "gzip"}):
            resp = post_csv(self.client, BIG_CSV, "big.csv", headers)
            self.assertEqual(resp.status_code, 200)
            self.assertIsNone(resp.headers.get("Content-Length"))

    def test_timing_log_reports_gzip_flag(self):
        with self.assertLogs("metrivia.app", level="INFO") as logs:
            post_csv(
                self.client, BIG_CSV, "big.csv", {"Accept-Encoding": "gzip"}
            )
        line = "\n".join(logs.output)
        self.assertIn("upload filename=big.csv", line)
        self.assertIn("rows=3000", line)
        self.assertIn("read_ms=", line)
        self.assertIn("analysis_ms=", line)
        self.assertIn("gzip=1", line)
        with self.assertLogs("metrivia.app", level="INFO") as logs:
            post_csv(self.client, SMALL_CSV, "small.csv")
        self.assertIn("gzip=0", "\n".join(logs.output))


if __name__ == "__main__":
    unittest.main(verbosity=2)
