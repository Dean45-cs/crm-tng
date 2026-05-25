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
  ('K-11045','Andreas Klein',          '["Waipu TV"]'::jsonb,                 date_trunc('month',current_date)::date + 21, 'aktiv',     'TNG-3031', null,             null,null,'d0000000-0000-4000-8000-000000000004');

-- ----------------------------------------------------------------------------
-- (4) Tarifwechsel
-- ----------------------------------------------------------------------------
insert into public.tariff_changes
  (customer_number, customer_name, change_type, context, old_product, new_product, change_date, jira_ticket, notes, created_by)
values
  ('K-10892','Bäckerei Kraus',   'upgrade',  'mvlz_lt3',     'Fibrefamily','Fibrepro', date_trunc('month',current_date)::date + 6,  'TNG-3101', null, 'd0000000-0000-4000-8000-000000000001'),
  ('K-11320','Yilmaz Elektro',   'sidegrade','outside_mvlz', 'Flott300','Surf1.000',   date_trunc('month',current_date - interval '1 month')::date + 22, 'TNG-2950', null, 'd0000000-0000-4000-8000-000000000001'),
  ('K-12001','Nordlicht Café',   'upgrade',  'mvlz_gt3',     'Fibrelight','Fibrefamily',date_trunc('month',current_date)::date + 12, 'TNG-3102', null, 'd0000000-0000-4000-8000-000000000002'),
  ('K-13422','Markus Lang',      'sidegrade','mvlz_lt3',     'Smart300','Surf100',      date_trunc('month',current_date)::date + 18, 'TNG-3103', null, 'd0000000-0000-4000-8000-000000000003');

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
  ('e0000000-0000-4000-8000-000000000009','Kiosk am Markt',     null,     '0381 445566','Glasfaser',          'verloren',     'normal',   null,             'Hat sich für Wettbewerber entschieden.', 'd0000000-0000-4000-8000-000000000003');

insert into public.lead_activities (lead_id, type, content, created_by)
values
  ('e0000000-0000-4000-8000-000000000001','contact','Erstkontakt telefonisch – großes Interesse an FTTH.', 'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000001','note',   'Unterlagen zum Bauträger-Tarif zugeschickt.',          'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000004','note',   'Angebot Pro 1000 inkl. VVL versendet.',                'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000004','contact','Rückruf für nächste Woche vereinbart.',                'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-000000000006','contact','Vertrag unterschrieben übergeben.',                    'd0000000-0000-4000-8000-000000000001');

-- ----------------------------------------------------------------------------
-- (6) Notizen
-- ----------------------------------------------------------------------------
insert into public.notes
  (customer_number, customer_name, title, content, jira_ticket, created_by)
values
  ('K-10234','Müller Haustechnik GmbH','Rückruf Geschäftsführer','Möchte Upgrade auf Premium 1000 für die Filiale besprechen.','TNG-3001','d0000000-0000-4000-8000-000000000001'),
  ('K-12876','TechStart UG','Vertragsverlängerung','Vertrag läuft in ~1 Monat aus – VVL-Angebot vorbereiten.','TNG-2780','d0000000-0000-4000-8000-000000000001'),
  ('K-12001','Nordlicht Café','Standort-Check','Glasfaser liegt an, Hausanschluss muss noch geprüft werden.',null,'d0000000-0000-4000-8000-000000000002'),
  (null,null,'Team-Idee','Sammelaktion für Bestandskunden-VVL im nächsten Monat starten.',null,'d0000000-0000-4000-8000-000000000003');

-- ----------------------------------------------------------------------------
-- (7) Incentives (laufende Team-Aktionen)
-- ----------------------------------------------------------------------------
insert into public.incentives
  (title, mechanic, metric, period, target, reward, active, created_by)
values
  ('Monats-Sprint','goal',        'commission','monthly', 800, 'Tankgutschein 50 €',  true, 'd0000000-0000-4000-8000-000000000001'),
  ('Wochen-Champion','competition','deals',     'weekly',  0,   'Mittagessen aufs Haus', true, 'd0000000-0000-4000-8000-000000000001');

-- ----------------------------------------------------------------------------
-- (8) Kunden-Zuordnung (Owner / geteilt) — für die Kundenliste
-- ----------------------------------------------------------------------------
insert into public.customer_ownerships (customer_number, owner, shared_with)
values
  ('K-10234','d0000000-0000-4000-8000-000000000001','{}'::uuid[]),
  ('K-12001','d0000000-0000-4000-8000-000000000002', array['d0000000-0000-4000-8000-000000000004']::uuid[]),
  ('K-12244','d0000000-0000-4000-8000-000000000003','{}'::uuid[])
on conflict (customer_number) do nothing;

-- ============================================================================
-- Fertig. Im CRM neu laden — Team-Dashboard, Leaderboard, Leads, Berichte
-- und Incentives sind jetzt gefüllt. Demo-Logins: PIN 1234.
-- ============================================================================
