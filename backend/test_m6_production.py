"""Metrivia Phase M6 — production hardening tests (stdlib + Flask test client).

Run from the backend directory with:
    .venv\\Scripts\\python -m unittest test_m6_production -v

Covers the M6 acceptance matrix without touching M1-M5 behavior:
- health endpoint is fast, safe (no dataset contents, secrets, or env),
  and JSON on every path;
- API failures are stable JSON {"error": <message>} with correct status
  (no HTML pages, no tracebacks, no file paths);
- malformed JSON / wrong content type on filter + chart -> JSON 400;
- unknown routes -> JSON 404; wrong methods -> JSON 405;
- expired/missing datasets -> consistent JSON 404 on all four endpoints;
- upload hardening: malformed, empty, header-only, duplicate columns,
  unusual Unicode, quoted/newline fields, NaN/Inf, invalid dates,
  inconsistent rows, long fields, string-heavy frames — all graceful;
- high-cardinality grouped charts stay bounded (<= 20); scatter <= 2000;
- concurrent mixed requests stay isolated (no cross-talk, no 500s);
- structured observability lines are emitted (upload/filter/chart/lifecycle)
  without logging contents, values, or secrets.
"""

import io
import json
import logging
import threading
import time
import unittest

import dataset_store
from app import app, create_app

SAMPLE_CSV = b"id,product,price\n1,Widget,10.5\n2,Gadget,20.0\n"


def post_csv(client, payload, filename="sample.csv"):
    return client.post(
        "/api/upload",
        data={"file": (io.BytesIO(payload), filename)},
        content_type="multipart/form-data",
    )


def upload_dataset(_test_case, client, payload, filename="sample.csv"):
    resp = post_csv(client, payload, filename)
    assert resp.status_code == 200, resp.get_data(as_text=True)[:300]
    body = resp.get_json()
    assert "dataset_id" in body, body
    return body


def assert_safe_error(test_case, resp, status):
    """Every API error is JSON {"error": str} with no leakage."""
    test_case.assertEqual(resp.status_code, status)
    self_ct = resp.headers.get("Content-Type", "")
    test_case.assertIn("application/json", self_ct)
    body = resp.get_json()
    test_case.assertIsInstance(body, dict)
    test_case.assertIn("error", body)
    test_case.assertIsInstance(body["error"], str)
    lowered = body["error"].lower()
    for token in ("traceback", ".py", "file \"", "c:\\", "/app/", "secret",
                  "environ", "api_key", "apikey"):
        test_case.assertNotIn(token, lowered, f"leakage token {token!r}")
    return body


class HealthContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()

    def test_health_is_fast_safe_and_json(self):
        started = time.perf_counter()
        resp = self.client.get("/api/health")
        elapsed_ms = (time.perf_counter() - started) * 1000
        self.assertEqual(resp.status_code, 200)
        self.assertIn("application/json", resp.headers.get("Content-Type", ""))
        body = resp.get_json()
        self.assertEqual(body.get("status"), "ok")
        # Safe: fixed keys only — no dataset contents, memory/process info,
        # environment details, or secrets.
        self.assertEqual(
            set(body.keys()), {"status", "service", "message"}
        )
        raw = json.dumps(body).lower()
        for token in ("secret", "environ", "api_key", "memory", "rss",
                      "dataset", "row_count", "traceback"):
            self.assertNotIn(token, raw)
        self.assertLess(elapsed_ms, 1000, "health must answer in <1s locally")

    def test_unknown_route_is_json_404_not_html(self):
        assert_safe_error(self, self.client.get("/api/does-not-exist"), 404)

    def test_wrong_method_is_json_405_not_html(self):
        assert_safe_error(self, self.client.get("/api/upload"), 405)
        assert_safe_error(
            self, self.client.get("/api/datasets/some-id/filter"), 405
        )


class ApiErrorContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()
        body = upload_dataset(cls, cls.client, SAMPLE_CSV)
        cls.dataset_id = body["dataset_id"]
        cls.columns = body["columns"]

    def test_rows_bad_page_is_json_400(self):
        resp = self.client.get(
            f"/api/datasets/{self.dataset_id}/rows?page=nope"
        )
        assert_safe_error(self, resp, 400)

    def test_rows_bad_page_size_is_json_400(self):
        resp = self.client.get(
            f"/api/datasets/{self.dataset_id}/rows?page_size=999999"
        )
        assert_safe_error(self, resp, 400)

    def test_filter_malformed_json_body_is_400(self):
        resp = self.client.post(
            f"/api/datasets/{self.dataset_id}/filter",
            data="{not valid json",
            content_type="application/json",
        )
        assert_safe_error(self, resp, 400)

    def test_filter_wrong_content_type_is_400(self):
        resp = self.client.post(
            f"/api/datasets/{self.dataset_id}/filter",
            data="filters=x",
            content_type="text/plain",
        )
        assert_safe_error(self, resp, 400)

    def test_chart_malformed_json_body_is_400(self):
        resp = self.client.post(
            f"/api/datasets/{self.dataset_id}/chart",
            data="{not valid json",
            content_type="application/json",
        )
        assert_safe_error(self, resp, 400)

    def test_chart_wrong_content_type_is_400(self):
        resp = self.client.post(
            f"/api/datasets/{self.dataset_id}/chart",
            data="{}",
            content_type="text/plain",
        )
        assert_safe_error(self, resp, 400)

    def test_chart_invalid_config_is_400(self):
        resp = self.client.post(
            f"/api/datasets/{self.dataset_id}/chart",
            json={"chart_type": "bar"},
        )
        assert_safe_error(self, resp, 400)

    def test_filter_unknown_column_is_400(self):
        resp = self.client.post(
            f"/api/datasets/{self.dataset_id}/filter",
            json={"filters": [
                {"column": "nope", "operator": "eq", "value": 1}
            ]},
        )
        assert_safe_error(self, resp, 400)


class ExpiredDatasetContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()
        body = upload_dataset(cls, cls.client, SAMPLE_CSV, "expiry.csv")
        cls.dataset_id = body["dataset_id"]
        assert dataset_store.delete_dataset(cls.dataset_id)

    def test_metadata_expired_is_404(self):
        assert_safe_error(
            self, self.client.get(f"/api/datasets/{self.dataset_id}"), 404
        )

    def test_rows_expired_is_404(self):
        assert_safe_error(
            self,
            self.client.get(f"/api/datasets/{self.dataset_id}/rows"),
            404,
        )

    def test_filter_expired_is_404(self):
        assert_safe_error(
            self,
            self.client.post(
                f"/api/datasets/{self.dataset_id}/filter", json={"filters": []}
            ),
            404,
        )

    def test_chart_expired_is_404(self):
        assert_safe_error(
            self,
            self.client.post(
                f"/api/datasets/{self.dataset_id}/chart",
                json={"chart_type": "bar", "dimension": "product",
                      "aggregation": "count"},
            ),
            404,
        )


class UploadHardeningTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()

    def test_malformed_csv_is_safe_400(self):
        resp = post_csv(self.client, b"a,b\n1,2\n3\n4,5,6\n", "bad.csv")
        assert_safe_error(self, resp, 400)

    def test_empty_file_is_safe_400(self):
        resp = post_csv(self.client, b"", "empty.csv")
        assert_safe_error(self, resp, 400)

    def test_header_only_csv_is_usable_400(self):
        resp = post_csv(self.client, b"a,b,c\n", "headers.csv")
        body = assert_safe_error(self, resp, 400)
        self.assertIn("header", body["error"].lower())

    def test_numeric_first_row_treated_as_header(self):
        # A headerless-looking numeric CSV is indistinguishable from a
        # headed one: the first row IS the header (documented, graceful).
        resp = post_csv(self.client, b"1,2\n3,4\n", "noheader.csv")
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["columns"], ["1", "2"])
        self.assertEqual(body["row_count"], 1)

    def test_duplicate_columns_stay_usable(self):
        # pandas mangles duplicates (a, a.1); the upload must stay usable.
        resp = post_csv(self.client, b"a,a,b\n1,2,3\n4,5,6\n", "dups.csv")
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(len(body["columns"]), 3)
        self.assertEqual(len(set(body["columns"])), 3)

    def test_unusual_unicode_is_safe(self):
        payload = (
            "name,note\ncaf\u00e9,na\u00efve \u6f22\u5b57\n"
            "emoji,\U0001f600 test\nzalgo,a\u0301\u0327b\n"
        ).encode("utf-8")
        resp = post_csv(self.client, payload, "unicode.csv")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["row_count"], 3)

    def test_quoted_newline_fields_are_safe(self):
        payload = b'a,b\n1,"line one\nline two"\n2,plain\n'
        resp = post_csv(self.client, payload, "quoted.csv")
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["row_count"], 2)
        self.assertIn("\n", body["preview"][0]["b"])

    def test_nan_inf_become_null_never_crash(self):
        payload = b"a,b\n1,NaN\n2,inf\n3,-inf\n4,5\n"
        resp = post_csv(self.client, payload, "nonfinite.csv")
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        raw = json.dumps(body["preview"])
        self.assertNotIn("NaN", raw)
        self.assertNotIn("Infinity", raw)

    def test_invalid_dates_do_not_crash(self):
        payload = b"d,v\n2021-13-99,1\nnot-a-date,2\n2021-01-05,3\n"
        resp = post_csv(self.client, payload, "dates.csv")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["row_count"], 3)

    def test_long_fields_are_bounded_or_safe(self):
        # A single ~200 KiB field: must be a clean 200 or 400, never a 500
        # with leakage and never a hung process.
        payload = b"a,b\n1," + b"x" * 200_000 + b"\n"
        resp = post_csv(self.client, payload, "longfield.csv")
        self.assertIn(resp.status_code, (200, 400))
        body = resp.get_json()
        self.assertIn(
            "error" if resp.status_code != 200 else "row_count", body
        )
        if resp.status_code != 200:
            self.assertIsInstance(body["error"], str)

    def test_string_heavy_frame_is_bounded(self):
        # High-cardinality strings + many columns (120k cells, ~2.9 MiB):
        # uploads must succeed with a bounded 500-row sample preview,
        # never the full frame.
        cols = 60
        header = (",".join("c%d" % i for i in range(cols))).encode() + b"\n"
        rows = []
        for r in range(2000):
            rows.append(
                ",".join("value-%d-%d-abcdefghij" % (r, c) for c in range(cols)).encode()
            )
        payload = header + b"\n".join(rows) + b"\n"
        self.assertLess(len(payload), 20 * 1024 * 1024)
        resp = post_csv(self.client, payload, "stringy.csv")
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["row_count"], 2000)
        self.assertLessEqual(body["preview_count"], 500)

    def test_zero_row_filter_result_is_empty_not_error(self):
        body = upload_dataset(self, self.client, SAMPLE_CSV, "zero.csv")
        did = body["dataset_id"]
        resp = self.client.post(
            f"/api/datasets/{did}/filter",
            json={"filters": [
                {"column": "product", "operator": "eq", "value": "zzz-no-match"}
            ]},
        )
        self.assertEqual(resp.status_code, 200)
        result = resp.get_json()
        self.assertEqual(result["filtered_row_count"], 0)
        self.assertEqual(result["rows"], [])

    def test_non_csv_extension_rejected(self):
        resp = post_csv(self.client, b"{}", "data.json")
        assert_safe_error(self, resp, 400)


class ChartBoundsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()
        # 60 distinct groups -> grouped charts must truncate to <= 20.
        lines = ["grp,val,day"]
        for i in range(600):
            lines.append("g%02d,%d,2021-01-%02d" % (i % 60, i, (i % 28) + 1))
        payload = ("\n".join(lines) + "\n").encode()
        body = upload_dataset(cls, cls.client, payload, "groups.csv")
        cls.dataset_id = body["dataset_id"]

    def test_high_cardinality_bar_is_bounded(self):
        resp = self.client.post(
            f"/api/datasets/{self.dataset_id}/chart",
            json={"chart_type": "bar", "dimension": "grp",
                  "measure": "val", "aggregation": "sum"},
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertLessEqual(len(body["data"]), 20)
        self.assertTrue(body["truncated"])
        self.assertEqual(body["total_groups"], 60)

    def test_scatter_is_bounded_at_2000(self):
        lines = ["day,val"]
        for i in range(3000):
            lines.append("2021-01-%02d,%d" % ((i % 28) + 1, i))
        payload = ("\n".join(lines) + "\n").encode()
        body = upload_dataset(self, self.client, payload, "scatter.csv")
        resp = self.client.post(
            f"/api/datasets/{body['dataset_id']}/chart",
            json={"chart_type": "scatter", "dimension": "day",
                  "measure": "val"},
        )
        self.assertEqual(resp.status_code, 200)
        result = resp.get_json()
        self.assertLessEqual(len(result["data"]), 2000)
        self.assertTrue(result["truncated"])


class ConcurrencyIsolationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()
        lines = ["grp,val,day"]
        for i in range(2000):
            lines.append("g%02d,%d,2021-02-%02d" % (i % 10, i, (i % 28) + 1))
        payload = ("\n".join(lines) + "\n").encode()
        body = upload_dataset(cls, cls.client, payload, "conc.csv")
        cls.dataset_id = body["dataset_id"]

    def test_mixed_concurrent_requests_are_isolated(self):
        errors = []
        lock = threading.Lock()

        def worker(seed):
            try:
                client = app.test_client()
                did = self.dataset_id
                grp = "g%02d" % (seed % 10)
                f = client.post(
                    f"/api/datasets/{did}/filter",
                    json={"filters": [{"column": "grp", "operator": "eq",
                                       "value": grp}]},
                )
                assert f.status_code == 200, f.status_code
                assert f.get_json()["filtered_row_count"] == 200
                c = client.post(
                    f"/api/datasets/{did}/chart",
                    json={"chart_type": "bar", "dimension": "grp",
                          "measure": "val", "aggregation": "sum"},
                )
                assert c.status_code == 200, c.status_code
                r = client.get(f"/api/datasets/{did}/rows?page=0&page_size=50")
                assert r.status_code == 200, r.status_code
                assert len(r.get_json()["rows"]) == 50
            except Exception as exc:  # noqa: BLE001 - collected, asserted below
                with lock:
                    errors.append(repr(exc))

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(12)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=60)
        self.assertEqual(errors, [])


class StructuredLoggingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = app.test_client()

    def test_filter_chart_upload_emit_safe_lines(self):
        with self.assertLogs("metrivia.app", level="INFO") as captured:
            body = upload_dataset(self, self.client, SAMPLE_CSV, "log.csv")
            did = body["dataset_id"]
            self.client.post(
                f"/api/datasets/{did}/filter", json={"filters": []}
            )
            self.client.post(
                f"/api/datasets/{did}/chart",
                json={"chart_type": "bar", "dimension": "product",
                      "aggregation": "count"},
            )
        output = "\n".join(captured.output)
        self.assertIn("event=filter_query", output)
        self.assertIn("event=chart_query", output)
        lowered = output.lower()
        # Values/contents/secrets must never appear in log lines.
        self.assertNotIn("widget", lowered)
        self.assertNotIn("gadget", lowered)
        self.assertNotIn("secret", lowered)

    def test_dataset_lifecycle_is_logged_without_contents(self):
        with self.assertLogs("metrivia.dataset_store", level="INFO") as captured:
            body = upload_dataset(self, self.client, SAMPLE_CSV, "life.csv")
            dataset_store.delete_dataset(body["dataset_id"])
        output = "\n".join(captured.output)
        self.assertIn("event=dataset_created", output)


class SecurityAuditTest(unittest.TestCase):
    def test_no_eval_exec_query_with_client_strings(self):
        import app as app_module
        import chart_aggregation
        import filter_engine

        for module in (app_module, chart_aggregation, filter_engine):
            with open(module.__file__, encoding="utf-8") as fh:
                src = fh.read()
            self.assertNotIn("eval(", src)
            self.assertNotIn("exec(", src)
            self.assertNotIn(".query(", src)

    def test_debug_disabled_by_default(self):
        import app as app_module

        self.assertFalse(app_module.DEBUG)

    def test_error_responses_never_html(self):
        client = app.test_client()
        probes = [
            ("get", "/api/nope", None),
            ("get", "/api/upload", None),
            ("post", "/api/datasets/abc/filter", {"filters": []}),
        ]
        for method, path, payload in probes:
            if method == "get":
                resp = client.get(path)
            else:
                resp = client.post(path, json=payload)
            self.assertIn(
                "application/json", resp.headers.get("Content-Type", "")
            )
            self.assertNotIn(
                "<html", resp.get_data(as_text=True).lower()
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
