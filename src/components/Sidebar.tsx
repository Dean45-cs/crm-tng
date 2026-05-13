import {
  LayoutDashboard,
  FileSignature,
  ArrowLeftRight,
  StickyNote,
  Settings as SettingsIcon,
  Users,
  Trophy,
  LogOut,
} from 'lucide-react';
import { useRouter, type Route, type RouteName } from '../router';
import { useAuth } from '../store/useAuth';
import { TngTile } from './TngLogo';

interface NavItemDef {
  id: RouteName;
  label: string;
  icon: React.ReactNode;
}

const SECTIONS: { title: string; items: NavItemDef[] }[] = [
  {
    title: 'Übersicht',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={16} /> },
      { id: 'leaderboard', label: 'Leaderboard', icon: <Trophy size={16} /> },
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
  {
    title: 'System',
    items: [
      { id: 'settings', label: 'Einstellungen', icon: <SettingsIcon size={16} /> },
    ],
  },
];

export function Sidebar() {
  const { route, navigate } = useRouter();
  const { getCurrentUser, logout } = useAuth();
  const currentUser = getCurrentUser();
  const active: RouteName =
    route.name === 'customer' ? 'customers' : route.name;

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
          <div className="sidebar-subtitle">Ausbildung</div>
        </div>
      </div>

      {SECTIONS.map((section) => (
        <div key={section.title}>
          <div className="sidebar-section">{section.title}</div>
          {section.items.map((item) => (
            <div
              key={item.id}
              className={`sidebar-item sidebar-item-${item.id} ${active === item.id ? 'active' : ''}`}
              onClick={() => navigate({ name: item.id } as Route)}
            >
              {item.icon}
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      ))}

      {currentUser && (
        <div className="sidebar-user">
          <div className="sidebar-user-avatar">{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sidebar-user-name">{currentUser.displayName}</div>
            <div className="sidebar-user-role">Angemeldet</div>
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

      <div className="sidebar-footer">
        TNG Stadtnetz GmbH · CRM v1.2
      </div>
    </aside>
  );
}
