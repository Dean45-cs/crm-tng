-- ============================================================================
-- Migration 011 — Security Hardening
-- ============================================================================
-- Im Supabase-Dashboard unter SQL Editor einmal komplett ausführen.
--
-- Schließt zwei Lücken, die mit reiner Client-Logik nicht abgesichert waren
-- (der anon-Key liegt im Browser, jede:r kann die DB direkt über die API
-- ansprechen):
--
--  1) PRIVILEGE-ESCALATION: Bisher erlaubte die Policy "users update own or
--     manager" einem Agenten, die EIGENE Zeile zu ändern — ohne Spalten-
--     beschränkung. Damit konnte man sich selbst zum Manager machen
--     (update public.users set role='manager' where id = auth.uid()).
--     Ein BEFORE-UPDATE-Trigger verbietet nun das Ändern von role / is_active
--     / key / id, außer durch Manager:innen (oder serverseitig per service_role
--     / SQL-Editor, wo auth.uid() NULL ist → Bootstrap des ersten Managers).
--
--  2) GESPERRTE NUTZER: Bisher prüften die Policies nur auth.role() =
--     'authenticated'. Ein gesperrter Nutzer (is_active = false) mit gültiger
--     PIN konnte die DB also weiter direkt über die API lesen/schreiben — die
--     Sperre war nur im Client. Alle Policies prüfen jetzt zentral
--     public.auth_is_active().
--
-- HINWEIS NACH DEM AUSFÜHREN: Den ERSTEN Manager einmalig manuell setzen:
--     update public.users set role = 'manager' where key = '<normalisierter-name>';
-- (Der Trigger lässt das aus dem SQL-Editor zu, weil dort auth.uid() NULL ist.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper-Funktionen
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER + festes search_path: laufen mit Owner-Rechten und umgehen
-- damit RLS. Das verhindert die unendliche Rekursion, die entstünde, wenn eine
-- Policy AUF public.users wiederum public.users via RLS abfragt.

create or replace function public.auth_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select u.is_active from public.users u where u.id = auth.uid()), false);
$$;

create or replace function public.auth_is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select u.role = 'manager' and u.is_active from public.users u where u.id = auth.uid()),
    false
  );
$$;

grant execute on function public.auth_is_active() to authenticated, anon;
grant execute on function public.auth_is_manager() to authenticated, anon;

-- ----------------------------------------------------------------------------
-- 1) Privilege-Escalation-Trigger
-- ----------------------------------------------------------------------------
create or replace function public.prevent_user_privilege_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role
      or new.is_active is distinct from old.is_active
      or new.key is distinct from old.key
      or new.id is distinct from old.id)
     and auth.uid() is not null          -- service_role / SQL-Editor darf (Bootstrap)
     and not public.auth_is_manager() then
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

-- ----------------------------------------------------------------------------
-- 2) Policies neu fassen: Zugriff nur für aktive Nutzer
-- ----------------------------------------------------------------------------

-- USERS ---------------------------------------------------------------------
drop policy if exists "users read all" on public.users;
create policy "users read all" on public.users
  for select using (public.auth_is_active());

drop policy if exists "users update own or manager" on public.users;
create policy "users update own or manager" on public.users
  for update using (auth.uid() = id or public.auth_is_manager());
-- (insert-Policy "users insert own" bleibt unverändert — Registrierung)

-- CONTRACTS -----------------------------------------------------------------
drop policy if exists "contracts read all" on public.contracts;
create policy "contracts read all" on public.contracts
  for select using (public.auth_is_active());

drop policy if exists "contracts insert own" on public.contracts;
create policy "contracts insert own" on public.contracts
  for insert with check (public.auth_is_active() and auth.uid() = created_by);

drop policy if exists "contracts update own" on public.contracts;
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

drop policy if exists "contracts delete own" on public.contracts;
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

-- TARIFF CHANGES ------------------------------------------------------------
drop policy if exists "tariff read all" on public.tariff_changes;
create policy "tariff read all" on public.tariff_changes
  for select using (public.auth_is_active());

drop policy if exists "tariff insert own" on public.tariff_changes;
create policy "tariff insert own" on public.tariff_changes
  for insert with check (public.auth_is_active() and auth.uid() = created_by);

drop policy if exists "tariff update own" on public.tariff_changes;
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

drop policy if exists "tariff delete own" on public.tariff_changes;
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

-- NOTES ---------------------------------------------------------------------
drop policy if exists "notes read all" on public.notes;
create policy "notes read all" on public.notes
  for select using (public.auth_is_active());

drop policy if exists "notes insert own" on public.notes;
create policy "notes insert own" on public.notes
  for insert with check (public.auth_is_active() and auth.uid() = created_by);

drop policy if exists "notes update own" on public.notes;
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

drop policy if exists "notes delete own" on public.notes;
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

-- CUSTOMER OWNERSHIPS -------------------------------------------------------
drop policy if exists "ownership read all" on public.customer_ownerships;
create policy "ownership read all" on public.customer_ownerships
  for select using (public.auth_is_active());

drop policy if exists "ownership insert" on public.customer_ownerships;
create policy "ownership insert" on public.customer_ownerships
  for insert with check (public.auth_is_active());

drop policy if exists "ownership update owner" on public.customer_ownerships;
create policy "ownership update owner" on public.customer_ownerships
  for update using (public.auth_is_active() and auth.uid() = owner);

drop policy if exists "ownership delete owner" on public.customer_ownerships;
create policy "ownership delete owner" on public.customer_ownerships
  for delete using (public.auth_is_active() and auth.uid() = owner);

-- USER SETTINGS -------------------------------------------------------------
drop policy if exists "user_settings read own or manager" on public.user_settings;
create policy "user_settings read own or manager" on public.user_settings
  for select using (public.auth_is_active() and (auth.uid() = user_id or public.auth_is_manager()));

drop policy if exists "user_settings insert own or manager" on public.user_settings;
create policy "user_settings insert own or manager" on public.user_settings
  for insert with check (public.auth_is_active() and (auth.uid() = user_id or public.auth_is_manager()));

drop policy if exists "user_settings update own or manager" on public.user_settings;
create policy "user_settings update own or manager" on public.user_settings
  for update using (public.auth_is_active() and (auth.uid() = user_id or public.auth_is_manager()));

-- SHARED SETTINGS -----------------------------------------------------------
drop policy if exists "shared_settings read all" on public.shared_settings;
create policy "shared_settings read all" on public.shared_settings
  for select using (public.auth_is_active());

drop policy if exists "shared_settings upsert all" on public.shared_settings;
create policy "shared_settings upsert all" on public.shared_settings
  for insert with check (public.auth_is_active());

drop policy if exists "shared_settings update all" on public.shared_settings;
create policy "shared_settings update all" on public.shared_settings
  for update using (public.auth_is_active());

-- INCENTIVES ----------------------------------------------------------------
drop policy if exists "incentives read all" on public.incentives;
create policy "incentives read all" on public.incentives
  for select using (public.auth_is_active());

drop policy if exists "incentives insert manager" on public.incentives;
create policy "incentives insert manager" on public.incentives
  for insert with check (public.auth_is_manager());

drop policy if exists "incentives update manager" on public.incentives;
create policy "incentives update manager" on public.incentives
  for update using (public.auth_is_manager());

drop policy if exists "incentives delete manager" on public.incentives;
create policy "incentives delete manager" on public.incentives
  for delete using (public.auth_is_manager());

-- LEADS ---------------------------------------------------------------------
drop policy if exists "leads read all" on public.leads;
create policy "leads read all" on public.leads
  for select using (public.auth_is_active());

drop policy if exists "leads insert all" on public.leads;
create policy "leads insert all" on public.leads
  for insert with check (public.auth_is_active());

drop policy if exists "leads update all" on public.leads;
create policy "leads update all" on public.leads
  for update using (public.auth_is_active());

drop policy if exists "leads delete all" on public.leads;
create policy "leads delete all" on public.leads
  for delete using (public.auth_is_active());

-- LEAD ACTIVITIES -----------------------------------------------------------
drop policy if exists "lead_activities read all" on public.lead_activities;
create policy "lead_activities read all" on public.lead_activities
  for select using (public.auth_is_active());

drop policy if exists "lead_activities insert all" on public.lead_activities;
create policy "lead_activities insert all" on public.lead_activities
  for insert with check (public.auth_is_active());

drop policy if exists "lead_activities delete own" on public.lead_activities;
create policy "lead_activities delete own" on public.lead_activities
  for delete using (public.auth_is_active() and auth.uid() = created_by);

-- AUDIT LOG -----------------------------------------------------------------
drop policy if exists "audit_log read manager only" on public.audit_log;
create policy "audit_log read manager only" on public.audit_log
  for select using (public.auth_is_manager());

drop policy if exists "audit_log insert own actions" on public.audit_log;
create policy "audit_log insert own actions" on public.audit_log
  for insert with check (public.auth_is_active() and actor_id = auth.uid());
