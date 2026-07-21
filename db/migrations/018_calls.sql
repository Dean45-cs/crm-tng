-- ============================================================================
-- Migration 018 — calls (Anruf wird Teil der Akte)
-- ============================================================================
-- Im Supabase-Dashboard unter SQL Editor ausführen (nach 017).
--
-- Grundlage für Stufe 2 aus KONZEPT-INTEGRATION.md ("Der Anruf wird Teil der
-- Akte"). Die Support-Copilot-Extension liest Anrufer, Nummer, Dauer und
-- Gruppe schon heute aus timio (siehe extension/src/timio-content.js) — bisher
-- verfallen die Daten nur, weil sie nirgends landen. Ab jetzt schreibt die
-- Extension jeden Anruf über ihre eigene Supabase-Session (Stufe 1) hierher.
--
-- customer_number bleibt bewusst nullable: nicht jeder Anrufer ist zuzuordnen,
-- und ein Anruf ohne Zuordnung ist immer noch wertvoller als kein Anruf.
--
-- outcome/note/jira_ticket sind für Stufe 3 vorgesehen (gemeinsame Erfassung
-- am Gesprächsende) und werden in dieser Migration nur als Spalten angelegt,
-- aber von niemandem befüllt oder angezeigt.
--
-- Aufbewahrungsfrist/automatische Anonymisierung der Rufnummer ist bewusst
-- NICHT Teil dieser Migration (siehe "Offene Punkte" in
-- KONZEPT-INTEGRATION.md) — mit dem Nutzer abgestimmt, bis die Frist feststeht.
-- ============================================================================

create table if not exists public.calls (
  id                uuid primary key default gen_random_uuid(),
  customer_number   text,                      -- null: unbekannter Anrufer erlaubt
  caller_name       text,
  caller_number     text,
  direction         text not null check (direction in ('inbound', 'outbound')),
  queue_group       text,
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  duration_s        int,
  agent_id          uuid not null references public.users(id) on delete cascade,
  outcome           text,                      -- Stufe 3
  note              text,                      -- Stufe 3
  jira_ticket       text,                      -- Stufe 3
  created_at        timestamptz not null default now()
);
create index if not exists idx_calls_customer on public.calls(customer_number);
create index if not exists idx_calls_agent on public.calls(agent_id);
create index if not exists idx_calls_started on public.calls(started_at desc);
-- Live-Anrufleiste im CRM filtert genau auf "noch nicht beendet".
create index if not exists idx_calls_active on public.calls(started_at) where ended_at is null;

alter table public.calls enable row level security;

-- Lesen für alle aktiven Nutzer (Live-Anrufleiste, Anrufhistorie, Team-KPI —
-- analog zu contracts/customers read-all).
drop policy if exists "calls read all" on public.calls;
create policy "calls read all" on public.calls
  for select using (public.auth_is_active());

-- Anlegen nur als sich selbst: verhindert, dass ein Client Anrufe im Namen
-- anderer Agent:innen einträgt.
drop policy if exists "calls insert own" on public.calls;
create policy "calls insert own" on public.calls
  for insert with check (public.auth_is_active() and auth.uid() = agent_id);

-- Abschließen (ended_at/duration_s setzen) durch die eigene Sitzung oder
-- einen Chef zur Korrektur/Aufräumen.
drop policy if exists "calls update own or manager" on public.calls;
create policy "calls update own or manager" on public.calls
  for update using (public.auth_is_active() and (auth.uid() = agent_id or public.auth_is_manager()));

-- Löschen (u.a. DSGVO-Purge eines Kunden) nur für Chefs.
drop policy if exists "calls delete manager" on public.calls;
create policy "calls delete manager" on public.calls
  for delete using (public.auth_is_manager());

alter publication supabase_realtime add table public.calls;

-- ----------------------------------------------------------------------------
-- customers-Zeile auch aus Anrufen pflegen: touch_customer() (Migration 017)
-- passt nicht direkt, weil calls weder customer_name noch created_by hat
-- (stattdessen caller_name/agent_id) — eigene, sonst identische Funktion.
-- Ohne das bekäme ein Anrufer, der nie einen Vertrag/Tarifwechsel/Notiz/Lead
-- hatte, trotz protokollierter Anrufe keine eigenständige customers-Zeile und
-- CustomerDetail würde "Kunde nicht gefunden" zeigen — genau der Fall, den
-- Stufe 1 ("Der Anrufer bekommt ein Gesicht") eigentlich lösen sollte.
-- Nur AFTER INSERT: customer_number/caller_name ändern sich nicht mehr, wenn
-- die Extension später per endCall() nur noch ended_at/duration_s nachträgt.
-- ----------------------------------------------------------------------------
create or replace function public.touch_customer_from_call()
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
