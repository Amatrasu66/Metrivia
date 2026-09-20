"""Metrivia Phase M1 — in-process dataset/session store.

Temporary server-side workspace storage for uploaded CSV datasets:

- The pandas DataFrame remains the canonical server-side representation.
  It is stored by reference — never converted to full row dictionaries
  merely to store it.
- IDs are opaque UUIDs (hex), unique per dataset.
- Entries expire after ``DATASET_TTL_SECONDS`` and the store holds at most
  ``MAX_DATASETS`` entries; the least-recently-used entry is evicted when
  full. Access refreshes ``last_accessed_at`` (LRU).
- Thread-safe via a single ``threading.Lock`` (lightweight; Render Free
  runs one process with threaded Flask).
- In-process only: entries disappear on process restart and are NOT shared
  between backend instances. This is intentional temporary workspace
  storage, not a database.

Preview compatibility policy (centralized here so thresholds are not
scattered as magic numbers across app/analysis code):

- Small datasets (rows <= FULL_PREVIEW_MAX_ROWS AND
  rows*cols <= FULL_PREVIEW_MAX_CELLS) keep the complete ``preview`` for
  backward compatibility with the current frontend.
- Large datasets return only a bounded deterministic sample:
  ``df.head(SAMPLE_PREVIEW_ROWS)``. ``preview_count`` = rows actually
  returned; ``row_count`` = total dataset rows.
"""

import logging
import os
import threading
import time
import uuid

logger = logging.getLogger("metrivia.dataset_store")

# --- Centralized preview policy (single source of truth) ---
FULL_PREVIEW_MAX_ROWS = 5000
FULL_PREVIEW_MAX_CELLS = 100000
SAMPLE_PREVIEW_ROWS = 500

# --- Pagination policy (single source of truth) ---
PAGE_DEFAULT = 0
PAGE_SIZE_DEFAULT = 100
PAGE_SIZE_MAX = 500


def _env_int(name, default):
    try:
        return int(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


# Configurable via environment; tests may also monkey-patch the module
# attributes directly (functions read them at call time).
DATASET_TTL_SECONDS = _env_int("DATASET_TTL_SECONDS", 1800)
MAX_DATASETS = _env_int("MAX_DATASETS", 3)


def resolve_preview_limit(row_count, column_count):
    """Return how many preview rows the upload response should contain.

    Full preview for small datasets (compatibility); bounded sample for
    large datasets. Deterministic — callers slice df.head(limit).
    """
    try:
        rows = int(row_count)
        cols = int(column_count)
    except (TypeError, ValueError):
        return SAMPLE_PREVIEW_ROWS
    if rows <= FULL_PREVIEW_MAX_ROWS and rows * cols <= FULL_PREVIEW_MAX_CELLS:
        return rows
    return min(rows, SAMPLE_PREVIEW_ROWS)


def should_return_full_preview(row_count, column_count):
    """True when the dataset is small enough for a complete preview."""
    return resolve_preview_limit(row_count, column_count) == int(row_count)


class DatasetRecord:
    """One stored dataset. ``dataframe`` is held by reference."""

    __slots__ = (
        "dataset_id",
        "dataframe",
        "metadata",
        "created_at",
        "last_accessed_at",
    )

    def __init__(self, dataset_id, dataframe, metadata, now):
        self.dataset_id = dataset_id
        self.dataframe = dataframe
        self.metadata = metadata
        self.created_at = now
        self.last_accessed_at = now


class DatasetStore:
    """Thread-safe in-process store with TTL + LRU eviction."""

    def __init__(self, ttl_seconds=None, max_datasets=None, now_fn=None):
        self._lock = threading.Lock()
        self._datasets = {}
        self._ttl_seconds = ttl_seconds  # None -> read module default at call time
        self._max_datasets = max_datasets  # None -> read module default at call time
        self._now_fn = now_fn or time.time

    def _ttl(self):
        if self._ttl_seconds is not None:
            return self._ttl_seconds
        return DATASET_TTL_SECONDS

    def _max(self):
        if self._max_datasets is not None:
            return self._max_datasets
        return MAX_DATASETS

    def _now(self):
        return self._now_fn()

    def _expired(self, record, now):
        return (now - record.last_accessed_at) > self._ttl()

    def prune_expired(self):
        """Remove expired datasets. Returns number removed."""
        now = self._now()
        with self._lock:
            expired = [
                key
                for key, rec in self._datasets.items()
                if (now - rec.last_accessed_at) > self._ttl()
            ]
            for key in expired:
                del self._datasets[key]
            if expired:
                # Lifecycle observability (Phase M6): counts only, never
                # contents, filenames, or ids.
                logger.info(
                    "event=datasets_pruned expired=%d remaining=%d",
                    len(expired),
                    len(self._datasets),
                )
            return len(expired)

    def create_dataset(self, dataframe, metadata):
        """Store ``dataframe`` + ``metadata``; return the new DatasetRecord.

        Order: remove expired datasets, enforce max count, evict
        least-recently-used if necessary, then insert.
        """
        now = self._now()
        ttl = self._ttl()
        maximum = self._max()
        with self._lock:
            # 1. Remove expired datasets.
            expired = [
                key
                for key, rec in self._datasets.items()
                if (now - rec.last_accessed_at) > ttl
            ]
            for key in expired:
                del self._datasets[key]
            # 2/3. Enforce max count via LRU eviction.
            evicted = 0
            while len(self._datasets) >= max(int(maximum), 1):
                lru_key = min(
                    self._datasets,
                    key=lambda k: self._datasets[k].last_accessed_at,
                )
                del self._datasets[lru_key]
                evicted += 1
            # 4. Insert new dataset with an opaque unique ID.
            dataset_id = uuid.uuid4().hex
            while dataset_id in self._datasets:
                dataset_id = uuid.uuid4().hex
            record = DatasetRecord(
                dataset_id=dataset_id,
                dataframe=dataframe,
                metadata=dict(metadata) if isinstance(metadata, dict) else {},
                now=now,
            )
            self._datasets[dataset_id] = record
            # Lifecycle observability (Phase M6): counts only — never
            # contents, filenames, or ids.
            logger.info(
                "event=dataset_created expired_removed=%d evicted=%d stored=%d",
                len(expired),
                evicted,
                len(self._datasets),
            )
            return record

    def get_dataset(self, dataset_id):
        """Return the record, or None if missing/expired.

        Access refreshes ``last_accessed_at`` (LRU). Expired entries are
        removed and reported as missing.
        """
        now = self._now()
        with self._lock:
            record = self._datasets.get(dataset_id)
            if record is None:
                return None
            if (now - record.last_accessed_at) > self._ttl():
                del self._datasets[dataset_id]
                # Expired-dataset observability (Phase M6): the API layer
                # already logs the 404; this line attributes it to TTL
                # expiry. No contents, no ids.
                logger.info(
                    "event=dataset_expired remaining=%d",
                    len(self._datasets),
                )
                return None
            record.last_accessed_at = now
            return record

    def touch_dataset(self, dataset_id):
        """Refresh ``last_accessed_at``. Returns True if the ID exists."""
        return self.get_dataset(dataset_id) is not None

    def delete_dataset(self, dataset_id):
        """Remove one dataset. Returns True if it existed."""
        with self._lock:
            if dataset_id in self._datasets:
                del self._datasets[dataset_id]
                return True
            return False

    def clear(self):
        """Remove all datasets (tests / teardown)."""
        with self._lock:
            self._datasets.clear()

    def __len__(self):
        with self._lock:
            return len(self._datasets)


# Module-level singleton used by the Flask app (one store per process).
_default_store = DatasetStore()


def get_store():
    """Return the process-wide default store."""
    return _default_store


def create_dataset(dataframe, metadata):
    """Create a dataset in the default store; return the DatasetRecord."""
    return _default_store.create_dataset(dataframe, metadata)


def get_dataset(dataset_id):
    """Fetch a dataset from the default store (None if missing/expired)."""
    return _default_store.get_dataset(dataset_id)


def touch_dataset(dataset_id):
    """Refresh last-access time in the default store."""
    return _default_store.touch_dataset(dataset_id)


def delete_dataset(dataset_id):
    """Delete a dataset from the default store."""
    return _default_store.delete_dataset(dataset_id)
