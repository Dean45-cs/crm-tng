# Supabase Setup für TNG Stadtnetz CRM

Die App läuft online über Supabase als Backend. Einmalige Einrichtung:

## 1. Supabase-Projekt anlegen

1. [supabase.com/dashboard](https://supabase.com/dashboard) öffnen
2. „New project" → Name, Passwort (für DB-Admin), Region (Frankfurt empfohlen)
3. Warten, bis das Projekt fertig provisioniert ist (~1 min)

## 2. Schema einspielen

1. Im Projekt: **SQL Editor** → **+ New query**
2. Inhalt von [`schema.sql`](./schema.sql) komplett reinkopieren
3. **Run** klicken — sollte ohne Fehler durchlaufen

Erzeugt:
- Tabellen: `users`, `contracts`, `tariff_changes`, `notes`, `customer_ownerships`, `user_settings`, `shared_settings`, `incentives`
- Row-Level-Security: alle aktiven User lesen, jeder schreibt seine eigenen Daten;
  gesperrte Nutzer haben keinen Datenzugriff, Rollen sind escalation-sicher
- Realtime-Publikationen, damit Änderungen live an alle Clients gehen

## 2a. Migrationen (für bereits laufende Projekte)

Wurde das Schema schon vor einem Update eingespielt, müssen die Dateien im
Ordner [`migrations/`](./migrations/) **in numerischer Reihenfolge** im SQL
Editor nachgezogen werden. Frische Projekte aus `schema.sql` enthalten alles
bereits — Migrationen sind dann nicht nötig.

- `001_tighten_rls.sql` — verschärft die RLS: Bearbeiten/Löschen von Verträgen,
  Tarifwechseln und Notizen nur noch für Ersteller oder Kunden-Owner.
- `002_chef_modus.sql` — fügt Rollen (`agent`/`manager`) und den Sperr-Status
  hinzu und gibt Chefs erweiterte Lese-/Schreibrechte.
- `003_incentives.sql` — legt die Tabelle `incentives` an (Team-Ziele mit
  Belohnung); anlegen/ändern nur für Chefs, lesen für alle.
- `004_contracts_laufzeit.sql` — Laufzeit-Feld (12/24 Monate) für Verträge.
- `005_leads.sql` — Tabelle `leads` für die Vertriebs-Pipeline.
- `006_lead_activities.sql` — Aktivitäts-Log pro Lead.
- `007_lead_priority.sql` — Dringlichkeit (`normal`/`hoch`/`dringend`) für Leads.
- `008_indexes.sql` — zusätzliche Indizes für Performance.
- `009_audit_log.sql` — unveränderliches Audit-Log (DSGVO Art. 30).
- `010_user_consent.sql` — Spalte für die Datenschutzhinweis-Zustimmung.
- `011_security_hardening.sql` — **wichtig:** verhindert Privilege-Escalation
  (Nutzer können sich nicht mehr selbst zum Manager machen) und sperrt
  deaktivierte Nutzer (`is_active = false`) serverseitig vom Datenzugriff aus.
- `012_account_management.sql` — Selbst-Registrierung wird abgeschafft: Konten
  legt nur noch der Chef in der Team-Verwaltung an. Lediglich das allererste
  Konto darf sich im Bootstrap selbst anlegen und wird automatisch zum ersten
  Manager. `users_exist()` erlaubt dem Login-Screen, diesen Bootstrap zu erkennen.
- `013_customer_access_requests.sql` — Kunden sind für alle aktiven Nutzer
  lesbar; Bearbeiten bleibt an Rechte gebunden (Besitzer:in / geteilt / Chef:in).
  Neue Tabelle `customer_access_requests`: wer keine Rechte hat, fragt sie mit
  Begründung an, Besitzer:in oder Chef:in nimmt an oder lehnt ab.

> **Erster Zugang (frische Installation):** Beim allerersten Start bietet der
> Login-Screen automatisch „Erstes Konto einrichten" an — dieses Konto wird der
> erste Chef. Alle weiteren Konten legt der Chef unter **Team-Verwaltung →
> Neues Konto** an. Alternativ lässt sich der erste Manager per SQL setzen:
> ```sql
> update public.users set role = 'manager' where key = '<name-klein-geschrieben>';
> ```
>
> **Wichtig:** Die „User Signups" müssen in Supabase unter **Authentication →
> Sign In / Providers** AKTIVIERT bleiben — der Chef legt Konten technisch per
> Signup an; die Sperre der Selbst-Registrierung erfolgt in der App.

## 3. Email-Bestätigung deaktivieren

Wichtig — die App nutzt PIN-Login mit synthetischen Emails (`name@crm.tng.local`),
die nie eine echte Mail kriegen:

1. **Authentication** → **Providers** → **Email**
2. „Confirm email" auf **OFF**
3. Speichern

## 4. Keys ins CRM eintragen

1. **Project Settings** → **API**
2. **Project URL** kopieren → erste Eingabe im CRM Setup-Screen
3. **anon public** Key kopieren → zweite Eingabe

Fertig — alle User können sich jetzt mit Name + PIN registrieren und sehen
dieselben Daten live synchron.

## Daten zurücksetzen (Notfall)

Im SQL Editor:

```sql
truncate public.contracts, public.tariff_changes, public.notes,
         public.customer_ownerships, public.user_settings,
         public.shared_settings, public.incentives restart identity;
delete from auth.users;  -- löscht auch public.users via cascade
```

## Demo-/Präsentationsdaten

Zum Vorführen (Mitarbeiter mit Umsatz, Verträge, Leads, Incentives) gibt es
[`seed_demo.sql`](./seed_demo.sql). Im SQL Editor komplett ausführen — das
Skript legt vier Demo-Mitarbeiter (Anna Becker, Tom Fischer, Lena Wagner,
Jonas Schmidt, PIN **1234**) samt gefüllten Team-Dashboards, Leaderboard,
Leads und Berichten an. Es räumt vorher alte Demo-Daten weg, ist also beliebig
oft wiederholbar. Zum Entfernen genügt der Abschnitt „(1) Aufräumen" im Skript.

