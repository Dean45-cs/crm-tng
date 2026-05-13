/**
 * TNG Stadtnetz Markenzeichen.
 * Lädt das Original-SVG aus /public/tng-logo.svg und passt
 * die Farbe per CSS-Filter an den jeweiligen Hintergrund an.
 *
 * color-Varianten:
 *   'white'  – weißes Logo (für blaue/dunkle Flächen)
 *   'blue'   – TNG-Blau Logo (für helle Flächen)
 *   'dark'   – Schwarz (Original)
 */
export function TngLogo({
  height = 32,
  color = 'white',
  style: extraStyle,
}: {
  height?: number;
  color?: 'white' | 'blue' | 'dark';
  /** Wird nicht mehr benötigt, nur für Abwärtskompatibilität */
  variant?: string;
  style?: React.CSSProperties;
}) {
  const filter =
    color === 'white'
      ? 'brightness(0) invert(1)'
      : color === 'blue'
        ? 'brightness(0) saturate(100%) invert(23%) sepia(90%) saturate(1200%) hue-rotate(191deg) brightness(95%)'
        : 'none';

  return (
    <img
      src="/tng-logo.svg"
      alt="TNG Stadtnetz"
      draggable={false}
      style={{
        display: 'block',
        width: height,
        height: height,
        objectFit: 'contain',
        userSelect: 'none',
        filter,
        ...extraStyle,
      }}
    />
  );
}
