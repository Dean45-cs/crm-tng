-- ============================================================================
-- Migration 014 — Status-Board (Team-Presence & Zeitverteilung)
-- ============================================================================
-- Zwei Tabellen:
--   • user_status  — der AKTUELLE Status je Nutzer:in (genau eine Zeile).
--                    Alle aktiven Nutzer:innen lesen ihn (Team-Ansicht),
--                    ändern darf nur die eigene Zeile.
--   • status_log   — LÜCKENLOSE Historie: jeder abgeschlossene Status-Abschnitt
--                    wird mit Start/Ende/Dauer archiviert. Grundlage für die
--                    Chef-KPIs und den PowerBI-Export. Append-only; nur die/der
--                    Betroffene und Chef:innen lesen, Chef:innen dürfen aufräumen.
--
-- Im Supabase-Dashboard unter SQL Editor einmal ausführen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Aktueller Status je Nutzer:in
-- ----------------------------------------------------------------------------
create table if not exists public.user_status (
  user_id uuid primary key references public.users(id) on delete cascade,
  status text,                       -- Status-ID, null = kein Status gesetzt
  sub text,                          -- Ticketschicht-Untertyp (Leads, TL, …)
  description text,                  -- Freitext bei Status mit Beschreibung
  is_afk boolean not null default false,
  started_at timestamptz,            -- Beginn des aktuellen Status
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Historie abgeschlossener Status-Abschnitte
-- ----------------------------------------------------------------------------
create table if not exists public.status_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  status text not null,
  sub text,
  description text,
  is_afk boolean not null default false,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_seconds integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_status_log_user on public.status_log(user_id);
create index if not exists idx_status_log_started on public.status_log(started_at desc);

alter table public.user_status enable row level security;
alter table public.status_log enable row level security;

-- USER_STATUS: alle aktiven Nutzer:innen sehen den Live-Status aller Kolleg:innen;
-- schreiben/ändern/löschen darf jede:r nur die eigene Zeile.
create policy "user_status read all" on public.user_status
  for select using (public.auth_is_active());
create policy "user_status insert own" on public.user_status
  for insert with check (public.auth_is_active() and user_id = auth.uid());
create policy "user_status update own" on public.user_status
  for update using (public.auth_is_active() and user_id = auth.uid());
create policy "user_status delete own" on public.user_status
  for delete using (public.auth_is_active() and user_id = auth.uid());

-- STATUS_LOG: eigene Historie + Chef:innen lesen; anlegen nur für sich selbst;
-- Chef:innen dürfen die Historie aufräumen (Aufbewahrung/Datensparsamkeit).
create policy "status_log read own or manager" on public.status_log
  for select using (public.auth_is_active() and (user_id = auth.uid() or public.auth_is_manager()));
create policy "status_log insert own" on public.status_log
  for insert with check (public.auth_is_active() and user_id = auth.uid());
create policy "status_log delete manager" on public.status_log
  for delete using (public.auth_is_manager());

alter publication supabase_realtime add table public.user_status;
alter publication supabase_realtime add table public.status_log;
