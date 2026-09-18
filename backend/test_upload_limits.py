"""Upload-limit tests for the Metrivia backend (stdlib + Flask test client).

Run from the backend directory with:
    .venv\\Scripts\\python -m unittest test_upload_limits -v

Covers the Phase F 20 MiB ceiling:
- files at/below the limit are accepted with a backward-compatible payload;
- files above the limit get a JSON 413 (never a crash or HTML page);
- non-CSV uploads stay rejected;
- the streamed JSON upload response parses exactly like `jsonify`.
"""

import io
import unittest

from app import MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, app, create_app

SAMPLE_CSV = b"id,product,price\n1,Widget,10.5\n2,Gadget,20.0\n"


def post_csv(client, payload, filename):
    return client.post(
        "/api/upload",
        data={"file": (io.BytesIO(payload), filename)},
        content_type="multipart/form-data",
    )


class UploadLimitTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()

    def test_limit_constant_is_20mib(self):
        self.assertEqual(MAX_UPLOAD_MB, 20)
        self.assertEqual(MAX_UPLOAD_BYTES, 20 * 1024 * 1024)
        self.assertEqual(
            app.config["MAX_CONTENT_LENGTH"], MAX_UPLOAD_BYTES
        )

    def test_small_csv_accepted_with_compatible_payload(self):
        resp = post_csv(self.client, SAMPLE_CSV, "sample.csv")
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
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
            self.assertIn(field, body)
        self.assertEqual(body["row_count"], 2)
        self.assertEqual(len(body["preview"]), 2)
        self.assertEqual(body["preview_count"], 2)

    def test_non_csv_rejected(self):
        resp = post_csv(self.client, b"{}", "data.json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("error", resp.get_json())

    def test_oversized_body_gets_json_413(self):
        big = b"x" * (MAX_UPLOAD_BYTES + 1)
        resp = post_csv(self.client, big, "big.csv")
        self.assertEqual(resp.status_code, 413)
        body = resp.get_json()
        self.assertIn("error", body)
        self.assertIn("20", body["error"])
        self.assertIn("MiB", body["error"])
        del big

    def test_limit_env_override_is_respected(self):
        import os

        previous = os.environ.get("MAX_UPLOAD_MB")
        os.environ["MAX_UPLOAD_MB"] = "1"
        try:
            import importlib

            import app as app_module

            importlib.reload(app_module)
            self.assertEqual(app_module.MAX_UPLOAD_BYTES, 1 * 1024 * 1024)
            client = app_module.create_app().test_client()
            big = b"x" * (1 * 1024 * 1024 + 1)
            resp = post_csv(client, big, "big.csv")
            self.assertEqual(resp.status_code, 413)
            del big
        finally:
            if previous is None:
                del os.environ["MAX_UPLOAD_MB"]
            else:
                os.environ["MAX_UPLOAD_MB"] = previous
            import importlib

            import app as app_module

            importlib.reload(app_module)


    def test_near_limit_accepted_and_over_limit_rejected(self):
        """Phase H boundary: just under MAX bytes -> 200, MAX+1 -> JSON 413.

        Uses a 1 MiB override so the boundary is exercised quickly (a real
        20 MiB valid CSV would run the full analysis in the test). Note the
        limit is enforced at two layers: Flask's MAX_CONTENT_LENGTH counts
        the whole multipart body (file + ~200 B of framing), so the
        effective file ceiling is MAX minus framing overhead; the route's
        own raw-length check then returns a JSON 413 past MAX.
        """
        import os

        previous = os.environ.get("MAX_UPLOAD_MB")
        os.environ["MAX_UPLOAD_MB"] = "1"
        try:
            import importlib

            import app as app_module

            importlib.reload(app_module)
            limit = app_module.MAX_UPLOAD_BYTES
            client = app_module.create_app().test_client()
            header = b"id,value\n"
            # A body comfortably under the limit (multipart framing is only
            # ~200 B) but close enough to prove the boundary region works.
            k = limit - len(header) - len(b"1,") - len(b"\n") - 4096
            near = header + b"1," + b"x" * k + b"\n"
            resp = post_csv(client, near, "near.csv")
            self.assertEqual(resp.status_code, 200)
            body = resp.get_json()
            self.assertEqual(body["row_count"], 1)
            self.assertEqual(len(body["preview"]), 1)
            over = header + b"1," + b"x" * (k + 4097) + b"\n"
            self.assertGreater(len(over), limit)
            resp = post_csv(client, over, "over.csv")
            self.assertEqual(resp.status_code, 413)
            self.assertIn("error", resp.get_json())
            del near, over
        finally:
            if previous is None:
                del os.environ["MAX_UPLOAD_MB"]
            else:
                os.environ["MAX_UPLOAD_MB"] = previous
            import importlib

            import app as app_module

            importlib.reload(app_module)


if __name__ == "__main__":
    unittest.main(verbosity=2)
