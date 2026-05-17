-- ============================================================================
-- Migration 003 — Incentive-System
-- ============================================================================
-- Legt die Tabelle `incentives` an: zeitlich begrenzte Team-Ziele mit
-- Belohnung, die ein Chef konfiguriert. Mechanik je Incentive:
--   'goal'        — Zielprämie: wer das Ziel erreicht, bekommt die Belohnung
--   'competition' — Wettbewerb: nur Platz 1 gewinnt
-- Fortschritt wird live aus contracts/tariff_changes berechnet (kein Verlauf).
--
-- Im Supabase-Dashboard unter SQL Editor einmal ausführen.
-- ============================================================================

create table if not exists public.incentives (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  mechanic text not null check (mechanic in ('goal', 'competition')),
  metric text not null check (metric in ('commission', 'contracts', 'deals')),
  period text not null check (period in ('weekly', 'monthly')),
  target numeric not null default 0,        -- nur bei mechanic='goal' relevant
  reward text not null default '',
  active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.incentives enable row level security;

-- Lesen: alle authentifizierten Nutzer (Agenten sehen laufende Incentives).
-- Schreiben/Ändern/Löschen: nur Chefs (role = 'manager').
create policy "incentives read all" on public.incentives
  for select using (auth.role() = 'authenticated');
create policy "incentives insert manager" on public.incentives
  for insert with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'manager'));
create policy "incentives update manager" on public.incentives
  for update using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'manager'));
create policy "incentives delete manager" on public.incentives
  for delete using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'manager'));

alter publication supabase_realtime add table public.incentives;
