-- ============================================================================
-- Migration 017 — customers (eigenständige Kunden-Entität)
-- ============================================================================
-- Im Supabase-Dashboard unter SQL Editor ausführen (nach 016).
--
-- Bisher war ein Kunde nur eine Ableitung aus contracts/tariff_changes/notes
-- (buildCustomerSummaries() im Client) — ein Anrufer ohne Vorgang existierte
-- im CRM nicht. Diese Migration macht die Kundennummer zur eigenständigen
-- Entität: legt public.customers an, befüllt sie per Backfill aus contracts,
-- tariff_changes, notes und leads, und hält sie danach über einen
-- SECURITY-DEFINER-Trigger selbstständig aktuell — ohne die vier bestehenden
-- Insert-Pfade in src/lib/supabaseApi.ts anfassen zu müssen.
--
-- Bestehende Tabellen behalten customer_number als reine Textspalte, bewusst
-- ohne Fremdschlüssel, damit die Migration bestehende Daten nicht bricht.
--
-- Grundlage für Stufe 1 aus KONZEPT-INTEGRATION.md ("Der Anrufer bekommt ein
-- Gesicht") — die neue customer_card()-RPC ist der Lookup, den die
-- Support-Copilot-Extension bei eingehendem Anruf aufruft.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tabelle
-- ----------------------------------------------------------------------------
create table if not exists public.customers (
  customer_number text primary key,
  name text,
  phone text,
  first_seen_at timestamptz,
  last_contact_at timestamptz,
  created_by uuid references public.users(id) on delete set null
);
create index if not exists idx_customers_last_contact on public.customers(last_contact_at desc);

alter table public.customers enable row level security;

-- ----------------------------------------------------------------------------
-- RLS: lesen für alle aktiven Nutzer (spiegelt contracts/tariff/notes read-all
-- exakt — die Extension-Session ist auch nur ein weiterer aktiver Nutzer).
-- Schreiben/Ändern läuft ausschließlich über den SECURITY-DEFINER-Trigger
-- unten, es gibt bewusst keine insert/update-Policy für Clients. Löschen nur
-- für Chefs, weil der Purge-Button in CustomerDetail.tsx nur für Manager
-- sichtbar ist.
-- ----------------------------------------------------------------------------
drop policy if exists "customers read all" on public.customers;
create policy "customers read all" on public.customers
  for select using (public.auth_is_active());

drop policy if exists "customers delete manager" on public.customers;
create policy "customers delete manager" on public.customers
  for delete using (public.auth_is_manager());

-- ----------------------------------------------------------------------------
-- Self-maintaining: Trigger auf contracts/tariff_changes/notes/leads pflegt
-- die Kundenzeile bei jedem neuen/geänderten Vorgang. SECURITY DEFINER, weil
-- z. B. eine Notiz mit fremder customer_number keine eigene Schreibberechtigung
-- auf public.customers haben soll — dasselbe Muster wie handle_new_user()
-- (Migration 015).
-- ----------------------------------------------------------------------------
create or replace function public.touch_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

-- ----------------------------------------------------------------------------
-- Backfill: bestehende Kundennummern aus allen vier Quelltabellen einmalig
-- einlesen. Name = frühester nicht-leerer customer_name über alle Quellen,
-- first_seen_at = frühester, last_contact_at = spätester created_at.
-- ----------------------------------------------------------------------------
insert into public.customers (customer_number, name, first_seen_at, last_contact_at, created_by)
select
  t.customer_number,
  t.name,
  t.first_seen_at,
  t.last_contact_at,
  t.created_by
from (
  select
    customer_number,
    (array_agg(customer_name order by created_at asc)
       filter (where customer_name is not null and customer_name <> ''))[1] as name,
    min(created_at) as first_seen_at,
    max(created_at) as last_contact_at,
    (array_agg(created_by order by created_at asc)
       filter (where created_by is not null))[1] as created_by
  from (
    select customer_number, customer_name, created_at, created_by from public.contracts
    union all
    select customer_number, customer_name, created_at, created_by from public.tariff_changes
    union all
    select customer_number, customer_name, created_at, created_by from public.notes
    union all
    select customer_number, customer_name, created_at, created_by from public.leads
  ) all_rows
  where customer_number is not null and customer_number <> ''
  group by customer_number
) t
on conflict (customer_number) do nothing;

-- ----------------------------------------------------------------------------
-- RPC für die Extension: ein Aufruf statt vier Tabellenabfragen aus einem
-- Content-Script. Bewusst NICHT security definer — RLS erlaubt bereits jedem
-- aktiven Nutzer (auch der Extension-Session) das Lesen dieser Tabellen, also
-- reichen Invoker-Rechte (least privilege). Existiert kein customers-Eintrag
-- zur Nummer, liefert die Funktion null (= "im CRM nicht bekannt"). leads hat
-- keine jira_ticket-Spalte, daher fließt nur contracts/tariff_changes/notes
-- in die Ticket-Suche ein.
-- ----------------------------------------------------------------------------
create or replace function public.customer_card(p_customer_number text)
returns jsonb
language sql
stable
as $$
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

-- ----------------------------------------------------------------------------
-- Realtime
-- ----------------------------------------------------------------------------
alter publication supabase_realtime add table public.customers;
