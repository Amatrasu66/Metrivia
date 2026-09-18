"""Pandas-based CSV analysis for the Metrivia backend.

Pure functions only (no Flask imports) so the analysis logic stays
testable, dependency-light, and free of any request handling.
"""

import logging
import math
import time

import numpy as np
import pandas as pd

logger = logging.getLogger("metrivia.analysis")

# Heuristics for the categorical-vs-text split. A column is categorical when
# its cardinality is low in absolute terms or relative to the row count
# (e.g. status codes, groups). High-cardinality free text such as names,
# IDs, or comments is reported as text.
CATEGORICAL_MAX_UNIQUE = 20
CATEGORICAL_MAX_RATIO = 0.05

# Datetime probing is vectorized but can be slow on very long free-text
# columns, so only a sample of non-null values is probed.
DATETIME_PROBE_SAMPLE = 1000

# String values treated as boolean when they are the only distinct
# non-null values in a column (case-insensitive).
BOOLEAN_WORDS = {"true", "false", "yes", "no", "y", "n", "t", "f", "0", "1"}


def to_jsonable(value):
    """Convert pandas/numpy scalars to JSON-serializable natives.

    Missing values (NaN, NaT, NA, NaN-like) and non-finite floats become
    None; timestamps become ISO-8601 strings.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, pd.Timedelta):
        return str(value)
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    item = getattr(value, "item", None)
    if callable(item):
        try:
            return to_jsonable(item())
        except (TypeError, ValueError, OverflowError):
            return str(value)
    if isinstance(value, (int, str)):
        return value
    return value


def classify_column(series, row_count):
    """Classify a column for frontend use.

    Returns one of: numeric, categorical, datetime, boolean, text.
    """
    return _classify(series, series.dropna(), row_count, None, None)


def _is_object_like(series):
    return pd.api.types.is_object_dtype(
        series.dtype
    ) or pd.api.types.is_string_dtype(series.dtype)


def _is_boolean_word_set(uniques):
    """True when every distinct value is a boolean word (case-insensitive).

    Short-circuits: a normalized set larger than the word list can never be
    a subset of it, so high-cardinality text columns (names, IDs, comments)
    stop after ~13 distinct values instead of building a 50k-entry set.
    The result is identical to the full-set subset check.
    """
    lowered = set()
    for value in uniques:
        lowered.add(str(value).strip().lower())
        if len(lowered) > len(BOOLEAN_WORDS):
            return False
    return bool(lowered) and lowered <= BOOLEAN_WORDS


def _classify(series, non_null, row_count, unique_count, coerced):
    """Shared classification core.

    `non_null` (series.dropna()), `unique_count`, and `coerced`
    (pd.to_numeric over non_null) may be precomputed by the caller to avoid
    repeated full-column passes; any of them may be None to compute lazily
    with identical results.
    """
    if non_null.empty:
        return "text"
    if pd.api.types.is_bool_dtype(series.dtype):
        return "boolean"
    if pd.api.types.is_numeric_dtype(series.dtype):
        return "numeric"
    if pd.api.types.is_datetime64_any_dtype(series.dtype):
        return "datetime"

    if _is_object_like(series):
        if coerced is None:
            coerced = pd.to_numeric(non_null, errors="coerce")
        if not coerced.isna().any():
            return "numeric"

        probe = non_null.head(DATETIME_PROBE_SAMPLE)
        try:
            parsed = pd.to_datetime(probe, errors="coerce", format="mixed")
        except Exception:
            parsed = None
        if parsed is not None and not parsed.isna().any():
            return "datetime"

        if _is_boolean_word_set(non_null.unique()):
            return "boolean"

    if unique_count is None:
        unique_count = int(series.nunique(dropna=True))
    if unique_count <= CATEGORICAL_MAX_UNIQUE:
        return "categorical"
    if row_count and unique_count / row_count < CATEGORICAL_MAX_RATIO:
        return "categorical"
    return "text"


def numeric_summary(series, coerced=None):
    """Basic statistics for a numeric-kind column (native JSON types).

    `coerced` may be a precomputed pd.to_numeric() of the column's non-null
    values (shared with classification); otherwise it is computed here with
    identical results.
    """
    values = (
        coerced
        if coerced is not None
        else pd.to_numeric(series, errors="coerce")
    )
    count = int(values.count())
    if count == 0:
        return {
            "count": 0,
            "mean": None,
            "std": None,
            "min": None,
            "p25": None,
            "p50": None,
            "p75": None,
            "max": None,
        }
    desc = values.describe()
    return {
        "count": count,
        "mean": to_jsonable(desc["mean"]),
        "std": to_jsonable(desc["std"]) if count >= 2 else None,
        "min": to_jsonable(desc["min"]),
        "p25": to_jsonable(desc["25%"]),
        "p50": to_jsonable(desc["50%"]),
        "p75": to_jsonable(desc["75%"]),
        "max": to_jsonable(desc["max"]),
    }


_POS_INF = float("inf")
_NEG_INF = float("-inf")


def _float_or_none(value):
    if value != value or value == _POS_INF or value == _NEG_INF:
        return None
    return value


def _column_json_values(series):
    """Convert one column to a list of JSON-native values (fast paths).

    Identical output to a per-cell to_jsonable() pass: NaN/NaT/NA/inf become
    None, timestamps become ISO-8601 strings, numpy scalars become natives.
    Vectorized or tight per-column loops replace the generic per-cell
    dispatcher (pd.isna + getattr per cell), which dominated upload time on
    wide datasets (1.65M cells for 50k rows x 33 columns).
    """
    dtype = series.dtype
    if pd.api.types.is_bool_dtype(dtype):
        if isinstance(dtype, pd.BooleanDtype):
            return [
                None if v is pd.NA else bool(v) for v in series.tolist()
            ]
        return series.tolist()
    if pd.api.types.is_integer_dtype(dtype):
        if isinstance(
            dtype, (pd.Int8Dtype, pd.Int16Dtype, pd.Int32Dtype, pd.Int64Dtype,
                     pd.UInt8Dtype, pd.UInt16Dtype, pd.UInt32Dtype,
                     pd.UInt64Dtype),
        ):
            return [None if v is pd.NA else int(v) for v in series.tolist()]
        return series.tolist()
    if pd.api.types.is_float_dtype(dtype):
        # isinstance guard: nullable Float64 surfaces pd.NA (whose !=
        # comparison raises), while float64/numpy give real floats.
        return [_float_or_none(v) if isinstance(v, float) else None for v in series.tolist()]
    if pd.api.types.is_datetime64_any_dtype(dtype):
        return [
            None if v is pd.NaT else v.isoformat() for v in series.tolist()
        ]
    if pd.api.types.is_string_dtype(dtype):
        # pandas 3 `str` dtype: missing values surface as float nan.
        return [v if isinstance(v, str) else None for v in series.tolist()]
    # Object / mixed columns: slim per-value loop with the same semantics
    # as to_jsonable(), falling back to it for exotic values.
    out = []
    for v in series.tolist():
        if v is None or v is pd.NA or v is pd.NaT:
            out.append(None)
        elif isinstance(v, str):
            out.append(v)
        elif isinstance(v, bool):
            out.append(v)
        elif isinstance(v, float):
            out.append(_float_or_none(v))
        elif isinstance(v, pd.Timestamp):
            out.append(v.isoformat())
        elif isinstance(v, pd.Timedelta):
            out.append(str(v))
        elif isinstance(v, (int, np.integer)):
            out.append(int(v))
        elif isinstance(v, np.bool_):
            out.append(bool(v))
        else:
            out.append(to_jsonable(v))
    return out


def analyze_dataframe(df, filename):
    """Analyze an already-parsed DataFrame and return the API payload."""
    started = time.perf_counter()
    row_count = int(len(df))
    column_names = [str(c) for c in df.columns]

    dtypes = {}
    missing = {}
    unique = {}
    numeric_stats = {}

    for column in df.columns:
        name = str(column)
        series = df[column]
        # Shared temporaries: one dropna, one nunique, one coercion per
        # column instead of repeating them across classify/summary/stats.
        # missing[] reuses the dropna length delta (== isna().sum()).
        non_null = series.dropna()
        unique_count = int(series.nunique(dropna=True))
        coerced = None
        if _is_object_like(series):
            coerced = pd.to_numeric(non_null, errors="coerce")
        kind = _classify(series, non_null, row_count, unique_count, coerced)
        dtypes[name] = kind
        missing[name] = int(len(series) - len(non_null))
        unique[name] = unique_count
        if kind == "numeric":
            numeric_stats[name] = numeric_summary(series, coerced)
    stats_ms = (time.perf_counter() - started) * 1000

    # The full row set is returned (all rows, all columns): the frontend
    # data viewer exposes every row/column with bounded scrolling instead of
    # a fixed first-N subset. Upload size is capped at 20 MB by app.py, which
    # bounds the worst-case payload.
    #
    # Phase H: per-column vectorized conversion + a C-level transpose
    # replaces df.to_dict(orient="records") plus a per-cell to_jsonable()
    # dict comprehension (previously ~2/3 of backend time on the 50k-row
    # Spotify CSV). Row dicts keep the exact same keys/values.
    records_ms_start = time.perf_counter()
    column_values = [_column_json_values(df[c]) for c in df.columns]
    preview = [
        dict(zip(column_names, row)) for row in zip(*column_values)
    ]
    records_ms = (time.perf_counter() - records_ms_start) * 1000
    total_ms = (time.perf_counter() - started) * 1000
    logger.info(
        "analyze filename=%s rows=%d cols=%d stats_ms=%.1f records_ms=%.1f total_ms=%.1f",
        filename,
        row_count,
        len(column_names),
        stats_ms,
        records_ms,
        total_ms,
    )

    return {
        "filename": filename,
        "row_count": row_count,
        "column_count": len(column_names),
        "columns": column_names,
        "dtypes": dtypes,
        "missing": missing,
        "unique": unique,
        "numeric_stats": numeric_stats,
        "preview": preview,
        "preview_count": len(preview),
    }
