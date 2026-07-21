import { useEffect, useMemo, useRef, useState } from 'react';
import { Phone, PhoneOutgoing, ChevronDown } from 'lucide-react';
import { useCalls } from '../store/useCalls';
import { useAuth } from '../store/useAuth';
import { useRouter } from '../router';
import { formatDuration } from '../lib/statusBoard';

/** Wie lange ein Anruf ohne Abschluss-Update noch als "aktiv" gilt, bevor er
 * aus der Leiste verschwindet — Sicherheitsnetz für den Fall, dass ein
 * Extension-Tab abstürzt, bevor er den Anruf selbst abschließen konnte. Die
 * DB-Zeile bleibt für die Historie erhalten, nur duration_s fehlt dann. */
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/** Live-Anrufleiste in der Titlebar (Stufe 2, KONZEPT-INTEGRATION.md) — zeigt
 * Anrufe, die die Support-Copilot-Extension gerade als aktiv gemeldet hat.
 * Für alle Nutzer:innen sichtbar, Parität mit der bestehenden StatusBar. */
export function LiveCallBar() {
  const allActiveCalls = useCalls((s) => s.activeCalls);
  const users = useAuth((s) => s.users);
  const { navigate } = useRouter();

  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const wrapRef = useRef<HTMLDivElement>(null);

  // Duration tickt live weiter, ohne dass die Extension dafür schreiben muss.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  const calls = useMemo(
    () =>
      allActiveCalls
        .filter((c) => now - new Date(c.startedAt).getTime() < STALE_AFTER_MS)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    [allActiveCalls, now],
  );

  if (calls.length === 0) return null;

  return (
    <div ref={wrapRef} className="livecallbar-wrap">
      <button
        type="button"
        className="livecallbar-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Aktive Anrufe"
      >
        <span className="livecallbar-dot" />
        <Phone size={13} />
        <span className="livecallbar-count">{calls.length}</span>
        <ChevronDown size={13} className="livecallbar-chevron" />
      </button>

      {open && (
        <div className="livecallbar-pop" role="dialog" aria-label="Aktive Anrufe">
          <div className="livecallbar-pop-head">
            {calls.length} {calls.length === 1 ? 'Anruf' : 'Anrufe'} gerade aktiv
          </div>
          <div className="livecallbar-list">
            {calls.map((c) => {
              const agent = users[c.agentId];
              const durationS = Math.max(0, Math.floor((now - new Date(c.startedAt).getTime()) / 1000));
              return (
                <button
                  key={c.id}
                  type="button"
                  className="livecallbar-row"
                  disabled={!c.customerNumber}
                  onClick={() => {
                    if (!c.customerNumber) return;
                    setOpen(false);
                    navigate({ name: 'customer', kdnr: c.customerNumber });
                  }}
                >
                  {c.direction === 'outbound' ? <PhoneOutgoing size={13} /> : <Phone size={13} />}
                  <div className="livecallbar-row-main">
                    <div className="livecallbar-row-name">
                      {c.callerName || c.callerNumber || 'Unbekannter Anrufer'}
                    </div>
                    <div className="livecallbar-row-sub">
                      {agent?.displayName ?? 'Unbekannt'}
                      {c.queueGroup ? ` · ${c.queueGroup}` : ''}
                    </div>
                  </div>
                  <span className="livecallbar-row-duration">{formatDuration(durationS)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
