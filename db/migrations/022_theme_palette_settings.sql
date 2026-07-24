-- ============================================================================
-- Migration 022 — Theme & Palette in user_settings (Cross-Surface-Sync, Tier 3)
-- ============================================================================
-- Hebt die persönliche Optik (Hell/Dunkel-Präferenz + Farb-Palette) von rein
-- geräte-lokalem localStorage auf die geteilte Wahrheit: so ist sie über alle
-- Sessions/Geräte des Users hinweg konsistent und dank Realtime sofort. Die
-- CRM-Web-App nutzt localStorage weiterhin als schnellen Cache (Sofort-Paint
-- beim Kaltstart), Supabase ist die Quelle der Wahrheit.
--
-- Bewusst NUR zwei nullable Spalten, keine Pflichtwerte — ein fehlender Wert
-- bedeutet „noch nie gesetzt" und wird beim ersten Login mit dem lokalen Stand
-- geseedet.
--
-- Im Supabase-Dashboard unter SQL Editor einmal ausführen (idempotent).
-- ============================================================================

alter table public.user_settings
  add column if not exists theme_pref text;
alter table public.user_settings
  add column if not exists palette jsonb;

-- Realtime, damit eine Theme-/Palette-Änderung auf einem Gerät/Tab auf den
-- anderen sofort ankommt. Nur ergänzen, wenn noch nicht Mitglied (Re-Run-fest).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_settings'
  ) then
    alter publication supabase_realtime add table public.user_settings;
  end if;
end $$;
