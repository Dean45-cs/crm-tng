import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { Contracts } from './pages/Contracts';
import { TariffChanges } from './pages/TariffChanges';
import { Notes } from './pages/Notes';
import { Settings } from './pages/Settings';
import { Customers } from './pages/Customers';
import { CustomerDetail } from './pages/CustomerDetail';
import { Leaderboard } from './pages/Leaderboard';
import { QuickAddProvider } from './components/QuickAdd';
import { LoginScreen } from './components/LoginScreen';
import { OnboardingTour } from './components/OnboardingTour';
import { TngLogo } from './components/TngLogo';
import { Router, useRouter, type RouteName } from './router';
import { useAuth } from './store/useAuth';

const TITLES: Record<RouteName, string> = {
  dashboard: 'Dashboard',
  contracts: 'Verträge',
  tariff: 'Tarifwechsel',
  notes: 'Notizen',
  customers: 'Kunden',
  customer: 'Kunde',
  leaderboard: 'Leaderboard',
  settings: 'Einstellungen',
};

function Shell() {
  const { route } = useRouter();
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <header className="titlebar">
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            <h1>{TITLES[route.name]}</h1>
          </div>
          <div className="row" style={{ gap: 14, alignItems: 'center' }}>
            <span className="muted">
              {new Date().toLocaleDateString('de-DE', {
                weekday: 'long',
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
            </span>
            <div className="titlebar-brand" title="TNG Stadtnetz GmbH">
              <TngLogo height={22} color="blue" />
            </div>
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
            {route.name === 'leaderboard' && <Leaderboard />}
            {route.name === 'settings' && <Settings />}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const currentUserKey = useAuth((s) => s.currentUserKey);
  const users = useAuth((s) => s.users);

  if (!currentUserKey) {
    return <LoginScreen />;
  }

  const user = users[currentUserKey];
  const needsOnboarding = user && !user.onboardingCompleted;

  return (
    <Router>
      <QuickAddProvider>
        <Shell />
        {needsOnboarding && <OnboardingTour />}
      </QuickAddProvider>
    </Router>
  );
}
