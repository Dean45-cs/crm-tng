-- ============================================================================
-- Migration 012 — Selbst-Registrierung abschaffen, Konten verwaltet der Chef
-- ============================================================================
-- Im Supabase-Dashboard unter SQL Editor ausführen (nach 011).
--
-- Fachlich: Mitarbeitende legen keine Konten mehr selbst an. Der Chef (Rolle
-- 'manager') erstellt neue Zugänge in der Team-Verwaltung. Lediglich das
-- ALLERERSTE Konto darf sich im Bootstrap selbst anlegen und wird automatisch
-- zum ersten Manager — danach ist die Selbst-Registrierung in der App zu.
--
-- Damit das App-seitig erkennbar ist (ein nicht angemeldeter Client darf
-- public.users wegen RLS nicht lesen), liefert users_exist() nur ein Boolean.
--
-- Außerdem wird der Privilege-Trigger aus 011 verfeinert: Solange noch KEIN
-- Manager existiert, darf der erste Account sich selbst zum Manager machen
-- (Bootstrap). Sobald ein Manager existiert, ist die Rollenänderung wieder nur
-- Managern (bzw. dem service_role / SQL-Editor) vorbehalten.
--
-- HINWEIS: Damit der Chef Konten anlegen kann, müssen in Supabase unter
-- Authentication → Sign In / Providers die "User Signups" AKTIVIERT bleiben.
-- Die Sperre der Selbst-Registrierung erfolgt in der App.
-- ============================================================================

-- Existiert mindestens ein Nutzerprofil? (für den Bootstrap-Check, anon-lesbar)
create or replace function public.users_exist()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.users);
$$;

grant execute on function public.users_exist() to anon, authenticated;

-- Privilege-Trigger verfeinern: erster Manager-Bootstrap erlaubt.
create or replace function public.prevent_user_privilege_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role
      or new.is_active is distinct from old.is_active
      or new.key is distinct from old.key
      or new.id is distinct from old.id)
     and auth.uid() is not null                              -- service_role / SQL-Editor darf
     and not public.auth_is_manager()                        -- Manager dürfen
     and exists (select 1 from public.users where role = 'manager') then  -- Bootstrap-Ausnahme
    raise exception 'Nicht erlaubt: Rolle, Status oder Schlüssel dürfen nur von Manager:innen geändert werden.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
