-- ============================================================================
-- Migration 004 — Vertragslaufzeit
-- ============================================================================
-- Ergänzt die Spalte `laufzeit_monate` an der contracts-Tabelle.
-- Erlaubte Werte: 12, 24 oder NULL (= unbefristet / kein Ablaufdatum).
-- Bestehende Zeilen behalten NULL und erscheinen nicht im Auslauf-Radar.
--
-- Im Supabase-Dashboard unter SQL Editor einmal ausführen.

alter table public.contracts
  add column if not exists laufzeit_monate integer
    check (laufzeit_monate in (12, 24));
