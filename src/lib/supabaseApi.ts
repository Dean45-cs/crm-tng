import { getSupabase } from './supabase';
import type {
  Contract,
  TariffChange,
  Note,
  Settings,
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
// CUSTOMER PURGE — Recht auf Vergessenwerden (Art. 17 DSGVO)
// ============================================================================

/**
 * Löscht alle CRM-Spuren eines Kunden: Verträge, Tarifwechsel, Notizen und
 * Ownership-Eintrag. Liefert die Anzahl gelöschter Zeilen pro Tabelle zurück.
 * RLS sorgt dafür, dass nur Berechtigte (Ersteller/Owner/Manager) das ausführen
 * können — Manager dürfen kraft Policy alle Zeilen löschen.
 */
export async function purgeCustomerData(customerNumber: string): Promise<{
  contracts: number;
  tariffChanges: number;
  notes: number;
  ownership: number;
}> {
  const sb = getSupabase();
  const [c, t, n, o] = await Promise.all([
    sb.from('contracts').delete({ count: 'exact' }).eq('customer_number', customerNumber),
    sb.from('tariff_changes').delete({ count: 'exact' }).eq('customer_number', customerNumber),
    sb.from('notes').delete({ count: 'exact' }).eq('customer_number', customerNumber),
    sb.from('customer_ownerships').delete({ count: 'exact' }).eq('customer_number', customerNumber),
  ]);
  for (const res of [c, t, n, o]) if (res.error) throw res.error;
  return {
    contracts: c.count ?? 0,
    tariffChanges: t.count ?? 0,
    notes: n.count ?? 0,
    ownership: o.count ?? 0,
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
