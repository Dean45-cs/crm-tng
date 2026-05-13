import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { Contracts } from './pages/Contracts';
import { TariffChanges } from './pages/TariffChanges';
import { Notes } from './pages/Notes';
import { Settings } from './pages/Settings';
import { Customers } from './pages/Customers';
import { CustomerDetail } from './pages/CustomerDetail';
import { QuickAddProvider } from './components/QuickAdd';
import { Router, useRouter, type RouteName } from './router';

const TITLES: Record<RouteName, string> = {
  dashboard: 'Dashboard',
  contracts: 'Verträge',
  tariff: 'Tarifwechsel',
  notes: 'Notizen',
  customers: 'Kunden',
  customer: 'Kunde',
  settings: 'Einstellungen',
};

function Shell() {
  const { route } = useRouter();
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <header className="titlebar">
          <h1>{TITLES[route.name]}</h1>
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
            {route.name === 'dashboard' && <Dashboard />}
            {route.name === 'contracts' && <Contracts />}
            {route.name === 'tariff' && <TariffChanges />}
            {route.name === 'notes' && <Notes />}
            {route.name === 'customers' && <Customers />}
            {route.name === 'customer' && <CustomerDetail kdnr={route.kdnr} />}
            {route.name === 'settings' && <Settings />}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <QuickAddProvider>
        <Shell />
      </QuickAddProvider>
    </Router>
  );
}
