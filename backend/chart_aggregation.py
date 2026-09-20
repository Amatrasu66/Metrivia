"""Metrivia Phase M4 — server-side chart aggregation.

Large server-backed datasets must never reach the browser in full merely to
draw a chart. This module aggregates the canonical M1 DataFrame behind
``POST /api/datasets/<dataset_id>/chart`` and returns a small bounded
payload that the existing React/Bklit chart components render unchanged.

Pipeline (always in this order)::

    DataFrame -> M3 filter mask -> filtered rows -> aggregation -> bounded response

The M3 filter engine (``filter_engine.py``) is reused verbatim — no second
filtering language. Only structured ``{column, operator, value}`` descriptors
are accepted; ``eval``/``exec``/``df.query`` with client strings are never
used anywhere in this module.

Frontend naming alignment (see ``frontend/src/lib/chart-data.js``):

- ``chart_type``: bar | line | area | pie | scatter
- ``dimension``: grouped category column (bar/pie) or datetime X column
  (line/area/scatter). Aliases ``x_column`` / ``category_column`` accepted.
- ``measure``: numeric value column (grouped charts) or numeric Y column
  (scatter). Aliases ``y_column`` / ``value_column`` accepted. ``None`` only
  when ``aggregation`` is ``count`` (grouped charts).
- ``aggregation``: sum | average | min | max | count. Aliases ``avg`` and
  ``mean`` normalize to ``average``. Scatter ignores it (accepted, unused).
- ``filters``: M3 structured list (AND semantics, same as the table).
- ``limit``: max groups (grouped) or points (scatter) to return.
- ``sort``: descending | ascending | category (label ascending).
- ``date_granularity``: day | week | month | quarter | year — datetime
  bucketing for grouped charts on a datetime dimension (default day).
  The current UI groups line/area by day (release_date values are already
  YYYY-MM-DD strings), so day is the default and the frontend sends nothing.

Limits (single source of truth, mirror the UI caps):

- ``MAX_CHART_CATEGORIES = 20`` — grouped charts return at most 20 groups,
  matching ``MAX_CHART_CATEGORIES`` in ``chart-data.js`` and the 20-label
  ``BarXAxis`` / 20-entry pie legend. Clients cannot request more (400).
- ``MAX_SCATTER_POINTS = 2000`` — scatter returns at most 2000 points via
  deterministic evenly-spaced sampling. The installed scatter view renders
  ~1200-point dense views readably; 2000 keeps headroom while staying ~50 KiB.

Ordering (deterministic, mirrors ``transformChartData``):

- Categorical/boolean grouped charts default to value descending
  (``sort="descending"``); ties break by label ascending.
- Datetime grouped charts default to label ascending (chronological;
  ISO day labels sort lexicographically = chronologically).
- The ``"(blank)"`` group (missing dimension values) always sorts last,
  exactly like the frontend comparator.
- Scatter points sort by timestamp ascending.

Top-N: groups are sorted first, then sliced to ``limit``. ``truncated`` is
true when more groups existed than returned. There is no "Others" bucket
(the current UI has none) — truncation is documented top-N.

Scatter sampling: valid (datetime, numeric) pairs are collected in filtered
row order, then evenly spaced to ``limit`` (``round(i*(n-1)/(limit-1))``),
then sorted by time. No randomness, no seed — stable for the same
dataset/filter/config.

Timezone: timestamps are treated as naive wall time (no tz conversion).
Day buckets are calendar days of the stored values; ISO-8601 labels sort
chronologically. Invalid/missing dates never match value grouping — they
form the ``"(blank)"`` group (grouped) or are skipped (scatter).
"""

import math

import pandas as pd

try:
    from filter_engine import (
        FilterValidationError,
        build_filter_mask,
        validate_filter_request,
    )
except Exception:  # pragma: no cover - importable both as module and package
    from backend.filter_engine import (  # type: ignore
        FilterValidationError,
        build_filter_mask,
        validate_filter_request,
    )


class ChartValidationError(ValueError):
    """A client-facing chart validation failure (HTTP 400)."""


# Supported chart types (one endpoint, never one per type).
CHART_TYPES = frozenset({"bar", "line", "area", "pie", "scatter"})

# Canonical aggregation ids (match frontend AGGREGATIONS). ``avg``/``mean``
# are accepted aliases for ``average``.
AGGREGATIONS = frozenset({"sum", "average", "min", "max", "count"})
_AGGREGATION_ALIASES = {"avg": "average", "mean": "average"}

_GROUPED_TYPES = frozenset({"bar", "line", "area", "pie"})

# Fixed whitelist of sort modes. ``descending``/``ascending`` order by
# aggregated value; ``category`` orders by label ascending (chronological
# for ISO datetime labels).
SORT_MODES = frozenset({"descending", "ascending", "category"})

# Datetime bucketing units for grouped charts on a datetime dimension.
DATE_GRANULARITIES = frozenset({"day", "week", "month", "quarter", "year"})

# Bounded responses (single source of truth for the backend).
MAX_CHART_CATEGORIES = 20
MAX_SCATTER_POINTS = 2000

# Label for missing dimension values (matches the frontend BLANK_LABEL).
BLANK_LABEL = "(blank)"

# Top-level request fields (canonical + aliases). Unknown fields are 400.
_ALLOWED_FIELDS = frozenset(
    {
        "chart_type",
        "dimension",
        "measure",
        "aggregation",
        "filters",
        "limit",
        "sort",
        "date_granularity",
        # Aliases adapted from the generic x/y naming.
        "x_column",
        "y_column",
        "category_column",
        "value_column",
    }
)


def _is_bool_value(value):
    return isinstance(value, bool)


def _normalize_aggregation(raw):
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise ChartValidationError(
            "Invalid 'aggregation'. Supported aggregations: "
            + ", ".join(sorted(AGGREGATIONS))
            + "."
        )
    text = raw.strip().lower()
    text = _AGGREGATION_ALIASES.get(text, text)
    if text not in AGGREGATIONS:
        raise ChartValidationError(
            f"Invalid aggregation '{raw}'. Supported aggregations: "
            + ", ".join(sorted(AGGREGATIONS))
            + "."
        )
    return text


def _dimension_kind(series, column, dtypes):
    if isinstance(dtypes, dict) and column in dtypes:
        kind = dtypes.get(column)
        if kind in ("numeric", "datetime", "categorical", "boolean", "text"):
            return kind
    if pd.api.types.is_datetime64_any_dtype(series.dtype):
        return "datetime"
    if pd.api.types.is_bool_dtype(series.dtype):
        return "boolean"
    if pd.api.types.is_numeric_dtype(series.dtype):
        return "numeric"
    # Object/string columns that fully parse as datetimes behave as datetime
    # (same rule as analysis classification probing).
    try:
        non_null = series.dropna()
        if len(non_null) > 0:
            parsed = pd.to_datetime(
                non_null.head(1000), errors="coerce", format="mixed"
            )
            if not parsed.isna().any():
                return "datetime"
    except Exception:
        pass
    try:
        unique_count = int(series.nunique(dropna=True))
    except Exception:
        unique_count = None
    if unique_count is not None and unique_count <= 20:
        return "categorical"
    return "text"


def _normalize_limit(raw, chart_type):
    maximum = MAX_SCATTER_POINTS if chart_type == "scatter" else MAX_CHART_CATEGORIES
    if raw is None:
        return maximum
    if _is_bool_value(raw):
        raise ChartValidationError("Invalid 'limit'. It must be an integer.")
    try:
        if isinstance(raw, float):
            if not raw.is_integer():
                raise ValueError()
            value = int(raw)
        elif isinstance(raw, int):
            value = raw
        elif isinstance(raw, str):
            text = raw.strip()
            if text == "":
                raise ValueError()
            number = float(text)
            if not number.is_integer():
                raise ValueError()
            value = int(number)
        else:
            raise ValueError()
    except (TypeError, ValueError):
        raise ChartValidationError(
            f"Invalid 'limit'. It must be an integer between 1 and {maximum}."
        ) from None
    if value < 1 or value > maximum:
        raise ChartValidationError(
            f"Invalid 'limit'. It must be an integer between 1 and {maximum}."
        )
    return value


def _category_label(value):
    """Frontend-compatible group label (missing -> "(blank)")."""
    if value is None or value is pd.NA or value is pd.NaT:
        return BLANK_LABEL
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return BLANK_LABEL
    try:
        if pd.isna(value):
            return BLANK_LABEL
    except (TypeError, ValueError):
        pass
    if isinstance(value, str) and value == "":
        return BLANK_LABEL
    if isinstance(value, bool):
        return "true" if value else "false"
    try:
        import numpy as _np

        if isinstance(value, _np.bool_):
            return "true" if bool(value) else "false"
    except Exception:
        pass
    if isinstance(value, pd.Timestamp):
        if pd.isna(value):
            return BLANK_LABEL
        return value.isoformat()[:10]
    return str(value)


def _day_string(value):
    """Normalize one cell to YYYY-MM-DD, or None when missing/invalid."""
    if value is None or value is pd.NA or value is pd.NaT:
        return None
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, str):
        if value == "":
            return None
        if len(value) >= 10 and value[4:5] == "-" and value[7:8] == "-":
            head = value[:10]
            try:
                pd.to_datetime(head, errors="raise", format="mixed")
                return head
            except Exception:
                pass
    if isinstance(value, pd.Timestamp):
        if pd.isna(value):
            return None
        return value.isoformat()[:10]
    try:
        parsed = pd.to_datetime(value, errors="coerce", format="mixed")
    except Exception:
        return None
    if pd.isna(parsed):
        return None
    try:
        return pd.Timestamp(parsed).isoformat()[:10]
    except Exception:
        return None


def _is_missing_day(day):
    """True for the NaN/None/NA markers strftime() emits for NaT."""
    if day is None or day is pd.NA or day is pd.NaT:
        return True
    if isinstance(day, float) and math.isnan(day):
        return True
    try:
        if pd.isna(day):
            return True
    except (TypeError, ValueError):
        pass
    return False


def _truncate_label(day, granularity):
    """Bucket a YYYY-MM-DD label to the period start (still ISO, sortable)."""
    try:
        ts = pd.Timestamp(day)
    except Exception:
        return day
    if granularity == "day":
        return day
    if granularity == "week":
        monday = ts - pd.Timedelta(days=int(ts.weekday()))
        return monday.isoformat()[:10]
    if granularity == "month":
        return f"{ts.year:04d}-{ts.month:02d}-01"
    if granularity == "quarter":
        start_month = ((int(ts.month) - 1) // 3) * 3 + 1
        return f"{ts.year:04d}-{start_month:02d}-01"
    if granularity == "year":
        return f"{ts.year:04d}-01-01"
    return day


def validate_chart_request(data, columns, dtypes=None):
    """Validate a chart body; return the normalized query descriptor.

    ``columns`` is the exact dataset column list, ``dtypes`` optionally the
    analysis kind map. Raises ChartValidationError (400) or
    FilterValidationError (400, from M3 validation) on any client error.
    Never executes client strings.
    """
    if not isinstance(data, dict):
        raise ChartValidationError("Invalid JSON body.")
    for key in data.keys():
        if key not in _ALLOWED_FIELDS:
            raise ChartValidationError(f"Unknown field '{key}'.")
    column_list = list(columns) if isinstance(columns, (list, tuple)) else []

    raw_type = data.get("chart_type")
    if not isinstance(raw_type, str) or raw_type.strip().lower() not in CHART_TYPES:
        raise ChartValidationError(
            "Invalid 'chart_type'. Supported types: "
            + ", ".join(sorted(CHART_TYPES))
            + "."
        )
    chart_type = raw_type.strip().lower()

    dimension = data.get("dimension", data.get("x_column", data.get("category_column")))
    if dimension is None and "x_column" in data:
        dimension = data.get("x_column")
    if not isinstance(dimension, str) or dimension == "":
        raise ChartValidationError("'dimension' must be a non-empty string.")
    if dimension not in column_list:
        raise ChartValidationError(f"Unknown column '{dimension}'.")

    raw_agg = data.get("aggregation")
    aggregation = _normalize_aggregation(raw_agg)
    if chart_type in _GROUPED_TYPES and aggregation is None:
        raise ChartValidationError(
            "Invalid 'aggregation'. Supported aggregations: "
            + ", ".join(sorted(AGGREGATIONS))
            + "."
        )

    measure = data.get("measure", data.get("y_column", data.get("value_column")))
    needs_measure = chart_type == "scatter" or (
        chart_type in _GROUPED_TYPES and aggregation != "count"
    )
    if needs_measure:
        if not isinstance(measure, str) or measure == "":
            raise ChartValidationError(
                "'measure' must be a non-empty string for this chart."
            )
        if measure not in column_list:
            raise ChartValidationError(f"Unknown column '{measure}'.")
    else:
        if measure is not None and (
            not isinstance(measure, str) or measure not in column_list
        ):
            if measure is not None:
                raise ChartValidationError(f"Unknown column '{measure}'.")
        if measure is None:
            measure = None

    raw_filters = data.get("filters", [])
    if raw_filters is None:
        raw_filters = []
    if not isinstance(raw_filters, list):
        raise ChartValidationError("Invalid 'filters'. It must be an array.")
    # Reuse the M3 schema verbatim (columns + type-appropriateness).
    validated_filters = validate_filter_request(
        {"filters": raw_filters}, column_list, dtypes
    )["filters"]

    limit = _normalize_limit(data.get("limit"), chart_type)

    raw_sort = data.get("sort")
    if raw_sort is None:
        sort = None
    elif not isinstance(raw_sort, str) or raw_sort.strip().lower() not in SORT_MODES:
        raise ChartValidationError(
            "Invalid 'sort'. Supported modes: "
            + ", ".join(sorted(SORT_MODES))
            + "."
        )
    else:
        sort = raw_sort.strip().lower()

    raw_gran = data.get("date_granularity")
    if raw_gran is None:
        date_granularity = None
    elif not isinstance(raw_gran, str) or raw_gran.strip().lower() not in DATE_GRANULARITIES:
        raise ChartValidationError(
            "Invalid 'date_granularity'. Supported units: "
            + ", ".join(sorted(DATE_GRANULARITIES))
            + "."
        )
    else:
        date_granularity = raw_gran.strip().lower()

    # Early role checks that need no DataFrame: scatter never buckets, and a
    # granularity on a known non-datetime dimension fails fast here (unknown
    # kinds defer to aggregate_chart, which sees the real dtypes).
    if date_granularity is not None and chart_type == "scatter":
        raise ChartValidationError(
            "Invalid 'date_granularity'. Scatter plots show raw "
            "observations and do not support bucketing."
        )
    if (
        date_granularity is not None
        and isinstance(dtypes, dict)
        and dimension in dtypes
        and dtypes.get(dimension) != "datetime"
    ):
        raise ChartValidationError(
            "Invalid 'date_granularity'. It requires a datetime dimension."
        )

    return {
        "chart_type": chart_type,
        "dimension": dimension,
        "measure": measure,
        "aggregation": aggregation,
        "filters": validated_filters,
        "limit": limit,
        "sort": sort,
        "date_granularity": date_granularity,
    }


def _resolve_dimension_kind(df, dimension, dtypes):
    try:
        return _dimension_kind(df[dimension], dimension, dtypes)
    except Exception:
        return "text"


def _check_column_roles(normalized, df, dtypes):
    """Enforce chart/column compatibility (400 on mismatch)."""
    chart_type = normalized["chart_type"]
    dimension = normalized["dimension"]
    measure = normalized["measure"]
    aggregation = normalized["aggregation"]
    dim_kind = _resolve_dimension_kind(df, dimension, dtypes)

    if chart_type in ("bar", "pie") and dim_kind not in (
        "categorical",
        "boolean",
        "text",
    ):
        raise ChartValidationError(
            f"Invalid 'dimension'. '{dimension}' is {dim_kind}; "
            f"'{chart_type}' needs a categorical dimension."
        )
    if chart_type in ("line", "area") and dim_kind != "datetime":
        raise ChartValidationError(
            f"Invalid 'dimension'. '{dimension}' is {dim_kind}; "
            f"'{chart_type}' needs a datetime dimension."
        )
    if chart_type == "scatter" and dim_kind != "datetime":
        raise ChartValidationError(
            f"Invalid 'dimension'. '{dimension}' is {dim_kind}; "
            "'scatter' needs a datetime X axis."
        )
    if normalized["date_granularity"] is not None:
        if chart_type == "scatter":
            raise ChartValidationError(
                "Invalid 'date_granularity'. Scatter plots show raw "
                "observations and do not support bucketing."
            )
        if dim_kind != "datetime":
            raise ChartValidationError(
                "Invalid 'date_granularity'. It requires a datetime dimension."
            )
    if chart_type in _GROUPED_TYPES and aggregation != "count":
        measure_kind = None
        if isinstance(dtypes, dict) and measure in dtypes:
            measure_kind = dtypes.get(measure)
        elif measure in df.columns:
            series = df[measure]
            if pd.api.types.is_numeric_dtype(
                series.dtype
            ) and not pd.api.types.is_bool_dtype(series.dtype):
                measure_kind = "numeric"
            else:
                try:
                    coerced = pd.to_numeric(series.dropna(), errors="coerce")
                    measure_kind = (
                        "numeric" if not coerced.isna().all() else "text"
                    )
                except Exception:
                    measure_kind = "text"
        if measure_kind != "numeric":
            raise ChartValidationError(
                f"Invalid 'measure'. '{measure}' is not numeric; "
                f"aggregation '{aggregation}' needs a numeric column "
                "(or use 'count')."
            )
    if chart_type == "scatter":
        measure_kind = None
        if isinstance(dtypes, dict) and measure in dtypes:
            measure_kind = dtypes.get(measure)
        if measure_kind is None and measure in df.columns:
            series = df[measure]
            if pd.api.types.is_numeric_dtype(
                series.dtype
            ) and not pd.api.types.is_bool_dtype(series.dtype):
                measure_kind = "numeric"
        if measure_kind != "numeric":
            raise ChartValidationError(
                f"Invalid 'measure'. '{measure}' is not numeric; "
                "'scatter' needs a numeric Y axis."
            )
    return dim_kind


def _sort_key_default(chart_type, dim_kind, explicit_sort):
    if explicit_sort in SORT_MODES:
        return explicit_sort
    if dim_kind == "datetime":
        return "category"
    return "descending"


def _sort_grouped(shaped, sort_mode):
    def rank(item):
        blank = 1 if item["label"] == BLANK_LABEL else 0
        return blank

    blanks = [d for d in shaped if d["label"] == BLANK_LABEL]
    rest = [d for d in shaped if d["label"] != BLANK_LABEL]
    if sort_mode == "ascending":
        rest.sort(key=lambda d: (d["value"], d["label"]))
    elif sort_mode == "category":
        rest.sort(key=lambda d: d["label"])
    else:  # descending
        rest.sort(key=lambda d: (-d["value"], d["label"]))
    # Blank group always last (frontend parity), in label order.
    blanks.sort(key=lambda d: d["label"])
    return rest + blanks


def _aggregate_grouped(df, mask, normalized, dim_kind):
    dimension = normalized["dimension"]
    measure = normalized["measure"]
    aggregation = normalized["aggregation"]
    chart_type = normalized["chart_type"]
    limit = normalized["limit"]
    granularity = normalized["date_granularity"] or (
        "day" if dim_kind == "datetime" else None
    )
    sort_mode = _sort_key_default(chart_type, dim_kind, normalized["sort"])

    dim_series = df[dimension]
    if dim_kind == "datetime":
        # Vectorized day normalization: one pd.to_datetime pass over the
        # column (per-cell parsing here cost ~28s on the 50k-row Spotify
        # CSV). Missing/invalid dates become the blank group (frontend
        # parity); coarser granularities map the few unique days.
        try:
            parsed_days = pd.to_datetime(
                dim_series, errors="coerce", format="mixed"
            )
        except Exception:
            parsed_days = pd.Series(
                [pd.NaT] * len(df), index=df.index
            )
        try:
            day_strings = parsed_days.dt.strftime("%Y-%m-%d")
        except Exception:
            day_strings = pd.Series(
                [None] * len(df), index=df.index
            )
        bucket = granularity or "day"
        raw_days = day_strings.tolist()
        if bucket != "day":
            unique_days = {
                day
                for day in raw_days
                if not _is_missing_day(day)
            }
            bucket_map = {
                day: _truncate_label(day, bucket) for day in unique_days
            }
            label_list = [
                BLANK_LABEL
                if _is_missing_day(day)
                else bucket_map.get(day, day)
                for day in raw_days
            ]
        else:
            label_list = [
                BLANK_LABEL if _is_missing_day(day) else day
                for day in raw_days
            ]
    else:
        label_list = [_category_label(v) for v in dim_series.tolist()]

    try:
        mask_values = mask.to_numpy(dtype=bool, copy=False)
    except Exception:
        mask_values = [bool(v) for v in mask.tolist()]

    if aggregation == "count":
        counts = {}
        order = []
        for label, keep in zip(label_list, mask_values):
            if not keep:
                continue
            if label not in counts:
                counts[label] = 0
                order.append(label)
            counts[label] += 1
        shaped = [{"label": label, "value": counts[label]} for label in order]
    else:
        try:
            numeric = pd.to_numeric(df[measure], errors="coerce")
        except Exception:
            numeric = pd.Series(
                [float("nan")] * len(df), index=df.index, dtype="float64"
            )

        def _finite(value):
            try:
                number = float(value)
            except (TypeError, ValueError):
                return None
            if math.isnan(number) or math.isinf(number):
                return None
            return number

        values = [_finite(v) for v in numeric.tolist()]
        grouped_values = {}
        grouped_counts = {}
        for label, number, keep in zip(label_list, values, mask_values):
            if not keep:
                continue
            if label not in grouped_values:
                grouped_values[label] = []
                grouped_counts[label] = 0
            grouped_counts[label] += 1
            if number is not None:
                grouped_values[label].append(number)
        shaped = []
        for label, numbers in grouped_values.items():
            if aggregation == "sum":
                total = 0.0
                for number in numbers:
                    total += number
                shaped.append({"label": label, "value": total})
            elif not numbers:
                continue
            elif aggregation == "average":
                shaped.append(
                    {"label": label, "value": sum(numbers) / len(numbers)}
                )
            elif aggregation == "min":
                shaped.append({"label": label, "value": min(numbers)})
            elif aggregation == "max":
                shaped.append({"label": label, "value": max(numbers)})

    if chart_type == "pie":
        shaped = [
            d
            for d in shaped
            if isinstance(d["value"], (int, float))
            and math.isfinite(d["value"])
            and d["value"] > 0
        ]

    # JSON-safe numbers (no NaN/inf leaks).
    cleaned = []
    for item in shaped:
        value = item["value"]
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if math.isnan(number) or math.isinf(number):
            continue
        cleaned.append({"label": item["label"], "value": number})

    ordered = _sort_grouped(cleaned, sort_mode)
    total_groups = len(ordered)
    shown = ordered[:limit]
    return {
        "data": shown,
        "total_groups": total_groups,
        "shown_groups": len(shown),
        "truncated": total_groups > len(shown),
        "sort": sort_mode,
        "date_granularity": granularity,
    }


def _aggregate_scatter(df, mask, normalized):
    dimension = normalized["dimension"]
    measure = normalized["measure"]
    limit = normalized["limit"]
    try:
        mask_values = mask.to_numpy(dtype=bool, copy=False)
    except Exception:
        mask_values = [bool(v) for v in mask.tolist()]

    try:
        parsed_x = pd.to_datetime(df[dimension], errors="coerce", format="mixed")
    except Exception:
        parsed_x = pd.Series([pd.NaT] * len(df), index=df.index)
    try:
        numeric_y = pd.to_numeric(df[measure], errors="coerce")
    except Exception:
        numeric_y = pd.Series(
            [float("nan")] * len(df), index=df.index, dtype="float64"
        )

    x_list = parsed_x.tolist()
    y_list = numeric_y.tolist()
    valid = []
    for x_value, y_value, keep in zip(x_list, y_list, mask_values):
        if not keep:
            continue
        if x_value is None or x_value is pd.NaT:
            continue
        try:
            if pd.isna(x_value):
                continue
        except (TypeError, ValueError):
            continue
        try:
            number = float(y_value)
        except (TypeError, ValueError):
            continue
        if math.isnan(number) or math.isinf(number):
            continue
        try:
            stamp = pd.Timestamp(x_value)
        except Exception:
            continue
        if pd.isna(stamp):
            continue
        valid.append((stamp, number))

    total_points = len(valid)
    if total_points > limit:
        # Deterministic evenly-spaced sample over filtered row order.
        count = limit
        picked = []
        for i in range(count):
            index = int(round(i * (total_points - 1) / (count - 1))) if count > 1 else 0
            picked.append(valid[index])
        valid = picked
    # Chronological for the time-scale scatter view.
    valid.sort(key=lambda pair: pair[0].value)
    data = [{"x": stamp.isoformat(), "y": number} for stamp, number in valid]
    return {
        "data": data,
        "total_groups": total_points,
        "shown_groups": len(data),
        "truncated": total_points > len(data),
    }


def aggregate_chart(df, normalized, dtypes=None):
    """Run filter -> aggregate over ``df``; return the bounded result body.

    ``normalized`` comes from ``validate_chart_request``. Raises
    ChartValidationError / FilterValidationError on client errors. Never
    mutates ``df`` and never serializes more than the bounded result.
    """
    chart_type = normalized["chart_type"]
    dim_kind = _check_column_roles(normalized, df, dtypes)
    mask = build_filter_mask(df, normalized["filters"], dtypes)
    try:
        filtered_count = int(mask.sum())
    except Exception:
        raise ChartValidationError("Failed to apply filters.") from None
    row_count = int(len(df))

    if chart_type == "scatter":
        grouped = _aggregate_scatter(df, mask, normalized)
        return {
            "chart_type": chart_type,
            "dimension": normalized["dimension"],
            "measure": normalized["measure"],
            "aggregation": None,
            "filtered_row_count": filtered_count,
            "row_count": row_count,
            "data": grouped["data"],
            "total_groups": grouped["total_groups"],
            "shown_groups": grouped["shown_groups"],
            "truncated": grouped["truncated"],
            "sort": None,
            "date_granularity": None,
        }
    grouped = _aggregate_grouped(df, mask, normalized, dim_kind)
    return {
        "chart_type": chart_type,
        "dimension": normalized["dimension"],
        "measure": normalized.get("measure"),
        "aggregation": normalized["aggregation"],
        "filtered_row_count": filtered_count,
        "row_count": row_count,
        "data": grouped["data"],
        "total_groups": grouped["total_groups"],
        "shown_groups": grouped["shown_groups"],
        "truncated": grouped["truncated"],
        "sort": grouped["sort"],
        "date_granularity": grouped["date_granularity"],
    }
