/**
 * TNG Stadtnetz Markenzeichen. Inline-SVG damit es verlustfrei
 * skaliert und sich an die aktuelle Farbe anpasst.
 *
 * Drei Varianten:
 *   - 'mark'   : Nur das Logogramm (zwei verschlungene Ringe)
 *   - 'lockup' : "TNG" + Logogramm (horizontale Wortmarke)
 *   - 'full'   : Lockup auf blauem Markenhintergrund (für den Login)
 */
export function TngLogo({
  variant = 'lockup',
  height = 28,
  color = 'currentColor',
}: {
  variant?: 'mark' | 'lockup' | 'full';
  height?: number;
  color?: string;
}) {
  if (variant === 'mark') {
    const w = height;
    return (
      <svg
        width={w}
        height={height}
        viewBox="0 0 56 56"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="TNG"
      >
        <Mark color={color} />
      </svg>
    );
  }

  if (variant === 'full') {
    const aspect = 240 / 240;
    const w = height * aspect;
    return (
      <svg
        width={w}
        height={height}
        viewBox="0 0 240 240"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="TNG Stadtnetz"
      >
        <defs>
          <linearGradient id="tng-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0a4f8c" />
            <stop offset="55%" stopColor="#0066b3" />
            <stop offset="100%" stopColor="#1e7cc6" />
          </linearGradient>
          <radialGradient id="tng-shine" cx="30%" cy="22%" r="70%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.22)" />
            <stop offset="60%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
        </defs>
        <rect width="240" height="240" rx="48" fill="url(#tng-bg)" />
        <rect width="240" height="240" rx="48" fill="url(#tng-shine)" />
        <g transform="translate(28, 78)">
          <Wordmark color="#ffffff" />
        </g>
      </svg>
    );
  }

  // 'lockup'
  const aspect = 184 / 60;
  const w = height * aspect;
  return (
    <svg
      width={w}
      height={height}
      viewBox="0 0 184 60"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="TNG"
    >
      <Wordmark color={color} />
    </svg>
  );
}

/**
 * Die Wortmarke "TNG" + verschlungenes Logogramm.
 * Koordinatensystem: viewBox 184x60, baseline ~ y=46
 */
function Wordmark({ color }: { color: string }) {
  return (
    <g fill={color}>
      {/* T */}
      <path d="M 0 4 H 36 V 14 H 23 V 56 H 13 V 14 H 0 Z" />
      {/* N */}
      <path d="M 44 4 H 54 L 76 36 V 4 H 86 V 56 H 76 L 54 24 V 56 H 44 Z" />
      {/* G */}
      <path d="
        M 118 3
        C 132 3 142 11 144 22
        H 134
        C 132 16 126 13 119 13
        C 109 13 102 21 102 30
        C 102 39 109 47 119 47
        C 127 47 133 43 134 36
        H 122 V 27 H 144 V 56 H 137 L 136 49
        C 132 54 126 57 118 57
        C 103 57 92 45 92 30
        C 92 15 103 3 118 3 Z
      " />
      {/* Logogramm: zwei verschlungene abgerundete Ringe (oo) */}
      <g transform="translate(150, 14)">
        <path
          d="M 12 0
             C 18.6 0 24 5.4 24 16
             C 24 26.6 18.6 32 12 32
             C 5.4 32 0 26.6 0 16
             C 0 5.4 5.4 0 12 0 Z
             M 12 6
             C 7.6 6 6 10.4 6 16
             C 6 21.6 7.6 26 12 26
             C 16.4 26 18 21.6 18 16
             C 18 10.4 16.4 6 12 6 Z"
        />
        <path
          d="M 22 0
             C 28.6 0 34 5.4 34 16
             C 34 26.6 28.6 32 22 32
             C 15.4 32 10 26.6 10 16
             C 10 5.4 15.4 0 22 0 Z
             M 22 6
             C 17.6 6 16 10.4 16 16
             C 16 21.6 17.6 26 22 26
             C 26.4 26 28 21.6 28 16
             C 28 10.4 26.4 6 22 6 Z"
        />
      </g>
    </g>
  );
}

function Mark({ color }: { color: string }) {
  return (
    <g fill={color} transform="translate(7, 12)">
      <path
        d="M 14 0
           C 21.7 0 28 6.3 28 18
           C 28 29.7 21.7 36 14 36
           C 6.3 36 0 29.7 0 18
           C 0 6.3 6.3 0 14 0 Z
           M 14 7
           C 8.9 7 7 12.1 7 18
           C 7 23.9 8.9 29 14 29
           C 19.1 29 21 23.9 21 18
           C 21 12.1 19.1 7 14 7 Z"
      />
      <path
        d="M 28 0
           C 35.7 0 42 6.3 42 18
           C 42 29.7 35.7 36 28 36
           C 20.3 36 14 29.7 14 18
           C 14 6.3 20.3 0 28 0 Z
           M 28 7
           C 22.9 7 21 12.1 21 18
           C 21 23.9 22.9 29 28 29
           C 33.1 29 35 23.9 35 18
           C 35 12.1 33.1 7 28 7 Z"
      />
    </g>
  );
}
