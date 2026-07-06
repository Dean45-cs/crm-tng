/**
 * TNG Stadtnetz Markenzeichen.
 *
 * Zwei klar getrennte Varianten:
 *
 *   <TngTile />  – selbstständige Brandtile (TNG-blauer Gradient, gerundet,
 *                   weißes Logo). Für Sidebar, Login und Onboarding.
 *   <TngMark />  – nur das Logo, color-anpassbar, transparenter Hintergrund.
 *                   Für helle Flächen (z. B. Titlebar, Settings).
 *
 * Hintergrund: Die Originalpfade vom User zeichnen das Markenfeld als ein
 * großes Rechteck mit den Buchstaben "TNG" + Doppel-Loop als even-odd-
 * Aussparungen. Diese Pfade werden hier 1:1 weiter genutzt.
 */
import { useId } from 'react';

const VIEWBOX_TILE = '0 0 600 600';
// Enge Bounding-Box des Logos in der 600×600-Box (aus den Pfaden berechnet:
// x 59–541, y 246–354) plus 5 Einheiten symmetrischer Rand.
const MARK_X = 54;
const MARK_Y = 241;
const MARK_W = 492;
const MARK_H = 118;
const VIEWBOX_MARK = `${MARK_X} ${MARK_Y} ${MARK_W} ${MARK_H}`;

/**
 * Originalpfade. Erste Subpath = Außenrechteck (600×600),
 * danach folgende Subpaths = Buchstabenausschnitte (even-odd).
 */
function LogoPaths({ fill }: { fill: string }) {
  return (
    <g
      transform="translate(0,600) scale(0.1,-0.1)"
      fill={fill}
      fillRule="evenodd"
    >
      <path d="M0 3000 l0 -3000 3000 0 3000 0 0 3000 0 3000 -3000 0 -3000 0 0 -3000z m4194 520 c127 -32 227 -91 331 -195 50 -49 100 -107 110 -127 18 -36 19 -39 2 -55 -9 -10 -17 -12 -17 -6 0 7 -26 45 -59 85 -176 222 -463 317 -652 217 -109 -58 -159 -149 -159 -288 0 -309 309 -615 620 -613 118 0 212 44 270 124 45 62 36 67 -17 10 -68 -72 -126 -96 -233 -95 -145 0 -282 63 -400 183 -121 124 -174 241 -174 385 1 105 15 144 75 210 132 143 400 112 597 -70 62 -58 132 -145 132 -166 0 -4 -23 -32 -50 -62 -53 -59 -118 -97 -163 -97 -23 0 -27 4 -27 30 0 86 -106 190 -193 190 -34 0 -74 -35 -82 -70 -8 -38 21 -104 65 -147 51 -50 96 -68 170 -68 109 0 178 47 278 190 132 188 282 282 468 293 97 5 170 -13 233 -58 97 -70 119 -219 53 -352 -57 -117 -192 -232 -325 -278 -83 -29 -216 -37 -282 -16 -27 8 -50 14 -50 13 -61 -109 -98 -145 -192 -189 -298 -140 -750 131 -848 507 -21 82 -19 199 4 274 63 204 275 303 515 241z m-1042 -99 c37 -12 70 -25 72 -30 6 -9 -29 -120 -42 -133 -5 -5 -43 1 -87 12 -109 28 -217 27 -275 -2 -81 -41 -112 -114 -112 -263 0 -211 65 -294 228 -295 39 0 85 5 103 11 l31 11 0 74 0 74 -85 0 -85 0 0 33 c0 17 3 49 6 70 l7 37 169 0 168 0 -2 -182 -3 -183 -65 -32 c-91 -46 -169 -63 -281 -63 -131 0 -209 24 -279 86 -85 78 -120 175 -120 344 0 242 105 396 305 447 75 19 263 10 347 -16z m-1810 -53 c-2 -35 -5 -69 -7 -75 -3 -10 -39 -13 -135 -13 l-130 0 0 -355 0 -355 -100 0 -100 0 0 355 0 355 -140 0 -140 0 0 29 c0 15 3 49 6 75 l7 46 371 0 372 0 -4 -62z m489 -125 c79 -103 174 -227 212 -276 l67 -89 0 276 0 276 90 0 90 0 0 -430 0 -431 -92 3 -91 3 -211 273 -211 273 -3 -275 -2 -276 -85 0 -85 0 0 430 0 430 89 0 88 0 144 -187z" />
      <path d="M5030 3343 c-50 -8 -146 -47 -199 -80 -57 -36 -143 -119 -163 -156 -6 -12 13 5 43 37 139 152 343 217 477 150 68 -34 97 -80 97 -155 0 -190 -247 -390 -464 -377 -122 7 -187 61 -202 166 l-8 57 4 -63 c7 -125 90 -192 236 -192 142 0 269 59 377 173 213 227 96 487 -198 440z" />
      <path d="M4891 3125 c-73 -42 -102 -92 -76 -131 45 -69 235 18 235 106 0 55 -83 68 -159 25z" />
    </g>
  );
}

/**
 * Nur die Doppelschleife (das „∞" der Marke) als eigenständige Glyphe.
 * LOOP_OUTER ist der Schleifen-Subpath aus dem Original (via führendem
 * "M0 3000 m…" absolut positioniert), LOOP_HOLE_* sind die Innenformen,
 * die in der Maske als Löcher wirken.
 */
const LOOP_OUTER =
  'M0 3000 m4194 520 c127 -32 227 -91 331 -195 50 -49 100 -107 110 -127 18 -36 19 -39 2 -55 -9 -10 -17 -12 -17 -6 0 7 -26 45 -59 85 -176 222 -463 317 -652 217 -109 -58 -159 -149 -159 -288 0 -309 309 -615 620 -613 118 0 212 44 270 124 45 62 36 67 -17 10 -68 -72 -126 -96 -233 -95 -145 0 -282 63 -400 183 -121 124 -174 241 -174 385 1 105 15 144 75 210 132 143 400 112 597 -70 62 -58 132 -145 132 -166 0 -4 -23 -32 -50 -62 -53 -59 -118 -97 -163 -97 -23 0 -27 4 -27 30 0 86 -106 190 -193 190 -34 0 -74 -35 -82 -70 -8 -38 21 -104 65 -147 51 -50 96 -68 170 -68 109 0 178 47 278 190 132 188 282 282 468 293 97 5 170 -13 233 -58 97 -70 119 -219 53 -352 -57 -117 -192 -232 -325 -278 -83 -29 -216 -37 -282 -16 -27 8 -50 14 -50 13 -61 -109 -98 -145 -192 -189 -298 -140 -750 131 -848 507 -21 82 -19 199 4 274 63 204 275 303 515 241z';
const LOOP_HOLE_1 =
  'M5030 3343 c-50 -8 -146 -47 -199 -80 -57 -36 -143 -119 -163 -156 -6 -12 13 5 43 37 139 152 343 217 477 150 68 -34 97 -80 97 -155 0 -190 -247 -390 -464 -377 -122 7 -187 61 -202 166 l-8 57 4 -63 c7 -125 90 -192 236 -192 142 0 269 59 377 173 213 227 96 487 -198 440z';
const LOOP_HOLE_2 =
  'M4891 3125 c-73 -42 -102 -92 -76 -131 45 -69 235 18 235 106 0 55 -83 68 -159 25z';

/** Bounding-Box der Schleifen-Glyphe in der 600er-Box (im Browser vermessen). */
const GLYPH = { x: 366, y: 246.2, w: 174.9, h: 107.8 };

/**
 * Branded Tile im App-Icon-Stil: TNG-Gradient, gerundete Ecken und die
 * Doppelschleife groß im Zentrum. Bei kleinen Größen (Sidebar) bleibt die
 * Glyphe kräftig und lesbar — die volle Wortmarke übernimmt <TngMark />.
 */
export function TngTile({
  size = 40,
  radius,
}: {
  size?: number;
  radius?: number;
}) {
  const r = radius ?? Math.round(size * 0.22);
  // useId() liefert stabile, kollisionsfreie IDs (auch unter StrictMode/SSR).
  const base = useId();
  const gradId = `${base}-grad`;
  const shineId = `${base}-shine`;
  const bevelId = `${base}-bevel`;
  const clipId = `${base}-clip`;
  const glyphId = `${base}-glyph`;
  // Radius im 600er-Koordinatensystem
  const r600 = (r / size) * 600;

  // Glyphe auf 62 % Kachelbreite skalieren und mittig setzen.
  const s = (600 * 0.62) / GLYPH.w;
  const tx = (600 - GLYPH.w * s) / 2 - GLYPH.x * s;
  const ty = (600 - GLYPH.h * s) / 2 - GLYPH.y * s;

  return (
    <svg
      width={size}
      height={size}
      viewBox={VIEWBOX_TILE}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="TNG Stadtnetz"
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0a4d87" />
          <stop offset="50%" stopColor="#0066b3" />
          <stop offset="100%" stopColor="#13a3e2" />
        </linearGradient>
        <radialGradient id={shineId} cx="26%" cy="16%" r="90%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.22)" />
          <stop offset="58%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <linearGradient id={bevelId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.45)" />
          <stop offset="35%" stopColor="rgba(255,255,255,0.08)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        <clipPath id={clipId}>
          <rect width="600" height="600" rx={r600} ry={r600} />
        </clipPath>
        <mask id={glyphId} maskUnits="userSpaceOnUse" x="0" y="0" width="600" height="600">
          <g transform={`translate(${tx} ${ty}) scale(${s})`}>
            <g transform="translate(0,600) scale(0.1,-0.1)">
              <path d={LOOP_OUTER} fill="white" />
              <path d={LOOP_HOLE_1} fill="black" />
              <path d={LOOP_HOLE_2} fill="black" />
            </g>
          </g>
        </mask>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width="600" height="600" fill={`url(#${gradId})`} />
        {/* Glanzlicht oben links */}
        <rect width="600" height="600" fill={`url(#${shineId})`} pointerEvents="none" />
        {/* Die Schleife als weiße Glyphe */}
        <rect width="600" height="600" fill="#ffffff" mask={`url(#${glyphId})`} />
      </g>
      {/* Innerer Bevel oben (Apple-Icon-artig) */}
      <rect
        x="4" y="4"
        width="592" height="592"
        rx={Math.max(0, r600 - 4)} ry={Math.max(0, r600 - 4)}
        fill="none"
        stroke={`url(#${bevelId})`}
        strokeWidth="7"
        pointerEvents="none"
      />
      {/* Äußerer Hairline-Rand */}
      <rect
        x="1.5" y="1.5"
        width="597" height="597"
        rx={r600} ry={r600}
        fill="none"
        stroke="rgba(9, 30, 54, 0.18)"
        strokeWidth="3"
        pointerEvents="none"
      />
    </svg>
  );
}

/**
 * Reine Logo-Form in beliebiger Farbe, transparenter Hintergrund.
 * Nutzt eine SVG-Mask, um die Aussparung des Originalpfades als
 * positives Logo darzustellen.
 */
export function TngMark({
  height = 22,
  color = '#0066b3',
}: {
  height?: number;
  color?: string;
}) {
  const aspect = MARK_W / MARK_H;
  const width = Math.round(height * aspect);
  const maskId = `${useId()}-mask`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={VIEWBOX_MARK}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="TNG Stadtnetz"
      style={{ display: 'block' }}
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="600" height="600">
          {/* Weißes Backboard = sichtbar */}
          <rect width="600" height="600" fill="white" />
          {/* Originalpfad in Schwarz: deckt das Backboard zu, ABER die
              even-odd-Aussparungen lassen das Backboard durch -> nur die
              Logo-Buchstaben bleiben sichtbar in der Maske. */}
          <LogoPaths fill="black" />
        </mask>
      </defs>
      <rect width="600" height="600" fill={color} mask={`url(#${maskId})`} />
    </svg>
  );
}

/** Kompatibilitäts-Default-Export für ältere Aufrufstellen. */
export function TngLogo({
  height = 32,
  color = 'white',
}: {
  height?: number;
  color?: 'white' | 'blue' | 'dark';
  variant?: string;
}) {
  if (color === 'white') return <TngTile size={height} />;
  return <TngMark height={height} color={color === 'dark' ? '#1d1d1f' : '#0066b3'} />;
}
