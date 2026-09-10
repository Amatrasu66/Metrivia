"""CORS regression tests for the Metrivia backend (stdlib only).

Run from the backend directory with:
    .venv\\Scripts\\python -m unittest test_cors -v

Covers the local-dev failure where Vite falls back to port 5174 while the
allowlist only contained 5173: requests from http://localhost:5174 must
receive the matching Access-Control-Allow-Origin header.
"""

import os
import unittest

from app import _resolve_cors_origins, app, create_app

ORIGIN_5173 = "http://localhost:5173"
ORIGIN_5174 = "http://localhost:5174"
DISALLOWED = "https://evil.example.com"

SAMPLE_CSV = b"id,product,category,price\n1,Widget-0001,hardware,10.49\n"


class DefaultAllowlistTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()

    def test_health_reflects_5174(self):
        resp = self.client.get("/api/health", headers={"Origin": ORIGIN_5174})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.headers.get("Access-Control-Allow-Origin"), ORIGIN_5174
        )

    def test_health_reflects_5173(self):
        resp = self.client.get("/api/health", headers={"Origin": ORIGIN_5173})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.headers.get("Access-Control-Allow-Origin"), ORIGIN_5173
        )

    def test_upload_preflight_from_5174(self):
        resp = self.client.options(
            "/api/upload",
            headers={
                "Origin": ORIGIN_5174,
                "Access-Control-Request-Method": "POST",
            },
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.headers.get("Access-Control-Allow-Origin"), ORIGIN_5174
        )

    def test_upload_post_from_5174_carries_header(self):
        import io

        resp = self.client.post(
            "/api/upload",
            data={"file": (io.BytesIO(SAMPLE_CSV), "sample.csv")},
            headers={"Origin": ORIGIN_5174},
            content_type="multipart/form-data",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.headers.get("Access-Control-Allow-Origin"), ORIGIN_5174
        )

    def test_disallowed_origin_gets_no_header(self):
        resp = self.client.get("/api/health", headers={"Origin": DISALLOWED})
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.headers.get("Access-Control-Allow-Origin"))


class OverrideTest(unittest.TestCase):
    def test_explicit_allowlist_replaces_defaults(self):
        client = create_app(cors_origins=["https://app.example.com"]).test_client()
        allowed = client.get(
            "/api/health", headers={"Origin": "https://app.example.com"}
        )
        self.assertEqual(
            allowed.headers.get("Access-Control-Allow-Origin"),
            "https://app.example.com",
        )
        blocked = client.get("/api/health", headers={"Origin": ORIGIN_5174})
        self.assertIsNone(blocked.headers.get("Access-Control-Allow-Origin"))

    def test_cors_origins_env_overrides_defaults(self):
        previous = os.environ.get("CORS_ORIGINS")
        os.environ["CORS_ORIGINS"] = "https://app.example.com, https://admin.example.com "
        try:
            self.assertEqual(
                _resolve_cors_origins(),
                ["https://app.example.com", "https://admin.example.com"],
            )
            client = create_app().test_client()
            resp = client.get(
                "/api/health", headers={"Origin": "https://admin.example.com"}
            )
            self.assertEqual(
                resp.headers.get("Access-Control-Allow-Origin"),
                "https://admin.example.com",
            )
            blocked = client.get("/api/health", headers={"Origin": ORIGIN_5174})
            self.assertIsNone(blocked.headers.get("Access-Control-Allow-Origin"))
        finally:
            if previous is None:
                del os.environ["CORS_ORIGINS"]
            else:
                os.environ["CORS_ORIGINS"] = previous

    def test_blank_env_falls_back_to_dev_allowlist(self):
        previous = os.environ.get("CORS_ORIGINS")
        os.environ["CORS_ORIGINS"] = "   "
        try:
            self.assertIn(ORIGIN_5174, _resolve_cors_origins())
        finally:
            if previous is None:
                del os.environ["CORS_ORIGINS"]
            else:
                os.environ["CORS_ORIGINS"] = previous


if __name__ == "__main__":
    unittest.main(verbosity=2)
