-- Migration 010: Datenschutzhinweis-Zustimmung (Art. 13 DSGVO Information)
-- Ausführen im Supabase SQL Editor vor dem Deployment.
--
-- consent_given_at = null → Nutzer hat den Datenschutzhinweis noch nicht
-- bestätigt; die App zeigt dann das Hinweis-Modal beim ersten Login.
-- Bestehende Nutzer bleiben null und sehen den Hinweis einmalig.

alter table public.users
  add column if not exists consent_given_at timestamptz;
