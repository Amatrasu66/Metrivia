/**
 * Metrivia API layer — the single place that talks to the Flask backend.
 *
 * - Base URL comes from `VITE_API_URL` (see `.env.example`). Falls back to
 *   the local Flask default so `npm run dev` works without any setup.
 * - No production URL is hardcoded here; set `VITE_API_URL` at build time.
 * - Components must import from this module instead of calling fetch().
 */

const DEFAULT_API_URL = "http://localhost:5000"

function resolveBaseUrl(override) {
  if (typeof override === "string" && override.trim() !== "") {
    return override.trim().replace(/\/+$/, "")
  }
  const fromEnv = import.meta.env?.VITE_API_URL
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") {
    return fromEnv.trim().replace(/\/+$/, "")
  }
  return DEFAULT_API_URL
}

export function getApiBaseUrl() {
  return resolveBaseUrl()
}

export class ApiError extends Error {
  constructor(message, { status = null, isNetworkError = false } = {}) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.isNetworkError = isNetworkError
  }
}

async function parseJsonSafe(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function networkErrorMessage() {
  return (
    `Could not reach the Metrivia backend at ${resolveBaseUrl()}. ` +
    "Make sure Flask is running (see backend/README.md) and VITE_API_URL is set correctly."
  )
}

/**
 * GET /api/health — confirms the backend is running.
 */
export async function checkHealth({ baseUrl, signal } = {}) {
  let response
  try {
    response = await fetch(`${resolveBaseUrl(baseUrl)}/api/health`, { signal })
  } catch (err) {
    if (err?.name === "AbortError") throw err
    throw new ApiError(networkErrorMessage(), { isNetworkError: true })
  }
  const body = await parseJsonSafe(response)
  if (!response.ok) {
    throw new ApiError(
      body?.error || `Health check failed (HTTP ${response.status}).`,
      { status: response.status },
    )
  }
  return body
}

/**
 * POST /api/upload — sends a CSV file (multipart field "file") and resolves
 * with the backend's dataset analysis (filename, row/column counts, columns,
 * dtypes, missing/unique counts, numeric stats, preview rows).
 *
 * Throws ApiError with the backend's message on 4xx/5xx, or an ApiError with
 * `isNetworkError: true` when the server cannot be reached. Re-throws
 * AbortError untouched so callers can ignore cancelled uploads.
 */
export async function uploadCsv(file, { baseUrl, signal } = {}) {
  const formData = new FormData()
  formData.append("file", file, file?.name ?? "upload.csv")

  let response
  try {
    response = await fetch(`${resolveBaseUrl(baseUrl)}/api/upload`, {
      method: "POST",
      body: formData,
      signal,
    })
  } catch (err) {
    if (err?.name === "AbortError") throw err
    throw new ApiError(networkErrorMessage(), { isNetworkError: true })
  }

  const body = await parseJsonSafe(response)
  if (!response.ok) {
    const message =
      body && typeof body.error === "string" && body.error.trim() !== ""
        ? body.error
        : `Upload failed (HTTP ${response.status}). Please try again.`
    throw new ApiError(message, { status: response.status })
  }
  return body
}
