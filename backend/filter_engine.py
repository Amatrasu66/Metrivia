"""Metrivia Phase M3 — structured server-side filter engine.

Authoritative filtering over the full server-side DataFrame. The client
sends only structured ``{column, operator, value}`` descriptors; arbitrary
Python/pandas expressions are never accepted, parsed, or executed (no
eval/exec/df.query with client strings).

Filter combination semantics: AND across all filters (matches the existing
frontend ``applyFilters`` which ANDs across columns/kinds). OR within a
categorical column is expressed as a single ``in`` filter.

Null handling: missing values (NaN/None/NaT/NA) and empty strings never
match value operators (eq/neq/comparisons/contains/in/...). Use
``is_empty`` / ``is_not_empty`` to select them explicitly. This mirrors
the frontend where a missing cell returns False whenever a restriction
is active.

Case sensitivity: text comparisons are case-sensitive literal matches
(Python ``in`` / ``startswith`` / ``endswith`` / ``==``), matching the
frontend ``String`` comparisons.

The stored DatasetStore DataFrame is never mutated; filtering builds a
boolean mask and callers slice only the requested page.
"""

import math
import re

import numpy as np
import pandas as pd

try:
    from dataset_store import PAGE_DEFAULT, PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX
except Exception:  # pragma: no cover - importable both as module and package
    PAGE_DEFAULT = 0
    PAGE_SIZE_DEFAULT = 100
    PAGE_SIZE_MAX = 500


class FilterValidationError(ValueError):
    """A client-facing filter validation failure (HTTP 400)."""


# Structured operators only. ``in``/``not_in`` express the existing
# categorical OR-within-column (selected values list, may include
# "(blank)" for missing). Text search operators support API-level text
# filtering and the large-CSV regression.
FILTER_OPERATORS = frozenset(
    {
        "eq",
        "neq",
        "gt",
        "gte",
        "lt",
        "lte",
        "contains",
        "not_contains",
        "starts_with",
        "ends_with",
        "is_empty",
        "is_not_empty",
        "in",
        "not_in",
    }
)

# Bound the number of filters per request (abuse guard, deterministic).
MAX_FILTERS = 20

# Bound list-operator payloads (categorical multi-select stays small).
MAX_IN_VALUES = 100

# Bound individual string payloads (prevents giant substring scans).
MAX_VALUE_LENGTH = 500

# Label used by the frontend for missing values in categorical UI.
BLANK_LABEL = "(blank)"

_VALUE_REQUIRED = frozenset(
    {
        "eq",
        "neq",
        "gt",
        "gte",
        "lt",
        "lte",
        "contains",
        "not_contains",
        "starts_with",
        "ends_with",
        "in",
        "not_in",
    }
)

_TEXT_ONLY_OPERATORS = frozenset(
    {"contains", "not_contains", "starts_with", "ends_with"}
)

_COMPARISON_OPERATORS = frozenset({"gt", "gte", "lt", "lte"})

_DATE_ONLY_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


def _is_valid_column_name(name, columns):
    return isinstance(name, str) and name in columns


def _ensure_json_scalar(value, what="value"):
    """Reject non-JSON-safe values (dicts, nested objects, non-finite)."""
    if value is None or isinstance(value, (str, int, float, bool)):
        if isinstance(value, float) and (
            math.isnan(value) or math.isinf(value)
        ):
            raise FilterValidationError(
                f"Invalid '{what}'. Numbers must be finite."
            )
        if isinstance(value, str) and len(value) > MAX_VALUE_LENGTH:
            raise FilterValidationError(
                f"Invalid '{what}'. Text values are limited to "
                f"{MAX_VALUE_LENGTH} characters."
            )
        return
    raise FilterValidationError(
        f"Invalid '{what}'. It must be a string, number, boolean, or null."
    )


def _ensure_value_list(value):
    if not isinstance(value, list):
        raise FilterValidationError(
            "Invalid 'value'. Operator requires an array of values."
        )
    if len(value) == 0:
        raise FilterValidationError(
            "Invalid 'value'. The array must not be empty."
        )
    if len(value) > MAX_IN_VALUES:
        raise FilterValidationError(
            f"Invalid 'value'. At most {MAX_IN_VALUES} values are allowed."
        )
    for item in value:
        _ensure_json_scalar(item, "value")
        if isinstance(item, dict) or isinstance(item, list):
            raise FilterValidationError(
                "Invalid 'value'. Array items must be scalars."
            )
    return value


def _normalize_page(value, name, default, minimum, maximum, label):
    if value is None:
        value = default
    try:
        # Booleans are ints in Python; reject them explicitly.
        if isinstance(value, bool):
            raise ValueError()
        ivalue = int(value) if not isinstance(value, int) else value
        # Reject float-like strings such as "1.5".
        if isinstance(value, str) and str(int(float(value))) != value.strip():
            # Fall through to int() check below which raises for "1.5".
            ivalue = int(float(value))  # raises or truncates -> validate
            raise ValueError()
        if isinstance(value, float) and not value.is_integer():
            raise ValueError()
    except (TypeError, ValueError):
        if name == "page":
            raise FilterValidationError(
                "Invalid 'page'. It must be an integer >= 0."
            ) from None
        raise FilterValidationError(
            "Invalid 'page_size'. It must be an integer between 1 and "
            f"{PAGE_SIZE_MAX}."
        ) from None
    if name == "page":
        if ivalue < 0:
            raise FilterValidationError(
                "Invalid 'page'. It must be an integer >= 0."
            )
        return ivalue
    if ivalue < 1 or ivalue > PAGE_SIZE_MAX:
        raise FilterValidationError(
            "Invalid 'page_size'. It must be an integer between 1 and "
            f"{PAGE_SIZE_MAX}."
        )
    return ivalue


def validate_filter_request(data, columns, dtypes=None):
    """Validate a POST filter body; return normalized pagination + filters.

    ``data`` is the parsed JSON object, ``columns`` the exact dataset
    column names, ``dtypes`` optionally the analysis kind map
    (numeric/datetime/categorical/boolean/text) for type-appropriateness
    checks. Raises FilterValidationError on any client error.
    """
    if not isinstance(data, dict):
        raise FilterValidationError("Invalid JSON body.")
    raw_filters = data.get("filters", [])
    if raw_filters is None:
        raw_filters = []
    if not isinstance(raw_filters, list):
        raise FilterValidationError(
            "Invalid 'filters'. It must be an array."
        )
    if len(raw_filters) > MAX_FILTERS:
        raise FilterValidationError(
            f"Too many filters. Maximum is {MAX_FILTERS}."
        )
    column_list = list(columns) if isinstance(columns, (list, tuple)) else []
    normalized = []
    for index, item in enumerate(raw_filters):
        if not isinstance(item, dict):
            raise FilterValidationError(
                f"Invalid filter at index {index}. It must be an object."
            )
        # Reject unknown keys to keep the schema tight (typos fail loudly
        # instead of being silently ignored).
        allowed_keys = {"column", "operator", "value"}
        for key in item.keys():
            if key not in allowed_keys:
                raise FilterValidationError(
                    f"Invalid filter at index {index}. "
                    f"Unknown field '{key}'."
                )
        column = item.get("column")
        operator = item.get("operator")
        has_value = "value" in item
        value = item.get("value")
        if not isinstance(column, str) or column == "":
            raise FilterValidationError(
                f"Invalid filter at index {index}. "
                "'column' must be a non-empty string."
            )
        if column not in column_list:
            raise FilterValidationError(f"Unknown column '{column}'.")
        if not isinstance(operator, str) or operator not in FILTER_OPERATORS:
            raise FilterValidationError(
                f"Invalid operator '{operator}'. Supported operators: "
                + ", ".join(sorted(FILTER_OPERATORS))
                + "."
            )
        if operator in ("is_empty", "is_not_empty"):
            if has_value and value is not None:
                raise FilterValidationError(
                    f"Invalid filter at index {index}. "
                    f"Operator '{operator}' does not take a value."
                )
            normalized.append(
                {"column": column, "operator": operator, "value": None}
            )
            continue
        if not has_value:
            raise FilterValidationError(
                f"Invalid filter at index {index}. "
                f"Operator '{operator}' requires a value."
            )
        if operator in ("in", "not_in"):
            _ensure_value_list(value)
        else:
            if isinstance(value, (dict, list)):
                raise FilterValidationError(
                    f"Invalid filter at index {index}. "
                    "'value' must be a scalar."
                )
            _ensure_json_scalar(value)
            if operator in _TEXT_ONLY_OPERATORS:
                if not isinstance(value, str):
                    raise FilterValidationError(
                        f"Invalid filter at index {index}. "
                        f"Operator '{operator}' requires a string value."
                    )
                if value == "":
                    raise FilterValidationError(
                        f"Invalid filter at index {index}. "
                        f"Operator '{operator}' requires a non-empty string."
                    )
        # Type-appropriateness when the analysis kind map is available.
        if isinstance(dtypes, dict) and column in dtypes:
            kind = dtypes.get(column)
            if operator in _TEXT_ONLY_OPERATORS and kind in (
                "numeric",
                "datetime",
            ):
                raise FilterValidationError(
                    f"Invalid filter at index {index}. Operator "
                    f"'{operator}' cannot be used on {kind} column "
                    f"'{column}'."
                )
            if operator in _COMPARISON_OPERATORS and kind not in (
                "numeric",
                "datetime",
            ):
                raise FilterValidationError(
                    f"Invalid filter at index {index}. Operator "
                    f"'{operator}' cannot be used on {kind} column "
                    f"'{column}'."
                )
        normalized.append(
            {"column": column, "operator": operator, "value": value}
        )

    page = _normalize_page(
        data.get("page", PAGE_DEFAULT), "page", PAGE_DEFAULT, 0, None, "page"
    )
    page_size = _normalize_page(
        data.get("page_size", PAGE_SIZE_DEFAULT),
        "page_size",
        PAGE_SIZE_DEFAULT,
        1,
        PAGE_SIZE_MAX,
        "page_size",
    )
    return {"filters": normalized, "page": page, "page_size": page_size}


def _column_kind(series, column, dtypes):
    if isinstance(dtypes, dict) and column in dtypes:
        kind = dtypes.get(column)
        if kind in ("numeric", "datetime", "categorical", "boolean", "text"):
            return kind
    if pd.api.types.is_datetime64_any_dtype(series.dtype):
        return "datetime"
    if pd.api.types.is_numeric_dtype(series.dtype):
        return "numeric"
    if pd.api.types.is_bool_dtype(series.dtype):
        return "boolean"
    return "text"


def _empty_mask(series):
    """True for missing values (NaN/None/NaT/NA) or exact ''."""
    try:
        isna = pd.isna(series)
        if isinstance(isna, pd.Series):
            base = isna.fillna(True).astype(bool)
        else:
            base = pd.Series([bool(isna)] * len(series), index=series.index)
    except Exception:
        base = pd.Series([v is None for v in series.tolist()],
                         index=series.index)
    try:
        eq_empty = series == ""
        if isinstance(eq_empty, pd.Series):
            eq_empty = eq_empty.fillna(False).astype(bool)
        else:
            eq_empty = pd.Series([False] * len(series), index=series.index)
    except Exception:
        eq_empty = pd.Series([False] * len(series), index=series.index)
    return base | eq_empty


def _to_number(value):
    if isinstance(value, bool):
        raise FilterValidationError(
            "Invalid numeric value. Booleans are not numbers."
        )
    if isinstance(value, (int, float)):
        num = float(value)
        if math.isnan(num) or math.isinf(num):
            raise FilterValidationError("Invalid numeric value.")
        return num
    if isinstance(value, str):
        text = value.strip()
        if text == "":
            raise FilterValidationError("Invalid numeric value.")
        try:
            num = float(text)
        except ValueError:
            raise FilterValidationError(
                f"Invalid numeric value '{value}'."
            ) from None
        if math.isnan(num) or math.isinf(num):
            raise FilterValidationError(
                f"Invalid numeric value '{value}'."
            )
        return num
    raise FilterValidationError("Invalid numeric value.")


def _numeric_series(series):
    if pd.api.types.is_numeric_dtype(series.dtype) and not pd.api.types.is_bool_dtype(
        series.dtype
    ):
        return series
    try:
        return pd.to_numeric(series, errors="coerce")
    except Exception:
        return pd.Series([float("nan")] * len(series), index=series.index)


def _parse_datetime_value(value):
    if isinstance(value, bool):
        raise FilterValidationError(f"Invalid date value '{value}'.")
    if isinstance(value, (int, float)):
        raise FilterValidationError(f"Invalid date value '{value}'.")
    if not isinstance(value, str) or value.strip() == "":
        raise FilterValidationError(f"Invalid date value '{value}'.")
    text = value.strip()
    try:
        parsed = pd.to_datetime(text, errors="raise", format="mixed")
    except Exception:
        raise FilterValidationError(
            f"Invalid date value '{value}'."
        ) from None
    if pd.isna(parsed):
        raise FilterValidationError(f"Invalid date value '{value}'.")
    return parsed


def _cell_day_string(value):
    """Frontend-compatible YYYY-MM-DD normalization (toDayString)."""
    if value is None:
        return None
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if value is pd.NA or value is pd.NaT:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, str):
        if value == "":
            return None
        match = _DATE_ONLY_RE.match(value[:10])
        if match:
            return value[:10]
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


def _text_label(value):
    """Normalized string for text comparisons (bool -> lower)."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, np.bool_):
        return "true" if bool(value) else "false"
    return str(value)


def _cell_text(value):
    if value is None or value is pd.NA or value is pd.NaT:
        return None
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, str) and value == "":
        return None
    return _text_label(value)


def _numeric_mask(series, operator, value):
    num_series = _numeric_series(series)
    notna = num_series.notna().fillna(False).astype(bool)
    if operator in ("eq", "neq", "gt", "gte", "lt", "lte"):
        num = _to_number(value)
        if operator == "eq":
            return (num_series == num).fillna(False).astype(bool) & notna
        if operator == "neq":
            return ((num_series != num).fillna(False).astype(bool)) & notna
        if operator == "gt":
            return ((num_series > num).fillna(False).astype(bool)) & notna
        if operator == "gte":
            return ((num_series >= num).fillna(False).astype(bool)) & notna
        if operator == "lt":
            return ((num_series < num).fillna(False).astype(bool)) & notna
        return ((num_series <= num).fillna(False).astype(bool)) & notna
    if operator in ("in", "not_in"):
        nums = [_to_number(v) for v in value]
        try:
            isin = num_series.isin(nums).fillna(False).astype(bool)
        except Exception:
            isin = pd.Series([False] * len(series), index=series.index)
        if operator == "in":
            return isin & notna
        return (~isin).fillna(False).astype(bool) & notna
    raise FilterValidationError(
        f"Operator '{operator}' cannot be used on a numeric column."
    )


def _datetime_mask(series, operator, value):
    try:
        parsed_col = (
            series
            if pd.api.types.is_datetime64_any_dtype(series.dtype)
            else pd.to_datetime(series, errors="coerce", format="mixed")
        )
    except Exception:
        parsed_col = pd.Series([pd.NaT] * len(series), index=series.index)
    notna = parsed_col.notna().fillna(False).astype(bool)
    if operator in ("is_empty", "is_not_empty"):
        raise FilterValidationError("internal")
    if operator in ("eq", "neq", "gt", "gte", "lt", "lte"):
        text = value if isinstance(value, str) else _text_label(value)
        is_date_only = isinstance(text, str) and _DATE_ONLY_RE.match(
            text.strip()
        )
        target = _parse_datetime_value(text)
        if is_date_only:
            day = text.strip()[:10]
            days = pd.Series(
                [_cell_day_string(v) for v in series.tolist()],
                index=series.index,
            )
            has_day = days.notna()
            if operator == "eq":
                return (days == day).fillna(False).astype(bool) & has_day
            if operator == "neq":
                return ((days != day).fillna(False).astype(bool)) & has_day
            if operator == "gt":
                return ((days > day).fillna(False).astype(bool)) & has_day
            if operator == "gte":
                return ((days >= day).fillna(False).astype(bool)) & has_day
            if operator == "lt":
                return ((days < day).fillna(False).astype(bool)) & has_day
            return ((days <= day).fillna(False).astype(bool)) & has_day
        target_ts = pd.Timestamp(target)
        if operator == "eq":
            return ((parsed_col == target_ts).fillna(False).astype(bool)) & notna
        if operator == "neq":
            return ((parsed_col != target_ts).fillna(False).astype(bool)) & notna
        if operator == "gt":
            return ((parsed_col > target_ts).fillna(False).astype(bool)) & notna
        if operator == "gte":
            return ((parsed_col >= target_ts).fillna(False).astype(bool)) & notna
        if operator == "lt":
            return ((parsed_col < target_ts).fillna(False).astype(bool)) & notna
        return ((parsed_col <= target_ts).fillna(False).astype(bool)) & notna
    if operator in ("in", "not_in"):
        masks = []
        for item in value:
            text = item if isinstance(item, str) else _text_label(item)
            masks.append(
                _datetime_mask(series, "eq", text).fillna(False).astype(bool)
            )
        combined = masks[0]
        for extra in masks[1:]:
            combined = combined | extra
        if operator == "in":
            return combined.fillna(False).astype(bool)
        return ((~combined).fillna(False).astype(bool)) & notna
    raise FilterValidationError(
        f"Operator '{operator}' cannot be used on a datetime column."
    )


def _text_mask(series, operator, value):
    raws = series.tolist()
    labels = [_cell_text(v) for v in raws]
    has_value = pd.Series([v is not None for v in labels], index=series.index)
    if operator == "eq":
        wanted = _text_label(value)
        if wanted == BLANK_LABEL:
            return _empty_mask(series)
        return pd.Series(
            [(v is not None and v == wanted) for v in labels],
            index=series.index,
        )
    if operator == "neq":
        wanted = _text_label(value)
        if wanted == BLANK_LABEL:
            # neq blank would select everything non-blank; keep the
            # missing-never-matches rule by requiring a value and inequality
            # against nothing meaningful -> all non-blank match.
            return has_value
        return pd.Series(
            [(v is not None and v != wanted) for v in labels],
            index=series.index,
        )
    if operator == "in":
        wants = [_text_label(v) for v in value]
        want_blank = BLANK_LABEL in wants
        want_set = set(w for w in wants if w != BLANK_LABEL)
        out = []
        empty = _empty_mask(series).tolist()
        for label, is_empty in zip(labels, empty):
            if label is None:
                out.append(bool(want_blank))
            else:
                out.append(label in want_set)
        return pd.Series(out, index=series.index)
    if operator == "not_in":
        wants = [_text_label(v) for v in value]
        want_set = set(w for w in wants if w != BLANK_LABEL)
        out = []
        for label in labels:
            if label is None:
                out.append(False)
            else:
                out.append(label not in want_set)
        return pd.Series(out, index=series.index)
    if operator in (
        "contains",
        "not_contains",
        "starts_with",
        "ends_with",
    ):
        needle = _text_label(value)
        out = []
        for label in labels:
            if label is None:
                out.append(False)
            elif operator == "contains":
                out.append(needle in label)
            elif operator == "not_contains":
                out.append(needle not in label)
            elif operator == "starts_with":
                out.append(label.startswith(needle))
            else:
                out.append(label.endswith(needle))
        result = pd.Series(out, index=series.index)
        if operator == "not_contains":
            # Missing never matches, even negated text search.
            return result & has_value
        return result
    raise FilterValidationError(
        f"Operator '{operator}' cannot be used on a text column."
    )


def _single_mask(series, filt, dtypes):
    column = filt["column"]
    operator = filt["operator"]
    value = filt.get("value")
    if operator == "is_empty":
        return _empty_mask(series)
    if operator == "is_not_empty":
        return (~_empty_mask(series)).fillna(False).astype(bool)
    kind = _column_kind(series, column, dtypes)
    if kind == "numeric":
        return _numeric_mask(series, operator, value)
    if kind == "datetime":
        return _datetime_mask(series, operator, value)
    # categorical / boolean / text share literal string semantics.
    return _text_mask(series, operator, value)


def build_filter_mask(df, filters, dtypes=None):
    """Return a boolean mask for ``df`` ANDing every structured filter.

    Never mutates ``df``. Empty filter list matches every row.
    Raises FilterValidationError for invalid values/types.
    """
    n = len(df)
    if not filters:
        return pd.Series([True] * n, index=df.index)
    if not isinstance(filters, list):
        raise FilterValidationError("Invalid 'filters'. It must be an array.")
    mask = pd.Series([True] * n, index=df.index)
    for index, filt in enumerate(filters):
        if not isinstance(filt, dict):
            raise FilterValidationError(
                f"Invalid filter at index {index}. It must be an object."
            )
        column = filt.get("column")
        operator = filt.get("operator")
        if column not in df.columns:
            raise FilterValidationError(f"Unknown column '{column}'.")
        if operator not in FILTER_OPERATORS:
            raise FilterValidationError(
                f"Invalid operator '{operator}'. Supported operators: "
                + ", ".join(sorted(FILTER_OPERATORS))
                + "."
            )
        try:
            single = _single_mask(df[column], filt, dtypes)
        except FilterValidationError:
            raise
        except Exception as exc:
            raise FilterValidationError(
                f"Invalid filter at index {index}."
            ) from exc
        try:
            single = single.fillna(False).astype(bool)
            single = single.reindex(mask.index).fillna(False).astype(bool)
        except Exception:
            raise FilterValidationError(
                f"Invalid filter at index {index}."
            ) from None
        mask = mask & single
        # Early exit keeps repeated filters cheap; result identical.
        if not bool(mask.any()):
            # Still validate remaining filters for deterministic 400s.
            continue
    return mask.fillna(False).astype(bool)


def apply_filters(df, filters, dtypes=None):
    """Alias for build_filter_mask (endpoint import compatibility)."""
    return build_filter_mask(df, filters, dtypes=dtypes)
