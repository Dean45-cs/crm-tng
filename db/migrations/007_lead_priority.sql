-- Migration 007: Dringlichkeit für Leads
-- Ausführen im Supabase SQL Editor vor dem Deployment.

alter table public.leads
  add column if not exists priority text not null default 'normal'
    check (priority in ('normal', 'hoch', 'dringend'));
