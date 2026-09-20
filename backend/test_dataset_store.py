"""Phase M1 dataset-session tests.

Covers the backend dataset-session foundation:

- Store lifecycle (create/get/touch/delete/missing/TTL/LRU/max/threads)
- Upload compatibility (small full preview, large bounded preview)
- Pagination (first/middle/final/beyond/defaults/max/invalid)
- Serialization (NaN/inf/timestamps/nullable/numbers/bools/strings)
- Isolation (two datasets never cross rows)
- Expiry (expired IDs 404 from metadata + rows endpoints)
- Large-file regression (~50k x 33, plus the repo Spotify CSV when present)

Run from the backend directory with:
    .venv\\Scripts\\python -m unittest test_dataset_store -v
"""

import io
import json
import os
import threading
import time
import unittest

import pandas as pd

import dataset_store
from dataset_store import (
    FULL_PREVIEW_MAX_CELLS,
    FULL_PREVIEW_MAX_ROWS,
    SAMPLE_PREVIEW_ROWS,
    DatasetStore,
    get_store,
    resolve_preview_limit,
)


def _clear_global_store():
    get_store().clear()


def _post_csv(client, payload, filename, query=""):
    return client.post(
        f"/api/upload{query}",
        data={"file": (io.BytesIO(payload), filename)},
        content_type="multipart/form-data",
    )


def _make_small_csv():
    return b"id,product,price\n1,Widget,10.5\n2,Gadget,20.0\n"


def _upload_small(client):
    resp = _post_csv(client, _make_small_csv(), "small.csv")
    assert resp.status_code == 200, resp.status_code
    return json.loads(b"".join(resp.response))


class PreviewPolicyTest(unittest.TestCase):
    def test_small_returns_full(self):
        self.assertEqual(resolve_preview_limit(2, 3), 2)
        self.assertEqual(
            resolve_preview_limit(FULL_PREVIEW_MAX_ROWS, 10),
            FULL_PREVIEW_MAX_ROWS,
        )

    def test_row_boundary(self):
        # One row over the max -> sampled even with a single column.
        self.assertEqual(
            resolve_preview_limit(FULL_PREVIEW_MAX_ROWS + 1, 1),
            SAMPLE_PREVIEW_ROWS,
        )

    def test_cell_boundary(self):
        # 5000 x 20 = 100000 cells -> full; 5000 x 21 -> sampled.
        cols_full = FULL_PREVIEW_MAX_CELLS // FULL_PREVIEW_MAX_ROWS
        self.assertEqual(
            resolve_preview_limit(FULL_PREVIEW_MAX_ROWS, cols_full),
            FULL_PREVIEW_MAX_ROWS,
        )
        self.assertEqual(
            resolve_preview_limit(FULL_PREVIEW_MAX_ROWS, cols_full + 1),
            SAMPLE_PREVIEW_ROWS,
        )

    def test_large_returns_bounded_sample(self):
        self.assertEqual(
            resolve_preview_limit(50000, 33), SAMPLE_PREVIEW_ROWS
        )
        self.assertLessEqual(SAMPLE_PREVIEW_ROWS, 500)


class StoreLifecycleTest(unittest.TestCase):
    def test_create_get_touch_delete(self):
        store = DatasetStore(ttl_seconds=60, max_datasets=10)
        df = pd.DataFrame({"a": [1, 2]})
        rec = store.create_dataset(df, {"row_count": 2})
        self.assertTrue(rec.dataset_id)
        self.assertEqual(len(rec.dataset_id), 32)  # uuid hex, opaque
        fetched = store.get_dataset(rec.dataset_id)
        self.assertIsNotNone(fetched)
        self.assertIs(fetched.dataframe, df)  # stored by reference
        self.assertTrue(store.touch_dataset(rec.dataset_id))
        self.assertTrue(store.delete_dataset(rec.dataset_id))
        self.assertIsNone(store.get_dataset(rec.dataset_id))
        self.assertFalse(store.delete_dataset(rec.dataset_id))

    def test_missing_id_returns_none(self):
        store = DatasetStore(ttl_seconds=60, max_datasets=10)
        self.assertIsNone(store.get_dataset("does-not-exist"))
        self.assertFalse(store.touch_dataset("does-not-exist"))
        self.assertFalse(store.delete_dataset("does-not-exist"))

    def test_ids_are_unique_and_opaque(self):
        store = DatasetStore(ttl_seconds=60, max_datasets=100)
        df = pd.DataFrame({"a": [1]})
        ids = {store.create_dataset(df, {}).dataset_id for _ in range(50)}
        self.assertEqual(len(ids), 50)
        for dataset_id in ids:
            # Opaque hex, carries no row/column info.
            self.assertEqual(len(dataset_id), 32)
            int(dataset_id, 16)

    def test_ttl_expiry(self):
        now = [1000.0]
        store = DatasetStore(
            ttl_seconds=10, max_datasets=10, now_fn=lambda: now[0]
        )
        rec = store.create_dataset(pd.DataFrame({"a": [1]}), {})
        self.assertIsNotNone(store.get_dataset(rec.dataset_id))
        now[0] += 11.0  # past TTL
        self.assertIsNone(store.get_dataset(rec.dataset_id))
        self.assertEqual(len(store), 0)

    def test_lru_eviction_and_max_count(self):
        now = [1000.0]
        store = DatasetStore(
            ttl_seconds=3600, max_datasets=3, now_fn=lambda: now[0]
        )
        ids = []
        for i in range(3):
            now[0] += 1.0
            ids.append(
                store.create_dataset(
                    pd.DataFrame({"a": [i]}), {}
                ).dataset_id
            )
        self.assertEqual(len(store), 3)
        # Touch the first so the second becomes LRU.
        now[0] += 1.0
        store.get_dataset(ids[0])
        now[0] += 1.0
        fourth = store.create_dataset(pd.DataFrame({"a": [99]}), {})
        self.assertEqual(len(store), 3)
        self.assertIsNotNone(store.get_dataset(ids[0]))
        self.assertIsNone(store.get_dataset(ids[1]))  # LRU evicted
        self.assertIsNotNone(store.get_dataset(ids[2]))
        self.assertIsNotNone(store.get_dataset(fourth.dataset_id))

    def test_expired_removed_on_create(self):
        now = [0.0]
        store = DatasetStore(
            ttl_seconds=10, max_datasets=10, now_fn=lambda: now[0]
        )
        rec = store.create_dataset(pd.DataFrame({"a": [1]}), {})
        now[0] += 20.0
        store.create_dataset(pd.DataFrame({"a": [2]}), {})
        self.assertIsNone(store.get_dataset(rec.dataset_id))
        self.assertEqual(len(store), 1)

    def test_thread_safety_practical(self):
        store = DatasetStore(ttl_seconds=60, max_datasets=50)
        errors = []

        def worker(n):
            try:
                for i in range(20):
                    rec = store.create_dataset(
                        pd.DataFrame({"w": [n], "i": [i]}), {}
                    )
                    store.get_dataset(rec.dataset_id)
                    store.touch_dataset(rec.dataset_id)
            except Exception as exc:  # pragma: no cover
                errors.append(exc)

        threads = [threading.Thread(target=worker, args=(n,)) for n in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(errors, [])
        self.assertLessEqual(len(store), 50)


class UploadCompatibilityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app import create_app

        cls.client = create_app().test_client()

    def setUp(self):
        _clear_global_store()

    def tearDown(self):
        _clear_global_store()

    def test_small_csv_preserves_full_preview(self):
        body = _upload_small(self.client)
        self.assertIn("dataset_id", body)
        self.assertTrue(body["dataset_id"])
        self.assertEqual(body["row_count"], 2)
        self.assertEqual(body["preview_count"], 2)
        self.assertEqual(len(body["preview"]), 2)
        self.assertEqual(body["preview"][0]["product"], "Widget")

    def test_small_preview_matches_all_rows(self):
        body = _upload_small(self.client)
        self.assertEqual(body["preview_count"], body["row_count"])

    def test_large_csv_returns_bounded_preview(self):
        # 6000 rows x 20 cols = 120000 cells > 100000 -> sampled path,
        # but small enough for a fast end-to-end upload.
        header = ",".join(f"c{i}" for i in range(20))
        lines = [header] + [
            ",".join(str((r + c) % 97) for c in range(20)) for r in range(6000)
        ]
        payload = ("\n".join(lines) + "\n").encode()
        resp = _post_csv(self.client, payload, "large.csv")
        self.assertEqual(resp.status_code, 200)
        body = json.loads(b"".join(resp.response))
        self.assertIn("dataset_id", body)
        self.assertTrue(body["dataset_id"])
        self.assertEqual(body["row_count"], 6000)
        self.assertEqual(body["preview_count"], SAMPLE_PREVIEW_ROWS)
        self.assertLessEqual(len(body["preview"]), SAMPLE_PREVIEW_ROWS)
        # Deterministic head sample: first preview row == first CSV row.
        self.assertEqual(body["preview"][0]["c0"], 0)
        self.assertEqual(body["preview"][1]["c0"], 1)

    def test_large_preview_count_is_actual_size(self):
        body = _upload_small(self.client)
        self.assertEqual(body["preview_count"], len(body["preview"]))

    def test_streamed_large_upload_bounded(self):
        header = ",".join(f"c{i}" for i in range(20))
        lines = [header] + [
            ",".join(str((r + c) % 97) for c in range(20)) for r in range(6000)
        ]
        payload = ("\n".join(lines) + "\n").encode()
        resp = _post_csv(self.client, payload, "large.csv", "?stream=progress")
        self.assertEqual(resp.status_code, 200)
        text = b"".join(resp.response).decode("utf-8")
        marker = '{"type": "result-start"}'
        self.assertIn(marker, text)
        result = json.loads(text.split(marker, 1)[1].strip())
        self.assertIn("dataset_id", result)
        self.assertEqual(result["row_count"], 6000)
        self.assertLessEqual(result["preview_count"], SAMPLE_PREVIEW_ROWS)
        self.assertEqual(result["preview_count"], len(result["preview"]))


class PaginationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app import create_app

        cls.client = create_app().test_client()

    def setUp(self):
        _clear_global_store()
        header = "id,val"
        lines = [header] + [f"{i},{i * 10}" for i in range(250)]
        payload = ("\n".join(lines) + "\n").encode()
        resp = _post_csv(self.client, payload, "paged.csv")
        self.assertEqual(resp.status_code, 200)
        body = json.loads(b"".join(resp.response))
        self.dataset_id = body["dataset_id"]

    def tearDown(self):
        _clear_global_store()

    def _get_rows(self, dataset_id, query):
        return self.client.get(f"/api/datasets/{dataset_id}/rows{query}")

    def test_first_page(self):
        resp = self._get_rows(self.dataset_id, "?page=0&page_size=100")
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["dataset_id"], self.dataset_id)
        self.assertEqual(body["page"], 0)
        self.assertEqual(body["page_size"], 100)
        self.assertEqual(body["row_count"], 250)
        self.assertEqual(len(body["rows"]), 100)
        self.assertEqual(body["rows"][0]["id"], 0)

    def test_middle_page(self):
        resp = self._get_rows(self.dataset_id, "?page=1&page_size=100")
        body = resp.get_json()
        self.assertEqual(len(body["rows"]), 100)
        self.assertEqual(body["rows"][0]["id"], 100)

    def test_final_partial_page(self):
        resp = self._get_rows(self.dataset_id, "?page=2&page_size=100")
        body = resp.get_json()
        self.assertEqual(len(body["rows"]), 50)
        self.assertEqual(body["rows"][0]["id"], 200)
        self.assertEqual(body["rows"][-1]["id"], 249)

    def test_page_beyond_dataset_returns_empty(self):
        resp = self._get_rows(self.dataset_id, "?page=5&page_size=100")
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["rows"], [])
        self.assertEqual(body["row_count"], 250)

    def test_defaults(self):
        resp = self._get_rows(self.dataset_id, "")
        body = resp.get_json()
        self.assertEqual(body["page"], 0)
        self.assertEqual(body["page_size"], 100)
        self.assertEqual(len(body["rows"]), 100)

    def test_max_page_size(self):
        resp = self._get_rows(self.dataset_id, "?page=0&page_size=500")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.get_json()["rows"]), 250)

    def test_invalid_page(self):
        for query in ("?page=-1", "?page=abc", "?page=1.5"):
            resp = self._get_rows(self.dataset_id, query)
            self.assertEqual(resp.status_code, 400, query)
            self.assertIn("error", resp.get_json())

    def test_invalid_page_size(self):
        for query in (
            "?page_size=0",
            "?page_size=-5",
            "?page_size=501",
            "?page_size=abc",
        ):
            resp = self._get_rows(self.dataset_id, query)
            self.assertEqual(resp.status_code, 400, query)
            self.assertIn("error", resp.get_json())

    def test_unknown_id_404(self):
        resp = self._get_rows("0" * 32, "?page=0&page_size=10")
        self.assertEqual(resp.status_code, 404)
        self.assertIn("error", resp.get_json())

    def test_rows_match_head_sample_order(self):
        from analysis import slice_to_records

        record = get_store().get_dataset(self.dataset_id)
        expected_first = slice_to_records(record.dataframe, 0, 5)
        resp = self._get_rows(self.dataset_id, "?page=0&page_size=5")
        self.assertEqual(resp.get_json()["rows"], expected_first)


class MetadataEndpointTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app import create_app

        cls.client = create_app().test_client()

    def setUp(self):
        _clear_global_store()

    def tearDown(self):
        _clear_global_store()

    def test_metadata_without_rows(self):
        body = _upload_small(self.client)
        dataset_id = body["dataset_id"]
        resp = self.client.get(f"/api/datasets/{dataset_id}")
        self.assertEqual(resp.status_code, 200)
        meta = resp.get_json()
        self.assertEqual(meta["dataset_id"], dataset_id)
        self.assertEqual(meta["row_count"], 2)
        self.assertEqual(meta["column_count"], 3)
        self.assertEqual(meta["columns"], ["id", "product", "price"])
        self.assertEqual(meta["preview_count"], 2)
        self.assertIn("metadata", meta)
        self.assertIn("dtypes", meta["metadata"])
        self.assertIn("missing", meta["metadata"])
        self.assertIn("unique", meta["metadata"])
        self.assertIn("numeric_stats", meta["metadata"])
        self.assertNotIn("preview", meta)
        self.assertNotIn("rows", meta)

    def test_unknown_id_404_json(self):
        resp = self.client.get("/api/datasets/" + "f" * 32)
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.get_json(), {"error": "Not found."})


class SerializationTest(unittest.TestCase):
    def test_to_jsonable_scalars(self):
        import math

        import numpy as np

        from analysis import to_jsonable

        self.assertIsNone(to_jsonable(float("nan")))
        self.assertIsNone(to_jsonable(float("inf")))
        self.assertIsNone(to_jsonable(float("-inf")))
        self.assertIsNone(to_jsonable(None))
        self.assertIsNone(to_jsonable(pd.NA))
        self.assertIsNone(to_jsonable(pd.NaT))
        self.assertTrue(to_jsonable(True) is True)
        self.assertEqual(to_jsonable(np.int64(7)), 7)
        self.assertIsInstance(to_jsonable(np.int64(7)), int)
        self.assertEqual(to_jsonable(np.float64(2.5)), 2.5)
        self.assertEqual(to_jsonable(np.bool_(True)), True)
        self.assertEqual(to_jsonable("hello"), "hello")
        ts = to_jsonable(pd.Timestamp("2021-03-04 05:06:07"))
        self.assertIsInstance(ts, str)
        self.assertIn("2021-03-04", ts)

    def test_slice_serialization_all_kinds(self):
        import numpy as np

        from analysis import slice_to_records

        df = pd.DataFrame(
            {
                "f": [1.5, float("nan"), float("inf"), float("-inf")],
                "n": pd.array([1, None, 3, 4], dtype="Int64"),
                "b": pd.array(
                    [True, False, None, True], dtype="boolean"
                ),
                "bn": np.array([True, False, True, False]),
                "t": pd.to_datetime(
                    ["2021-01-01", "2021-01-02", None, "2021-01-04"]
                ),
                "s": ["a", "b", None, "d"],
                "i": [1, 2, 3, 4],
            }
        )
        rows = slice_to_records(df, 0, 4)
        self.assertEqual(rows[0]["f"], 1.5)
        self.assertIsNone(rows[1]["f"])
        self.assertIsNone(rows[2]["f"])
        self.assertIsNone(rows[3]["f"])
        self.assertEqual(rows[0]["n"], 1)
        self.assertIsNone(rows[1]["n"])
        self.assertIsInstance(rows[0]["n"], int)
        self.assertIs(rows[0]["b"], True)
        self.assertIs(rows[1]["b"], False)
        self.assertIsNone(rows[2]["b"])
        self.assertIs(rows[0]["bn"], True)
        self.assertEqual(rows[0]["t"], "2021-01-01T00:00:00")
        self.assertIsNone(rows[2]["t"])
        self.assertEqual(rows[0]["s"], "a")
        self.assertIsNone(rows[2]["s"])
        self.assertEqual(rows[3]["i"], 4)
        self.assertIsInstance(rows[3]["i"], int)

    def test_slice_matches_upload_preview_values(self):
        from analysis import analyze_dataframe

        df = pd.DataFrame(
            {
                "x": [1.0, float("nan")],
                "when": pd.to_datetime(["2020-05-06", None]),
            }
        )
        payload = analyze_dataframe(df, "s.csv")
        self.assertIsNone(payload["preview"][1]["x"])
        self.assertIsNone(payload["preview"][1]["when"])


class IsolationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app import create_app

        cls.client = create_app().test_client()

    def setUp(self):
        _clear_global_store()

    def tearDown(self):
        _clear_global_store()

    def test_two_datasets_never_cross(self):
        resp_a = _post_csv(self.client, b"id,v\n1,a\n2,b\n", "a.csv")
        resp_b = _post_csv(self.client, b"id,v\n10,z\n20,y\n", "b.csv")
        id_a = json.loads(b"".join(resp_a.response))["dataset_id"]
        id_b = json.loads(b"".join(resp_b.response))["dataset_id"]
        self.assertNotEqual(id_a, id_b)
        rows_a = self.client.get(
            f"/api/datasets/{id_a}/rows?page=0&page_size=10"
        ).get_json()["rows"]
        rows_b = self.client.get(
            f"/api/datasets/{id_b}/rows?page=0&page_size=10"
        ).get_json()["rows"]
        self.assertEqual([r["id"] for r in rows_a], [1, 2])
        self.assertEqual([r["id"] for r in rows_b], [10, 20])
        meta_a = self.client.get(f"/api/datasets/{id_a}").get_json()
        meta_b = self.client.get(f"/api/datasets/{id_b}").get_json()
        self.assertEqual(meta_a["row_count"], 2)
        self.assertEqual(meta_b["row_count"], 2)


class ExpiryEndpointTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app import create_app

        cls.client = create_app().test_client()

    def setUp(self):
        _clear_global_store()

    def tearDown(self):
        _clear_global_store()

    def test_expired_id_404s_on_both_endpoints(self):
        body = _upload_small(self.client)
        dataset_id = body["dataset_id"]
        record = get_store().get_dataset(dataset_id)
        self.assertIsNotNone(record)
        # Simulate TTL expiry without sleeping.
        record.last_accessed_at -= dataset_store.DATASET_TTL_SECONDS + 10
        meta = self.client.get(f"/api/datasets/{dataset_id}")
        self.assertEqual(meta.status_code, 404)
        self.assertIn("error", meta.get_json())
        rows = self.client.get(
            f"/api/datasets/{dataset_id}/rows?page=0&page_size=10"
        )
        self.assertEqual(rows.status_code, 404)
        self.assertIn("error", rows.get_json())


class LargeFileRegressionTest(unittest.TestCase):
    """Representative ~50k x 33 regression (synthetic + repo Spotify CSV)."""

    @staticmethod
    def build_wide_frame(rows=50000, cols=33):
        data = {}
        for c in range(cols):
            kind = c % 4
            if kind == 0:
                data[f"int_{c}"] = [(r + c) % 1000 for r in range(rows)]
            elif kind == 1:
                data[f"flt_{c}"] = [
                    float("nan") if r % 17 == 0 else r * 1.25
                    for r in range(rows)
                ]
            elif kind == 2:
                data[f"cat_{c}"] = [f"g-{(r + c) % 7}" for r in range(rows)]
            else:
                data[f"txt_{c}"] = [f"name-{r}-{c}" for r in range(rows)]
        return pd.DataFrame(data)

    def test_synthetic_50k_x_33_bounded(self):
        from analysis import analyze_dataframe

        df = self.build_wide_frame()
        self.assertEqual(df.shape, (50000, 33))
        t0 = time.perf_counter()
        result = analyze_dataframe(df, "wide.csv")
        analyze_ms = (time.perf_counter() - t0) * 1000
        t0 = time.perf_counter()
        record = get_store().create_dataset(
            df,
            {
                "filename": "wide.csv",
                "row_count": result["row_count"],
                "column_count": result["column_count"],
                "columns": result["columns"],
                "dtypes": result["dtypes"],
                "missing": result["missing"],
                "unique": result["unique"],
                "numeric_stats": result["numeric_stats"],
                "preview_count": result["preview_count"],
            },
        )
        store_ms = (time.perf_counter() - t0) * 1000
        try:
            self.assertTrue(record.dataset_id)
            self.assertEqual(result["row_count"], 50000)
            self.assertEqual(result["column_count"], 33)
            self.assertLessEqual(
                result["preview_count"], SAMPLE_PREVIEW_ROWS
            )
            self.assertEqual(
                result["preview_count"], len(result["preview"])
            )
            # Deterministic head sample, column order preserved.
            self.assertEqual(
                list(result["preview"][0].keys()), list(df.columns.astype(str))
            )
            self.assertEqual(result["preview"][0]["int_0"], 0)
            self.assertEqual(
                len(record.dataframe), 50000
            )  # full frame retained server-side
        finally:
            get_store().delete_dataset(record.dataset_id)
        print(
            f"\n[large-synthetic] analyze_ms={analyze_ms:.1f} "
            f"store_ms={store_ms:.1f} preview={result['preview_count']}"
        )

    def test_spotify_csv_bounded_when_present(self):
        here = os.path.dirname(os.path.abspath(__file__))
        candidate = os.path.join(
            here, "..", "test_dataset", "spotify_artist_streaming_2020_2025.csv"
        )
        if not os.path.exists(candidate):
            self.skipTest("Spotify CSV fixture not present")
        import time as _time

        from app import _read_csv_bytes
        from analysis import analyze_dataframe

        with open(candidate, "rb") as fh:
            raw = fh.read()
        size_mb = len(raw) / (1024 * 1024)
        t0 = _time.perf_counter()
        df = _read_csv_bytes(raw)
        parse_ms = (_time.perf_counter() - t0) * 1000
        del raw
        t0 = _time.perf_counter()
        result = analyze_dataframe(df, os.path.basename(candidate))
        analyze_ms = (_time.perf_counter() - t0) * 1000
        t0 = _time.perf_counter()
        record = get_store().create_dataset(
            df,
            {
                "filename": result["filename"],
                "row_count": result["row_count"],
                "column_count": result["column_count"],
                "columns": result["columns"],
                "dtypes": result["dtypes"],
                "missing": result["missing"],
                "unique": result["unique"],
                "numeric_stats": result["numeric_stats"],
                "preview_count": result["preview_count"],
            },
        )
        store_ms = (_time.perf_counter() - t0) * 1000
        try:
            self.assertTrue(record.dataset_id)
            self.assertEqual(result["row_count"], 50000)
            self.assertLessEqual(
                result["preview_count"], SAMPLE_PREVIEW_ROWS
            )
            print(
                f"\n[spotify] size_mb={size_mb:.2f} shape={df.shape} "
                f"parse_ms={parse_ms:.1f} analyze_ms={analyze_ms:.1f} "
                f"store_ms={store_ms:.1f} preview={result['preview_count']}"
            )
        finally:
            get_store().delete_dataset(record.dataset_id)


if __name__ == "__main__":
    unittest.main(verbosity=2)
