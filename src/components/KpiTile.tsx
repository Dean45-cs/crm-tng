import type { ReactNode } from 'react';

type Accent = 'blue' | 'orange' | 'purple' | 'green' | 'red';

interface Props {
  /** Icon in der Kachel-Ecke — ohne Icon entfällt auch die Akzentfarbe (AgentDetail nutzt das). */
  icon?: ReactNode;
  accent?: Accent;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}

/**
 * Einzige KPI-Kachel-Komponente — vorher gab es zwei byte-identische Kopien
 * (`KpiTile` in TeamDashboard.tsx, `MiniTile` in StatusInsights.tsx) plus
 * vier von Hand nachgebaute Blöcke in AgentDetail.tsx.
 */
export function KpiTile({ icon, accent, label, value, sub }: Props) {
  return (
    <div className="widget team-kpi">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="team-kpi-label">{label}</div>
        {icon && <span className={`team-kpi-icon accent-${accent ?? 'blue'}`}>{icon}</span>}
      </div>
      <div className="team-kpi-value">{value}</div>
      {sub != null && <div className="team-kpi-sub">{sub}</div>}
    </div>
  );
}
