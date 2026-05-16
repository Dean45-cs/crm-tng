import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { Contracts } from './pages/Contracts';
import { TariffChanges } from './pages/TariffChanges';
import { Notes } from './pages/Notes';
import { Settings } from './pages/Settings';
import { Customers } from './pages/Customers';
import { CustomerDetail } from './pages/CustomerDetail';
import { Leaderboard } from './pages/Leaderboard';
import { MonthlyReport } from './pages/MonthlyReport';
import { QuickAddProvider } from './components/QuickAdd';
import { ToastHost } from './components/ToastHost';
import { LoginScreen } from './components/LoginScreen';
import { OnboardingTour } from './components/OnboardingTour';
import { SupabaseSetup } from './components/SupabaseSetup';
import { TngMark, TngTile } from './components/TngLogo';
import { Router, useRouter, type RouteName } from './router';
import { useAuth } from './store/useAuth';
import { useStore } from './store/useStore';
import { isConfigured } from './lib/supabase';

const TITLES: Record<RouteName, string> = {
  dashboard: 'Dashboard',
  contracts: 'Verträge',
  tariff: 'Tarifwechsel',
  notes: 'Notizen',
  customers: 'Kunden',
  customer: 'Kunde',
  leaderboard: 'Leaderboard',
  settings: 'Einstellungen',
  report: 'Monatsbericht',
};

function Shell() {
  const { route } = useRouter();

  if (route.name === 'report') {
    return <MonthlyReport />;
  }

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
              <TngMark height={18} color="#0066b3" />
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

function LoadingScreen({ label = 'Lade …' }: { label?: string }) {
  return (
    <div className="boot-screen">
      <div className="boot-brand">
        <TngTile size={72} radius={18} />
      </div>
      <div className="boot-spinner" />
      <div className="boot-label">{label}</div>
    </div>
  );
}

function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (!offline) return null;
  return (
    <div className="offline-banner">
      <WifiOff size={13} />
      <span>Keine Verbindung – Änderungen werden gespeichert, sobald du wieder online bist.</span>
    </div>
  );
}

/**
 * Beim Übergang von der alten Offline-Version: lokal gespeicherte
 * CRM-Daten einmal löschen, damit die App nicht zwischen lokalen und
 * Server-Daten mischt. Auth-Tokens und Supabase-Config bleiben.
 */
function clearLegacyLocalStores() {
  const flag = 'crm-tng-legacy-cleared-v1';
  if (localStorage.getItem(flag)) return;
  try {
    localStorage.removeItem('crm-tng-store');
    localStorage.removeItem('crm-tng-auth');
  } catch {
    /* ignore */
  }
  localStorage.setItem(flag, '1');
}

export default function App() {
  const initializing = useAuth((s) => s.initializing);
  const currentUserKey = useAuth((s) => s.currentUserKey);
  const users = useAuth((s) => s.users);
  const init = useAuth((s) => s.init);

  const loadAll = useStore((s) => s.loadAll);
  const subscribeRealtime = useStore((s) => s.subscribeRealtime);
  const resetStore = useStore((s) => s.reset);

  const [configured, setConfigured] = useState(isConfigured());

  useEffect(() => {
    if (!configured) return;
    clearLegacyLocalStores();
    init();
  }, [configured, init]);

  useEffect(() => {
    if (!configured || !currentUserKey) {
      resetStore();
      return;
    }
    loadAll();
    const unsub = subscribeRealtime();
    return () => unsub();
  }, [configured, currentUserKey, loadAll, subscribeRealtime, resetStore]);

  useEffect(() => {
    const t = setInterval(() => {
      const next = isConfigured();
      if (next !== configured) setConfigured(next);
    }, 800);
    return () => clearInterval(t);
  }, [configured]);

  if (!configured) {
    return <SupabaseSetup />;
  }

  if (initializing) {
    return <LoadingScreen label="Verbinde mit Server …" />;
  }

  if (!currentUserKey) {
    return <LoginScreen />;
  }

  const user = users[currentUserKey];
  const needsOnboarding = user && !user.onboardingCompleted;

  return (
    <Router>
      <QuickAddProvider>
        <OfflineBanner />
        <Shell />
        {needsOnboarding && <OnboardingTour />}
        <ToastHost />
      </QuickAddProvider>
    </Router>
  );
}
