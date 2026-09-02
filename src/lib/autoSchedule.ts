import type {
  AgentCompetency,
  Campaign,
  CampaignCallType,
  Shift,
  ShiftType,
  StaffingTarget,
} from '../types';
import { SHIFT_META, isoWeekday } from './shifts';
import { competencyOf, indexCompetencies, levelDef, type CompetencyIndex } from './competencies';
import { campaignFor } from './campaigns';
import { dateKey, parseLocalDate } from './utils';

/**
 * Der Plan schreibt sich selbst: aus Soll-Besetzung, Abwesenheiten und
 * Schulungsstand wird ein vollständiger Vorschlag für den angezeigten Zeitraum.
 *
 * Warum überhaupt automatisch: die Einteilung ist zu 90 % dieselbe Rechnung —
 * genug Leute je Schicht, niemand über sein Wochenpensum, niemand auf eine
 * Kampagne, für die er nicht geschult ist. Von Hand ist das eine halbe Stunde
 * Puzzeln, in der genau die drei Regeln reihum verletzt werden, die nachher
 * jemandem auffallen. Die Ausnahmen bleiben trotzdem Chefsache: der Planer
 * schlägt vor, die Übernahme ist ein Klick und in einem Zug rückgängig zu
 * machen (siehe persistCells in Schedule.tsx).
 *
 * Bewusst ein reines Modul ohne Datenbank und ohne React: derselbe Vorschlag
 * wird erst als Vorschau gerechnet und danach geschrieben. Käme zwischen beiden
 * Läufen etwas Zufälliges hinein, stünde am Ende ein anderer Plan da als der,
 * den der Chef gesehen hat. Deshalb ist hier alles deterministisch — bis hin
 * zum Gleichstand, der über die Nutzer-Id aufgelöst wird.
 *
 * Was der Planer NICHT tut: bestehende Abwesenheiten anfassen, laufende
 * Tauschanfragen überschreiben oder eine Zuteilung erzwingen, für die niemand
 * geschult ist. Lieber eine ehrliche Lücke im Vorschlag (mit Begründung) als
 * eine Zelle, die im Plan gut aussieht und im Gespräch schiefgeht.
 */

// ── Eingaben ────────────────────────────────────────────────────────────────

export interface PlanAgent {
  userId: string;
  name: string;
}

export interface PlanOptions {
  /**
   * 'luecken' rührt nur an, was noch leer ist — der Normalfall, wenn der Chef
   * schon Hand angelegt hat. 'neu' verteilt Früh/Spät/frei im Zeitraum
   * komplett neu; Abwesenheiten bleiben auch dann stehen.
   */
  mode: 'luecken' | 'neu';
  /** Arbeitstage je Person und Kalenderwoche. */
  maxDaysPerWeek: number;
  /** Kampagnen mitverteilen (nach Schulungsstand) oder Zellen ohne lassen. */
  assignCampaigns: boolean;
  /**
   * Nicht eingeteilte Tage ausdrücklich als „frei" eintragen. Ein leerer Tag
   * heißt „noch nicht geplant", ein „frei" heißt „geplant frei" — der
   * Unterschied ist genau das, was das Team wissen will.
   */
  fillFree: boolean;
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  mode: 'luecken',
  maxDaysPerWeek: 5,
  assignCampaigns: true,
  fillFree: true,
};

export interface PlanInput {
  /** Tagesschlüssel des Zeitraums, lückenlos und aufsteigend. */
  days: string[];
  agents: PlanAgent[];
  /** Was im Zeitraum schon im Plan steht. */
  existing: Shift[];
  targets: StaffingTarget[];
  /** Nur aktive Kampagnen — inaktive will niemand neu zugeteilt bekommen. */
  campaigns: Campaign[];
  competencies: AgentCompetency[];
  /**
   * Zellen, die unangetastet bleiben müssen, als `userId|dateKey`. Gedacht für
   * offene Tauschanfragen: über die Schicht verhandeln gerade zwei Leute, da
   * hat ein Automat nichts zu suchen.
   */
  locked?: Set<string>;
  options: PlanOptions;
}

// ── Ergebnis ────────────────────────────────────────────────────────────────

export interface PlanCell {
  userId: string;
  dateKey: string;
  /** null = Zelle leeren (nur ohne „freie Tage eintragen" möglich). */
  shiftType: ShiftType | null;
  campaignId?: string;
}

export interface PlanGap {
  dateKey: string;
  shiftType: 'frueh' | 'spaet';
  /** Wie viele Personen zum Sollwert fehlen. */
  missing: number;
  /** Klartext, warum — die Zahl allein hilft beim Gegensteuern nicht. */
  reason: string;
}

export interface PlanDay {
  dateKey: string;
  needFrueh: number;
  needSpaet: number;
  /** Besetzung nach dem Vorschlag, feste Zellen eingerechnet. */
  frueh: number;
  spaet: number;
  /** Abwesende des Tages (Urlaub/Krank/Schulung) — erklärt dünne Tage. */
  absent: number;
}

export interface PlanAgentSummary {
  userId: string;
  name: string;
  workDays: number;
  frueh: number;
  spaet: number;
}

export interface PlanResult {
  /** Der vollständige Vorschlag für alle nicht festen Zellen. */
  cells: PlanCell[];
  /** Davon die, die tatsächlich geschrieben werden müssen. */
  changes: PlanCell[];
  /** Zellen, die der Planer bewusst in Ruhe gelassen hat. */
  kept: number;
  days: PlanDay[];
  agents: PlanAgentSummary[];
  gaps: PlanGap[];
  /** Was der Chef wissen sollte, bevor er übernimmt. */
  warnings: string[];
}

// ── Regeln, die nicht zur Disposition stehen ────────────────────────────────

/**
 * Mehr als sechs Arbeitstage am Stück gibt es nicht — unabhängig vom
 * Wochenpensum, denn über eine Wochengrenze hinweg merkt das Pensum die Serie
 * nicht (Mo–Fr in der einen, Sa–So in der nächsten Woche wären zwei Mal „im
 * Rahmen" und zusammen neun Tage am Stück).
 */
const MAX_CONSECUTIVE = 6;

const cellKey = (userId: string, day: string): string => `${userId}|${day}`;

/** Montag der Kalenderwoche als Schlüssel — Bezug für das Wochenpensum. */
const weekKeyOf = (day: string): string => {
  const d = parseLocalDate(day);
  d.setDate(d.getDate() - (isoWeekday(d) - 1));
  return dateKey(d);
};

/**
 * Was darf diese Person mit dieser Kampagne?
 *
 *   'solo'      fährt sie selbstständig (einsatzbereit oder Trainer:in)
 *   'begleitet' nur mit erfahrener Begleitung am selben Tag (Einarbeitung)
 *   'nein'      nicht geschult
 *
 * 'other' ist wie in isQualified() ausgenommen: eine Kampagne ohne eigenen
 * Leitfaden hat auch keine eigene Schulung.
 */
type Fit = 'solo' | 'begleitet' | 'nein';

function fitFor(index: CompetencyIndex, userId: string, callType: CampaignCallType): Fit {
  if (callType === 'other') return 'solo';
  const def = levelDef(competencyOf(index, userId, callType)?.level);
  if (!def || !def.assignable) return 'nein';
  return def.needsSupervision ? 'begleitet' : 'solo';
}

/** Schulungsstand auf einer überholten Leitfaden-Fassung? Fehlende Angabe zählt nicht. */
function isOutdated(index: CompetencyIndex, userId: string, callType: CampaignCallType): boolean {
  const row = competencyOf(index, userId, callType);
  if (!row?.guideVersion) return false;
  const current = campaignFor(callType)?.version;
  return Boolean(current) && row.guideVersion !== current;
}

// ── Laufender Zustand je Person ─────────────────────────────────────────────

interface AgentState {
  total: number;
  frueh: number;
  spaet: number;
  perWeek: Map<string, number>;
  /** Letzter Arbeitstag im Zeitraum — Grundlage für Serie und Schichtwechsel. */
  lastWorkDay: string | null;
  lastType: 'frueh' | 'spaet' | null;
  /** Aufeinanderfolgende Arbeitstage bis einschließlich lastWorkDay. */
  streak: number;
  /** Zuletzt gefahrene Kampagne — für Kontinuität statt täglichem Wechsel. */
  lastCampaignId: string | null;
}

const freshState = (): AgentState => ({
  total: 0,
  frueh: 0,
  spaet: 0,
  perWeek: new Map(),
  lastWorkDay: null,
  lastType: null,
  streak: 0,
  lastCampaignId: null,
});

const noteWork = (
  st: AgentState,
  day: string,
  prevDay: string | null,
  type: 'frueh' | 'spaet',
  campaignId?: string,
) => {
  const wk = weekKeyOf(day);
  st.total += 1;
  st[type] += 1;
  st.perWeek.set(wk, (st.perWeek.get(wk) ?? 0) + 1);
  st.streak = st.lastWorkDay && st.lastWorkDay === prevDay ? st.streak + 1 : 1;
  st.lastWorkDay = day;
  st.lastType = type;
  if (campaignId) st.lastCampaignId = campaignId;
};

// ── Der Planer ──────────────────────────────────────────────────────────────

export function planShifts(input: PlanInput): PlanResult {
  const { days, agents, campaigns, options } = input;
  const locked = input.locked ?? new Set<string>();
  const index = indexCompetencies(input.competencies);

  const targetByWeekday = new Map(input.targets.map((t) => [t.weekday, t]));
  const existingBy = new Map<string, Shift>();
  for (const s of input.existing) existingBy.set(cellKey(s.userId, s.shiftDate), s);

  const state = new Map<string, AgentState>(agents.map((a) => [a.userId, freshState()]));
  const stateOf = (userId: string): AgentState => {
    // Anlegen statt nur zurückgeben: ein weggeworfener Zustand würde alle
    // Zählungen für diese Person still verschlucken.
    let st = state.get(userId);
    if (!st) state.set(userId, (st = freshState()));
    return st;
  };

  /**
   * Feste Zellen: Abwesenheiten und laufende Tauschanfragen immer, im Modus
   * „nur Lücken füllen" zusätzlich alles, was schon dasteht.
   */
  const isFixed = (userId: string, day: string): boolean => {
    if (locked.has(cellKey(userId, day))) return true;
    const ex = existingBy.get(cellKey(userId, day));
    if (!ex) return false;
    if (SHIFT_META[ex.shiftType]?.absence) return true;
    return options.mode === 'luecken';
  };

  const planned = new Map<string, PlanCell>();
  const gaps: PlanGap[] = [];
  const planDays: PlanDay[] = [];
  let kept = 0;
  let withoutCampaign = 0;
  /** Kampagnen-Id → an wie vielen Arbeitstagen sie niemand fährt. */
  const uncoveredDays = new Map<string, number>();
  /** Tage, an denen überhaupt jemand arbeitet — Bezug für die Zeile darüber. */
  let workingDays = 0;

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const prevDay = i > 0 ? days[i - 1] : null;
    const target = targetByWeekday.get(isoWeekday(parseLocalDate(day)));
    let needFrueh = target?.minFrueh ?? 0;
    let needSpaet = target?.minSpaet ?? 0;

    // 1. Feste Zellen des Tages einrechnen — sie zählen auf die Soll-Besetzung
    //    und auf das Pensum der Person, sonst plant der Automat an einem
    //    bereits vollen Tag munter weiter.
    let absent = 0;
    let frueh = 0;
    let spaet = 0;
    /**
     * Kampagnentypen, die an diesem Tag tatsächlich jemand selbstständig fährt
     * — die Menge, an der die Begleitung für „in Einarbeitung" hängt. Sie wächst
     * erst, wenn eine Kampagne wirklich zugeteilt ist; „könnte sie fahren"
     * genügt hier ausdrücklich nicht, sonst stünde am Ende jemand in
     * Einarbeitung allein auf einer Kampagne, deren möglicher Begleiter an dem
     * Tag etwas anderes macht.
     */
    const soloTypes = new Set<CampaignCallType>();
    const coveredCampaigns = new Set<string>();
    const openSlots: { userId: string; type: 'frueh' | 'spaet' }[] = [];

    for (const a of agents) {
      if (!isFixed(a.userId, day)) continue;
      kept += 1;
      const ex = existingBy.get(cellKey(a.userId, day));
      if (!ex) continue;
      if (SHIFT_META[ex.shiftType]?.absence) absent += 1;
      if (ex.shiftType !== 'frueh' && ex.shiftType !== 'spaet') continue;

      noteWork(stateOf(a.userId), day, prevDay, ex.shiftType, ex.campaignId);
      if (ex.shiftType === 'frueh') {
        frueh += 1;
        needFrueh = Math.max(0, needFrueh - 1);
      } else {
        spaet += 1;
        needSpaet = Math.max(0, needSpaet - 1);
      }
      const type = ex.campaignId ? campaigns.find((c) => c.id === ex.campaignId)?.callType : undefined;
      if (ex.campaignId) coveredCampaigns.add(ex.campaignId);
      if (type && fitFor(index, a.userId, type) === 'solo') soloTypes.add(type);
    }

    // 2. Wer kommt an diesem Tag überhaupt infrage?
    let blockedWeek = 0;
    let blockedStreak = 0;
    const candidates = agents.filter((a) => {
      if (isFixed(a.userId, day)) return false;
      const st = stateOf(a.userId);
      if ((st.perWeek.get(weekKeyOf(day)) ?? 0) >= options.maxDaysPerWeek) {
        blockedWeek += 1;
        return false;
      }
      if (st.lastWorkDay === prevDay && st.streak >= MAX_CONSECUTIVE) {
        blockedStreak += 1;
        return false;
      }
      return true;
    });

    // 3. Plätze verteilen. Früh und Spät im Wechsel, damit nicht eine Schicht
    //    systematisch die ausgeruhteren Leute abbekommt und die andere den Rest.
    const slots: ('frueh' | 'spaet')[] = [];
    for (let n = 0; n < Math.max(needFrueh, needSpaet); n++) {
      if (n < needFrueh) slots.push('frueh');
      if (n < needSpaet) slots.push('spaet');
    }

    const takenToday = new Set<string>();
    const missing = { frueh: 0, spaet: 0 };
    /**
     * Wovon die Tagesmannschaft etwas versteht — nur für die Auswahl der
     * Personen. Bewusst getrennt von soloTypes: hier geht es um die Frage
     * „bekommen wir die Kampagne heute überhaupt besetzt?", dort um „sitzt
     * jemand daneben?".
     */
    const coverable = new Set(soloTypes);

    for (const type of slots) {
      const pool = candidates.filter((a) => !takenToday.has(a.userId));
      if (pool.length === 0) {
        missing[type] += 1;
        continue;
      }

      let best = pool[0];
      let bestScore = Infinity;
      for (const a of pool) {
        const st = stateOf(a.userId);
        // Kleiner Wert = besser geeignet. Die Gewichte sind so gewählt, dass
        // der Gesamtausgleich über den Zeitraum schwerer wiegt als jede
        // Feinheit — Gerechtigkeit ist das, was am Plan zuerst nachgezählt wird.
        let score = st.total * 10 + (st.perWeek.get(weekKeyOf(day)) ?? 0) * 6;
        // Früh/Spät innerhalb der Person ausgleichen.
        score += (type === 'frueh' ? st.frueh : st.spaet) * 3;
        if (st.lastWorkDay === prevDay) {
          // Blöcke statt Einzeltage, aber kein Schichtwechsel von einem Tag auf
          // den nächsten, wenn es sich vermeiden lässt.
          score -= 1;
          if (st.lastType && st.lastType !== type) score += 4;
        }
        // Wer eine sonst unbesetzte Kampagne fahren kann, hat Vorrang: ein voll
        // besetzter Tag, an dem niemand die Bauverweigerer-Fälle machen darf,
        // ist kein besetzter Tag.
        //
        // Der Bonus ist bewusst kleiner als ein Arbeitstag Unterschied (10) und
        // zählt nur einmal, egal für wie viele Kampagnen jemand infrage kommt:
        // sonst räumt die eine Person, die alles kann, die halbe Woche ab —
        // fahren kann sie an einem Tag ohnehin nur eine Kampagne. Abdeckung
        // entscheidet also unter Gleichbelasteten, nicht gegen die Verteilung.
        if (options.assignCampaigns) {
          const rescues = campaigns.some(
            (c) => !coverable.has(c.callType) && fitFor(index, a.userId, c.callType) === 'solo',
          );
          if (rescues) score -= 8;
        }
        // Gleichstand deterministisch auflösen (siehe Kopfkommentar).
        if (score < bestScore || (score === bestScore && a.userId < best.userId)) {
          best = a;
          bestScore = score;
        }
      }

      takenToday.add(best.userId);
      openSlots.push({ userId: best.userId, type });
      noteWork(stateOf(best.userId), day, prevDay, type);
      if (type === 'frueh') frueh += 1;
      else spaet += 1;
      for (const c of campaigns) {
        if (fitFor(index, best.userId, c.callType) === 'solo') coverable.add(c.callType);
      }
    }

    // 4. Lücken benennen, statt sie nur zu zählen.
    for (const type of ['frueh', 'spaet'] as const) {
      if (missing[type] === 0) continue;
      const reason =
        candidates.length === 0 && blockedWeek + blockedStreak === 0
          ? 'Alle verfügbaren Personen sind abwesend oder schon eingeteilt.'
          : blockedWeek > 0
            ? `${blockedWeek} Person(en) haben ihr Wochenpensum von ${options.maxDaysPerWeek} Tagen erreicht.`
            : blockedStreak > 0
              ? `${blockedStreak} Person(en) hätten mehr als ${MAX_CONSECUTIVE} Tage am Stück.`
              : 'Zu wenige Mitarbeitende für die Soll-Besetzung.';
      gaps.push({ dateKey: day, shiftType: type, missing: missing[type], reason });
    }

    // 5. Kampagnen auf die neu vergebenen Plätze verteilen.
    const campaignOf = options.assignCampaigns
      ? assignCampaignsForDay(openSlots, campaigns, coveredCampaigns, soloTypes, index, stateOf, i)
      : new Map<string, string>();

    for (const slot of openSlots) {
      const campaignId = campaignOf.get(slot.userId);
      if (options.assignCampaigns && !campaignId) withoutCampaign += 1;
      if (campaignId) {
        stateOf(slot.userId).lastCampaignId = campaignId;
        coveredCampaigns.add(campaignId);
      }
      planned.set(cellKey(slot.userId, day), {
        userId: slot.userId,
        dateKey: day,
        shiftType: slot.type,
        campaignId,
      });
    }

    // An einem Tag, an dem überhaupt jemand arbeitet, sollte jede Kampagne
    // laufen. Wo das nicht aufgeht, ist das eine Aussage über den Plan — und
    // nicht dasselbe wie „niemand ist dafür geschult" (siehe buildWarnings).
    if (frueh + spaet > 0) {
      workingDays += 1;
      for (const c of campaigns) {
        if (!coveredCampaigns.has(c.id)) uncoveredDays.set(c.id, (uncoveredDays.get(c.id) ?? 0) + 1);
      }
    }

    // 6. Alle übrigen offenen Zellen: geplant frei — oder leeren, wenn der Chef
    //    lieber leere Zellen sieht (dann muss eine alte Schicht aber weg, sonst
    //    stünde nach „neu planen" eine Zuteilung da, die der Vorschlag nicht kennt).
    for (const a of agents) {
      const key = cellKey(a.userId, day);
      if (isFixed(a.userId, day) || planned.has(key)) continue;
      planned.set(key, {
        userId: a.userId,
        dateKey: day,
        shiftType: options.fillFree ? 'frei' : null,
      });
    }

    planDays.push({
      dateKey: day,
      needFrueh: target?.minFrueh ?? 0,
      needSpaet: target?.minSpaet ?? 0,
      frueh,
      spaet,
      absent,
    });
  }

  // ── Was davon muss wirklich geschrieben werden? ───────────────────────────
  const cells = Array.from(planned.values());
  const changes = cells.filter((c) => {
    const ex = existingBy.get(cellKey(c.userId, c.dateKey));
    if (c.shiftType === null) return Boolean(ex);
    if (!ex) return true;
    return ex.shiftType !== c.shiftType || (ex.campaignId ?? '') !== (c.campaignId ?? '');
  });

  return {
    cells,
    changes,
    kept,
    days: planDays,
    agents: agents.map((a) => {
      const st = stateOf(a.userId);
      return { userId: a.userId, name: a.name, workDays: st.total, frueh: st.frueh, spaet: st.spaet };
    }),
    gaps,
    warnings: buildWarnings(input, index, gaps, withoutCampaign, uncoveredDays, workingDays),
  };
}

/**
 * Kampagnen eines Tages verteilen.
 *
 * Zuerst bekommt jede noch unbesetzte Kampagne jemanden, der sie selbstständig
 * fahren kann — eine Kampagne, die an einem Tag gar nicht läuft, ist der
 * teurere Fehler als eine, die doppelt besetzt ist. Danach bekommt der Rest die
 * Kampagne, die am besten passt: bevorzugt die von gestern (Kontinuität schlägt
 * tägliches Umlernen), sonst die am dünnsten besetzte.
 *
 * „In Einarbeitung" kommt zuletzt und nur, wenn an dem Tag jemand Erfahrenes
 * auf derselben Kampagne steht — genau die Prüfung, die checkShift() sonst als
 * Warnung im Plan zeigen würde. Der Planer soll keine Warnungen erzeugen, die
 * er selbst verhindern kann.
 */
function assignCampaignsForDay(
  slots: { userId: string; type: 'frueh' | 'spaet' }[],
  campaigns: Campaign[],
  coveredCampaigns: Set<string>,
  soloTypes: Set<CampaignCallType>,
  index: CompetencyIndex,
  stateOf: (userId: string) => AgentState,
  /** Laufender Tagesindex — dreht die Reihenfolge der Kampagnen weiter. */
  rotation: number,
): Map<string, string> {
  const result = new Map<string, string>();
  const open = new Set(slots.map((s) => s.userId));
  /** Wie viele fahren diese Kampagne heute schon — für die Streuung. */
  const load = new Map<string, number>();
  for (const id of coveredCampaigns) load.set(id, (load.get(id) ?? 0) + 1);

  const take = (userId: string, campaign: Campaign) => {
    result.set(userId, campaign.id);
    open.delete(userId);
    load.set(campaign.id, (load.get(campaign.id) ?? 0) + 1);
    soloTypes.add(campaign.callType);
  };

  // Runde 1: unbesetzte Kampagnen zuerst. Die Reihenfolge wandert von Tag zu
  // Tag weiter — bei mehr Kampagnen als Plätzen kämen sonst immer dieselben
  // dran und die hinteren nie, allein weil sie in der Liste weiter unten stehen.
  const start = campaigns.length > 0 ? rotation % campaigns.length : 0;
  const rotated = [...campaigns.slice(start), ...campaigns.slice(0, start)];
  for (const c of rotated) {
    if (coveredCampaigns.has(c.id)) continue;
    const pool = Array.from(open).filter((u) => fitFor(index, u, c.callType) === 'solo');
    if (pool.length === 0) continue;
    pool.sort((a, b) => {
      // Wer die Kampagne zuletzt gefahren hat, macht weiter; danach zählt der
      // aktuelle Schulungsstand, zuletzt die Id für einen stabilen Gleichstand.
      const cont = Number(stateOf(b).lastCampaignId === c.id) - Number(stateOf(a).lastCampaignId === c.id);
      if (cont !== 0) return cont;
      const old = Number(isOutdated(index, a, c.callType)) - Number(isOutdated(index, b, c.callType));
      if (old !== 0) return old;
      return a < b ? -1 : 1;
    });
    take(pool[0], c);
  }

  // Runde 2: der Rest — erst die Selbstständigen, dann die Einarbeitung, weil
  // deren Zuteilung davon abhängt, wer vorher wo gelandet ist.
  for (const wanted of ['solo', 'begleitet'] as const) {
    for (const userId of Array.from(open).sort()) {
      const options = campaigns
        .filter((c) => fitFor(index, userId, c.callType) === wanted)
        // Einarbeitung nur dort, wo an diesem Tag jemand Erfahrenes danebensitzt.
        .filter((c) => wanted === 'solo' || soloTypes.has(c.callType));
      if (options.length === 0) continue;
      options.sort((a, b) => {
        const cont =
          Number(stateOf(userId).lastCampaignId === b.id) -
          Number(stateOf(userId).lastCampaignId === a.id);
        if (cont !== 0) return cont;
        const spread = (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0);
        if (spread !== 0) return spread;
        return a.id < b.id ? -1 : 1;
      });
      take(userId, options[0]);
    }
  }

  return result;
}

/** Was der Chef vor dem Übernehmen wissen sollte. */
function buildWarnings(
  input: PlanInput,
  index: CompetencyIndex,
  gaps: PlanGap[],
  withoutCampaign: number,
  uncoveredDays: Map<string, number>,
  workingDays: number,
): string[] {
  const warnings: string[] = [];
  const neverPlanned: string[] = [];

  const hasTarget = input.targets.some((t) => t.minFrueh > 0 || t.minSpaet > 0);
  if (!hasTarget) {
    warnings.push(
      'Es ist keine Soll-Besetzung hinterlegt — ohne Vorgabe teilt der Planer niemanden ein.',
    );
  }

  if (input.options.assignCampaigns) {
    for (const c of input.campaigns) {
      const solo = input.agents.filter((a) => fitFor(index, a.userId, c.callType) === 'solo');
      if (solo.length === 0) {
        warnings.push(`„${c.name}": niemand ist einsatzbereit — die Kampagne bleibt unbesetzt.`);
        continue;
      }
      // Dass eine Kampagne nicht jeden Tag läuft, ist bei mehr Kampagnen als
      // Plätzen normal und keine Meldung wert. Dass sie im ganzen Zeitraum kein
      // einziges Mal vorkommt, schon: dann ist der Plan für sie schlicht blind.
      if (workingDays > 0 && (uncoveredDays.get(c.id) ?? 0) >= workingDays) {
        neverPlanned.push(c.name);
      }
    }
    if (neverPlanned.length > 0) {
      warnings.push(
        `Im ganzen Zeitraum nicht eingeteilt: ${neverPlanned.map((n) => `„${n}"`).join(', ')} — dafür reichen die Plätze nicht.`,
      );
    }
    if (withoutCampaign > 0) {
      warnings.push(
        `${withoutCampaign} Schicht(en) bleiben ohne Kampagne — für die Betroffenen ist keine passende Schulung hinterlegt.`,
      );
    }
  }

  const missing = gaps.reduce((sum, g) => sum + g.missing, 0);
  if (missing > 0) {
    warnings.push(`${missing} Platz/Plätze der Soll-Besetzung bleiben offen (siehe Lückenliste).`);
  }

  return warnings;
}
