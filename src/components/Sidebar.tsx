import {
  LayoutDashboard,
  FileSignature,
  ArrowLeftRight,
  StickyNote,
  Settings as SettingsIcon,
} from 'lucide-react';
import type { Page } from '../App';

interface Props {
  current: Page;
  onChange: (page: Page) => void;
}

const NAV: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={16} /> },
  { id: 'contracts', label: 'Verträge', icon: <FileSignature size={16} /> },
  { id: 'tariff', label: 'Tarifwechsel', icon: <ArrowLeftRight size={16} /> },
  { id: 'notes', label: 'Notizen', icon: <StickyNote size={16} /> },
  { id: 'settings', label: 'Einstellungen', icon: <SettingsIcon size={16} /> },
];

export function Sidebar({ current, onChange }: Props) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">TNG</div>
        <div>
          <div className="sidebar-title">Stadtnetz CRM</div>
          <div className="sidebar-subtitle">Ausbildung</div>
        </div>
      </div>

      <div className="sidebar-section">Übersicht</div>
      {NAV.slice(0, 1).map((item) => (
        <NavItem
          key={item.id}
          item={item}
          active={current === item.id}
          onClick={() => onChange(item.id)}
        />
      ))}

      <div className="sidebar-section">Verkauf</div>
      {NAV.slice(1, 4).map((item) => (
        <NavItem
          key={item.id}
          item={item}
          active={current === item.id}
          onClick={() => onChange(item.id)}
        />
      ))}

      <div className="sidebar-section">System</div>
      {NAV.slice(4).map((item) => (
        <NavItem
          key={item.id}
          item={item}
          active={current === item.id}
          onClick={() => onChange(item.id)}
        />
      ))}

      <div className="sidebar-footer">
        TNG Stadtnetz GmbH · CRM v1.0
      </div>
    </aside>
  );
}

function NavItem({
  item,
  active,
  onClick,
}: {
  item: { id: Page; label: string; icon: React.ReactNode };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`sidebar-item ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      {item.icon}
      <span>{item.label}</span>
    </div>
  );
}
