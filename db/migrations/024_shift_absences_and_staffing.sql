-- ============================================================================
-- Migration 024 — Abwesenheitsarten & Soll-Besetzung im Schichtplan
-- ============================================================================
-- Zwei Ergänzungen zum Schichtplan aus Migration 020:
--
--   1. `shifts.shift_type` kennt jetzt neben 'frueh'/'spaet'/'frei' auch
--      'urlaub', 'krank' und 'schulung'. Bisher war jede Nicht-Arbeit ein
--      pauschales „frei" — für die Planung ist der Unterschied aber genau der
--      Punkt: freie Tage sind eingeplant, Krankheit ist ein Ausfall, Urlaub ist
--      langfristig bekannt und Schulung ist Anwesenheit ohne Telefonie. Wer nur
--      „frei" kennt, sieht in der Besetzung nicht, ob ein Tag geplant dünn ist
--      oder überraschend.
--
--      Alle drei zählen wie 'frei' NICHT als Arbeitstag — die bestehende
--      Auswertung (Σ Arbeitstage, Besetzung) unterscheidet weiterhin nur
--      „arbeitet / arbeitet nicht" und bleibt damit unverändert korrekt.
--      Anwendungsseitig liegt die Zuordnung in src/lib/shifts.ts (isWorking).
--
--   2. `staffing_targets` — die Soll-Besetzung je Wochentag. Ohne sie ist die
--      Besetzungszeile eine nackte Zahl, die niemand einordnen kann: „2 Früh"
--      ist an einem Montag zu wenig und an einem Samstag reichlich. Erst der
--      Sollwert macht daraus eine Aussage (gedeckt / unterbesetzt).
--
--      Bewusst je Wochentag und nicht je Datum: der Bedarf folgt dem
--      Wochenrhythmus, nicht dem Kalender. Ausnahmen an einzelnen Tagen regelt
--      der Chef weiterhin über den Plan selbst.
--
-- Im Supabase-Dashboard unter SQL Editor einmal ausführen (idempotent).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Abwesenheitsarten
-- ----------------------------------------------------------------------------
-- Der Check heißt seit Migration 020 `shifts_shift_type_check` (von Postgres
-- vergeben). Erst weg, dann neu — ein `alter ... add constraint` allein würde
-- beim zweiten Lauf am schon vorhandenen Namen scheitern.
alter table public.shifts drop constraint if exists shifts_shift_type_check;
alter table public.shifts add constraint shifts_shift_type_check
  check (shift_type in ('frueh', 'spaet', 'frei', 'urlaub', 'krank', 'schulung'));

-- `shift_swap_requests.requester_shift_type` / `.partner_shift_type` brauchen
-- hier nichts: Migration 023 hat sie bewusst als freien Text ohne Check
-- angelegt (reine Anzeige, siehe dortiger Kopfkommentar). Sie nehmen die neuen
-- Arten also von sich aus an.

-- ----------------------------------------------------------------------------
-- 2. Soll-Besetzung je Wochentag
-- ----------------------------------------------------------------------------
-- weekday folgt der ISO-Zählung 1 = Montag … 7 = Sonntag (nicht Postgres'
-- `extract(dow)` mit 0 = Sonntag): der Plan beginnt am Montag, und die
-- Anwendung rechnet durchgehend so.
create table if not exists public.staffing_targets (
  weekday    smallint primary key check (weekday between 1 and 7),
  min_frueh  smallint not null default 0 check (min_frueh >= 0),
  min_spaet  smallint not null default 0 check (min_spaet >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

-- Startwerte: Mo–Fr je zwei Früh und zwei Spät, Wochenende ohne Soll. Damit
-- steht sofort eine sinnvolle Vorgabe da, statt einer Tabelle voller Nullen,
-- die alles als „gedeckt" ausweisen würde. `on conflict do nothing` lässt eine
-- bereits gepflegte Vorgabe beim Re-Run unangetastet.
insert into public.staffing_targets (weekday, min_frueh, min_spaet) values
  (1, 2, 2), (2, 2, 2), (3, 2, 2), (4, 2, 2), (5, 2, 2), (6, 0, 0), (7, 0, 0)
on conflict (weekday) do nothing;

alter table public.staffing_targets enable row level security;

-- STAFFING_TARGETS: alle aktiven Nutzer lesen (die Besetzungsanzeige im
-- geteilten Plan braucht den Sollwert, sonst sähe nur der Chef, ob ein Tag
-- gedeckt ist). Pflegen nur Chefs — gleiches Muster wie shifts/campaigns.
drop policy if exists "staffing read all" on public.staffing_targets;
create policy "staffing read all" on public.staffing_targets
  for select using (public.auth_is_active());
drop policy if exists "staffing insert manager" on public.staffing_targets;
create policy "staffing insert manager" on public.staffing_targets
  for insert with check (public.auth_is_manager());
drop policy if exists "staffing update manager" on public.staffing_targets;
create policy "staffing update manager" on public.staffing_targets
  for update using (public.auth_is_manager());
drop policy if exists "staffing delete manager" on public.staffing_targets;
create policy "staffing delete manager" on public.staffing_targets
  for delete using (public.auth_is_manager());

-- Realtime-Publication nur ergänzen, wenn die Tabelle noch nicht Mitglied ist —
-- ein blankes `alter publication ... add table` bricht sonst beim Re-Run ab.
-- (gleiche Konvention wie Migration 019/020)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'staffing_targets'
  ) then
    alter publication supabase_realtime add table public.staffing_targets;
  end if;
end $$;
