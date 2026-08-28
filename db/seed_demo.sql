-- ============================================================================
-- TNG Stadtnetz CRM — Demo-/Präsentationsdaten
-- ============================================================================
-- Füllt die App mit realistischen Beispieldaten (Mitarbeiter mit Umsatz,
-- Verträge, Tarifwechsel, Leads, Notizen, Incentives), damit man sie z.B.
-- der Chefin/dem Chef vorführen kann.
--
-- AUSFÜHREN: Supabase Dashboard → SQL Editor → komplett einfügen → Run.
-- Das Skript räumt zuerst alte Demo-Daten weg und legt sie neu an, ist also
-- beliebig oft ausführbar.
--
-- LOGIN der Demo-Mitarbeiter (zum Vorführen der Agenten-Sicht):
--   Name: "Anna Becker"  / "Tom Fischer" / "Lena Wagner" / "Jonas Schmidt"
--   PIN:  1234  (für alle vier)
-- Der echte Chef-Account bleibt unangetastet und sieht im Team-Bereich
-- automatisch die Umsätze aller vier.
--
-- DEMO-DATEN WIEDER ENTFERNEN: einfach nur Abschnitt (1) „Aufräumen"
-- markieren und ausführen.
--
-- ACHTUNG bei Abschnitt (10)/(11): Schichtplan und Anrufe werden für ALLE
-- aktiven Nutzer erzeugt (sonst stünde der vorführende Chef mit leerer Zeile
-- im Plan) und dafür im Zeitfenster Vorwoche…+3 Wochen vorher geleert. Ein
-- echter Plan für diese Wochen geht dabei verloren — wer das nicht will, lässt
-- die beiden Abschnitte aus.
--
-- Abschnitt (10) setzt Migration 024 voraus (Urlaub/Krank/Schulung).
--
-- Hinweis: benötigt die Erweiterung pgcrypto (in Supabase standardmäßig aktiv)
-- für die Passwort-Verschlüsselung.
-- ============================================================================

create extension if not exists pgcrypto;

-- Feste Demo-UUIDs (damit das Skript wiederholbar ist):
--   d0000000-…-0001  Anna Becker   (Top-Performerin)
--   d0000000-…-0002  Tom Fischer   (solide)
--   d0000000-…-0003  Lena Wagner   (Mittelfeld)
--   d0000000-…-0004  Jonas Schmidt (neu im Team)

-- ----------------------------------------------------------------------------
-- (1) Aufräumen — entfernt ausschließlich die Demo-Daten
-- ----------------------------------------------------------------------------
delete from public.contracts      where created_by in ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000004');
delete from public.tariff_changes where created_by in ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000004');
delete from public.notes          where created_by in ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000004');
delete from public.incentives     where created_by in ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000004');
delete from public.leads          where created_by in ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000004'); -- cascadet lead_activities
delete from public.customer_ownerships where owner in ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000004');
-- Schichten und Anrufe hängen nicht an created_by, sondern am Zeitfenster, das
-- Abschnitt (10)/(11) bespielt — und sie betreffen ALLE Nutzer, nicht nur die
-- Demo-Konten. Deshalb hier fensterweise weg, nicht personenweise.
delete from public.shifts where shift_date between date_trunc('week', current_date)::date - 7 and date_trunc('week', current_date)::date + 20;
delete from public.calls  where started_at >= (date_trunc('week', current_date)::date - 7)::timestamptz and started_at < (date_trunc('week', current_date)::date + 7)::timestamptz;
delete from public.campaigns where id in ('c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000005','c0000000-0000-4000-8000-000000000006');
delete from auth.users            where id in ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000004'); -- cascadet public.users + user_settings

-- ----------------------------------------------------------------------------
-- (2) Demo-Mitarbeiter anlegen (Auth + Profil + Monatsziel)
-- ----------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, email_change, email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000','d0000000-0000-4000-8000-000000000001','authenticated','authenticated','anna-becker@crm.tng.local',  crypt('tng-crm::anna becker::1234',  gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{"display_name":"Anna Becker"}',  now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','d0000000-0000-4000-8000-000000000002','authenticated','authenticated','tom-fischer@crm.tng.local',  crypt('tng-crm::tom fischer::1234',  gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{"display_name":"Tom Fischer"}',  now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','d0000000-0000-4000-8000-000000000003','authenticated','authenticated','lena-wagner@crm.tng.local',  crypt('tng-crm::lena wagner::1234',  gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{"display_name":"Lena Wagner"}',  now(), now(), '','','',''),
  ('00000000-0000-0000-0000-000000000000','d0000000-0000-4000-8000-000000000004','authenticated','authenticated','jonas-schmidt@crm.tng.local',crypt('tng-crm::jonas schmidt::1234',gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}','{"display_name":"Jonas Schmidt"}',now(), now(), '','','','')
on conflict (id) do nothing;

insert into auth.identities
  (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
  ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','{"sub":"d0000000-0000-4000-8000-000000000001","email":"anna-becker@crm.tng.local"}'::jsonb,  'email', now(), now(), now()),
  ('d0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000002','{"sub":"d0000000-0000-4000-8000-000000000002","email":"tom-fischer@crm.tng.local"}'::jsonb,  'email', now(), now(), now()),
  ('d0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000003','{"sub":"d0000000-0000-4000-8000-000000000003","email":"lena-wagner@crm.tng.local"}'::jsonb,  'email', now(), now(), now()),
  ('d0000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000004','{"sub":"d0000000-0000-4000-8000-000000000004","email":"jonas-schmidt@crm.tng.local"}'::jsonb,'email', now(), now(), now())
on conflict do nothing;

insert into public.users
  (id, key, display_name, role, is_active, onboarding_completed, leaderboard_opt_in, consent_given_at, created_at)
values
  ('d0000000-0000-4000-8000-000000000001','anna becker',  'Anna Becker',  'agent', true, true, true, now(), now()),
  ('d0000000-0000-4000-8000-000000000002','tom fischer',  'Tom Fischer',  'agent', true, true, true, now(), now()),
  ('d0000000-0000-4000-8000-000000000003','lena wagner',  'Lena Wagner',  'agent', true, true, true, now(), now()),
  ('d0000000-0000-4000-8000-000000000004','jonas schmidt','Jonas Schmidt','agent', true, true, true, now(), now())
on conflict (id) do nothing;

insert into public.user_settings (user_id, monthly_target)
values
  ('d0000000-0000-4000-8000-000000000001', 2000),
  ('d0000000-0000-4000-8000-000000000002', 1500),
  ('d0000000-0000-4000-8000-000000000003', 1200),
  ('d0000000-0000-4000-8000-000000000004', 800)
on conflict (user_id) do update set monthly_target = excluded.monthly_target;

-- ----------------------------------------------------------------------------
-- (3) Verträge  (Monatswerte = laufender Monat, Vormonat zum Vergleich)
-- ----------------------------------------------------------------------------
-- Datums-Hilfen:
--   m(k)  = k-ter Tag dieses Monats   →  date_trunc('month', current_date)::date + (k-1)
--   pm(k) = k-ter Tag des Vormonats
insert into public.contracts
  (customer_number, customer_name, products, contract_date, status, jira_ticket, follow_up_date, laufzeit_monate, notes, created_by)
values
  -- Anna (Top-Performerin)
  ('K-10234','Müller Haustechnik GmbH','["Premium 1000","Waipu TV"]'::jsonb, date_trunc('month',current_date)::date + 2,  'aktiv',     'TNG-3001', null,             24, 'Geschäftskunde, Bestandsausbau.', 'd0000000-0000-4000-8000-000000000001'),
  ('K-10567','Sabine Hoffmann',        '["Pro 1000"]'::jsonb,                 date_trunc('month',current_date)::date + 7,  'aktiv',     'TNG-3002', current_date,     24, null, 'd0000000-0000-4000-8000-000000000001'),
  ('K-10892','Bäckerei Kraus',         '["Fibrepro","Waipu TV"]'::jsonb,      date_trunc('month',current_date)::date + 11, 'aktiv',     'TNG-3003', null,             12, null, 'd0000000-0000-4000-8000-000000000001'),
  ('K-11045','Andreas Klein',          '["Basic 1000"]'::jsonb,               date_trunc('month',current_date)::date + 15, 'offen',     'TNG-3004', current_date - 2, 24, 'Wartet auf Unterschrift.', 'd0000000-0000-4000-8000-000000000001'),
  ('K-12876','TechStart UG',           '["Fibrepro"]'::jsonb,                 (current_date - interval '23 months')::date, 'aktiv',     'TNG-2780', null,             24, 'Läuft bald aus – VVL vorbereiten.', 'd0000000-0000-4000-8000-000000000001'),
  ('K-10234','Müller Haustechnik GmbH','["Premium 1000"]'::jsonb,             date_trunc('month',current_date - interval '1 month')::date + 9,  'aktiv', 'TNG-2901', null, 24, null, 'd0000000-0000-4000-8000-000000000001'),
  ('K-11320','Yilmaz Elektro',         '["Fibrefamily"]'::jsonb,              date_trunc('month',current_date - interval '1 month')::date + 18, 'aktiv', 'TNG-2902', null, 12, null, 'd0000000-0000-4000-8000-000000000001'),

  -- Tom (solide)
  ('K-11588','Petra Schulz',           '["Basic 1000"]'::jsonb,               date_trunc('month',current_date)::date + 4,  'aktiv',     'TNG-3010', null,             24, null, 'd0000000-0000-4000-8000-000000000002'),
  ('K-12001','Nordlicht Café',         '["Fibrefamily","Waipu TV"]'::jsonb,   date_trunc('month',current_date)::date + 10, 'aktiv',     'TNG-3011', null,             24, null, 'd0000000-0000-4000-8000-000000000002'),
  ('K-12244','Dr. Weber Praxis',       '["Surf1.000"]'::jsonb,                date_trunc('month',current_date)::date + 17, 'aktiv',     'TNG-3012', current_date + 7, 12, null, 'd0000000-0000-4000-8000-000000000002'),
  ('K-12509','Familie Richter',        '["Flott300"]'::jsonb,                 date_trunc('month',current_date)::date + 8,  'storniert', 'TNG-3013', null,             24, 'Kunde hat widerrufen.', 'd0000000-0000-4000-8000-000000000002'),
  ('K-11588','Petra Schulz',           '["Pro 1000"]'::jsonb,                 date_trunc('month',current_date - interval '1 month')::date + 12, 'aktiv', 'TNG-2910', null, 24, null, 'd0000000-0000-4000-8000-000000000002'),

  -- Lena (Mittelfeld)
  ('K-13150','Gärtnerei Sommer',       '["Fibrefamily"]'::jsonb,              date_trunc('month',current_date)::date + 5,  'aktiv',     'TNG-3020', null,             12, null, 'd0000000-0000-4000-8000-000000000003'),
  ('K-13422','Markus Lang',            '["Smart300"]'::jsonb,                 date_trunc('month',current_date)::date + 13, 'aktiv',     'TNG-3021', current_date,     24, null, 'd0000000-0000-4000-8000-000000000003'),
  ('K-12244','Dr. Weber Praxis',       '["Mobilfunk LTE Komplett 5G"]'::jsonb,date_trunc('month',current_date)::date + 19, 'aktiv',     'TNG-3022', null,             null,'Zusatzprodukt.', 'd0000000-0000-4000-8000-000000000003'),
  ('K-13150','Gärtnerei Sommer',       '["Fibrepro"]'::jsonb,                 date_trunc('month',current_date - interval '1 month')::date + 20, 'aktiv', 'TNG-2920', null, 24, null, 'd0000000-0000-4000-8000-000000000003'),

  -- Jonas (neu im Team)
  ('K-12001','Nordlicht Café',         '["Fibrelight"]'::jsonb,               date_trunc('month',current_date)::date + 16, 'aktiv',     'TNG-3030', null,             12, 'Erster eigener Abschluss.', 'd0000000-0000-4000-8000-000000000004'),
  ('K-11045','Andreas Klein',          '["Waipu TV"]'::jsonb,                 date_trunc('month',current_date)::date + 21, 'aktiv',     'TNG-3031', null,             null,null,'d0000000-0000-4000-8000-000000000004'),

  -- Zusätzliche Kunden & Historie (2 Monate zurück, für Berichte/Trends)
  ('K-14210','Hotel Am Hafen',         '["Premium 1000","Waipu TV"]'::jsonb,  date_trunc('month',current_date - interval '2 months')::date + 3,  'aktiv',     'TNG-2810', null, 24, 'Großkunde, mehrere Anschlüsse.', 'd0000000-0000-4000-8000-000000000001'),
  ('K-14355','Physiotherapie Meier',   '["Pro 1000"]'::jsonb,                 date_trunc('month',current_date - interval '2 months')::date + 14, 'aktiv',     'TNG-2811', null, 12, null, 'd0000000-0000-4000-8000-000000000001'),
  ('K-14488','Rechtsanwälte Voigt & Partner','["Fibrepro","Mobilfunk LTE Komplett 5G"]'::jsonb, date_trunc('month',current_date - interval '2 months')::date + 25, 'aktiv', 'TNG-2812', null, 24, null, 'd0000000-0000-4000-8000-000000000002'),
  ('K-14602','Kindertagesstätte Sonnenschein','["Fibrefamily"]'::jsonb,       date_trunc('month',current_date - interval '2 months')::date + 9,  'aktiv',     'TNG-2813', null, 24, null, 'd0000000-0000-4000-8000-000000000003'),
  ('K-14719','Michael Brandt',         '["Basic 1000"]'::jsonb,               date_trunc('month',current_date - interval '2 months')::date + 19, 'storniert', 'TNG-2814', null, 24, 'Umzug ins Ausland.', 'd0000000-0000-4000-8000-000000000004'),
  ('K-14820','Bio-Markt Grünwald',     '["Fibrepro","Waipu TV"]'::jsonb,      date_trunc('month',current_date - interval '1 month')::date + 5,  'aktiv',     'TNG-2960', current_date + 1, 24, null, 'd0000000-0000-4000-8000-000000000002'),
  ('K-14933','Familie Roth',           '["Smart300"]'::jsonb,                 date_trunc('month',current_date - interval '1 month')::date + 27, 'offen',     'TNG-2961', current_date - 1, 12, 'Warten auf Bonitätsprüfung.', 'd0000000-0000-4000-8000-000000000003'),
  ('K-15044','Fahrschule Nordwind',    '["Surf1.000"]'::jsonb,                date_trunc('month',current_date)::date + 1,  'aktiv',     'TNG-3040', null, 12, null, 'd0000000-0000-4000-8000-000000000004'),
  ('K-15177','Bäckerei Kraus',         '["Mobilfunk LTE Komplett 5G"]'::jsonb,date_trunc('month',current_date)::date + 20, 'aktiv',     'TNG-3041', null, null,'Zusatzprodukt zur Filiale.', 'd0000000-0000-4000-8000-000000000001'),
  ('K-15288','Steuerkanzlei Voß',      '["Pro 1000"]'::jsonb,                 date_trunc('month',current_date)::date + 23, 'aktiv',     'TNG-3042', null, 24, 'Aus Lead e...0004 gewonnen.', 'd0000000-0000-4000-8000-000000000001'),
  ('K-15399','Autohaus Sonne',         '["Business 1000"]'::jsonb,            date_trunc('month',current_date)::date + 24, 'aktiv',     'TNG-3043', null, 24, 'Aus Lead e...0006 gewonnen.', 'd0000000-0000-4000-8000-000000000001');

-- ----------------------------------------------------------------------------
-- (4) Tarifwechsel
-- ----------------------------------------------------------------------------
insert into public.tariff_changes
  (customer_number, customer_name, change_type, context, old_product, new_product, change_date, jira_ticket, notes, created_by)
values
  ('K-10892','Bäckerei Kraus',   'upgrade',  'mvlz_lt3',     'Fibrefamily','Fibrepro', date_trunc('month',current_date)::date + 6,  'TNG-3101', null, 'd0000000-0000-4000-8000-000000000001'),
  ('K-11320','Yilmaz Elektro',   'sidegrade','outside_mvlz', 'Flott300','Surf1.000',   date_trunc('month',current_date - interval '1 month')::date + 22, 'TNG-2950', null, 'd0000000-0000-4000-8000-000000000001'),
  ('K-12001','Nordlicht Café',   'upgrade',  'mvlz_gt3',     'Fibrelight','Fibrefamily',date_trunc('month',current_date)::date + 12, 'TNG-3102', null, 'd0000000-0000-4000-8000-000000000002'),
  ('K-13422','Markus Lang',      'sidegrade','mvlz_lt3',     'Smart300','Surf100',      date_trunc('month',current_date)::date + 18, 'TNG-3103', null, 'd0000000-0000-4000-8000-000000000003'),
  ('K-14820','Bio-Markt Grünwald','upgrade', 'mvlz_gt3',     'Fibrefamily','Fibrepro',   date_trunc('month',current_date - interval '1 month')::date + 6, 'TNG-2970', null, 'd0000000-0000-4000-8000-000000000002'),
  ('K-14210','Hotel Am Hafen',   'upgrade',  'outside_mvlz', 'Premium 1000','Business 1000', date_trunc('month',current_date - interval '2 months')::date + 10, 'TNG-2820', 'Erweiterung um weitere Zimmer.', 'd0000000-0000-4000-8000-000000000001'),
  ('K-14602','Kindertagesstätte Sonnenschein','sidegrade','mvlz_lt3','Fibrelight','Fibrefamily', date_trunc('month',current_date - interval '2 months')::date + 15, 'TNG-2821', null, 'd0000000-0000-4000-8000-000000000003');

-- ----------------------------------------------------------------------------
-- (5) Leads (4-Stufen-Pipeline) + Aktivitäten
-- ----------------------------------------------------------------------------
insert into public.leads
  (id, customer_name, customer_number, phone, topic, status, priority, follow_up_date, notes, created_by)
values
  ('e0000000-0000-4000-8000-000000000001','Neubau Seestraße 12','K-20010','0381 123456','FTTH Hausanschluss', 'neu',          'dringend', current_date - 1, 'Bauträger, 8 Wohneinheiten.', 'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000002','Café Morgenrot',     'K-20011','0381 223344','Glasfaser Gewerbe',  'neu',          'normal',   null,             null, 'd0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000003','Frank Berger',       null,     '0170 9988776','Tarif-Beratung',    'neu',          'hoch',     current_date,     'Rückruf gewünscht.', 'd0000000-0000-4000-8000-000000000003'),
  ('e0000000-0000-4000-8000-000000000004','Steuerkanzlei Voß',  'K-20013','0381 556677','Upgrade Pro 1000',   'inBearbeitung','hoch',     current_date,     'Angebot raus.', 'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000005','Lisa Brandt',        null,     '0151 4433221','Privatanschluss',   'inBearbeitung','normal',   current_date + 3, null, 'd0000000-0000-4000-8000-000000000004'),
  ('e0000000-0000-4000-8000-000000000006','Autohaus Sonne',     'K-20015','0381 778899','Business 1000',      'gewonnen',     'normal',   null,             'Abschluss erfolgt.', 'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000007','Pension Anker',      'K-20016','0381 990011','Fibrefamily',        'gewonnen',     'normal',   null,             null, 'd0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000008','Praxis Dr. Nolte',   'K-20017','0381 112233','Premium 1000',       'gewonnen',     'hoch',     null,             null, 'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000009','Kiosk am Markt',     null,     '0381 445566','Glasfaser',          'verloren',     'normal',   null,             'Hat sich für Wettbewerber entschieden.', 'd0000000-0000-4000-8000-000000000003'),
  ('e0000000-0000-4000-8000-000000000010','Fitnessstudio PowerZone','K-20020','0381 665544','Business Glasfaser', 'neu',        'hoch',     current_date + 1, 'Mehrere Standorte, großes Potenzial.', 'd0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000011','Familie Neumann',    null,     '0176 2233445','Privatanschluss',   'neu',          'normal',   current_date + 5, null, 'd0000000-0000-4000-8000-000000000003'),
  ('e0000000-0000-4000-8000-000000000012','Werbeagentur Blickfang','K-20021','0381 887766','Fibrepro Upgrade', 'inBearbeitung','normal',  current_date + 2, 'Wartet auf internes Budget-OK.', 'd0000000-0000-4000-8000-000000000004'),
  ('e0000000-0000-4000-8000-000000000013','Metzgerei Hoffmann',  'K-20022','0381 334455','Fibrefamily',       'inBearbeitung','dringend', current_date,     'Konkurrenzangebot liegt vor – dringend nachfassen.', 'd0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000014','Yoga Studio Balance', 'K-20023','0381 223311','Surf1.000',         'gewonnen',     'normal',   null,             null, 'd0000000-0000-4000-8000-000000000003'),
  ('e0000000-0000-4000-8000-000000000015','Getränkemarkt Nord',  'K-20024','0381 998877','Basic 1000',        'verloren',     'normal',   null,             'Preis war entscheidend, zu Wettbewerber gewechselt.', 'd0000000-0000-4000-8000-000000000004');

insert into public.lead_activities (lead_id, type, content, created_by)
values
  ('e0000000-0000-4000-8000-000000000001','contact','Erstkontakt telefonisch – großes Interesse an FTTH.', 'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000001','note',   'Unterlagen zum Bauträger-Tarif zugeschickt.',          'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000004','note',   'Angebot Pro 1000 inkl. VVL versendet.',                'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000004','contact','Rückruf für nächste Woche vereinbart.',                'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000006','contact','Vertrag unterschrieben übergeben.',                    'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000010','contact','Erstgespräch mit Studioleitung geführt.',              'd0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000012','note',   'Angebot für Fibrepro-Upgrade verschickt.',             'd0000000-0000-4000-8000-000000000004'),
  ('e0000000-0000-4000-8000-000000000013','contact','Kunde nachtelefoniert, Konkurrenzangebot besprochen.', 'd0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000013','note',   'Rabatt-Freigabe bei Chefin angefragt.',                'd0000000-0000-4000-8000-000000000002'),
  ('e0000000-0000-4000-8000-000000000014','contact','Vertrag unterschrieben übergeben.',                    'd0000000-0000-4000-8000-000000000003');

-- ----------------------------------------------------------------------------
-- (6) Notizen
-- ----------------------------------------------------------------------------
insert into public.notes
  (customer_number, customer_name, title, content, jira_ticket, created_by)
values
  ('K-10234','Müller Haustechnik GmbH','Rückruf Geschäftsführer','Möchte Upgrade auf Premium 1000 für die Filiale besprechen.','TNG-3001','d0000000-0000-4000-8000-000000000001'),
  ('K-12876','TechStart UG','Vertragsverlängerung','Vertrag läuft in ~1 Monat aus – VVL-Angebot vorbereiten.','TNG-2780','d0000000-0000-4000-8000-000000000001'),
  ('K-12001','Nordlicht Café','Standort-Check','Glasfaser liegt an, Hausanschluss muss noch geprüft werden.',null,'d0000000-0000-4000-8000-000000000002'),
  (null,null,'Team-Idee','Sammelaktion für Bestandskunden-VVL im nächsten Monat starten.',null,'d0000000-0000-4000-8000-000000000003'),
  ('K-14210','Hotel Am Hafen','Zusatzanschluss geplant','Möchte im Herbst zwei weitere Zimmer ans Netz bringen lassen.',null,'d0000000-0000-4000-8000-000000000001'),
  ('K-14488','Rechtsanwälte Voigt & Partner','Rahmenvertrag prüfen','Kanzlei fragt nach Rahmenvertrag für weitere Standorte.','TNG-2812','d0000000-0000-4000-8000-000000000002'),
  ('K-14933','Familie Roth','Bonitätsprüfung offen','Auskunftei-Antwort steht noch aus, Kunde ungeduldig.',null,'d0000000-0000-4000-8000-000000000003'),
  (null,null,'Schulung','Neue Mitarbeiter-Schulung zu Fibrepro-Upselling nächste Woche.',null,'d0000000-0000-4000-8000-000000000001');

-- ----------------------------------------------------------------------------
-- (7) Incentives (laufende Team-Aktionen)
-- ----------------------------------------------------------------------------
insert into public.incentives
  (title, mechanic, metric, period, target, reward, active, created_by)
values
  ('Monats-Sprint','goal',        'commission','monthly', 800, 'Tankgutschein 50 €',  true, 'd0000000-0000-4000-8000-000000000001'),
  ('Wochen-Champion','competition','deals',     'weekly',  0,   'Mittagessen aufs Haus', true, 'd0000000-0000-4000-8000-000000000001'),
  ('Upselling-Woche','goal',      'contracts', 'weekly',  3,   'Kinogutschein',       true, 'd0000000-0000-4000-8000-000000000001');

-- ----------------------------------------------------------------------------
-- (8) Kunden-Zuordnung (Owner / geteilt) — für die Kundenliste
-- ----------------------------------------------------------------------------
insert into public.customer_ownerships (customer_number, owner, shared_with)
values
  ('K-10234','d0000000-0000-4000-8000-000000000001','{}'::uuid[]),
  ('K-12001','d0000000-0000-4000-8000-000000000002', array['d0000000-0000-4000-8000-000000000004']::uuid[]),
  ('K-12244','d0000000-0000-4000-8000-000000000003','{}'::uuid[]),
  ('K-14210','d0000000-0000-4000-8000-000000000001','{}'::uuid[]),
  ('K-14488','d0000000-0000-4000-8000-000000000002','{}'::uuid[]),
  ('K-14820','d0000000-0000-4000-8000-000000000002', array['d0000000-0000-4000-8000-000000000004']::uuid[])
on conflict (customer_number) do nothing;

-- ----------------------------------------------------------------------------
-- (9) Kampagnen (Outbound-Katalog)
-- ----------------------------------------------------------------------------
-- Feste UUIDs, damit die Schichten unten darauf verweisen können und ein
-- erneuter Lauf dieselben Kampagnen trifft statt Dubletten anzulegen.
-- Die sechs produktiven Kampagnen (Gesprächsleitfäden v2.0, Migration 025).
insert into public.campaigns (id, name, call_type, active, created_by)
values
  ('c0000000-0000-4000-8000-000000000001','Churn — Widerrufe & Kündigungen','churn',   true, 'd0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000002','Welcome Calls',                 'welcome', true, 'd0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000003','Postrückläufer',                'prl',     true, 'd0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000004','Dubletten-Check',               'dupe',    true, 'd0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000005','Bauverweigerer',                'bvw',     true, 'd0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000006','Courtesy Calls',                'courtesy',true, 'd0000000-0000-4000-8000-000000000001')
on conflict (id) do update
  set name = excluded.name, call_type = excluded.call_type, active = excluded.active;

-- Bauverweigerer wird als Liste abtelefoniert (Migration 026): Prämien,
-- Zielprodukt und Versuchsgrenze setzen. Die übrigen Kampagnen bleiben reine
-- Inbound-Kampagnen ohne Liste.
update public.campaigns
   set bonus_termin = 5,
       bonus_abschluss = 25,
       max_attempts = 3,
       target_product = 'Fibrefamily',
       start_date = current_date - 10,
       end_date = current_date + 20
 where id = 'c0000000-0000-4000-8000-000000000005';

-- ----------------------------------------------------------------------------
-- (9b) Anrufliste der BVW-Kampagne — teils schon abtelefoniert
-- ----------------------------------------------------------------------------
-- Wird über den Kampagnen-Delete oben mit weggeräumt (on delete cascade).
insert into public.outbound_contacts
  (campaign_id, customer_name, phone, street, zip, city, info,
   status, attempts, follow_up_date, follow_up_time, assigned_to, notes,
   result_by, result_at, dedupe_key, created_by)
values
  ('c0000000-0000-4000-8000-000000000005','Marion Petersen','0431 5512340','Holtenauer Str. 88','24105','Kiel','Bau 2024 abgelehnt',
   'termin', 1, current_date + 2, '10:30', 'd0000000-0000-4000-8000-000000000001', 'Interessiert, Partner muss mitentscheiden.',
   'd0000000-0000-4000-8000-000000000001', now() - interval '1 day', 'tel:04315512340', 'd0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000005','Bernd Kruse','0431 5512341','Holtenauer Str. 92','24105','Kiel','Damals kein Bedarf',
   'abschluss', 2, null, null, 'd0000000-0000-4000-8000-000000000001', 'Bucht Fibrefamily, Vertrag erfasst.',
   'd0000000-0000-4000-8000-000000000001', now() - interval '2 day', 'tel:04315512341', 'd0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000005','Sabine Lorenzen','0431 5512342','Feldstr. 12','24105','Kiel',null,
   'wiedervorlage', 1, current_date, '14:00', 'd0000000-0000-4000-8000-000000000002', 'Bittet um Rückruf am Nachmittag.',
   'd0000000-0000-4000-8000-000000000002', now() - interval '1 day', 'tel:04315512342', 'd0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000005','Hendrik Boysen','0431 5512343','Feldstr. 40','24105','Kiel','Anschluss liegt bereits',
   'keinInteresse', 1, null, null, null, 'Erst kürzlich verlängert.',
   'd0000000-0000-4000-8000-000000000002', now() - interval '3 day', 'tel:04315512343', 'd0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000005','Familie Thomsen','0431 5512344','Waitzstr. 5','24105','Kiel',null,
   'nichtErreicht', 2, null, null, null, null,
   'd0000000-0000-4000-8000-000000000003', now() - interval '1 day', 'tel:04315512344', 'd0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000005','Ingrid Hansen','0431 5512345','Waitzstr. 19','24105','Kiel','Fragt nach Mobilfunk-Bundle',
   'offen', 0, null, null, null, null, null, null, 'tel:04315512345', 'd0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000005','Malte Jürgensen','0431 5512346','Düppelstr. 3','24105','Kiel',null,
   'offen', 0, null, null, null, null, null, null, 'tel:04315512346', 'd0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000005','Kirsten Ahlmann','0431 5512347','Düppelstr. 27','24105','Kiel',null,
   'offen', 0, null, null, null, null, null, null, 'tel:04315512347', 'd0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000005','Torben Reimers','0431 5512348','Knooper Weg 140','24105','Kiel','Ladenlokal',
   'offen', 0, null, null, null, null, null, null, 'tel:04315512348', 'd0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000005','Gerda Stoltenberg','0431 5512349','Knooper Weg 166','24105','Kiel',null,
   'offen', 0, null, null, null, null, null, null, 'tel:04315512349', 'd0000000-0000-4000-8000-000000000001')
on conflict (campaign_id, dedupe_key) do nothing;
-- ----------------------------------------------------------------------------
-- (10) Schichtplan — Vorwoche, laufende Woche, Folgewoche
-- ----------------------------------------------------------------------------
-- ACHTUNG: Anders als die übrigen Abschnitte betrifft dieser Block ALLE aktiven
-- Nutzer, nicht nur die vier Demo-Konten — sonst stünde der Chef, der die App
-- vorführt, im Plan mit einer leeren Zeile da. Entsprechend wird zuerst das
-- gesamte Zeitfenster geleert und dann neu befüllt; ein echter Plan für diese
-- drei Wochen geht dabei verloren. Wer das nicht will, überspringt Abschnitt
-- (10) und (11).
--
-- Erfordert Migration 024 für 'urlaub'/'krank'/'schulung'. Ohne sie schlägt
-- der Check-Constraint an — dann erst 024 einspielen.
do $$
declare
  monday date := date_trunc('week', current_date)::date;   -- Montag dieser Woche
  agent record;
  idx int;
  d date;
  offs int;
  pattern text[];
  camp uuid;
  camps uuid[] := array[
    'c0000000-0000-4000-8000-000000000001'::uuid,
    'c0000000-0000-4000-8000-000000000002'::uuid,
    'c0000000-0000-4000-8000-000000000003'::uuid,
    'c0000000-0000-4000-8000-000000000004'::uuid,
    'c0000000-0000-4000-8000-000000000005'::uuid,
    'c0000000-0000-4000-8000-000000000006'::uuid
  ];
begin
  delete from public.shifts
   where shift_date between monday - 7 and monday + 20;

  idx := 0;
  for agent in
    select id from public.users where is_active order by display_name
  loop
    -- Rollierende Muster: jede Person startet eine Position weiter im Zyklus,
    -- damit Früh/Spät sich über das Team verteilen statt gleichzuschalten.
    -- Sechs Muster über sieben Tage (Mo–So), Wochenende überwiegend frei.
    pattern := case idx % 4
      when 0 then array['frueh','frueh','spaet','spaet','frueh','frei','frei']
      when 1 then array['spaet','frueh','frueh','frei','spaet','frueh','frei']
      when 2 then array['frueh','spaet','frei','frueh','spaet','frei','frei']
      else        array['frei','spaet','frueh','spaet','frueh','frei','frei']
    end;
    camp := camps[(idx % 6) + 1];

    for offs in -7..20 loop
      d := monday + offs;
      insert into public.shifts (user_id, shift_date, shift_type, campaign_id)
      values (
        agent.id,
        d,
        pattern[(extract(isodow from d))::int],
        case when pattern[(extract(isodow from d))::int] in ('frueh','spaet')
             then camp else null end
      );
    end loop;

    idx := idx + 1;
  end loop;

  -- Ein paar Abwesenheiten, damit Urlaub/Krank/Schulung und die
  -- Unterdeckungs-Warnung im Plan tatsächlich sichtbar sind (und nicht nur
  -- als Werkzeug existieren).
  update public.shifts set shift_type = 'urlaub', campaign_id = null
   where user_id = 'd0000000-0000-4000-8000-000000000003'
     and shift_date between monday + 7 and monday + 11;
  update public.shifts set shift_type = 'krank', campaign_id = null
   where user_id = 'd0000000-0000-4000-8000-000000000002'
     and shift_date = monday + 3;
  update public.shifts set shift_type = 'schulung', campaign_id = null
   where user_id = 'd0000000-0000-4000-8000-000000000004'
     and shift_date = monday + 4;
end $$;

-- ----------------------------------------------------------------------------
-- (11) Anrufe — passend zu den Schichten der letzten und dieser Woche
-- ----------------------------------------------------------------------------
-- Erst damit zeigt der Schichtplan in den Zellen, was eine Schicht gebracht
-- hat, und die Abschlussquote auf dem Dashboard hat eine Grundlage.
-- Anrufe entstehen nur an tatsächlichen Arbeitstagen und liegen innerhalb der
-- jeweiligen Schichtzeit (Früh 07:45–16:15, Spät 08:45–17:15).
do $$
declare
  monday date := date_trunc('week', current_date)::date;
  s record;
  n int;
  i int;
  start_min int;
  span_min int;
  t timestamptz;
  dur int;
  disp text;
  kunden text[] := array['K-10234','K-10567','K-10892','K-11045','K-11588','K-12001',
                         'K-12244','K-13150','K-13422','K-14210','K-14820','K-15044'];
begin
  delete from public.calls
   where started_at >= (monday - 7)::timestamptz
     and started_at <  (monday + 7)::timestamptz;

  for s in
    select user_id, shift_date, shift_type, campaign_id
      from public.shifts
     where shift_type in ('frueh','spaet')
       and shift_date between monday - 7 and least(monday + 6, current_date)
  loop
    -- 6–17 Anrufe je Schicht: genug Streuung, dass die Zahlen im Plan nicht
    -- uniform wirken, aber ohne Ausreißer, die die Auswertung verzerren.
    n := 6 + (abs(hashtext(s.user_id::text || s.shift_date::text)) % 12);
    start_min := case when s.shift_type = 'frueh' then 7 * 60 + 45 else 8 * 60 + 45 end;
    span_min  := 8 * 60;  -- 8:30 Schichtlänge, letzte halbe Stunde bleibt frei

    for i in 1..n loop
      t := s.shift_date::timestamptz
           + make_interval(mins => start_min + ((i - 1) * span_min) / n);
      dur := 90 + (abs(hashtext(s.user_id::text || s.shift_date::text || i::text)) % 600);
      -- Zulässige Werte laut Migration 021 (Bindestrich bei 'kein-interesse').
      disp := case (abs(hashtext(s.shift_date::text || i::text)) % 5)
                when 0 then 'gehalten'
                when 1 then 'gekuendigt'
                when 2 then 'kein-interesse'
                when 3 then 'sonstige'
                else 'rueckruf'
              end;

      insert into public.calls
        (customer_number, caller_name, direction, started_at, ended_at, duration_s,
         agent_id, campaign_id, disposition)
      values (
        kunden[(i % array_length(kunden, 1)) + 1],
        null,
        'outbound',
        t,
        t + make_interval(secs => dur),
        dur,
        s.user_id,
        s.campaign_id,
        disp
      );
    end loop;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- (12) Outbound-Gespräche
-- ----------------------------------------------------------------------------
-- Bewusst NACH Abschnitt (11): der räumt alle Anrufe der laufenden Woche ab
-- und würde diese Zeilen sonst gleich wieder mitnehmen.
-- Die geführten Gespräche als Anrufe — dieselbe Tabelle wie die der Extension,
-- damit Outbound in Anrufvolumen und Dispositions-Auswertung mitzählt.
insert into public.calls
  (customer_number, caller_name, caller_number, direction, started_at, ended_at,
   duration_s, agent_id, disposition, note, campaign_id, outbound_contact_id)
select
  oc.customer_number, oc.customer_name, oc.phone, 'outbound',
  oc.result_at, oc.result_at + interval '3 minutes', 180,
  oc.result_by,
  case oc.status
    when 'termin'        then 'termin'
    when 'abschluss'     then 'abschluss'
    when 'wiedervorlage' then 'rueckruf'
    when 'keinInteresse' then 'kein-interesse'
    when 'nichtErreicht' then 'nicht-erreicht'
    when 'falscheDaten'  then 'falsche-daten'
    else 'sperren'
  end,
  oc.notes, oc.campaign_id, oc.id
from public.outbound_contacts oc
where oc.campaign_id = 'c0000000-0000-4000-8000-000000000005'
  and oc.result_by is not null
  and oc.result_at is not null;

-- ============================================================================
-- Fertig. Im CRM neu laden — Team-Dashboard, Leaderboard, Leads, Berichte,
-- Incentives, Schichtplan und die Anrufauswertung sind jetzt gefüllt.
-- Demo-Logins: PIN 1234.
-- ============================================================================
