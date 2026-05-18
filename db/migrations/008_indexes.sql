-- Migration 008: fehlende Indizes für häufige Sortierungen und Joins.
-- Idempotent (if not exists) — kann gefahrlos auch auf aktuellen DBs laufen.
-- Im Supabase SQL Editor ausführen.

-- fetchLeads() sortiert nach follow_up_date
create index if not exists idx_leads_follow_up
  on public.leads(follow_up_date);

-- fetchLeadActivities() und der FK-Cascade-Delete profitieren vom lead_id-Index
create index if not exists idx_lead_activities_lead_id
  on public.lead_activities(lead_id);
