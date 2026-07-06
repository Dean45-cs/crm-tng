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
  Target,
  LogOut,
  Download,
  ShieldCheck,
} from 'lucide-react';
import { useRouter, type Route, type RouteName } from '../router';
import { useAuth } from '../store/useAuth';
import { usePwaInstall } from '../lib/pwaInstall';
import { TngMark } from './TngLogo';

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
        { id: 'leads', label: 'Leads', icon: <Target size={16} /> },
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
        { id: 'auditlog', label: 'Audit-Log', icon: <ShieldCheck size={16} /> },
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

  const { canInstall, install } = usePwaInstall();

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
        {/* Ruhiges, typografisches Lockup: echte Wortmarke statt Icon-Kachel */}
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark" aria-hidden>
            <TngMark height={15} color="currentColor" />
          </span>
          <div className="sidebar-title">Stadtnetz CRM</div>
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

      {canInstall && (
        <button
          className="sidebar-install-btn"
          onClick={() => { install(); }}
          title="App auf diesem Gerät installieren"
        >
          <Download size={13} />
          <span>App installieren</span>
        </button>
      )}

      <div className="sidebar-footer">
        CRM v1.4 · 2026
      </div>
    </aside>
  );
}
