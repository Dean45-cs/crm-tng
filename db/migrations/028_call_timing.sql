-- ============================================================================
-- Migration 028 — Echte Gesprächszeiten und Erreichbarkeit
-- ============================================================================
-- Bis hierher hatte `calls` nur started_at und ended_at, und daraus duration_s.
-- Beides war unschärfer, als es aussah:
--
--   started_at  ist der Moment, in dem myApps den Anruf gemeldet hat — also das
--               KLINGELN, nicht das Gespräch.
--   ended_at    stand, wenn jemand im Cockpit „Aufgelegt" gedrückt hat, wenn der
--               nächste Anruf begann, oder nach zwei Stunden Zwangsende.
--
-- In duration_s steckte damit Klingelzeit, Nachdenkzeit und im schlimmsten Fall
-- eine ganze vergessene Stunde. Jede Durchschnittsdauer darauf war eine Zahl mit
-- Nachkommastellen und ohne Bedeutung.
--
-- Die Erkennung am Medien-Socket (desktop/main/media-watch.js) liefert beide
-- Ränder echt: die Sprachverbindung entsteht beim ABHEBEN und verschwindet beim
-- AUFLEGEN. Diese Migration schafft den Platz, das auch aufzuschreiben.
--
-- Im Supabase-Dashboard unter SQL Editor einmal ausführen.
-- ============================================================================

alter table public.calls
  -- Wann tatsächlich abgehoben wurde. NULL heißt: nicht beobachtet — entweder
  -- weil nicht abgenommen wurde, oder weil die Erkennung auf diesem Rechner
  -- nicht greift. Welches von beidem, sagt `answered`.
  add column if not exists connected_at timestamptz,

  -- DIE WICHTIGE SPALTE, und der Grund, warum sie drei Zustände hat statt zwei:
  --
  --   true   Es wurde abgehoben. Sicher, weil eine Sprachverbindung entstand.
  --   false  Es wurde NICHT abgehoben. Ebenfalls sicher — die Erkennung hat
  --          während dieses Anrufs gemessen und nie eine Verbindung gesehen.
  --   NULL   Unbekannt. Es wurde gar nicht gemessen (andere Plattform, App
  --          neu gestartet, lsof nicht verfügbar).
  --
  -- Ein zweiwertiges boolean hätte „nicht abgenommen" und „nicht hingesehen"
  -- in denselben Topf geworfen, und die Erreichbarkeitsquote wäre in dem Maß
  -- zu schlecht ausgefallen, wie die Erkennung ausfällt — leise und in die
  -- falsche Richtung. Der Nenner jeder Erreichbarkeitszahl ist deshalb
  -- ausdrücklich `answered is not null`, nicht `count(*)`.
  add column if not exists answered boolean,

  -- Woran das Ende erkannt wurde: 'aufgelegt-erkannt' (Medien-Socket),
  -- 'von-hand' (Knopf im Cockpit), 'naechster-anruf', 'gesperrt',
  -- 'ruhezustand', 'grenze' (Zwangsende nach zwei Stunden), 'anlage' (ev=end).
  --
  -- BEWUSST OHNE check-constraint, anders als disposition in Migration 021.
  -- Diese Spalte ist Diagnose, kein Steuerwert — sie sagt, welchen Dauern man
  -- trauen darf. Ein unbekannter Wert darf niemals dazu führen, dass das PATCH
  -- fehlschlägt und dadurch ausgerechnet ended_at nicht geschrieben wird. Eine
  -- Datenqualitäts-Spalte, die Daten verhindert, wäre die schlechteste aller
  -- Möglichkeiten.
  add column if not exists end_reason text,

  -- Wann das Gesprächsergebnis erfasst wurde. Zusammen mit ended_at ergibt das
  -- die Nachbearbeitungszeit und damit AHT = Gespräch + Nachbearbeitung.
  add column if not exists disposition_at timestamptz;

-- Für die Erreichbarkeitsauswertung: nur die Anrufe, bei denen überhaupt
-- gemessen wurde. Partiell, weil alle Altbestände NULL sind und dort nichts zu
-- indizieren ist.
create index if not exists idx_calls_answered
  on public.calls(started_at, answered) where answered is not null;

-- Bestehende RLS-Policies auf calls (Migration 018) gelten automatisch für die
-- neuen Spalten — keine Policy-Änderung nötig.
