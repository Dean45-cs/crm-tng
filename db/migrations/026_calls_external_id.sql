-- ============================================================================
-- Migration 026 — calls.external_id (Anruf-Kennung der Telefonanlage)
-- ============================================================================
-- Im Supabase-Dashboard unter SQL Editor ausführen (nach 025).
--
-- Hintergrund: Anrufe kommen ab jetzt nicht mehr nur aus timio (dort liest
-- extension/src/timio-content.js den Bildschirm), sondern auch aus myApps
-- (innovaphone). myApps meldet einen Anruf über eine hinterlegte Webadresse und
-- setzt dabei Platzhalter ein — darunter $c, die „Conference ID (globale ID für
-- den Anruf)". Das ist eine stabile Kennung pro Gespräch, und sie ist der
-- Grund, warum diese Spalte existiert:
--
--   1. Meldet myApps dasselbe Gespräch mehrfach (je nach eingerichteter
--      Aktion durchaus möglich), entstünde sonst jedes Mal eine neue Zeile.
--      Der eindeutige Index unten macht daraus einen Konflikt statt eines
--      stillen Duplikats.
--   2. Sollten die Verbindungsdatensätze der Anlage später doch noch dazu-
--      kommen, ist das die Spalte, über die sich beides zusammenführen lässt.
--
-- Bewusst nullable und ohne Vorgabe: Anrufe aus timio haben keine solche
-- Kennung und sollen sie auch nicht bekommen. Der Index ist deshalb partiell —
-- er greift nur, wo tatsächlich eine Kennung steht, sonst kollidierten alle
-- timio-Zeilen miteinander.
-- ============================================================================

alter table public.calls
  add column if not exists external_id text;

comment on column public.calls.external_id is
  'Kennung des Gesprächs in der Telefonanlage (myApps/innovaphone: Conference-ID $c). Null für Anrufe aus timio.';

create unique index if not exists idx_calls_external_id
  on public.calls(external_id)
  where external_id is not null;
