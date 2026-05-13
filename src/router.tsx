import { createContext, useContext, useState, type ReactNode } from 'react';

export type Route =
  | { name: 'dashboard' }
  | { name: 'contracts' }
  | { name: 'tariff' }
  | { name: 'notes' }
  | { name: 'customers' }
  | { name: 'customer'; kdnr: string }
  | { name: 'settings' };

export type RouteName = Route['name'];

interface RouterCtx {
  route: Route;
  navigate: (route: Route) => void;
}

const Ctx = createContext<RouterCtx | null>(null);

export const useRouter = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useRouter must be used within Router');
  return c;
};

export function Router({ children }: { children: ReactNode }) {
  const [route, navigate] = useState<Route>({ name: 'dashboard' });
  return <Ctx.Provider value={{ route, navigate }}>{children}</Ctx.Provider>;
}
