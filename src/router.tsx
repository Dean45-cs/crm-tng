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
  | { name: 'auditlog' };

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

export function Router({ children }: { children: ReactNode }) {
  const [route, navigate] = useState<Route>({ name: 'dashboard' });
  return <Ctx.Provider value={{ route, navigate }}>{children}</Ctx.Provider>;
}
