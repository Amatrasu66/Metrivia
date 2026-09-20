"""Phase M5 large-data performance & memory hardening tests.

Covers, against the real 50k x 33 Spotify CSV unless stated otherwise:

- VectorParityTest: tricky frames (garbage dates, floats, bools,
  None/"", inf, Timestamps) produce byte-identical outputs to the
  pre-M5 implementation (snapshotted before optimizing).
- NoPerCellDatetimeRegressionTest: guards M4's vectorized datetime fix —
  per-cell parsing took ~28s; these budgets fail long before that.
- PerfBudgetTest: M4-baseline-derived ceilings (generous for CI noise;
  they catch 10x regressions, not 10% jitter).
- ConcurrencyTest: threaded chart/filter/table traffic, deletion and
  eviction under load, no 500s, no cross-dataset leakage, bounded store.
- LifecycleLeakTest: repeated create -> query -> delete leaves no
  references behind (weakref-proven) and the store empty.
- StressTest: generated 100k x 33, 50k x 65, high-cardinality and
  datetime-heavy datasets (temporary, never committed).
- EncodingBoundsTest: chart responses stay bounded and uncompressed
  (gzip remains upload-only by design).

Run from the backend directory with:
    .venv\\Scripts\\python -m unittest test_performance_m5 -v
NOTE: this is the slow suite (~2-4 min, dominated by real 50k/100k
datasets). Ordinary regression suites stay fast.
"""

import gc
import io
import json
import os
import threading
import time
import unittest
import weakref
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

import dataset_store
from dataset_store import get_store

_HERE = os.path.dirname(os.path.abspath(__file__))
_SPOTIFY = os.path.join(
    _HERE, "..", "test_dataset", "spotify_artist_streaming_2020_2025.csv"
)


def _clear_global_store():
    get_store().clear()


def _make_client():
    from app import create_app

    return create_app(cors_origins=["http://localhost:5173"]).test_client()


def _upload_csv(client, payload, filename):
    return client.post(
        "/api/upload",
        data={"file": (io.BytesIO(payload), filename)},
        content_type="multipart/form-data",
    )


def _tricky_frame():
    return pd.DataFrame(
        {
            "g": ["b", "a", None, "", "b", "2021-13-99", "a", True, 5.0, 5],
            "v": [1.0, 2.0, 3.0, 4.0, float("nan"), 6.0, float("inf"),
                  8.0, 9.0, 10.0],
            "when": ["2021-01-05", "2021-13-99", None, "", "2021-02-10T15:30:00",
                     "2021-02-10", "not-a-date", 5, "2021-01-05", "2021-03-15"],
        }
    )


def _tricky_dtypes():
    return {"g": "text", "v": "numeric", "when": "datetime"}


class VectorParityTest(unittest.TestCase):
    """Byte-identical outputs to the pre-M5 implementation (snapshotted)."""

    def test_text_operators(self):
        from filter_engine import build_filter_mask

        df = _tricky_frame()
        cases = [
            ([{"column": "g", "operator": "eq", "value": "a"}],
             [False, True, False, False, False, False, True, False, False, False]),
            ([{"column": "g", "operator": "neq", "value": "a"}],
             [True, False, False, False, True, True, False, True, True, True]),
            ([{"column": "g", "operator": "in", "value": ["a", "(blank)"]}],
             [False, True, True, True, False, False, True, False, False, False]),
            ([{"column": "g", "operator": "not_in", "value": ["a", "(blank)"]}],
             [True, False, False, False, True, True, False, True, True, True]),
            ([{"column": "g", "operator": "contains", "value": "2"}],
             [False, False, False, False, False, True, False, False, False, False]),
            ([{"column": "g", "operator": "not_contains", "value": "a"}],
             [True, False, False, False, True, True, False, True, True, True]),
            ([{"column": "g", "operator": "starts_with", "value": "20"}],
             [False, False, False, False, False, True, False, False, False, False]),
            ([{"column": "g", "operator": "ends_with", "value": "9"}],
             [False, False, False, False, False, True, False, False, False, False]),
            ([{"column": "g", "operator": "is_empty", "value": None}],
             [False, False, True, True, False, False, False, False, False, False]),
        ]
        for filters, expected in cases:
            mask = build_filter_mask(df, filters, _tricky_dtypes())
            self.assertEqual(mask.tolist(), expected, filters)

    def test_datetime_operators(self):
        from filter_engine import build_filter_mask

        df = _tricky_frame()
        cases = [
            ([{"column": "when", "operator": "gte", "value": "2021-02-01"}],
             [False, True, False, False, True, True, False, False, False, True]),
            ([{"column": "when", "operator": "eq", "value": "2021-01-05"}],
             [True, False, False, False, False, False, False, False, True, False]),
            ([{"column": "when", "operator": "in",
               "value": ["2021-01-05", "2021-02-10T15:30:00"]}],
             [True, False, False, False, True, False, False, False, True, False]),
            ([{"column": "when", "operator": "not_in", "value": ["2021-01-05"]}],
             [False, False, False, False, True, True, False, True, False, True]),
        ]
        for filters, expected in cases:
            mask = build_filter_mask(df, filters, _tricky_dtypes())
            self.assertEqual(mask.tolist(), expected, filters)

    def test_grouped_aggregations(self):
        import chart_aggregation as ca

        df = _tricky_frame()
        cols = ["g", "v", "when"]
        expected_sum = [
            {"label": "5", "value": 10.0},
            {"label": "5.0", "value": 9.0},
            {"label": "true", "value": 8.0},
            {"label": "2021-13-99", "value": 6.0},
            {"label": "a", "value": 2.0},
            {"label": "b", "value": 1.0},
            {"label": "(blank)", "value": 7.0},
        ]
        for agg, tweak in [("sum", {}), ("average", {}), ("min", {}),
                           ("max", {}), ("count", {})]:
            norm = ca.validate_chart_request(
                {"chart_type": "bar", "dimension": "g", "measure": "v",
                 "aggregation": agg, "filters": []},
                cols, _tricky_dtypes())
            result = ca.aggregate_chart(df, norm, _tricky_dtypes())
            if agg == "sum":
                self.assertEqual(result["data"], expected_sum)
            # Count keeps per-group row counts (blank group has 2 rows).
            if agg == "count":
                by_label = {d["label"]: d["value"] for d in result["data"]}
                self.assertEqual(by_label["(blank)"], 2)
                self.assertEqual(by_label["a"], 2)

    def test_datetime_grouping_and_scatter(self):
        import chart_aggregation as ca

        df = _tricky_frame()
        cols = ["g", "v", "when"]
        norm = ca.validate_chart_request(
            {"chart_type": "line", "dimension": "when", "measure": "v",
             "aggregation": "sum", "filters": []}, cols, _tricky_dtypes())
        result = ca.aggregate_chart(df, norm, _tricky_dtypes())
        self.assertEqual(
            result["data"],
            [
                {"label": "1970-01-01", "value": 8.0},
                {"label": "2021-01-05", "value": 10.0},
                {"label": "2021-02-10", "value": 6.0},
                {"label": "2021-03-15", "value": 10.0},
                {"label": "(blank)", "value": 9.0},
            ])
        norm = ca.validate_chart_request(
            {"chart_type": "scatter", "dimension": "when", "measure": "v",
             "filters": []}, cols, _tricky_dtypes())
        result = ca.aggregate_chart(df, norm, _tricky_dtypes())
        self.assertEqual(
            result["data"],
            [
                {"x": "1970-01-01T00:00:00.000000005", "y": 8.0},
                {"x": "2021-01-05T00:00:00", "y": 1.0},
                {"x": "2021-01-05T00:00:00", "y": 9.0},
                {"x": "2021-02-10T00:00:00", "y": 6.0},
                {"x": "2021-03-15T00:00:00", "y": 10.0},
            ])


class NoPerCellDatetimeRegressionTest(unittest.TestCase):
    """M4's vectorized datetime fix must never regress to ~28s parsing."""

    @classmethod
    def setUpClass(cls):
        _clear_global_store()
        import numpy as _np

        _np.random.seed(7)
        n = 50000
        base = pd.date_range("2020-01-01", periods=2192, freq="D")
        cls.df = pd.DataFrame(
            {
                "when": [str(base[i % 2192].date()) for i in range(n)],
                "v": _np.random.rand(n) * 100,
            }
        )
        cls.dtypes = {"when": "datetime", "v": "numeric"}
        cls.columns = ["when", "v"]

    def test_line_chart_fast(self):
        import chart_aggregation as ca

        norm = ca.validate_chart_request(
            {"chart_type": "line", "dimension": "when", "measure": "v",
             "aggregation": "sum", "filters": []},
            self.columns, self.dtypes)
        started = time.perf_counter()
        result = ca.aggregate_chart(self.df, norm, self.dtypes)
        elapsed = time.perf_counter() - started
        print(f"\n[datetime-guard] line 50k: {elapsed:.2f}s")
        self.assertLess(elapsed, 8.0)
        self.assertTrue(result["truncated"])

    def test_datetime_filter_fast(self):
        from filter_engine import build_filter_mask

        started = time.perf_counter()
        mask = build_filter_mask(
            self.df,
            [{"column": "when", "operator": "gte", "value": "2021-06-01"}],
            self.dtypes)
        elapsed = time.perf_counter() - started
        print(f"[datetime-guard] filter 50k: {elapsed:.2f}s")
        self.assertLess(elapsed, 8.0)
        self.assertGreater(int(mask.sum()), 0)


class PerfBudgetTest(unittest.TestCase):
    """M4-baseline-derived ceilings (fail only on ~10x regressions)."""

    @classmethod
    def setUpClass(cls):
        _clear_global_store()
        cls.client = _make_client()
        with open(_SPOTIFY, "rb") as handle:
            payload = handle.read()
        started = time.perf_counter()
        resp = _upload_csv(cls.client, payload, "spotify.csv")
        cls.upload_s = time.perf_counter() - started
        assert resp.status_code == 200, resp.status_code
        body = json.loads(b"".join(resp.response))
        cls.dataset_id = body["dataset_id"]
        print(f"\n[budget] upload 50k x 33: {cls.upload_s:.2f}s")

    @classmethod
    def tearDownClass(cls):
        _clear_global_store()

    def _chart(self, payload, budget, name):
        started = time.perf_counter()
        resp = self.client.post(
            f"/api/datasets/{self.dataset_id}/chart", json=payload)
        elapsed = (time.perf_counter() - started) * 1000
        self.assertEqual(resp.status_code, 200, name)
        body = json.loads(resp.data)
        size = len(json.dumps(body))
        print(f"[budget] {name}: {elapsed:.0f}ms, {size} bytes")
        self.assertLess(elapsed, budget, name)
        return body

    def test_upload_budget(self):
        # M4 baseline ~4.2s (same method, local test client).
        self.assertLess(self.upload_s, 30.0)

    def test_chart_budgets(self):
        ds = self.dataset_id
        del ds
        self._chart(
            {"chart_type": "bar", "dimension": "genre",
             "measure": "stream_count", "aggregation": "sum"}, 3000, "bar")
        self._chart(
            {"chart_type": "line", "dimension": "release_date",
             "measure": "stream_count", "aggregation": "sum"}, 3000, "line")
        self._chart(
            {"chart_type": "area", "dimension": "release_date",
             "measure": "stream_count", "aggregation": "average"}, 3000, "area")
        self._chart(
            {"chart_type": "pie", "dimension": "genre",
             "measure": "stream_count", "aggregation": "sum"}, 3000, "pie")
        body = self._chart(
            {"chart_type": "scatter", "dimension": "release_date",
             "measure": "stream_count"}, 4000, "scatter")
        self.assertLessEqual(len(body["data"]), 2000)

    def test_filter_budgets(self):
        for name, filters in [
            ("filter-cat", [{"column": "genre", "operator": "in",
                             "value": ["Pop"]}]),
            ("filter-num", [{"column": "popularity", "operator": "gte",
                             "value": 80}]),
            ("filter-dt", [{"column": "release_date", "operator": "gte",
                            "value": "2023-01-01"}]),
        ]:
            started = time.perf_counter()
            resp = self.client.post(
                f"/api/datasets/{self.dataset_id}/filter",
                json={"filters": filters, "page": 0, "page_size": 200})
            elapsed = (time.perf_counter() - started) * 1000
            self.assertEqual(resp.status_code, 200, name)
            print(f"[budget] {name}: {elapsed:.0f}ms")
            self.assertLess(elapsed, 4000, name)


class ConcurrencyTest(unittest.TestCase):
    """Threaded chart/filter/table traffic: safe, consistent, bounded."""

    def setUp(self):
        _clear_global_store()
        from app import create_app

        self.app = create_app(cors_origins=["http://localhost:5173"])
        with open(_SPOTIFY, "rb") as handle:
            payload = handle.read()
        resp = _upload_csv(self.app.test_client(), payload, "spotify.csv")
        assert resp.status_code == 200
        self.dataset_id = json.loads(b"".join(resp.response))["dataset_id"]

    def tearDown(self):
        _clear_global_store()

    def test_mixed_concurrent_reads(self):
        errors = []
        results = {"chart": [], "filter": [], "rows": []}

        def worker(kind, index):
            try:
                client = self.app.test_client()
                if kind == "chart":
                    resp = client.post(
                        f"/api/datasets/{self.dataset_id}/chart",
                        json={"chart_type": "bar", "dimension": "genre",
                              "measure": "stream_count", "aggregation": "sum",
                              "filters": [{"column": "genre",
                                           "operator": "in",
                                           "value": ["Pop", "Rock"]}]})
                    body = json.loads(resp.data)
                    results["chart"].append(
                        (resp.status_code, body.get("filtered_row_count")))
                elif kind == "filter":
                    resp = client.post(
                        f"/api/datasets/{self.dataset_id}/filter",
                        json={"filters": [{"column": "genre",
                                           "operator": "in",
                                           "value": ["Pop", "Rock"]}],
                              "page": index % 5, "page_size": 200})
                    body = json.loads(resp.data)
                    results["filter"].append(
                        (resp.status_code, body.get("filtered_row_count")))
                else:
                    resp = client.get(
                        f"/api/datasets/{self.dataset_id}/rows"
                        f"?page={index % 10}&page_size=200")
                    body = json.loads(resp.data)
                    results["rows"].append(
                        (resp.status_code, len(body.get("rows", []))))
            except Exception as exc:  # pragma: no cover - failure path
                errors.append(repr(exc))

        kinds = (["chart"] * 8) + (["filter"] * 8) + (["rows"] * 8)
        with ThreadPoolExecutor(max_workers=12) as pool:
            list(pool.map(lambda ki: worker(*ki), enumerate(kinds) and
                          [(k, i) for i, k in enumerate(kinds)]))
        self.assertEqual(errors, [])
        self.assertEqual(len(results["chart"]), 8)
        self.assertEqual(len(results["filter"]), 8)
        self.assertEqual(len(results["rows"]), 8)
        for status, _ in results["chart"] + results["filter"] + results["rows"]:
            self.assertEqual(status, 200)
        # Same filter -> same authoritative count on every thread.
        counts = {count for _, count in results["chart"]}
        self.assertEqual(len(counts), 1)
        counts = {count for _, count in results["filter"]}
        self.assertEqual(len(counts), 1)

    def test_delete_during_requests_never_500s(self):
        statuses = []

        def reader():
            try:
                client = self.app.test_client()
                resp = client.post(
                    f"/api/datasets/{self.dataset_id}/chart",
                    json={"chart_type": "pie", "dimension": "genre",
                          "measure": "stream_count", "aggregation": "sum"})
                statuses.append(resp.status_code)
            except Exception:
                statuses.append("exception")

        def deleter():
            time.sleep(0.02)
            dataset_store.delete_dataset(self.dataset_id)

        threads = ([threading.Thread(target=reader) for _ in range(6)]
                   + [threading.Thread(target=deleter)])
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(len(statuses), 6)
        for status in statuses:
            self.assertIn(status, (200, 404))

    def test_eviction_bounded_no_crosstalk(self):
        old_max = dataset_store.MAX_DATASETS
        dataset_store.MAX_DATASETS = 2
        try:
            client = self.app.test_client()
            ids = []
            for name in ("a.csv", "b.csv", "c.csv"):
                payload = b"id,v\n1,10\n2,20\n"
                resp = _upload_csv(client, payload, name)
                self.assertEqual(resp.status_code, 200)
                ids.append(json.loads(b"".join(resp.response))["dataset_id"])
            # a.csv evicted (LRU, max 2).
            self.assertEqual(
                client.get(f"/api/datasets/{ids[0]}").status_code, 404)
            for alive in ids[1:]:
                resp = client.get(f"/api/datasets/{alive}/rows?page=0&page_size=10")
                self.assertEqual(resp.status_code, 200)
                body = json.loads(resp.data)
                self.assertEqual(body["dataset_id"], alive)
                self.assertEqual(len(body["rows"]), 2)
            self.assertLessEqual(len(get_store()), 2)
        finally:
            dataset_store.MAX_DATASETS = old_max


class LifecycleLeakTest(unittest.TestCase):
    """Repeated lifecycles retain nothing after delete/expire."""

    def setUp(self):
        _clear_global_store()
        self.client = _make_client()

    def tearDown(self):
        _clear_global_store()

    def test_repeated_lifecycle_leaves_empty_store(self):
        for _ in range(5):
            resp = _upload_csv(self.client, b"id,v\n1,10\n2,20\n", "t.csv")
            self.assertEqual(resp.status_code, 200)
            dataset_id = json.loads(b"".join(resp.response))["dataset_id"]
            self.client.post(
                f"/api/datasets/{dataset_id}/filter",
                json={"filters": [], "page": 0, "page_size": 10})
            self.client.post(
                f"/api/datasets/{dataset_id}/chart",
                json={"chart_type": "bar", "dimension": "id",
                      "measure": "v", "aggregation": "sum"})
            dataset_store.delete_dataset(dataset_id)
        self.assertEqual(len(get_store()), 0)

    def test_deleted_dataframe_is_released(self):
        import numpy as _np

        df = pd.DataFrame({"a": _np.arange(1000)})
        record = dataset_store.create_dataset(
            df, {"columns": ["a"], "dtypes": {"a": "numeric"}})
        ref = weakref.ref(record.dataframe)
        dataset_store.delete_dataset(record.dataset_id)
        del record
        del df
        gc.collect()
        self.assertIsNone(ref())

    def test_expired_dataset_unreachable(self):
        old_ttl = dataset_store.DATASET_TTL_SECONDS
        dataset_store.DATASET_TTL_SECONDS = 0
        try:
            resp = _upload_csv(self.client, b"id,v\n1,10\n", "t.csv")
            dataset_id = json.loads(b"".join(resp.response))["dataset_id"]
            # TTL 0: the next access finds it expired.
            self.assertEqual(
                self.client.get(f"/api/datasets/{dataset_id}").status_code,
                404)
            self.assertEqual(
                self.client.post(
                    f"/api/datasets/{dataset_id}/chart",
                    json={"chart_type": "bar", "dimension": "id",
                          "measure": "v", "aggregation": "sum"}).status_code,
                404)
        finally:
            dataset_store.DATASET_TTL_SECONDS = old_ttl


def _synthetic_frame(n_rows, n_numeric, n_categorical, n_datetime,
                     n_text, seed):
    import numpy as _np

    rng = _np.random.default_rng(seed)
    data = {}
    for i in range(n_numeric):
        data[f"num_{i}"] = rng.normal(0, 100, n_rows)
    for i in range(n_categorical):
        data[f"cat_{i}"] = rng.choice(
            [f"group-{j}" for j in range(20)], n_rows)
    base = pd.Timestamp("2020-01-01")
    for i in range(n_datetime):
        offsets = rng.integers(0, 2192, n_rows)
        data[f"dt_{i}"] = [
            (base + pd.Timedelta(days=int(o))).date().isoformat()
            for o in offsets
        ]
    for i in range(n_text):
        data[f"txt_{i}"] = [f"note-{k % 997}-{(k * 31) % 101}"
                            for k in range(n_rows)]
    return pd.DataFrame(data)


def _store_frame(frame, filename):
    from analysis import analyze_dataframe

    result = analyze_dataframe(frame, filename)
    return dataset_store.create_dataset(
        frame,
        {
            "filename": result.get("filename"),
            "row_count": result.get("row_count"),
            "column_count": result.get("column_count"),
            "columns": list(result.get("columns", [])),
            "dtypes": dict(result.get("dtypes", {})),
            "missing": dict(result.get("missing", {})),
            "unique": dict(result.get("unique", {})),
            "numeric_stats": dict(result.get("numeric_stats", {})),
            "preview_count": result.get("preview_count"),
        })


class StressTest(unittest.TestCase):
    """Generated workloads beyond 50k x 33 (temporary, never committed)."""

    def setUp(self):
        _clear_global_store()
        self.client = _make_client()

    def tearDown(self):
        _clear_global_store()

    def _exercise(self, record, numeric, categorical, datetime_col):
        client = self.client
        dataset_id = record.dataset_id
        started = time.perf_counter()
        resp = client.post(
            f"/api/datasets/{dataset_id}/filter",
            json={"filters": [{"column": numeric, "operator": "gte",
                               "value": 0}],
                  "page": 0, "page_size": 200})
        filter_ms = (time.perf_counter() - started) * 1000
        self.assertEqual(resp.status_code, 200)
        filter_rows = json.loads(resp.data).get("filtered_row_count")
        started = time.perf_counter()
        resp = client.post(
            f"/api/datasets/{dataset_id}/chart",
            json={"chart_type": "bar", "dimension": categorical,
                  "measure": numeric, "aggregation": "sum"})
        chart_ms = (time.perf_counter() - started) * 1000
        self.assertEqual(resp.status_code, 200)
        body = json.loads(resp.data)
        self.assertLessEqual(len(body["data"]), 20)
        started = time.perf_counter()
        resp = client.post(
            f"/api/datasets/{dataset_id}/chart",
            json={"chart_type": "scatter", "dimension": datetime_col,
                  "measure": numeric})
        scatter_ms = (time.perf_counter() - started) * 1000
        self.assertEqual(resp.status_code, 200)
        scatter = json.loads(resp.data)
        self.assertLessEqual(len(scatter["data"]), 2000)
        return filter_ms, filter_rows, chart_ms, len(json.dumps(body)), scatter_ms

    def test_100k_x_33(self):
        frame = _synthetic_frame(100000, 12, 12, 5, 4, seed=11)
        csv_bytes = frame.to_csv(index=False).encode("utf-8")
        print(f"\n[stress-B] csv MiB: {len(csv_bytes) / 1048576:.1f}")
        # The 20 MiB upload ceiling must still reject this at the door.
        resp = _upload_csv(self.client, csv_bytes, "big.csv")
        self.assertEqual(resp.status_code, 413)
        started = time.perf_counter()
        record = _store_frame(frame, "big.csv")
        analyze_s = time.perf_counter() - started
        filter_ms, rows, chart_ms, size, scatter_ms = self._exercise(
            record, "num_0", "cat_0", "dt_0")
        print(f"[stress-B] 100k x 33 analyze={analyze_s:.1f}s "
              f"filter={filter_ms:.0f}ms chart={chart_ms:.0f}ms "
              f"scatter={scatter_ms:.0f}ms bytes={size} rows={rows}")
        self.assertLess(chart_ms, 10000)
        self.assertLess(scatter_ms, 10000)

    def test_50k_wide(self):
        frame = _synthetic_frame(50000, 25, 15, 10, 15, seed=22)
        self.assertGreaterEqual(len(frame.columns), 60)
        started = time.perf_counter()
        record = _store_frame(frame, "wide.csv")
        analyze_s = time.perf_counter() - started
        filter_ms, rows, chart_ms, size, scatter_ms = self._exercise(
            record, "num_0", "cat_0", "dt_0")
        print(f"[stress-C] 50k x {len(frame.columns)} analyze={analyze_s:.1f}s "
              f"filter={filter_ms:.0f}ms chart={chart_ms:.0f}ms "
              f"scatter={scatter_ms:.0f}ms bytes={size}")
        self.assertLess(chart_ms, 10000)

    def test_high_cardinality(self):
        import numpy as _np

        n = 50000
        frame = pd.DataFrame(
            {"uid": [f"user-{i:06d}" for i in range(n)],
             "v": _np.random.default_rng(33).normal(0, 1, n)})
        record = _store_frame(frame, "highcard.csv")
        resp = self.client.post(
            f"/api/datasets/{record.dataset_id}/chart",
            json={"chart_type": "bar", "dimension": "uid",
                  "measure": "v", "aggregation": "sum"})
        self.assertEqual(resp.status_code, 200)
        body = json.loads(resp.data)
        print(f"[stress-D] groups={body.get('total_groups')} "
              f"shown={body.get('shown_groups')} "
              f"truncated={body.get('truncated')}")
        self.assertEqual(body.get("total_groups"), n)
        self.assertLessEqual(len(body["data"]), 20)
        self.assertTrue(body.get("truncated"))

    def test_datetime_heavy(self):
        import numpy as _np

        n = 50000
        base = pd.Timestamp("2020-01-01")
        rng = _np.random.default_rng(44)
        frame = pd.DataFrame(
            {f"dt_{i}": [(base + pd.Timedelta(days=int(o))).date().isoformat()
                         for o in rng.integers(0, 2192, n)]
             for i in range(6)})
        frame["v"] = rng.normal(0, 1, n)
        record = _store_frame(frame, "dates.csv")
        started = time.perf_counter()
        resp = self.client.post(
            f"/api/datasets/{record.dataset_id}/filter",
            json={"filters": [{"column": "dt_0", "operator": "gte",
                               "value": "2023-01-01"},
                              {"column": "dt_1", "operator": "lte",
                               "value": "2024-01-01"}],
                  "page": 0, "page_size": 200})
        filter_ms = (time.perf_counter() - started) * 1000
        self.assertEqual(resp.status_code, 200)
        started = time.perf_counter()
        resp = self.client.post(
            f"/api/datasets/{record.dataset_id}/chart",
            json={"chart_type": "line", "dimension": "dt_2",
                  "measure": "v", "aggregation": "sum"})
        chart_ms = (time.perf_counter() - started) * 1000
        self.assertEqual(resp.status_code, 200)
        body = json.loads(resp.data)
        print(f"[stress-E] datetime-heavy filter={filter_ms:.0f}ms "
              f"line={chart_ms:.0f}ms groups={body.get('total_groups')}")
        self.assertLess(filter_ms, 8000)
        self.assertLess(chart_ms, 8000)


class EncodingBoundsTest(unittest.TestCase):
    """Chart payloads stay bounded and pass through uncompressed."""

    def setUp(self):
        _clear_global_store()
        self.client = _make_client()
        with open(_SPOTIFY, "rb") as handle:
            payload = handle.read()
        resp = _upload_csv(self.client, payload, "spotify.csv")
        assert resp.status_code == 200
        self.dataset_id = json.loads(b"".join(resp.response))["dataset_id"]

    def tearDown(self):
        _clear_global_store()

    def test_chart_responses_bounded_uncompressed(self):
        cases = [
            {"chart_type": "bar", "dimension": "genre",
             "measure": "stream_count", "aggregation": "sum"},
            {"chart_type": "scatter", "dimension": "release_date",
             "measure": "stream_count"},
        ]
        for payload in cases:
            resp = self.client.post(
                f"/api/datasets/{self.dataset_id}/chart", json=payload)
            self.assertEqual(resp.status_code, 200)
            # gzip stays upload-only: chart payloads are already tiny.
            self.assertNotEqual(
                resp.headers.get("Content-Encoding"), "gzip")
            body = json.loads(resp.data)
            self.assertLessEqual(len(body["data"]), 2000)


if __name__ == "__main__":
    unittest.main()
