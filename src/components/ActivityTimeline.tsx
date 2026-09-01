import { useMemo } from 'react';
import { FileSignature, ArrowLeftRight, StickyNote, History, Phone } from 'lucide-react';
import type { Contract, TariffChange, Note, Call } from '../types';
import { formatDate, TARIFF_TYPE_LABEL } from '../lib/utils';
import { formatDuration } from '../lib/statusBoard';

type EventKind = 'contract' | 'tariff' | 'note' | 'call';

interface TimelineEvent {
  id: string;
  kind: EventKind;
  date: string;
  title: string;
  detail: string;
}

const ICON: Record<EventKind, React.ReactNode> = {
  contract: <FileSignature size={13} />,
  tariff: <ArrowLeftRight size={13} />,
  note: <StickyNote size={13} />,
  call: <Phone size={13} />,
};

const KIND_LABEL: Record<EventKind, string> = {
  contract: 'Vertrag',
  tariff: 'Tarifwechsel',
  note: 'Notiz',
  call: 'Anruf',
};

interface Props {
  contracts: Contract[];
  tariffChanges: TariffChange[];
  notes: Note[];
  /** Optional — Anrufe sind nicht überall verfügbar (Extension-Historie, Stufe 4). */
  calls?: Call[];
}

export function ActivityTimeline({ contracts, tariffChanges, notes, calls = [] }: Props) {
  const events: TimelineEvent[] = useMemo(() => {
    const list: TimelineEvent[] = [
      ...contracts.map((c) => ({
        id: `c-${c.id}`,
        kind: 'contract' as const,
        date: c.contractDate,
        title: KIND_LABEL.contract,
        detail: c.products.join(', '),
      })),
      ...tariffChanges.map((t) => ({
        id: `t-${t.id}`,
        kind: 'tariff' as const,
        date: t.changeDate,
        title: KIND_LABEL.tariff,
        detail:
          t.oldProduct && t.newProduct
            ? `${t.oldProduct} → ${t.newProduct}`
            : TARIFF_TYPE_LABEL[t.changeType],
      })),
      ...notes.map((n) => ({
        id: `n-${n.id}`,
        kind: 'note' as const,
        // Vollen Zeitstempel behalten — formatDate rechnet ihn in lokale Zeit
        // um; ein UTC-Slice würde abends erstellte Notizen auf den Vortag legen.
        date: n.updatedAt,
        title: n.title,
        detail: n.content,
      })),
      ...calls.map((call) => ({
        id: `call-${call.id}`,
        kind: 'call' as const,
        date: call.startedAt,
        title: KIND_LABEL.call,
        detail: `${call.direction === 'outbound' ? 'Ausgehend' : 'Eingehend'}${
          call.durationS != null ? ` · ${formatDuration(call.durationS)}` : ''
        }`,
      })),
    ];
    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [contracts, tariffChanges, notes, calls]);

  if (events.length === 0) return null;

  return (
    <section style={{ marginBottom: 22 }}>
      <div className="customer-section-header">
        <div className="customer-section-title">
          <History size={15} />
          <span>Aktivitätsverlauf</span>
        </div>
        <span className="customer-section-count">{events.length}</span>
      </div>
      <div className="timeline">
        {events.map((e) => (
          <div key={e.id} className="timeline-item">
            <div className={`timeline-dot timeline-dot-${e.kind}`}>{ICON[e.kind]}</div>
            <div className="timeline-body">
              <div className="timeline-row">
                <span className="timeline-title">{e.title}</span>
                <span className="timeline-date">{formatDate(e.date)}</span>
              </div>
              {e.detail && <div className="timeline-detail">{e.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
