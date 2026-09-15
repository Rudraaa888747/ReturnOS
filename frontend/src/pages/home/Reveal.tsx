import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import styles from './home.module.css'

/**
 * One-shot scroll reveal with a restrained vocabulary: fade for content,
 * rise for grouped panels. CSS disables motion under prefers-reduced-motion.
 */
export function Reveal({
  children,
  as: Tag = 'div',
  motion = 'rise',
}: {
  children: ReactNode
  as?: 'div' | 'li' | 'section'
  motion?: 'rise' | 'fade'
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true)
          observer.disconnect()
        }
      },
      { threshold: 0.12 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <Tag
      ref={ref as never}
      className={`${styles.reveal} ${motion === 'fade' ? styles.revealFade : ''} ${shown ? styles.revealIn : ''}`}
    >
      {children}
    </Tag>
  )
}
