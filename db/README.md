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
- Tabellen: `users`, `contracts`, `tariff_changes`, `notes`, `customer_ownerships`, `user_settings`, `shared_settings`
- Row-Level-Security: alle authentifizierten User lesen, jeder schreibt seine eigenen Daten
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
         public.shared_settings restart identity;
delete from auth.users;  -- löscht auch public.users via cascade
```
