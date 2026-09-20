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

/**
 * Phase L: POST /api/upload?stream=progress — same analysis as `uploadCsv`,
 * but the backend streams real milestones (NDJSON `progress` events,
 * ordered, monotonic, 0..90) followed by a `result-start` marker and the
 * dataset JSON in one request. No job endpoint, no polling, no Redis, no
 * WebSocket.
 *
 * - `onProgress({ value, stage, label })` fires once per backend milestone.
 *   Values are clamped to 0..100 and decreasing values are ignored, so the
 *   bar this feeds can never move backward even if a proxy ever reordered
 *   chunks (the backend itself always sends ordered, monotonic events).
 * - Browser upload transfer time reports nothing here on purpose: upload
 *   bytes are not analysis progress, and the bar stays on the spinner /
 *   last milestone until the backend actually starts reporting.
 * - Resolves with the dataset only after the full result has been received
 *   and parsed — callers set exactly 100% at that point, so 100% always
 *   means "result usable", never a prediction.
 * - Re-throws AbortError untouched (cancellation / workspace switch /
 *   unmount). Listener errors from `onProgress` are swallowed so a UI
 *   update can never break the upload.
 * - Falls back to plain JSON when the body is not a stream (older backend
 *   or a buffering proxy that collapsed it): resolves with the dataset and
 *   reports no intermediate milestones rather than inventing any.
 */
export async function uploadCsvWithProgress(
  file,
  { baseUrl, signal, onProgress } = {},
) {
  const formData = new FormData()
  formData.append("file", file, file?.name ?? "upload.csv")

  let response
  try {
    response = await fetch(
      `${resolveBaseUrl(baseUrl)}/api/upload?stream=progress`,
      {
        method: "POST",
        body: formData,
        signal,
        headers: { Accept: "application/x-ndjson" },
      },
    )
  } catch (err) {
    if (err?.name === "AbortError") throw err
    throw new ApiError(networkErrorMessage(), { isNetworkError: true })
  }

  const contentType = response.headers?.get?.("content-type") ?? ""
  if (!contentType.includes("application/x-ndjson") || !response.body) {
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

  const notify = (event) => {
    if (typeof onProgress !== "function") return
    try {
      onProgress(event)
    } catch {
      // UI listener errors must not break the upload stream.
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let headerBuffer = ""
  let resultStarted = false
  const resultParts = []
  let lastValue = 0
  const emit = (value, stage, label) => {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return
    const clamped = Math.min(100, Math.max(0, numeric))
    if (clamped < lastValue) return
    lastValue = clamped
    notify({ value: clamped, stage, label })
  }

  try {
    for (;;) {
      if (signal?.aborted) {
        try {
          await reader.cancel()
        } catch {
          // Cancelling the reader is best-effort; the abort below wins.
        }
        throw createAbortError()
      }
      const { done, value } = await reader.read()
      const text = decoder.decode(value ?? new Uint8Array(), {
        stream: !done,
      })
      if (!resultStarted) {
        headerBuffer += text
        let newlineIndex = headerBuffer.indexOf("\n")
        while (newlineIndex !== -1) {
          const line = headerBuffer.slice(0, newlineIndex).trim()
          headerBuffer = headerBuffer.slice(newlineIndex + 1)
          if (line !== "") {
            let event = null
            try {
              event = JSON.parse(line)
            } catch {
              event = null
            }
            if (event && event.type === "progress") {
              emit(event.value, event.stage, event.label)
            } else if (event && event.type === "error") {
              const message =
                typeof event.error === "string" && event.error.trim() !== ""
                  ? event.error
                  : "Failed to analyze the CSV file."
              throw new ApiError(message, { status: event.status ?? null })
            } else if (event && event.type === "result-start") {
              resultStarted = true
              // The remainder of the buffer (no literal newlines in the
              // dataset JSON) is already result bytes.
              if (headerBuffer !== "") {
                resultParts.push(headerBuffer)
                headerBuffer = ""
              }
              break
            }
            // Unknown line types are ignored so a future backend addition
            // can never break result correctness.
          }
          if (resultStarted) break
          newlineIndex = headerBuffer.indexOf("\n")
        }
      } else if (text !== "") {
        resultParts.push(text)
      }
      if (done) break
    }
  } catch (err) {
    if (err?.name === "AbortError") throw err
    if (err instanceof ApiError) throw err
    if (signal?.aborted) throw createAbortError()
    throw new ApiError(networkErrorMessage(), { isNetworkError: true })
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Release is best-effort after completion / cancellation.
    }
  }

  if (!resultStarted) {
    throw new ApiError("Upload failed. Please try again.")
  }
  const rawResult = resultParts.join("").trim()
  let dataset
  try {
    dataset = JSON.parse(rawResult)
  } catch {
    throw new ApiError("Upload failed. Please try again.")
  }
  if (!dataset || typeof dataset !== "object") {
    throw new ApiError("Upload failed. Please try again.")
  }
  return dataset
}

/**
 * Shared GET helper for the Phase M1/M2 dataset endpoints — the single
 * fetch configuration for metadata + rows (base URL, error mapping, abort
 * semantics). Upload/health keep their existing paths untouched.
 */
async function fetchDatasetJson(path, { baseUrl, signal, query } = {}) {
  let url = `${resolveBaseUrl(baseUrl)}${path}`
  if (query && typeof query === "object") {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue
      params.set(key, String(value))
    }
    const encoded = params.toString()
    if (encoded !== "") url += `?${encoded}`
  }
  let response
  try {
    response = await fetch(url, { signal })
  } catch (err) {
    if (err?.name === "AbortError") throw err
    throw new ApiError(networkErrorMessage(), { isNetworkError: true })
  }
  const body = await parseJsonSafe(response)
  if (!response.ok) {
    const message =
      body && typeof body.error === "string" && body.error.trim() !== ""
        ? body.error
        : `Request failed (HTTP ${response.status}). Please try again.`
    throw new ApiError(message, { status: response.status })
  }
  return body
}

function requireDatasetId(datasetId) {
  if (typeof datasetId !== "string" || datasetId.trim() === "") {
    throw new ApiError("Missing dataset id. Please upload the CSV again.")
  }
  return datasetId.trim()
}

/**
 * GET /api/datasets/<id> — metadata without row data (row/column counts,
 * schema, preview count). Re-throws AbortError untouched.
 */
export async function getDatasetMetadata(datasetId, { baseUrl, signal } = {}) {
  const id = requireDatasetId(datasetId)
  return fetchDatasetJson(`/api/datasets/${encodeURIComponent(id)}`, {
    baseUrl,
    signal,
  })
}

/**
 * Shared POST helper for the Phase M3 filter endpoint — same base URL,
 * error mapping, and abort semantics as the GET helper above. No new HTTP
 * library; plain fetch with JSON.
 */
async function postDatasetJson(path, payload, { baseUrl, signal } = {}) {
  const url = `${resolveBaseUrl(baseUrl)}${path}`
  let response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
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
        : `Request failed (HTTP ${response.status}). Please try again.`
    throw new ApiError(message, { status: response.status })
  }
  return body
}

/**
 * POST /api/datasets/<id>/filter — one bounded page of server-filtered
 * rows over the FULL dataset plus the authoritative `filtered_row_count`
 * (and total `row_count`). `filters` is the structured list from
 * `toServerFilters` (empty → all rows). Only the requested page is ever
 * returned. Re-throws AbortError untouched; 404 means the session expired.
 */
export async function queryFilteredDatasetRows(
  datasetId,
  { page = 0, pageSize = 200, filters = [], baseUrl, signal } = {},
) {
  const id = requireDatasetId(datasetId)
  const list = Array.isArray(filters) ? filters : []
  return postDatasetJson(`/api/datasets/${encodeURIComponent(id)}/filter`, {
    filters: list,
    page,
    page_size: pageSize,
  }, { baseUrl, signal })
}

/**
 * POST /api/datasets/<id>/chart — server-side chart aggregation (Phase M4).
 *
 * `chartRequest` is built by `buildChartRequest` in
 * `lib/chart-data-source.js` (chart type + dimension + measure +
 * aggregation + `toServerFilters()` output + limit/sort/date grouping).
 * The backend applies the M3 filter mask over the FULL server-side
 * DataFrame, aggregates, and returns a small bounded payload — the browser
 * never receives the 50k-row dataset for charting. Re-throws AbortError
 * untouched; a 404 ApiError means the server session expired.
 */
export async function queryChartData(
  datasetId,
  chartRequest,
  { baseUrl, signal } = {},
) {
  const id = requireDatasetId(datasetId)
  if (chartRequest === null || typeof chartRequest !== "object") {
    throw new ApiError("Missing chart configuration. Please try again.")
  }
  return postDatasetJson(`/api/datasets/${encodeURIComponent(id)}/chart`, chartRequest, {
    baseUrl,
    signal,
  })
}

/**
 * GET /api/datasets/<id>/rows?page=0&page_size=200 — one bounded page of
 * rows (never the whole dataset). `page` is 0-based; `pageSize` clamps to
 * the backend maximum server-side, but callers should use the centralized
 * SERVER_PAGE_SIZE_* constants. Re-throws AbortError untouched so table
 * cancellation stays silent; a 404 ApiError means the server session
 * expired (callers show the expired-dataset state, never auto-retry).
 *
 * Phase M3: when a non-empty structured `filters` list is provided, this
 * delegates to POST /api/datasets/<id>/filter instead so every call site
 * keeps one entry point; without filters the legacy GET path is used
 * unchanged (M2 pagination tests stay green).
 */
export async function getDatasetRows(
  datasetId,
  { page = 0, pageSize = 200, filters = null, baseUrl, signal } = {},
) {
  if (Array.isArray(filters) && filters.length > 0) {
    return queryFilteredDatasetRows(datasetId, {
      page,
      pageSize,
      filters,
      baseUrl,
      signal,
    })
  }
  const id = requireDatasetId(datasetId)
  return fetchDatasetJson(`/api/datasets/${encodeURIComponent(id)}/rows`, {
    baseUrl,
    signal,
    query: { page, page_size: pageSize },
  })
}
