-- Migration 009: Audit-Log für DSGVO-Nachvollziehbarkeit (Art. 5 Abs. 2, Art. 30 DSGVO)
-- Ausführen im Supabase SQL Editor vor dem Deployment.
--
-- Speichert wer (actor) wann welche Aktion auf welche Entität ausgeführt hat.
-- actor_name ist denormalisiert, damit Logs auch nach User-Löschung lesbar
-- bleiben (Beweisbarkeit). Einträge sind unveränderlich — kein update/delete-Recht.

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id) on delete set null,
  actor_name text not null,
  -- Aktionstyp: 'create' | 'update' | 'delete' | 'purge' | 'login' | 'logout'
  --           | 'role_change' | 'lock' | 'unlock' | 'consent' | 'export'
  action text not null,
  -- Entitätstyp: 'contract' | 'tariff_change' | 'note' | 'lead' | 'lead_activity'
  --            | 'customer' | 'user' | 'incentive' | 'auth' | 'settings'
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

alter table public.audit_log enable row level security;

-- Nur Manager dürfen lesen — sensible Aktivitätsdaten.
create policy "audit_log read manager only" on public.audit_log
  for select using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'manager')
  );

-- Jeder authentifizierte Nutzer darf seine eigenen Aktionen loggen.
-- actor_id MUSS mit auth.uid() übereinstimmen — kein Logging unter fremden Namen.
create policy "audit_log insert own actions" on public.audit_log
  for insert with check (auth.role() = 'authenticated' and actor_id = auth.uid());

-- Bewusst keine update/delete-Policy: Logs sind nach Anlage unveränderlich.

alter publication supabase_realtime add table public.audit_log;
