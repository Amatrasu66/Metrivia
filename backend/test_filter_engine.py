"""Phase M3 server-side filtering tests.

Covers the structured filter engine + POST /api/datasets/<id>/filter:

- Correctness (numeric/text/null/date/multiple filters, AND semantics)
- Filtered pagination (first/middle/final/beyond/count/zero-result)
- Validation (unknown/expired dataset, column, operator, malformed, value)
- Isolation, mutation safety, serialization, security (no code execution)

Run from the backend directory with:
    .venv\\Scripts\\python -m unittest test_filter_engine -v
"""

import io
import json
import os
import unittest

import pandas as pd

import dataset_store
from dataset_store import get_store
from filter_engine import (
    FILTER_OPERATORS,
    MAX_FILTERS,
    FilterValidationError,
    apply_filters,
    build_filter_mask,
    validate_filter_request,
)


def _clear_global_store():
    get_store().clear()


def _post_csv(client, payload, filename):
    return client.post(
        "/api/upload",
        data={"file": (io.BytesIO(payload), filename)},
        content_type="multipart/form-data",
    )


def _make_frame():
    return pd.DataFrame(
        {
            "id": [1, 2, 3, 4, 5],
            "name": ["Taylor Swift", "taylor day", "Adele", None, ""],
            "score": [10.5, 20.0, float("nan"), 30.0, 40.0],
            "when": pd.to_datetime(
                ["2021-01-05", "2021-02-10", None, "2021-03-15", "2021-01-05"]
            ),
            "genre": ["Pop", "Pop", "Soul", "Pop", "Rock"],
        }
    )


def _dtypes():
    return {
        "id": "numeric",
        "name": "text",
        "score": "numeric",
        "when": "datetime",
        "genre": "categorical",
    }


def _columns():
    return ["id", "name", "score", "when", "genre"]


class OperatorInventoryTest(unittest.TestCase):
    def test_only_implemented_operators_listed(self):
        # Documents the exact implemented surface; no hidden operators.
        expected = {
            "eq", "neq", "gt", "gte", "lt", "lte",
            "contains", "not_contains", "starts_with", "ends_with",
            "is_empty", "is_not_empty", "in", "not_in",
        }
        self.assertEqual(set(FILTER_OPERATORS), expected)

    def test_max_filters_bounded(self):
        self.assertGreaterEqual(MAX_FILTERS, 10)
        self.assertLessEqual(MAX_FILTERS, 50)


class NumericCorrectnessTest(unittest.TestCase):
    def setUp(self):
        self.df = _make_frame()

    def _count(self, filters):
        mask = build_filter_mask(self.df, filters, _dtypes())
        return int(mask.sum())

    def test_eq(self):
        self.assertEqual(
            self._count([{"column": "id", "operator": "eq", "value": 2}]), 1
        )

    def test_eq_numeric_string_coerced(self):
        self.assertEqual(
            self._count([{"column": "id", "operator": "eq", "value": "3"}]), 1
        )

    def test_neq_excludes_null(self):
        # Missing never matches value operators, even negated.
        mask = build_filter_mask(
            self.df, [{"column": "score", "operator": "neq", "value": 10.5}],
            _dtypes(),
        )
        # score NaN row must not match neq.
        self.assertEqual(int(mask.sum()), 3)

    def test_gt_gte_lt_lte(self):
        self.assertEqual(
            self._count([{"column": "id", "operator": "gt", "value": 3}]), 2
        )
        self.assertEqual(
            self._count([{"column": "id", "operator": "gte", "value": 3}]), 3
        )
        self.assertEqual(
            self._count([{"column": "id", "operator": "lt", "value": 3}]), 2
        )
        self.assertEqual(
            self._count([{"column": "id", "operator": "lte", "value": 3}]), 3
        )

    def test_numeric_bounds_inclusive(self):
        self.assertEqual(
            self._count([
                {"column": "score", "operator": "gte", "value": 20},
                {"column": "score", "operator": "lte", "value": 30},
            ]),
            2,
        )

    def test_in_list(self):
        self.assertEqual(
            self._count([
                {"column": "id", "operator": "in", "value": [1, 3, 5]}
            ]),
            3,
        )

    def test_not_in_excludes_null(self):
        self.assertEqual(
            self._count([
                {"column": "score", "operator": "not_in", "value": [10.5]}
            ]),
            3,  # NaN row excluded
        )

    def test_invalid_numeric_value_rejected(self):
        with self.assertRaises(FilterValidationError):
            build_filter_mask(
                self.df,
                [{"column": "id", "operator": "eq", "value": "not-a-number"}],
                _dtypes(),
            )


class TextCorrectnessTest(unittest.TestCase):
    def setUp(self):
        self.df = _make_frame()

    def _count(self, filters):
        return int(build_filter_mask(self.df, filters, _dtypes()).sum())

    def test_eq_case_sensitive(self):
        self.assertEqual(
            self._count([{"column": "name", "operator": "eq", "value": "Taylor Swift"}]),
            1,
        )
        # Lowercase 'taylor' must not match 'Taylor' (case-sensitive).
        self.assertEqual(
            self._count([{"column": "name", "operator": "eq", "value": "taylor"}]),
            0,
        )

    def test_contains_case_sensitive_literal(self):
        self.assertEqual(
            self._count([{"column": "name", "operator": "contains", "value": "Taylor"}]),
            1,
        )
        self.assertEqual(
            self._count([{"column": "name", "operator": "contains", "value": "taylor"}]),
            1,  # matches "taylor day" only
        )

    def test_not_contains(self):
        # Non-blank rows not containing 'Taylor' (case-sensitive).
        n = self._count(
            [{"column": "name", "operator": "not_contains", "value": "Taylor"}]
        )
        self.assertEqual(n, 2)  # "taylor day" + "Adele"; blanks excluded
        # blank (None/"") never matches value operators, even negated.

    def test_starts_ends_with(self):
        self.assertEqual(
            self._count(
                [{"column": "name", "operator": "starts_with", "value": "Taylor"}]
            ),
            1,
        )
        self.assertEqual(
            self._count(
                [{"column": "name", "operator": "ends_with", "value": "day"}]
            ),
            1,
        )

    def test_eq_blank_label(self):
        self.assertEqual(
            self._count([{"column": "name", "operator": "eq", "value": "(blank)"}]),
            2,  # None + ""
        )

    def test_in_with_blank(self):
        self.assertEqual(
            self._count(
                [{
                    "column": "genre",
                    "operator": "in",
                    "value": ["Pop", "(blank)"],
                }]
            ),
            3,
        )

    def test_categorical_or_via_in(self):
        self.assertEqual(
            self._count(
                [{"column": "genre", "operator": "in", "value": ["Pop", "Rock"]}]
            ),
            4,
        )


class NullEmptyTest(unittest.TestCase):
    def setUp(self):
        self.df = _make_frame()

    def test_is_empty_text(self):
        mask = build_filter_mask(
            self.df, [{"column": "name", "operator": "is_empty", "value": None}],
            _dtypes(),
        )
        self.assertEqual(int(mask.sum()), 2)

    def test_is_not_empty_text(self):
        mask = build_filter_mask(
            self.df,
            [{"column": "name", "operator": "is_not_empty", "value": None}],
            _dtypes(),
        )
        self.assertEqual(int(mask.sum()), 3)

    def test_is_empty_numeric(self):
        mask = build_filter_mask(
            self.df, [{"column": "score", "operator": "is_empty", "value": None}],
            _dtypes(),
        )
        self.assertEqual(int(mask.sum()), 1)

    def test_is_empty_datetime(self):
        mask = build_filter_mask(
            self.df, [{"column": "when", "operator": "is_empty", "value": None}],
            _dtypes(),
        )
        self.assertEqual(int(mask.sum()), 1)

    def test_value_operators_skip_null(self):
        for op in ("eq", "gt", "gte", "lt", "lte", "contains"):
            value = "2021-01-01" if op != "contains" else "x"
            col = "when" if op != "contains" else "name"
            if op in ("eq", "gt", "gte", "lt", "lte") and col == "name":
                continue
            mask = build_filter_mask(
                self.df, [{"column": col, "operator": op, "value": value}],
                _dtypes(),
            )
            # NaN/None row (index 2) must never be selected.
            self.assertFalse(bool(mask.iloc[2]), op)


class DatetimeCorrectnessTest(unittest.TestCase):
    def setUp(self):
        self.df = _make_frame()

    def _count(self, filters):
        return int(build_filter_mask(self.df, filters, _dtypes()).sum())

    def test_gte_date_only_inclusive_day(self):
        self.assertEqual(
            self._count([{"column": "when", "operator": "gte", "value": "2021-02-01"}]),
            2,  # 02-10 + 03-15 (NaT excluded)
        )

    def test_lte_date_only_inclusive_day(self):
        self.assertEqual(
            self._count([{"column": "when", "operator": "lte", "value": "2021-02-10"}]),
            3,  # two 01-05 + 02-10
        )

    def test_range(self):
        self.assertEqual(
            self._count([
                {"column": "when", "operator": "gte", "value": "2021-01-01"},
                {"column": "when", "operator": "lte", "value": "2021-02-15"},
            ]),
            3,
        )

    def test_eq_date_only_matches_whole_day(self):
        self.assertEqual(
            self._count([{"column": "when", "operator": "eq", "value": "2021-01-05"}]),
            2,
        )

    def test_invalid_date_rejected(self):
        with self.assertRaises(FilterValidationError):
            build_filter_mask(
                self.df,
                [{"column": "when", "operator": "gte", "value": "not-a-date"}],
                _dtypes(),
            )


class CombinationSemanticsTest(unittest.TestCase):
    def setUp(self):
        self.df = _make_frame()

    def test_and_across_columns(self):
        mask = build_filter_mask(
            self.df,
            [
                {"column": "genre", "operator": "eq", "value": "Pop"},
                {"column": "id", "operator": "gte", "value": 2},
            ],
            _dtypes(),
        )
        self.assertEqual(int(mask.sum()), 2)  # ids 2 and 4

    def test_empty_filters_match_all(self):
        mask = build_filter_mask(self.df, [], _dtypes())
        self.assertEqual(int(mask.sum()), 5)

    def test_contradiction_matches_none(self):
        mask = build_filter_mask(
            self.df,
            [
                {"column": "id", "operator": "gte", "value": 10},
                {"column": "id", "operator": "lte", "value": 2},
            ],
            _dtypes(),
        )
        self.assertEqual(int(mask.sum()), 0)


class ValidateRequestTest(unittest.TestCase):
    def test_defaults(self):
        out = validate_filter_request({}, _columns(), _dtypes())
        self.assertEqual(out["filters"], [])
        self.assertEqual(out["page"], 0)

    def test_unknown_column(self):
        with self.assertRaises(FilterValidationError):
            validate_filter_request(
                {"filters": [{"column": "nope", "operator": "eq", "value": 1}]},
                _columns(),
                _dtypes(),
            )

    def test_column_case_sensitive(self):
        with self.assertRaises(FilterValidationError):
            validate_filter_request(
                {"filters": [{"column": "ID", "operator": "eq", "value": 1}]},
                _columns(),
                _dtypes(),
            )

    def test_invalid_operator(self):
        with self.assertRaises(FilterValidationError):
            validate_filter_request(
                {"filters": [{"column": "id", "operator": "regex", "value": "1"}]},
                _columns(),
                _dtypes(),
            )

    def test_malformed_not_object(self):
        with self.assertRaises(FilterValidationError):
            validate_filter_request(
                {"filters": ["oops"]}, _columns(), _dtypes()
            )

    def test_unknown_field_rejected(self):
        with self.assertRaises(FilterValidationError):
            validate_filter_request(
                {"filters": [
                    {"column": "id", "operator": "eq", "value": 1, "extra": 1}
                ]},
                _columns(),
                _dtypes(),
            )

    def test_wrong_type_contains_on_numeric(self):
        with self.assertRaises(FilterValidationError):
            validate_filter_request(
                {"filters": [{"column": "id", "operator": "contains", "value": "1"}]},
                _columns(),
                _dtypes(),
            )

    def test_wrong_type_comparison_on_text(self):
        with self.assertRaises(FilterValidationError):
            validate_filter_request(
                {"filters": [{"column": "name", "operator": "gt", "value": 5}]},
                _columns(),
                _dtypes(),
            )

    def test_too_many_filters(self):
        many = [
            {"column": "id", "operator": "gte", "value": 0}
            for _ in range(MAX_FILTERS + 1)
        ]
        with self.assertRaises(FilterValidationError):
            validate_filter_request({"filters": many}, _columns(), _dtypes())

    def test_bad_page(self):
        for bad in (-1, "abc", 1.5, True):
            with self.assertRaises(FilterValidationError, msg=str(bad)):
                validate_filter_request(
                    {"page": bad}, _columns(), _dtypes()
                )

    def test_bad_page_size(self):
        for bad in (0, 501, "abc", -3):
            with self.assertRaises(FilterValidationError, msg=str(bad)):
                validate_filter_request(
                    {"page_size": bad}, _columns(), _dtypes()
                )

    def test_is_empty_with_value_rejected(self):
        with self.assertRaises(FilterValidationError):
            validate_filter_request(
                {"filters": [
                    {"column": "name", "operator": "is_empty", "value": "x"}
                ]},
                _columns(),
                _dtypes(),
            )


class SecurityTest(unittest.TestCase):
    """Only structured operators/values are accepted; code never executes."""

    def setUp(self):
        self.df = _make_frame()

    def test_expression_operators_rejected(self):
        for evil_op in (
            "__import__", "eval(...)", "exec(...)", "df.query(...)",
            "lambda", "query", "Regex", "CONTAINS",
        ):
            with self.assertRaises(FilterValidationError, msg=evil_op):
                validate_filter_request(
                    {"filters": [
                        {"column": "name", "operator": evil_op, "value": "x"}
                    ]},
                    _columns(),
                    _dtypes(),
                )

    def test_code_in_values_is_literal(self):
        # Malicious-looking values are treated as literal strings (or
        # rejected as invalid numbers), never executed.
        n = int(build_filter_mask(
            self.df,
            [{"column": "name", "operator": "eq",
              "value": "__import__('os').system('x')"}],
            _dtypes(),
        ).sum())
        self.assertEqual(n, 0)
        n = int(build_filter_mask(
            self.df,
            [{"column": "name", "operator": "contains", "value": "eval("}],
            _dtypes(),
        ).sum())
        self.assertEqual(n, 0)
        with self.assertRaises(FilterValidationError):
            build_filter_mask(
                self.df,
                [{"column": "id", "operator": "eq",
                  "value": "__import__('os')"}],
                _dtypes(),
            )

    def test_no_eval_exec_query_in_engine(self):
        here = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(here, "filter_engine.py"), encoding="utf-8") as fh:
            src = fh.read()
        for token in ("eval(", "exec(", ".query("):
            self.assertNotIn(token, src, f"forbidden token {token}")
        with open(os.path.join(here, "app.py"), encoding="utf-8") as fh:
            app_src = fh.read()
        self.assertNotIn("eval(", app_src)
        self.assertNotIn("exec(", app_src)

    def test_dict_value_rejected(self):
        with self.assertRaises(FilterValidationError):
            validate_filter_request(
                {"filters": [
                    {"column": "id", "operator": "eq",
                     "value": {"$gt": 1}}
                ]},
                _columns(),
                _dtypes(),
            )


class FilterEndpointTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app import create_app

        cls.client = create_app().test_client()

    def setUp(self):
        _clear_global_store()
        header = "id,name,score,when"
        lines = [header] + [
            f"{i},name-{i},{i * 10},2021-01-{(i % 28) + 1:02d}" for i in range(250)
        ]
        payload = ("\n".join(lines) + "\n").encode()
        resp = _post_csv(self.client, payload, "rows.csv")
        self.assertEqual(resp.status_code, 200)
        body = json.loads(b"".join(resp.response))
        self.dataset_id = body["dataset_id"]

    def tearDown(self):
        _clear_global_store()

    def _filter(self, filters, page=0, page_size=100):
        return self.client.post(
            f"/api/datasets/{self.dataset_id}/filter",
            json={"filters": filters, "page": page, "page_size": page_size},
        )

    def test_response_shape(self):
        resp = self._filter(
            [{"column": "id", "operator": "gte", "value": 10}], 0, 50
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.get_json()
        self.assertEqual(body["dataset_id"], self.dataset_id)
        self.assertEqual(body["page"], 0)
        self.assertEqual(body["page_size"], 50)
        self.assertEqual(body["row_count"], 250)
        self.assertIn("filtered_row_count", body)
        self.assertEqual(body["filtered_row_count"], 240)
        self.assertEqual(len(body["rows"]), 50)

    def test_first_middle_final_pages(self):
        # score >= 100 -> ids 10..249 (240 rows), page_size 100.
        f = [{"column": "score", "operator": "gte", "value": 100}]
        first = self._filter(f, 0, 100).get_json()
        self.assertEqual(len(first["rows"]), 100)
        self.assertEqual(first["rows"][0]["id"], 10)
        mid = self._filter(f, 1, 100).get_json()
        self.assertEqual(len(mid["rows"]), 100)
        self.assertEqual(mid["rows"][0]["id"], 110)
        final = self._filter(f, 2, 100).get_json()
        self.assertEqual(len(final["rows"]), 40)
        self.assertEqual(final["rows"][-1]["id"], 249)

    def test_beyond_end_empty(self):
        body = self._filter(
            [{"column": "id", "operator": "gte", "value": 0}], 9, 100
        ).get_json()
        self.assertEqual(body["rows"], [])
        self.assertEqual(body["filtered_row_count"], 250)

    def test_zero_result_shape(self):
        body = self._filter(
            [{"column": "id", "operator": "gte", "value": 99999}], 0, 100
        ).get_json()
        self.assertEqual(body["filtered_row_count"], 0)
        self.assertEqual(body["rows"], [])
        self.assertEqual(body["row_count"], 250)

    def test_empty_filters_match_all(self):
        body = self._filter([], 0, 10).get_json()
        self.assertEqual(body["filtered_row_count"], 250)
        self.assertEqual(len(body["rows"]), 10)

    def test_only_page_serialized(self):
        body = self._filter(
            [{"column": "id", "operator": "gte", "value": 0}], 0, 200
        ).get_json()
        self.assertLessEqual(len(body["rows"]), 200)
        self.assertEqual(body["filtered_row_count"], 250)

    def test_unknown_dataset_404(self):
        resp = self.client.post(
            "/api/datasets/" + "0" * 32 + "/filter",
            json={"filters": [], "page": 0, "page_size": 10},
        )
        self.assertEqual(resp.status_code, 404)

    def test_expired_dataset_404(self):
        record = get_store().get_dataset(self.dataset_id)
        record.last_accessed_at -= dataset_store.DATASET_TTL_SECONDS + 10
        resp = self._filter([], 0, 10)
        self.assertEqual(resp.status_code, 404)

    def test_unknown_column_400(self):
        resp = self._filter(
            [{"column": "missing", "operator": "eq", "value": 1}], 0, 10
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("error", resp.get_json())
        self.assertNotIn("Traceback", resp.get_data(as_text=True))

    def test_invalid_operator_400(self):
        resp = self._filter(
            [{"column": "id", "operator": "regex", "value": "1"}], 0, 10
        )
        self.assertEqual(resp.status_code, 400)

    def test_non_json_400(self):
        resp = self.client.post(
            f"/api/datasets/{self.dataset_id}/filter",
            data="not json",
            content_type="text/plain",
        )
        self.assertEqual(resp.status_code, 400)

    def test_isolation(self):
        resp_b = _post_csv(self.client, b"id,v\n10,z\n", "b.csv")
        id_b = json.loads(b"".join(resp_b.response))["dataset_id"]
        body_a = self._filter(
            [{"column": "id", "operator": "eq", "value": 5}], 0, 10
        ).get_json()
        body_b = self.client.post(
            f"/api/datasets/{id_b}/filter",
            json={"filters": [{"column": "id", "operator": "eq", "value": 5}],
                  "page": 0, "page_size": 10},
        ).get_json()
        self.assertEqual(len(body_a["rows"]), 1)
        self.assertEqual(body_b["filtered_row_count"], 0)

    def test_mutation_safety(self):
        before = get_store().get_dataset(self.dataset_id).dataframe.copy(deep=True)
        self._filter([{"column": "id", "operator": "gte", "value": 100}], 0, 10)
        after = get_store().get_dataset(self.dataset_id).dataframe
        pd.testing.assert_frame_equal(before, after)

    def test_serialization_nan_none(self):
        resp = _post_csv(
            self.client, b"x,y\n1,\n2,2021-01-01\n", "s.csv"
        )
        did = json.loads(b"".join(resp.response))["dataset_id"]
        body = self.client.post(
            f"/api/datasets/{did}/filter",
            json={"filters": [], "page": 0, "page_size": 10},
        ).get_json()
        self.assertIsNone(body["rows"][0]["y"])


class LargeCsvFilterRegressionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app import create_app

        cls.client = create_app().test_client()

    def setUp(self):
        _clear_global_store()

    def tearDown(self):
        _clear_global_store()

    def test_spotify_full_dataset_filtering(self):
        here = os.path.dirname(os.path.abspath(__file__))
        candidate = os.path.join(
            here, "..", "test_dataset", "spotify_artist_streaming_2020_2025.csv"
        )
        if not os.path.exists(candidate):
            self.skipTest("Spotify CSV fixture not present")
        from app import _read_csv_bytes
        from analysis import analyze_dataframe

        with open(candidate, "rb") as fh:
            raw = fh.read()
        df = _read_csv_bytes(raw)
        del raw
        self.assertEqual(df.shape, (50000, 33))
        result = analyze_dataframe(df, os.path.basename(candidate))
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
        try:
            import time as _time

            did = record.dataset_id
            # Ground truth from the engine over the FULL frame.
            import filter_engine as fe

            cases = [
                ([{"column": "popularity", "operator": "gte", "value": 80}],
                 "numeric"),
                ([{"column": "artist_name", "operator": "contains",
                   "value": "Taylor"}]
                 if "artist_name" in result["columns"] else
                 [{"column": "genre", "operator": "eq", "value": "Pop"}],
                 "text"),
                ([{"column": "release_date", "operator": "gte",
                   "value": "2023-01-01"}]
                 if "release_date" in result["columns"] else
                 [{"column": "popularity", "operator": "gte", "value": 50}],
                 "date"),
            ]
            # Two combined filters.
            cases.append((
                [{"column": "popularity", "operator": "gte", "value": 50},
                 {"column": "genre", "operator": "eq", "value": "Pop"}]
                if "genre" in result["columns"] else
                [{"column": "popularity", "operator": "gte", "value": 50},
                 {"column": "popularity", "operator": "lte", "value": 80}],
                "combined",
            ))
            # Zero-result filter.
            cases.append((
                [{"column": "popularity", "operator": "gte", "value": 999999}],
                "zero",
            ))
            for filters, label in cases:
                t0 = _time.perf_counter()
                mask = fe.build_filter_mask(
                    df, filters, result.get("dtypes", {})
                )
                expected = int(mask.sum())
                mask_ms = (_time.perf_counter() - t0) * 1000
                t0 = _time.perf_counter()
                resp = self.client.post(
                    f"/api/datasets/{did}/filter",
                    json={"filters": filters, "page": 0, "page_size": 200},
                )
                endpoint_ms = (_time.perf_counter() - t0) * 1000
                self.assertEqual(resp.status_code, 200, label)
                body = resp.get_json()
                self.assertEqual(body["row_count"], 50000, label)
                self.assertEqual(
                    body["filtered_row_count"], expected, label
                )
                self.assertLessEqual(len(body["rows"]), 200, label)
                if expected == 0:
                    self.assertEqual(body["rows"], [], label)
                print(
                    f"\n[spotify-filter:{label}] expected={expected} "
                    f"mask_ms={mask_ms:.1f} endpoint_ms={endpoint_ms:.1f}"
                )
        finally:
            get_store().delete_dataset(record.dataset_id)


if __name__ == "__main__":
    unittest.main(verbosity=2)
