import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { Contracts } from './pages/Contracts';
import { TariffChanges } from './pages/TariffChanges';
import { Notes } from './pages/Notes';
import { Settings } from './pages/Settings';
import { QuickAddProvider } from './components/QuickAdd';

export type Page =
  | 'dashboard'
  | 'contracts'
  | 'tariff'
  | 'notes'
  | 'settings';

const TITLES: Record<Page, string> = {
  dashboard: 'Dashboard',
  contracts: 'Verträge',
  tariff: 'Tarifwechsel',
  notes: 'Notizen',
  settings: 'Einstellungen',
};

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');

  return (
    <QuickAddProvider>
      <div className="app">
        <Sidebar current={page} onChange={setPage} />
        <main className="main">
          <header className="titlebar">
            <h1>{TITLES[page]}</h1>
            <div className="muted">
              {new Date().toLocaleDateString('de-DE', {
                weekday: 'long',
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
            </div>
          </header>
          <div className="content">
            <div className="content-inner">
              {page === 'dashboard' && <Dashboard />}
              {page === 'contracts' && <Contracts />}
              {page === 'tariff' && <TariffChanges />}
              {page === 'notes' && <Notes />}
              {page === 'settings' && <Settings />}
            </div>
          </div>
        </main>
      </div>
    </QuickAddProvider>
  );
}
