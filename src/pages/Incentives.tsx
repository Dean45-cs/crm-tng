import { useMemo } from 'react';
import { Gift, Target, Trophy, Check, Crown, Settings2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { useRouter } from '../router';
import { formatCurrency, weekLabel, monthLabel } from '../lib/utils';
import {
  incentiveValue,
  incentiveStandings,
  incentiveReached,
  isLeader,
} from '../lib/incentives';
import type { Incentive, IncentiveMetric } from '../types';

function formatMetric(metric: IncentiveMetric, value: number): string {
  if (metric === 'commission') return formatCurrency(value);
  const unit = metric === 'contracts' ? 'Verträge' : 'Abschlüsse';
  return `${value} ${unit}`;
}

export function Incentives() {
  const { contracts, tariffChanges, settings, incentives, loaded } = useStore();
  const { users, isManager, getCurrentUser } = useAuth();
  const { navigate } = useRouter();

  const myKey = getCurrentUser()?.key ?? '';

  const { weekly, monthly } = useMemo(() => {
    const active = incentives.filter((i) => i.active);
    return {
      weekly: active.filter((i) => i.period === 'weekly'),
      monthly: active.filter((i) => i.period === 'monthly'),
    };
  }, [incentives]);

  const hasAny = weekly.length > 0 || monthly.length > 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>
            <Gift size={26} style={{ verticalAlign: '-4px', marginRight: 8 }} />
            Incentives
          </h2>
          <p>Laufende Team-Ziele mit Belohnung — und dein aktueller Fortschritt.</p>
        </div>
        {isManager() && (
          <button
            className="btn"
            onClick={() => navigate({ name: 'incentivemanager' })}
          >
            <Settings2 size={14} /> Zur Verwaltung
          </button>
        )}
      </div>

      {!loaded ? (
        <div className="widget empty">
          <Gift size={32} strokeWidth={1.4} className="empty-icon" />
          <h3>Lade Incentives …</h3>
        </div>
      ) : !hasAny ? (
        <div className="widget empty">
          <Gift size={32} strokeWidth={1.4} className="empty-icon" />
          <h3>Keine laufenden Incentives</h3>
          <p>Sobald dein Chef ein Team-Ziel anlegt, erscheint es hier.</p>
        </div>
      ) : (
        <>
          {weekly.length > 0 && (
            <section className="incentive-section">
              <h3 className="incentive-section-title">
                Diese Woche · {weekLabel()}
              </h3>
              <div className="incentive-grid">
                {weekly.map((inc) => (
                  <IncentiveCard
                    key={inc.id}
                    incentive={inc}
                    myKey={myKey}
                    users={users}
                    contracts={contracts}
                    tariffChanges={tariffChanges}
                    settings={settings}
                  />
                ))}
              </div>
            </section>
          )}
          {monthly.length > 0 && (
            <section className="incentive-section">
              <h3 className="incentive-section-title">
                Dieser Monat · {monthLabel(0)}
              </h3>
              <div className="incentive-grid">
                {monthly.map((inc) => (
                  <IncentiveCard
                    key={inc.id}
                    incentive={inc}
                    myKey={myKey}
                    users={users}
                    contracts={contracts}
                    tariffChanges={tariffChanges}
                    settings={settings}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

interface CardProps {
  incentive: Incentive;
  myKey: string;
  users: ReturnType<typeof useAuth.getState>['users'];
  contracts: ReturnType<typeof useStore.getState>['contracts'];
  tariffChanges: ReturnType<typeof useStore.getState>['tariffChanges'];
  settings: ReturnType<typeof useStore.getState>['settings'];
}

function IncentiveCard({
  incentive,
  myKey,
  users,
  contracts,
  tariffChanges,
  settings,
}: CardProps) {
  if (incentive.mechanic === 'goal') {
    const value = incentiveValue(incentive, myKey, contracts, tariffChanges, settings);
    const reached = incentiveReached(incentive, value);
    const pct =
      incentive.target > 0
        ? Math.min(100, Math.round((value / incentive.target) * 100))
        : 0;
    return (
      <div className="widget incentive-card">
        <div className="incentive-card-head">
          <span className="incentive-card-title">
            <Target size={15} /> {incentive.title}
          </span>
          {reached && (
            <span className="incentive-reached">
              <Check size={12} /> Ziel erreicht
            </span>
          )}
        </div>
        <div className="incentive-progress">
          <div
            className="incentive-progress-fill"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="incentive-progress-label">
          <strong>{formatMetric(incentive.metric, value)}</strong>
          <span className="muted">
            Ziel: {formatMetric(incentive.metric, incentive.target)}
          </span>
        </div>
        <div className="incentive-reward">
          <Gift size={13} /> Belohnung: <strong>{incentive.reward}</strong>
        </div>
      </div>
    );
  }

  // Wettbewerb
  const standings = incentiveStandings(
    incentive,
    users,
    contracts,
    tariffChanges,
    settings,
  );
  const leading = isLeader(standings, myKey);
  const myRank = standings.find((s) => s.key === myKey);
  const top = standings.slice(0, 5);
  const showMine = myRank && myRank.rank > 5;

  return (
    <div className="widget incentive-card">
      <div className="incentive-card-head">
        <span className="incentive-card-title">
          <Trophy size={15} /> {incentive.title}
        </span>
        {leading && (
          <span className="incentive-reached">
            <Crown size={12} /> Du führst
          </span>
        )}
      </div>
      <div className="incentive-standings">
        {top.map((s) => (
          <div
            key={s.key}
            className={`incentive-standing-row ${s.key === myKey ? 'is-me' : ''}`}
          >
            <span className="incentive-standing-rank">{s.rank}</span>
            <span className="incentive-standing-name">{s.displayName}</span>
            <span className="incentive-standing-value">
              {formatMetric(incentive.metric, s.value)}
            </span>
          </div>
        ))}
        {showMine && myRank && (
          <div className="incentive-standing-row is-me">
            <span className="incentive-standing-rank">{myRank.rank}</span>
            <span className="incentive-standing-name">{myRank.displayName}</span>
            <span className="incentive-standing-value">
              {formatMetric(incentive.metric, myRank.value)}
            </span>
          </div>
        )}
      </div>
      <div className="incentive-reward">
        <Gift size={13} /> Nur Platz 1 gewinnt:{' '}
        <strong>{incentive.reward}</strong>
      </div>
    </div>
  );
}
