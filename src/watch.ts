/** Timing shared by the event watchers: one resubscribe interval and one cancellable delay. */

/** How long a stream that ended, or failed, waits before it subscribes again. */
export const RESUBSCRIBE_MS = 5_000

/** Resolves after `ms`, or at once when `signal` aborts. */
export const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done, { once: true })
  })
