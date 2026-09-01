-- ============================================================================
-- Migration 029 — Gesprächserfassung nach Leitfaden v2.0
-- ============================================================================
-- Bisher konnte ein Anruf nur eine grobe `disposition` tragen (Migration 021):
-- gehalten / gekündigt / Rückruf / kein Interesse. Das ist die Churn-Sicht und
-- passt auf keine der anderen fünf Kampagnen. Die Gesprächsleitfäden v2.0
-- (Stand August 2026) verlangen je Kampagne einen eigenen Abschluss-Check und
-- markieren mehrere Punkte ausdrücklich als vergütungsrelevant:
--
--   HomeID           Welcome + Courtesy: „zwingend erforderlich und
--                    vergütungsrelevant", nach erfolgreichem Winback ebenso.
--   Winbackstatus    „erfolgreich"/„nicht erfolgreich" NUR MIT URSACHE — ohne
--                    sie bleibt der Fall auf „offen" und ist weder abrechenbar
--                    noch auswertbar. Das steht hier als Check-Constraint,
--                    nicht nur als Hinweis in der Oberfläche.
--   Double-Opt-In    „Versand über das CRM auslösen", wirksam erst mit
--                    Bestätigung des Kunden (§ 7 Abs. 2 UWG), Nachweis fünf
--                    Jahre aufzubewahren (§ 7a UWG).
--   Fraud-Verdacht   Beobachtungen wertfrei dokumentieren und dem aufnehmenden
--                    Vertriebspartner zuordnen — erst das Muster ist belastbar.
--   Beratungsnote    Welcome Call, Schulnote 1–6.
--
-- `disposition` aus Migration 021 bleibt unverändert und behält ihre Bedeutung:
-- sie ist der kampagnenübergreifende Roll-up für Save-Rate und Vergleich. Die
-- kampagnenspezifischen Ergebnisse stehen zusätzlich in `outcome_code`.
--
-- Der frei geformte Rest je Kampagne (Gebäudedetails beim Dubletten-Check,
-- Adressursache beim Postrückläufer, Ausbaubedingung beim Bauverweigerer)
-- landet in `campaign_data` als jsonb. Bewusst NICHT als je 20 eigene Spalten:
-- die Felder unterscheiden sich je Kampagne vollständig, und eine Tabelle mit
-- 60 überwiegend leeren Spalten wäre weder lesbar noch wartbar. Was
-- kampagnenübergreifend ausgewertet wird, steht dagegen als echte Spalte da.
--
-- Der Katalog der Werte (Ergebnisse, Ursachen, Pflichtfelder) lebt in
-- extension/src/campaigns.js — eine Quelle für CRM und Extension. Deshalb
-- stehen hier absichtlich keine Check-Constraints auf outcome_code oder auf die
-- Ursachen-Ids: eine neue Ursache im Katalog soll keine Migration brauchen.
-- Constraints gibt es nur dort, wo eine Regel den Datenbestand schützt und
-- nicht bloß eine Liste abbildet.
--
-- Im Supabase-Dashboard unter SQL Editor einmal ausführen (nach 028).
-- ============================================================================

alter table public.calls
  -- Kampagnenspezifisches Ergebnis, z.B. 'adresse-korrigiert' (PRL) oder
  -- 'ausbau-ermoeglicht' (BVW). Ids aus campaigns.js.
  add column if not exists outcome_code text,

  -- --- Winback ------------------------------------------------------------
  add column if not exists winback_status text
    check (winback_status in ('offen', 'erfolgreich', 'nicht_erfolgreich', 'irrelevant')),
  -- Ursache des Winback-Ergebnisses. Id aus dem Katalog der Kampagne
  -- (Kündigungsgrund, Kaufreue-Auslöser, Verweigerungstypologie …).
  add column if not exists winback_reason text,
  -- Eingesetzte Stufe des Winback-Baukastens (klarheit/passung/kompensation/zeit).
  add column if not exists winback_measure text,

  -- --- HomeID -------------------------------------------------------------
  add column if not exists home_id text,
  add column if not exists home_id_kind text
    check (home_id_kind in ('homeid', 'ont', 'ad', 'genexis')),
  -- Wurde die Nummer dem Kunden wiederholt und von ihm bestätigt? 0/O und 1/I
  -- sind laut Leitfaden die häufigsten Verwechslungen — eine nicht
  -- rückbestätigte Nummer ist deshalb etwas anderes als eine bestätigte.
  add column if not exists home_id_confirmed boolean not null default false,

  -- --- Double-Opt-In (Permission) -----------------------------------------
  add column if not exists doi_status text
    check (doi_status in ('offen', 'angekuendigt', 'versendet', 'bestaetigt', 'abgelehnt')),
  -- Kontaktarten werden laut Leitfaden getrennt erfasst: email/telefon/mobil.
  add column if not exists doi_channels text[],
  add column if not exists doi_sent_at timestamptz,
  add column if not exists doi_confirmed_at timestamptz,

  -- --- Fraud-Verdacht ------------------------------------------------------
  add column if not exists fraud_suspicion boolean not null default false,
  -- Ids der beobachteten Merkmale (campaigns.js FRAUD_MARKERS).
  add column if not exists fraud_markers text[],
  -- Wertfreie Beobachtung. Der Verdacht wird nie im Gespräch benannt, und im
  -- Freitext steht keine Bewertung — der Kunde hat ein Auskunftsrecht nach
  -- Art. 15 DSGVO.
  add column if not exists fraud_note text,
  -- Aufnehmender Mitarbeiter bzw. Vertriebspartner. Der Einzelfall ist selten
  -- eindeutig, das Muster ist es: ohne diese Zuordnung bleibt jede Beobachtung
  -- ein Einzelfall und wird nie zum Frühwarnsignal.
  add column if not exists sales_partner text,

  -- --- Beratungsqualität (Welcome Call) ------------------------------------
  add column if not exists advice_score smallint
    check (advice_score between 1 and 6),
  add column if not exists advice_protocol boolean,

  -- --- Rest je Kampagne ----------------------------------------------------
  add column if not exists campaign_data jsonb not null default '{}'::jsonb,

  -- Ist der Abschluss-Check der Kampagne vollständig? Von der erfassenden
  -- Oberfläche gesetzt (campaigns.js isBillable). Als gespeicherte Spalte statt
  -- als Berechnung beim Lesen, weil sich der Katalog ändern kann: was zum
  -- Zeitpunkt der Erfassung vollständig war, bleibt vollständig.
  add column if not exists wrapup_complete boolean not null default false,
  add column if not exists wrapup_at timestamptz;

-- „Winbackstatus nur mit Ursache" — die eine Regel, die aus dem Leitfaden
-- direkt in die Datenbank gehört. 'irrelevant' und 'offen' brauchen keine
-- Ursache, die beiden abrechenbaren Zustände schon.
alter table public.calls drop constraint if exists calls_winback_reason_required;
alter table public.calls
  add constraint calls_winback_reason_required check (
    winback_status is null
    or winback_status in ('offen', 'irrelevant')
    or (winback_reason is not null and btrim(winback_reason) <> '')
  );

-- Eine bestätigte Einwilligung ohne Zeitpunkt wäre als Nachweis wertlos
-- (§ 7a UWG: fünf Jahre aufbewahren, also muss der Beginn feststehen).
alter table public.calls drop constraint if exists calls_doi_confirmed_needs_time;
alter table public.calls
  add constraint calls_doi_confirmed_needs_time check (
    doi_status is distinct from 'bestaetigt' or doi_confirmed_at is not null
  );

-- Eine HomeID ohne Art ließe offen, ob sie Vorrang hat (HomeID vor ONT vor AD)
-- — und genau diese Rangfolge ist der Punkt der Erhebung.
alter table public.calls drop constraint if exists calls_home_id_needs_kind;
alter table public.calls
  add constraint calls_home_id_needs_kind check (
    home_id is null or btrim(home_id) = '' or home_id_kind is not null
  );

-- ----------------------------------------------------------------------------
-- Indizes
-- ----------------------------------------------------------------------------
-- Die Churnliste filtert auf offene Winbacks, die Nachbearbeitung auf
-- Fraud-Verdacht, die Vergütungsauswertung auf unvollständige Erfassungen.
-- Alle drei sind kleine Teilmengen — deshalb partielle Indizes.
create index if not exists idx_calls_winback
  on public.calls(winback_status, started_at desc)
  where winback_status is not null;

create index if not exists idx_calls_fraud
  on public.calls(started_at desc)
  where fraud_suspicion;

create index if not exists idx_calls_wrapup_open
  on public.calls(agent_id, started_at desc)
  where not wrapup_complete and disposition is not null;

create index if not exists idx_calls_home_id
  on public.calls(home_id)
  where home_id is not null;

create index if not exists idx_calls_outcome_code
  on public.calls(outcome_code)
  where outcome_code is not null;

-- Fraud-Muster je Vertriebspartner: die Auswertung fragt „wie viele Verdachts-
-- fälle hängen an diesem Partner", nicht „welcher Partner steht auf Zeile X".
create index if not exists idx_calls_sales_partner
  on public.calls(sales_partner)
  where sales_partner is not null;

-- ----------------------------------------------------------------------------
-- Kundenweite Sicht auf HomeID und Einwilligung
-- ----------------------------------------------------------------------------
-- Die Werte werden im Gespräch erhoben, gehören aber zum Kunden, nicht zum
-- einzelnen Anruf: die Kundenakte soll ohne Durchsuchen der Anrufhistorie
-- zeigen, ob eine HomeID vorliegt und ob werblich angesprochen werden darf.
-- Deshalb ein Trigger, der den jeweils letzten belastbaren Stand nachführt,
-- statt die Frage bei jedem Aufruf über alle Anrufe zu rechnen.
alter table public.customers
  add column if not exists home_id text,
  add column if not exists home_id_kind text
    check (home_id_kind in ('homeid', 'ont', 'ad', 'genexis')),
  add column if not exists home_id_at timestamptz,
  add column if not exists doi_status text
    check (doi_status in ('offen', 'angekuendigt', 'versendet', 'bestaetigt', 'abgelehnt')),
  add column if not exists doi_confirmed_at timestamptz,
  add column if not exists fraud_flagged boolean not null default false;

create or replace function public.apply_call_wrapup_to_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_rank int;
  old_rank int;
begin
  if new.customer_number is null or new.customer_number = '' then
    return new;
  end if;

  -- HomeID: nur übernehmen, wenn sie bestätigt ist UND mindestens so
  -- belastbar wie die bereits hinterlegte. Die Rangfolge stammt aus dem
  -- Leitfaden (HomeID vor ONT vor AD vor Genexis); eine später erhobene
  -- AD-Nummer darf eine bereits bekannte HomeID nicht überschreiben.
  if new.home_id is not null and btrim(new.home_id) <> '' and new.home_id_confirmed then
    new_rank := case new.home_id_kind
      when 'homeid' then 1 when 'ont' then 2 when 'ad' then 3 when 'genexis' then 4 else 9 end;
    select case c.home_id_kind
      when 'homeid' then 1 when 'ont' then 2 when 'ad' then 3 when 'genexis' then 4 else 9 end
      into old_rank
      from public.customers c
      where c.customer_number = new.customer_number;

    if old_rank is null or new_rank <= old_rank then
      update public.customers
         set home_id = new.home_id,
             home_id_kind = new.home_id_kind,
             home_id_at = coalesce(new.wrapup_at, now())
       where customer_number = new.customer_number;
    end if;
  end if;

  -- Einwilligung: der jeweils neueste Stand gewinnt, weil ein Widerruf einer
  -- früheren Bestätigung folgen können muss.
  if new.doi_status is not null then
    update public.customers
       set doi_status = new.doi_status,
           doi_confirmed_at = coalesce(new.doi_confirmed_at, public.customers.doi_confirmed_at)
     where customer_number = new.customer_number;
  end if;

  -- Fraud-Markierung wird nur gesetzt, nie durch einen späteren unauffälligen
  -- Anruf zurückgenommen: die Prüfung ist Sache der Nachbearbeitung.
  if new.fraud_suspicion then
    update public.customers
       set fraud_flagged = true
     where customer_number = new.customer_number;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_call_wrapup_customer on public.calls;
create trigger trg_call_wrapup_customer
  after insert or update of home_id, doi_status, fraud_suspicion on public.calls
  for each row execute function public.apply_call_wrapup_to_customer();

-- Bestehende RLS-Policies auf calls und customers (Migration 017/018) gelten
-- automatisch für die neuen Spalten — keine Policy-Änderung nötig.
