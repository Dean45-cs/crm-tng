import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Copy,
  Sun,
  Moon,
  Ban,
  Eraser,
  MousePointerClick,
  ArrowLeftRight,
  Palmtree,
  Thermometer,
  GraduationCap,
  SlidersHorizontal,
  User,
  Users,
  AlertTriangle,
  Phone,
  FileSignature,
} from 'lucide-react';
import { useRouter } from '../router';
import { useAuth } from '../store/useAuth';
import { useStore } from '../store/useStore';
import { useShifts } from '../store/useShifts';
import { useSwaps, swapForCell } from '../store/useSwaps';
import { notify } from '../store/useNotifications';
import {
  fetchShiftsForWeek,
  upsertShift,
  deleteShiftRow,
  fetchCallsBetween,
  upsertStaffingTarget,
} from '../lib/supabaseApi';
import {
  weekStart,
  weekLabel,
  formatDateObj,
  parseLocalDate,
  initialsOf,
  dateKey,
  calcContractCommission,
} from '../lib/utils';
import { shortDay, shiftLabel, swapSummary, SWAP_STATUS_LABEL } from '../lib/notifications';
import {
  SHIFT_META,
  SHIFT_ORDER,
  DAY_WINDOW,
  shiftMeta,
  shiftTimeLabel,
  formatMinutes,
  dayCoverage,
  isoWeekday,
  outcomeIndex,
  outcomeKey,
  type ShiftOutcome,
  type DayCoverage,
} from '../lib/shifts';
import { campaignFor } from '../lib/campaigns';
import {
  campaignsForUser,
  checkPlan,
  indexCompetencies,
  type CompetencyIndex,
  type ShiftCompetencyCheck,
} from '../lib/competencies';
import { toast } from '../store/useToast';
import { SkeletonTable } from '../components/Skeleton';
import { Modal } from '../components/Modal';
import { SwapActions } from '../components/SwapActions';
import type { Call, Campaign, Shift, ShiftType, ShiftSwapRequest, StaffingTarget } from '../types';

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** Das aktive Werkzeug. 'edit' = Klick öffnet das Detail-Formular; eine
 *  Schichtart oder 'clear' = „malen" (Klick/Ziehen setzt bzw. löscht direkt). */
type Tool = 'edit' | ShiftType | 'clear';

const TOOL_ICON: Record<Exclude<Tool, 'edit'>, React.ReactNode> = {
  frueh: <Sun size={14} />,
  spaet: <Moon size={14} />,
  frei: <Ban size={14} />,
  urlaub: <Palmtree size={14} />,
  krank: <Thermometer size={14} />,
  schulung: <GraduationCap size={14} />,
  clear: <Eraser size={14} />,
};

// Stabile Farbpalette für Kampagnen-Punkte in Zellen & Legende.
const CAMPAIGN_COLORS = ['#0088b8', '#7c5cf0', '#e8a33d', '#34a56f', '#e5657f', '#4a90d9', '#c77dff', '#d98324'];

type ViewMode = 'woche' | 'monat';

function weekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });
}

/** Alle Tage des Monats, in dem `ref` liegt. */
function monthDays(ref: Date): Date[] {
  const first = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const count = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(first);
    d.setDate(d.getDate() + i);
    return d;
  });
}

const monthTitle = (d: Date): string =>
  d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

/** „17.06." — kurz genug für eine Tages-Spaltenüberschrift. */
const shortDate = (d: Date): string =>
  `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;

interface EditTarget {
  userId: string;
  userName: string;
  dateKey: string;
  dateLabel: string;
  existing?: Shift;
}

/** Eine zu schreibende Zelle: `clear` löscht, sonst setzt sie Schicht + Kampagne. */
interface CellOp {
  userId: string;
  dateKey: string;
  clear?: boolean;
  shiftType?: ShiftType;
  campaignId?: string;
}

/**
 * Geteilter Schichtplan: alle aktiven Nutzer sehen den kompletten Plan (RLS
 * erlaubt read-all, siehe db/migrations/020_shifts.sql). Nur Chefs bearbeiten.
 *
 * Bearbeiten geht auf zwei Wegen: „malen" (Werkzeug wählen, über Zellen ziehen
 * — auch ganze Zeilen/Spalten über die Kopfzellen) für schnelles Verteilen, und
 * das Detail-Formular pro Zelle für die Feinarbeit. Jede Mal-Aktion ist als
 * Ganzes rückgängig zu machen: Zeilen zu füllen heißt sieben Zellen auf einmal
 * zu überschreiben, und ein Fehlgriff darf nicht bedeuten, dass man den alten
 * Stand aus dem Kopf rekonstruieren muss.
 *
 * Der Plan bleibt Chef-Sache, der Anstoß kommt aber aus dem Team: über
 * „Schicht tauschen" fragt eine Person eine andere, und erst die Bestätigung
 * durch den Chef verschiebt tatsächlich etwas (Migration 023). Zellen, für die
 * gerade eine Anfrage läuft, sind markiert — sonst verplant der Chef eine
 * Schicht, über die zwei Leute schon verhandeln.
 *
 * Der Plan ist außerdem der Ort, an dem sichtbar wird, was eine Schicht
 * gebracht hat: die Zellen zeigen Anrufe und Abschlüsse des Tages (siehe
 * outcomeIndex in src/lib/shifts.ts). Damit ist er nicht nur Einteilung,
 * sondern die Achse, an der Auswertung und Steuerung hängen.
 */
export function Schedule() {
  const { isManager, getCurrentUser } = useAuth();
  const { navigate } = useRouter();
  const users = useAuth((s) => s.users);
  const { campaigns, competencies, contracts, settings } = useStore();
  const manager = isManager();

  const swaps = useSwaps((s) => s.requests);
  const loadSwaps = useSwaps((s) => s.load);
  const [swapOpen, setSwapOpen] = useState(false);
  /** Vorbelegter eigener Tag, wenn der Dialog aus einer Zelle heraus aufgeht. */
  const [swapSeed, setSwapSeed] = useState<string | null>(null);

  // Schichten des angezeigten Fensters kommen aus dem geteilten Store, der per
  // Realtime live bleibt (crm-tng-shifts). Passt der geladene Bereich nicht zum
  // angezeigten, gilt er als „lädt noch" (shifts === null).
  const loadedRangeStart = useShifts((s) => s.rangeStart);
  const rows = useShifts((s) => s.rows);
  const loadRange = useShifts((s) => s.loadRange);
  const patchRows = useShifts((s) => s.patchRows);
  const setWriting = useShifts((s) => s.setWriting);
  const targets = useShifts((s) => s.targets);
  const loadTargets = useShifts((s) => s.loadTargets);

  const [refDate, setRefDate] = useState(() => weekStart());
  const [view, setView] = useState<ViewMode>('woche');
  const [onlyMine, setOnlyMine] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyAsk, setCopyAsk] = useState(false);
  const [targetsOpen, setTargetsOpen] = useState(false);

  // Werkzeugleiste (nur für Chefs relevant).
  const [tool, setTool] = useState<Tool>('edit');
  const [paintCampaignId, setPaintCampaignId] = useState('');

  const days = useMemo(
    () => (view === 'woche' ? weekDays(refDate) : monthDays(refDate)),
    [view, refDate],
  );
  const rangeStartKey = dateKey(days[0]);
  const rangeEndKey = dateKey(days[days.length - 1]);
  const todayKey = dateKey(new Date());

  const reload = (): Promise<Shift[]> => loadRange(rangeStartKey, rangeEndKey);

  useEffect(() => {
    loadRange(rangeStartKey, rangeEndKey);
  }, [rangeStartKey, rangeEndKey, loadRange]);

  // Offene Tauschanfragen sind nicht zeitraum-scoped (sie können über die
  // Wochengrenze gehen) — einmal laden reicht, live bleibt der Store selbst.
  useEffect(() => {
    loadSwaps();
    loadTargets();
  }, [loadSwaps, loadTargets]);

  // Anrufe des angezeigten Zeitraums für die Ergebnis-Anzeige in den Zellen.
  // Bewusst lokal geladen statt aus useMonthCalls: der Plan zeigt beliebige
  // Wochen und Monate, der app-weite Store hält nur den laufenden Monat — sonst
  // stünden beim Zurückblättern stillschweigend Nullen in den Zellen.
  const [calls, setCalls] = useState<Call[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchCallsBetween(`${rangeStartKey}T00:00:00.000Z`, `${rangeEndKey}T23:59:59.999Z`)
      .then((res) => {
        if (!cancelled) setCalls(res.calls);
      })
      .catch(() => {
        // Ohne Anrufdaten bleibt der Plan vollständig bedienbar — nur die
        // Ergebnisspalte ist dann leer. Kein Grund, die Seite scheitern zu lassen.
        if (!cancelled) setCalls([]);
      });
    return () => {
      cancelled = true;
    };
  }, [rangeStartKey, rangeEndKey]);

  const shifts = loadedRangeStart === rangeStartKey ? rows : null;

  const shiftFor = (userId: string, dk: string): Shift | undefined =>
    shifts?.find((s) => s.userId === userId && s.shiftDate === dk);

  const activeCampaigns = useMemo(() => campaigns.filter((c) => c.active), [campaigns]);

  // Kompetenz-Prüfung (Migration 030): welche Zuteilung im angezeigten Plan
  // passt nicht zum Schulungsstand? Einmal über den ganzen Zeitraum statt je
  // Zelle — die Begleitungs-Frage muss ohnehin den ganzen Tag ansehen.
  const competencyIndex = useMemo(() => indexCompetencies(competencies), [competencies]);
  const planIssues = useMemo(
    () => (shifts ? checkPlan(shifts, competencyIndex, campaigns) : new Map()),
    [shifts, competencyIndex, campaigns],
  );
  const campaignById = useMemo(() => new Map(campaigns.map((c) => [c.id, c])), [campaigns]);
  const campaignColor = (id?: string) => {
    if (!id) return undefined;
    const idx = campaigns.findIndex((c) => c.id === id);
    return idx >= 0 ? CAMPAIGN_COLORS[idx % CAMPAIGN_COLORS.length] : '#94a3b8';
  };

  const currentUser = getCurrentUser();

  const allAgents = useMemo(
    () =>
      Object.values(users)
        .filter((u) => u.isActive)
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de')),
    [users],
  );
  // „Nur meine" blendet Kolleg:innen aus, ohne den Plan selbst zu verändern —
  // gedacht fürs Handy und für den schnellen Blick auf die eigene Woche.
  const agentRows = useMemo(
    () => (onlyMine ? allAgents.filter((u) => u.key === currentUser?.key) : allAgents),
    [allAgents, onlyMine, currentUser?.key],
  );

  // Ergebnis je (Person, Tag): einmal über alle Anrufe und Verträge des
  // Zeitraums, statt je Zelle erneut zu filtern.
  const outcomes = useMemo(
    () => outcomeIndex(calls, contracts, (c) => (settings ? calcContractCommission(c, settings) : 0)),
    [calls, contracts, settings],
  );

  const targetByWeekday = useMemo(() => {
    const map = new Map<number, StaffingTarget>();
    for (const t of targets) map.set(t.weekday, t);
    return map;
  }, [targets]);

  // ---- Schreiben ---------------------------------------------------------
  // Optimistisch lokal aktualisieren, dann persistieren, dann einmal
  // reconcilen (echte IDs/Zeitstempel). Ein Fehler lädt den Zeitraum neu.
  //
  // `undoable` steuert nur, ob eine Rückgängig-Meldung erscheint — der
  // Rückweg selbst läuft wieder durch persistCells, dann aber ohne erneutes
  // Undo-Angebot (sonst schaukeln sich zwei Meldungen gegenseitig hoch).
  async function persistCells(ops: CellOp[], undoable = false) {
    if (ops.length === 0) return;
    // Vor dem optimistischen Update den Ist-Zustand sichern: Clear-Ops müssen
    // die echte, ggf. schon persistierte Zeile kennen, bevor patchRows sie
    // lokal entfernt — und für „Rückgängig" brauchen wir ihn ohnehin.
    const before = new Map<string, Shift | undefined>(
      ops.map((op) => [`${op.userId}|${op.dateKey}`, shiftFor(op.userId, op.dateKey)]),
    );

    setBusy(true);
    setWriting(true);

    patchRows((prev) => {
      const draft = [...prev];
      for (const op of ops) {
        const idx = draft.findIndex((r) => r.userId === op.userId && r.shiftDate === op.dateKey);
        if (op.clear) {
          if (idx >= 0) draft.splice(idx, 1);
        } else {
          const base = idx >= 0 ? draft[idx] : null;
          const next: Shift = {
            id: base?.id ?? `tmp-${op.userId}-${op.dateKey}`,
            userId: op.userId,
            shiftDate: op.dateKey,
            shiftType: op.shiftType as ShiftType,
            campaignId: op.campaignId || undefined,
            createdAt: base?.createdAt ?? new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          if (idx >= 0) draft[idx] = next;
          else draft.push(next);
        }
      }
      return draft;
    });

    try {
      await Promise.all(
        ops.map((op) => {
          if (op.clear) {
            const existing = before.get(`${op.userId}|${op.dateKey}`);
            return existing && !existing.id.startsWith('tmp-')
              ? deleteShiftRow(existing.id)
              : Promise.resolve();
          }
          return upsertShift({
            userId: op.userId,
            shiftDate: op.dateKey,
            shiftType: op.shiftType as ShiftType,
            campaignId: op.campaignId || null,
          });
        }),
      );
      await reload();
      notifyAffected(ops);

      if (undoable) {
        // Der Rückweg ist der gesicherte Vorzustand je Zelle: gab es vorher
        // nichts, wird die Zelle geleert, sonst der alte Wert zurückgeschrieben.
        const undoOps: CellOp[] = ops.map((op) => {
          const prev = before.get(`${op.userId}|${op.dateKey}`);
          return prev
            ? {
                userId: op.userId,
                dateKey: op.dateKey,
                shiftType: prev.shiftType,
                campaignId: prev.campaignId ?? '',
              }
            : { userId: op.userId, dateKey: op.dateKey, clear: true };
        });
        toast.success(
          ops.length === 1 ? 'Schicht gesetzt.' : `${ops.length} Zellen gesetzt.`,
          { label: 'Rückgängig', run: () => void persistCells(undoOps) },
        );
      }
    } catch {
      toast.error('Speichern fehlgeschlagen – Plan neu geladen.');
      await reload().catch(() => {});
    } finally {
      setBusy(false);
      setWriting(false);
    }
  }

  /**
   * Wer von einer Änderung betroffen ist, erfährt davon — sonst müsste jede:r
   * den Plan im Auge behalten. Eine Meldung je Person, nicht je Zelle: beim
   * Füllen einer ganzen Zeile wären das sonst sieben Meldungen für dieselbe
   * Sache. `notify` lässt den Auslöser selbst aus.
   */
  function notifyAffected(ops: CellOp[]) {
    const byUser = new Map<string, CellOp[]>();
    for (const op of ops) {
      const list = byUser.get(op.userId);
      if (list) list.push(op);
      else byUser.set(op.userId, [op]);
    }
    const kw = view === 'woche' ? weekLabel(refDate) : monthTitle(refDate);
    for (const [userId, list] of byUser) {
      const body =
        list.length === 1
          ? `${shortDay(list[0].dateKey)}: ${list[0].clear ? 'Schicht entfernt' : shiftLabel(list[0].shiftType)}`
          : `${list.length} Tage in ${kw} geändert.`;
      void notify([userId], {
        kind: 'shift-changed',
        title: `Dein Schichtplan (${kw}) wurde geändert`,
        body,
        link: { route: 'schedule' },
      });
    }
  }

  const paintOp = (userId: string, dk: string): CellOp =>
    tool === 'clear'
      ? { userId, dateKey: dk, clear: true }
      : {
          userId,
          dateKey: dk,
          shiftType: tool as ShiftType,
          // Eine Kampagne ergibt nur bei Arbeitsschichten Sinn — ein Urlaubstag
          // mit Kampagnenzuordnung wäre in der Auswertung schlicht falsch.
          campaignId: SHIFT_META[tool as ShiftType]?.working ? paintCampaignId : '',
        };

  // ---- Malen per Ziehen ---------------------------------------------------
  // Gesammelt wird über die gedrückte Maustaste hinweg; geschrieben wird erst
  // beim Loslassen. So ist ein Zug über zehn Zellen ein Schreibvorgang, eine
  // Meldung und ein Rückgängig — nicht zehn.
  const [dragging, setDragging] = useState(false);
  const dragCells = useRef<Map<string, CellOp>>(new Map());

  const canPaint = manager && tool !== 'edit';

  const addToDrag = (userId: string, dk: string) => {
    const key = `${userId}|${dk}`;
    if (dragCells.current.has(key)) return;
    dragCells.current.set(key, paintOp(userId, dk));
  };

  const endDrag = () => {
    const ops = Array.from(dragCells.current.values());
    dragCells.current.clear();
    setDragging(false);
    if (ops.length > 0) void persistCells(ops, true);
  };

  // Loslassen auch außerhalb des Rasters beenden den Zug — sonst „klebt" das
  // Malen weiter, wenn man über dem Seitenrand loslässt.
  useEffect(() => {
    if (!dragging) return;
    const onUp = () => endDrag();
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }); // ohne Deps: greift immer auf das aktuelle Werkzeug zu

  const onCellMouseDown = (u: { key: string; displayName: string }, day: Date) => {
    if (!canPaint || busy) return;
    setDragging(true);
    addToDrag(u.key, dateKey(day));
  };

  const onCellMouseEnter = (u: { key: string }, day: Date) => {
    if (!dragging || !canPaint) return;
    addToDrag(u.key, dateKey(day));
  };

  // Klick auf eine Zelle im Modus „Bearbeiten": Detail-Formular. Ohne
  // Chef-Rechte ist die eigene Zeile trotzdem anklickbar — dort führt der Klick
  // in den Tausch-Dialog, denn das ist die einzige Einflussmöglichkeit, die
  // Agent:innen auf den Plan haben.
  const onCellClick = (u: { key: string; displayName: string }, day: Date) => {
    const dk = dateKey(day);
    if (!manager) {
      if (u.key !== currentUser?.key) return;
      setSwapSeed(dk);
      setSwapOpen(true);
      return;
    }
    if (busy || tool !== 'edit') return;
    setEditTarget({
      userId: u.key,
      userName: u.displayName,
      dateKey: dk,
      dateLabel: formatDateObj(day),
      existing: shiftFor(u.key, dk),
    });
  };

  const fillRow = (userId: string) => {
    if (!canPaint || busy) return;
    void persistCells(days.map((d) => paintOp(userId, dateKey(d))), true);
  };

  const fillColumn = (day: Date) => {
    if (!canPaint || busy) return;
    const dk = dateKey(day);
    void persistCells(agentRows.map((u) => paintOp(u.key, dk)), true);
  };

  const saveShift = async (shiftType: ShiftType, campaignId: string) => {
    if (!editTarget) return;
    const target = editTarget;
    setEditTarget(null);
    await persistCells([
      {
        userId: target.userId,
        dateKey: target.dateKey,
        shiftType,
        campaignId: SHIFT_META[shiftType].working ? campaignId : '',
      },
    ]);
  };

  const clearCellFromModal = async () => {
    if (!editTarget) return;
    const target = editTarget;
    setEditTarget(null);
    await persistCells([{ userId: target.userId, dateKey: target.dateKey, clear: true }]);
  };

  // Vorwoche übernehmen: die Schichten der Woche davor 1:1 auf diese Woche
  // kopieren. Enthält die aktuelle Woche schon Einträge, werden sie dabei
  // überschrieben — deshalb wird vorher gefragt (jetzt im App-Dialog statt im
  // nativen confirm(), das mitten in der Oberfläche fremd wirkt).
  const copyPreviousWeek = async () => {
    setCopyAsk(false);
    if (!manager || busy) return;
    const prevStart = weekStart(new Date(refDate.getTime() - 7 * 86400000));
    try {
      setBusy(true);
      setWriting(true);
      const prevRows = await fetchShiftsForWeek(dateKey(prevStart), dateKey(weekDays(prevStart)[6]));
      if (prevRows.length === 0) {
        toast.info('Die Vorwoche enthält keine Schichten.');
        return;
      }
      const ops: CellOp[] = prevRows.map((s) => {
        // parseLocalDate statt new Date(): ein reiner Datumsstring wird sonst
        // als UTC gelesen und rutscht in westlichen Zeitzonen auf den Vortag.
        const d = parseLocalDate(s.shiftDate);
        d.setDate(d.getDate() + 7);
        return { userId: s.userId, dateKey: dateKey(d), shiftType: s.shiftType, campaignId: s.campaignId ?? '' };
      });
      await Promise.all(
        ops.map((op) =>
          upsertShift({
            userId: op.userId,
            shiftDate: op.dateKey,
            shiftType: op.shiftType as ShiftType,
            campaignId: op.campaignId || null,
          }),
        ),
      );
      await reload();
      toast.success('Vorwoche übernommen.');
    } catch {
      toast.error('Vorwoche konnte nicht übernommen werden.');
      await reload().catch(() => {});
    } finally {
      setBusy(false);
      setWriting(false);
    }
  };

  // ---- Ableitungen für die Übersicht -------------------------------------
  const coverage: DayCoverage[] = useMemo(
    () =>
      days.map((d) =>
        dayCoverage(
          (shifts ?? []).filter((s) => s.shiftDate === dateKey(d)),
          targetByWeekday.get(isoWeekday(d)) ?? null,
        ),
      ),
    [days, shifts, targetByWeekday],
  );

  // Alle Tagesbalken teilen sich einen Maßstab — sonst sähe ein Tag mit einer
  // Person genauso „voll" aus wie einer mit vieren, und der Vergleich zwischen
  // den Tagen wäre wertlos.
  const coveragePeak = useMemo(
    () => Math.max(1, ...coverage.flatMap((c) => c.bands.map((b) => b.count))),
    [coverage],
  );

  const workingDaysOf = (userId: string) =>
    (shifts ?? []).filter((s) => s.userId === userId && shiftMeta(s.shiftType).working).length;

  const usedCampaignIds = useMemo(() => {
    const set = new Set<string>();
    (shifts ?? []).forEach((s) => s.campaignId && set.add(s.campaignId));
    return Array.from(set);
  }, [shifts]);

  const usedShiftTypes = useMemo(() => {
    const set = new Set<ShiftType>();
    (shifts ?? []).forEach((s) => set.add(s.shiftType));
    // Früh/Spät gehören immer in die Legende, auch wenn die Woche leer ist.
    set.add('frueh');
    set.add('spaet');
    return SHIFT_ORDER.filter((t) => set.has(t));
  }, [shifts]);

  const TOOLS: Tool[] = ['edit', ...SHIFT_ORDER, 'clear'];
  const toolLabel = (t: Tool) =>
    t === 'edit' ? 'Bearbeiten' : t === 'clear' ? 'Leeren' : SHIFT_META[t].label;

  // Tauschanfragen, die mich betreffen: als Beteiligte:r immer, als Chef alle,
  // die auf Bestätigung warten. Sie stehen oben auf der Seite, damit niemand
  // erst ins Postfach wechseln muss, um zu antworten.
  const myOpenSwaps = useMemo(
    () =>
      swaps.filter(
        (r) =>
          r.requesterId === currentUser?.key ||
          r.partnerId === currentUser?.key ||
          (manager && r.status === 'accepted'),
      ),
    [swaps, currentUser?.key, manager],
  );

  /** Habe ich im angezeigten Zeitraum überhaupt etwas anzubieten? */
  const iHaveShiftsHere = (shifts ?? []).some((s) => s.userId === currentUser?.key);

  const openSwapDialog = (seed?: string) => {
    setSwapSeed(seed ?? null);
    setSwapOpen(true);
  };

  const step = (dir: 1 | -1) => {
    if (view === 'woche') {
      setRefDate(weekStart(new Date(refDate.getTime() + dir * 7 * 86400000)));
    } else {
      setRefDate(new Date(refDate.getFullYear(), refDate.getMonth() + dir, 1));
    }
  };

  const goToday = () =>
    setRefDate(view === 'woche' ? weekStart() : new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const switchView = (next: ViewMode) => {
    setView(next);
    // Beim Wechsel den Bezugspunkt passend normalisieren, sonst zeigt die
    // Monatsansicht den Monat des Wochenmontags mit krummem Start.
    setRefDate((d) => (next === 'woche' ? weekStart(d) : new Date(d.getFullYear(), d.getMonth(), 1)));
  };

  const rangeTitle = view === 'woche' ? weekLabel(refDate) : monthTitle(refDate);
  const compact = view === 'monat';

  return (
    <div className="schedule-page">
      <div className="page-header">
        <div>
          <h2>Schichtplan</h2>
          <p>
            {manager
              ? 'Werkzeug wählen und über die Zellen ziehen — auch ganze Zeilen (Person) oder Spalten (Tag) über die Kopfzellen. Für Details ein Klick im Modus „Bearbeiten".'
              : 'Der vollständige Plan des Teams. Bearbeiten können ihn nur Chefs — deine eigenen Schichten kannst du zum Tausch anbieten.'}
          </p>
        </div>
        <div className="schedule-header-actions">
          <div className="schedule-viewswitch" role="group" aria-label="Ansicht">
            <button
              className={`schedule-viewbtn ${view === 'woche' ? 'is-active' : ''}`}
              onClick={() => switchView('woche')}
              aria-pressed={view === 'woche'}
            >
              Woche
            </button>
            <button
              className={`schedule-viewbtn ${view === 'monat' ? 'is-active' : ''}`}
              onClick={() => switchView('monat')}
              aria-pressed={view === 'monat'}
            >
              Monat
            </button>
          </div>

          <button
            className={`btn btn-sm ${onlyMine ? 'btn-primary' : ''}`}
            onClick={() => setOnlyMine((v) => !v)}
            aria-pressed={onlyMine}
            title={onlyMine ? 'Wieder das ganze Team zeigen' : 'Nur meine eigenen Schichten zeigen'}
          >
            {onlyMine ? <User size={13} /> : <Users size={13} />} {onlyMine ? 'Nur meine' : 'Team'}
          </button>

          <button
            className="btn btn-sm"
            onClick={() => openSwapDialog()}
            disabled={!iHaveShiftsHere}
            title={
              iHaveShiftsHere
                ? 'Eine eigene Schicht einer Kolleg:in zum Tausch anbieten'
                : 'In diesem Zeitraum hast du keine Schicht, die du anbieten könntest.'
            }
          >
            <ArrowLeftRight size={13} /> Schicht tauschen
          </button>

          <div className="schedule-nav">
            <button className="btn btn-sm" onClick={() => step(-1)} aria-label="Zurück">
              <ChevronLeft size={14} />
            </button>
            <span className="schedule-range-label">{rangeTitle}</span>
            <button className="btn btn-sm" onClick={() => step(1)} aria-label="Vor">
              <ChevronRight size={14} />
            </button>
            <button className="btn btn-sm" onClick={goToday}>Heute</button>
          </div>
        </div>
      </div>

      {myOpenSwaps.length > 0 && (
        <div className="widget swap-panel">
          <div className="swap-panel-head">
            <ArrowLeftRight size={14} />
            <strong>Offene Tauschanfragen</strong>
            <span className="muted">{myOpenSwaps.length}</span>
          </div>
          {myOpenSwaps.map((r) => (
            <div key={r.id} className="swap-panel-row">
              <div className="swap-panel-text">
                <span className="swap-panel-people">
                  {users[r.requesterId]?.displayName ?? 'Unbekannt'}
                  {' ↔ '}
                  {users[r.partnerId]?.displayName ?? 'Unbekannt'}
                </span>
                <span className="swap-panel-detail">
                  {swapSummary(r)} · {SWAP_STATUS_LABEL[r.status]}
                </span>
              </div>
              <SwapActions swap={r} myId={currentUser?.key ?? ''} manager={manager} />
            </div>
          ))}
        </div>
      )}

      {manager && (
        <div className="schedule-toolbar">
          <div className="schedule-tools" role="group" aria-label="Werkzeug">
            {TOOLS.map((t) => (
              <button
                key={t}
                type="button"
                className={`schedule-tool ${tool === t ? 'is-active' : ''} ${t !== 'edit' ? `tool-${t}` : ''}`}
                onClick={() => setTool(t)}
                aria-pressed={tool === t}
                title={
                  t === 'edit'
                    ? 'Klick öffnet das Detail-Formular'
                    : `Zellen als „${toolLabel(t)}" malen — ziehen füllt mehrere`
                }
              >
                {t === 'edit' ? <MousePointerClick size={14} /> : TOOL_ICON[t]}
                <span>{toolLabel(t)}</span>
              </button>
            ))}
          </div>

          {tool !== 'edit' && tool !== 'clear' && SHIFT_META[tool as ShiftType].working && (
            <label className="schedule-campaign-pick">
              <span>Kampagne</span>
              <select value={paintCampaignId} onChange={(e) => setPaintCampaignId(e.target.value)}>
                <option value="">— keine —</option>
                {activeCampaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}

          <div className="schedule-toolbar-spacer" />

          <button
            className="btn btn-sm"
            onClick={() => setTargetsOpen(true)}
            title="Wie viele Personen sollen je Wochentag eingeteilt sein?"
          >
            <SlidersHorizontal size={13} /> Soll-Besetzung
          </button>
          {view === 'woche' && (
            <button
              className="btn btn-sm"
              onClick={() => (shifts && shifts.length > 0 ? setCopyAsk(true) : void copyPreviousWeek())}
              disabled={busy}
              title="Schichten der Vorwoche in diese Woche kopieren"
            >
              <Copy size={13} /> Vorwoche übernehmen
            </button>
          )}
        </div>
      )}

      {shifts === null ? (
        <SkeletonTable rows={6} cols={7} />
      ) : agentRows.length === 0 ? (
        <div className="widget empty">
          <CalendarDays size={32} strokeWidth={1.4} className="empty-icon" />
          <h3>{onlyMine ? 'Keine eigene Zeile' : 'Noch keine Mitarbeitenden'}</h3>
          <p>
            {onlyMine
              ? 'Für dein Konto gibt es hier nichts anzuzeigen — schalte oben auf „Team" um.'
              : 'Sobald sich Kolleg:innen registrieren, erscheinen sie hier.'}
          </p>
        </div>
      ) : (
        <div
          className={`widget schedule-board ${busy ? 'is-busy' : ''} ${dragging ? 'is-dragging' : ''}`}
        >
          <div className="table-wrap schedule-wrap">
            <table className={`schedule-table ${compact ? 'is-compact' : ''}`}>
              <thead>
                <tr>
                  <th className="schedule-corner">Mitarbeiter:in</th>
                  {days.map((d) => {
                    const dk = dateKey(d);
                    const weekend = isoWeekday(d) >= 6;
                    return (
                      <th
                        key={dk}
                        className={`schedule-day ${weekend ? 'is-weekend' : ''} ${dk === todayKey ? 'is-today' : ''} ${canPaint ? 'is-fillable' : ''}`}
                        onClick={() => fillColumn(d)}
                        title={canPaint ? `Ganze Spalte als „${toolLabel(tool)}"` : undefined}
                      >
                        <span className="schedule-day-name">
                          {WEEKDAY_LABELS[isoWeekday(d) - 1]}
                        </span>
                        <span className="schedule-day-date">{shortDate(d)}</span>
                      </th>
                    );
                  })}
                  <th className="schedule-sum-head" title="Arbeitstage (Früh + Spät) im Zeitraum">Σ</th>
                </tr>
              </thead>
              <tbody>
                {agentRows.map((u) => (
                  <tr key={u.key} className={u.key === currentUser?.key ? 'row-self' : undefined}>
                    <th
                      scope="row"
                      className={`schedule-agent ${canPaint ? 'is-fillable' : ''}`}
                      onClick={() => fillRow(u.key)}
                      title={canPaint ? `Ganzer Zeitraum als „${toolLabel(tool)}"` : undefined}
                    >
                      <span className="schedule-agent-inner">
                        <span className="schedule-agent-avatar">{initialsOf(u.displayName)}</span>
                        <span className="schedule-agent-name">{u.displayName}</span>
                      </span>
                    </th>
                    {days.map((d) => {
                      const dk = dateKey(d);
                      const s = shiftFor(u.key, dk);
                      const weekend = isoWeekday(d) >= 6;
                      const pendingSwap = swapForCell(swaps, u.key, dk);
                      const swappable = !manager && u.key === currentUser?.key;
                      return (
                        <td
                          key={dk}
                          className={`schedule-cell ${weekend ? 'is-weekend' : ''} ${dk === todayKey ? 'is-today' : ''}`}
                          onMouseDown={() => onCellMouseDown(u, d)}
                          onMouseEnter={() => onCellMouseEnter(u, d)}
                        >
                          <ShiftCell
                            shift={s}
                            compact={compact}
                            outcome={outcomes.get(outcomeKey(u.key, dk))}
                            campaignName={s?.campaignId ? campaignById.get(s.campaignId)?.name : undefined}
                            campaignColor={campaignColor(s?.campaignId)}
                            competency={planIssues.get(`${u.key}|${dk}`)}
                            manager={manager}
                            painting={canPaint}
                            swappable={swappable}
                            pendingSwap={pendingSwap}
                            disabled={manager ? busy : !swappable}
                            onClick={() => onCellClick(u, d)}
                          />
                        </td>
                      );
                    })}
                    <td className="schedule-sum">{workingDaysOf(u.key)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="schedule-coverage">
                  <th scope="row">Besetzung</th>
                  {coverage.map((c, i) => (
                    <td key={dateKey(days[i])}>
                      <CoverageCell coverage={c} peak={coveragePeak} compact={compact} />
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {shifts !== null && agentRows.length > 0 && (
        <div className="schedule-legend">
          {usedShiftTypes.map((t) => (
            <span key={t} className="schedule-legend-item">
              <span className={`shift-badge shift-badge-${SHIFT_META[t].tone}`}>
                {SHIFT_META[t].label}
              </span>
              {shiftTimeLabel(t) && <span className="schedule-legend-time">{shiftTimeLabel(t)}</span>}
            </span>
          ))}
          {usedCampaignIds.length > 0 && <span className="schedule-legend-divider" />}
          {usedCampaignIds.map((id) => (
            <span key={id} className="schedule-legend-item">
              <span className="shift-campaign-dot" style={{ background: campaignColor(id) }} />
              {campaignById.get(id)?.name ?? 'Unbekannt'}
            </span>
          ))}
          <span className="schedule-legend-hint">
            Der Balken zeigt, wie viele Personen über den Tag anwesend sind · Σ = Arbeitstage je Person
          </span>
        </div>
      )}

      {/* Kompetenz-Beanstandungen des angezeigten Zeitraums, gebündelt. Die
          Marker in den Zellen sagen WO — diese Zeile sagt, ob es überhaupt
          etwas gibt, ohne dass man den Plan absuchen muss. */}
      {planIssues.size > 0 && (
        <div className="schedule-comp-summary">
          <AlertTriangle size={14} />
          <span>
            {planIssues.size}{' '}
            {planIssues.size === 1 ? 'Zuteilung passt' : 'Zuteilungen passen'} nicht zum
            Schulungsstand:{' '}
            {competencySummary(planIssues)}
            {manager && (
              <>
                {' '}
                Kompetenzen werden in der{' '}
                <button className="link-button" onClick={() => navigate({ name: 'teammanager' })}>
                  Team-Verwaltung
                </button>{' '}
                gepflegt.
              </>
            )}
          </span>
        </div>
      )}

      {editTarget && (
        <ShiftEditPopover
          competencyIndex={competencyIndex}
          target={editTarget}
          campaigns={activeCampaigns}
          onSave={saveShift}
          onClear={editTarget.existing ? clearCellFromModal : undefined}
          onClose={() => setEditTarget(null)}
        />
      )}

      {copyAsk && (
        <Modal
          open
          onClose={() => setCopyAsk(false)}
          title="Vorwoche übernehmen?"
          subtitle={weekLabel(refDate)}
          footer={
            <>
              <button className="btn" onClick={() => setCopyAsk(false)}>Abbrechen</button>
              <button className="btn btn-primary" onClick={() => void copyPreviousWeek()}>
                Übernehmen
              </button>
            </>
          }
        >
          <p>
            Diese Woche enthält bereits <strong>{shifts?.length ?? 0} Einträge</strong>. Sie werden
            durch den Plan der Vorwoche überschrieben.
          </p>
        </Modal>
      )}

      {targetsOpen && (
        <StaffingTargetDialog
          targets={targets}
          onClose={() => setTargetsOpen(false)}
          onSaved={() => {
            setTargetsOpen(false);
            void loadTargets();
          }}
        />
      )}

      {swapOpen && currentUser && (
        <SwapDialog
          myId={currentUser.key}
          days={view === 'woche' ? days : weekDays(weekStart(new Date()))}
          shifts={shifts ?? []}
          colleagues={allAgents.filter((u) => u.key !== currentUser.key)}
          openSwaps={swaps}
          seedDate={swapSeed}
          onClose={() => {
            setSwapOpen(false);
            setSwapSeed(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Eine Zelle des Plans. Ausgelagert, weil hier inzwischen vier Dinge
 * übereinanderliegen — Schichtart, Zeit, Kampagne und Ergebnis — und die
 * Tabellenschleife sonst nicht mehr lesbar wäre.
 */
function ShiftCell({
  shift,
  compact,
  outcome,
  campaignName,
  campaignColor,
  competency,
  manager,
  painting,
  swappable,
  pendingSwap,
  disabled,
  onClick,
}: {
  shift?: Shift;
  compact: boolean;
  outcome?: ShiftOutcome;
  campaignName?: string;
  campaignColor?: string;
  /** Beanstandung der Kompetenz-Prüfung, falls es eine gibt (Migration 030). */
  competency?: ShiftCompetencyCheck;
  manager: boolean;
  painting: boolean;
  swappable: boolean;
  pendingSwap?: ShiftSwapRequest;
  disabled: boolean;
  onClick: () => void;
}) {
  const meta = shift ? shiftMeta(shift.shiftType) : null;
  const time = shift ? shiftTimeLabel(shift.shiftType) : null;
  // Ergebnis nur bei Arbeitsschichten: an einem Urlaubstag erfasste Anrufe sind
  // eine Randerscheinung, aber im Plan wären sie schlicht verwirrend.
  const showOutcome =
    !compact && meta?.working && outcome && (outcome.calls > 0 || outcome.contracts > 0);

  return (
    <button
      type="button"
      className={[
        'shift-cell',
        manager ? 'editable' : '',
        painting ? 'paintable' : '',
        swappable ? 'swappable' : '',
        pendingSwap ? 'has-swap' : '',
        shift ? `has-shift tone-${meta!.tone}` : 'is-empty-cell',
        competency?.severity ? `comp-${competency.severity}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
      disabled={disabled}
      title={
        // Die Kompetenz-Beanstandung hat Vorrang vor allen anderen Hinweisen:
        // sie ist der einzige Grund, aus dem diese Zuteilung nicht laufen
        // sollte, und sie muss ohne Umweg lesbar sein.
        competency?.severity
          ? competency.issues.map((i) => `${i.label}: ${i.hint}`).join('\n')
          : pendingSwap
            ? `Tauschanfrage läuft — ${SWAP_STATUS_LABEL[pendingSwap.status]}`
            : swappable
              ? 'Diese Schicht zum Tausch anbieten'
              : shift && time
                ? `${meta!.label} ${time}`
                : undefined
      }
    >
      {shift ? (
        <>
          <span className={`shift-badge shift-badge-${meta!.tone}`}>
            {compact ? meta!.short : meta!.label}
          </span>
          {!compact && time && <span className="shift-time">{time}</span>}
          {!compact && campaignName && meta!.working && (
            <span className="shift-campaign">
              <span className="shift-campaign-dot" style={{ background: campaignColor }} />
              {campaignName}
              {competency?.severity && (
                <AlertTriangle size={9} className={`shift-comp-flag is-${competency.severity}`} />
              )}
            </span>
          )}
          {compact && competency?.severity && (
            <AlertTriangle size={9} className={`shift-comp-flag is-${competency.severity}`} />
          )}
          {showOutcome && (
            <span className="shift-outcome">
              {outcome!.calls > 0 && (
                <span className="shift-outcome-part" title={`${outcome!.calls} Anrufe`}>
                  <Phone size={9} /> {outcome!.calls}
                </span>
              )}
              {outcome!.contracts > 0 && (
                <span className="shift-outcome-part is-win" title={`${outcome!.contracts} Abschlüsse`}>
                  <FileSignature size={9} /> {outcome!.contracts}
                </span>
              )}
            </span>
          )}
        </>
      ) : (
        <span className="shift-empty">{swappable ? '' : '+'}</span>
      )}
      {pendingSwap && (
        <span className="shift-swap-flag" aria-label="Tauschanfrage läuft">
          <ArrowLeftRight size={10} />
        </span>
      )}
    </button>
  );
}

/**
 * Besetzung eines Tages als Zeitstrahl.
 *
 * Bei Schichten, die sich fast vollständig überlappen (Früh 07:45–16:15, Spät
 * 08:45–17:15), sagt eine Kopfzahl je Schichtart wenig: die dünnen Stellen
 * liegen an den Rändern. Der Balken zeigt genau die — je höher, desto mehr
 * Leute sind zu dieser Tageszeit da.
 */
function CoverageCell({
  coverage,
  peak,
  compact,
}: {
  coverage: DayCoverage;
  /** Höchste Besetzung im gesamten Zeitraum — der gemeinsame Maßstab. */
  peak: number;
  compact: boolean;
}) {
  const { bands, working, understaffed, missingFrueh, missingSpaet, absences } = coverage;
  const span = DAY_WINDOW.endMin - DAY_WINDOW.startMin;

  const missingText = [
    missingFrueh > 0 ? `${missingFrueh}× Früh` : null,
    missingSpaet > 0 ? `${missingSpaet}× Spät` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const absenceText = Object.entries(absences)
    .map(([t, n]) => `${n}× ${SHIFT_META[t as ShiftType].label}`)
    .join(', ');

  const title = [
    bands.length > 0
      ? bands.map((b) => `${formatMinutes(b.startMin)}–${formatMinutes(b.endMin)}: ${b.count}`).join(' · ')
      : 'Niemand eingeteilt',
    missingText ? `Unterbesetzt: ${missingText} fehlt` : null,
    absenceText || null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <div className={`coverage-cell ${understaffed ? 'is-under' : ''}`} title={title}>
      <div className="coverage-bar" aria-hidden>
        {bands.map((b, i) => (
          <span
            key={i}
            className="coverage-band"
            style={{
              left: `${((b.startMin - DAY_WINDOW.startMin) / span) * 100}%`,
              width: `${((b.endMin - b.startMin) / span) * 100}%`,
              height: `${(b.count / peak) * 100}%`,
            }}
          />
        ))}
      </div>
      <span className="coverage-count">
        {understaffed && <AlertTriangle size={10} className="coverage-warn" />}
        {working}
        {!compact && understaffed && <span className="coverage-missing">−{missingFrueh + missingSpaet}</span>}
      </span>
    </div>
  );
}

/** Soll-Besetzung je Wochentag — die Vorgabe, gegen die die Ampel prüft. */
function StaffingTargetDialog({
  targets,
  onClose,
  onSaved,
}: {
  targets: StaffingTarget[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<StaffingTarget[]>(() =>
    Array.from({ length: 7 }, (_, i) => {
      const weekday = i + 1;
      const found = targets.find((t) => t.weekday === weekday);
      return found ?? { weekday, minFrueh: 0, minSpaet: 0 };
    }),
  );
  const [saving, setSaving] = useState(false);

  const setValue = (weekday: number, field: 'minFrueh' | 'minSpaet', value: number) =>
    setDraft((prev) =>
      prev.map((t) => (t.weekday === weekday ? { ...t, [field]: Math.max(0, value) } : t)),
    );

  const save = async () => {
    setSaving(true);
    try {
      await Promise.all(draft.map(upsertStaffingTarget));
      toast.success('Soll-Besetzung gespeichert.');
      onSaved();
    } catch {
      toast.error('Soll-Besetzung konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Soll-Besetzung"
      subtitle="Wie viele Personen sollen je Wochentag eingeteilt sein?"
      footer={
        <>
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            Speichern
          </button>
        </>
      }
    >
      <div className="staffing-grid">
        <div className="staffing-head">
          <span />
          <span>Früh</span>
          <span>Spät</span>
        </div>
        {draft.map((t) => (
          <div key={t.weekday} className="staffing-row">
            <span className="staffing-day">{WEEKDAY_LABELS[t.weekday - 1]}</span>
            <input
              type="number"
              min={0}
              max={99}
              value={t.minFrueh}
              onChange={(e) => setValue(t.weekday, 'minFrueh', Number(e.target.value))}
              aria-label={`Früh am ${WEEKDAY_LABELS[t.weekday - 1]}`}
            />
            <input
              type="number"
              min={0}
              max={99}
              value={t.minSpaet}
              onChange={(e) => setValue(t.weekday, 'minSpaet', Number(e.target.value))}
              aria-label={`Spät am ${WEEKDAY_LABELS[t.weekday - 1]}`}
            />
          </div>
        ))}
      </div>
      <p className="muted staffing-hint">
        Liegt die tatsächliche Besetzung darunter, markiert der Plan den Tag. 0 bedeutet: keine
        Vorgabe, der Tag gilt immer als gedeckt.
      </p>
    </Modal>
  );
}

/**
 * „Schicht tauschen" in einem Bild: links der eigene Tag, rechts der Tag der
 * Kolleg:in, dazwischen ein Pfeil und darunter im Klartext, was danach gilt.
 *
 * Bewusst kein mehrstufiger Assistent: beide Seiten stehen gleichzeitig da,
 * jede Auswahl aktualisiert die Vorschau sofort. Wer sich vertut, sieht es an
 * der Vorschau, nicht erst an der Rückmeldung der Kolleg:in.
 */
function SwapDialog({
  myId,
  days,
  shifts,
  colleagues,
  openSwaps,
  seedDate,
  onClose,
}: {
  myId: string;
  days: Date[];
  shifts: Shift[];
  colleagues: { key: string; displayName: string }[];
  openSwaps: ShiftSwapRequest[];
  seedDate: string | null;
  onClose: () => void;
}) {
  const request = useSwaps((s) => s.request);
  const busy = useSwaps((s) => s.busy);

  const myShifts = useMemo(
    () => days.map((d) => ({ dk: dateKey(d), shift: shifts.find((s) => s.userId === myId && s.shiftDate === dateKey(d)) })),
    [days, shifts, myId],
  );

  // Voreinstellung: der angeklickte Tag, sonst der erste eigene Tag mit
  // Schicht. Ein Dialog, der schon sinnvoll gefüllt aufgeht, spart den halben
  // Weg — geändert werden kann beides weiterhin.
  const firstOwn = myShifts.find((d) => d.shift)?.dk ?? myShifts[0]?.dk ?? '';
  const [myDate, setMyDate] = useState(seedDate ?? firstOwn);
  // Kolleg:in und gewählter Tag stecken in einem Zustand: der Tag gehört zur
  // Person, und ein Wechsel muss beides gemeinsam setzen — sonst bliebe der
  // Tag der vorigen Person stehen und wäre bestenfalls zufällig richtig.
  const [pick, setPick] = useState({ partnerId: colleagues[0]?.key ?? '', date: '' });
  const { partnerId, date: partnerDate } = pick;
  const [message, setMessage] = useState('');

  const partnerShifts = useMemo(
    () =>
      days.map((d) => ({
        dk: dateKey(d),
        shift: shifts.find((s) => s.userId === partnerId && s.shiftDate === dateKey(d)),
      })),
    [days, shifts, partnerId],
  );

  const myShift = myShifts.find((d) => d.dk === myDate)?.shift;
  const partnerShift = partnerShifts.find((d) => d.dk === partnerDate)?.shift;
  const partnerName = colleagues.find((c) => c.key === partnerId)?.displayName ?? '';

  // Läuft für eine der beiden Zellen schon etwas, wäre eine zweite Anfrage nur
  // Verwirrung — beide Seiten könnten am Ende doppelt vergeben sein.
  const blocking =
    (myDate && swapForCell(openSwaps, myId, myDate)) ||
    (partnerId && partnerDate && swapForCell(openSwaps, partnerId, partnerDate));

  const canSend = Boolean(myDate && partnerId && partnerDate && !blocking && !busy);

  const send = async () => {
    if (!canSend) return;
    const ok = await request({
      partnerId,
      requesterDate: myDate,
      partnerDate,
      requesterShiftType: myShift?.shiftType,
      partnerShiftType: partnerShift?.shiftType,
      message,
    });
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Schicht tauschen"
      subtitle="Die Kolleg:in muss zustimmen, danach bestätigt der Chef den Tausch."
      footer={
        <>
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={() => void send()} disabled={!canSend}>
            Anfrage senden
          </button>
        </>
      }
    >
      {colleagues.length === 0 ? (
        <p className="muted">Es gibt keine Kolleg:innen, mit denen du tauschen könntest.</p>
      ) : (
        <div className="swap-dialog">
          <div className="swap-dialog-sides">
            <div className="swap-side">
              <div className="swap-side-label">Du gibst ab</div>
              <div className="swap-days">
                {myShifts.map(({ dk, shift }) => (
                  <button
                    key={dk}
                    type="button"
                    className={`swap-day ${myDate === dk ? 'is-active' : ''} ${shift ? '' : 'is-empty'}`}
                    onClick={() => setMyDate(dk)}
                    aria-pressed={myDate === dk}
                  >
                    <span className="swap-day-date">{shortDay(dk)}</span>
                    <span className="swap-day-shift">{shiftLabel(shift?.shiftType)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="swap-dialog-arrow" aria-hidden>
              <ArrowLeftRight size={18} />
            </div>

            <div className="swap-side">
              <div className="swap-side-label">
                <select
                  value={partnerId}
                  onChange={(e) => setPick({ partnerId: e.target.value, date: '' })}
                  aria-label="Kolleg:in"
                >
                  {colleagues.map((c) => (
                    <option key={c.key} value={c.key}>{c.displayName}</option>
                  ))}
                </select>
                <span> gibt ab</span>
              </div>
              <div className="swap-days">
                {partnerShifts.map(({ dk, shift }) => (
                  <button
                    key={dk}
                    type="button"
                    className={`swap-day ${partnerDate === dk ? 'is-active' : ''} ${shift ? '' : 'is-empty'}`}
                    onClick={() => setPick((p) => ({ ...p, date: dk }))}
                    aria-pressed={partnerDate === dk}
                  >
                    <span className="swap-day-date">{shortDay(dk)}</span>
                    <span className="swap-day-shift">{shiftLabel(shift?.shiftType)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Die Vorschau ist der eigentliche Kern des Dialogs: sie sagt in
              einem Satz, was der Tausch bedeutet — vor dem Absenden, nicht
              erst in der Meldung bei der Kolleg:in. */}
          <div className={`swap-preview ${blocking ? 'is-blocked' : ''}`}>
            {blocking ? (
              <>Für einen der beiden Tage läuft bereits eine Tauschanfrage. Bitte erst deren Ausgang abwarten.</>
            ) : partnerDate ? (
              <>
                <strong>Danach:</strong> Du hast am {shortDay(partnerDate)} {shiftLabel(partnerShift?.shiftType)}
                {partnerName ? `, ${partnerName}` : ''} am {shortDay(myDate)} {shiftLabel(myShift?.shiftType)}.
              </>
            ) : (
              <>Wähle rechts den Tag, den du übernehmen möchtest.</>
            )}
          </div>

          <div className="field full">
            <label htmlFor="swap-message">Nachricht (optional)</label>
            <input
              id="swap-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="z. B. Arzttermin am Dienstag"
              maxLength={200}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

function ShiftEditPopover({
  target,
  campaigns,
  competencyIndex,
  onSave,
  onClear,
  onClose,
}: {
  target: EditTarget;
  campaigns: Campaign[];
  competencyIndex: CompetencyIndex;
  onSave: (shiftType: ShiftType, campaignId: string) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const [shiftType, setShiftType] = useState<ShiftType>(target.existing?.shiftType ?? 'frueh');
  const [campaignId, setCampaignId] = useState(target.existing?.campaignId ?? '');
  const time = shiftTimeLabel(shiftType);

  // Kompetenzen dieser Person (Migration 030). Nicht geschulte Kampagnen
  // bleiben wählbar, sind aber gekennzeichnet: der Plan wird oft unter
  // Zeitdruck gebaut, und ein hartes Verbot führt nur dazu, dass die Kampagne
  // gar nicht eingetragen wird — dann sieht das Cockpit keinen Leitfaden mehr.
  const options = campaignsForUser(campaigns, competencyIndex, target.userId);
  const chosen = options.find((o) => o.campaign.id === campaignId);

  return (
    <Modal
      open
      onClose={onClose}
      title={target.userName}
      subtitle={target.dateLabel}
      footer={
        <>
          {onClear && (
            <button className="btn btn-danger" onClick={onClear} style={{ marginRight: 'auto' }}>
              Schicht entfernen
            </button>
          )}
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" onClick={() => onSave(shiftType, campaignId)}>Speichern</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field full">
          <label>Schicht</label>
          <div className="shift-type-choice">
            {SHIFT_ORDER.map((t) => (
              <button
                key={t}
                type="button"
                className={`shift-type-btn shift-badge-${SHIFT_META[t].tone} ${shiftType === t ? 'is-active' : ''}`}
                onClick={() => setShiftType(t)}
                aria-pressed={shiftType === t}
              >
                {SHIFT_META[t].label}
              </button>
            ))}
          </div>
          {time && <p className="muted shift-time-hint">Arbeitszeit: {time}</p>}
        </div>
        {SHIFT_META[shiftType].working && (
          <div className="field full">
            <label>Kampagne</label>
            <select autoFocus value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">— keine —</option>
              {options.map((o) => (
                <option key={o.campaign.id} value={o.campaign.id}>
                  {o.campaign.name}
                  {o.level ? ` · ${o.level.label}` : o.qualified ? '' : ' · nicht geschult'}
                </option>
              ))}
            </select>
            {chosen && !chosen.qualified && (
              <div className="field-warning">
                {target.userName} ist für {campaignFor(chosen.campaign.callType).title} nicht
                geschult. Zuteilung ist möglich, wird im Plan aber als Warnung markiert.
              </div>
            )}
            {chosen?.level?.needsSupervision && (
              <div className="field-warning">
                In Einarbeitung — es muss an diesem Tag jemand Erfahrenes für dieselbe Kampagne
                eingeteilt sein.
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * „2× nicht geschult, 1× ohne Begleitung" — die Beanstandungen nach Art
 * gezählt statt einzeln aufgezählt. Bei einem Monatsplan wären es sonst
 * dreißig gleichlautende Zeilen.
 */
function competencySummary(issues: Map<string, ShiftCompetencyCheck>): string {
  const counts = new Map<string, number>();
  for (const check of issues.values()) {
    for (const issue of check.issues) {
      counts.set(issue.label, (counts.get(issue.label) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${n}× ${label.toLowerCase()}`)
    .join(', ');
}
