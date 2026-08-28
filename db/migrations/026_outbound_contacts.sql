-- ============================================================================
-- Migration 026 — Anruflisten je Kampagne (Outbound-Abarbeitung)
-- ============================================================================
-- Bisher sagt eine Kampagne nur, WELCHE Art Gespräch geführt wird (call_type
-- steuert Skript und Einwandkarten in der Extension, Migration 019/025) und
-- WER sie fährt (Schichtplan, Migration 020). Was fehlt, ist WEN man anruft:
-- die Liste, die als Excel-/CSV-Datei vom Chef kommt.
--
-- Diese Migration ergänzt genau das und baut dabei bewusst KEINE zweite
-- Kampagnen- oder Anruf-Welt auf:
--   1. campaigns bekommt die Felder, die eine abzuarbeitende Liste braucht
--      (Prämien, Zeitraum, Zielprodukt, Versuchsgrenze).
--   2. outbound_contacts ist neu — die importierte Liste selbst.
--   3. calls.disposition wird um die Outbound-Ergebnisse erweitert, damit die
--      Gespräche in derselben Tabelle landen wie die der Extension und in
--      callStats/Team-Dashboard/Reports automatisch mitzählen.
--
-- Im Supabase-Dashboard unter SQL Editor einmal ausführen (nach 025).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (1) Kampagne: Prämien, Zeitraum, Zielprodukt, Versuchsgrenze
-- ----------------------------------------------------------------------------
-- Der Katalog aus Migration 019 bleibt unverändert bestehen; `active` und
-- `call_type` behalten ihre Bedeutung. Alles hier ist additiv und hat
-- Defaults, damit vorhandene Kampagnen gültig bleiben.
alter table public.campaigns
  -- Neue Kampagnen-Provisionen, zusätzlich zur normalen Vertragsprovision.
  add column if not exists bonus_termin numeric not null default 0
    check (bonus_termin >= 0),
  add column if not exists bonus_abschluss numeric not null default 0
    check (bonus_abschluss >= 0),
  -- Nach so vielen erfolglosen Versuchen fällt ein Kontakt aus der Liste.
  add column if not exists max_attempts integer not null default 3
    check (max_attempts between 1 and 20),
  add column if not exists start_date date,
  add column if not exists end_date date,
  -- Zielprodukt als Freitext, damit neue Produkte keine Migration brauchen.
  add column if not exists target_product text;

-- ----------------------------------------------------------------------------
-- (2) Die Anrufliste
-- ----------------------------------------------------------------------------
create table if not exists public.outbound_contacts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  customer_name text not null,
  -- Nullable: eine gekaufte oder frisch erhobene Liste hat oft keine KdNr.
  customer_number text,
  phone text,
  email text,
  street text,
  zip text,
  city text,
  -- Freitext aus der Importdatei (z.B. aktueller Tarif, Vertragsende).
  info text,
  status text not null default 'offen'
    check (status in (
      'offen',           -- noch nicht angefasst
      'wiedervorlage',   -- Rückruf vereinbart / erneut versuchen
      'nichtErreicht',   -- Versuch ohne Kontakt
      'termin',          -- Termin vereinbart
      'abschluss',       -- verkauft
      'keinInteresse',   -- Absage
      'falscheDaten',    -- Nummer/Adresse unbrauchbar
      'sperren'          -- Werbewiderspruch — nie wieder anrufen (DSGVO Art. 21)
    )),
  attempts integer not null default 0 check (attempts >= 0),
  follow_up_date date,
  -- Uhrzeit der Wiedervorlage bzw. des Termins als HH:MM (optional).
  follow_up_time text,
  -- Zuständige:r Agent:in. NULL = freier Pool, den sich jede:r ziehen kann.
  assigned_to uuid references public.users(id) on delete set null,
  notes text,
  last_call_at timestamptz,
  -- Wer hat das aktuelle Ergebnis gesetzt (Grundlage der Prämien-Zuordnung)?
  result_by uuid references public.users(id) on delete set null,
  result_at timestamptz,
  -- Normalisierter Schlüssel (Telefon, sonst KdNr., sonst Name+PLZ) für
  -- idempotente Re-Importe derselben Liste.
  dedupe_key text not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_ob_contacts_campaign on public.outbound_contacts(campaign_id);
create index if not exists idx_ob_contacts_status on public.outbound_contacts(campaign_id, status);
create index if not exists idx_ob_contacts_assigned on public.outbound_contacts(assigned_to);
create index if not exists idx_ob_contacts_followup on public.outbound_contacts(follow_up_date);
create index if not exists idx_ob_contacts_customer on public.outbound_contacts(customer_number);
-- Verhindert Dubletten innerhalb einer Kampagne und macht Re-Importe idempotent.
create unique index if not exists uniq_ob_contact_dedupe
  on public.outbound_contacts (campaign_id, dedupe_key);

alter table public.outbound_contacts enable row level security;

-- Geteiltes Team-Werkzeug wie leads: alle aktiven Nutzer lesen und bearbeiten.
-- Löschen bleibt bei den Chefs, damit keine importierte Liste versehentlich
-- geleert wird. drop-if-exists vor jedem create — gleiche Konvention wie 019.
drop policy if exists "ob_contacts read active" on public.outbound_contacts;
create policy "ob_contacts read active" on public.outbound_contacts
  for select using (public.auth_is_active());
drop policy if exists "ob_contacts insert active" on public.outbound_contacts;
create policy "ob_contacts insert active" on public.outbound_contacts
  for insert with check (public.auth_is_active());
drop policy if exists "ob_contacts update active" on public.outbound_contacts;
create policy "ob_contacts update active" on public.outbound_contacts
  for update using (public.auth_is_active());
drop policy if exists "ob_contacts delete manager" on public.outbound_contacts;
create policy "ob_contacts delete manager" on public.outbound_contacts
  for delete using (public.auth_is_manager());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'outbound_contacts'
  ) then
    alter publication supabase_realtime add table public.outbound_contacts;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- (3) Outbound-Ergebnisse in calls zulassen
-- ----------------------------------------------------------------------------
-- Ein abgearbeiteter Kontakt schreibt seinen Gesprächsausgang in dieselbe
-- calls-Tabelle wie die Extension (direction='outbound', campaign_id gesetzt).
-- Damit zählt Outbound in callVolumeStats, dispositionBreakdown und den
-- Reports automatisch mit, statt in einem zweiten Silo zu liegen.
--
-- Die vorhandenen Werte bleiben erhalten und behalten ihre Bedeutung:
--   'rueckruf'       deckt die Wiedervorlage mit ab
--   'kein-interesse' deckt die Absage mit ab
-- Neu kommen die Ausgänge dazu, die es bei reinem Churn-Inbound nicht gab.
-- Eine CHECK-Erweiterung ist rein additiv: bestehende Zeilen bleiben gültig.
alter table public.calls drop constraint if exists calls_disposition_check;
alter table public.calls
  add constraint calls_disposition_check check (
    disposition in (
      -- bestehend (Migration 021)
      'gehalten', 'gekuendigt', 'rueckruf', 'kein-interesse', 'sonstige',
      -- neu für Outbound-Listen (Migration 026)
      'termin', 'abschluss', 'nicht-erreicht', 'falsche-daten', 'sperren'
    )
  );

-- Verknüpft den Anruf mit der Zeile der Anrufliste, damit ein Kontakt seine
-- Gesprächshistorie behält. Nullable: Anrufe der Extension haben keine.
alter table public.calls
  add column if not exists outbound_contact_id uuid
    references public.outbound_contacts(id) on delete set null;

create index if not exists idx_calls_outbound_contact
  on public.calls(outbound_contact_id);
