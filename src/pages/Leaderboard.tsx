import { useMemo } from 'react';
import { Crown, Medal, Award, EyeOff, Sparkles, BarChart3 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { SkeletonTable } from '../components/Skeleton';
import { calcContractCommission, calcTariffCommission, formatCurrency, isSameMonth } from '../lib/utils';
import { agentStats } from '../lib/teamStats';

interface Row {
  key: string;
  displayName: string;
  monthCommission: number;
  totalCommission: number;
  deals: number;
  isMe: boolean;
  optedIn: boolean;
}

export function Leaderboard() {
  const { contracts, tariffChanges, settings, campaigns, outboundContacts, loaded } =
    useStore();
  const { users, currentUserKey, setLeaderboardOptIn } = useAuth();

  const me = currentUserKey ? users[currentUserKey] : null;
  const myOptIn = me?.leaderboardOptIn ?? true;

  // Einzige Quelle für Pro-Mitarbeiter-Provision ist agentStats()
  // (teamStats.ts) — vorher baute diese Seite dieselbe Aggregation ein
  // drittes Mal eigenständig nach (TeamDashboard.tsx tat es ein zweites Mal).
  // Ausnahme: Verträge/Tarifwechsel ohne bekannte:n Ersteller:in (z.B. eine
  // gelöschte Mitarbeiter:in, created_by wird dann null) laufen weiterhin
  // unter "Unbekannt", damit ihre Provision im Ranking nicht kommentarlos
  // verschwindet — das deckt agentStats() nicht ab, da es einen bekannten
  // agentKey braucht.
  const rows: Row[] = useMemo(() => {
    const known: Row[] = Object.values(users).map((u) => {
      const stats = agentStats(u.key, contracts, tariffChanges, settings, new Date(), {
        contacts: outboundContacts,
        campaigns,
      });
      return {
        key: u.key,
        displayName: u.displayName,
        monthCommission: stats.monthCommission,
        totalCommission: stats.totalCommission,
        deals: stats.totalDeals,
        isMe: u.key === currentUserKey,
        optedIn: u.leaderboardOptIn,
      };
    });

    const orphanContracts = contracts.filter((c) => !c.createdBy || !users[c.createdBy]);
    const orphanTariffs = tariffChanges.filter((t) => !t.createdBy || !users[t.createdBy]);
    if (orphanContracts.length || orphanTariffs.length) {
      let monthCommission = 0;
      let totalCommission = 0;
      let deals = 0;
      orphanContracts.forEach((c) => {
        const com = calcContractCommission(c, settings);
        totalCommission += com;
        if (c.status !== 'storniert') deals += 1;
        if (isSameMonth(c.contractDate)) monthCommission += com;
      });
      orphanTariffs.forEach((t) => {
        const com = calcTariffCommission(t, settings);
        totalCommission += com;
        deals += 1;
        if (isSameMonth(t.changeDate)) monthCommission += com;
      });
      known.push({
        key: '__unknown__',
        displayName: 'Unbekannt',
        monthCommission,
        totalCommission,
        deals,
        isMe: false,
        optedIn: false,
      });
    }

    return known
      .filter((r) => r.optedIn || r.isMe)
      .filter((r) => r.deals > 0 || r.isMe)
      .sort((a, b) => b.monthCommission - a.monthCommission);
  }, [contracts, tariffChanges, settings, users, currentUserKey, outboundContacts, campaigns]);

  // `rows` ist bereits auf „sichtbar oder ich selbst" gefiltert — auch ein
  // ausgeblendeter Nutzer sieht sich also weiterhin im eigenen Ranking.
  const visibleRows = rows;
  const maxMonth = Math.max(1, ...visibleRows.map((r) => r.monthCommission));

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Leaderboard</h2>
          <p>Wer hat in diesem Monat die meiste Provision erzielt?</p>
        </div>
      </div>

      <div className="widget" style={{ marginBottom: 10 }}>
        <div className="row between" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="row" style={{ gap: 10 }}>
            <div className={`leaderboard-toggle ${myOptIn ? 'on' : 'off'}`}>
              {myOptIn ? <Sparkles size={14} /> : <EyeOff size={14} />}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {myOptIn ? 'Du bist sichtbar' : 'Du bist versteckt'}
              </div>
              <div className="muted" style={{ fontSize: 12.5 }}>
                {myOptIn
                  ? 'Deine Provision erscheint im Ranking für andere Nutzer.'
                  : 'Andere Nutzer sehen dich nicht im Ranking. Du selbst siehst dich weiterhin.'}
              </div>
            </div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={myOptIn}
              onChange={(e) => setLeaderboardOptIn(e.target.checked)}
            />
            <span className="switch-track">
              <span className="switch-thumb" />
            </span>
          </label>
        </div>
      </div>

      {!loaded ? (
        <SkeletonTable rows={6} cols={4} />
      ) : visibleRows.length === 0 ? (
        <div className="widget empty">
          <BarChart3 size={32} strokeWidth={1.4} className="empty-icon" />
          <h3>Noch keine Daten</h3>
          <p>Sobald Verträge oder Tarifwechsel erfasst sind, erscheint hier das Ranking.</p>
        </div>
      ) : (
        <>
          {visibleRows.length >= 3 && <TopThree rows={visibleRows.slice(0, 3)} />}

          <div className="widget">
            <div className="row between" style={{ marginBottom: 10 }}>
              <h3 className="widget-title" style={{ margin: 0 }}>
                Gesamt-Ranking
              </h3>
              <span className="muted">Sortiert nach Provision (Monat)</span>
            </div>

            <div className="leaderboard-list">
              {visibleRows.map((r, idx) => {
                const pct = (r.monthCommission / maxMonth) * 100;
                return (
                  <div
                    key={r.key}
                    className={`leaderboard-row ${r.isMe ? 'is-me' : ''} ${idx < 3 ? `rank-${idx + 1}` : ''}`}
                  >
                    <div className="leaderboard-rank">
                      {idx === 0 ? (
                        <Crown size={18} />
                      ) : idx === 1 ? (
                        <Medal size={17} />
                      ) : idx === 2 ? (
                        <Award size={17} />
                      ) : (
                        <span>{idx + 1}</span>
                      )}
                    </div>
                    <div className="leaderboard-avatar">{initialsOf(r.displayName)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="row between" style={{ gap: 8 }}>
                        <div className="leaderboard-name">
                          {r.displayName}
                          {r.isMe && <span className="leaderboard-me">Du</span>}
                        </div>
                        <div className="leaderboard-amount">
                          {formatCurrency(r.monthCommission)}
                        </div>
                      </div>
                      <div className="leaderboard-bar">
                        <div
                          className="leaderboard-bar-fill"
                          style={{ width: `${Math.max(2, pct)}%` }}
                        />
                      </div>
                      <div className="row between" style={{ marginTop: 6 }}>
                        <span className="muted" style={{ fontSize: 11.5 }}>
                          {r.deals} {r.deals === 1 ? 'Abschluss' : 'Abschlüsse'}
                        </span>
                        <span className="muted" style={{ fontSize: 11.5 }}>
                          Gesamt: {formatCurrency(r.totalCommission)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Top 3 als ruhige Daten-Karten statt Sieger-Podest: die große Provisions-
 * zahl ist der Held, die Platzierung zeigt sich nur in feinen Metall-Akzenten
 * (Ring um den Avatar, kleines Badge) — kein Farbblock, kein Glow.
 */
function TopThree({ rows }: { rows: Row[] }) {
  const order = [rows[1], rows[0], rows[2]]; // visuell: 2 – 1 – 3
  const places = [2, 1, 3];
  return (
    <div className="top3">
      {order.map((r, i) => (
        <div
          key={r.key}
          className={`top3-card place-${places[i]} ${r.isMe ? 'is-me' : ''}`}
        >
          <div className="top3-badge">{places[i]}</div>
          {places[i] === 1 && <Crown size={16} className="top3-crown" aria-hidden />}
          <div className="top3-avatar">{initialsOf(r.displayName)}</div>
          <div className="top3-name">
            {r.displayName}
            {r.isMe && <span className="leaderboard-me">Du</span>}
          </div>
          <div className="top3-amount">{formatCurrency(r.monthCommission)}</div>
          <div className="top3-sub">
            {r.deals} Abschluss{r.deals === 1 ? '' : 'e'} · Gesamt{' '}
            {formatCurrency(r.totalCommission)}
          </div>
        </div>
      ))}
    </div>
  );
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
