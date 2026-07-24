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
  consent_given_at timestamptz,            -- DSGVO-Hinweis bestätigt
  created_at timestamptz default now(),
  last_login_at timestamptz
);

-- ------------------------------------------------------------
-- CUSTOMERS
-- ------------------------------------------------------------
-- Eigenständige Kunden-Entität (Migration 017): ein Anrufer ohne Vertrag/
-- Tarifwechsel/Notiz existiert damit trotzdem im CRM. customer_number bleibt
-- in contracts/tariff_changes/notes/leads bewusst eine reine Textspalte ohne
-- Fremdschlüssel hierher. Wird ausschließlich über den touch_customer()-
-- Trigger weiter unten befüllt, siehe dort.
-- ------------------------------------------------------------
create table if not exists public.customers (
  customer_number text primary key,
  name text,
  phone text,
  first_seen_at timestamptz,
  last_contact_at timestamptz,
  created_by uuid references public.users(id) on delete set null
);
create index if not exists idx_customers_last_contact on public.customers(last_contact_at desc);

-- ------------------------------------------------------------
-- CAMPAIGNS
-- ------------------------------------------------------------
-- Fester, vom Chef gepflegter Kampagnen-Katalog (Migration 019,
-- Outbound-Umbau). call_type bestimmt in der Extension automatisch Skript
-- und Einwandkarten (siehe extension/src/config.js).
-- ------------------------------------------------------------
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  call_type text not null check (call_type in ('churn', 'welcome', 'other')),
  active boolean not null default true,
  created_at timestamptz default now(),
  created_by uuid references public.users(id) on delete set null
);

-- ------------------------------------------------------------
-- SHIFTS
-- ------------------------------------------------------------
-- Wochenraster Früh/Spät/frei je Agent:in und Tag, optional mit
-- Kampagnen-Zuordnung (Migration 020). Für alle aktiven Nutzer lesbar
-- (geteilter Plan), Schreiben bleibt Chef-Sache — siehe RLS unten.
-- ------------------------------------------------------------
create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  shift_date date not null,
  shift_type text not null check (shift_type in ('frueh', 'spaet', 'frei')),
  campaign_id uuid references public.campaigns(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, shift_date)
);
create index if not exists idx_shifts_date on public.shifts(shift_date);
create index if not exists idx_shifts_user_date on public.shifts(user_id, shift_date);

-- ------------------------------------------------------------
-- CALLS
-- ------------------------------------------------------------
-- Anruf-Historie (Migration 018): von der Stadtnetz-CRM-Copilot-Extension über
-- ihre eigene Supabase-Session automatisch geschrieben. customer_number ist
-- nullable — nicht jeder Anrufer ist zuzuordnen. disposition/cancellation_reason/
-- campaign_id (Migration 021) werden vom Abschluss-Panel der Extension am
-- Gesprächsende gesetzt und tragen die Save-Rate-/Kündigungsgrund-Auswertung
-- im Team-Dashboard (siehe src/lib/callStats.ts).
-- ------------------------------------------------------------
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  customer_number text,
  caller_name text,
  caller_number text,
  direction text not null check (direction in ('inbound', 'outbound')),
  queue_group text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_s int,
  agent_id uuid not null references public.users(id) on delete cascade,
  outcome text,
  note text,
  jira_ticket text,
  disposition text check (disposition in ('gehalten', 'gekuendigt', 'rueckruf', 'kein-interesse', 'sonstige')),
  cancellation_reason text,
  campaign_id uuid references public.campaigns(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_calls_customer on public.calls(customer_number);
create index if not exists idx_calls_agent on public.calls(agent_id);
create index if not exists idx_calls_started on public.calls(started_at desc);
create index if not exists idx_calls_active on public.calls(started_at) where ended_at is null;
create index if not exists idx_calls_campaign on public.calls(campaign_id);
create index if not exists idx_calls_disposition on public.calls(disposition);

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
  laufzeit_monate integer check (laufzeit_monate in (12, 24)),
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
-- CUSTOMER ACCESS REQUESTS
-- ------------------------------------------------------------
-- Kunden sind für alle aktiven Nutzer lesbar. Bearbeiten bleibt an Rechte
-- gebunden (Besitzer:in / geteilt / Chef:in). Wer keine Rechte hat, fragt sie
-- mit Begründung an; Besitzer:in oder Chef:in nimmt an oder lehnt ab.
-- ------------------------------------------------------------
create table if not exists public.customer_access_requests (
  id uuid primary key default gen_random_uuid(),
  customer_number text not null,
  requester_id uuid not null references public.users(id) on delete cascade,
  owner_id uuid references public.users(id) on delete set null,
  comment text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz default now(),
  decided_at timestamptz,
  decided_by uuid references public.users(id) on delete set null
);
create index if not exists idx_access_req_owner on public.customer_access_requests(owner_id);
create index if not exists idx_access_req_requester on public.customer_access_requests(requester_id);
create unique index if not exists uniq_pending_access_request
  on public.customer_access_requests (customer_number, requester_id)
  where status = 'pending';

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
  sp_file_path text default '',
  sp_sheet_name text default 'Tabelle1',
  updated_at timestamptz default now()
);

create table if not exists public.shared_settings (
  id int primary key default 1,
  products jsonb not null default '[]'::jsonb,
  tariff_commission jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  constraint single_row check (id = 1)
);

-- ------------------------------------------------------------
-- INCENTIVES
-- ------------------------------------------------------------
-- Zeitlich begrenzte Team-Ziele mit Belohnung, vom Chef konfiguriert.
-- mechanic: 'goal' (Zielprämie) | 'competition' (nur Platz 1 gewinnt).
-- Fortschritt wird live aus contracts/tariff_changes berechnet.
-- ------------------------------------------------------------
create table if not exists public.incentives (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  mechanic text not null check (mechanic in ('goal', 'competition')),
  metric text not null check (metric in ('commission', 'contracts', 'deals')),
  period text not null check (period in ('weekly', 'monthly')),
  target numeric not null default 0,
  reward text not null default '',
  active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ------------------------------------------------------------
-- LEADS
-- ------------------------------------------------------------
-- Selbst angelegte Vertriebs-Leads mit 4-Stufen-Pipeline.
-- Geteiltes Team-Werkzeug: alle Nutzer lesen/ändern alle Leads.
-- ------------------------------------------------------------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  customer_number text,
  phone text,
  topic text,
  status text not null default 'neu'
    check (status in ('neu', 'inBearbeitung', 'gewonnen', 'verloren')),
  priority text not null default 'normal'
    check (priority in ('normal', 'hoch', 'dringend')),
  follow_up_date date,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_leads_status on public.leads(status);
create index if not exists idx_leads_follow_up on public.leads(follow_up_date);

-- ------------------------------------------------------------
-- LEAD ACTIVITIES
-- ------------------------------------------------------------
-- Aktivitäts-Log pro Lead: Kontaktversuche und Team-Notizen.
-- ------------------------------------------------------------
create table if not exists public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  type text not null check (type in ('contact', 'note')),
  content text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists idx_lead_activities_lead_id on public.lead_activities(lead_id);

-- ------------------------------------------------------------
-- AUDIT LOG
-- ------------------------------------------------------------
-- Wer hat wann welche Aktion auf welche Entität ausgeführt? DSGVO Art. 30.
-- actor_name ist denormalisiert, damit Logs auch nach User-Löschung lesbar
-- bleiben. Einträge sind unveränderlich (keine update/delete-Policy).
-- ------------------------------------------------------------
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id) on delete set null,
  actor_name text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  entity_label text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_log_created_at on public.audit_log(created_at desc);
create index if not exists idx_audit_log_actor on public.audit_log(actor_id);
create index if not exists idx_audit_log_entity on public.audit_log(entity_type, entity_id);
create index if not exists idx_audit_log_action on public.audit_log(action);

-- ------------------------------------------------------------
-- STATUS BOARD
-- ------------------------------------------------------------
-- user_status: der aktuelle Status je Nutzer:in (genau eine Zeile) für die
-- Live-Team-Ansicht. status_log: lückenlose Historie abgeschlossener Abschnitte
-- (Start/Ende/Dauer) als Grundlage für Chef-KPIs und den PowerBI-Export.
-- ------------------------------------------------------------
create table if not exists public.user_status (
  user_id uuid primary key references public.users(id) on delete cascade,
  status text,
  sub text,
  description text,
  is_afk boolean not null default false,
  started_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.status_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  status text not null,
  sub text,
  description text,
  is_afk boolean not null default false,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_seconds integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_status_log_user on public.status_log(user_id);
create index if not exists idx_status_log_started on public.status_log(started_at desc);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table public.users enable row level security;
alter table public.customers enable row level security;
alter table public.calls enable row level security;
alter table public.contracts enable row level security;
alter table public.tariff_changes enable row level security;
alter table public.notes enable row level security;
alter table public.customer_ownerships enable row level security;
alter table public.user_settings enable row level security;
alter table public.shared_settings enable row level security;
alter table public.incentives enable row level security;
alter table public.leads enable row level security;
alter table public.user_status enable row level security;
alter table public.status_log enable row level security;
alter table public.lead_activities enable row level security;
alter table public.audit_log enable row level security;
alter table public.customer_access_requests enable row level security;

-- ----------------------------------------------------------------------------
-- Helper-Funktionen (SECURITY DEFINER → umgehen RLS, verhindern Rekursion bei
-- Policies, die public.users abfragen).
-- ----------------------------------------------------------------------------
create or replace function public.auth_is_active()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select u.is_active from public.users u where u.id = auth.uid()), false);
$$;

create or replace function public.auth_is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select u.role = 'manager' and u.is_active from public.users u where u.id = auth.uid()),
    false
  );
$$;

grant execute on function public.auth_is_active() to authenticated, anon;
grant execute on function public.auth_is_manager() to authenticated, anon;

-- Existiert mindestens ein Nutzerprofil? Nur ein Boolean (anon-lesbar), damit
-- der Login-Screen den Bootstrap des ersten Kontos erkennt.
create or replace function public.users_exist()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users);
$$;

grant execute on function public.users_exist() to anon, authenticated;

-- Profil automatisch anlegen: Sobald ein Auth-Konto entsteht (signUp), legt
-- dieser SECURITY-DEFINER-Trigger das zugehörige public.users-Profil an. Damit
-- ist die Profil-Erstellung unabhängig von Session/RLS/E-Mail-Bestätigung und
-- der Client muss das Profil nicht mehr selbst einfügen. Anzeige-Name und
-- normalisierter key kommen aus den signUp-Metadaten (mit Fallbacks).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_display text;
  v_key text;
begin
  v_display := coalesce(
    nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
    split_part(new.email, '@', 1)
  );
  v_key := coalesce(
    nullif(trim(new.raw_user_meta_data->>'key'), ''),
    lower(v_display)
  );
  begin
    insert into public.users (id, key, display_name)
    values (new.id, v_key, v_display)
    on conflict (id) do nothing;
  exception
    when unique_violation then
      insert into public.users (id, key, display_name)
      values (new.id, v_key || '-' || left(new.id::text, 8), v_display)
      on conflict (id) do nothing;
  end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Kunden-Zeile automatisch pflegen: bei jedem neuen/geänderten Vertrag,
-- Tarifwechsel, Notiz oder Lead legt dieser SECURITY-DEFINER-Trigger die
-- passende public.customers-Zeile an bzw. aktualisiert last_contact_at. So
-- bleibt customers aktuell, ohne die vier bestehenden Insert-Pfade im Client
-- anzufassen (siehe src/lib/supabaseApi.ts).
create or replace function public.touch_customer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.customer_number is null or new.customer_number = '' then
    return new;
  end if;

  insert into public.customers (customer_number, name, first_seen_at, last_contact_at, created_by)
  values (
    new.customer_number,
    coalesce(nullif(new.customer_name, ''), ''),
    now(),
    now(),
    new.created_by
  )
  on conflict (customer_number) do update
    set last_contact_at = now(),
        name = coalesce(nullif(public.customers.name, ''), excluded.name);

  return new;
end;
$$;

drop trigger if exists trg_touch_customer_contracts on public.contracts;
create trigger trg_touch_customer_contracts
  after insert or update on public.contracts
  for each row execute function public.touch_customer();

drop trigger if exists trg_touch_customer_tariff on public.tariff_changes;
create trigger trg_touch_customer_tariff
  after insert or update on public.tariff_changes
  for each row execute function public.touch_customer();

drop trigger if exists trg_touch_customer_notes on public.notes;
create trigger trg_touch_customer_notes
  after insert or update on public.notes
  for each row execute function public.touch_customer();

drop trigger if exists trg_touch_customer_leads on public.leads;
create trigger trg_touch_customer_leads
  after insert or update on public.leads
  for each row execute function public.touch_customer();

-- calls hat weder customer_name noch created_by (stattdessen caller_name/
-- agent_id) — touch_customer() passt nicht direkt, daher eine eigene,
-- sonst identische Funktion. Ohne das bekäme ein Anrufer, der nie einen
-- Vertrag/Tarifwechsel/Notiz/Lead hatte, trotz protokollierter Anrufe keine
-- eigenständige customers-Zeile.
create or replace function public.touch_customer_from_call()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.customer_number is null or new.customer_number = '' then
    return new;
  end if;

  insert into public.customers (customer_number, name, first_seen_at, last_contact_at, created_by)
  values (
    new.customer_number,
    coalesce(nullif(new.caller_name, ''), ''),
    now(),
    now(),
    new.agent_id
  )
  on conflict (customer_number) do update
    set last_contact_at = now(),
        name = coalesce(nullif(public.customers.name, ''), excluded.name);

  return new;
end;
$$;

drop trigger if exists trg_touch_customer_calls on public.calls;
create trigger trg_touch_customer_calls
  after insert on public.calls
  for each row execute function public.touch_customer_from_call();

-- Privilege-Escalation verhindern: role/is_active/key/id nur durch Manager:innen
-- (oder serverseitig per service_role / SQL-Editor, wo auth.uid() NULL ist).
-- Ausnahme: Solange noch KEIN Manager existiert, darf der erste Account sich
-- selbst befördern (Bootstrap).
create or replace function public.prevent_user_privilege_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role
      or new.is_active is distinct from old.is_active
      or new.key is distinct from old.key
      or new.id is distinct from old.id)
     and auth.uid() is not null
     and not public.auth_is_manager()
     and exists (select 1 from public.users where role = 'manager') then
    raise exception 'Nicht erlaubt: Rolle, Status oder Schlüssel dürfen nur von Manager:innen geändert werden.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_user_privilege_change on public.users;
create trigger trg_prevent_user_privilege_change
  before update on public.users
  for each row execute function public.prevent_user_privilege_change();

-- USERS: aktive Nutzer lesen alle Profile (Leaderboard, Sharing). Schreiben nur
-- das eigene Profil; Manager:innen auch fremde. Schutz-Spalten siehe Trigger.
create policy "users read all" on public.users
  for select using (public.auth_is_active());
create policy "users insert own" on public.users
  for insert with check (auth.uid() = id);
create policy "users update own or manager" on public.users
  for update using (auth.uid() = id or public.auth_is_manager());

-- CUSTOMERS: lesen für alle aktiven Nutzer (auch die Extension-Session ist nur
-- ein weiterer aktiver Nutzer). Schreiben ausschließlich über den
-- touch_customer()-Trigger oben, deshalb keine insert/update-Policy für
-- Clients. Löschen nur für Chefs (DSGVO-Purge in CustomerDetail.tsx ist
-- managergated).
create policy "customers read all" on public.customers
  for select using (public.auth_is_active());
create policy "customers delete manager" on public.customers
  for delete using (public.auth_is_manager());

-- CALLS: lesen für alle aktiven Nutzer (Live-Anrufleiste, Anrufhistorie,
-- Team-KPI). Anlegen nur als sich selbst (agent_id = auth.uid()), damit kein
-- Client Anrufe im Namen anderer Agent:innen einträgt. Abschließen
-- (ended_at/duration_s) durch die eigene Sitzung oder einen Chef. Löschen
-- (u.a. DSGVO-Purge) nur für Chefs.
create policy "calls read all" on public.calls
  for select using (public.auth_is_active());
create policy "calls insert own" on public.calls
  for insert with check (public.auth_is_active() and auth.uid() = agent_id);
create policy "calls update own or manager" on public.calls
  for update using (public.auth_is_active() and (auth.uid() = agent_id or public.auth_is_manager()));
create policy "calls delete manager" on public.calls
  for delete using (public.auth_is_manager());

-- CAMPAIGNS: alle aktiven Nutzer lesen (Extension braucht sie fürs
-- Call-Typ-Routing, Agenten sehen sie im Schichtplan). Schreiben nur Chefs.
create policy "campaigns read all" on public.campaigns
  for select using (public.auth_is_active());
create policy "campaigns insert manager" on public.campaigns
  for insert with check (public.auth_is_manager());
create policy "campaigns update manager" on public.campaigns
  for update using (public.auth_is_manager());
create policy "campaigns delete manager" on public.campaigns
  for delete using (public.auth_is_manager());

-- SHIFTS: alle aktiven Nutzer lesen den kompletten Plan (geteilte Ansicht,
-- kein user_id = auth.uid()-Filter). Schreiben/Ändern/Löschen nur Chefs.
create policy "shifts read all" on public.shifts
  for select using (public.auth_is_active());
create policy "shifts insert manager" on public.shifts
  for insert with check (public.auth_is_manager());
create policy "shifts update manager" on public.shifts
  for update using (public.auth_is_manager());
create policy "shifts delete manager" on public.shifts
  for delete using (public.auth_is_manager());

-- CONTRACTS / TARIFF / NOTES: aktive Nutzer lesen alles.
-- Bearbeiten/Löschen nur, wenn der User den Datensatz selbst erfasst hat,
-- Owner/Co-Owner des zugehörigen Kunden ODER ein Chef (role = 'manager') ist.
create policy "contracts read all" on public.contracts
  for select using (public.auth_is_active());
create policy "contracts insert own" on public.contracts
  for insert with check (public.auth_is_active() and auth.uid() = created_by);
create policy "contracts update own" on public.contracts
  for update using (
    public.auth_is_active() and (
      auth.uid() = created_by
      or exists (
        select 1 from public.customer_ownerships o
        where o.customer_number = contracts.customer_number
          and (o.owner = auth.uid() or auth.uid() = any(o.shared_with))
      )
      or public.auth_is_manager()
    )
  );
create policy "contracts delete own" on public.contracts
  for delete using (
    public.auth_is_active() and (
      auth.uid() = created_by
      or exists (
        select 1 from public.customer_ownerships o
        where o.customer_number = contracts.customer_number
          and (o.owner = auth.uid() or auth.uid() = any(o.shared_with))
      )
      or public.auth_is_manager()
    )
  );

create policy "tariff read all" on public.tariff_changes
  for select using (public.auth_is_active());
create policy "tariff insert own" on public.tariff_changes
  for insert with check (public.auth_is_active() and auth.uid() = created_by);
create policy "tariff update own" on public.tariff_changes
  for update using (
    public.auth_is_active() and (
      auth.uid() = created_by
      or exists (
        select 1 from public.customer_ownerships o
        where o.customer_number = tariff_changes.customer_number
          and (o.owner = auth.uid() or auth.uid() = any(o.shared_with))
      )
      or public.auth_is_manager()
    )
  );
create policy "tariff delete own" on public.tariff_changes
  for delete using (
    public.auth_is_active() and (
      auth.uid() = created_by
      or exists (
        select 1 from public.customer_ownerships o
        where o.customer_number = tariff_changes.customer_number
          and (o.owner = auth.uid() or auth.uid() = any(o.shared_with))
      )
      or public.auth_is_manager()
    )
  );

create policy "notes read all" on public.notes
  for select using (public.auth_is_active());
create policy "notes insert own" on public.notes
  for insert with check (public.auth_is_active() and auth.uid() = created_by);
create policy "notes update own" on public.notes
  for update using (
    public.auth_is_active() and (
      auth.uid() = created_by
      or exists (
        select 1 from public.customer_ownerships o
        where o.customer_number = notes.customer_number
          and (o.owner = auth.uid() or auth.uid() = any(o.shared_with))
      )
      or public.auth_is_manager()
    )
  );
create policy "notes delete own" on public.notes
  for delete using (
    public.auth_is_active() and (
      auth.uid() = created_by
      or exists (
        select 1 from public.customer_ownerships o
        where o.customer_number = notes.customer_number
          and (o.owner = auth.uid() or auth.uid() = any(o.shared_with))
      )
      or public.auth_is_manager()
    )
  );

-- OWNERSHIPS: aktive Nutzer lesen/anlegen, Besitzer:in/Manager:in ändern/löschen.
-- WITH CHECK bewusst nur "aktiv": die Besitzer:in darf den Besitz auf eine
-- andere Person ÜBERTRAGEN (owner wechselt) — ohne eigene WITH-CHECK-Klausel
-- würde Postgres die USING-Bedingung auch auf die neue Zeile anwenden und
-- die Übertragung ablehnen.
create policy "ownership read all" on public.customer_ownerships
  for select using (public.auth_is_active());
create policy "ownership insert" on public.customer_ownerships
  for insert with check (public.auth_is_active());
create policy "ownership update owner or manager" on public.customer_ownerships
  for update
  using (public.auth_is_active() and (auth.uid() = owner or public.auth_is_manager()))
  with check (public.auth_is_active());
create policy "ownership delete owner or manager" on public.customer_ownerships
  for delete using (public.auth_is_active() and (auth.uid() = owner or public.auth_is_manager()));

-- SETTINGS: jeder verwaltet seine eigene Zeile, Chefs verwalten alle
-- (z.B. um Monatsziele im Team-Bereich zu setzen).
create policy "user_settings read own or manager" on public.user_settings
  for select using (public.auth_is_active() and (auth.uid() = user_id or public.auth_is_manager()));
create policy "user_settings insert own or manager" on public.user_settings
  for insert with check (public.auth_is_active() and (auth.uid() = user_id or public.auth_is_manager()));
create policy "user_settings update own or manager" on public.user_settings
  for update using (public.auth_is_active() and (auth.uid() = user_id or public.auth_is_manager()));

create policy "shared_settings read all" on public.shared_settings
  for select using (public.auth_is_active());
create policy "shared_settings upsert all" on public.shared_settings
  for insert with check (public.auth_is_active());
create policy "shared_settings update all" on public.shared_settings
  for update using (public.auth_is_active());

-- INCENTIVES: alle aktiven lesen laufende Incentives; schreiben nur Chefs.
create policy "incentives read all" on public.incentives
  for select using (public.auth_is_active());
create policy "incentives insert manager" on public.incentives
  for insert with check (public.auth_is_manager());
create policy "incentives update manager" on public.incentives
  for update using (public.auth_is_manager());
create policy "incentives delete manager" on public.incentives
  for delete using (public.auth_is_manager());

-- LEADS: geteiltes Team-Werkzeug — alle aktiven Nutzer dürfen alles.
create policy "leads read all" on public.leads
  for select using (public.auth_is_active());
create policy "leads insert all" on public.leads
  for insert with check (public.auth_is_active());
create policy "leads update all" on public.leads
  for update using (public.auth_is_active());
create policy "leads delete all" on public.leads
  for delete using (public.auth_is_active());

-- LEAD ACTIVITIES: alle aktiven lesen/anlegen, nur Ersteller darf löschen.
create policy "lead_activities read all" on public.lead_activities
  for select using (public.auth_is_active());
create policy "lead_activities insert all" on public.lead_activities
  for insert with check (public.auth_is_active());
create policy "lead_activities delete own" on public.lead_activities
  for delete using (public.auth_is_active() and auth.uid() = created_by);

-- AUDIT LOG: nur Manager lesen; jeder loggt nur seine eigenen Aktionen; immutable.
create policy "audit_log read manager only" on public.audit_log
  for select using (public.auth_is_manager());
create policy "audit_log insert own actions" on public.audit_log
  for insert with check (public.auth_is_active() and actor_id = auth.uid());

-- ACCESS REQUESTS: Anfragende:r, Besitzer:in und Chef:innen lesen; anlegen nur
-- für sich selbst; annehmen/ablehnen nur Besitzer:in oder Chef:in.
create policy "access_req read involved" on public.customer_access_requests
  for select using (
    public.auth_is_active()
    and (requester_id = auth.uid() or owner_id = auth.uid() or public.auth_is_manager())
  );
create policy "access_req insert own" on public.customer_access_requests
  for insert with check (public.auth_is_active() and requester_id = auth.uid());
create policy "access_req decide owner or manager" on public.customer_access_requests
  for update using (
    public.auth_is_active()
    and (owner_id = auth.uid() or public.auth_is_manager())
  );

-- USER_STATUS: alle aktiven Nutzer:innen sehen den Live-Status aller Kolleg:innen;
-- schreiben darf jede:r nur die eigene Zeile.
create policy "user_status read all" on public.user_status
  for select using (public.auth_is_active());
create policy "user_status insert own" on public.user_status
  for insert with check (public.auth_is_active() and user_id = auth.uid());
create policy "user_status update own" on public.user_status
  for update using (public.auth_is_active() and user_id = auth.uid());
create policy "user_status delete own" on public.user_status
  for delete using (public.auth_is_active() and user_id = auth.uid());

-- STATUS_LOG: eigene Historie + Chef:innen lesen; anlegen nur für sich selbst;
-- Chef:innen dürfen die Historie aufräumen.
create policy "status_log read own or manager" on public.status_log
  for select using (public.auth_is_active() and (user_id = auth.uid() or public.auth_is_manager()));
create policy "status_log insert own" on public.status_log
  for insert with check (public.auth_is_active() and user_id = auth.uid());
create policy "status_log delete manager" on public.status_log
  for delete using (public.auth_is_manager());

-- ============================================================================
-- RPCs
-- ============================================================================

-- Ein Aufruf statt vier Tabellenabfragen aus einem Content-Script — die
-- Stadtnetz-CRM-Copilot-Extension ruft das bei eingehendem Anruf für die
-- Kundenakte auf. Bewusst NICHT security definer: RLS erlaubt bereits jedem
-- aktiven Nutzer (auch der Extension-Session) das Lesen dieser Tabellen,
-- Invoker-Rechte reichen also (least privilege). Kein customers-Eintrag zur
-- Nummer → die Funktion liefert null ("im CRM nicht bekannt"). leads hat
-- keine jira_ticket-Spalte, daher fließt nur contracts/tariff_changes/notes
-- in die Ticket-Suche ein.
create or replace function public.customer_card(p_customer_number text)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'customerNumber', p_customer_number,
    'name', c.name,
    'phone', c.phone,
    'firstSeenAt', c.first_seen_at,
    'lastContactAt', c.last_contact_at,
    'contractCount', (select count(*) from public.contracts x where x.customer_number = p_customer_number),
    'tariffChangeCount', (select count(*) from public.tariff_changes x where x.customer_number = p_customer_number),
    'noteCount', (select count(*) from public.notes x where x.customer_number = p_customer_number),
    'leadCount', (select count(*) from public.leads x where x.customer_number = p_customer_number),
    'jiraTicket', (
      select jira_ticket from (
        select jira_ticket, created_at from public.contracts
          where customer_number = p_customer_number and jira_ticket is not null and jira_ticket <> ''
        union all
        select jira_ticket, created_at from public.tariff_changes
          where customer_number = p_customer_number and jira_ticket is not null and jira_ticket <> ''
        union all
        select jira_ticket, created_at from public.notes
          where customer_number = p_customer_number and jira_ticket is not null and jira_ticket <> ''
      ) t
      order by created_at desc
      limit 1
    )
  )
  from public.customers c
  where c.customer_number = p_customer_number;
$$;

grant execute on function public.customer_card(text) to authenticated;

-- ============================================================================
-- REALTIME
-- ============================================================================
-- Damit alle Clients live Updates bekommen.
alter publication supabase_realtime add table public.customers;
alter publication supabase_realtime add table public.calls;
alter publication supabase_realtime add table public.contracts;
alter publication supabase_realtime add table public.tariff_changes;
alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.customer_ownerships;
alter publication supabase_realtime add table public.users;
alter publication supabase_realtime add table public.incentives;
alter publication supabase_realtime add table public.leads;
alter publication supabase_realtime add table public.lead_activities;
alter publication supabase_realtime add table public.audit_log;
alter publication supabase_realtime add table public.customer_access_requests;
alter publication supabase_realtime add table public.user_status;
alter publication supabase_realtime add table public.status_log;
alter publication supabase_realtime add table public.campaigns;
alter publication supabase_realtime add table public.shifts;
