-- ============================================================================
-- Migration 025 — Kampagnen: echte Outbound-Call-Typen
-- ============================================================================
-- Die sechs produktiven Kampagnen (Stand August 2026, Gesprächsleitfäden
-- Version 2.0) bekommen eigene Call-Typen, damit die Extension je Kampagne
-- den richtigen Leitfaden und die richtigen Einwandkarten zeigt:
--   churn    — Churn: Widerrufe & Kündigungen (Winback)
--   welcome  — Welcome Calls (Vertragssicherung nach Vertragsabschluss)
--   prl      — Postrückläufer (Adresskorrektur mit Fristwirkung)
--   dupe     — Dubletten-Check (Mehrfachverträge je Adresse)
--   bvw      — Bauverweigerer (Ausbau mit gültigem Vertrag ermöglichen)
--   courtesy — Courtesy Calls (Aktivierungsunterstützung nach Hardwareversand)
-- 'other' bleibt als Fallback für Kampagnen ohne eigenen Leitfaden.
--
-- Im Supabase-Dashboard unter SQL Editor einmal ausführen.
-- ============================================================================

-- Der Check stammt aus Migration 019 (Default-Name campaigns_call_type_check).
-- Bestehende Zeilen bleiben gültig — churn/welcome/other sind weiter erlaubt.
alter table public.campaigns drop constraint if exists campaigns_call_type_check;
alter table public.campaigns
  add constraint campaigns_call_type_check
  check (call_type in ('churn', 'welcome', 'prl', 'dupe', 'bvw', 'courtesy', 'other'));
