/**
 * Brutto-Netto-Schätzung für Provisionen.
 *
 * Bewusst eine grobe Näherung: Provisionen werden in Deutschland wie normales
 * Arbeitsentgelt versteuert (Lohnsteuer + Sozialabgaben). Der tatsächliche
 * Abzug hängt von Steuerklasse, Jahreseinkommen, Kirchensteuer und
 * Krankenkasse ab — deshalb arbeitet der Rechner mit einem persönlichen
 * Abzugssatz in %, den sich Nutzer:innen selbst einstellen (Default 30 %).
 */

export const DEFAULT_DEDUCTION_RATE = 30;

/** Sinnvolle Schnellauswahl-Sätze (grobe Bandbreite typischer Gesamtabzüge). */
export const RATE_PRESETS = [20, 25, 30, 35, 40, 45] as const;

const STORAGE_KEY = 'crm-tng-netto-rate';

/** Begrenzst den Abzugssatz auf einen plausiblen Bereich (0–70 %). */
export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return DEFAULT_DEDUCTION_RATE;
  return Math.min(70, Math.max(0, rate));
}

/**
 * Rechnet einen Brutto-Betrag mit dem Abzugssatz in Netto um.
 * Rundet kaufmännisch auf Cent.
 */
export function estimateNet(
  gross: number,
  ratePct: number,
): { net: number; deductions: number } {
  const safeGross = Number.isFinite(gross) && gross > 0 ? gross : 0;
  const rate = clampRate(ratePct);
  const deductions = Math.round(safeGross * rate) / 100;
  const net = Math.round(safeGross * 100 - deductions * 100) / 100;
  return { net, deductions };
}

/** Gespeicherten Abzugssatz laden (localStorage, pro Gerät). */
export function loadNettoRate(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_DEDUCTION_RATE;
    return clampRate(parseFloat(raw));
  } catch {
    return DEFAULT_DEDUCTION_RATE;
  }
}

/** Abzugssatz speichern. */
export function saveNettoRate(rate: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clampRate(rate)));
  } catch {
    /* privater Modus o. ä. — Schätzung funktioniert trotzdem */
  }
}
