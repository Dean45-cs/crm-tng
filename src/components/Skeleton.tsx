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

/**
 * Generisches Seiten-Gerüst für Lazy-Chunk-Ladezeiten (Suspense-Fallback):
 * Kopfzeile plus Widget-Blöcke, damit der Seitenwechsel nie "leer" wirkt.
 */
export function SkeletonPage() {
  return (
    <div aria-hidden aria-busy="true">
      <div className="page-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
          <Skeleton height={22} width={220} radius={8} />
          <Skeleton height={13} width={340} />
        </div>
      </div>
      <div className="widget skeleton-block" style={{ minHeight: 120, marginBottom: 14 }} />
      <div className="widget skeleton-block" style={{ minHeight: 320 }} />
    </div>
  );
}

/**
 * App-Shell-Gerüst für den Start („Verbinde mit Server"): Sidebar, Titelleiste
 * und Dashboard-Blöcke als Skeleton — die App wirkt sofort da, statt hinter
 * einem Spinner zu warten.
 */
export function SkeletonShell({ brand }: { brand?: React.ReactNode }) {
  return (
    <div className="app" aria-hidden aria-busy="true">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand">
            {brand ?? <Skeleton width={64} height={15} radius={5} />}
            <Skeleton height={14} width={116} radius={6} />
          </div>
        </div>
        {[3, 4, 1].map((count, s) => (
          <div key={s}>
            <div className="sidebar-section">
              <Skeleton height={9} width={64} />
            </div>
            {Array.from({ length: count }).map((_, i) => (
              <div key={i} className="sidebar-item" style={{ pointerEvents: 'none' }}>
                <Skeleton width={16} height={16} radius={5} />
                <Skeleton height={12} width={`${55 + ((i * 13) % 30)}%`} />
              </div>
            ))}
          </div>
        ))}
      </aside>
      <main className="main">
        <header className="titlebar">
          <Skeleton height={18} width={160} radius={7} />
          <Skeleton height={14} width={260} radius={7} />
        </header>
        <div className="content">
          <div className="content-inner">
            <SkeletonDashboard />
          </div>
        </div>
      </main>
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
      <div className="grid-2" style={{ marginBottom: 14 }}>
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
