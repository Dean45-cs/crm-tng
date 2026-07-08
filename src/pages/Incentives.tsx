import { useMemo } from 'react';
import {
  Gift,
  Target,
  Trophy,
  Crown,
  Zap,
  CalendarDays,
  Sparkles,
  Flame,
  Settings2,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { useRouter } from '../router';
import { SkeletonCardGrid } from '../components/Skeleton';
import { formatCurrency, weekLabel, monthLabel } from '../lib/utils';
import {
  incentiveValue,
  incentiveStandings,
  incentiveReached,
  isLeader,
  type Standing,
} from '../lib/incentives';
import type { Incentive, IncentiveMetric } from '../types';

function formatMetric(metric: IncentiveMetric, value: number): string {
  if (metric === 'commission') return formatCurrency(value);
  const unit = metric === 'contracts' ? 'Verträge' : 'Abschlüsse';
  return `${value} ${unit}`;
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

  const renderCards = (list: Incentive[]) => (
    <div className="incentive-grid">
      {list.map((inc) => (
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
  );

  return (
    <div>
      <div className="page-header">
        <div className="incentive-page-title">
          <span className="incentive-page-icon">
            <Trophy size={18} />
          </span>
          <div>
            <h2 style={{ margin: 0 }}>Incentives</h2>
            <p style={{ margin: '4px 0 0' }}>
              Team-Aktionen mit Belohnung — dein Fortschritt zählt automatisch.
            </p>
          </div>
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
        <SkeletonCardGrid count={4} />
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
                <span className="incentive-section-icon week">
                  <Zap size={14} />
                </span>
                Diese Woche · {weekLabel()}
              </h3>
              {renderCards(weekly)}
            </section>
          )}
          {monthly.length > 0 && (
            <section className="incentive-section">
              <h3 className="incentive-section-title">
                <span className="incentive-section-icon month">
                  <CalendarDays size={14} />
                </span>
                Dieser Monat · {monthLabel(0)}
              </h3>
              {renderCards(monthly)}
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
    const remaining = Math.max(0, incentive.target - value);

    return (
      <div className={`widget incentive-card incentive-card-goal ${reached ? 'is-reached' : ''}`}>
        <div className="incentive-card-head">
          <span className="incentive-card-title">
            <Target size={15} /> {incentive.title}
          </span>
          {reached ? (
            <span className="incentive-badge-win">
              <Sparkles size={12} /> GESCHAFFT!
            </span>
          ) : (
            <span className="incentive-badge-pct">{pct}%</span>
          )}
        </div>

        <div className="arcade-bar">
          <div
            className="arcade-bar-fill"
            style={{ width: `${Math.max(pct, 3)}%` }}
          />
        </div>

        <div className="incentive-progress-label">
          <strong>{formatMetric(incentive.metric, value)}</strong>
          {reached ? (
            <span className="incentive-go">
              <Flame size={12} /> Ziel geknackt!
            </span>
          ) : (
            <span className="muted">
              Noch {formatMetric(incentive.metric, remaining)} bis zum Ziel
            </span>
          )}
        </div>

        <div className="incentive-prize">
          <Gift size={14} />
          <span>
            {reached ? 'Belohnung verdient: ' : 'Belohnung: '}
            <strong>{incentive.reward}</strong>
          </span>
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
  const podium = standings.slice(0, 3);
  const runners = standings.slice(3, 7);
  const meInRunners = !!myRank && myRank.rank > 7;

  return (
    <div className="widget incentive-card incentive-card-comp">
      <div className="incentive-card-head">
        <span className="incentive-card-title">
          <Trophy size={15} /> {incentive.title}
        </span>
        {leading && (
          <span className="incentive-badge-win">
            <Crown size={12} /> PLATZ 1
          </span>
        )}
      </div>

      {podium.length >= 3 ? (
        <IncentivePodium rows={podium} myKey={myKey} metric={incentive.metric} />
      ) : (
        <div className="incentive-runners">
          {standings.map((s) => (
            <RunnerRow key={s.key} s={s} myKey={myKey} metric={incentive.metric} />
          ))}
        </div>
      )}

      {(runners.length > 0 || meInRunners) && (
        <div className="incentive-runners">
          {runners.map((s) => (
            <RunnerRow key={s.key} s={s} myKey={myKey} metric={incentive.metric} />
          ))}
          {meInRunners && myRank && (
            <RunnerRow s={myRank} myKey={myKey} metric={incentive.metric} />
          )}
        </div>
      )}

      <div className="incentive-prize">
        <Crown size={14} />
        <span>
          Siegerprämie für Platz 1: <strong>{incentive.reward}</strong>
        </span>
      </div>
    </div>
  );
}

function RunnerRow({
  s,
  myKey,
  metric,
}: {
  s: Standing;
  myKey: string;
  metric: IncentiveMetric;
}) {
  return (
    <div className={`incentive-runner-row ${s.key === myKey ? 'is-me' : ''}`}>
      <span className="incentive-runner-rank">{s.rank}</span>
      <span className="incentive-runner-name">
        {s.displayName}
        {s.key === myKey && <span className="incentive-you-tag">DU</span>}
      </span>
      <span className="incentive-runner-value">{formatMetric(metric, s.value)}</span>
    </div>
  );
}

function IncentivePodium({
  rows,
  myKey,
  metric,
}: {
  rows: Standing[];
  myKey: string;
  metric: IncentiveMetric;
}) {
  // visuelle Reihenfolge: 2 – 1 – 3
  const order = [rows[1], rows[0], rows[2]];
  const places = [2, 1, 3];

  return (
    <div className="arcade-podium">
      {order.map((r, i) => {
        const place = places[i];
        const mine = r.key === myKey;
        return (
          <div
            key={r.key}
            className={`arcade-podium-col place-${place} ${mine ? 'is-me' : ''}`}
          >
            {place === 1 && <Crown size={18} className="arcade-crown" />}
            <div className="arcade-podium-avatar">{initialsOf(r.displayName)}</div>
            <div className="arcade-podium-name">
              {r.displayName}
              {mine && <span className="incentive-you-tag">DU</span>}
            </div>
            <div className="arcade-podium-score">{formatMetric(metric, r.value)}</div>
            <div className="arcade-podium-block">
              <span className="arcade-podium-rank">{place}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
