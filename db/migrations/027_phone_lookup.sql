-- ============================================================================
-- Migration 027 — Kunde zur Rufnummer finden
-- ============================================================================
-- Im Supabase-Dashboard unter SQL Editor ausführen (nach 026).
--
-- Hintergrund: Anrufe aus der Telefonanlage (myApps/innovaphone) bringen den
-- Kunden meistens schon mit — kennt die Anlage die Rufnummer, steht im
-- Displaynamen "PK 182962 Daniel Ratcliffe", also Kundenart, Kundennummer und
-- Name. Das ist der Hauptweg, und er braucht keine Datenbank.
--
-- Diese Migration ist für den anderen Fall: die Anlage kennt den Anrufer
-- nicht. Dann bleibt nur die Rufnummer, und die Frage lautet, ob WIR sie
-- kennen — aus dem Kundenstamm, aus einem Lead oder aus einem früheren
-- Gespräch.
--
-- Zwei Dinge entstehen dafür:
--   1. phone_key() — dieselbe Rufnummer, immer gleich geschrieben.
--   2. customer_by_phone() — die Suche darüber, mit Trefferliste statt
--      Ratespiel.
--
-- Dazu wird customers.phone endlich befüllt. Die Spalte gibt es seit
-- Migration 017, geschrieben hat sie bisher niemand — die Suche hätte also im
-- Kundenstamm nie etwas gefunden.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- phone_key() — Vergleichsform einer Rufnummer
--
-- "+49 7031 000000", "0049 7031 000000" und "07031 000 000" sind dieselbe
-- Nummer; man sieht es ihnen nur nicht an. Übrig bleibt die Nummer ohne
-- Landesvorwahl und ohne die führende Null.
--
-- Bewusst NICHT auf die letzten Stellen gekürzt: das fasste 07031 000000 und
-- 08031 000000 zu demselben Schlüssel zusammen — zwei verschiedene Anschlüsse,
-- ein Treffer, und im Gespräch stünde die Akte des falschen Kunden auf dem
-- Schirm. Lieber ein Treffer weniger.
--
-- Die Landesvorwahl fällt nur, wenn die Nummer erkennbar international
-- geschrieben ist (+ oder 00 davor). Sonst verlöre "0491 12345" (Leer) seine
-- Vorwahl, weil sie zufällig mit 49 beginnt.
--
-- IMMUTABLE, weil darauf Ausdrucks-Indizes liegen. Dieselbe Regel steht als
-- shared.phoneKey() in extension/src/shared.js — wer sie hier ändert, ändert
-- sie dort mit, sonst findet die Suche nichts mehr.
-- ----------------------------------------------------------------------------
create or replace function public.phone_key(p_phone text)
returns text
language sql
immutable
as $$
  with raw as (
    select
      btrim(coalesce(p_phone, '')) as text_value,
      regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as digits
  ),
  flagged as (
    select
      digits,
      (text_value like '+%' or digits like '00%') as international
    from raw
  ),
  trimmed as (
    select
      case when digits like '00%' then substr(digits, 3) else digits end as digits,
      international
    from flagged
  )
  select case
    when digits = '' then ''
    when international and digits like '49%' then substr(digits, 3)
    when not international and digits like '0%' then substr(digits, 2)
    else digits
  end
  from trimmed;
$$;

comment on function public.phone_key(text) is
  'Vergleichsform einer Rufnummer: ohne Landesvorwahl, ohne führende Null, nur Ziffern. Gegenstück zu shared.phoneKey() in der Extension.';

-- ----------------------------------------------------------------------------
-- Indizes. Partiell, weil die allermeisten Zeilen keine Rufnummer haben und
-- ein Index über lauter Leerstrings nichts beschleunigt.
-- ----------------------------------------------------------------------------
create index if not exists idx_customers_phone_key
  on public.customers (public.phone_key(phone))
  where phone is not null and phone <> '';

create index if not exists idx_leads_phone_key
  on public.leads (public.phone_key(phone))
  where phone is not null and phone <> '';

create index if not exists idx_calls_caller_phone_key
  on public.calls (public.phone_key(caller_number))
  where caller_number is not null and caller_number <> '';

-- ----------------------------------------------------------------------------
-- customers.phone befüllen
--
-- touch_customer() (Migration 017) pflegt Name und Zeitstempel, aber keine
-- Rufnummer — die vier Quelltabellen haben zum größten Teil auch keine. Zwei
-- haben eine: leads.phone und calls.caller_number. Deshalb ein eigener
-- Trigger statt einer Erweiterung von touch_customer(): der läuft auch auf
-- contracts und notes, und ein Zugriff auf new.phone würde dort zur Laufzeit
-- scheitern, weil es die Spalte nicht gibt.
--
-- Nur ergänzend: eine schon eingetragene Rufnummer wird nicht überschrieben.
-- Sie stammt dann aus einer bewussteren Quelle als einem Anrufversuch.
-- ----------------------------------------------------------------------------
create or replace function public.touch_customer_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
begin
  if new.customer_number is null or new.customer_number = '' then
    return new;
  end if;

  if tg_table_name = 'calls' then
    v_phone := new.caller_number;
  else
    v_phone := new.phone;
  end if;

  if v_phone is null or v_phone = '' then
    return new;
  end if;

  -- Kein Insert: eine Kundennummer, die es im Stamm nicht gibt, ist hier ein
  -- Tippfehler oder eine Zuordnung von Hand, die sich noch ändern kann. Wer
  -- den Kunden wirklich anlegt, tut das über einen Vorgang (touch_customer).
  update public.customers
     set phone = v_phone
   where customer_number = new.customer_number
     and (phone is null or phone = '');

  return new;
end;
$$;

drop trigger if exists trg_touch_customer_phone_leads on public.leads;
create trigger trg_touch_customer_phone_leads
  after insert or update on public.leads
  for each row execute function public.touch_customer_phone();

drop trigger if exists trg_touch_customer_phone_calls on public.calls;
create trigger trg_touch_customer_phone_calls
  after insert or update on public.calls
  for each row execute function public.touch_customer_phone();

-- Einmalig nachziehen, was vor diesem Trigger entstanden ist. Ohne den
-- Backfill stünde die Suche am ersten Tag mit leeren Händen da.
update public.customers c
   set phone = src.phone
  from (
    select customer_number, (array_agg(phone order by created_at desc))[1] as phone
      from (
        select customer_number, phone, created_at
          from public.leads
         where customer_number is not null and customer_number <> ''
           and phone is not null and phone <> ''
        union all
        select customer_number, caller_number, started_at
          from public.calls
         where customer_number is not null and customer_number <> ''
           and caller_number is not null and caller_number <> ''
      ) all_rows
     group by customer_number
  ) src
 where c.customer_number = src.customer_number
   and (c.phone is null or c.phone = '');

-- ----------------------------------------------------------------------------
-- customer_by_phone() — die Suche
--
-- Liefert eine LISTE, keine Antwort. Zu einer Rufnummer können mehrere Kunden
-- gehören (Familienanschluss, Firmenzentrale, eine Nummer, die weitergegeben
-- wurde). Sich davon einen auszusuchen wäre geraten — die Entscheidung gehört
-- dem Menschen im Gespräch, der den Namen hören kann.
--
-- Sortiert nach Verlässlichkeit der Quelle: Kundenstamm vor Lead vor früherem
-- Anruf; innerhalb derselben Quelle das Jüngste zuerst.
--
-- Wie customer_card() (Migration 017) bewusst NICHT security definer: RLS
-- erlaubt jedem aktiven Nutzer das Lesen dieser Tabellen ohnehin, also reichen
-- Invoker-Rechte.
-- ----------------------------------------------------------------------------
create or replace function public.customer_by_phone(p_phone text)
returns jsonb
language sql
stable
as $$
  with key as (
    select public.phone_key(p_phone) as value
  ),
  hits as (
    select c.customer_number, c.name as customer_name, 1 as rank, c.last_contact_at as seen_at
      from public.customers c, key
     where key.value <> ''
       and c.phone is not null and c.phone <> ''
       and public.phone_key(c.phone) = key.value
    union all
    select l.customer_number, l.customer_name, 2, l.created_at
      from public.leads l, key
     where key.value <> ''
       and l.customer_number is not null and l.customer_number <> ''
       and l.phone is not null and l.phone <> ''
       and public.phone_key(l.phone) = key.value
    union all
    select x.customer_number, x.caller_name, 3, x.started_at
      from public.calls x, key
     where key.value <> ''
       and x.customer_number is not null and x.customer_number <> ''
       and x.caller_number is not null and x.caller_number <> ''
       and public.phone_key(x.caller_number) = key.value
  ),
  grouped as (
    select
      customer_number,
      (array_agg(customer_name order by rank, seen_at desc nulls last)
         filter (where customer_name is not null and customer_name <> ''))[1] as customer_name,
      min(rank) as rank,
      max(seen_at) as seen_at
    from hits
    group by customer_number
  ),
  best as (
    select * from grouped order by rank, seen_at desc nulls last limit 5
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'customerNumber', customer_number,
        'name', coalesce(customer_name, ''),
        'source', case rank when 1 then 'Kundenstamm' when 2 then 'Lead' else 'früherer Anruf' end
      )
      order by rank, seen_at desc nulls last
    ),
    '[]'::jsonb
  )
  from best;
$$;

comment on function public.customer_by_phone(text) is
  'Kunden zu einer Rufnummer (Kundenstamm, Leads, frühere Anrufe) als jsonb-Liste. Rückfallweg, wenn die Telefonanlage den Anrufer nicht kennt.';

grant execute on function public.phone_key(text) to authenticated;
grant execute on function public.customer_by_phone(text) to authenticated;
