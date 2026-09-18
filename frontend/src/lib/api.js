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
 * Render cold-start tuning for `waitForBackendHealthy`.
 *
 * - `quickTimeoutMs`: how long the first probe may take before the caller
 *   treats the backend as (possibly) asleep and enters the waking loop.
 * - `wakingAfterMs`: when to notify `onWaking` while a probe is still
 *   pending, so UI can switch from "Uploading…" to "Starting the
 *   analysis server…" without waiting for the first probe to time out.
 * - `attemptTimeoutMs` / `retryIntervalMs` / `maxWaitMs`: one request at a
 *   time, several seconds apart, giving up after about a minute so the
 *   free-tier backend is never hammered.
 */
export const BACKEND_WAKE = {
  quickTimeoutMs: 8000,
  wakingAfterMs: 3000,
  attemptTimeoutMs: 15000,
  retryIntervalMs: 5000,
  maxWaitMs: 60000,
}

function createAbortError() {
  return typeof DOMException !== "undefined"
    ? new DOMException("Aborted", "AbortError")
    : Object.assign(new Error("Aborted"), { name: "AbortError" })
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError())
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(createAbortError())
    }
    signal?.addEventListener?.("abort", onAbort, { once: true })
  })
}

/**
 * Single health probe with its own timeout, wired to an optional caller
 * signal. A caller abort rejects with AbortError; a probe timeout rejects
 * with an ApiError flagged as a network error.
 */
async function probeHealth(timeoutMs, { baseUrl, signal } = {}) {
  const controller = new AbortController()
  const onCallerAbort = () => controller.abort()
  if (signal?.aborted) {
    throw createAbortError()
  }
  signal?.addEventListener?.("abort", onCallerAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await checkHealth({ baseUrl, signal: controller.signal })
  } catch (err) {
    if (signal?.aborted || err?.name === "AbortError") {
      if (signal?.aborted) throw createAbortError()
      // Our own per-probe timeout: the backend did not answer in time.
      throw new ApiError(
        "The analysis server is taking longer than expected to respond.",
        { isNetworkError: true },
      )
    }
    throw err
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.("abort", onCallerAbort)
  }
}

/**
 * Wait until GET /api/health succeeds (Render may need up to a minute to
 * wake the free-tier backend).
 *
 * - Uses `checkHealth` internally — no second fetch client.
 * - Resolves once the backend answers. HTTP errors from the health endpoint
 *   resolve too: the server is reachable, so the caller should proceed and
 *   let the real request surface any error.
 * - Calls `onWaking` once the wait looks like a cold start, so callers can
 *   show "Starting the analysis server…" instead of an error.
 * - Rejects with AbortError on caller abort, or with a network ApiError
 *   after `maxWaitMs` so callers can show "Backend unavailable" + retry.
 */
export async function waitForBackendHealthy({
  baseUrl,
  signal,
  quickTimeoutMs = BACKEND_WAKE.quickTimeoutMs,
  wakingAfterMs = BACKEND_WAKE.wakingAfterMs,
  attemptTimeoutMs = BACKEND_WAKE.attemptTimeoutMs,
  retryIntervalMs = BACKEND_WAKE.retryIntervalMs,
  maxWaitMs = BACKEND_WAKE.maxWaitMs,
  onWaking,
} = {}) {
  const startedAt = Date.now()
  const elapsed = () => Date.now() - startedAt
  let wakingNotified = false
  const notifyWaking = () => {
    if (!wakingNotified) {
      wakingNotified = true
      try {
        onWaking?.()
      } catch {
        // Listener errors must not break the health wait.
      }
    }
  }
  const wakingTimer = setTimeout(notifyWaking, wakingAfterMs)

  try {
    try {
      await probeHealth(quickTimeoutMs, { baseUrl, signal })
      return { coldStart: wakingNotified }
    } catch (err) {
      if (err?.name === "AbortError") throw err
      if (err instanceof ApiError && !err.isNetworkError) {
        // Reachable but unhealthy — proceed; the upload will report specifics.
        return { coldStart: wakingNotified }
      }
      notifyWaking()
    }

    while (elapsed() + retryIntervalMs < maxWaitMs) {
      await sleep(retryIntervalMs, signal)
      try {
        await probeHealth(attemptTimeoutMs, { baseUrl, signal })
        return { coldStart: true }
      } catch (err) {
        if (err?.name === "AbortError") throw err
        if (err instanceof ApiError && !err.isNetworkError) {
          return { coldStart: true }
        }
        // Still unreachable — keep waiting until the window expires.
      }
    }

    throw new ApiError(
      "We couldn't reach the analysis server. Please try again.",
      { isNetworkError: true },
    )
  } finally {
    clearTimeout(wakingTimer)
  }
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
 * dtypes, missing/unique counts, numeric stats, all rows).
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
