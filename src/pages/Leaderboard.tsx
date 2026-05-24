import { useMemo } from 'react';
import { Trophy, Crown, Medal, Award, EyeOff, Sparkles, BarChart3 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import {
  calcContractCommission,
  calcTariffCommission,
  formatCurrency,
  isSameMonth,
} from '../lib/utils';

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
  const { contracts, tariffChanges, settings } = useStore();
  const { users, currentUserKey, setLeaderboardOptIn } = useAuth();

  const me = currentUserKey ? users[currentUserKey] : null;
  const myOptIn = me?.leaderboardOptIn ?? true;

  const rows: Row[] = useMemo(() => {
    const map = new Map<string, Row>();
    const ensure = (key: string, displayName: string, optedIn: boolean): Row => {
      let r = map.get(key);
      if (!r) {
        r = {
          key,
          displayName,
          monthCommission: 0,
          totalCommission: 0,
          deals: 0,
          isMe: key === currentUserKey,
          optedIn,
        };
        map.set(key, r);
      }
      return r;
    };

    Object.values(users).forEach((u) =>
      ensure(u.key, u.displayName, u.leaderboardOptIn),
    );

    contracts.forEach((c) => {
      const key = c.createdBy ?? '__unknown__';
      const user = users[key];
      const row = ensure(
        key,
        user?.displayName ?? 'Unbekannt',
        user?.leaderboardOptIn ?? false,
      );
      const com = calcContractCommission(c, settings);
      row.totalCommission += com;
      // Stornierte Verträge zählen nicht als Abschluss.
      if (c.status !== 'storniert') row.deals += 1;
      if (isSameMonth(c.contractDate)) row.monthCommission += com;
    });

    tariffChanges.forEach((t) => {
      const key = t.createdBy ?? '__unknown__';
      const user = users[key];
      const row = ensure(
        key,
        user?.displayName ?? 'Unbekannt',
        user?.leaderboardOptIn ?? false,
      );
      const com = calcTariffCommission(t, settings);
      row.totalCommission += com;
      row.deals += 1;
      if (isSameMonth(t.changeDate)) row.monthCommission += com;
    });

    return Array.from(map.values())
      .filter((r) => r.optedIn || r.isMe)
      .filter((r) => r.deals > 0 || r.isMe)
      .sort((a, b) => b.monthCommission - a.monthCommission);
  }, [contracts, tariffChanges, settings, users, currentUserKey]);

  // `rows` ist bereits auf „sichtbar oder ich selbst" gefiltert — auch ein
  // ausgeblendeter Nutzer sieht sich also weiterhin im eigenen Ranking.
  const visibleRows = rows;
  const maxMonth = Math.max(1, ...visibleRows.map((r) => r.monthCommission));

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>
            <Trophy size={20} style={{ verticalAlign: '-3px', marginRight: 8, color: '#f5a623' }} />
            Leaderboard
          </h2>
          <p>Wer hat in diesem Monat die meiste Provision erzielt?</p>
        </div>
      </div>

      <div className="widget" style={{ marginBottom: 16 }}>
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

      {visibleRows.length === 0 ? (
        <div className="widget empty">
          <BarChart3 size={32} strokeWidth={1.4} className="empty-icon" />
          <h3>Noch keine Daten</h3>
          <p>Sobald Verträge oder Tarifwechsel erfasst sind, erscheint hier das Ranking.</p>
        </div>
      ) : (
        <>
          {visibleRows.length >= 3 && <Podium rows={visibleRows.slice(0, 3)} />}

          <div className="widget">
            <div className="row between" style={{ marginBottom: 14 }}>
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
                          {r.deals} Abschluss{r.deals === 1 ? '' : 'e'}
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

function Podium({ rows }: { rows: Row[] }) {
  const order = [rows[1], rows[0], rows[2]]; // visuell: 2 – 1 – 3
  const heights = [110, 140, 90];
  const places = [2, 1, 3];
  return (
    <div className="podium">
      {order.map((r, i) => (
        <div key={r.key} className={`podium-col place-${places[i]}`}>
          <div className="podium-avatar">{initialsOf(r.displayName)}</div>
          <div className="podium-name">{r.displayName}</div>
          <div className="podium-amount">{formatCurrency(r.monthCommission)}</div>
          <div className="podium-block" style={{ height: heights[i] }}>
            <span className="podium-place">{places[i]}</span>
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
