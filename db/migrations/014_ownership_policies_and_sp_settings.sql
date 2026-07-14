-- ============================================================================
-- Migration 014 — Ownership-Policies reparieren + SharePoint-Einstellungen
-- ============================================================================
-- Im Supabase-Dashboard unter SQL Editor einmal ausführen (nach 013).
--
-- Behebt drei Fehler:
--
--  1) BESITZ-ÜBERTRAGUNG WAR KAPUTT: Die Update-Policy auf
--     customer_ownerships hatte keine eigene WITH-CHECK-Klausel. Postgres
--     wendet dann die USING-Bedingung (auth.uid() = owner) auch auf die NEUE
--     Zeile an — eine Besitzer:in, die ihren Kunden an eine:n Kolleg:in
--     übertragen wollte (owner wechselt auf die andere UUID), bekam deshalb
--     einen RLS-Fehler. Nur Manager:innen konnten übertragen.
--     Jetzt: USING prüft weiterhin, WER ändern darf (Besitzer:in/Manager:in),
--     WITH CHECK erlaubt der berechtigten Person das Setzen eines neuen Owners.
--
--  2) DSGVO-PURGE DURCH CHEFS UNVOLLSTÄNDIG: Die Delete-Policy erlaubte nur
--     der Besitzer:in das Löschen der Ownership-Zeile. Löschte ein:e Chef:in
--     alle Daten eines fremden Kunden (Recht auf Vergessenwerden), blieb die
--     Ownership-Zeile mit der Kundennummer stehen (RLS filtert still).
--     Jetzt dürfen auch Manager:innen löschen.
--
--  3) SHAREPOINT-KONFIG GING VERLOREN: Die App speichert pro Nutzer:in den
--     Excel-Dateipfad und das Tabellenblatt für den SharePoint-Export — die
--     Spalten dafür fehlten aber in user_settings, die Werte waren nach jedem
--     Neuladen weg. Jetzt gibt es sp_file_path und sp_sheet_name.
-- ============================================================================

-- ---------- 1) + 2) customer_ownerships-Policies ----------
drop policy if exists "ownership update owner or manager" on public.customer_ownerships;
create policy "ownership update owner or manager" on public.customer_ownerships
  for update
  using (public.auth_is_active() and (auth.uid() = owner or public.auth_is_manager()))
  with check (public.auth_is_active());

drop policy if exists "ownership delete owner" on public.customer_ownerships;
drop policy if exists "ownership delete owner or manager" on public.customer_ownerships;
create policy "ownership delete owner or manager" on public.customer_ownerships
  for delete using (public.auth_is_active() and (auth.uid() = owner or public.auth_is_manager()));

-- ---------- 3) SharePoint-Spalten in user_settings ----------
alter table public.user_settings
  add column if not exists sp_file_path text default '';
alter table public.user_settings
  add column if not exists sp_sheet_name text default 'Tabelle1';
