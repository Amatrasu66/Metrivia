/**
 * Format a byte count into a human-readable file size.
 * Local helper only — no parsing or network involved.
 */
export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—"
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  )
  const value = bytes / 1024 ** index
  return `${value >= 100 ? Math.round(value) : value.toFixed(value >= 10 ? 1 : 0)} ${units[index]}`
}

/** Application CSV upload ceiling: 20 MiB (backend enforces the same). */
export const MAX_CSV_BYTES = 20 * 1024 * 1024
export const MAX_CSV_LABEL = "20 MiB"

export function isCsvFileName(name) {
  return typeof name === "string" && name.toLowerCase().endsWith(".csv")
}

/**
 * Reusable pre-upload gate (Phase E): extension + size from the actual
 * `File`, before any network begins. Returns { ok: true } or
 * { ok: false, title, message } with user-facing copy. Pure — the backend
 * limit stays authoritative; this only saves a doomed upload.
 */
export function validateCsvFile(file) {
  const name =
    file?.name != null && String(file.name).trim() !== ""
      ? String(file.name)
      : "that file"
  if (!isCsvFileName(file?.name)) {
    return {
      ok: false,
      title: "We could not accept that file",
      message: `“${name}” is not a .csv file. Please choose a file ending in .csv and try again.`,
    }
  }
  if (typeof file?.size !== "number" || file.size > MAX_CSV_BYTES) {
    return {
      ok: false,
      title: "We could not accept that file",
      message: `“${name}” exceeds the ${MAX_CSV_LABEL} limit. Please choose a smaller CSV file.`,
    }
  }
  return { ok: true }
}

/** Format a whole number with thousands separators (12,800). */
export function formatCount(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString("en-US") : "—"
}

/** Format a 0–100 percentage with one decimal (93.3%). */
export function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "—"
}
