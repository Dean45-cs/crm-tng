-- ============================================================================
-- Migration 030 — Kompetenzen je Kampagne
-- ============================================================================
-- Der Schichtplan teilt Kampagnen zu (Migration 019/020), wusste aber nicht,
-- wem er welche zutrauen darf. Jede der sechs Kampagnen hat eine eigene
-- Schulungsunterlage und einen eigenen Leitfaden — wer für den Dubletten-Check
-- geschult ist, kennt deshalb noch lange nicht den Bauverweigerer-Prozess mit
-- § 156 TKG und dem Schadenersatz-Hinweis. Genau dort richtet ein ungeschultes
-- Gespräch echten Schaden an.
--
-- Eine Zeile je (Person, Kampagnentyp). KEINE Zeile heißt „nicht geschult" —
-- deshalb gibt es bewusst keine Stufe „keine": ein Zustand, der sich sowohl als
-- fehlende Zeile als auch als Wert ausdrücken lässt, wird irgendwann in beiden
-- Formen im Bestand stehen und muss dann überall doppelt geprüft werden.
--
-- Stufen (Katalog in extension/src/campaigns.js, COMPETENCY_LEVELS):
--   einarbeitung   geschult, aber nur mit erfahrener Begleitung in der Schicht
--   einsatzbereit  führt die Kampagne selbstständig
--   trainer        kann andere einarbeiten und zählt als Begleitung
--
-- `guide_version` hält fest, auf WELCHE Fassung des Leitfadens geschult wurde.
-- Die Leitfäden tragen eine Version (aktuell 2.0, Stand August 2026); geht eine
-- Kampagne auf 2.1, ist der Schulungsstand aller Betroffenen sichtbar veraltet,
-- ohne dass jemand eine Liste führen muss.
--
-- Im Supabase-Dashboard unter SQL Editor einmal ausführen (nach 029).
-- ============================================================================

create table if not exists public.agent_competencies (
  user_id      uuid not null references public.users(id) on delete cascade,
  -- Bewusst der Kampagnen-TYP, nicht die einzelne Kampagne: geschult wird auf
  -- den Leitfaden, nicht auf „Kündigerrückgewinnung Q3". Legt der Chef eine
  -- zweite Churn-Kampagne an, gilt die Schulung sofort auch dort.
  call_type    text not null check (call_type in ('churn', 'welcome', 'prl', 'dupe', 'bvw', 'courtesy', 'other')),
  level        text not null check (level in ('einarbeitung', 'einsatzbereit', 'trainer')),
  -- Wann die Schulung stattfand und auf welche Leitfaden-Fassung.
  trained_at   date,
  guide_version text,
  note         text,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.users(id) on delete set null,
  primary key (user_id, call_type)
);

create index if not exists idx_competencies_call_type
  on public.agent_competencies(call_type, level);

alter table public.agent_competencies enable row level security;

-- Lesen für alle aktiven Nutzer: der Schichtplan ist geteilt (Migration 020),
-- und die Warnung „an diesem Tag ist niemand Erfahrenes eingeteilt" lässt sich
-- nur berechnen, wenn man die Kompetenzen der Kolleg:innen sehen darf. Es sind
-- betriebliche Qualifikationen, keine Leistungsbewertung.
-- drop-if-exists vor jedem create, damit die Migration gefahrlos erneut
-- ausgeführt werden kann (gleiche Konvention wie Migration 011/019/020).
drop policy if exists "competencies read all" on public.agent_competencies;
create policy "competencies read all" on public.agent_competencies
  for select using (public.auth_is_active());

-- Schreiben nur Chefs — eine Kompetenz, die man sich selbst erteilen kann,
-- ist keine.
drop policy if exists "competencies insert manager" on public.agent_competencies;
create policy "competencies insert manager" on public.agent_competencies
  for insert with check (public.auth_is_manager());
drop policy if exists "competencies update manager" on public.agent_competencies;
create policy "competencies update manager" on public.agent_competencies
  for update using (public.auth_is_manager());
drop policy if exists "competencies delete manager" on public.agent_competencies;
create policy "competencies delete manager" on public.agent_competencies
  for delete using (public.auth_is_manager());

-- Realtime-Publication nur ergänzen, wenn die Tabelle noch nicht Mitglied ist —
-- ein blankes `alter publication ... add table` bricht sonst beim Re-Run ab.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'agent_competencies'
  ) then
    alter publication supabase_realtime add table public.agent_competencies;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Warum KEIN Constraint auf shifts
-- ----------------------------------------------------------------------------
-- Naheliegend wäre, eine Schicht ohne passende Kompetenz per Trigger zu
-- verbieten. Bewusst nicht: der Plan wird oft unter Zeitdruck gebaut, und ein
-- Krankheitsfall am Morgen zwingt manchmal dazu, jemanden auf eine Kampagne zu
-- setzen, für die er noch nicht ganz fertig geschult ist. Ein hartes Verbot
-- führt dann dazu, dass die Kampagne gar nicht mehr eingetragen wird — und
-- damit sieht die Extension keinen Leitfaden mehr, und die Auswertung keine
-- Kampagne. Die Oberfläche warnt deutlich und benennt den Grund; die
-- Entscheidung bleibt beim Chef und ist im Plan sichtbar.
