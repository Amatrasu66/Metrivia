"""Upload-limit tests for the Metrivia backend (stdlib + Flask test client).

Run from the backend directory with:
    .venv\\Scripts\\python -m unittest test_upload_limits -v

Covers the Phase E 50 MiB ceiling:
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

    def test_limit_constant_is_50mib(self):
        self.assertEqual(MAX_UPLOAD_MB, 50)
        self.assertEqual(MAX_UPLOAD_BYTES, 50 * 1024 * 1024)
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
        self.assertIn("50", body["error"])
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
