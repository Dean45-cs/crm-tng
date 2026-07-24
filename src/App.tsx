import { lazy, Suspense, useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { PrivacyConsent } from './components/PrivacyConsent';
import { QuickAddProvider } from './components/QuickAdd';
import { ToastHost } from './components/ToastHost';
import { CommandPalette } from './components/CommandPalette';
import { CustomerSearchBar } from './components/CustomerSearchBar';
import { StatusBar } from './components/StatusBar';
import { LiveCallBar } from './components/LiveCallBar';
import { LoginScreen } from './components/LoginScreen';
import { OnboardingTour } from './components/OnboardingTour';
import { SupabaseSetup } from './components/SupabaseSetup';
import { SkeletonPage, SkeletonShell } from './components/Skeleton';
import { TngMark } from './components/TngLogo';
import { Router, useRouter, type RouteName } from './router';
import { useAuth } from './store/useAuth';
import { useOnboarding, useOnboardingHotkey } from './store/useOnboarding';
import { useStore } from './store/useStore';
import { useStatus } from './store/useStatus';
import { useCalls } from './store/useCalls';
import { isConfigured, onConfigChange } from './lib/supabase';

// Seiten werden bei Bedarf nachgeladen (Code-Splitting). Das hält das
// Start-Bundle klein — schwere Abhängigkeiten wie Charts (recharts) und
// der SharePoint-Login (MSAL) landen nur in den Chunks, die sie brauchen.
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
const NettoRechner = lazy(() => import('./pages/NettoRechner').then((m) => ({ default: m.NettoRechner })));
const Schedule = lazy(() => import('./pages/Schedule').then((m) => ({ default: m.Schedule })));
const CampaignManager = lazy(() => import('./pages/CampaignManager').then((m) => ({ default: m.CampaignManager })));

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
  netto: 'Netto-Rechner',
  schedule: 'Schichtplan',
  campaignmanager: 'Kampagnen-Verwaltung',
};

function PageFallback() {
  return <SkeletonPage />;
}

/**
 * Lädt alle Seiten-Chunks einmalig im Browser-Leerlauf vor. Seitenwechsel
 * treffen danach nie mehr aufs Netz — kein Skeleton-Aufblitzen beim ersten
 * Öffnen einer Seite.
 */
let pagesPrefetched = false;
function prefetchAllPages() {
  if (pagesPrefetched) return;
  pagesPrefetched = true;
  const idle: (cb: () => void) => void =
    'requestIdleCallback' in window
      ? (cb) => window.requestIdleCallback(cb, { timeout: 4000 })
      : (cb) => window.setTimeout(cb, 1500);
  idle(() => {
    void Promise.allSettled([
      import('./pages/Dashboard'),
      import('./pages/Contracts'),
      import('./pages/TariffChanges'),
      import('./pages/Notes'),
      import('./pages/Settings'),
      import('./pages/Customers'),
      import('./pages/CustomerDetail'),
      import('./pages/Leaderboard'),
      import('./pages/MonthlyReport'),
      import('./pages/TeamDashboard'),
      import('./pages/TeamManagement'),
      import('./pages/TeamReport'),
      import('./pages/AgentDetail'),
      import('./pages/Incentives'),
      import('./pages/IncentiveManager'),
      import('./pages/Leads'),
      import('./pages/AuditLog'),
      import('./pages/NettoRechner'),
      import('./pages/Schedule'),
      import('./pages/CampaignManager'),
    ]);
  });
}

function Shell() {
  const { route } = useRouter();

  if (route.name === 'report') {
    return (
      <Suspense fallback={<ReportFallback />}>
        <MonthlyReport />
      </Suspense>
    );
  }
  if (route.name === 'teamreport') {
    return (
      <Suspense fallback={<ReportFallback />}>
        <TeamReport />
      </Suspense>
    );
  }

  const pageKey =
    route.name === 'customer'
      ? `customer-${route.kdnr}`
      : route.name === 'agentdetail'
        ? `agent-${route.agentKey}`
        : route.name;

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
            <LiveCallBar />
            <StatusBar />
            <span className="muted titlebar-date">
              {new Date().toLocaleDateString('de-DE', {
                weekday: 'long',
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
            </span>
          </div>
        </header>
        <div className="content">
          <div className="content-inner" key={pageKey}>
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
              {route.name === 'netto' && <NettoRechner />}
              {route.name === 'schedule' && <Schedule />}
              {route.name === 'campaignmanager' && <CampaignManager />}
            </Suspense>
          </div>
        </div>
      </main>
    </div>
  );
}

/** Start-Ansicht: App-Gerüst als Skeleton statt Spinner — wirkt sofort da. */
function LoadingScreen() {
  return (
    <SkeletonShell
      brand={
        <span className="sidebar-brand-mark">
          <TngMark height={15} color="currentColor" />
        </span>
      }
    />
  );
}

/** Fallback für die Druck-/Berichtsansichten (eigenes Layout ohne Sidebar). */
function ReportFallback() {
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px' }}>
      <SkeletonPage />
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

  const loadStatus = useStatus((s) => s.load);
  const subscribeStatus = useStatus((s) => s.subscribeRealtime);
  const resetStatus = useStatus((s) => s.reset);

  const loadCalls = useCalls((s) => s.load);
  const subscribeCalls = useCalls((s) => s.subscribeRealtime);
  const resetCalls = useCalls((s) => s.reset);

  const [configured, setConfigured] = useState(isConfigured());

  // Tour-Steuerung: „." + „o" gleichzeitig öffnet die Einführungstour erneut
  // (aktiv, sobald jemand angemeldet ist und den Datenschutzhinweis bestätigt hat).
  const tourRequested = useOnboarding((s) => s.open);
  const signedInUser = currentUserKey ? users[currentUserKey] : null;
  useOnboardingHotkey(Boolean(configured && signedInUser?.consentGivenAt));

  useEffect(() => {
    if (!configured) return;
    clearLegacyLocalStores();
    init();
  }, [configured, init]);

  useEffect(() => {
    if (!configured || !currentUserKey) {
      resetStore();
      resetStatus();
      resetCalls();
      return;
    }
    loadAll();
    loadStatus();
    loadCalls();
    const unsub = subscribeRealtime();
    const unsubStatus = subscribeStatus();
    const unsubCalls = subscribeCalls();
    return () => {
      unsub();
      unsubStatus();
      unsubCalls();
    };
  }, [
    configured,
    currentUserKey,
    loadAll,
    subscribeRealtime,
    resetStore,
    loadStatus,
    subscribeStatus,
    resetStatus,
    loadCalls,
    subscribeCalls,
    resetCalls,
  ]);

  useEffect(() => onConfigChange(() => setConfigured(isConfigured())), []);

  // Alle Seiten-Chunks im Leerlauf vorladen, sobald das Backend konfiguriert
  // ist — jeder spätere Seitenwechsel ist dann sofort da.
  useEffect(() => {
    if (configured) prefetchAllPages();
  }, [configured]);

  if (!configured) {
    return <SupabaseSetup />;
  }

  if (initializing) {
    return <LoadingScreen />;
  }

  if (!currentUserKey) {
    return <LoginScreen />;
  }

  const user = users[currentUserKey];
  const needsConsent = user && !user.consentGivenAt;
  // Tour beim ersten Login automatisch, danach jederzeit per „." + „o"
  // oder über die Einstellungen erneut.
  const showTour = user && user.consentGivenAt && (!user.onboardingCompleted || tourRequested);

  return (
    <Router>
      <QuickAddProvider>
        <OfflineBanner />
        <Shell />
        {needsConsent && <PrivacyConsent />}
        {showTour && <OnboardingTour />}
        <CommandPalette />
        <ToastHost />
      </QuickAddProvider>
    </Router>
  );
}
