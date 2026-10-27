import { useCallback, useEffect, useRef } from 'react'

/** Schedule the latest callback after a quiet period; scheduling again resets the timer. */
export function useDebouncedCallback<Args extends unknown[]>(callback: (...args: Args) => void, delayMs: number) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }, [])

  const schedule = useCallback(
    (...args: Args) => {
      cancel()
      timer.current = setTimeout(() => {
        timer.current = null
        callbackRef.current(...args)
      }, delayMs)
    },
    [cancel, delayMs],
  )

  useEffect(() => cancel, [cancel])
  return { schedule, cancel }
}
