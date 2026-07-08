import type { CSSProperties } from 'react';

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: CSSProperties;
}

/** Einzelner Schimmer-Platzhalter. */
export function Skeleton({ width, height = 14, radius = 6, style }: SkeletonProps) {
  return (
    <span
      className="skeleton"
      aria-hidden
      style={{ width: width ?? '100%', height, borderRadius: radius, ...style }}
    />
  );
}

/** Tabellen-Gerüst mit Kopfzeile und Platzhalter-Zeilen. */
export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="skeleton-table" aria-hidden>
      <div className="skeleton-table-head">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} height={11} width={i === 1 ? '55%' : '75%'} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="skeleton-table-row">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} height={13} width={c === 1 ? '60%' : '80%'} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Raster aus Karten-Platzhaltern (Kunden, Notizen). */
export function SkeletonCardGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="skeleton-card-grid" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-card">
          <Skeleton width={42} height={42} radius={12} />
          <div className="skeleton-card-body">
            <Skeleton height={14} width="65%" />
            <Skeleton height={11} width="40%" />
            <Skeleton height={11} width="85%" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Dashboard-Gerüst: Hero-Reihe plus zwei Widget-Reihen. */
export function SkeletonDashboard() {
  return (
    <div aria-hidden aria-busy="true">
      <div className="widget-row hero-row">
        <div className="widget skeleton-block" style={{ minHeight: 150 }} />
        <div className="widget-mini-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="widget skeleton-block" style={{ minHeight: 96 }} />
          ))}
        </div>
      </div>
      <div className="grid-2" style={{ marginBottom: 10 }}>
        <div className="widget skeleton-block" style={{ minHeight: 280 }} />
        <div className="widget skeleton-block" style={{ minHeight: 280 }} />
      </div>
      <div className="grid-2">
        <div className="widget skeleton-block" style={{ minHeight: 220 }} />
        <div className="widget skeleton-block" style={{ minHeight: 220 }} />
      </div>
    </div>
  );
}
