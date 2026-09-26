/* The official ReturnOS logo, wired in one place.
 *
 * `BrandMark` is the square R-and-arrow emblem used wherever the old glyph
 * placeholders sat (sidebars, headers, footer). `BrandLockup` is the full
 * logo with wordmark, for the few wide placements that can carry it.
 *
 * Both read the artwork from /public, so the asset is served as a static
 * file and cached, rather than being inlined into the bundle.
 */

export const LOGO_MARK_SRC = '/returnos-mark.png';
export const LOGO_LOCKUP_SRC = '/returnos-logo.png';

interface BrandMarkProps {
  /** Rendered size in px. Defaults to the 28px slot the layouts already use. */
  size?: number;
  className?: string;
}

/**
 * Decorative by default: every call site already places the word "ReturnOS"
 * next to it, so repeating the name to a screen reader is noise.
 */
export function BrandMark({ size = 28, className }: BrandMarkProps) {
  return (
    <img
      src={LOGO_MARK_SRC}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: 'cover', borderRadius: 9, flex: 'none' }}
    />
  );
}

interface BrandLockupProps {
  /** Rendered width in px; height follows the artwork's ratio. */
  width?: number;
  className?: string;
}

/** The full logo, including the wordmark. Carries the accessible name. */
export function BrandLockup({ width = 200, className }: BrandLockupProps) {
  return (
    <img
      src={LOGO_LOCKUP_SRC}
      alt="ReturnOS"
      width={width}
      className={className}
      style={{ width, height: 'auto', display: 'block' }}
    />
  );
}
