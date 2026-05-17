-- ============================================================================
-- Migration 002 — Chef-Modus
-- ============================================================================
-- Fügt Rollen (agent/manager) und einen Sperr-Status hinzu und gibt Chefs
-- erweiterte Rechte: alle user_settings lesen/schreiben, fremde Nutzerprofile
-- ändern und beliebige Verträge/Tarifwechsel/Notizen bearbeiten/löschen.
--
-- Im Supabase-Dashboard unter SQL Editor einmal ausführen.
--
-- Danach die Chefs benennen, z.B.:
--   update public.users set role = 'manager'
--   where display_name in ('Name Chef 1', 'Name Chef 2');
-- ============================================================================

-- ---------- Spalten ----------
alter table public.users
  add column if not exists role text default 'agent'
    check (role in ('agent', 'manager'));
alter table public.users
  add column if not exists is_active boolean default true;

-- ---------- user_settings: Chefs lesen/schreiben alle ----------
drop policy if exists "user_settings read own" on public.user_settings;
drop policy if exists "user_settings read own or manager" on public.user_settings;
create policy "user_settings read own or manager" on public.user_settings
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'manager')
  );

drop policy if exists "user_settings insert own" on public.user_settings;
drop policy if exists "user_settings insert own or manager" on public.user_settings;
create policy "user_settings insert own or manager" on public.user_settings
  for insert with check (
    auth.uid() = user_id
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'manager')
  );

drop policy if exists "user_settings update own" on public.user_settings;
drop policy if exists "user_settings update own or manager" on public.user_settings;
create policy "user_settings update own or manager" on public.user_settings
  for update using (
    auth.uid() = user_id
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'manager')
  );

-- ---------- users: Chefs ändern fremde Profile (Rolle, is_active) ----------
drop policy if exists "users update own" on public.users;
drop policy if exists "users update own or manager" on public.users;
create policy "users update own or manager" on public.users
  for update using (
    auth.uid() = id
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'manager')
  );

-- ---------- contracts/tariff/notes: Manager-Ausnahme ----------
drop policy if exists "contracts update own" on public.contracts;
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
drop policy if exists "contracts delete own" on public.contracts;
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

drop policy if exists "tariff update own" on public.tariff_changes;
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
drop policy if exists "tariff delete own" on public.tariff_changes;
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

drop policy if exists "notes update own" on public.notes;
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
drop policy if exists "notes delete own" on public.notes;
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
