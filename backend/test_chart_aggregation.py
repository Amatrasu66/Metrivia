"""Phase M4 server-side chart aggregation tests.

Covers the aggregation module + POST /api/datasets/<id>/chart:

- Validation (chart type, columns, aggregation, limit, sort, filters)
- Aggregation correctness (count/sum/average/min/max, missing, ordering)
- Filter-then-aggregate correctness (categorical/numeric/datetime/AND/empty)
- Top-N limits (enforced, deterministic, truncation flag, high cardinality)
- Date grouping (chronological, buckets, missing dates)
- Scatter (bounded, deterministic, filtered, missing, numeric validation)
- Security (no arbitrary expression execution)
- API bounds (expired/unknown dataset, invalid, empty, oversized rejection)

Run from the backend directory with:
    .venv\\Scripts\\python -m unittest test_chart_aggregation -v
"""

import io
import json
import unittest

import pandas as pd

import chart_aggregation as agg
from chart_aggregation import (
    MAX_CHART_CATEGORIES,
    MAX_SCATTER_POINTS,
    ChartValidationError,
    aggregate_chart,
    validate_chart_request,
)
import dataset_store
from dataset_store import get_store
from filter_engine import FilterValidationError


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
            "genre": [
                "Pop", "Pop", "Rock", "Rock", "Rock",
                "Soul", None, "", "Pop", "Jazz",
            ],
            "streams": [100, 200, 50, 75, 25, 1000, 60, 40, None, 10],
            "plays": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            "when": pd.to_datetime(
                [
                    "2021-01-05", "2021-01-05", "2021-02-10", "2021-02-10",
                    "2021-03-15", "2021-03-15", None, "2021-01-05",
                    "2021-02-10", "2021-03-15",
                ]
            ),
        }
    )


def _dtypes():
    return {
        "genre": "categorical",
        "streams": "numeric",
        "plays": "numeric",
        "when": "datetime",
    }


def _columns():
    return ["genre", "streams", "plays", "when"]


def _upload_frame(client, frame, filename="chart.csv"):
    payload = frame.to_csv(index=False).encode("utf-8")
    resp = _post_csv(client, payload, filename)
    assert resp.status_code == 200, resp.status_code
    return json.loads(b"".join(resp.response))


class ValidationTest(unittest.TestCase):
    def test_valid_bar(self):
        out = validate_chart_request(
            {
                "chart_type": "bar",
                "dimension": "genre",
                "measure": "streams",
                "aggregation": "sum",
                "filters": [],
            },
            _columns(),
            _dtypes(),
        )
        self.assertEqual(out["chart_type"], "bar")
        self.assertEqual(out["limit"], MAX_CHART_CATEGORIES)

    def test_valid_line_area_pie(self):
        for chart_type in ("line", "area", "pie"):
            dimension = "when" if chart_type != "pie" else "genre"
            out = validate_chart_request(
                {
                    "chart_type": chart_type,
                    "dimension": dimension,
                    "measure": "streams",
                    "aggregation": "average",
                },
                _columns(),
                _dtypes(),
            )
            self.assertEqual(out["chart_type"], chart_type)

    def test_valid_scatter(self):
        out = validate_chart_request(
            {"chart_type": "scatter", "dimension": "when", "measure": "streams"},
            _columns(),
            _dtypes(),
        )
        self.assertEqual(out["limit"], MAX_SCATTER_POINTS)

    def test_alias_columns_accepted(self):
        out = validate_chart_request(
            {
                "chart_type": "scatter",
                "x_column": "when",
                "y_column": "streams",
            },
            _columns(),
            _dtypes(),
        )
        self.assertEqual(out["dimension"], "when")
        self.assertEqual(out["measure"], "streams")

    def test_aggregation_aliases(self):
        for alias in ("avg", "mean", "AVERAGE"):
            out = validate_chart_request(
                {
                    "chart_type": "bar",
                    "dimension": "genre",
                    "measure": "streams",
                    "aggregation": alias,
                },
                _columns(),
                _dtypes(),
            )
            self.assertEqual(out["aggregation"], "average")

    def test_missing_fields(self):
        with self.assertRaises(ChartValidationError):
            validate_chart_request({"dimension": "genre"}, _columns(), _dtypes())
        with self.assertRaises(ChartValidationError):
            validate_chart_request(
                {"chart_type": "bar", "measure": "streams", "aggregation": "sum"},
                _columns(),
                _dtypes(),
            )
        with self.assertRaises(ChartValidationError):
            validate_chart_request(
                {"chart_type": "bar", "dimension": "genre", "measure": "streams"},
                _columns(),
                _dtypes(),
            )

    def test_unknown_columns(self):
        with self.assertRaises(ChartValidationError):
            validate_chart_request(
                {
                    "chart_type": "bar",
                    "dimension": "nope",
                    "measure": "streams",
                    "aggregation": "sum",
                },
                _columns(),
                _dtypes(),
            )
        with self.assertRaises(ChartValidationError):
            validate_chart_request(
                {
                    "chart_type": "bar",
                    "dimension": "genre",
                    "measure": "nope",
                    "aggregation": "sum",
                },
                _columns(),
                _dtypes(),
            )

    def test_invalid_aggregation(self):
        with self.assertRaises(ChartValidationError):
            validate_chart_request(
                {
                    "chart_type": "bar",
                    "dimension": "genre",
                    "measure": "streams",
                    "aggregation": "median",
                },
                _columns(),
                _dtypes(),
            )

    def test_invalid_chart_type(self):
        with self.assertRaises(ChartValidationError):
            validate_chart_request(
                {
                    "chart_type": "histogram",
                    "dimension": "genre",
                    "measure": "streams",
                    "aggregation": "sum",
                },
                _columns(),
                _dtypes(),
            )

    def test_invalid_limit(self):
        for bad in (0, -1, MAX_CHART_CATEGORIES + 1, 10**9, "many", True, 1.5):
            with self.assertRaises(ChartValidationError, msg=repr(bad)):
                validate_chart_request(
                    {
                        "chart_type": "bar",
                        "dimension": "genre",
                        "measure": "streams",
                        "aggregation": "sum",
                        "limit": bad,
                    },
                    _columns(),
                    _dtypes(),
                )

    def test_invalid_sort_and_granularity(self):
        base = {
            "chart_type": "bar",
            "dimension": "genre",
            "measure": "streams",
            "aggregation": "sum",
        }
        with self.assertRaises(ChartValidationError):
            validate_chart_request({**base, "sort": "value"}, _columns(), _dtypes())
        with self.assertRaises(ChartValidationError):
            validate_chart_request(
                {**base, "date_granularity": "hour"}, _columns(), _dtypes()
            )
        # Granularity on a categorical dimension is rejected.
        with self.assertRaises(ChartValidationError):
            validate_chart_request(
                {**base, "date_granularity": "month"}, _columns(), _dtypes()
            )
        # Granularity on scatter is rejected.
        with self.assertRaises(ChartValidationError):
            validate_chart_request(
                {
                    "chart_type": "scatter",
                    "dimension": "when",
                    "measure": "streams",
                    "date_granularity": "month",
                },
                _columns(),
                _dtypes(),
            )

    def test_malformed_filters_rejected(self):
        with self.assertRaises((ChartValidationError, FilterValidationError)):
            validate_chart_request(
                {
                    "chart_type": "bar",
                    "dimension": "genre",
                    "measure": "streams",
                    "aggregation": "sum",
                    "filters": [{"column": "genre", "operator": "frobnicate"}],
                },
                _columns(),
                _dtypes(),
            )
        with self.assertRaises((ChartValidationError, FilterValidationError)):
            validate_chart_request(
                {
                    "chart_type": "bar",
                    "dimension": "genre",
                    "measure": "streams",
                    "aggregation": "sum",
                    "filters": "genre=Pop",
                },
                _columns(),
                _dtypes(),
            )

    def test_unknown_field_rejected(self):
        with self.assertRaises(ChartValidationError):
            validate_chart_request(
                {
                    "chart_type": "bar",
                    "dimension": "genre",
                    "measure": "streams",
                    "aggregation": "sum",
                    "query": "streams.sum()",
                },
                _columns(),
                _dtypes(),
            )

    def test_non_numeric_measure_rejected(self):
        with self.assertRaises(ChartValidationError):
            aggregate_chart(
                _make_frame(),
                validate_chart_request(
                    {
                        "chart_type": "bar",
                        "dimension": "plays",
                        "measure": "genre",
                        "aggregation": "sum",
                    },
                    ["genre", "streams", "plays", "when"],
                    {"genre": "categorical", "plays": "numeric",
                     "streams": "numeric", "when": "datetime"},
                ),
                {"genre": "categorical", "plays": "numeric",
                 "streams": "numeric", "when": "datetime"},
            )

    def test_wrong_dimension_kind_rejected(self):
        df = _make_frame()
        # Bar on a datetime dimension.
        with self.assertRaises(ChartValidationError):
            aggregate_chart(
                df,
                validate_chart_request(
                    {
                        "chart_type": "bar",
                        "dimension": "when",
                        "measure": "streams",
                        "aggregation": "sum",
                    },
                    _columns(),
                    _dtypes(),
                ),
                _dtypes(),
            )
        # Line on a categorical dimension.
        with self.assertRaises(ChartValidationError):
            aggregate_chart(
                df,
                validate_chart_request(
                    {
                        "chart_type": "line",
                        "dimension": "genre",
                        "measure": "streams",
                        "aggregation": "sum",
                    },
                    _columns(),
                    _dtypes(),
                ),
                _dtypes(),
            )
        # Scatter on a categorical X.
        with self.assertRaises(ChartValidationError):
            aggregate_chart(
                df,
                validate_chart_request(
                    {
                        "chart_type": "scatter",
                        "dimension": "genre",
                        "measure": "streams",
                    },
                    _columns(),
                    _dtypes(),
                ),
                _dtypes(),
            )


class AggregationCorrectnessTest(unittest.TestCase):
    def _chart(self, **over):
        body = {
            "chart_type": "bar",
            "dimension": "genre",
            "measure": "streams",
            "aggregation": "sum",
        }
        body.update(over)
        return aggregate_chart(
            _make_frame(), validate_chart_request(body, _columns(), _dtypes()), _dtypes()
        )

    def test_sum_matches_frontend_semantics(self):
        # Pop: 100 + 200 + (missing -> 0) = 300.
        result = self._chart()
        by_label = {d["label"]: d["value"] for d in result["data"]}
        self.assertEqual(by_label["Pop"], 300)
        self.assertEqual(by_label["Rock"], 150)
        self.assertEqual(by_label["Soul"], 1000)
        # Blank group exists for None/"" (60 + 40).
        self.assertEqual(by_label["(blank)"], 100)

    def test_count_counts_rows(self):
        result = self._chart(aggregation="count", measure=None)
        by_label = {d["label"]: d["value"] for d in result["data"]}
        self.assertEqual(by_label["Pop"], 3)
        self.assertEqual(by_label["Rock"], 3)
        self.assertEqual(by_label["(blank)"], 2)

    def test_average_min_max(self):
        avg = self._chart(aggregation="average")
        by_label = {d["label"]: d["value"] for d in avg["data"]}
        self.assertAlmostEqual(by_label["Pop"], 150.0)
        result_min = self._chart(aggregation="min")
        by_min = {d["label"]: d["value"] for d in result_min["data"]}
        self.assertEqual(by_min["Pop"], 100)
        result_max = self._chart(aggregation="max")
        by_max = {d["label"]: d["value"] for d in result_max["data"]}
        self.assertEqual(by_max["Pop"], 200)

    def test_value_desc_ordering_blank_last(self):
        result = self._chart()
        labels = [d["label"] for d in result["data"]]
        # Soul (1000) first; blank always last even though 100 > Jazz 10.
        self.assertEqual(labels[0], "Soul")
        self.assertEqual(labels[-1], "(blank)")
        values = [d["value"] for d in result["data"][:-1]]
        self.assertEqual(values, sorted(values, reverse=True))

    def test_sort_ascending_and_category(self):
        asc = self._chart(sort="ascending")
        values = [d["value"] for d in asc["data"] if d["label"] != "(blank)"]
        self.assertEqual(values, sorted(values))
        cat = self._chart(sort="category")
        labels = [d["label"] for d in cat["data"]]
        # Blank always sorts last (frontend parity), the rest ascending.
        self.assertEqual(labels[-1], "(blank)")
        self.assertEqual(labels[:-1], sorted(labels[:-1]))

    def test_tie_break_label_ascending(self):
        df = pd.DataFrame(
            {"g": ["b", "a", "b", "a"], "v": [5, 5, 5, 5]}
        )
        dtypes = {"g": "categorical", "v": "numeric"}
        result = aggregate_chart(
            df,
            validate_chart_request(
                {
                    "chart_type": "bar",
                    "dimension": "g",
                    "measure": "v",
                    "aggregation": "sum",
                },
                ["g", "v"],
                dtypes,
            ),
            dtypes,
        )
        self.assertEqual([d["label"] for d in result["data"]], ["a", "b"])

    def test_pie_keeps_only_positive(self):
        df = pd.DataFrame(
            {"g": ["a", "b", "c", "d"], "v": [10, 0, -5, 7]}
        )
        dtypes = {"g": "categorical", "v": "numeric"}
        result = aggregate_chart(
            df,
            validate_chart_request(
                {
                    "chart_type": "pie",
                    "dimension": "g",
                    "measure": "v",
                    "aggregation": "sum",
                },
                ["g", "v"],
                dtypes,
            ),
            dtypes,
        )
        self.assertEqual(
            sorted(d["label"] for d in result["data"]), ["a", "d"]
        )


class FilterCorrectnessTest(unittest.TestCase):
    def _chart(self, filters, **over):
        body = {
            "chart_type": "bar",
            "dimension": "genre",
            "measure": "streams",
            "aggregation": "sum",
            "filters": filters,
        }
        body.update(over)
        return aggregate_chart(
            _make_frame(), validate_chart_request(body, _columns(), _dtypes()), _dtypes()
        )

    def test_categorical_filter_then_aggregate(self):
        result = self._chart(
            [{"column": "genre", "operator": "in", "value": ["Pop"]}]
        )
        self.assertEqual(result["filtered_row_count"], 3)
        self.assertEqual(len(result["data"]), 1)
        self.assertEqual(result["data"][0], {"label": "Pop", "value": 300})

    def test_numeric_filter(self):
        result = self._chart(
            [{"column": "streams", "operator": "gte", "value": 100}]
        )
        # 100, 200, 1000 match; missing never matches.
        self.assertEqual(result["filtered_row_count"], 3)

    def test_datetime_filter(self):
        result = self._chart(
            [{"column": "when", "operator": "gte", "value": "2021-02-01"}],
            chart_type="line",
            dimension="when",
        )
        self.assertEqual(result["filtered_row_count"], 6)

    def test_multiple_and_filters(self):
        result = self._chart(
            [
                {"column": "genre", "operator": "in", "value": ["Pop", "Rock"]},
                {"column": "streams", "operator": "gte", "value": 75},
            ]
        )
        # Pop: 100, 200; Rock: 75. (25 and missing excluded.)
        self.assertEqual(result["filtered_row_count"], 3)

    def test_empty_result_is_valid(self):
        result = self._chart(
            [{"column": "genre", "operator": "eq", "value": "Nope"}]
        )
        self.assertEqual(result["filtered_row_count"], 0)
        self.assertEqual(result["data"], [])
        self.assertFalse(result["truncated"])

    def test_filtered_count_matches_m3_mask(self):
        from filter_engine import build_filter_mask

        filters = [{"column": "genre", "operator": "in", "value": ["Rock"]}]
        mask = build_filter_mask(_make_frame(), filters, _dtypes())
        result = self._chart(filters)
        self.assertEqual(result["filtered_row_count"], int(mask.sum()))


class TopNTest(unittest.TestCase):
    def test_limit_enforced_and_truncated(self):
        df = pd.DataFrame(
            {
                "g": [f"c{i:03d}" for i in range(50) for _ in range(2)],
                "v": [1] * 100,
            }
        )
        dtypes = {"g": "text", "v": "numeric"}
        result = aggregate_chart(
            df,
            validate_chart_request(
                {
                    "chart_type": "bar",
                    "dimension": "g",
                    "measure": "v",
                    "aggregation": "count",
                    "limit": 20,
                },
                ["g", "v"],
                dtypes,
            ),
            dtypes,
        )
        self.assertEqual(len(result["data"]), 20)
        self.assertTrue(result["truncated"])
        self.assertEqual(result["total_groups"], 50)

    def test_oversized_limit_rejected(self):
        with self.assertRaises(ChartValidationError):
            validate_chart_request(
                {
                    "chart_type": "bar",
                    "dimension": "genre",
                    "measure": "streams",
                    "aggregation": "sum",
                    "limit": MAX_CHART_CATEGORIES + 1,
                },
                _columns(),
                _dtypes(),
            )

    def test_deterministic_output(self):
        df = pd.DataFrame(
            {"g": ["x", "y", "z", "x", "y"], "v": [3, 1, 2, 4, 5]}
        )
        dtypes = {"g": "categorical", "v": "numeric"}
        first = aggregate_chart(
            df,
            validate_chart_request(
                {
                    "chart_type": "bar",
                    "dimension": "g",
                    "measure": "v",
                    "aggregation": "sum",
                },
                ["g", "v"],
                dtypes,
            ),
            dtypes,
        )
        second = aggregate_chart(
            df,
            validate_chart_request(
                {
                    "chart_type": "bar",
                    "dimension": "g",
                    "measure": "v",
                    "aggregation": "sum",
                },
                ["g", "v"],
                dtypes,
            ),
            dtypes,
        )
        self.assertEqual(first["data"], second["data"])

    def test_high_cardinality_bounded(self):
        df = pd.DataFrame(
            {"g": [f"id-{i}" for i in range(5000)], "v": [1] * 5000}
        )
        dtypes = {"g": "text", "v": "numeric"}
        result = aggregate_chart(
            df,
            validate_chart_request(
                {
                    "chart_type": "bar",
                    "dimension": "g",
                    "measure": "v",
                    "aggregation": "count",
                },
                ["g", "v"],
                dtypes,
            ),
            dtypes,
        )
        self.assertLessEqual(len(result["data"]), MAX_CHART_CATEGORIES)
        self.assertTrue(result["truncated"])


class DateGroupingTest(unittest.TestCase):
    def test_day_grouping_chronological(self):
        result = aggregate_chart(
            _make_frame(),
            validate_chart_request(
                {
                    "chart_type": "line",
                    "dimension": "when",
                    "measure": "streams",
                    "aggregation": "sum",
                },
                _columns(),
                _dtypes(),
            ),
            _dtypes(),
        )
        labels = [d["label"] for d in result["data"]]
        # Chronological with the blank group last (frontend parity).
        self.assertEqual(labels[-1], "(blank)")
        self.assertEqual(labels[:-1], sorted(labels[:-1]))
        by_label = {d["label"]: d["value"] for d in result["data"]}
        # 2021-01-05: 100 + 200 + 40 = 340 (missing datetime -> blank).
        self.assertEqual(by_label["2021-01-05"], 340)

    def test_month_bucketing(self):
        result = aggregate_chart(
            _make_frame(),
            validate_chart_request(
                {
                    "chart_type": "line",
                    "dimension": "when",
                    "measure": "streams",
                    "aggregation": "sum",
                    "date_granularity": "month",
                },
                _columns(),
                _dtypes(),
            ),
            _dtypes(),
        )
        labels = [d["label"] for d in result["data"]]
        self.assertIn("2021-01-01", labels)
        self.assertIn("2021-02-01", labels)
        self.assertEqual(labels[-1], "(blank)")
        self.assertEqual(labels[:-1], sorted(labels[:-1]))

    def test_missing_dates_grouped_blank(self):
        result = aggregate_chart(
            _make_frame(),
            validate_chart_request(
                {
                    "chart_type": "line",
                    "dimension": "when",
                    "measure": "streams",
                    "aggregation": "count",
                },
                _columns(),
                _dtypes(),
            ),
            _dtypes(),
        )
        by_label = {d["label"]: d["value"] for d in result["data"]}
        self.assertEqual(by_label.get("(blank)"), 1)
        labels = [d["label"] for d in result["data"]]
        self.assertEqual(labels[-1], "(blank)")


class ScatterTest(unittest.TestCase):
    def test_bounded_and_chronological(self):
        df = pd.DataFrame(
            {
                "when": pd.date_range("2021-01-01", periods=5000, freq="D"),
                "v": list(range(5000)),
            }
        )
        dtypes = {"when": "datetime", "v": "numeric"}
        result = aggregate_chart(
            df,
            validate_chart_request(
                {"chart_type": "scatter", "dimension": "when", "measure": "v"},
                ["when", "v"],
                dtypes,
            ),
            dtypes,
        )
        self.assertLessEqual(len(result["data"]), MAX_SCATTER_POINTS)
        self.assertTrue(result["truncated"])
        xs = [d["x"] for d in result["data"]]
        self.assertEqual(xs, sorted(xs))

    def test_deterministic_sampling(self):
        df = pd.DataFrame(
            {
                "when": pd.date_range("2021-01-01", periods=3000, freq="h"),
                "v": [float(i % 100) for i in range(3000)],
            }
        )
        dtypes = {"when": "datetime", "v": "numeric"}
        norm = validate_chart_request(
            {"chart_type": "scatter", "dimension": "when", "measure": "v"},
            ["when", "v"],
            dtypes,
        )
        first = aggregate_chart(df, norm, dtypes)
        second = aggregate_chart(df, norm, dtypes)
        self.assertEqual(first["data"], second["data"])

    def test_filtered_scatter(self):
        df = _make_frame()
        result = aggregate_chart(
            df,
            validate_chart_request(
                {
                    "chart_type": "scatter",
                    "dimension": "when",
                    "measure": "streams",
                    "filters": [
                        {"column": "genre", "operator": "eq", "value": "Pop"}
                    ],
                },
                _columns(),
                _dtypes(),
            ),
            _dtypes(),
        )
        # Pop rows: two valid (2021-01-05 x2), one missing measure skipped.
        self.assertEqual(result["filtered_row_count"], 3)
        self.assertEqual(len(result["data"]), 2)

    def test_missing_values_skipped(self):
        df = pd.DataFrame(
            {
                "when": pd.to_datetime(["2021-01-01", None, "2021-01-03"]),
                "v": [1.0, 2.0, float("nan")],
            }
        )
        dtypes = {"when": "datetime", "v": "numeric"}
        result = aggregate_chart(
            df,
            validate_chart_request(
                {"chart_type": "scatter", "dimension": "when", "measure": "v"},
                ["when", "v"],
                dtypes,
            ),
            dtypes,
        )
        self.assertEqual(len(result["data"]), 1)

    def test_non_numeric_measure_rejected(self):
        with self.assertRaises(ChartValidationError):
            aggregate_chart(
                _make_frame(),
                validate_chart_request(
                    {
                        "chart_type": "scatter",
                        "dimension": "when",
                        "measure": "genre",
                    },
                    _columns(),
                    _dtypes(),
                ),
                _dtypes(),
            )


class SecurityTest(unittest.TestCase):
    def test_no_expression_execution(self):
        evil = {
            "chart_type": "bar",
            "dimension": "genre",
            "measure": "streams",
            "aggregation": "sum",
            "filters": [],
            "query": "__import__('os').system('id')",
        }
        with self.assertRaises(ChartValidationError):
            validate_chart_request(evil, _columns(), _dtypes())
        for payload in (
            {"chart_type": "bar; import os", "dimension": "genre",
             "measure": "streams", "aggregation": "sum"},
            {"chart_type": "bar", "dimension": "genre",
             "measure": "streams", "aggregation": "sum",
             "filters": [{"column": "streams", "operator": "eq",
                          "value": "__import__('os')"}]},
        ):
            with self.assertRaises((ChartValidationError, FilterValidationError)):
                aggregate_chart(
                    _make_frame(),
                    validate_chart_request(payload, _columns(), _dtypes()),
                    _dtypes(),
                )


class ChartApiTest(unittest.TestCase):
    def setUp(self):
        _clear_global_store()
        from app import create_app

        self.client = create_app(cors_origins=["http://localhost:5173"]).test_client()

    def tearDown(self):
        _clear_global_store()

    def _upload(self, frame):
        return _upload_frame(self.client, frame)

    def test_bar_end_to_end(self):
        meta = self._upload(_make_frame())
        dataset_id = meta["dataset_id"]
        resp = self.client.post(
            f"/api/datasets/{dataset_id}/chart",
            json={
                "chart_type": "bar",
                "dimension": "genre",
                "measure": "streams",
                "aggregation": "sum",
            },
        )
        self.assertEqual(resp.status_code, 200)
        body = json.loads(resp.data)
        self.assertEqual(body["dataset_id"], dataset_id)
        self.assertEqual(body["row_count"], 10)
        self.assertEqual(body["filtered_row_count"], 10)
        self.assertLessEqual(len(body["data"]), MAX_CHART_CATEGORIES)
        self.assertIn("truncated", body)

    def test_every_chart_type(self):
        meta = self._upload(_make_frame())
        dataset_id = meta["dataset_id"]
        cases = [
            {"chart_type": "bar", "dimension": "genre",
             "measure": "streams", "aggregation": "sum"},
            {"chart_type": "line", "dimension": "when",
             "measure": "streams", "aggregation": "average"},
            {"chart_type": "area", "dimension": "when",
             "measure": "streams", "aggregation": "max"},
            {"chart_type": "pie", "dimension": "genre",
             "measure": "streams", "aggregation": "sum"},
            {"chart_type": "scatter", "dimension": "when",
             "measure": "streams"},
        ]
        for payload in cases:
            resp = self.client.post(
                f"/api/datasets/{dataset_id}/chart", json=payload
            )
            self.assertEqual(resp.status_code, 200, payload)
            body = json.loads(resp.data)
            self.assertIn("data", body)

    def test_chart_with_filters(self):
        meta = self._upload(_make_frame())
        dataset_id = meta["dataset_id"]
        resp = self.client.post(
            f"/api/datasets/{dataset_id}/chart",
            json={
                "chart_type": "bar",
                "dimension": "genre",
                "measure": "streams",
                "aggregation": "sum",
                "filters": [
                    {"column": "genre", "operator": "in", "value": ["Pop"]}
                ],
            },
        )
        self.assertEqual(resp.status_code, 200)
        body = json.loads(resp.data)
        self.assertEqual(body["filtered_row_count"], 3)

    def test_unknown_and_expired_dataset_404(self):
        resp = self.client.post(
            "/api/datasets/doesnotexist/chart",
            json={
                "chart_type": "bar",
                "dimension": "genre",
                "measure": "streams",
                "aggregation": "sum",
            },
        )
        self.assertEqual(resp.status_code, 404)
        meta = self._upload(_make_frame())
        dataset_id = meta["dataset_id"]
        dataset_store.delete_dataset(dataset_id)
        resp = self.client.post(
            f"/api/datasets/{dataset_id}/chart",
            json={
                "chart_type": "bar",
                "dimension": "genre",
                "measure": "streams",
                "aggregation": "sum",
            },
        )
        self.assertEqual(resp.status_code, 404)

    def test_invalid_request_400(self):
        meta = self._upload(_make_frame())
        dataset_id = meta["dataset_id"]
        for payload in (
            {"chart_type": "bar", "dimension": "genre",
             "measure": "streams", "aggregation": "median"},
            {"chart_type": "bar", "dimension": "genre",
             "measure": "streams", "aggregation": "sum", "limit": 5000},
            {"chart_type": "wizard", "dimension": "genre",
             "measure": "streams", "aggregation": "sum"},
            {"chart_type": "bar", "dimension": "missing",
             "measure": "streams", "aggregation": "sum"},
        ):
            resp = self.client.post(
                f"/api/datasets/{dataset_id}/chart", json=payload
            )
            self.assertEqual(resp.status_code, 400, payload)

    def test_empty_result_200(self):
        meta = self._upload(_make_frame())
        dataset_id = meta["dataset_id"]
        resp = self.client.post(
            f"/api/datasets/{dataset_id}/chart",
            json={
                "chart_type": "bar",
                "dimension": "genre",
                "measure": "streams",
                "aggregation": "sum",
                "filters": [
                    {"column": "genre", "operator": "eq", "value": "Nope"}
                ],
            },
        )
        self.assertEqual(resp.status_code, 200)
        body = json.loads(resp.data)
        self.assertEqual(body["data"], [])
        self.assertEqual(body["filtered_row_count"], 0)

    def test_cannot_force_oversized_response(self):
        df = pd.DataFrame(
            {"g": [f"g-{i}" for i in range(2000)], "v": [1] * 2000}
        )
        meta = self._upload(df)
        dataset_id = meta["dataset_id"]
        resp = self.client.post(
            f"/api/datasets/{dataset_id}/chart",
            json={
                "chart_type": "bar",
                "dimension": "g",
                "measure": "v",
                "aggregation": "count",
                "limit": 10**6,
            },
        )
        self.assertEqual(resp.status_code, 400)
        resp = self.client.post(
            f"/api/datasets/{dataset_id}/chart",
            json={
                "chart_type": "bar",
                "dimension": "g",
                "measure": "v",
                "aggregation": "count",
            },
        )
        self.assertEqual(resp.status_code, 200)
        body = json.loads(resp.data)
        self.assertLessEqual(len(body["data"]), MAX_CHART_CATEGORIES)

    def test_frame_never_mutated(self):
        frame = _make_frame()
        before = frame.copy(deep=True)
        aggregate_chart(
            frame,
            validate_chart_request(
                {
                    "chart_type": "bar",
                    "dimension": "genre",
                    "measure": "streams",
                    "aggregation": "sum",
                },
                _columns(),
                _dtypes(),
            ),
            _dtypes(),
        )
        pd.testing.assert_frame_equal(frame, before)

    def test_non_json_body_400(self):
        meta = self._upload(_make_frame())
        dataset_id = meta["dataset_id"]
        resp = self.client.post(
            f"/api/datasets/{dataset_id}/chart",
            data="not json",
            content_type="text/plain",
        )
        self.assertEqual(resp.status_code, 400)


if __name__ == "__main__":
    unittest.main()
