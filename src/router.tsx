import { createContext, useContext, useState, type ReactNode } from 'react';

export type Route =
  | { name: 'dashboard' }
  | { name: 'contracts' }
  | { name: 'tariff' }
  | { name: 'notes' }
  | { name: 'customers' }
  | { name: 'customer'; kdnr: string }
  | { name: 'leaderboard' }
  | { name: 'settings' }
  | { name: 'report' }
  | { name: 'teamdashboard' }
  | { name: 'teammanager' }
  | { name: 'teamreport' }
  | { name: 'agentdetail'; agentKey: string }
  | { name: 'incentives' }
  | { name: 'incentivemanager' }
  | { name: 'leads' }
  | { name: 'auditlog' }
  | { name: 'netto' };

export type RouteName = Route['name'];

interface RouterCtx {
  route: Route;
  navigate: (route: Route) => void;
}

const Ctx = createContext<RouterCtx | null>(null);

// Context-Hook bewusst neben dem Provider — der Fast-Refresh-Hinweis ist
// nur eine Dev-DX-Warnung und ohne Laufzeit-Auswirkung.
// eslint-disable-next-line react-refresh/only-export-components
export const useRouter = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useRouter must be used within Router');
  return c;
};

// Deep-Link für die Befehlspalette der Extension (Stufe 4,
// KONZEPT-INTEGRATION.md): ein Treffer in Jira/timio öffnet
// `${crmBaseUrl}/?kdnr=...` in einem neuen Tab. Der Router selbst bleibt
// speicherbasiert (keine echten URLs pro Seite) — nur der Startzustand
// wird einmalig aus der URL gelesen, danach verhält sich navigate()
// unverändert. Ohne Parameter identisch zum bisherigen Verhalten. Als reine
// Funktion exportiert (statt direkt `window.location` im Hook zu lesen),
// damit sie ohne DOM/jsdom unit-testbar ist. Fast-Refresh-Hinweis wie beim
// useRouter-Hook oben: reine Dev-DX-Warnung, ohne Laufzeit-Auswirkung.
// eslint-disable-next-line react-refresh/only-export-components
export function routeFromSearch(search: string): Route {
  const kdnr = new URLSearchParams(search).get('kdnr');
  return kdnr ? { name: 'customer', kdnr } : { name: 'dashboard' };
}

export function Router({ children }: { children: ReactNode }) {
  const [route, navigate] = useState<Route>(() => routeFromSearch(window.location.search));
  return <Ctx.Provider value={{ route, navigate }}>{children}</Ctx.Provider>;
}
