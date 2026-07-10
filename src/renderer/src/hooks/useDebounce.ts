import { useEffect, useState } from 'react'

/**
 * Returns a debounced copy of `value` that only updates after `delay` ms have
 * passed without a change. Used to throttle real-time search queries so we
 * don't fire a request on every keystroke.
 */
export const useDebounce = <T>(value: T, delay = 250): T => {
  const [debounced, setDebounced] = useState<T>(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
