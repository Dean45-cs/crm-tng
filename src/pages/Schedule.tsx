import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { useAuth } from '../store/useAuth';
import { useStore } from '../store/useStore';
import { fetchShiftsForWeek, upsertShift } from '../lib/supabaseApi';
import { weekStart, weekLabel, formatDateObj } from '../lib/utils';
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

/**
 * Geteilter Wochen-Schichtplan: alle aktiven Nutzer sehen die komplette
 * Woche (RLS erlaubt read-all, siehe db/migrations/020_shifts.sql). Nur
 * Chefs können Zellen bearbeiten — Agenten sehen den Plan read-only, aber
 * vollständig, nicht nur ihre eigene Schicht (explizite Anforderung).
 */
export function Schedule() {
  const { isManager, getCurrentUser } = useAuth();
  const users = useAuth((s) => s.users);
  const { campaigns } = useStore();
  const manager = isManager();

  const [refDate, setRefDate] = useState(() => weekStart());
  // Geladene Woche zusammen mit ihrem Schlüssel halten: passt er nicht zur
  // aktuell angezeigten Woche, gilt sie als „lädt noch" (shifts === null) —
  // ohne synchrones setState im Effect (React-Hooks-Regel).
  const [loaded, setLoaded] = useState<{ weekStart: string; rows: Shift[] } | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);

  const days = useMemo(() => weekDays(refDate), [refDate]);
  const weekStartKey = toDateKey(days[0]);
  const weekEndKey = toDateKey(days[6]);

  useEffect(() => {
    let cancelled = false;
    fetchShiftsForWeek(weekStartKey, weekEndKey)
      .then((rows) => {
        if (!cancelled) setLoaded({ weekStart: weekStartKey, rows });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ weekStart: weekStartKey, rows: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [weekStartKey, weekEndKey]);

  // Nur die Daten der aktuell angezeigten Woche gelten; nach einem Wochenwechsel
  // ist das noch null, bis der neue Fetch zurück ist → Skeleton.
  const shifts = loaded && loaded.weekStart === weekStartKey ? loaded.rows : null;

  const shiftFor = (userId: string, dateKey: string): Shift | undefined =>
    shifts?.find((s) => s.userId === userId && s.shiftDate === dateKey);

  const campaignName = (id?: string) =>
    id ? (campaigns.find((c) => c.id === id)?.name ?? '—') : undefined;

  const agentRows = useMemo(
    () =>
      Object.values(users)
        .filter((u) => u.isActive)
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'de')),
    [users],
  );

  const currentUser = getCurrentUser();

  const openEdit = (userId: string, userName: string, day: Date) => {
    if (!manager) return;
    const dateKey = toDateKey(day);
    setEditTarget({
      userId,
      userName,
      dateKey,
      dateLabel: formatDateObj(day),
      existing: shiftFor(userId, dateKey),
    });
  };

  const saveShift = async (shiftType: ShiftType, campaignId: string) => {
    if (!editTarget) return;
    try {
      const saved = await upsertShift({
        userId: editTarget.userId,
        shiftDate: editTarget.dateKey,
        shiftType,
        campaignId: campaignId || null,
      });
      setLoaded((prev) => {
        const rows = prev ? prev.rows : [];
        const rest = rows.filter(
          (s) => !(s.userId === saved.userId && s.shiftDate === saved.shiftDate),
        );
        return { weekStart: weekStartKey, rows: [...rest, saved] };
      });
      toast.success('Schicht gespeichert.');
      setEditTarget(null);
    } catch {
      toast.error('Schicht konnte nicht gespeichert werden.');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Schichtplan</h2>
          <p>
            {manager
              ? 'Wochenraster mit Früh-/Spät-Schicht und Kampagnen-Zuordnung — für alle Kolleg:innen sichtbar.'
              : 'Der vollständige Wochenplan des Teams — nur Chefs können ihn bearbeiten.'}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-sm" onClick={() => setRefDate(weekStart(new Date(refDate.getTime() - 7 * 86400000)))}>
            <ChevronLeft size={14} />
          </button>
          <span className="muted" style={{ minWidth: 90, textAlign: 'center' }}>
            {weekLabel(refDate)}
          </span>
          <button className="btn btn-sm" onClick={() => setRefDate(weekStart(new Date(refDate.getTime() + 7 * 86400000)))}>
            <ChevronRight size={14} />
          </button>
          <button className="btn btn-sm" onClick={() => setRefDate(weekStart())}>
            Heute
          </button>
        </div>
      </div>

      {shifts === null ? (
        <SkeletonTable rows={6} cols={7} />
      ) : agentRows.length === 0 ? (
        <div className="widget empty">
          <CalendarDays size={32} strokeWidth={1.4} className="empty-icon" />
          <h3>Noch keine Mitarbeitenden</h3>
          <p>Sobald sich Kolleg:innen registrieren, erscheinen sie hier.</p>
        </div>
      ) : (
        <div className="widget" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-wrap">
            <table className="crm-table schedule-table">
              <thead>
                <tr>
                  <th>Mitarbeiter:in</th>
                  {days.map((d, i) => (
                    <th key={toDateKey(d)} style={{ textAlign: 'center' }}>
                      {WEEKDAY_LABELS[i]}
                      <div className="muted" style={{ fontWeight: 400, fontSize: 11 }}>
                        {formatDateObj(d)}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agentRows.map((u) => (
                  <tr key={u.key} className={u.key === currentUser?.key ? 'row-self' : undefined}>
                    <td>{u.displayName}</td>
                    {days.map((d) => {
                      const dateKey = toDateKey(d);
                      const s = shiftFor(u.key, dateKey);
                      return (
                        <td key={dateKey} style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            className={`shift-cell ${manager ? 'editable' : ''}`}
                            onClick={() => openEdit(u.key, u.displayName, d)}
                            disabled={!manager}
                          >
                            {s ? (
                              <>
                                <span className={`shift-badge ${SHIFT_CLASS[s.shiftType]}`}>
                                  {SHIFT_LABEL[s.shiftType]}
                                </span>
                                {s.campaignId && (
                                  <span className="shift-campaign">{campaignName(s.campaignId)}</span>
                                )}
                              </>
                            ) : (
                              <span className="muted">–</span>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editTarget && (
        <ShiftEditPopover
          target={editTarget}
          campaigns={campaigns.filter((c) => c.active)}
          onSave={saveShift}
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
  onClose,
}: {
  target: EditTarget;
  campaigns: { id: string; name: string }[];
  onSave: (shiftType: ShiftType, campaignId: string) => void;
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
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={() => onSave(shiftType, campaignId)}>
            Speichern
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field full">
          <label>Schicht</label>
          <select
            autoFocus
            value={shiftType}
            onChange={(e) => setShiftType(e.target.value as ShiftType)}
          >
            {(Object.keys(SHIFT_LABEL) as ShiftType[]).map((t) => (
              <option key={t} value={t}>
                {SHIFT_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        {shiftType !== 'frei' && (
          <div className="field full">
            <label>Kampagne</label>
            <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">— keine —</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </Modal>
  );
}
