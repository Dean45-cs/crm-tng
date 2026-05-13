/**
 * TNG Stadtnetz Markenzeichen.
 *
 * Verwendet die Original-Logodatei aus /public/tng-logo.png.
 * Falls die Datei fehlt, fällt ein einfacher Text-Fallback ein.
 *
 * Drei Layout-Varianten:
 *   - 'mark'   : Quadratisches Tile (Sidebar, kleine Stellen)
 *   - 'lockup' : Horizontale Markendarstellung (Titlebar)
 *   - 'full'   : Großes Tile für Login / Onboarding
 */

const LOGO_SRC = '/tng-logo.png';

export function TngLogo({
  variant = 'lockup',
  height = 28,
  rounded = true,
}: {
  variant?: 'mark' | 'lockup' | 'full';
  height?: number;
  rounded?: boolean;
  /** Wird nur noch akzeptiert, damit alte Aufrufe nicht crashen. */
  color?: string;
}) {
  const sizing: React.CSSProperties =
    variant === 'mark'
      ? { width: height, height, borderRadius: rounded ? height * 0.24 : 0 }
      : variant === 'full'
        ? { height, width: height, borderRadius: rounded ? height * 0.22 : 0 }
        : { height, width: 'auto', borderRadius: rounded ? height * 0.22 : 0 };

  return (
    <img
      src={LOGO_SRC}
      alt="TNG Stadtnetz"
      style={{
        display: 'block',
        objectFit: 'cover',
        userSelect: 'none',
        pointerEvents: 'none',
        ...sizing,
      }}
      draggable={false}
    />
  );
}
