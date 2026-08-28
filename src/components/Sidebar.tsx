import { useState } from 'react';
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
  Calculator,
  CalendarDays,
  Megaphone,
  FileChartColumn,
  Inbox,
  ChevronRight,
  MoreHorizontal,
  PhoneCall,
} from 'lucide-react';
import { useRouter, type Route, type RouteName } from '../router';
import { useAuth } from '../store/useAuth';
import { useNotifications, unreadCount } from '../store/useNotifications';
import { usePwaInstall } from '../lib/pwaInstall';
import { TngMark } from './TngLogo';

interface NavItemDef {
  id: RouteName;
  label: string;
  icon: React.ReactNode;
}

interface NavSection {
  title: string;
  items: NavItemDef[];
  /** Eigene, einklappbare Zeile innerhalb der Sektion (z.B. "Mehr") */
  more?: NavItemDef[];
  /** Ganze Sektion einklappbar (z.B. Chef-Werkzeuge) */
  collapsible?: boolean;
}

// Seltener genutzte Einträge, die standardmäßig hinter "Mehr" verschwinden
const MORE_IDS: RouteName[] = ['leaderboard', 'incentives', 'netto'];
// Sektionen, die standardmäßig eingeklappt sind, außer man ist gerade drin
const CHEF_IDS: RouteName[] = [
  'teamdashboard',
  'teammanager',
  'incentivemanager',
  'campaignmanager',
  'auditlog',
];

function buildSections(showChef: boolean): NavSection[] {
  const sections: NavSection[] = [
    {
      title: 'Übersicht',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={16} /> },
        { id: 'reports', label: 'Berichte', icon: <FileChartColumn size={16} /> },
        { id: 'schedule', label: 'Schichtplan', icon: <CalendarDays size={16} /> },
        { id: 'postfach', label: 'Postfach', icon: <Inbox size={16} /> },
      ],
      more: [
        { id: 'leaderboard', label: 'Leaderboard', icon: <Trophy size={16} /> },
        { id: 'incentives', label: 'Incentives', icon: <Gift size={16} /> },
        { id: 'netto', label: 'Netto-Rechner', icon: <Calculator size={16} /> },
      ],
    },
    {
      title: 'Verkauf',
      items: [
        { id: 'leads', label: 'Leads', icon: <Target size={16} /> },
        { id: 'outbound', label: 'Outbound', icon: <PhoneCall size={16} /> },
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
      collapsible: true,
      items: [
        { id: 'teamdashboard', label: 'Team-Dashboard', icon: <BarChart3 size={16} /> },
        { id: 'teammanager', label: 'Team-Verwaltung', icon: <UsersRound size={16} /> },
        { id: 'incentivemanager', label: 'Incentive-Verwaltung', icon: <Award size={16} /> },
        { id: 'campaignmanager', label: 'Kampagnen-Verwaltung', icon: <Megaphone size={16} /> },
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

  // "Mehr" und Chef-Sektion starten eingeklappt, öffnen sich aber automatisch,
  // sobald man auf einer darin liegenden Route steht.
  const [moreOpen, setMoreOpen] = useState(() => MORE_IDS.includes(active));
  const [chefOpen, setChefOpen] = useState(() => CHEF_IDS.includes(active));

  const { canInstall, install } = usePwaInstall();
  // Ungelesene stehen auch an der Seitenleiste, nicht nur an der Glocke: wer
  // gerade in einer Kundenakte arbeitet, schaut nach links, nicht nach oben.
  const unread = useNotifications((s) => unreadCount(s.items));

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

      {sections.map((section) => {
        const isChef = section.collapsible;
        const sectionOpen = isChef ? chefOpen : true;
        return (
          <div key={section.title}>
            {isChef ? (
              <button
                type="button"
                className="sidebar-section sidebar-section-toggle"
                onClick={() => setChefOpen((v) => !v)}
                aria-expanded={sectionOpen}
              >
                <span>{section.title}</span>
                <ChevronRight size={12} className={sectionOpen ? 'sidebar-chevron-open' : ''} />
              </button>
            ) : (
              <div className="sidebar-section">{section.title}</div>
            )}
            {sectionOpen &&
              section.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`sidebar-item sidebar-item-${item.id} ${active === item.id ? 'active' : ''}`}
                  onClick={() => navigate({ name: item.id } as Route)}
                  aria-current={active === item.id ? 'page' : undefined}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {item.id === 'postfach' && unread > 0 && (
                    <span className="sidebar-badge">{unread > 99 ? '99+' : unread}</span>
                  )}
                </button>
              ))}
            {section.more && (
              <>
                <button
                  type="button"
                  className="sidebar-item sidebar-item-more"
                  onClick={() => setMoreOpen((v) => !v)}
                  aria-expanded={moreOpen}
                >
                  <MoreHorizontal size={16} />
                  <span>Mehr</span>
                  <ChevronRight
                    size={12}
                    className={`sidebar-chevron ${moreOpen ? 'sidebar-chevron-open' : ''}`}
                  />
                </button>
                {moreOpen &&
                  section.more.map((item) => (
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
              </>
            )}
          </div>
        );
      })}

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
