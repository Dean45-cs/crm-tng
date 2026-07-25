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
} from 'lucide-react';
import { useAuth } from '../store/useAuth';
import { useStore } from '../store/useStore';
import { useShifts } from '../store/useShifts';
import { fetchShiftsForWeek, upsertShift, deleteShiftRow } from '../lib/supabaseApi';
import { weekStart, weekLabel, formatDateObj, parseLocalDate } from '../lib/utils';
import { toast } from '../store/useToast';
import { SkeletonTable } from '../components/Skeleton';
import { Modal } from '../components/Modal';
import type { Shift, ShiftType } from '../types';

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
 */
export function Schedule() {
  const { isManager, getCurrentUser } = useAuth();
  const users = useAuth((s) => s.users);
  const { campaigns } = useStore();
  const manager = isManager();

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
    } catch {
      toast.error('Speichern fehlgeschlagen – Plan neu geladen.');
      await reload().catch(() => {});
    } finally {
      setBusy(false);
      setWriting(false);
    }
  }

  const paintOp = (userId: string, dateKey: string): CellOp =>
    tool === 'clear'
      ? { userId, dateKey, clear: true }
      : { userId, dateKey, shiftType: tool as ShiftType, campaignId: tool === 'frei' ? '' : paintCampaignId };

  // Klick auf eine Zelle: im „malen"-Modus direkt setzen/löschen, sonst das
  // Detail-Formular öffnen.
  const onCellClick = (u: { key: string; displayName: string }, day: Date) => {
    if (!manager || busy) return;
    const dateKey = toDateKey(day);
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Schichtplan</h2>
          <p>
            {manager
              ? 'Werkzeug wählen und Zellen anklicken — auch ganze Zeilen (Person) oder Spalten (Tag). Für Details ein Klick im Modus „Bearbeiten".'
              : 'Der vollständige Wochenplan des Teams — nur Chefs können ihn bearbeiten.'}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
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
                      return (
                        <td
                          key={dateKey}
                          className={`schedule-cell ${weekend ? 'is-weekend' : ''} ${dateKey === todayKey ? 'is-today' : ''}`}
                        >
                          <button
                            type="button"
                            className={`shift-cell ${manager ? 'editable' : ''} ${manager && tool !== 'edit' ? 'paintable' : ''}`}
                            onClick={() => onCellClick(u, d)}
                            disabled={!manager || busy}
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
                              <span className="shift-empty">+</span>
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
    </div>
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
