import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

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
  | { name: 'reports' }
  | { name: 'teamdashboard' }
  | { name: 'teammanager' }
  | { name: 'teamreport' }
  | { name: 'agentdetail'; agentKey: string }
  | { name: 'incentives' }
  | { name: 'incentivemanager' }
  | { name: 'leads' }
  | { name: 'outbound' }
  | { name: 'auditlog' }
  | { name: 'netto' }
  | { name: 'schedule' }
  | { name: 'campaignmanager' }
  | { name: 'postfach' };

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

// Liest kdnr aus einer Such-Zeichenkette – gibt null zurück, wenn keiner da ist.
// Getrennt von routeFromSearch, weil der Nach-Mount-Pfad (unten) bei fehlendem
// kdnr NICHT aufs Dashboard springen soll, sondern gar nichts tut.
function kdnrFromSearch(search: string): string | null {
  return new URLSearchParams(search).get('kdnr');
}

export function Router({ children }: { children: ReactNode }) {
  const [route, navigate] = useState<Route>(() => routeFromSearch(window.location.search));

  // Der useState-Initializer oben liest die URL nur ein einziges Mal – beim
  // ersten Mounten dieses Providers. Das reicht nicht in zwei realen Fällen:
  //
  //   1. Der Provider mountet erst NACH dem Login (siehe App.tsx: vorher steht
  //      der Login-Screen, der Router ist noch gar nicht da). Kommt der Deep-Link
  //      von einem nicht angemeldeten Zustand, lief der Initializer zwar mit
  //      korrektem kdnr – dieser Effekt ist die Absicherung, falls sich das
  //      Mount-Timing künftig verschiebt.
  //   2. Der CRM-Tab ist schon offen (angemeldet, auf dem Dashboard), und das
  //      HUD bzw. die Extension öffnet ihn per `?kdnr=`-URL erneut. Dann ist der
  //      Router längst gemountet, der Initializer läuft nicht noch einmal – und
  //      ohne diesen Effekt bliebe man auf der Startseite, obwohl der Link in
  //      der Adressleiste steht.
  //
  // Nach dem Auswerten wird kdnr aus der URL entfernt (replaceState, kein
  // Reload), damit es einmalig „verbraucht" ist: ein späteres Neuladen des Tabs
  // springt sonst ungewollt wieder in dieselbe Akte, und der Fokus-Listener
  // würde bei jedem Tabwechsel erneut dorthin navigieren.
  useEffect(() => {
    const applyFromUrl = () => {
      const kdnr = kdnrFromSearch(window.location.search);
      if (!kdnr) return;
      navigate({ name: 'customer', kdnr });
      const url = new URL(window.location.href);
      url.searchParams.delete('kdnr');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    };

    applyFromUrl();
    // Wird der schon offene Tab durch das Öffnen der Deep-Link-URL nach vorn
    // geholt, feuert 'focus' – dann erneut auswerten.
    window.addEventListener('focus', applyFromUrl);
    return () => window.removeEventListener('focus', applyFromUrl);
  }, []);

  return <Ctx.Provider value={{ route, navigate }}>{children}</Ctx.Provider>;
}
