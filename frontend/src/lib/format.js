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

export const MAX_CSV_BYTES = 10 * 1024 * 1024

export function isCsvFileName(name) {
  return typeof name === "string" && name.toLowerCase().endsWith(".csv")
}
