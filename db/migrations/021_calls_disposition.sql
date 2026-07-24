-- ============================================================================
-- Migration 021 — Gesprächsergebnis auf calls (Disposition, Kündigungsgrund,
-- Kampagne)
-- ============================================================================
-- Bislang existierten outcome/note/jira_ticket auf calls nur als Spalten
-- (Migration 018), ohne dass ein fester Schreibpfad sie befüllt hat — das
-- Abschluss-Panel der Extension legt stattdessen Note/Lead/Contract/
-- TariffChange-Einträge an. Für eine saubere Save-Rate/Kündigungsgrund-
-- Auswertung im Team-Dashboard braucht es eine strukturierte, kleine
-- Werteliste statt Freitext:
--   disposition:  'gehalten' | 'gekuendigt' | 'rueckruf' | 'kein-interesse' | 'sonstige'
--   cancellation_reason: Freitext, nur sinnvoll befüllt bei disposition='gekuendigt'
--   campaign_id: welche Kampagne lief zum Zeitpunkt des Anrufs (für
--     Kampagnen-Performance-Auswertung, siehe src/lib/callStats.ts)
--
-- Im Supabase-Dashboard unter SQL Editor einmal ausführen.
-- ============================================================================

alter table public.calls
  add column if not exists disposition text
    check (disposition in ('gehalten', 'gekuendigt', 'rueckruf', 'kein-interesse', 'sonstige')),
  add column if not exists cancellation_reason text,
  add column if not exists campaign_id uuid references public.campaigns(id) on delete set null;

create index if not exists idx_calls_campaign on public.calls(campaign_id);
create index if not exists idx_calls_disposition on public.calls(disposition);

-- Bestehende RLS-Policies auf calls (Migration 018/schema.sql) gelten
-- automatisch für die neuen Spalten — keine Policy-Änderung nötig.
