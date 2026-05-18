-- Migration 006: Lead-Aktivitäten (Kontakt-Log + Team-Chat pro Lead)
-- Ausführen im Supabase SQL Editor vor dem Deployment.

create table if not exists public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  type text not null check (type in ('contact', 'note')),
  content text,                                   -- null bei type='contact', sonst Notiztext
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now()
);

alter table public.lead_activities enable row level security;

-- Alle angemeldeten Nutzer sehen alle Aktivitäten (geteiltes Team-Werkzeug)
create policy "lead_activities read all" on public.lead_activities
  for select using (auth.role() = 'authenticated');

create policy "lead_activities insert all" on public.lead_activities
  for insert with check (auth.role() = 'authenticated');

-- Nur der Ersteller darf löschen
create policy "lead_activities delete own" on public.lead_activities
  for delete using (auth.uid() = created_by);

alter publication supabase_realtime add table public.lead_activities;
