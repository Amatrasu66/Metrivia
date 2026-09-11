import { useCallback, useEffect, useState } from "react"
import { checkHealth } from "@/lib/api"

export const BACKEND_STATUS = {
  CHECKING: "checking",
  ONLINE: "online",
  WAKING: "waking",
  OFFLINE: "offline",
}

/**
 * Polls GET /api/health until the backend answers, with Render Free
 * cold starts in mind:
 * - "checking" while the first attempt is fresh
 * - "waking" once an attempt stays pending past `wakingAfterMs`
 * - retries every `retryIntervalMs` until `maxElapsedMs`, then "offline"
 * - a single in-flight request at a time; timers/controllers cleaned up
 *   on unmount; no polling once online.
 */
export function useBackendStatus({
  wakingAfterMs = 4000,
  retryIntervalMs = 5000,
  maxElapsedMs = 90000,
  attemptTimeoutMs = 20000,
} = {}) {
  const [status, setStatus] = useState(BACKEND_STATUS.CHECKING)
  const [nonce, setNonce] = useState(0)

  const retry = useCallback(() => {
    setStatus(BACKEND_STATUS.CHECKING)
    setNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    let attemptController = null
    let wakingTimer = null
    let retryTimer = null
    const startTime = Date.now()

    const clearTimers = () => {
      if (wakingTimer !== null) clearTimeout(wakingTimer)
      if (retryTimer !== null) clearTimeout(retryTimer)
      wakingTimer = null
      retryTimer = null
    }
    const setIfLive = (next) => {
      if (!cancelled) setStatus(next)
    }

    const attempt = () => {
      if (cancelled) return
      attemptController = new AbortController()
      const timeout = setTimeout(
        () => attemptController.abort(),
        attemptTimeoutMs,
      )
      checkHealth({ signal: attemptController.signal }).then(
        () => {
          clearTimeout(timeout)
          clearTimers()
          setIfLive(BACKEND_STATUS.ONLINE)
        },
        () => {
          clearTimeout(timeout)
          if (cancelled) return
          // AbortError here means our own per-attempt timeout (unmount is
          // already excluded via `cancelled`); treat like any slow failure.
          if (Date.now() - startTime + retryIntervalMs >= maxElapsedMs) {
            clearTimers()
            setIfLive(BACKEND_STATUS.OFFLINE)
          } else {
            retryTimer = setTimeout(attempt, retryIntervalMs)
          }
        },
      )
    }

    wakingTimer = setTimeout(() => {
      if (cancelled) return
      setStatus((current) =>
        current === BACKEND_STATUS.CHECKING ? BACKEND_STATUS.WAKING : current,
      )
    }, wakingAfterMs)

    attempt()

    return () => {
      cancelled = true
      clearTimers()
      if (attemptController !== null) attemptController.abort()
    }
  }, [nonce, wakingAfterMs, retryIntervalMs, maxElapsedMs, attemptTimeoutMs])

  return { status, retry }
}
