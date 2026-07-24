-- ============================================================================
-- Migration 020 — Schichtplan
-- ============================================================================
-- Wochenraster (Früh/Spät/frei) je Agent:in und Tag, optional mit
-- Kampagnen-Zuordnung. Bewusst FÜR ALLE AKTIVEN NUTZER LESBAR (geteilter
-- Plan) — anders als user_status/status_log, wo jede:r nur die eigene Zeile
-- schreibt, ist hier explizit gewünscht, dass alle sehen, wer wann welche
-- Schicht und Kampagne fährt. Schreiben bleibt Chef-Sache, damit der Plan
-- eine verbindliche Einteilung ist und nicht von Agenten verändert wird.
--
-- Die Extension liest hierüber (gejoint mit campaigns) die aktuelle
-- Kampagne des eingeloggten Agenten für das automatische Call-Typ-Routing
-- (fetchCurrentShift() in extension/src/supabase.js).
--
-- Im Supabase-Dashboard unter SQL Editor einmal ausführen.
-- ============================================================================

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

alter table public.shifts enable row level security;

-- SHIFTS: alle aktiven Nutzer lesen den kompletten Plan (geteilte Ansicht,
-- explizite Anforderung — kein user_id = auth.uid()-Filter). Schreiben/
-- Ändern/Löschen nur Chefs.
-- drop-if-exists vor jedem create, damit die Migration gefahrlos erneut
-- ausgeführt werden kann (gleiche Konvention wie Migration 011).
drop policy if exists "shifts read all" on public.shifts;
create policy "shifts read all" on public.shifts
  for select using (public.auth_is_active());
drop policy if exists "shifts insert manager" on public.shifts;
create policy "shifts insert manager" on public.shifts
  for insert with check (public.auth_is_manager());
drop policy if exists "shifts update manager" on public.shifts;
create policy "shifts update manager" on public.shifts
  for update using (public.auth_is_manager());
drop policy if exists "shifts delete manager" on public.shifts;
create policy "shifts delete manager" on public.shifts
  for delete using (public.auth_is_manager());

-- Realtime-Publication nur ergänzen, wenn die Tabelle noch nicht Mitglied ist —
-- ein blankes `alter publication ... add table` bricht sonst beim Re-Run ab.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shifts'
  ) then
    alter publication supabase_realtime add table public.shifts;
  end if;
end $$;
