import {
  PublicClientApplication,
  type AccountInfo,
  type Configuration,
} from '@azure/msal-browser';
import type { TariffChange, TariffContext, TariffChangeType } from '../types';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const SP_SITE = 'ennitserver.sharepoint.com:/sites/Kommunikations-Coaching';
const SCOPES = ['https://graph.microsoft.com/Files.ReadWrite'];

// Singleton MSAL app — recreated if clientId/tenantId change
let _app: PublicClientApplication | null = null;
let _clientId = '';
let _tenantId = '';
const _initialized = new WeakMap<PublicClientApplication, boolean>();

function buildApp(clientId: string, tenantId: string): PublicClientApplication {
  if (_app && _clientId === clientId && _tenantId === tenantId) return _app;
  const config: Configuration = {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri: window.location.origin,
    },
    cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: false },
  };
  _app = new PublicClientApplication(config);
  _clientId = clientId;
  _tenantId = tenantId;
  return _app;
}

async function ensureInit(app: PublicClientApplication): Promise<void> {
  if (_initialized.get(app)) return;
  await app.initialize();
  await app.handleRedirectPromise();
  _initialized.set(app, true);
}

async function acquireToken(clientId: string, tenantId: string): Promise<string> {
  const app = buildApp(clientId, tenantId);
  await ensureInit(app);
  const accounts = app.getAllAccounts();
  if (accounts.length > 0) {
    try {
      const r = await app.acquireTokenSilent({ scopes: SCOPES, account: accounts[0] });
      return r.accessToken;
    } catch {
      /* fall through to popup */
    }
  }
  const r = await app.acquireTokenPopup({ scopes: SCOPES });
  return r.accessToken;
}

export async function spSignIn(clientId: string, tenantId: string): Promise<AccountInfo> {
  const app = buildApp(clientId, tenantId);
  await ensureInit(app);
  const r = await app.loginPopup({ scopes: SCOPES });
  return r.account;
}

export async function spSignOut(clientId: string, tenantId: string): Promise<void> {
  const app = buildApp(clientId, tenantId);
  await ensureInit(app);
  const accounts = app.getAllAccounts();
  if (accounts.length > 0) await app.logoutPopup({ account: accounts[0] });
}

export async function spGetAccount(clientId: string, tenantId: string): Promise<AccountInfo | null> {
  if (!clientId || !tenantId) return null;
  try {
    const app = buildApp(clientId, tenantId);
    await ensureInit(app);
    const accounts = app.getAllAccounts();
    return accounts[0] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Graph helpers
// ---------------------------------------------------------------------------

async function gFetch<T>(token: string, path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph ${res.status}: ${body}`);
  }
  if (res.status === 204) return null as T;
  return res.json() as Promise<T>;
}

// Cache site ID within the session
let _siteId = '';

async function getSiteId(token: string): Promise<string> {
  if (_siteId) return _siteId;
  const data = await gFetch<{ id: string }>(token, `/sites/${SP_SITE}`);
  _siteId = data.id;
  return _siteId;
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

function contextLabel(c: TariffContext): string {
  if (c === 'mvlz_lt3') return 'Weniger als 3 Monate';
  if (c === 'mvlz_gt3') return 'Mehr als 3 Monate';
  return 'Außerhalb MVLZ';
}

function typeLabel(t: TariffChangeType): string {
  return t === 'upgrade' ? 'Upgrade' : 'Sidegrade';
}

export function buildRow(t: TariffChange, agentName: string): (string | null)[] {
  return [
    fmtDate(t.changeDate), // B – Datum
    t.customerNumber,       // C – Kd.Nr.
    agentName,              // D – Mitarbeiter
    t.jiraTicket,          // E – Ticketnr.
    '',                    // F – (leer)
    t.customerName,        // G – Vertragsnehmer
    contextLabel(t.context), // H – Restlaufzeit
    typeLabel(t.changeType),  // I – Ergebnis
  ];
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

export async function exportTariffChange(
  t: TariffChange,
  agentName: string,
  clientId: string,
  tenantId: string,
  filePath: string,
  sheetName: string,
): Promise<void> {
  if (!clientId || !tenantId || !filePath || !sheetName) {
    throw new Error('SharePoint ist nicht vollständig konfiguriert (Einstellungen prüfen).');
  }

  const token = await acquireToken(clientId, tenantId);
  const siteId = await getSiteId(token);

  const normalizedPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
  const worksheetBase =
    `/sites/${siteId}/drive/root:${normalizedPath}` +
    `:/workbook/worksheets('${encodeURIComponent(sheetName)}')`;

  // Find next empty row (used range gives current row count)
  const used = await gFetch<{ rowCount: number }>(
    token,
    `${worksheetBase}/usedRange?$select=rowCount`,
  );
  const nextRow = used.rowCount + 1;

  // Write the row into columns B:I
  await gFetch<null>(token, `${worksheetBase}/range(address='B${nextRow}:I${nextRow}')`, {
    method: 'PATCH',
    body: JSON.stringify({ values: [buildRow(t, agentName)] }),
  });
}

// ---------------------------------------------------------------------------
// Test connection (used by Settings page)
// ---------------------------------------------------------------------------

export async function testConnection(
  clientId: string,
  tenantId: string,
  filePath: string,
  sheetName: string,
): Promise<{ account: AccountInfo; worksheetName: string }> {
  const account = await spSignIn(clientId, tenantId);
  const token = await acquireToken(clientId, tenantId);
  const siteId = await getSiteId(token);

  const normalizedPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
  const ws = await gFetch<{ name: string }>(
    token,
    `/sites/${siteId}/drive/root:${normalizedPath}:/workbook/worksheets('${encodeURIComponent(sheetName)}')`,
  );
  return { account, worksheetName: ws.name };
}
