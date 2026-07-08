-- ============================================================================
-- Migration 015 — Profile automatisch anlegen (Trigger auf auth.users)
-- ============================================================================
-- Im Supabase-Dashboard unter SQL Editor ausführen (nach 014).
--
-- PROBLEM: Bisher legte der Client das Profil in public.users NACH dem signUp
-- selbst an — und zwar als der frisch angemeldete neue Nutzer, weil die Policy
-- "users insert own" nur `auth.uid() = id` erlaubt. Das ist fragil:
--   • Ist die E-Mail-Bestätigung an (oder kommt keine Session zurück), läuft der
--     Insert ohne passende Session → "new row violates row-level security policy
--     for table users". Der Auth-Account ist dann aber schon angelegt.
--   • Beim nächsten Versuch meldet signUp "already registered", ein Profil fehlt
--     aber weiterhin → die Person taucht nirgends auf.
--
-- LÖSUNG (Standard-Supabase-Muster): Ein SECURITY-DEFINER-Trigger auf
-- auth.users legt das Profil serverseitig an, sobald ein Auth-Konto entsteht —
-- unabhängig von Session, RLS oder E-Mail-Bestätigung. Der Client muss das
-- Profil nicht mehr selbst einfügen.
--
-- Zusätzlich werden bereits verwaiste Auth-User (Konten ohne Profil aus
-- fehlgeschlagenen Versuchen) einmalig nachgetragen, damit sie wieder auftauchen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Trigger-Funktion: legt zu jedem neuen auth.users-Eintrag ein Profil an.
-- SECURITY DEFINER → läuft mit Owner-Rechten und umgeht damit die RLS-Policy
-- "users insert own". Der Anzeige-Name kommt aus den signUp-Metadaten, der
-- normalisierte `key` ebenfalls (Fallback: aus Name bzw. E-Mail abgeleitet).
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display text;
  v_key text;
begin
  v_display := coalesce(
    nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
    split_part(new.email, '@', 1)
  );
  v_key := coalesce(
    nullif(trim(new.raw_user_meta_data->>'key'), ''),
    lower(v_display)
  );

  begin
    insert into public.users (id, key, display_name)
    values (new.id, v_key, v_display)
    on conflict (id) do nothing;
  exception
    when unique_violation then
      -- `key` bereits vergeben: mit kurzem UUID-Kürzel eindeutig machen, damit
      -- der Auth-Insert nicht scheitert.
      insert into public.users (id, key, display_name)
      values (new.id, v_key || '-' || left(new.id::text, 8), v_display)
      on conflict (id) do nothing;
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- Backfill: verwaiste Auth-User (ohne public.users-Profil) einmalig nachtragen.
-- Läuft im SQL-Editor mit erhöhten Rechten, RLS greift hier nicht.
-- `on conflict do nothing` überspringt sowohl id- als auch key-Kollisionen.
-- ----------------------------------------------------------------------------
insert into public.users (id, key, display_name)
select
  u.id,
  coalesce(
    nullif(lower(trim(u.raw_user_meta_data->>'display_name')), ''),
    lower(split_part(u.email, '@', 1))
  ),
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'display_name'), ''),
    split_part(u.email, '@', 1)
  )
from auth.users u
left join public.users p on p.id = u.id
where p.id is null
on conflict do nothing;
