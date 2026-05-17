import { useMemo } from 'react';
import { Gift, Target, Trophy, Check, Crown, ChevronRight } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { useRouter } from '../router';
import { formatCurrency } from '../lib/utils';
import {
  incentiveValue,
  incentiveStandings,
  incentiveReached,
} from '../lib/incentives';
import type { IncentiveMetric } from '../types';

function shortMetric(metric: IncentiveMetric, value: number): string {
  if (metric === 'commission') return formatCurrency(value);
  return String(value);
}

/**
 * Kompaktes Dashboard-Widget mit den laufenden Incentives und dem eigenen
 * Fortschritt. Rendert nichts, wenn keine aktiven Incentives existieren.
 */
export function IncentiveWidget() {
  const { contracts, tariffChanges, settings, incentives } = useStore();
  const { users, getCurrentUser } = useAuth();
  const { navigate } = useRouter();

  const myKey = getCurrentUser()?.key ?? '';
  const active = useMemo(
    () => incentives.filter((i) => i.active).slice(0, 4),
    [incentives],
  );

  if (active.length === 0) return null;

  return (
    <div className="widget" style={{ marginBottom: 14 }}>
      <div className="row between" style={{ marginBottom: 12 }}>
        <h3
          className="widget-title"
          style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Gift size={15} /> Incentives
        </h3>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => navigate({ name: 'incentives' })}
        >
          Alle ansehen <ChevronRight size={13} />
        </button>
      </div>

      <div className="incentive-widget-list">
        {active.map((inc) => {
          if (inc.mechanic === 'goal') {
            const value = incentiveValue(
              inc,
              myKey,
              contracts,
              tariffChanges,
              settings,
            );
            const reached = incentiveReached(inc, value);
            const pct =
              inc.target > 0
                ? Math.min(100, Math.round((value / inc.target) * 100))
                : 0;
            return (
              <div key={inc.id} className="incentive-widget-row">
                <div className="incentive-widget-top">
                  <span className="incentive-widget-name">
                    <Target size={13} /> {inc.title}
                  </span>
                  <span className={reached ? 'incentive-reached' : 'muted'}>
                    {reached ? (
                      <>
                        <Check size={12} /> erreicht
                      </>
                    ) : (
                      `${shortMetric(inc.metric, value)} / ${shortMetric(
                        inc.metric,
                        inc.target,
                      )}`
                    )}
                  </span>
                </div>
                <div className="incentive-progress sm">
                  <div
                    className="incentive-progress-fill"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          }

          const standings = incentiveStandings(
            inc,
            users,
            contracts,
            tariffChanges,
            settings,
          );
          const myRank = standings.find((s) => s.key === myKey);
          return (
            <div key={inc.id} className="incentive-widget-row">
              <div className="incentive-widget-top">
                <span className="incentive-widget-name">
                  <Trophy size={13} /> {inc.title}
                </span>
                <span className={myRank?.rank === 1 ? 'incentive-reached' : 'muted'}>
                  {myRank ? (
                    myRank.rank === 1 ? (
                      <>
                        <Crown size={12} /> Platz 1
                      </>
                    ) : (
                      `Platz ${myRank.rank} von ${standings.length}`
                    )
                  ) : (
                    '–'
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
