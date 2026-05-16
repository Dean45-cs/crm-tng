import { useMemo } from 'react';
import { Bell, ChevronRight, CalendarClock, Check } from 'lucide-react';
import { useStore } from '../store/useStore';
import {
  formatDate,
  followUpBucket,
  FOLLOW_UP_LABEL,
  type FollowUpBucket,
} from '../lib/utils';
import { useRouter } from '../router';

const BUCKET_ORDER: FollowUpBucket[] = ['overdue', 'today', 'thisWeek', 'later'];

const BUCKET_CLASS: Record<FollowUpBucket, string> = {
  overdue: 'bucket-overdue',
  today: 'bucket-today',
  thisWeek: 'bucket-week',
  later: 'bucket-later',
};

export function FollowUpInbox() {
  const contracts = useStore((s) => s.contracts);
  const updateContract = useStore((s) => s.updateContract);
  const { navigate } = useRouter();

  const grouped = useMemo(() => {
    const map: Record<FollowUpBucket, typeof contracts> = {
      overdue: [],
      today: [],
      thisWeek: [],
      later: [],
    };
    contracts.forEach((c) => {
      if (!c.followUpDate || c.status === 'storniert') return;
      const bucket = followUpBucket(c.followUpDate);
      if (bucket) map[bucket].push(c);
    });
    (Object.keys(map) as FollowUpBucket[]).forEach((k) => {
      map[k].sort((a, b) =>
        (a.followUpDate ?? '').localeCompare(b.followUpDate ?? ''),
      );
    });
    return map;
  }, [contracts]);

  const total = BUCKET_ORDER.reduce((s, k) => s + grouped[k].length, 0);

  const markDone = (id: string) => {
    updateContract(id, { followUpDate: '' });
  };

  return (
    <div className="widget followup-inbox">
      <div className="row between" style={{ marginBottom: 14 }}>
        <h3 className="widget-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bell size={15} />
          Wiedervorlage
        </h3>
        <span className="muted">{total} offen</span>
      </div>

      {total === 0 ? (
        <div className="empty-inline">
          <CalendarClock size={22} strokeWidth={1.5} style={{ opacity: 0.35 }} />
          <span>Keine Wiedervorlagen geplant.</span>
        </div>
      ) : (
        <div className="followup-list">
          {BUCKET_ORDER.map((bucket) => {
            const items = grouped[bucket];
            if (items.length === 0) return null;
            return (
              <div key={bucket} className="followup-bucket">
                <div className={`followup-header ${BUCKET_CLASS[bucket]}`}>
                  <span className="followup-dot" />
                  <span className="followup-label">{FOLLOW_UP_LABEL[bucket]}</span>
                  <span className="followup-count">{items.length}</span>
                </div>
                {items.slice(0, 5).map((c) => (
                  <div key={c.id} className="followup-item-wrap">
                    <button
                      className="followup-item"
                      onClick={() =>
                        navigate({ name: 'customer', kdnr: c.customerNumber })
                      }
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="followup-name">{c.customerName || '–'}</div>
                        <div className="followup-meta">
                          <code style={{ fontSize: 11 }}>{c.customerNumber}</code>
                          <span>·</span>
                          <span>{formatDate(c.followUpDate)}</span>
                        </div>
                      </div>
                      <ChevronRight size={14} style={{ color: 'var(--text-tertiary)' }} />
                    </button>
                    <button
                      className="followup-done-btn"
                      title="Wiedervorlage abschließen"
                      onClick={(e) => {
                        e.stopPropagation();
                        markDone(c.id);
                      }}
                    >
                      <Check size={13} />
                    </button>
                  </div>
                ))}
                {items.length > 5 && (
                  <div className="muted" style={{ fontSize: 12, padding: '6px 10px' }}>
                    +{items.length - 5} weitere
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
