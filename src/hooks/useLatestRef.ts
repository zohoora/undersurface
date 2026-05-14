import { useEffect, useRef, type MutableRefObject } from 'react'

// Mirrors a value into a ref so rAF loops / event handlers can read the
// latest without listing it as an effect dependency (which would tear the
// loop down on every change).
export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value)
  useEffect(() => { ref.current = value })
  return ref
}
