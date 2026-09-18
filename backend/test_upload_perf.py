"""Targeted backend performance test (Phase H).

Guards the actual measured bottleneck from the 11.5 MiB / 50k-row Spotify
investigation: per-cell Python serialization (to_dict + to_jsonable over
every cell) plus repeated full-column passes in classification.

The test builds a synthetic mid-size CSV exercising every serialization
fast path (high-cardinality text, datetimes, floats with NaN/inf, nullable
integers/booleans) and asserts:
- the payload is exactly what the slow path would produce (values, NaN /
  inf -> None, timestamps -> ISO strings, native bool/int types);
- analysis finishes well under a generous smoke bound (slow-CI safe; this
  is a regression tripwire, not a micro-benchmark).

Run from the backend directory with:
    .venv\\Scripts\\python -m unittest test_upload_perf -v
"""

import io
import time
import unittest

import pandas as pd

from analysis import analyze_dataframe, classify_column

ROWS = 5000
# Generous smoke bound: typical runs finish in ~1s; this only trips on a
# genuine algorithmic regression (e.g. reintroducing per-cell pd.isna loops
# or unbounded unique-value set building).
TIME_BOUND_SECONDS = 25


def build_frame():
    return pd.DataFrame(
        {
            "row_id": [f"id-{i:06d}" for i in range(ROWS)],
            "label": [f"name-{i % ROWS}" for i in range(ROWS)],
            "day": pd.to_datetime(
                [(f"2021-{(i % 12) + 1:02d}-{(i % 28) + 1:02d}") for i in range(ROWS)]
            ),
            "amount": [float(i) * 1.5 if i % 7 else float("nan") for i in range(ROWS)],
            "ratio": [float("inf") if i % 101 == 0 else i / 3.0 for i in range(ROWS)],
            "count": pd.array(
                [None if i % 11 == 0 else i for i in range(ROWS)], dtype="Int64"
            ),
            "flag": pd.array(
                [True if i % 2 == 0 else False for i in range(ROWS)], dtype="boolean"
            ),
            "group": [f"g-{i % 5}" for i in range(ROWS)],
            "score": [(i * 37) % 100 for i in range(ROWS)],
            "note": [None if i % 13 == 0 else f"note {i}" for i in range(ROWS)],
        }
    )


class UploadPerfTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.df = build_frame()
        started = time.perf_counter()
        cls.result = analyze_dataframe(cls.df, "perf.csv")
        cls.elapsed = time.perf_counter() - started

    def test_finishes_within_smoke_bound(self):
        self.assertLess(
            self.elapsed,
            TIME_BOUND_SECONDS,
            f"analysis took {self.elapsed:.1f}s for {ROWS} rows",
        )

    def test_full_row_set_returned(self):
        self.assertEqual(self.result["row_count"], ROWS)
        self.assertEqual(self.result["column_count"], 10)
        self.assertEqual(len(self.result["preview"]), ROWS)
        self.assertEqual(self.result["preview_count"], ROWS)

    def test_missing_and_inf_become_none(self):
        by_id = {row["row_id"]: row for row in self.result["preview"]}
        self.assertIsNone(by_id["id-000000"]["amount"])
        self.assertEqual(by_id["id-000001"]["amount"], 1.5)
        self.assertIsNone(by_id["id-000000"]["ratio"])
        self.assertAlmostEqual(by_id["id-000001"]["ratio"], 1 / 3.0)
        self.assertIsNone(by_id["id-000000"]["count"])
        self.assertEqual(by_id["id-000001"]["count"], 1)
        self.assertIsNone(by_id["id-000000"]["note"])

    def test_timestamps_become_iso_strings(self):
        first = self.result["preview"][0]
        self.assertEqual(first["day"], "2021-01-01T00:00:00")
        self.assertIsInstance(first["day"], str)

    def test_native_bool_and_int_types(self):
        first = self.result["preview"][0]
        self.assertIs(first["flag"], True)
        self.assertIsInstance(first["score"], int)
        self.assertIsInstance(first["count"] if first["count"] is not None else 0, int)

    def test_high_cardinality_text_stays_text(self):
        self.assertEqual(
            classify_column(self.df["row_id"], ROWS), "text"
        )
        self.assertEqual(self.result["dtypes"]["row_id"], "text")
        self.assertEqual(self.result["dtypes"]["group"], "categorical")
        self.assertEqual(self.result["dtypes"]["day"], "datetime")
        self.assertEqual(self.result["dtypes"]["amount"], "numeric")

    def test_numeric_stats_present(self):
        stats = self.result["numeric_stats"]["amount"]
        self.assertGreater(stats["count"], 0)
        self.assertIsNotNone(stats["mean"])
        self.assertIsNotNone(stats["min"])
        self.assertIsNotNone(stats["max"])

    def test_end_to_end_upload_with_mixed_types(self):
        from app import app

        buf = io.StringIO()
        buf.write("a,b,c\n1,2021-03-04,x\n2,,y\n")
        client = app.test_client()
        resp = client.post(
            "/api/upload",
            data={"file": (io.BytesIO(buf.getvalue().encode()), "mixed.csv")},
            content_type="multipart/form-data",
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["row_count"], 2)
        self.assertEqual(body["preview"][1]["b"], None)
        # Date-only strings are not parsed by read_csv; raw strings pass
        # through untouched (same as before the Phase H optimization).
        self.assertEqual(body["preview"][0]["b"], "2021-03-04")


if __name__ == "__main__":
    unittest.main(verbosity=2)
