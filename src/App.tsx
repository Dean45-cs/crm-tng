import { lazy, Suspense, useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { Sidebar } from './components/Sidebar';

// Seiten werden bei Bedarf geladen (Code-Splitting) — das hält das
// Initial-Bundle (inkl. Login-Screen) klein; Charts (recharts) und
// selten genutzte Bereiche landen in eigenen Chunks.
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Contracts = lazy(() => import('./pages/Contracts').then((m) => ({ default: m.Contracts })));
const TariffChanges = lazy(() => import('./pages/TariffChanges').then((m) => ({ default: m.TariffChanges })));
const Notes = lazy(() => import('./pages/Notes').then((m) => ({ default: m.Notes })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const Customers = lazy(() => import('./pages/Customers').then((m) => ({ default: m.Customers })));
const CustomerDetail = lazy(() => import('./pages/CustomerDetail').then((m) => ({ default: m.CustomerDetail })));
const Leaderboard = lazy(() => import('./pages/Leaderboard').then((m) => ({ default: m.Leaderboard })));
const MonthlyReport = lazy(() => import('./pages/MonthlyReport').then((m) => ({ default: m.MonthlyReport })));
const TeamDashboard = lazy(() => import('./pages/TeamDashboard').then((m) => ({ default: m.TeamDashboard })));
const TeamManagement = lazy(() => import('./pages/TeamManagement').then((m) => ({ default: m.TeamManagement })));
const TeamReport = lazy(() => import('./pages/TeamReport').then((m) => ({ default: m.TeamReport })));
const AgentDetail = lazy(() => import('./pages/AgentDetail').then((m) => ({ default: m.AgentDetail })));
const Incentives = lazy(() => import('./pages/Incentives').then((m) => ({ default: m.Incentives })));
const IncentiveManager = lazy(() => import('./pages/IncentiveManager').then((m) => ({ default: m.IncentiveManager })));
const Leads = lazy(() => import('./pages/Leads').then((m) => ({ default: m.Leads })));
const AuditLog = lazy(() => import('./pages/AuditLog').then((m) => ({ default: m.AuditLog })));
import { PrivacyConsent } from './components/PrivacyConsent';
import { QuickAddProvider } from './components/QuickAdd';
import { ToastHost } from './components/ToastHost';
import { ConfirmHost } from './components/ConfirmHost';
import { CommandPalette } from './components/CommandPalette';
import { CustomerSearchBar } from './components/CustomerSearchBar';
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
  teamdashboard: 'Team-Dashboard',
  teammanager: 'Team-Verwaltung',
  teamreport: 'Team-Bericht',
  agentdetail: 'Mitarbeiter:in',
  incentives: 'Incentives',
  incentivemanager: 'Incentive-Verwaltung',
  leads: 'Leads',
  auditlog: 'Audit-Log',
};

function Shell() {
  const { route } = useRouter();

  if (route.name === 'report') {
    return (
      <Suspense fallback={<LoadingScreen label="Bericht wird geladen …" />}>
        <MonthlyReport />
      </Suspense>
    );
  }
  if (route.name === 'teamreport') {
    return (
      <Suspense fallback={<LoadingScreen label="Bericht wird geladen …" />}>
        <TeamReport />
      </Suspense>
    );
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
            <CustomerSearchBar />
            <span className="muted titlebar-date">
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
            <Suspense fallback={<PageFallback />}>
              {route.name === 'dashboard' && <Dashboard />}
              {route.name === 'contracts' && <Contracts />}
              {route.name === 'tariff' && <TariffChanges />}
              {route.name === 'notes' && <Notes />}
              {route.name === 'customers' && <Customers />}
              {route.name === 'customer' && <CustomerDetail kdnr={route.kdnr} />}
              {route.name === 'leaderboard' && <Leaderboard />}
              {route.name === 'settings' && <Settings />}
              {route.name === 'teamdashboard' && <TeamDashboard />}
              {route.name === 'teammanager' && <TeamManagement />}
              {route.name === 'agentdetail' && <AgentDetail agentKey={route.agentKey} />}
              {route.name === 'incentives' && <Incentives />}
              {route.name === 'incentivemanager' && <IncentiveManager />}
              {route.name === 'leads' && <Leads />}
              {route.name === 'auditlog' && <AuditLog />}
            </Suspense>
          </div>
        </div>
      </main>
    </div>
  );
}

function LoadingScreen({ label = 'Verbinde mit Server …' }: { label?: string }) {
  return (
    <div className="boot-screen">
      <div className="boot-brand">
        <TngTile size={80} radius={20} />
      </div>
      <div className="boot-spinner" />
      <div className="boot-label">{label}</div>
    </div>
  );
}

function PageFallback() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: 360 }}>
      <div className="boot-spinner" />
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
  const needsConsent = user && !user.consentGivenAt;
  const needsOnboarding = user && user.consentGivenAt && !user.onboardingCompleted;

  return (
    <Router>
      <QuickAddProvider>
        <OfflineBanner />
        <Shell />
        {needsConsent && <PrivacyConsent />}
        {needsOnboarding && <OnboardingTour />}
        <CommandPalette />
        <ToastHost />
        <ConfirmHost />
      </QuickAddProvider>
    </Router>
  );
}
