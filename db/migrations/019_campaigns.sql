-- ============================================================================
-- Migration 019 — Kampagnen
-- ============================================================================
-- Fester, vom Chef gepflegter Kampagnen-Katalog (Outbound-Umbau). Jede
-- Kampagne hat einen call_type, der in der Extension automatisch Skript und
-- Einwandkarten bestimmt (siehe callGuides/objectionCards in
-- extension/src/config.js). Deaktivierte Kampagnen bleiben in Historie/
-- Auswertung sichtbar (calls.campaign_id, shifts.campaign_id), stehen aber
-- bei neuen Zuordnungen (Schichtplan) nicht mehr zur Auswahl.
--
-- Im Supabase-Dashboard unter SQL Editor einmal ausführen.
-- ============================================================================

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  call_type text not null check (call_type in ('churn', 'welcome', 'other')),
  active boolean not null default true,
  created_at timestamptz default now(),
  created_by uuid references public.users(id) on delete set null
);

alter table public.campaigns enable row level security;

-- CAMPAIGNS: alle aktiven Nutzer lesen (Extension braucht sie für das
-- Call-Typ-Routing, Agenten sehen sie im Schichtplan). Schreiben/Ändern/
-- Löschen nur Chefs — gleiches Muster wie incentives (Migration 003).
-- drop-if-exists vor jedem create, damit die Migration gefahrlos erneut
-- ausgeführt werden kann (gleiche Konvention wie Migration 011/020).
drop policy if exists "campaigns read all" on public.campaigns;
create policy "campaigns read all" on public.campaigns
  for select using (public.auth_is_active());
drop policy if exists "campaigns insert manager" on public.campaigns;
create policy "campaigns insert manager" on public.campaigns
  for insert with check (public.auth_is_manager());
drop policy if exists "campaigns update manager" on public.campaigns;
create policy "campaigns update manager" on public.campaigns
  for update using (public.auth_is_manager());
drop policy if exists "campaigns delete manager" on public.campaigns;
create policy "campaigns delete manager" on public.campaigns
  for delete using (public.auth_is_manager());

-- Realtime-Publication nur ergänzen, wenn die Tabelle noch nicht Mitglied ist —
-- ein blankes `alter publication ... add table` bricht sonst beim Re-Run ab.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'campaigns'
  ) then
    alter publication supabase_realtime add table public.campaigns;
  end if;
end $$;
