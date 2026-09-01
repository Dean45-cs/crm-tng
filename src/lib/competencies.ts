import type {
  AgentCompetency,
  Campaign,
  CampaignCallType,
  CompetencyLevel,
  Shift,
} from '../types';
import { isWorking } from './shifts';
import { campaignFor, campaignsShared, type CatalogEntry } from './campaigns';

/**
 * Wer darf welche Kampagne fahren — und was heißt das für den Schichtplan.
 *
 * Der Schichtplan teilt Kampagnen zu (Migration 019/020), wusste aber bis
 * Migration 030 nicht, wem er welche zutrauen darf. Jede der sechs Kampagnen
 * hat eine eigene Schulungsunterlage; wer den Dubletten-Check kann, kennt
 * deshalb noch lange nicht den Bauverweigerer-Prozess mit § 156 TKG und dem
 * Schadenersatz-Hinweis.
 *
 * Die Stufen selbst stehen im geteilten Katalog (extension/src/campaigns.js),
 * damit auch das Cockpit sie kennt. Hier steht, was das für einen konkreten
 * Plan bedeutet.
 */

export interface CompetencyLevelDef extends CatalogEntry {
  id: CompetencyLevel;
  short: string;
  rank: number;
  assignable: boolean;
  needsSupervision: boolean;
  canTrain: boolean;
}

export interface CompetencyIssue {
  id: 'nicht-geschult' | 'ohne-begleitung' | 'veraltete-schulung';
  severity: 'block' | 'warn';
  label: string;
  hint: string;
}

export const COMPETENCY_LEVELS = campaignsShared.COMPETENCY_LEVELS as CompetencyLevelDef[];
export const COMPETENCY_ISSUES = campaignsShared.COMPETENCY_ISSUES as CompetencyIssue[];

/** Stufe nachschlagen. null = keine Kompetenz hinterlegt. */
export function levelDef(level: CompetencyLevel | null | undefined): CompetencyLevelDef | null {
  return COMPETENCY_LEVELS.find((l) => l.id === level) ?? null;
}

/**
 * Nachschlagetabelle über alle Kompetenzen. Der Schichtplan fragt sie je Zelle
 * ab — bei 11 Personen × 31 Tagen wäre ein `find()` über das flache Array
 * spürbar.
 */
export type CompetencyIndex = Map<string, AgentCompetency>;

export const competencyKey = (userId: string, callType: CampaignCallType): string =>
  `${userId}|${callType}`;

export function indexCompetencies(rows: AgentCompetency[]): CompetencyIndex {
  const map: CompetencyIndex = new Map();
  for (const row of rows) map.set(competencyKey(row.userId, row.callType), row);
  return map;
}

export function competencyOf(
  index: CompetencyIndex,
  userId: string,
  callType: CampaignCallType | undefined,
): AgentCompetency | null {
  if (!callType) return null;
  return index.get(competencyKey(userId, callType)) ?? null;
}

/** Darf diese Person die Kampagne fahren? Ohne Eintrag: nein. */
export function isQualified(
  index: CompetencyIndex,
  userId: string,
  callType: CampaignCallType | undefined,
): boolean {
  return campaignsShared.isQualified(callType, competencyOf(index, userId, callType)?.level);
}

/**
 * Wer kann an diesem Tag begleiten?
 *
 * „In Einarbeitung" verlangt jemand Erfahrenes in derselben Schicht — und zwar
 * für dieselbe Kampagne, nicht irgendwen. Eine Trainerin für Welcome Calls
 * hilft beim Bauverweigerer-Gespräch nicht weiter.
 *
 * Bewusst der ganze Tag statt exakt überlappender Schichtzeiten: Früh und Spät
 * überschneiden sich fast vollständig (07:45–16:15 / 08:45–17:15), eine
 * minutengenaue Prüfung träfe hier keine andere Aussage und wäre nur schwerer
 * zu erklären.
 */
export function hasSupervisorForDay(
  shiftsOfDay: Shift[],
  index: CompetencyIndex,
  callType: CampaignCallType | undefined,
  campaignTypeOf: (campaignId: string | undefined) => CampaignCallType | undefined,
  exceptUserId?: string,
): boolean {
  if (!callType) return false;
  return shiftsOfDay.some((s) => {
    if (s.userId === exceptUserId) return false;
    if (!isWorking(s.shiftType)) return false;
    if (campaignTypeOf(s.campaignId) !== callType) return false;
    const level = levelDef(competencyOf(index, s.userId, callType)?.level);
    // Trainer:innen zählen ausdrücklich als Begleitung, Einsatzbereite auch —
    // wer die Kampagne selbstständig fährt, kann daneben sitzen. Nur wer selbst
    // in Einarbeitung ist, kann niemanden anleiten.
    return Boolean(level && !level.needsSupervision);
  });
}

export interface ShiftCompetencyCheck {
  issues: CompetencyIssue[];
  severity: 'block' | 'warn' | null;
}

const OK: ShiftCompetencyCheck = { issues: [], severity: null };

/**
 * Prüft eine einzelne Zuteilung im Plan.
 *
 * Ohne Kampagne oder an einem Nicht-Arbeitstag gibt es nichts zu prüfen — eine
 * Urlaubszelle soll nicht warnen, nur weil die Person für nichts geschult ist.
 */
export function checkShift(
  shift: Pick<Shift, 'userId' | 'shiftType' | 'campaignId'>,
  shiftsOfSameDay: Shift[],
  index: CompetencyIndex,
  campaignTypeOf: (campaignId: string | undefined) => CampaignCallType | undefined,
): ShiftCompetencyCheck {
  if (!isWorking(shift.shiftType) || !shift.campaignId) return OK;
  const callType = campaignTypeOf(shift.campaignId);
  if (!callType) return OK;

  const competency = competencyOf(index, shift.userId, callType);
  const issues = campaignsShared.competencyIssues(callType, competency, {
    hasSupervisor: hasSupervisorForDay(
      shiftsOfSameDay,
      index,
      callType,
      campaignTypeOf,
      shift.userId,
    ),
  }) as CompetencyIssue[];

  return issues.length === 0 ? OK : { issues, severity: campaignsShared.worstSeverity(issues) };
}

/**
 * Alle Beanstandungen eines Zeitraums, als Map `userId|dateKey`.
 *
 * Ein Durchgang statt einer Prüfung je Zelle: `hasSupervisorForDay` sieht sich
 * die Schichten des Tages an, und die je Zelle neu zu filtern hieße bei einer
 * Monatsansicht mit 11 Personen rund 340 Filterläufe über dieselbe Liste.
 */
export function checkPlan(
  shifts: Shift[],
  index: CompetencyIndex,
  campaigns: Campaign[],
): Map<string, ShiftCompetencyCheck> {
  const typeById = new Map(campaigns.map((c) => [c.id, c.callType]));
  const campaignTypeOf = (id: string | undefined) => (id ? typeById.get(id) : undefined);

  const byDay = new Map<string, Shift[]>();
  for (const s of shifts) {
    const list = byDay.get(s.shiftDate);
    if (list) list.push(s);
    else byDay.set(s.shiftDate, [s]);
  }

  const result = new Map<string, ShiftCompetencyCheck>();
  for (const [dateKey, ofDay] of byDay) {
    for (const s of ofDay) {
      const check = checkShift(s, ofDay, index, campaignTypeOf);
      if (check.severity) result.set(`${s.userId}|${dateKey}`, check);
    }
  }
  return result;
}

export interface CampaignReadiness {
  callType: CampaignCallType;
  title: string;
  /** Personen, die die Kampagne selbstständig fahren können. */
  ready: number;
  /** Personen in Einarbeitung. */
  inTraining: number;
  /** Personen, die andere einarbeiten können. */
  trainers: number;
  /**
   * true, wenn niemand die Kampagne selbstständig fahren kann. Das ist die
   * eigentlich interessante Zahl: eine Kampagne ohne einsatzbereite Person ist
   * nicht planbar, egal wie viele in Einarbeitung sind.
   */
  uncovered: boolean;
}

/**
 * Wie gut ist jede Kampagne im Team abgedeckt? Grundlage für die Frage, wo als
 * Nächstes geschult werden muss — und dafür, ob ein Ausfall die Kampagne
 * lahmlegt.
 */
export function campaignReadiness(
  rows: AgentCompetency[],
  activeUserIds: Set<string>,
): CampaignReadiness[] {
  return campaignsShared.CAMPAIGN_ORDER.map((callType) => {
    const forType = rows.filter((r) => r.callType === callType && activeUserIds.has(r.userId));
    const ready = forType.filter((r) => !levelDef(r.level)?.needsSupervision).length;
    return {
      callType,
      title: campaignFor(callType).title,
      ready,
      inTraining: forType.filter((r) => levelDef(r.level)?.needsSupervision).length,
      trainers: forType.filter((r) => levelDef(r.level)?.canTrain).length,
      uncovered: ready === 0,
    };
  });
}

/**
 * Kampagnen, die diese Person fahren darf — für die Auswahl im Plan.
 * `includeUnqualified` behält die übrigen mit einem Vermerk in der Liste: der
 * Chef darf bewusst abweichen (siehe Migration 030, „Warum kein Constraint"),
 * soll es aber sehen.
 */
export function campaignsForUser(
  campaigns: Campaign[],
  index: CompetencyIndex,
  userId: string,
): { campaign: Campaign; level: CompetencyLevelDef | null; qualified: boolean }[] {
  return campaigns.map((campaign) => {
    const level = levelDef(competencyOf(index, userId, campaign.callType)?.level);
    return {
      campaign,
      level,
      qualified: campaignsShared.isQualified(campaign.callType, level?.id),
    };
  });
}
