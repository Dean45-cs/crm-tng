import { useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';
import { useAuth } from '../store/useAuth';
import { useStore } from '../store/useStore';
import { useShifts } from '../store/useShifts';
import { useSwaps, swapForCell } from '../store/useSwaps';
import { notify } from '../store/useNotifications';
import { fetchShiftsForWeek, upsertShift, deleteShiftRow } from '../lib/supabaseApi';
import { weekStart, weekLabel, formatDateObj, parseLocalDate } from '../lib/utils';
import { shortDay, shiftLabel, swapSummary, SWAP_STATUS_LABEL } from '../lib/notifications';
import { toast } from '../store/useToast';
import { SkeletonTable } from '../components/Skeleton';
import { Modal } from '../components/Modal';
import { SwapActions } from '../components/SwapActions';
import type { Shift, ShiftType, ShiftSwapRequest } from '../types';

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const SHIFT_LABEL: Record<ShiftType, string> = {
  frueh: 'Früh',
  spaet: 'Spät',
  frei: 'Frei',
};

const SHIFT_CLASS: Record<ShiftType, string> = {
  frueh: 'shift-badge-frueh',
  spaet: 'shift-badge-spaet',
  frei: 'shift-badge-frei',
};

/** Das aktive Werkzeug in der Werkzeugleiste. 'edit' = Klick öffnet das Detail-
 *  Formular; die Schicht-Werte + 'clear' = „malen" (Klick setzt/löscht direkt). */
type Tool = 'edit' | ShiftType | 'clear';

const TOOL_ICON: Record<Exclude<Tool, 'edit'>, React.ReactNode> = {
  frueh: <Sun size={14} />,
  spaet: <Moon size={14} />,
  frei: <Ban size={14} />,
  clear: <Eraser size={14} />,
};

// Stabile Farbpalette für Kampagnen-Punkte in Zellen & Legende.
const CAMPAIGN_COLORS = ['#0088b8', '#7c5cf0', '#e8a33d', '#34a56f', '#e5657f', '#4a90d9', '#c77dff', '#d98324'];

/** YYYY-MM-DD in lokaler Zeit, für ein beliebiges Date-Objekt (nicht nur heute). */
function toDateKey(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function weekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });
}

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
 * Geteilter Wochen-Schichtplan: alle aktiven Nutzer sehen die komplette Woche
 * (RLS erlaubt read-all, siehe db/migrations/020_shifts.sql). Nur Chefs
 * bearbeiten. Bearbeiten geht auf zwei Wegen: „malen" (Werkzeug wählen, Zellen
 * anklicken — auch ganze Zeilen/Spalten über die Kopfzellen) für schnelles
 * Verteilen, und das Detail-Formular pro Zelle für die Feinarbeit.
 *
 * Der Plan bleibt Chef-Sache, der Anstoß kommt aber aus dem Team: über
 * „Schicht tauschen" fragt eine Person eine andere, und erst die Bestätigung
 * durch den Chef verschiebt tatsächlich etwas (Migration 023). Zellen, für die
 * gerade eine Anfrage läuft, sind markiert — sonst verplant der Chef eine
 * Schicht, über die zwei Leute schon verhandeln.
 */
export function Schedule() {
  const { isManager, getCurrentUser } = useAuth();
  const users = useAuth((s) => s.users);
  const { campaigns } = useStore();
  const manager = isManager();

  const swaps = useSwaps((s) => s.requests);
  const loadSwaps = useSwaps((s) => s.load);
  const [swapOpen, setSwapOpen] = useState(false);
  /** Vorbelegter eigener Tag, wenn der Dialog aus einer Zelle heraus aufgeht. */
  const [swapSeed, setSwapSeed] = useState<string | null>(null);

  // Schichten der aktuell angezeigten Woche kommen aus dem geteilten Store, der
  // per Realtime live bleibt (crm-tng-shifts). Passt der geladene Wochenschlüssel
  // nicht zur angezeigten Woche, gilt sie als „lädt noch" (shifts === null).
  const loadedWeekStart = useShifts((s) => s.weekStart);
  const rows = useShifts((s) => s.rows);
  const loadWeek = useShifts((s) => s.loadWeek);
  const patchRows = useShifts((s) => s.patchRows);
  const setWriting = useShifts((s) => s.setWriting);

  const [refDate, setRefDate] = useState(() => weekStart());
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [busy, setBusy] = useState(false);

  // Werkzeugleiste (nur für Chefs relevant).
  const [tool, setTool] = useState<Tool>('edit');
  const [paintCampaignId, setPaintCampaignId] = useState('');

  const days = useMemo(() => weekDays(refDate), [refDate]);
  const weekStartKey = toDateKey(days[0]);
  const weekEndKey = toDateKey(days[6]);
  const todayKey = toDateKey(new Date());

  const reload = (): Promise<Shift[]> => loadWeek(weekStartKey, weekEndKey);

  useEffect(() => {
    loadWeek(weekStartKey, weekEndKey);
  }, [weekStartKey, weekEndKey, loadWeek]);

  // Offene Tauschanfragen sind nicht wochen-scoped (sie können über die
  // Wochengrenze gehen) — einmal laden reicht, live bleibt der Store selbst.
  useEffect(() => {
    loadSwaps();
  }, [loadSwaps]);

  // Nur die Daten der aktuell angezeigten Woche gelten; nach einem Wochenwechsel
  // ist das noch null, bis der neue Fetch zurück ist → Skeleton.
  const shifts = loadedWeekStart === weekStartKey ? rows : null;

  const shiftFor = (userId: string, dateKey: string): Shift | undefined =>
    shifts?.find((s) => s.userId === userId && s.shiftDate === dateKey);

  const activeCampaigns = useMemo(() => campaigns.filter((c) => c.active), [campaigns]);
  const campaignById = useMemo(() => new Map(campaigns.map((c) => [c.id, c])), [campaigns]);
  const campaignColor = (id?: string) => {
    if (!id) return undefined;
    const idx = campaigns.findIndex((c) => c.id === id);
    return idx >= 0 ? CAMPAIGN_COLORS[idx % CAMPAIGN_COLORS.length] : '#94a3b8';
  };

  const agentRows = useMemo(
    () =>
      Object.values(users)
        .filter((u) => u.isActive)
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de')),
    [users],
  );

  const currentUser = getCurrentUser();

  // ---- Schreiben ---------------------------------------------------------
  // Optimistisch lokal aktualisieren, dann persistieren, dann einmal
  // reconcilen (echte IDs/Zeitstempel). Ein Fehler lädt die Woche neu.
  async function persistCells(ops: CellOp[]) {
    if (ops.length === 0) return;
    // Vor dem optimistischen Update `existing` aus dem aktuellen Stand ableiten:
    // Clear-Ops müssen die echte, ggf. schon persistierte Zeile kennen, bevor
    // patchRows sie lokal entfernt.
    const existingForClear = new Map<string, Shift | undefined>(
      ops.filter((op) => op.clear).map((op) => [`${op.userId}|${op.dateKey}`, shiftFor(op.userId, op.dateKey)]),
    );

    setBusy(true);
    setWriting(true);

    // Optimistisches Update auf den geteilten Store (nur die aktuelle Woche).
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
            const existing = existingForClear.get(`${op.userId}|${op.dateKey}`);
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
    const kw = weekLabel(refDate);
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

  const paintOp = (userId: string, dateKey: string): CellOp =>
    tool === 'clear'
      ? { userId, dateKey, clear: true }
      : { userId, dateKey, shiftType: tool as ShiftType, campaignId: tool === 'frei' ? '' : paintCampaignId };

  // Klick auf eine Zelle: im „malen"-Modus direkt setzen/löschen, sonst das
  // Detail-Formular öffnen. Ohne Chef-Rechte ist die eigene Zeile trotzdem
  // anklickbar — dort führt der Klick in den Tausch-Dialog, denn das ist die
  // einzige Einflussmöglichkeit, die Agent:innen auf den Plan haben.
  const onCellClick = (u: { key: string; displayName: string }, day: Date) => {
    const dateKey = toDateKey(day);
    if (!manager) {
      if (u.key !== currentUser?.key) return;
      setSwapSeed(dateKey);
      setSwapOpen(true);
      return;
    }
    if (busy) return;
    if (tool === 'edit') {
      setEditTarget({
        userId: u.key,
        userName: u.displayName,
        dateKey,
        dateLabel: formatDateObj(day),
        existing: shiftFor(u.key, dateKey),
      });
    } else {
      persistCells([paintOp(u.key, dateKey)]);
    }
  };

  // Ganze Zeile (eine Person, ganze Woche) mit dem aktiven Werkzeug füllen.
  const fillRow = (userId: string) => {
    if (!manager || busy || tool === 'edit') return;
    persistCells(days.map((d) => paintOp(userId, toDateKey(d))));
  };

  // Ganze Spalte (ein Tag, alle Personen) mit dem aktiven Werkzeug füllen.
  const fillColumn = (day: Date) => {
    if (!manager || busy || tool === 'edit') return;
    const dateKey = toDateKey(day);
    persistCells(agentRows.map((u) => paintOp(u.key, dateKey)));
  };

  const saveShift = async (shiftType: ShiftType, campaignId: string) => {
    if (!editTarget) return;
    const target = editTarget;
    setEditTarget(null);
    await persistCells([
      { userId: target.userId, dateKey: target.dateKey, shiftType, campaignId: shiftType === 'frei' ? '' : campaignId },
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
  // überschrieben — deshalb wird vorher gefragt (gleiches Muster wie beim
  // Löschen von Verträgen/Notizen).
  const copyPreviousWeek = async () => {
    if (!manager || busy) return;
    if (shifts && shifts.length > 0) {
      const ok = confirm(
        `Diese Woche enthält bereits ${shifts.length} Einträge. Sie werden durch den Plan der Vorwoche überschrieben. Fortfahren?`,
      );
      if (!ok) return;
    }
    const prevStart = weekStart(new Date(refDate.getTime() - 7 * 86400000));
    try {
      setBusy(true);
      setWriting(true);
      const prevRows = await fetchShiftsForWeek(toDateKey(prevStart), toDateKey(weekDays(prevStart)[6]));
      if (prevRows.length === 0) {
        toast.info('Die Vorwoche enthält keine Schichten.');
        return;
      }
      const ops: CellOp[] = prevRows.map((s) => {
        // parseLocalDate statt new Date(): ein reiner Datumsstring wird sonst
        // als UTC gelesen und rutscht in westlichen Zeitzonen auf den Vortag.
        const d = parseLocalDate(s.shiftDate);
        d.setDate(d.getDate() + 7);
        return { userId: s.userId, dateKey: toDateKey(d), shiftType: s.shiftType, campaignId: s.campaignId ?? '' };
      });
      await Promise.all(
        ops.map((op) =>
          upsertShift({ userId: op.userId, shiftDate: op.dateKey, shiftType: op.shiftType as ShiftType, campaignId: op.campaignId || null }),
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
  const coverage = useMemo(() => {
    return days.map((d) => {
      const key = toDateKey(d);
      const list = (shifts ?? []).filter((s) => s.shiftDate === key);
      return {
        frueh: list.filter((s) => s.shiftType === 'frueh').length,
        spaet: list.filter((s) => s.shiftType === 'spaet').length,
      };
    });
  }, [days, shifts]);

  const workingDaysOf = (userId: string) =>
    (shifts ?? []).filter((s) => s.userId === userId && s.shiftType !== 'frei').length;

  const usedCampaignIds = useMemo(() => {
    const set = new Set<string>();
    (shifts ?? []).forEach((s) => s.campaignId && set.add(s.campaignId));
    return Array.from(set);
  }, [shifts]);

  const TOOLS: Tool[] = ['edit', 'frueh', 'spaet', 'frei', 'clear'];
  const toolLabel = (t: Tool) => (t === 'edit' ? 'Bearbeiten' : t === 'clear' ? 'Leeren' : SHIFT_LABEL[t]);

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

  /** Habe ich in der angezeigten Woche überhaupt etwas anzubieten? */
  const iHaveShiftsThisWeek = (shifts ?? []).some((s) => s.userId === currentUser?.key);

  const openSwapDialog = (seed?: string) => {
    setSwapSeed(seed ?? null);
    setSwapOpen(true);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Schichtplan</h2>
          <p>
            {manager
              ? 'Werkzeug wählen und Zellen anklicken — auch ganze Zeilen (Person) oder Spalten (Tag). Für Details ein Klick im Modus „Bearbeiten".'
              : 'Der vollständige Wochenplan des Teams. Bearbeiten können ihn nur Chefs — deine eigenen Schichten kannst du zum Tausch anbieten.'}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn btn-sm"
            onClick={() => openSwapDialog()}
            disabled={!iHaveShiftsThisWeek}
            title={
              iHaveShiftsThisWeek
                ? 'Eine eigene Schicht einer Kolleg:in zum Tausch anbieten'
                : 'In dieser Woche hast du keine Schicht, die du anbieten könntest.'
            }
          >
            <ArrowLeftRight size={13} /> Schicht tauschen
          </button>
          <button className="btn btn-sm" onClick={() => setRefDate(weekStart(new Date(refDate.getTime() - 7 * 86400000)))} aria-label="Vorherige Woche">
            <ChevronLeft size={14} />
          </button>
          <span className="muted" style={{ minWidth: 90, textAlign: 'center' }}>{weekLabel(refDate)}</span>
          <button className="btn btn-sm" onClick={() => setRefDate(weekStart(new Date(refDate.getTime() + 7 * 86400000)))} aria-label="Nächste Woche">
            <ChevronRight size={14} />
          </button>
          <button className="btn btn-sm" onClick={() => setRefDate(weekStart())}>Heute</button>
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
                title={t === 'edit' ? 'Klick öffnet das Detail-Formular' : `Zellen als „${toolLabel(t)}" malen`}
              >
                {t === 'edit' ? <MousePointerClick size={14} /> : TOOL_ICON[t]}
                <span>{toolLabel(t)}</span>
              </button>
            ))}
          </div>

          {(tool === 'frueh' || tool === 'spaet') && (
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

          <button className="btn btn-sm" onClick={copyPreviousWeek} disabled={busy} title="Schichten der Vorwoche in diese Woche kopieren">
            <Copy size={13} /> Vorwoche übernehmen
          </button>
        </div>
      )}

      {shifts === null ? (
        <SkeletonTable rows={6} cols={7} />
      ) : agentRows.length === 0 ? (
        <div className="widget empty">
          <CalendarDays size={32} strokeWidth={1.4} className="empty-icon" />
          <h3>Noch keine Mitarbeitenden</h3>
          <p>Sobald sich Kolleg:innen registrieren, erscheinen sie hier.</p>
        </div>
      ) : (
        <div className={`widget ${busy ? 'is-busy' : ''}`} style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-wrap schedule-wrap">
            <table className="crm-table schedule-table">
              <thead>
                <tr>
                  <th className="schedule-corner">Mitarbeiter:in</th>
                  {days.map((d, i) => {
                    const key = toDateKey(d);
                    const weekend = i >= 5;
                    return (
                      <th
                        key={key}
                        className={`schedule-day ${weekend ? 'is-weekend' : ''} ${key === todayKey ? 'is-today' : ''} ${manager && tool !== 'edit' ? 'is-fillable' : ''}`}
                        onClick={() => fillColumn(d)}
                        title={manager && tool !== 'edit' ? `Ganze Spalte als „${toolLabel(tool)}"` : undefined}
                      >
                        {WEEKDAY_LABELS[i]}
                        <div className="schedule-day-date">{formatDateObj(d)}</div>
                      </th>
                    );
                  })}
                  <th className="schedule-sum-head" title="Arbeitstage (Früh + Spät) diese Woche">Σ</th>
                </tr>
              </thead>
              <tbody>
                {agentRows.map((u) => (
                  <tr key={u.key} className={u.key === currentUser?.key ? 'row-self' : undefined}>
                    <th
                      scope="row"
                      className={`schedule-agent ${manager && tool !== 'edit' ? 'is-fillable' : ''}`}
                      onClick={() => fillRow(u.key)}
                      title={manager && tool !== 'edit' ? `Ganze Woche als „${toolLabel(tool)}"` : undefined}
                    >
                      {u.displayName}
                    </th>
                    {days.map((d, i) => {
                      const dateKey = toDateKey(d);
                      const s = shiftFor(u.key, dateKey);
                      const weekend = i >= 5;
                      const pendingSwap = swapForCell(swaps, u.key, dateKey);
                      // Eigene Zeile ohne Chef-Rechte: klickbar, führt in den
                      // Tausch-Dialog. Fremde Zeilen bleiben es nicht.
                      const swappable = !manager && u.key === currentUser?.key;
                      return (
                        <td
                          key={dateKey}
                          className={`schedule-cell ${weekend ? 'is-weekend' : ''} ${dateKey === todayKey ? 'is-today' : ''}`}
                        >
                          <button
                            type="button"
                            className={`shift-cell ${manager ? 'editable' : ''} ${manager && tool !== 'edit' ? 'paintable' : ''} ${swappable ? 'swappable' : ''} ${pendingSwap ? 'has-swap' : ''}`}
                            onClick={() => onCellClick(u, d)}
                            disabled={manager ? busy : !swappable}
                            title={
                              pendingSwap
                                ? `Tauschanfrage läuft — ${SWAP_STATUS_LABEL[pendingSwap.status]}`
                                : swappable
                                  ? 'Diese Schicht zum Tausch anbieten'
                                  : undefined
                            }
                          >
                            {s ? (
                              <>
                                <span className={`shift-badge ${SHIFT_CLASS[s.shiftType]}`}>{SHIFT_LABEL[s.shiftType]}</span>
                                {s.campaignId && s.shiftType !== 'frei' && (
                                  <span className="shift-campaign">
                                    <span className="shift-campaign-dot" style={{ background: campaignColor(s.campaignId) }} />
                                    {campaignById.get(s.campaignId)?.name ?? '—'}
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
                    <td key={i}>
                      <span className="cov-frueh" title="Früh">{c.frueh}</span>
                      <span className="cov-sep">/</span>
                      <span className="cov-spaet" title="Spät">{c.spaet}</span>
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {(usedCampaignIds.length > 0 || agentRows.length > 0) && shifts !== null && (
        <div className="schedule-legend">
          <span className="schedule-legend-item"><span className="shift-badge shift-badge-frueh">Früh</span></span>
          <span className="schedule-legend-item"><span className="shift-badge shift-badge-spaet">Spät</span></span>
          <span className="schedule-legend-item"><span className="shift-badge shift-badge-frei">Frei</span></span>
          {usedCampaignIds.length > 0 && <span className="schedule-legend-divider" />}
          {usedCampaignIds.map((id) => (
            <span key={id} className="schedule-legend-item">
              <span className="shift-campaign-dot" style={{ background: campaignColor(id) }} />
              {campaignById.get(id)?.name ?? 'Unbekannt'}
            </span>
          ))}
          <span className="schedule-legend-hint">Besetzung = Früh / Spät je Tag · Σ = Arbeitstage je Person</span>
        </div>
      )}

      {editTarget && (
        <ShiftEditPopover
          target={editTarget}
          campaigns={activeCampaigns}
          onSave={saveShift}
          onClear={editTarget.existing ? clearCellFromModal : undefined}
          onClose={() => setEditTarget(null)}
        />
      )}

      {swapOpen && currentUser && (
        <SwapDialog
          myId={currentUser.key}
          days={days}
          shifts={shifts ?? []}
          colleagues={agentRows.filter((u) => u.key !== currentUser.key)}
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
    () => days.map((d) => ({ dateKey: toDateKey(d), shift: shifts.find((s) => s.userId === myId && s.shiftDate === toDateKey(d)) })),
    [days, shifts, myId],
  );

  // Voreinstellung: der angeklickte Tag, sonst der erste eigene Tag mit
  // Schicht. Ein Dialog, der schon sinnvoll gefüllt aufgeht, spart den halben
  // Weg — geändert werden kann beides weiterhin.
  const firstOwn = myShifts.find((d) => d.shift)?.dateKey ?? myShifts[0]?.dateKey ?? '';
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
        dateKey: toDateKey(d),
        shift: shifts.find((s) => s.userId === partnerId && s.shiftDate === toDateKey(d)),
      })),
    [days, shifts, partnerId],
  );

  const myShift = myShifts.find((d) => d.dateKey === myDate)?.shift;
  const partnerShift = partnerShifts.find((d) => d.dateKey === partnerDate)?.shift;
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
                {myShifts.map(({ dateKey, shift }) => (
                  <button
                    key={dateKey}
                    type="button"
                    className={`swap-day ${myDate === dateKey ? 'is-active' : ''} ${shift ? '' : 'is-empty'}`}
                    onClick={() => setMyDate(dateKey)}
                    aria-pressed={myDate === dateKey}
                  >
                    <span className="swap-day-date">{shortDay(dateKey)}</span>
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
                {partnerShifts.map(({ dateKey, shift }) => (
                  <button
                    key={dateKey}
                    type="button"
                    className={`swap-day ${partnerDate === dateKey ? 'is-active' : ''} ${shift ? '' : 'is-empty'}`}
                    onClick={() => setPick((p) => ({ ...p, date: dateKey }))}
                    aria-pressed={partnerDate === dateKey}
                  >
                    <span className="swap-day-date">{shortDay(dateKey)}</span>
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
  onSave,
  onClear,
  onClose,
}: {
  target: EditTarget;
  campaigns: { id: string; name: string }[];
  onSave: (shiftType: ShiftType, campaignId: string) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const [shiftType, setShiftType] = useState<ShiftType>(target.existing?.shiftType ?? 'frueh');
  const [campaignId, setCampaignId] = useState(target.existing?.campaignId ?? '');

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
            {(Object.keys(SHIFT_LABEL) as ShiftType[]).map((t) => (
              <button
                key={t}
                type="button"
                className={`shift-type-btn ${SHIFT_CLASS[t]} ${shiftType === t ? 'is-active' : ''}`}
                onClick={() => setShiftType(t)}
                aria-pressed={shiftType === t}
              >
                {SHIFT_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
        {shiftType !== 'frei' && (
          <div className="field full">
            <label>Kampagne</label>
            <select autoFocus value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">— keine —</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    </Modal>
  );
}
