-- ============================================================================
-- TNG Stadtnetz CRM — Supabase Schema
-- ============================================================================
-- Im Supabase-Dashboard unter SQL Editor einmal komplett ausführen.
-- Erzeugt alle Tabellen, RLS-Policies und Realtime-Publikationen.
-- ============================================================================

-- ------------------------------------------------------------
-- USERS
-- ------------------------------------------------------------
-- Mapping zwischen Supabase auth.users und unseren CRM-Profilen.
-- Pro Account ein Profil. PIN wird via Supabase Auth gespeichert
-- (auth.users.encrypted_password), Anzeige-Name + Flags hier.
-- ------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  key text unique not null,                -- normalized name (lowercase)
  display_name text not null,
  onboarding_completed boolean default false,
  leaderboard_opt_in boolean default true,
  role text default 'agent' check (role in ('agent', 'manager')),
  is_active boolean default true,
  created_at timestamptz default now(),
  last_login_at timestamptz
);

-- ------------------------------------------------------------
-- CONTRACTS
-- ------------------------------------------------------------
create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  customer_number text not null,
  customer_name text not null,
  products jsonb not null default '[]'::jsonb,
  contract_date date not null,
  status text not null,
  jira_ticket text,
  follow_up_date date,
  notes text,
  created_at timestamptz default now(),
  created_by uuid references public.users(id) on delete set null
);
create index if not exists idx_contracts_customer on public.contracts(customer_number);
create index if not exists idx_contracts_created_by on public.contracts(created_by);

-- ------------------------------------------------------------
-- TARIFF CHANGES
-- ------------------------------------------------------------
create table if not exists public.tariff_changes (
  id uuid primary key default gen_random_uuid(),
  customer_number text not null,
  customer_name text not null,
  change_type text not null,
  context text not null,
  old_product text,
  new_product text,
  change_date date not null,
  jira_ticket text,
  notes text,
  exported_at timestamptz,
  created_at timestamptz default now(),
  created_by uuid references public.users(id) on delete set null
);
create index if not exists idx_tariff_customer on public.tariff_changes(customer_number);
create index if not exists idx_tariff_created_by on public.tariff_changes(created_by);

-- ------------------------------------------------------------
-- NOTES
-- ------------------------------------------------------------
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  customer_number text,
  customer_name text,
  title text not null,
  content text not null,
  jira_ticket text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references public.users(id) on delete set null
);
create index if not exists idx_notes_customer on public.notes(customer_number);
create index if not exists idx_notes_created_by on public.notes(created_by);

-- ------------------------------------------------------------
-- CUSTOMER OWNERSHIPS
-- ------------------------------------------------------------
create table if not exists public.customer_ownerships (
  customer_number text primary key,
  owner uuid not null references public.users(id) on delete cascade,
  shared_with uuid[] not null default '{}'::uuid[],
  updated_at timestamptz default now()
);

-- ------------------------------------------------------------
-- SETTINGS
-- ------------------------------------------------------------
-- Eine Zeile pro User. Hält individuelle Ziele und Konfiguration.
-- Produkt-Provisionen und Tarif-Matrix sind shared (kein User-Bezug
-- nötig im MVP) und liegen in shared_settings (singleton).
-- ------------------------------------------------------------
create table if not exists public.user_settings (
  user_id uuid primary key references public.users(id) on delete cascade,
  monthly_target numeric default 1500,
  sp_client_id text default '',
  sp_tenant_id text default '',
  updated_at timestamptz default now()
);

create table if not exists public.shared_settings (
  id int primary key default 1,
  products jsonb not null default '[]'::jsonb,
  tariff_commission jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  constraint single_row check (id = 1)
);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.users enable row level security;
alter table public.contracts enable row level security;
alter table public.tariff_changes enable row level security;
alter table public.notes enable row level security;
alter table public.customer_ownerships enable row level security;
alter table public.user_settings enable row level security;
alter table public.shared_settings enable row level security;

-- USERS: alle authentifizierten User dürfen alle Profile lesen
-- (fürs Leaderboard und Sharing). Schreiben nur das eigene Profil –
-- Chefs (role = 'manager') dürfen auch fremde Profile ändern.
create policy "users read all" on public.users
  for select using (auth.role() = 'authenticated');
create policy "users insert own" on public.users
  for insert with check (auth.uid() = id);
create policy "users update own or manager" on public.users
  for update using (
    auth.uid() = id
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'manager')
  );

-- CONTRACTS / TARIFF / NOTES: alle authentifizierten lesen alles.
-- Bearbeiten/Löschen nur, wenn der User den Datensatz selbst erfasst hat,
-- Owner/Co-Owner des zugehörigen Kunden ODER ein Chef (role = 'manager') ist.
create policy "contracts read all" on public.contracts
  for select using (auth.role() = 'authenticated');
create policy "contracts insert own" on public.contracts
  for insert with check (auth.uid() = created_by);
create policy "contracts update own" on public.contracts
  for update using (
    auth.uid() = created_by
    or exists (
      select 1 from public.customer_ownerships o
      where o.customer_number = contracts.customer_number
        and (o.owner = auth.uid() or auth.uid() = any(o.shared_with))
    )
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'manager')
  );
create policy "contracts delete own" on public.contracts
  for delete using (
    auth.uid() = created_by
    or exists (
      select 1 from public.customer_ownerships o
      where o.customer_number = contracts.customer_number
        and (o.owner = auth.uid() or auth.uid() = any(o.shared_with))
    )
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'manager')
  );

create policy "tariff read all" on public.tariff_changes
  for select using (auth.role() = 'authenticated');
create policy "tariff insert own" on public.tariff_changes
  for insert with check (auth.uid() = created_by);
create policy "tariff update own" on public.tariff_changes
  for update using (
    auth.uid() = created_by
    or exists (
      select 1 from public.customer_ownerships o
      where o.customer_number = tariff_changes.customer_number
        and (o.owner = auth.uid() or auth.uid() = any(o.shared_with))
    )
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'manager')
  );
create policy "tariff delete own" on public.tariff_changes
  for delete using (
    auth.uid() = created_by
    or exists (
      select 1 from public.customer_ownerships o
      where o.customer_number = tariff_changes.customer_number
        and (o.owner = auth.uid() or auth.uid() = any(o.shared_with))
    )
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'manager')
  );

create policy "notes read all" on public.notes
  for select using (auth.role() = 'authenticated');
create policy "notes insert own" on public.notes
  for insert with check (auth.uid() = created_by);
create policy "notes update own" on public.notes
  for update using (
    auth.uid() = created_by
    or exists (
      select 1 from public.customer_ownerships o
      where o.customer_number = notes.customer_number
        and (o.owner = auth.uid() or auth.uid() = any(o.shared_with))
    )
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'manager')
  );
create policy "notes delete own" on public.notes
  for delete using (
    auth.uid() = created_by
    or exists (
      select 1 from public.customer_ownerships o
      where o.customer_number = notes.customer_number
        and (o.owner = auth.uid() or auth.uid() = any(o.shared_with))
    )
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'manager')
  );

-- OWNERSHIPS: alle lesen, alle anlegen, nur owner ändern/löschen
create policy "ownership read all" on public.customer_ownerships
  for select using (auth.role() = 'authenticated');
create policy "ownership insert" on public.customer_ownerships
  for insert with check (auth.role() = 'authenticated');
create policy "ownership update owner" on public.customer_ownerships
  for update using (auth.uid() = owner);
create policy "ownership delete owner" on public.customer_ownerships
  for delete using (auth.uid() = owner);

-- SETTINGS: jeder verwaltet seine eigene Zeile, Chefs verwalten alle
-- (z.B. um Monatsziele im Team-Bereich zu setzen).
create policy "user_settings read own or manager" on public.user_settings
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'manager')
  );
create policy "user_settings insert own or manager" on public.user_settings
  for insert with check (
    auth.uid() = user_id
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'manager')
  );
create policy "user_settings update own or manager" on public.user_settings
  for update using (
    auth.uid() = user_id
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'manager')
  );

create policy "shared_settings read all" on public.shared_settings
  for select using (auth.role() = 'authenticated');
create policy "shared_settings upsert all" on public.shared_settings
  for insert with check (auth.role() = 'authenticated');
create policy "shared_settings update all" on public.shared_settings
  for update using (auth.role() = 'authenticated');

-- ============================================================================
-- REALTIME
-- ============================================================================
-- Damit alle Clients live Updates bekommen.
alter publication supabase_realtime add table public.contracts;
alter publication supabase_realtime add table public.tariff_changes;
alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.customer_ownerships;
alter publication supabase_realtime add table public.users;
