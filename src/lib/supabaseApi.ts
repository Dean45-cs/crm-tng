import { getSupabase } from './supabase';
import type {
  Contract,
  TariffChange,
  Note,
  Settings,
  Customer,
  Call,
  CustomerOwnership,
  ProductInfo,
  ProductType,
  TariffCommissionMatrix,
  ContractStatus,
  TariffChangeType,
  TariffContext,
  Incentive,
  IncentiveMechanic,
  IncentiveMetric,
  IncentivePeriod,
  Lead,
  LeadStatus,
  LeadPriority,
  LeadActivity,
  LeadActivityType,
  AuditLogEntry,
  AuditAction,
  AuditEntity,
  CustomerAccessRequest,
  AccessRequestStatus,
  UserStatus,
  StatusLogEntry,
  CallDisposition,
  Campaign,
  CampaignCallType,
  Shift,
  ShiftType,
  StaffingTarget,
  ShiftSwapRequest,
  SwapStatus,
  AppNotification,
  NotificationKind,
  NotificationLink,
  OutboundContact,
  OutboundContactStatus,
} from '../types';
import type { AuthUser } from '../store/useAuth';

// ============================================================================
// Row <-> domain mapping
// ============================================================================

interface UserRow {
  id: string;
  key: string;
  display_name: string;
  onboarding_completed: boolean;
  leaderboard_opt_in: boolean;
  role: string | null;
  is_active: boolean | null;
  consent_given_at: string | null;
  created_at: string;
  last_login_at: string | null;
}

const mapUser = (r: UserRow, monthlyTarget = 0): AuthUser => ({
  key: r.id, // wir nutzen die UUID als key für FK-Konsistenz
  displayName: r.display_name,
  pinHash: '', // pin ist in Supabase Auth, hier nicht gespeichert
  salt: '',
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at ?? undefined,
  onboardingCompleted: r.onboarding_completed,
  leaderboardOptIn: r.leaderboard_opt_in,
  role: r.role === 'manager' ? 'manager' : 'agent',
  isActive: r.is_active !== false,
  consentGivenAt: r.consent_given_at ?? undefined,
  monthlyTarget,
});

interface ContractRow {
  id: string;
  customer_number: string;
  customer_name: string;
  products: ProductType[];
  contract_date: string;
  status: ContractStatus;
  jira_ticket: string | null;
  follow_up_date: string | null;
  laufzeit_monate: number | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
}

const mapContract = (r: ContractRow): Contract => ({
  id: r.id,
  customerNumber: r.customer_number,
  customerName: r.customer_name,
  products: r.products ?? [],
  contractDate: r.contract_date,
  status: r.status,
  jiraTicket: r.jira_ticket ?? '',
  followUpDate: r.follow_up_date ?? undefined,
  laufzeitMonate: (r.laufzeit_monate as 12 | 24 | null) ?? null,
  notes: r.notes ?? undefined,
  createdAt: r.created_at,
  createdBy: r.created_by ?? undefined,
});

interface TariffRow {
  id: string;
  customer_number: string;
  customer_name: string;
  change_type: TariffChangeType;
  context: TariffContext;
  old_product: ProductType | null;
  new_product: ProductType | null;
  change_date: string;
  jira_ticket: string | null;
  notes: string | null;
  exported_at: string | null;
  created_at: string;
  created_by: string | null;
}

const mapTariff = (r: TariffRow): TariffChange => ({
  id: r.id,
  customerNumber: r.customer_number,
  customerName: r.customer_name,
  changeType: r.change_type,
  context: r.context,
  oldProduct: r.old_product ?? undefined,
  newProduct: r.new_product ?? undefined,
  changeDate: r.change_date,
  jiraTicket: r.jira_ticket ?? '',
  notes: r.notes ?? undefined,
  exportedAt: r.exported_at ?? undefined,
  createdAt: r.created_at,
  createdBy: r.created_by ?? undefined,
});

interface NoteRow {
  id: string;
  customer_number: string | null;
  customer_name: string | null;
  title: string;
  content: string;
  jira_ticket: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

const mapNote = (r: NoteRow): Note => ({
  id: r.id,
  customerNumber: r.customer_number ?? undefined,
  customerName: r.customer_name ?? undefined,
  title: r.title,
  content: r.content,
  jiraTicket: r.jira_ticket ?? '',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  createdBy: r.created_by ?? undefined,
});

interface OwnershipRow {
  customer_number: string;
  owner: string;
  shared_with: string[];
}

const mapOwnership = (r: OwnershipRow): CustomerOwnership => ({
  owner: r.owner,
  sharedWith: r.shared_with ?? [],
});

// ============================================================================
// Users
// ============================================================================

export async function fetchAllUsers(): Promise<Record<string, AuthUser>> {
  const sb = getSupabase();
  const [usersRes, settingsRes] = await Promise.all([
    sb.from('users').select('*'),
    sb.from('user_settings').select('user_id, monthly_target'),
  ]);
  if (usersRes.error) throw usersRes.error;

  // Monatsziele pro Nutzer: Chefs lesen alle (RLS), Agents nur die eigene Zeile.
  const targets: Record<string, number> = {};
  for (const row of (settingsRes.data ?? []) as { user_id: string; monthly_target: number }[]) {
    targets[row.user_id] = Number(row.monthly_target);
  }

  const map: Record<string, AuthUser> = {};
  for (const row of (usersRes.data ?? []) as UserRow[]) {
    map[row.id] = mapUser(row, targets[row.id] ?? 0);
  }
  return map;
}

/**
 * Existiert mindestens ein Nutzerprofil? Über die RPC users_exist() — auch ohne
 * Anmeldung lesbar, damit der Login-Screen den Bootstrap des ersten Kontos
 * erkennt (RLS verbietet einem anon-Client das direkte Lesen von public.users).
 */
export async function fetchUsersExist(): Promise<boolean> {
  const { data, error } = await getSupabase().rpc('users_exist');
  if (error) throw error;
  return data === true;
}

export async function updateUserRole(id: string, role: 'agent' | 'manager'): Promise<void> {
  const { error } = await getSupabase().from('users').update({ role }).eq('id', id);
  if (error) throw error;
}

export async function setUserActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await getSupabase().from('users').update({ is_active: isActive }).eq('id', id);
  if (error) throw error;
}

/**
 * Liest gezielt den Sperr-Status eines Nutzers — für den Login-Gate.
 * Fehlt das Profil oder schlägt die Abfrage fehl, gilt fail-closed:
 * der Aufrufer wertet das als „kein Zugang".
 */
export async function fetchUserActive(id: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from('users')
    .select('is_active')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;
  return (data as { is_active: boolean | null }).is_active !== false;
}

export async function upsertUserProfile(
  id: string,
  key: string,
  displayName: string,
): Promise<void> {
  const { error } = await getSupabase().from('users').upsert(
    {
      id,
      key,
      display_name: displayName,
      last_login_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (error) throw error;
}

/**
 * Login-Zeitstempel setzen, OHNE das bestehende Profil zu überschreiben.
 * Der frühere Upsert beim Login hat display_name mit der gerade eingetippten
 * Schreibweise überschrieben (Login als "max" → Anzeigename wurde "max").
 * Fehlt das Profil noch (z.B. abgebrochene Erst-Registrierung), wird es
 * angelegt.
 */
export async function touchUserLogin(
  id: string,
  key: string,
  displayName: string,
): Promise<void> {
  const sb = getSupabase();
  const { data, error } = await sb.from('users').select('id').eq('id', id).maybeSingle();
  if (error) throw error;
  if (data) {
    const { error: ue } = await sb
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', id);
    if (ue) throw ue;
  } else {
    await upsertUserProfile(id, key, displayName);
  }
}

export async function updateUserFlags(
  id: string,
  patch: { onboardingCompleted?: boolean; leaderboardOptIn?: boolean },
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.onboardingCompleted !== undefined) payload.onboarding_completed = patch.onboardingCompleted;
  if (patch.leaderboardOptIn !== undefined) payload.leaderboard_opt_in = patch.leaderboardOptIn;
  if (Object.keys(payload).length === 0) return;
  const { error } = await getSupabase().from('users').update(payload).eq('id', id);
  if (error) throw error;
}

// ============================================================================
// Contracts
// ============================================================================

export async function fetchContracts(): Promise<Contract[]> {
  const { data, error } = await getSupabase()
    .from('contracts')
    .select('*')
    .order('contract_date', { ascending: false });
  if (error) throw error;
  return (data as ContractRow[]).map(mapContract);
}

export async function insertContract(
  c: Omit<Contract, 'id' | 'createdAt'>,
): Promise<Contract> {
  const payload = {
    customer_number: c.customerNumber,
    customer_name: c.customerName,
    products: c.products,
    contract_date: c.contractDate,
    status: c.status,
    jira_ticket: c.jiraTicket || null,
    follow_up_date: c.followUpDate || null,
    laufzeit_monate: c.laufzeitMonate ?? null,
    notes: c.notes || null,
    created_by: c.createdBy ?? null,
  };
  const { data, error } = await getSupabase()
    .from('contracts')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return mapContract(data as ContractRow);
}

export async function updateContractRow(
  id: string,
  patch: Partial<Contract>,
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.customerNumber !== undefined) payload.customer_number = patch.customerNumber;
  if (patch.customerName !== undefined) payload.customer_name = patch.customerName;
  if (patch.products !== undefined) payload.products = patch.products;
  if (patch.contractDate !== undefined) payload.contract_date = patch.contractDate;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.jiraTicket !== undefined) payload.jira_ticket = patch.jiraTicket || null;
  if (patch.followUpDate !== undefined) payload.follow_up_date = patch.followUpDate || null;
  if (patch.laufzeitMonate !== undefined) payload.laufzeit_monate = patch.laufzeitMonate ?? null;
  if (patch.notes !== undefined) payload.notes = patch.notes || null;
  const { error } = await getSupabase().from('contracts').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteContractRow(id: string): Promise<void> {
  const { error } = await getSupabase().from('contracts').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================================
// Tariff Changes
// ============================================================================

export async function fetchTariffChanges(): Promise<TariffChange[]> {
  const { data, error } = await getSupabase()
    .from('tariff_changes')
    .select('*')
    .order('change_date', { ascending: false });
  if (error) throw error;
  return (data as TariffRow[]).map(mapTariff);
}

export async function insertTariffChange(
  t: Omit<TariffChange, 'id' | 'createdAt'>,
): Promise<TariffChange> {
  const payload = {
    customer_number: t.customerNumber,
    customer_name: t.customerName,
    change_type: t.changeType,
    context: t.context,
    old_product: t.oldProduct ?? null,
    new_product: t.newProduct ?? null,
    change_date: t.changeDate,
    jira_ticket: t.jiraTicket || null,
    notes: t.notes || null,
    exported_at: t.exportedAt ?? null,
    created_by: t.createdBy ?? null,
  };
  const { data, error } = await getSupabase()
    .from('tariff_changes')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return mapTariff(data as TariffRow);
}

export async function updateTariffChangeRow(
  id: string,
  patch: Partial<TariffChange>,
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.customerNumber !== undefined) payload.customer_number = patch.customerNumber;
  if (patch.customerName !== undefined) payload.customer_name = patch.customerName;
  if (patch.changeType !== undefined) payload.change_type = patch.changeType;
  if (patch.context !== undefined) payload.context = patch.context;
  if (patch.oldProduct !== undefined) payload.old_product = patch.oldProduct ?? null;
  if (patch.newProduct !== undefined) payload.new_product = patch.newProduct ?? null;
  if (patch.changeDate !== undefined) payload.change_date = patch.changeDate;
  if (patch.jiraTicket !== undefined) payload.jira_ticket = patch.jiraTicket || null;
  if (patch.notes !== undefined) payload.notes = patch.notes || null;
  if (patch.exportedAt !== undefined) payload.exported_at = patch.exportedAt ?? null;
  const { error } = await getSupabase().from('tariff_changes').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteTariffChangeRow(id: string): Promise<void> {
  const { error } = await getSupabase().from('tariff_changes').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================================
// Notes
// ============================================================================

export async function fetchNotes(): Promise<Note[]> {
  const { data, error } = await getSupabase()
    .from('notes')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data as NoteRow[]).map(mapNote);
}

export async function insertNote(
  n: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>,
  createdBy?: string,
): Promise<Note> {
  const now = new Date().toISOString();
  const payload = {
    customer_number: n.customerNumber || null,
    customer_name: n.customerName || null,
    title: n.title,
    content: n.content,
    jira_ticket: n.jiraTicket || null,
    created_at: now,
    updated_at: now,
    created_by: createdBy ?? null,
  };
  const { data, error } = await getSupabase().from('notes').insert(payload).select().single();
  if (error) throw error;
  return mapNote(data as NoteRow);
}

export async function updateNoteRow(id: string, patch: Partial<Note>): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.customerNumber !== undefined) payload.customer_number = patch.customerNumber || null;
  if (patch.customerName !== undefined) payload.customer_name = patch.customerName || null;
  if (patch.title !== undefined) payload.title = patch.title;
  if (patch.content !== undefined) payload.content = patch.content;
  if (patch.jiraTicket !== undefined) payload.jira_ticket = patch.jiraTicket || null;
  const { error } = await getSupabase().from('notes').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteNoteRow(id: string): Promise<void> {
  const { error } = await getSupabase().from('notes').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================================
// Customer Ownerships
// ============================================================================

export async function fetchOwnerships(): Promise<Record<string, CustomerOwnership>> {
  const { data, error } = await getSupabase().from('customer_ownerships').select('*');
  if (error) throw error;
  const map: Record<string, CustomerOwnership> = {};
  for (const row of (data ?? []) as OwnershipRow[]) {
    map[row.customer_number] = mapOwnership(row);
  }
  return map;
}

export async function upsertOwnership(
  customerNumber: string,
  owner: string,
  sharedWith: string[],
): Promise<void> {
  const { error } = await getSupabase()
    .from('customer_ownerships')
    .upsert(
      {
        customer_number: customerNumber,
        owner,
        shared_with: sharedWith,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'customer_number' },
    );
  if (error) throw error;
}

// ============================================================================
// Settings
// ============================================================================

interface UserSettingsRow {
  user_id: string;
  monthly_target: number;
  sp_client_id: string;
  sp_tenant_id: string;
  sp_file_path: string | null;
  sp_sheet_name: string | null;
}

interface SharedSettingsRow {
  id: number;
  products: ProductInfo[];
  tariff_commission: TariffCommissionMatrix;
}

export async function fetchSettings(userId: string): Promise<{
  user: Pick<
    Settings,
    'monthlyTarget' | 'spClientId' | 'spTenantId' | 'spFilePath' | 'spSheetName'
  > | null;
  shared: Pick<Settings, 'products' | 'tariffCommission'> | null;
}> {
  const sb = getSupabase();
  const [userRes, sharedRes] = await Promise.all([
    sb.from('user_settings').select('*').eq('user_id', userId).maybeSingle(),
    sb.from('shared_settings').select('*').eq('id', 1).maybeSingle(),
  ]);

  if (userRes.error) throw userRes.error;
  if (sharedRes.error) throw sharedRes.error;

  const userRow = userRes.data as UserSettingsRow | null;
  const sharedRow = sharedRes.data as SharedSettingsRow | null;

  return {
    user: userRow
      ? {
          monthlyTarget: Number(userRow.monthly_target),
          spClientId: userRow.sp_client_id ?? '',
          spTenantId: userRow.sp_tenant_id ?? '',
          spFilePath: userRow.sp_file_path ?? '',
          spSheetName: userRow.sp_sheet_name || 'Tabelle1',
        }
      : null,
    shared: sharedRow
      ? {
          products: sharedRow.products ?? [],
          tariffCommission: sharedRow.tariff_commission ?? ({} as TariffCommissionMatrix),
        }
      : null,
  };
}

export async function upsertUserSettings(
  userId: string,
  patch: Partial<
    Pick<Settings, 'monthlyTarget' | 'spClientId' | 'spTenantId' | 'spFilePath' | 'spSheetName'>
  >,
): Promise<void> {
  const payload: Record<string, unknown> = {
    user_id: userId,
    updated_at: new Date().toISOString(),
  };
  if (patch.monthlyTarget !== undefined) payload.monthly_target = patch.monthlyTarget;
  if (patch.spClientId !== undefined) payload.sp_client_id = patch.spClientId;
  if (patch.spTenantId !== undefined) payload.sp_tenant_id = patch.spTenantId;
  if (patch.spFilePath !== undefined) payload.sp_file_path = patch.spFilePath;
  if (patch.spSheetName !== undefined) payload.sp_sheet_name = patch.spSheetName;
  const { error } = await getSupabase()
    .from('user_settings')
    .upsert(payload, { onConflict: 'user_id' });
  if (error) throw error;
}

export async function upsertSharedSettings(
  patch: Partial<Pick<Settings, 'products' | 'tariffCommission'>>,
): Promise<void> {
  const payload: Record<string, unknown> = {
    id: 1,
    updated_at: new Date().toISOString(),
  };
  if (patch.products !== undefined) payload.products = patch.products;
  if (patch.tariffCommission !== undefined) payload.tariff_commission = patch.tariffCommission;
  const { error } = await getSupabase()
    .from('shared_settings')
    .upsert(payload, { onConflict: 'id' });
  if (error) throw error;
}

// ---- Appearance (Theme/Palette) — surface-übergreifend über user_settings ----
// Bewusst getrennt von fetchSettings/upsertUserSettings gehalten: Optik ist eine
// eigene Achse (UI, nicht Geschäfts-Settings) und wird über einen dedizierten
// Realtime-Kanal + localStorage-Cache synchronisiert (Migration 022, Tier 3).

/** Rohwerte der gespeicherten Optik; null = noch nie gesetzt (→ Seed vom Client). */
export async function fetchUserAppearance(userId: string): Promise<{
  themePref: string | null;
  palette: unknown | null;
}> {
  const { data, error } = await getSupabase()
    .from('user_settings')
    .select('theme_pref, palette')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  const row = data as { theme_pref: string | null; palette: unknown } | null;
  return { themePref: row?.theme_pref ?? null, palette: row?.palette ?? null };
}

/** Partieller Upsert nur der Optik-Spalten — andere user_settings-Spalten
 *  bleiben unangetastet (onConflict aktualisiert nur die übergebenen Felder). */
export async function upsertUserAppearance(
  userId: string,
  patch: { themePref?: string; palette?: unknown },
): Promise<void> {
  const payload: Record<string, unknown> = {
    user_id: userId,
    updated_at: new Date().toISOString(),
  };
  if (patch.themePref !== undefined) payload.theme_pref = patch.themePref;
  if (patch.palette !== undefined) payload.palette = patch.palette;
  const { error } = await getSupabase()
    .from('user_settings')
    .upsert(payload, { onConflict: 'user_id' });
  if (error) throw error;
}

// ============================================================================
// Incentives
// ============================================================================

interface IncentiveRow {
  id: string;
  title: string;
  mechanic: IncentiveMechanic;
  metric: IncentiveMetric;
  period: IncentivePeriod;
  target: number | string; // numeric kommt teils als string aus Postgres
  reward: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const mapIncentive = (r: IncentiveRow): Incentive => ({
  id: r.id,
  title: r.title,
  mechanic: r.mechanic,
  metric: r.metric,
  period: r.period,
  target: Number(r.target),
  reward: r.reward ?? '',
  active: r.active,
  createdBy: r.created_by ?? undefined,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function fetchIncentives(): Promise<Incentive[]> {
  const { data, error } = await getSupabase()
    .from('incentives')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as IncentiveRow[]).map(mapIncentive);
}

export async function insertIncentive(
  i: Omit<Incentive, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<Incentive> {
  const payload = {
    title: i.title,
    mechanic: i.mechanic,
    metric: i.metric,
    period: i.period,
    target: i.target,
    reward: i.reward,
    active: i.active,
    created_by: i.createdBy ?? null,
  };
  const { data, error } = await getSupabase()
    .from('incentives')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return mapIncentive(data as IncentiveRow);
}

export async function updateIncentiveRow(
  id: string,
  patch: Partial<Incentive>,
): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) payload.title = patch.title;
  if (patch.mechanic !== undefined) payload.mechanic = patch.mechanic;
  if (patch.metric !== undefined) payload.metric = patch.metric;
  if (patch.period !== undefined) payload.period = patch.period;
  if (patch.target !== undefined) payload.target = patch.target;
  if (patch.reward !== undefined) payload.reward = patch.reward;
  if (patch.active !== undefined) payload.active = patch.active;
  const { error } = await getSupabase().from('incentives').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteIncentiveRow(id: string): Promise<void> {
  const { error } = await getSupabase().from('incentives').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================================
// Kampagnen (Migration 019) — fester, vom Chef gepflegter Katalog. call_type
// bestimmt in der Extension automatisch Skript & Einwandkarten.
// ============================================================================

interface CampaignRow {
  id: string;
  name: string;
  call_type: CampaignCallType;
  active: boolean;
  // Anrufliste-Felder (Migration 026) — nullable, solange die Migration
  // in einer Installation noch nicht eingespielt ist.
  bonus_termin: number | null;
  bonus_abschluss: number | null;
  max_attempts: number | null;
  start_date: string | null;
  end_date: string | null;
  target_product: string | null;
  created_by: string | null;
  created_at: string;
}

const mapCampaign = (r: CampaignRow): Campaign => ({
  id: r.id,
  name: r.name,
  callType: r.call_type,
  active: r.active,
  bonusTermin: Number(r.bonus_termin ?? 0),
  bonusAbschluss: Number(r.bonus_abschluss ?? 0),
  maxAttempts: r.max_attempts ?? 3,
  startDate: r.start_date ?? undefined,
  endDate: r.end_date ?? undefined,
  targetProduct: (r.target_product as ProductType | null) ?? undefined,
  createdBy: r.created_by ?? undefined,
  createdAt: r.created_at,
});

export async function fetchCampaigns(): Promise<Campaign[]> {
  const { data, error } = await getSupabase()
    .from('campaigns')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as CampaignRow[]).map(mapCampaign);
}

export async function insertCampaign(
  c: Omit<Campaign, 'id' | 'createdAt'>,
): Promise<Campaign> {
  const payload = {
    name: c.name,
    call_type: c.callType,
    active: c.active,
    bonus_termin: c.bonusTermin,
    bonus_abschluss: c.bonusAbschluss,
    max_attempts: c.maxAttempts,
    start_date: c.startDate || null,
    end_date: c.endDate || null,
    target_product: c.targetProduct || null,
    created_by: c.createdBy ?? null,
  };
  const { data, error } = await getSupabase()
    .from('campaigns')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return mapCampaign(data as CampaignRow);
}

export async function updateCampaignRow(id: string, patch: Partial<Campaign>): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.callType !== undefined) payload.call_type = patch.callType;
  if (patch.active !== undefined) payload.active = patch.active;
  if (patch.bonusTermin !== undefined) payload.bonus_termin = patch.bonusTermin;
  if (patch.bonusAbschluss !== undefined) payload.bonus_abschluss = patch.bonusAbschluss;
  if (patch.maxAttempts !== undefined) payload.max_attempts = patch.maxAttempts;
  if (patch.startDate !== undefined) payload.start_date = patch.startDate || null;
  if (patch.endDate !== undefined) payload.end_date = patch.endDate || null;
  if (patch.targetProduct !== undefined) payload.target_product = patch.targetProduct || null;
  const { error } = await getSupabase().from('campaigns').update(payload).eq('id', id);
  if (error) throw error;
}

export async function setCampaignActive(id: string, active: boolean): Promise<void> {
  await updateCampaignRow(id, { active });
}

// ============================================================================
// Schichtplan (Migration 020) — geteilter Wochenplan (Früh/Spät/frei je
// Agent:in und Tag), optional mit Kampagnen-Zuordnung. Nur Chefs schreiben,
// alle aktiven Nutzer lesen den vollständigen Plan (siehe RLS in schema.sql).
// ============================================================================

interface ShiftRow {
  id: string;
  user_id: string;
  shift_date: string;
  shift_type: ShiftType;
  campaign_id: string | null;
  created_at: string;
  updated_at: string;
}

const mapShift = (r: ShiftRow): Shift => ({
  id: r.id,
  userId: r.user_id,
  shiftDate: r.shift_date,
  shiftType: r.shift_type,
  campaignId: r.campaign_id ?? undefined,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Alle Schichten einer Woche (weekStart/weekEnd als 'YYYY-MM-DD'), für alle Agent:innen. */
export async function fetchShiftsForWeek(weekStart: string, weekEnd: string): Promise<Shift[]> {
  const { data, error } = await getSupabase()
    .from('shifts')
    .select('*')
    .gte('shift_date', weekStart)
    .lte('shift_date', weekEnd);
  if (error) throw error;
  return (data as ShiftRow[]).map(mapShift);
}

/** Legt die Schicht eines Tages an oder überschreibt sie (unique user_id+shift_date). */
export async function upsertShift(s: {
  userId: string;
  shiftDate: string;
  shiftType: ShiftType;
  campaignId?: string | null;
}): Promise<Shift> {
  const payload = {
    user_id: s.userId,
    shift_date: s.shiftDate,
    shift_type: s.shiftType,
    campaign_id: s.campaignId ?? null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await getSupabase()
    .from('shifts')
    .upsert(payload, { onConflict: 'user_id,shift_date' })
    .select()
    .single();
  if (error) throw error;
  return mapShift(data as ShiftRow);
}

export async function deleteShiftRow(id: string): Promise<void> {
  const { error } = await getSupabase().from('shifts').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Die Schicht eines einzelnen Users an einem Tag — Grundlage des „aktuellen
 * Kontexts" (welche Kampagne/welchen Call-Typ fahre ich gerade). Spiegelt
 * fetchCurrentShift() aus extension/src/supabase.js, damit CRM und Extension
 * dieselbe Ableitung nutzen. null = keine Schicht an dem Tag.
 */
export async function fetchShiftForUserDay(userId: string, dateKey: string): Promise<Shift | null> {
  const { data, error } = await getSupabase()
    .from('shifts')
    .select('*')
    .eq('user_id', userId)
    .eq('shift_date', dateKey)
    .maybeSingle();
  if (error) throw error;
  return data ? mapShift(data as ShiftRow) : null;
}

/**
 * Schichten eines beliebigen Datumsbereichs — dieselbe Abfrage wie
 * fetchShiftsForWeek, nur ohne die Wochen-Erwartung im Namen. Die
 * Monatsansicht des Schichtplans lädt damit fünf bis sechs Wochen am Stück.
 */
export async function fetchShiftsBetween(fromKey: string, toKey: string): Promise<Shift[]> {
  return fetchShiftsForWeek(fromKey, toKey);
}

/**
 * Die eigenen Schichten eines Zeitfensters, nach Datum sortiert. Grundlage für
 * „meine laufende und meine nächste Schicht" — dafür reicht die heutige Zeile
 * nicht: an einem freien Tag ist die interessante Antwort, wann es weitergeht.
 */
export async function fetchShiftsForUser(
  userId: string,
  fromKey: string,
  toKey: string,
): Promise<Shift[]> {
  const { data, error } = await getSupabase()
    .from('shifts')
    .select('*')
    .eq('user_id', userId)
    .gte('shift_date', fromKey)
    .lte('shift_date', toKey)
    .order('shift_date', { ascending: true });
  if (error) throw error;
  return (data as ShiftRow[]).map(mapShift);
}

// ============================================================================
// Soll-Besetzung (Migration 024)
// ============================================================================

interface StaffingRow {
  weekday: number;
  min_frueh: number;
  min_spaet: number;
}

const mapStaffing = (r: StaffingRow): StaffingTarget => ({
  weekday: r.weekday,
  minFrueh: r.min_frueh,
  minSpaet: r.min_spaet,
});

/**
 * Soll-Besetzung je Wochentag. Fehlt die Tabelle noch (Migration 024 nicht
 * eingespielt), kommt eine leere Liste zurück statt eines Fehlers — dann zeigt
 * die Besetzung wie bisher nur Ist-Zahlen ohne Ampel. Gleiches Toleranzmuster
 * wie bei fetchShiftsForWeek/fetchIncentives.
 */
export async function fetchStaffingTargets(): Promise<StaffingTarget[]> {
  const { data, error } = await getSupabase().from('staffing_targets').select('*');
  if (error) return [];
  return (data as StaffingRow[]).map(mapStaffing);
}

export async function upsertStaffingTarget(t: StaffingTarget): Promise<void> {
  const { error } = await getSupabase()
    .from('staffing_targets')
    .upsert(
      {
        weekday: t.weekday,
        min_frueh: t.minFrueh,
        min_spaet: t.minSpaet,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'weekday' },
    );
  if (error) throw error;
}

// ============================================================================
// Schichttausch (Migration 023) — A fragt B, B nimmt an, der Chef bestätigt.
// Der eigentliche Tausch läuft über die Datenbankfunktion apply_shift_swap():
// `shifts` bleibt für Agent:innen schreibgeschützt, und beide Zeilen müssen
// gemeinsam umziehen oder gar nicht.
// ============================================================================

interface SwapRow {
  id: string;
  requester_id: string;
  requester_date: string;
  partner_id: string;
  partner_date: string;
  message: string | null;
  status: SwapStatus;
  requester_shift_type: ShiftType | null;
  partner_shift_type: ShiftType | null;
  decided_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

const mapSwap = (r: SwapRow): ShiftSwapRequest => ({
  id: r.id,
  requesterId: r.requester_id,
  requesterDate: r.requester_date,
  partnerId: r.partner_id,
  partnerDate: r.partner_date,
  message: r.message ?? undefined,
  status: r.status,
  requesterShiftType: r.requester_shift_type ?? undefined,
  partnerShiftType: r.partner_shift_type ?? undefined,
  decidedAt: r.decided_at ?? undefined,
  approvedBy: r.approved_by ?? undefined,
  approvedAt: r.approved_at ?? undefined,
  createdAt: r.created_at,
});

/**
 * Alle Tauschanfragen, die noch zu etwas führen können (offen oder vom Partner
 * angenommen). Erledigte bleiben in der Datenbank stehen, interessieren die
 * Oberfläche aber nicht mehr — der Schichtplan markiert damit nur Zellen, für
 * die gerade etwas läuft.
 */
export async function fetchOpenSwapRequests(): Promise<ShiftSwapRequest[]> {
  const { data, error } = await getSupabase()
    .from('shift_swap_requests')
    .select('*')
    .in('status', ['pending', 'accepted'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as SwapRow[]).map(mapSwap);
}

/** Eine einzelne Anfrage — für die Inline-Aktionen im Postfach. */
export async function fetchSwapRequest(id: string): Promise<ShiftSwapRequest | null> {
  const { data, error } = await getSupabase()
    .from('shift_swap_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapSwap(data as SwapRow) : null;
}

export async function insertSwapRequest(s: {
  requesterId: string;
  requesterDate: string;
  partnerId: string;
  partnerDate: string;
  message?: string;
  requesterShiftType?: ShiftType;
  partnerShiftType?: ShiftType;
}): Promise<ShiftSwapRequest> {
  const payload = {
    requester_id: s.requesterId,
    requester_date: s.requesterDate,
    partner_id: s.partnerId,
    partner_date: s.partnerDate,
    message: s.message?.trim() || null,
    requester_shift_type: s.requesterShiftType ?? null,
    partner_shift_type: s.partnerShiftType ?? null,
  };
  const { data, error } = await getSupabase()
    .from('shift_swap_requests')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return mapSwap(data as SwapRow);
}

/**
 * Statuswechsel ohne Wirkung auf den Plan: annehmen, ablehnen, zurückziehen,
 * vom Chef ablehnen. Der Übergang nach 'approved' läuft NICHT hierüber, sondern
 * über applyShiftSwap() — nur dort werden auch die Schichten getauscht.
 */
export async function setSwapStatus(
  id: string,
  status: Exclude<SwapStatus, 'approved'>,
): Promise<void> {
  const { error } = await getSupabase()
    .from('shift_swap_requests')
    .update({ status, decided_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Chef-Bestätigung: tauscht die beiden Schichten und setzt die Anfrage auf
 * 'approved' — atomar in der Datenbank (siehe Migration 023). Wirft, wenn die
 * Anfrage nicht mehr im Status 'accepted' ist oder die Rechte fehlen.
 */
export async function applyShiftSwap(requestId: string): Promise<void> {
  const { error } = await getSupabase().rpc('apply_shift_swap', { p_request_id: requestId });
  if (error) throw error;
}

// ============================================================================
// Postfach (Migration 023) — persönliche Meldungen. Streng privat: die
// RLS-Policy lässt nur den Empfänger lesen, deshalb braucht keine dieser
// Funktionen einen user_id-Filter.
// ============================================================================

interface NotificationRow {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  link: NotificationLink | null;
  actor_id: string | null;
  actor_name: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

const mapNotification = (r: NotificationRow): AppNotification => ({
  id: r.id,
  userId: r.user_id,
  kind: r.kind as NotificationKind,
  title: r.title,
  body: r.body ?? undefined,
  link: r.link ?? undefined,
  actorId: r.actor_id ?? undefined,
  actorName: r.actor_name ?? undefined,
  entityId: r.entity_id ?? undefined,
  readAt: r.read_at ?? undefined,
  createdAt: r.created_at,
});

/** Die letzten `limit` Meldungen des angemeldeten Users, neueste zuerst. */
export async function fetchNotifications(limit = 200): Promise<AppNotification[]> {
  const { data, error } = await getSupabase()
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as NotificationRow[]).map(mapNotification);
}

/**
 * Meldungen zustellen. Mehrere auf einmal, weil eine Aktion oft mehrere
 * Empfänger hat (der Chef ändert eine Spalte → alle Betroffenen).
 * Empfänger, die dem Auslöser entsprechen, filtert der Aufrufer heraus —
 * niemand soll sich selbst benachrichtigen.
 */
export async function insertNotifications(
  items: {
    userId: string;
    kind: NotificationKind;
    title: string;
    body?: string;
    link?: NotificationLink;
    actorId: string;
    actorName?: string;
    entityId?: string;
  }[],
): Promise<void> {
  if (items.length === 0) return;
  const payload = items.map((n) => ({
    user_id: n.userId,
    kind: n.kind,
    title: n.title,
    body: n.body ?? null,
    link: n.link ?? null,
    actor_id: n.actorId,
    actor_name: n.actorName ?? null,
    entity_id: n.entityId ?? null,
  }));
  const { error } = await getSupabase().from('notifications').insert(payload);
  if (error) throw error;
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await getSupabase()
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids);
  if (error) throw error;
}

/** Alles auf gelesen — nur die noch ungelesenen anfassen (kleineres Update). */
export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await getSupabase()
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
  if (error) throw error;
}

export async function deleteNotificationRow(id: string): Promise<void> {
  const { error } = await getSupabase().from('notifications').delete().eq('id', id);
  if (error) throw error;
}

/** „Postfach leeren" — löscht alle eigenen Meldungen (RLS begrenzt auf sich selbst). */
export async function deleteAllNotifications(): Promise<void> {
  const { error } = await getSupabase()
    .from('notifications')
    .delete()
    .not('id', 'is', null);
  if (error) throw error;
}

// ============================================================================
// Leads
// ============================================================================

interface LeadRow {
  id: string;
  customer_name: string;
  customer_number: string | null;
  phone: string | null;
  topic: string | null;
  status: LeadStatus;
  priority: LeadPriority | null;
  follow_up_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const mapLead = (r: LeadRow): Lead => ({
  id: r.id,
  customerName: r.customer_name,
  customerNumber: r.customer_number ?? undefined,
  phone: r.phone ?? undefined,
  topic: r.topic ?? undefined,
  status: r.status,
  priority: r.priority ?? 'normal',
  followUpDate: r.follow_up_date ?? undefined,
  notes: r.notes ?? undefined,
  createdBy: r.created_by ?? undefined,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function fetchLeads(): Promise<Lead[]> {
  const { data, error } = await getSupabase()
    .from('leads')
    .select('*')
    .order('follow_up_date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data as LeadRow[]).map(mapLead);
}

export async function insertLead(
  l: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<Lead> {
  const payload = {
    customer_name: l.customerName,
    customer_number: l.customerNumber || null,
    phone: l.phone || null,
    topic: l.topic || null,
    status: l.status,
    priority: l.priority,
    follow_up_date: l.followUpDate || null,
    notes: l.notes || null,
    created_by: l.createdBy ?? null,
  };
  const { data, error } = await getSupabase()
    .from('leads')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return mapLead(data as LeadRow);
}

export async function updateLeadRow(
  id: string,
  patch: Partial<Lead>,
): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.customerName !== undefined) payload.customer_name = patch.customerName;
  if (patch.customerNumber !== undefined) payload.customer_number = patch.customerNumber || null;
  if (patch.phone !== undefined) payload.phone = patch.phone || null;
  if (patch.topic !== undefined) payload.topic = patch.topic || null;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.priority !== undefined) payload.priority = patch.priority;
  if (patch.followUpDate !== undefined) payload.follow_up_date = patch.followUpDate || null;
  if (patch.notes !== undefined) payload.notes = patch.notes || null;
  const { error } = await getSupabase().from('leads').update(payload).eq('id', id);
  if (error) throw error;
}

export async function deleteLeadRow(id: string): Promise<void> {
  const { error } = await getSupabase().from('leads').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================================
// Lead Activities
// ============================================================================

interface LeadActivityRow {
  id: string;
  lead_id: string;
  type: LeadActivityType;
  content: string | null;
  created_by: string | null;
  created_at: string;
}

const mapLeadActivity = (r: LeadActivityRow): LeadActivity => ({
  id: r.id,
  leadId: r.lead_id,
  type: r.type,
  content: r.content ?? undefined,
  createdBy: r.created_by ?? undefined,
  createdAt: r.created_at,
});

export async function fetchLeadActivities(): Promise<LeadActivity[]> {
  const { data, error } = await getSupabase()
    .from('lead_activities')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as LeadActivityRow[]).map(mapLeadActivity);
}

export async function insertLeadActivity(
  a: Pick<LeadActivity, 'leadId' | 'type' | 'content' | 'createdBy'>,
): Promise<LeadActivity> {
  const payload = {
    lead_id: a.leadId,
    type: a.type,
    content: a.content ?? null,
    created_by: a.createdBy ?? null,
  };
  const { data, error } = await getSupabase()
    .from('lead_activities')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return mapLeadActivity(data as LeadActivityRow);
}

export async function deleteLeadActivityRow(id: string): Promise<void> {
  const { error } = await getSupabase().from('lead_activities').delete().eq('id', id);
  if (error) throw error;
}

// ============================================================================
// AUDIT LOG
// ============================================================================

interface AuditLogRow {
  id: string;
  actor_id: string | null;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

const mapAuditLog = (r: AuditLogRow): AuditLogEntry => ({
  id: r.id,
  actorId: r.actor_id ?? undefined,
  actorName: r.actor_name,
  action: r.action as AuditAction,
  entityType: r.entity_type as AuditEntity,
  entityId: r.entity_id ?? undefined,
  entityLabel: r.entity_label ?? undefined,
  details: r.details ?? undefined,
  createdAt: r.created_at,
});

export async function insertAuditLog(entry: {
  actorId: string;
  actorName: string;
  action: AuditAction;
  entityType: AuditEntity;
  entityId?: string;
  entityLabel?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  const payload = {
    actor_id: entry.actorId,
    actor_name: entry.actorName,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    entity_label: entry.entityLabel ?? null,
    details: entry.details ?? null,
  };
  const { error } = await getSupabase().from('audit_log').insert(payload);
  if (error) throw error;
}

export async function fetchAuditLog(limit = 100): Promise<AuditLogEntry[]> {
  const { data, error } = await getSupabase()
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as AuditLogRow[]).map(mapAuditLog);
}

// ============================================================================
// CUSTOMERS
// ============================================================================

interface CustomerRow {
  customer_number: string;
  name: string | null;
  phone: string | null;
  first_seen_at: string;
  last_contact_at: string;
  created_by: string | null;
}

const mapCustomer = (r: CustomerRow): Customer => ({
  customerNumber: r.customer_number,
  name: r.name ?? '',
  phone: r.phone ?? undefined,
  firstSeenAt: r.first_seen_at,
  lastContactAt: r.last_contact_at,
  createdBy: r.created_by ?? undefined,
});

export async function fetchCustomers(): Promise<Customer[]> {
  const { data, error } = await getSupabase().from('customers').select('*');
  if (error) throw error;
  return (data as CustomerRow[]).map(mapCustomer);
}

// ============================================================================
// CALLS
// ============================================================================
// Anruf-Historie (Migration 018) — geschrieben von der Stadtnetz-CRM-Copilot-
// Extension, hier nur gelesen. Bewusst NICHT Teil des globalen
// contracts/notes-artigen Ladeprinzips (kein fetchCalls() für den ganzen
// Store): Anrufvolumen kann deutlich höher sein als Verträge/Notizen, ein
// unbegrenzter All-Time-Load würde mit der Zeit zum Skalierungsproblem.

interface CallRow {
  id: string;
  customer_number: string | null;
  caller_name: string | null;
  caller_number: string | null;
  direction: 'inbound' | 'outbound';
  queue_group: string | null;
  started_at: string;
  ended_at: string | null;
  duration_s: number | null;
  agent_id: string;
  disposition: CallDisposition | null;
  cancellation_reason: string | null;
  campaign_id: string | null;
  outbound_contact_id: string | null;
}

const mapCall = (r: CallRow): Call => ({
  id: r.id,
  customerNumber: r.customer_number ?? undefined,
  callerName: r.caller_name ?? undefined,
  callerNumber: r.caller_number ?? undefined,
  direction: r.direction,
  queueGroup: r.queue_group ?? undefined,
  startedAt: r.started_at,
  endedAt: r.ended_at ?? undefined,
  durationS: r.duration_s ?? undefined,
  agentId: r.agent_id,
  disposition: r.disposition ?? undefined,
  cancellationReason: r.cancellation_reason ?? undefined,
  campaignId: r.campaign_id ?? undefined,
  outboundContactId: r.outbound_contact_id ?? undefined,
});

/** Anrufe, die noch nicht beendet sind — Grundlage der Live-Anrufleiste. */
export async function fetchActiveCalls(): Promise<Call[]> {
  const { data, error } = await getSupabase()
    .from('calls')
    .select('*')
    .is('ended_at', null)
    .order('started_at', { ascending: false });
  if (error) throw error;
  return (data as CallRow[]).map(mapCall);
}

/** Anrufhistorie eines einzelnen Kunden, für CustomerDetail. */
export async function fetchCallsForCustomer(customerNumber: string, limit = 20): Promise<Call[]> {
  const { data, error } = await getSupabase()
    .from('calls')
    .select('*')
    .eq('customer_number', customerNumber)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as CallRow[]).map(mapCall);
}

/** Anzahl Anrufe seit einem Zeitpunkt — für die Team-Dashboard-KPI, ohne Zeilen zu übertragen. */
export async function fetchCallCountSince(iso: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from('calls')
    .select('*', { count: 'exact', head: true })
    .gte('started_at', iso);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Anrufzeilen seit einem Zeitpunkt — für die Anruf-Prozess-Kennzahlen
 * (Stufe 4, KONZEPT-INTEGRATION.md: "Anruf → Abschluss"). Zeitlich begrenzt
 * durch den Aufrufer (z.B. Start des 6-Monats-Fensters), keine unbegrenzte
 * Historie — respektiert dieselbe Volumen-Entscheidung wie oben.
 */
export async function fetchCallsSince(iso: string): Promise<Call[]> {
  const { data, error } = await getSupabase()
    .from('calls')
    .select('*')
    .gte('started_at', iso)
    .order('started_at', { ascending: false });
  if (error) throw error;
  return (data as CallRow[]).map(mapCall);
}

/** Obergrenze je Seite; PostgREST deckelt ohnehin bei 1000 Zeilen pro Antwort. */
const CALL_PAGE_SIZE = 1000;
/** Sicherung gegen einen versehentlich riesigen Zeitraum (≈ 20 000 Anrufe). */
const CALL_MAX_PAGES = 20;

/**
 * Anrufe in einem geschlossenen Zeitfenster — Grundlage der Berichte, die
 * beliebige Zeiträume auswerten (nicht nur „seit Monatsbeginn").
 *
 * Blättert bewusst seitenweise: PostgREST liefert pro Antwort höchstens 1000
 * Zeilen und meldet das **nicht** als Fehler. Ein Jahresbericht eines
 * telefonierenden Teams läge darüber und wäre ohne Paginierung stillschweigend
 * abgeschnitten — die Zahlen sähen plausibel aus und wären falsch. Nach
 * `CALL_MAX_PAGES` wird abgebrochen, damit ein versehentlich riesiger Zeitraum
 * den Browser nicht lahmlegt; der Aufrufer erkennt das an `truncated`.
 */
export async function fetchCallsBetween(
  fromIso: string,
  toIso: string,
): Promise<{ calls: Call[]; truncated: boolean }> {
  const sb = getSupabase();
  const calls: Call[] = [];

  for (let page = 0; page < CALL_MAX_PAGES; page += 1) {
    const { data, error } = await sb
      .from('calls')
      .select('*')
      .gte('started_at', fromIso)
      .lte('started_at', toIso)
      .order('started_at', { ascending: false })
      .range(page * CALL_PAGE_SIZE, (page + 1) * CALL_PAGE_SIZE - 1);
    if (error) throw error;

    const rows = (data ?? []) as CallRow[];
    calls.push(...rows.map(mapCall));
    if (rows.length < CALL_PAGE_SIZE) return { calls, truncated: false };
  }
  return { calls, truncated: true };
}

// ============================================================================
// CUSTOMER PURGE — Recht auf Vergessenwerden (Art. 17 DSGVO)
// ============================================================================

/**
 * Löscht alle CRM-Spuren eines Kunden: Verträge, Tarifwechsel, Notizen,
 * Anrufe, Ownership-Eintrag und die Kunden-Zeile selbst. Liefert die Anzahl
 * gelöschter Zeilen pro Tabelle zurück. RLS sorgt dafür, dass nur Berechtigte
 * (Ersteller/Owner/Manager) das ausführen können — Manager dürfen kraft
 * Policy alle Zeilen löschen.
 */
export async function purgeCustomerData(customerNumber: string): Promise<{
  contracts: number;
  tariffChanges: number;
  notes: number;
  ownership: number;
  customers: number;
  calls: number;
}> {
  const sb = getSupabase();
  const [c, t, n, o, cu, ca] = await Promise.all([
    sb.from('contracts').delete({ count: 'exact' }).eq('customer_number', customerNumber),
    sb.from('tariff_changes').delete({ count: 'exact' }).eq('customer_number', customerNumber),
    sb.from('notes').delete({ count: 'exact' }).eq('customer_number', customerNumber),
    sb.from('customer_ownerships').delete({ count: 'exact' }).eq('customer_number', customerNumber),
    sb.from('customers').delete({ count: 'exact' }).eq('customer_number', customerNumber),
    sb.from('calls').delete({ count: 'exact' }).eq('customer_number', customerNumber),
  ]);
  for (const res of [c, t, n, o, cu, ca]) if (res.error) throw res.error;
  return {
    contracts: c.count ?? 0,
    tariffChanges: t.count ?? 0,
    notes: n.count ?? 0,
    ownership: o.count ?? 0,
    customers: cu.count ?? 0,
    calls: ca.count ?? 0,
  };
}

// ============================================================================
// CONSENT (Art. 13 DSGVO)
// ============================================================================

export async function updateUserConsent(id: string, at: string): Promise<void> {
  const { error } = await getSupabase()
    .from('users')
    .update({ consent_given_at: at })
    .eq('id', id);
  if (error) throw error;
}

// ============================================================================
// CUSTOMER ACCESS REQUESTS
// ============================================================================

interface AccessRequestRow {
  id: string;
  customer_number: string;
  requester_id: string;
  owner_id: string | null;
  comment: string | null;
  status: AccessRequestStatus;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
}

const mapAccessRequest = (r: AccessRequestRow): CustomerAccessRequest => ({
  id: r.id,
  customerNumber: r.customer_number,
  requesterId: r.requester_id,
  ownerId: r.owner_id ?? undefined,
  comment: r.comment ?? undefined,
  status: r.status,
  createdAt: r.created_at,
  decidedAt: r.decided_at ?? undefined,
  decidedBy: r.decided_by ?? undefined,
});

export async function fetchAccessRequests(): Promise<CustomerAccessRequest[]> {
  const { data, error } = await getSupabase()
    .from('customer_access_requests')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as AccessRequestRow[]).map(mapAccessRequest);
}

export async function insertAccessRequest(req: {
  customerNumber: string;
  requesterId: string;
  ownerId?: string;
  comment?: string;
}): Promise<CustomerAccessRequest> {
  const payload = {
    customer_number: req.customerNumber,
    requester_id: req.requesterId,
    owner_id: req.ownerId ?? null,
    comment: req.comment || null,
    status: 'pending' as AccessRequestStatus,
  };
  const { data, error } = await getSupabase()
    .from('customer_access_requests')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return mapAccessRequest(data as AccessRequestRow);
}

export async function updateAccessRequestStatus(
  id: string,
  status: AccessRequestStatus,
  decidedBy?: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from('customer_access_requests')
    .update({
      status,
      decided_at: new Date().toISOString(),
      decided_by: decidedBy ?? null,
    })
    .eq('id', id);
  if (error) throw error;
}

// ============================================================================
// STATUS BOARD
// ============================================================================

interface UserStatusRow {
  user_id: string;
  status: string | null;
  sub: string | null;
  description: string | null;
  is_afk: boolean;
  started_at: string | null;
  updated_at: string;
}

const mapUserStatus = (r: UserStatusRow): UserStatus => ({
  userId: r.user_id,
  status: r.status,
  sub: r.sub ?? undefined,
  description: r.description ?? undefined,
  isAfk: r.is_afk === true,
  startedAt: r.started_at ?? undefined,
  updatedAt: r.updated_at,
});

interface StatusLogRow {
  id: string;
  user_id: string | null;
  status: string;
  sub: string | null;
  description: string | null;
  is_afk: boolean;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  created_at: string;
}

const mapStatusLog = (r: StatusLogRow): StatusLogEntry => ({
  id: r.id,
  userId: r.user_id ?? undefined,
  status: r.status,
  sub: r.sub ?? undefined,
  description: r.description ?? undefined,
  isAfk: r.is_afk === true,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  durationSeconds: Number(r.duration_seconds),
  createdAt: r.created_at,
});

/** Aktueller Status aller Kolleg:innen, indexiert nach User-ID. */
export async function fetchUserStatuses(): Promise<Record<string, UserStatus>> {
  const { data, error } = await getSupabase().from('user_status').select('*');
  if (error) throw error;
  const map: Record<string, UserStatus> = {};
  for (const row of (data ?? []) as UserStatusRow[]) {
    map[row.user_id] = mapUserStatus(row);
  }
  return map;
}

/** Schreibt den vollständigen aktuellen Status einer Person (Upsert). */
export async function upsertUserStatus(s: {
  userId: string;
  status: string | null;
  sub?: string | null;
  description?: string | null;
  isAfk: boolean;
  startedAt?: string | null;
}): Promise<void> {
  const payload = {
    user_id: s.userId,
    status: s.status,
    sub: s.sub ?? null,
    description: s.description ?? null,
    is_afk: s.isAfk,
    started_at: s.startedAt ?? null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await getSupabase()
    .from('user_status')
    .upsert(payload, { onConflict: 'user_id' });
  if (error) throw error;
}

/** Archiviert einen abgeschlossenen Status-Abschnitt in der Historie. */
export async function insertStatusLog(e: {
  userId: string;
  status: string;
  sub?: string | null;
  description?: string | null;
  isAfk: boolean;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
}): Promise<void> {
  const payload = {
    user_id: e.userId,
    status: e.status,
    sub: e.sub ?? null,
    description: e.description ?? null,
    is_afk: e.isAfk,
    started_at: e.startedAt,
    ended_at: e.endedAt,
    duration_seconds: Math.max(0, Math.round(e.durationSeconds)),
  };
  const { error } = await getSupabase().from('status_log').insert(payload);
  if (error) throw error;
}

/**
 * Historie ab `sinceIso` (ISO), absteigend nach Start. RLS liefert Agent:innen
 * nur die eigenen Abschnitte, Chef:innen alle.
 */
export async function fetchStatusLog(sinceIso?: string, limit = 5000): Promise<StatusLogEntry[]> {
  let q = getSupabase()
    .from('status_log')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (sinceIso) q = q.gte('started_at', sinceIso);
  const { data, error } = await q;
  if (error) throw error;
  return (data as StatusLogRow[]).map(mapStatusLog);
}

/** Chef-Aktion: löscht die komplette Status-Historie (Datensparsamkeit). */
export async function clearStatusLog(): Promise<void> {
  const { error } = await getSupabase()
    .from('status_log')
    .delete()
    .not('id', 'is', null);
  if (error) throw error;
}

// ============================================================================
// Anrufliste einer Kampagne (Migration 026)
// ============================================================================
// Die aus Excel/CSV importierten Kontakte. Die Gespräche selbst landen in
// `calls` (siehe insertOutboundCall weiter unten), damit Outbound in den
// vorhandenen Auswertungen mitzählt statt in einem zweiten Silo zu liegen.

interface OutboundContactRow {
  id: string;
  campaign_id: string;
  customer_name: string;
  customer_number: string | null;
  phone: string | null;
  email: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  info: string | null;
  status: OutboundContactStatus;
  attempts: number | null;
  follow_up_date: string | null;
  follow_up_time: string | null;
  assigned_to: string | null;
  notes: string | null;
  last_call_at: string | null;
  result_by: string | null;
  result_at: string | null;
  dedupe_key: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const mapOutboundContact = (r: OutboundContactRow): OutboundContact => ({
  id: r.id,
  campaignId: r.campaign_id,
  customerName: r.customer_name,
  customerNumber: r.customer_number ?? undefined,
  phone: r.phone ?? undefined,
  email: r.email ?? undefined,
  street: r.street ?? undefined,
  zip: r.zip ?? undefined,
  city: r.city ?? undefined,
  info: r.info ?? undefined,
  status: r.status,
  attempts: r.attempts ?? 0,
  followUpDate: r.follow_up_date ?? undefined,
  followUpTime: r.follow_up_time ?? undefined,
  assignedTo: r.assigned_to ?? undefined,
  notes: r.notes ?? undefined,
  lastCallAt: r.last_call_at ?? undefined,
  resultBy: r.result_by ?? undefined,
  resultAt: r.result_at ?? undefined,
  dedupeKey: r.dedupe_key,
  createdBy: r.created_by ?? undefined,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function fetchOutboundContacts(): Promise<OutboundContact[]> {
  const { data, error } = await getSupabase()
    .from('outbound_contacts')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as OutboundContactRow[]).map(mapOutboundContact);
}

/** Ein importfertiger Kontakt, noch ohne Datenbank-Felder. */
export type OutboundContactDraft = Pick<
  OutboundContact,
  | 'campaignId'
  | 'customerName'
  | 'customerNumber'
  | 'phone'
  | 'email'
  | 'street'
  | 'zip'
  | 'city'
  | 'info'
  | 'dedupeKey'
> & { createdBy?: string };

/**
 * Importiert viele Kontakte auf einmal — in Blöcken, damit auch lange Listen
 * durchgehen. `ignoreDuplicates` zusammen mit dem Unique-Index auf
 * (campaign_id, dedupe_key) macht einen erneuten Import derselben Liste zum
 * No-Op, statt die ganze Einfügung scheitern zu lassen.
 */
export async function insertOutboundContacts(
  rows: OutboundContactDraft[],
  chunkSize = 500,
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize).map((c) => ({
      campaign_id: c.campaignId,
      customer_name: c.customerName,
      customer_number: c.customerNumber || null,
      phone: c.phone || null,
      email: c.email || null,
      street: c.street || null,
      zip: c.zip || null,
      city: c.city || null,
      info: c.info || null,
      dedupe_key: c.dedupeKey,
      created_by: c.createdBy ?? null,
    }));
    const { data, error } = await getSupabase()
      .from('outbound_contacts')
      .upsert(chunk, { onConflict: 'campaign_id,dedupe_key', ignoreDuplicates: true })
      .select('id');
    if (error) throw error;
    inserted += (data as { id: string }[] | null)?.length ?? 0;
  }
  return inserted;
}

export async function updateOutboundContactRow(
  id: string,
  patch: Partial<OutboundContact>,
): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };

  // Bewusst `in` statt `!== undefined`: ein gesetztes `followUpDate: undefined`
  // heißt „Wiedervorlage löschen" (so räumt `applyCallResult` sie nach einem
  // endgültigen Ergebnis ab). Mit einem undefined-Vergleich bliebe das alte
  // Datum stehen und der Kontakt käme wieder in die Arbeitsliste.
  const has = (k: keyof OutboundContact) => k in patch;

  if (has('customerName')) payload.customer_name = patch.customerName;
  if (has('customerNumber')) payload.customer_number = patch.customerNumber || null;
  if (has('phone')) payload.phone = patch.phone || null;
  if (has('email')) payload.email = patch.email || null;
  if (has('street')) payload.street = patch.street || null;
  if (has('zip')) payload.zip = patch.zip || null;
  if (has('city')) payload.city = patch.city || null;
  if (has('info')) payload.info = patch.info || null;
  if (has('status')) payload.status = patch.status;
  if (has('attempts')) payload.attempts = patch.attempts;
  if (has('followUpDate')) payload.follow_up_date = patch.followUpDate || null;
  if (has('followUpTime')) payload.follow_up_time = patch.followUpTime || null;
  if (has('assignedTo')) payload.assigned_to = patch.assignedTo ?? null;
  if (has('notes')) payload.notes = patch.notes || null;
  if (has('lastCallAt')) payload.last_call_at = patch.lastCallAt || null;
  if (has('resultBy')) payload.result_by = patch.resultBy ?? null;
  if (has('resultAt')) payload.result_at = patch.resultAt || null;

  const { error } = await getSupabase()
    .from('outbound_contacts')
    .update(payload)
    .eq('id', id);
  if (error) throw error;
}

export async function deleteOutboundContactRow(id: string): Promise<void> {
  const { error } = await getSupabase().from('outbound_contacts').delete().eq('id', id);
  if (error) throw error;
}

/** Löscht alle Kontakte einer Kampagne (Chef-Aktion beim Neuaufsetzen). */
export async function deleteContactsOfCampaign(campaignId: string): Promise<void> {
  const { error } = await getSupabase()
    .from('outbound_contacts')
    .delete()
    .eq('campaign_id', campaignId);
  if (error) throw error;
}

/**
 * Schreibt ein Outbound-Gespräch in dieselbe `calls`-Tabelle, die auch die
 * Extension befüllt — mit direction='outbound', Kampagne und Verweis auf die
 * Zeile der Anrufliste. Dadurch zählt Outbound in callVolumeStats,
 * dispositionBreakdown und den Reports automatisch mit.
 */
export async function insertOutboundCall(c: {
  contactId: string;
  campaignId: string;
  customerNumber?: string;
  customerName?: string;
  phone?: string;
  disposition: CallDisposition;
  note?: string;
  agentId: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await getSupabase().from('calls').insert({
    customer_number: c.customerNumber || null,
    caller_name: c.customerName || null,
    caller_number: c.phone || null,
    direction: 'outbound',
    started_at: now,
    ended_at: now,
    agent_id: c.agentId,
    disposition: c.disposition,
    note: c.note || null,
    campaign_id: c.campaignId,
    outbound_contact_id: c.contactId,
  });
  if (error) throw error;
}
