import { useEffect, useRef } from 'react'

// A tab coming back into view usually fires both visibilitychange and
// window focus, back to back. Refreshes this close together count as one.
const RETURN_REFRESH_DEDUPE_MS = 2_000

// A polling interval that only runs while `enabled` and while the tab is
// visible (Page Visibility API). Going hidden stops the timer outright; when
// the tab comes back (visible again, or window focus) `callback` runs once
// immediately and the interval restarts from there. `enabled` going false
// stops everything, with no further calls.
//
// One timer per mounted caller, always: the effect's cleanup clears it, so a
// StrictMode double-mount, a remount, or `enabled` toggling never leaves a
// second one running. `callback` is read through a ref, so the interval
// always calls the latest render's version without restarting.
export function useVisibleInterval(callback: () => void, intervalMs: number, enabled: boolean) {
  const callbackRef = useRef(callback)
  useEffect(() => {
    callbackRef.current = callback
  })

  useEffect(() => {
    if (!enabled) return

    let timer: number | null = null
    let lastReturnRefreshAt = 0

    const start = () => {
      if (timer === null) timer = window.setInterval(() => callbackRef.current(), intervalMs)
    }
    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer)
        timer = null
      }
    }
    const refreshOnReturn = () => {
      if (document.hidden) return
      const now = Date.now()
      if (now - lastReturnRefreshAt >= RETURN_REFRESH_DEDUPE_MS) {
        lastReturnRefreshAt = now
        callbackRef.current()
        // Restart so the next tick is a full interval after this refresh.
        stop()
      }
      start()
    }
    const onVisibilityChange = () => {
      if (document.hidden) stop()
      else refreshOnReturn()
    }

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refreshOnReturn)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refreshOnReturn)
    }
  }, [enabled, intervalMs])
}
