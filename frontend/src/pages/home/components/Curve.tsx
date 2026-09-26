import styles from '../home.module.css'

/**
 * Organic section divider in the OnTrac "colored block, curved edges" idiom:
 * a full-width inline-SVG single scoop painted in the PREVIOUS section's
 * tone, sitting flush at the current section's top edge so the block above
 * hands off with a curved bottom edge. One curve family — smooth single
 * scoops, never jagged or multi-peak. `flip` mirrors the sweep so adjacent
 * boundaries don't rhyme. Static shape, no motion.
 */
const PATHS = {
  // Valley: both ends anchored high (22/30), middle controls sag DOWN to 78.
  scoop: 'M0,0 H1440 V22 C1080,78 360,78 0,30 Z',
  // Dome (approved reference): ends low (75/60), middle pulls UP to 15.
  rise: 'M0,0 H1440 V75 C1080,15 360,15 0,60 Z',
  // Gentle asymmetric sag: ends 40/52, middle drifts to mid-60s.
  drift: 'M0,0 H1440 V40 C1000,66 560,64 0,52 Z',
} as const

export type CurveVariant = keyof typeof PATHS

export function Curve({
  tone,
  variant = 'scoop',
  flip = false,
  tall = false,
}: {
  /** Previous section's background, e.g. 'var(--paper)'. */
  tone: string
  variant?: CurveVariant
  flip?: boolean
  /** Taller, more deliberate sweep for hero-adjacent boundaries. */
  tall?: boolean
}) {
  return (
    <div className={`${styles.curve} ${tall ? styles.curveTall : ''}`} aria-hidden="true">
      <svg
        viewBox="0 0 1440 90"
        preserveAspectRatio="none"
        focusable="false"
        style={flip ? { transform: 'scaleX(-1)' } : undefined}
      >
        <path d={PATHS[variant]} fill={tone} />
      </svg>
    </div>
  )
}
