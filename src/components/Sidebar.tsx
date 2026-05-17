import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  FileSignature,
  ArrowLeftRight,
  StickyNote,
  Settings as SettingsIcon,
  Users,
  UsersRound,
  BarChart3,
  Trophy,
  Gift,
  Award,
  LogOut,
  Download,
} from 'lucide-react';
import { useRouter, type Route, type RouteName } from '../router';
import { useAuth } from '../store/useAuth';
import { TngTile } from './TngLogo';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface NavItemDef {
  id: RouteName;
  label: string;
  icon: React.ReactNode;
}

function buildSections(showChef: boolean): { title: string; items: NavItemDef[] }[] {
  const sections: { title: string; items: NavItemDef[] }[] = [
    {
      title: 'Übersicht',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={16} /> },
        { id: 'leaderboard', label: 'Leaderboard', icon: <Trophy size={16} /> },
        { id: 'incentives', label: 'Incentives', icon: <Gift size={16} /> },
      ],
    },
    {
      title: 'Verkauf',
      items: [
        { id: 'contracts', label: 'Verträge', icon: <FileSignature size={16} /> },
        { id: 'tariff', label: 'Tarifwechsel', icon: <ArrowLeftRight size={16} /> },
        { id: 'notes', label: 'Notizen', icon: <StickyNote size={16} /> },
      ],
    },
    {
      title: 'Stamm',
      items: [
        { id: 'customers', label: 'Kunden', icon: <Users size={16} /> },
      ],
    },
  ];

  if (showChef) {
    sections.push({
      title: 'Chef',
      items: [
        { id: 'teamdashboard', label: 'Team-Dashboard', icon: <BarChart3 size={16} /> },
        { id: 'teammanager', label: 'Team-Verwaltung', icon: <UsersRound size={16} /> },
        { id: 'incentivemanager', label: 'Incentive-Verwaltung', icon: <Award size={16} /> },
      ],
    });
  }

  sections.push({
    title: 'System',
    items: [
      { id: 'settings', label: 'Einstellungen', icon: <SettingsIcon size={16} /> },
    ],
  });

  return sections;
}

export function Sidebar() {
  const { route, navigate } = useRouter();
  const { getCurrentUser, isManager, logout } = useAuth();
  const currentUser = getCurrentUser();
  const sections = buildSections(isManager());
  const active: RouteName =
    route.name === 'customer'
      ? 'customers'
      : route.name === 'agentdetail'
        ? 'teamdashboard'
        : route.name;

  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(
    // bereits installiert? (standalone-Modus erkennen)
    typeof window !== 'undefined' &&
      (window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as { standalone?: boolean }).standalone === true),
  );

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  const initials = currentUser
    ? currentUser.displayName
        .split(/\s+/)
        .map((p) => p[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '';

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <TngTile size={40} />

        <div>
          <div className="sidebar-title">Stadtnetz CRM</div>
          <div className="sidebar-subtitle">TNG Stadtnetz GmbH</div>
        </div>
      </div>

      {sections.map((section) => (
        <div key={section.title}>
          <div className="sidebar-section">{section.title}</div>
          {section.items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sidebar-item sidebar-item-${item.id} ${active === item.id ? 'active' : ''}`}
              onClick={() => navigate({ name: item.id } as Route)}
              aria-current={active === item.id ? 'page' : undefined}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ))}

      {currentUser && (
        <div className="sidebar-user">
          <div className="sidebar-user-avatar">{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sidebar-user-name">{currentUser.displayName}</div>
            <div className="sidebar-user-role">
              {currentUser.role === 'manager' ? 'Chef' : 'Vertrieb'}
            </div>
          </div>
          <button
            className="sidebar-user-logout"
            onClick={logout}
            title="Abmelden"
            aria-label="Abmelden"
          >
            <LogOut size={14} />
          </button>
        </div>
      )}

      {installPrompt && !installed && (
        <button
          className="sidebar-install-btn"
          onClick={handleInstall}
          title="App auf diesem Gerät installieren"
        >
          <Download size={13} />
          <span>App installieren</span>
        </button>
      )}

      <div className="sidebar-footer">
        CRM v1.3 · 2026
      </div>
    </aside>
  );
}
