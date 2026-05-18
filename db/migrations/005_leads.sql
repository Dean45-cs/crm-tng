-- ============================================================================
-- Migration 005 — Lead-Management
-- ============================================================================
-- Legt die Tabelle `leads` an: selbst angelegte Vertriebs-Leads mit
-- 4-Stufen-Pipeline (neu → inBearbeitung → gewonnen | verloren).
-- Leads sind ein geteiltes Team-Werkzeug: alle authentifizierten Nutzer
-- dürfen lesen, anlegen, ändern und löschen.
--
-- Im Supabase-Dashboard unter SQL Editor einmal ausführen.
-- ============================================================================

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  customer_number text,
  phone text,
  topic text,
  status text not null default 'neu'
    check (status in ('neu', 'inBearbeitung', 'gewonnen', 'verloren')),
  follow_up_date date,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_leads_status on public.leads(status);

alter table public.leads enable row level security;

-- Geteiltes Team-Werkzeug: alle authentifizierten Nutzer dürfen alles.
create policy "leads read all" on public.leads
  for select using (auth.role() = 'authenticated');
create policy "leads insert all" on public.leads
  for insert with check (auth.role() = 'authenticated');
create policy "leads update all" on public.leads
  for update using (auth.role() = 'authenticated');
create policy "leads delete all" on public.leads
  for delete using (auth.role() = 'authenticated');

alter publication supabase_realtime add table public.leads;
