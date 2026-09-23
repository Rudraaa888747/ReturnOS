import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from '../../../hooks/useReducedMotion'

/** Animated integer counter that resolves instantly under reduced motion. */
export function useCountUp(target: number, start: boolean, durationMs = 1100): number {
  const reduced = useReducedMotion()
  const [value, setValue] = useState(0)
  const raf = useRef(0)

  useEffect(() => {
    if (!start) return
    if (reduced) {
      setValue(target)
      return
    }
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / durationMs)
      const eased = 1 - (1 - p) * (1 - p)
      setValue(Math.round(target * eased))
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [start, target, durationMs, reduced])

  return value
}
