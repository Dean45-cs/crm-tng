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

export async function updateUserRole(id: string, role: 'agent' | 'manager'): Promise<void> {
  const { error } = await getSupabase().from('users').update({ role }).eq('id', id);
  if (error) throw error;
}

export async function setUserActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await getSupabase().from('users').update({ is_active: isActive }).eq('id', id);
  if (error) throw error;
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
}

interface SharedSettingsRow {
  id: number;
  products: ProductInfo[];
  tariff_commission: TariffCommissionMatrix;
}

export async function fetchSettings(userId: string): Promise<{
  user: Pick<Settings, 'monthlyTarget' | 'spClientId' | 'spTenantId'> | null;
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
  patch: Partial<Pick<Settings, 'monthlyTarget' | 'spClientId' | 'spTenantId'>>,
): Promise<void> {
  const payload: Record<string, unknown> = {
    user_id: userId,
    updated_at: new Date().toISOString(),
  };
  if (patch.monthlyTarget !== undefined) payload.monthly_target = patch.monthlyTarget;
  if (patch.spClientId !== undefined) payload.sp_client_id = patch.spClientId;
  if (patch.spTenantId !== undefined) payload.sp_tenant_id = patch.spTenantId;
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
