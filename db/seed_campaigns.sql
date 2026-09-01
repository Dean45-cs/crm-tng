-- ============================================================================
-- Die sechs produktiven Kampagnen anlegen (Gesprächsleitfäden v2.0)
-- ============================================================================
-- AUSFÜHREN: Supabase Dashboard → SQL Editor → einfügen → Run.
-- Beliebig oft ausführbar: bestehende Kampagnen mit demselben Namen werden
-- aktualisiert, nicht dupliziert.
--
-- Warum das hier steht und nicht in einer Migration: Kampagnen sind Daten, die
-- der Chef pflegt (Migration 019), keine Struktur. Eine Migration, die Zeilen
-- anlegt, würde bei jedem Re-Run gegen die Hand des Chefs arbeiten — der Name
-- „Kündigerrückgewinnung Q3" soll änderbar bleiben, ohne beim nächsten Update
-- zurückgesetzt zu werden.
--
-- Der `call_type` ist dagegen nicht frei: er verbindet die Kampagne mit dem
-- Leitfaden, den Ergebnissen und den Pflichtfeldern in
-- extension/src/campaigns.js. Wer eine eigene Kampagne anlegt, wählt einen der
-- sechs Typen — oder 'other', dann gibt es keinen eigenen Leitfaden.
--
-- Voraussetzung: Migration 019 (campaigns) und 025 (die sechs Call-Typen).
-- ============================================================================

insert into public.campaigns (name, call_type, active)
select v.name, v.call_type, true
from (values
  ('Welcome Calls',       'welcome'),
  ('Churn — Widerrufe & Kündigungen', 'churn'),
  ('Postrückläufer',      'prl'),
  ('Dubletten-Check',     'dupe'),
  ('Bauverweigerer',      'bvw'),
  ('Courtesy Calls',      'courtesy')
) as v(name, call_type)
where not exists (
  select 1 from public.campaigns c where c.name = v.name
);

-- Call-Typ nachziehen, falls eine Kampagne dieses Namens schon existiert, aber
-- noch auf einem alten Typ steht (vor Migration 025 gab es nur churn/welcome/
-- other — ein Postrückläufer lief dort zwangsläufig als 'other' und bekam
-- deshalb den Churn-Leitfaden zu sehen).
update public.campaigns c
   set call_type = v.call_type
from (values
  ('Welcome Calls',       'welcome'),
  ('Churn — Widerrufe & Kündigungen', 'churn'),
  ('Postrückläufer',      'prl'),
  ('Dubletten-Check',     'dupe'),
  ('Bauverweigerer',      'bvw'),
  ('Courtesy Calls',      'courtesy')
) as v(name, call_type)
where c.name = v.name and c.call_type is distinct from v.call_type;

select name, call_type, active from public.campaigns order by name;
