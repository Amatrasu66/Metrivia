"""Pandas-based CSV analysis for the Metrivia backend.

Pure functions only (no Flask imports) so the analysis logic stays
testable, dependency-light, and free of any request handling.
"""

import math

import pandas as pd

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
    non_null = series.dropna()
    if non_null.empty:
        return "text"
    if pd.api.types.is_bool_dtype(series.dtype):
        return "boolean"
    if pd.api.types.is_numeric_dtype(series.dtype):
        return "numeric"
    if pd.api.types.is_datetime64_any_dtype(series.dtype):
        return "datetime"

    if pd.api.types.is_object_dtype(series.dtype) or pd.api.types.is_string_dtype(
        series.dtype
    ):
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

        lowered = {str(v).strip().lower() for v in non_null.unique()}
        if lowered and lowered <= BOOLEAN_WORDS:
            return "boolean"

    unique_count = int(series.nunique(dropna=True))
    if unique_count <= CATEGORICAL_MAX_UNIQUE:
        return "categorical"
    if row_count and unique_count / row_count < CATEGORICAL_MAX_RATIO:
        return "categorical"
    return "text"


def numeric_summary(series):
    """Basic statistics for a numeric-kind column (native JSON types)."""
    values = pd.to_numeric(series, errors="coerce")
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


def analyze_dataframe(df, filename):
    """Analyze an already-parsed DataFrame and return the API payload."""
    row_count = int(len(df))
    column_names = [str(c) for c in df.columns]

    dtypes = {}
    missing = {}
    unique = {}
    numeric_stats = {}

    for column in df.columns:
        name = str(column)
        series = df[column]
        kind = classify_column(series, row_count)
        dtypes[name] = kind
        missing[name] = int(series.isna().sum())
        unique[name] = int(series.nunique(dropna=True))
        if kind == "numeric":
            numeric_stats[name] = numeric_summary(series)

    # The full row set is returned (all rows, all columns): the frontend
    # data viewer exposes every row/column with bounded scrolling instead of
    # a fixed first-N subset. Upload size is capped at 10 MB by app.py, which
    # bounds the worst-case payload.
    preview_records = df.to_dict(orient="records")
    preview = [
        {str(k): to_jsonable(v) for k, v in row.items()}
        for row in preview_records
    ]

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
