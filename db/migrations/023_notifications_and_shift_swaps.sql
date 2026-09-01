-- ============================================================================
-- Migration 023 — Postfach (notifications) & Schichttausch (shift_swap_requests)
-- ============================================================================
-- Zwei zusammengehörige Bausteine:
--
--   1. `notifications` — das persönliche Postfach. Eine Zeile = eine Meldung an
--      genau eine Person. Bewusst privat (nur der Empfänger liest), anders als
--      shifts/campaigns: hier steht, was MICH betrifft, nicht was das Team tut.
--
--   2. `shift_swap_requests` — Schichttausch zwischen zwei Agent:innen. Der
--      Plan bleibt Chef-Sache (siehe Migration 020), aber der Anstoß kommt aus
--      dem Team: A fragt B, B nimmt an, der Chef bestätigt. Erst die
--      Bestätigung fasst `shifts` an — und zwar ausschließlich über die
--      Funktion apply_shift_swap() weiter unten.
--
-- Warum eine SECURITY-DEFINER-Funktion und keine direkten Policies:
-- `shifts` ist für Agent:innen schreibgeschützt, und das soll so bleiben. Ein
-- Tausch ist aber genau eine Schreiboperation auf zwei Zeilen, die atomar sein
-- muss (sonst steht der Plan bei einem Fehler in der Mitte). Die Funktion ist
-- die einzige Stelle, die diese Ausnahme macht, prüft selbst auf Chef-Rechte
-- und akzeptiert nur Anfragen, die der Partner bereits angenommen hat.
--
-- Daraus folgt auch, warum die update-Policy auf shift_swap_requests großzügig
-- sein darf: selbst wer den Status von Hand auf 'approved' setzt, verschiebt
-- damit keine einzige Schicht — den Tausch führt allein die Funktion aus, und
-- die fragt auth_is_manager() erneut.
--
-- Im Supabase-Dashboard unter SQL Editor einmal ausführen (idempotent).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Postfach
-- ----------------------------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  -- Empfänger:in. Nicht der Auslöser — die Zeile gehört dem, der sie liest.
  user_id uuid not null references public.users(id) on delete cascade,
  -- Fachliche Art ('shift-changed', 'swap-requested', …). Bewusst freier Text
  -- statt enum: neue Meldungsarten sollen ohne Migration dazukommen können,
  -- und eine unbekannte Art zeigt die App als neutrale Meldung an.
  kind text not null,
  title text not null,
  body text,
  -- Sprungziel in der App, z. B. {"route":"schedule"} oder
  -- {"route":"customer","kdnr":"12345"}. jsonb, damit je Route eigene
  -- Parameter möglich sind, ohne die Tabelle zu ändern.
  link jsonb,
  actor_id uuid references public.users(id) on delete set null,
  -- Name zum Zeitpunkt der Meldung: das Postfach soll auch dann lesbar
  -- bleiben, wenn das Konto später deaktiviert oder umbenannt wird.
  actor_name text,
  -- Verweis auf den auslösenden Datensatz (z. B. shift_swap_requests.id).
  -- Absichtlich ohne FK: die Meldung überlebt das Löschen ihres Auslösers.
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_created
  on public.notifications(user_id, created_at desc);
-- Teilindex für den Ungelesen-Zähler: der läuft bei jedem Laden und trifft
-- nur den kleinen ungelesenen Rest, nicht die ganze Historie.
create index if not exists idx_notifications_unread
  on public.notifications(user_id) where read_at is null;

alter table public.notifications enable row level security;

-- Lesen/Ändern/Löschen: ausschließlich der Empfänger. Auch Chefs sehen fremde
-- Postfächer nicht — hier stehen persönliche Hinweise, keine Teamdaten.
drop policy if exists "notifications read own" on public.notifications;
create policy "notifications read own" on public.notifications
  for select using (auth.uid() = user_id);

-- Schreiben darf jede:r Aktive, aber nur im eigenen Namen: actor_id muss die
-- eigene ID sein. Damit kann A dem B eine Tauschanfrage ins Postfach legen,
-- ohne dass sich jemand als jemand anderes ausgeben kann.
drop policy if exists "notifications insert active" on public.notifications;
create policy "notifications insert active" on public.notifications
  for insert with check (public.auth_is_active() and auth.uid() = actor_id);

-- Ändern heißt in der Praxis nur „als gelesen markieren".
drop policy if exists "notifications update own" on public.notifications;
create policy "notifications update own" on public.notifications
  for update using (auth.uid() = user_id);

drop policy if exists "notifications delete own" on public.notifications;
create policy "notifications delete own" on public.notifications
  for delete using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 2. Schichttausch
-- ----------------------------------------------------------------------------

create table if not exists public.shift_swap_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.users(id) on delete cascade,
  requester_date date not null,
  partner_id uuid not null references public.users(id) on delete cascade,
  partner_date date not null,
  message text,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'approved', 'rejected')),
  -- Momentaufnahme der beiden Schichten beim Anlegen. Der Plan kann sich bis
  -- zur Bestätigung ändern; ohne diese Kopie stünde in der Anfrage später
  -- etwas anderes, als beim Fragen gemeint war. Nur Anzeige — getauscht wird
  -- immer der tatsächliche Stand (siehe apply_shift_swap).
  requester_shift_type text,
  partner_shift_type text,
  decided_at timestamptz,
  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  -- Ein Tausch braucht zwei Personen; mit sich selbst tauscht man nicht.
  constraint shift_swap_distinct_users check (requester_id <> partner_id)
);

create index if not exists idx_swap_status on public.shift_swap_requests(status);
create index if not exists idx_swap_partner on public.shift_swap_requests(partner_id, status);
create index if not exists idx_swap_requester on public.shift_swap_requests(requester_id, status);
create index if not exists idx_swap_dates on public.shift_swap_requests(requester_date, partner_date);

alter table public.shift_swap_requests enable row level security;

-- Lesen: alle aktiven Nutzer — wie beim Plan selbst (Migration 020). Nur so
-- kann der Schichtplan an der Zelle anzeigen „für diesen Tag läuft schon eine
-- Anfrage", statt zwei Leute dieselbe Schicht doppelt vergeben zu lassen.
drop policy if exists "swap read all" on public.shift_swap_requests;
create policy "swap read all" on public.shift_swap_requests
  for select using (public.auth_is_active());

-- Anlegen nur im eigenen Namen.
drop policy if exists "swap insert own" on public.shift_swap_requests;
create policy "swap insert own" on public.shift_swap_requests
  for insert with check (public.auth_is_active() and auth.uid() = requester_id);

-- Ändern: die beiden Beteiligten (annehmen/ablehnen/zurückziehen) und Chefs
-- (bestätigen/ablehnen). Welcher Statuswechsel erlaubt ist, entscheidet die
-- App — die Policy kann Übergänge nicht unterscheiden. Unkritisch, weil ein
-- gefälschter Status nichts bewirkt: Schichten bewegt nur apply_shift_swap().
drop policy if exists "swap update involved" on public.shift_swap_requests;
create policy "swap update involved" on public.shift_swap_requests
  for update using (
    public.auth_is_active()
    and (auth.uid() = requester_id or auth.uid() = partner_id or public.auth_is_manager())
  );

drop policy if exists "swap delete own or manager" on public.shift_swap_requests;
create policy "swap delete own or manager" on public.shift_swap_requests
  for delete using (auth.uid() = requester_id or public.auth_is_manager());

-- ----------------------------------------------------------------------------
-- 3. Den Tausch ausführen
-- ----------------------------------------------------------------------------
-- Vertauscht die beiden Schichten und setzt die Anfrage auf 'approved' — alles
-- in einer Transaktion, damit der Plan nie halb getauscht dasteht.
--
-- SECURITY DEFINER, weil `shifts` für Agent:innen schreibgeschützt ist. Die
-- Rechteprüfung passiert deshalb hier von Hand, gleich als Erstes.
create or replace function public.apply_shift_swap(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.shift_swap_requests;
  a public.shifts;  -- Schicht der anfragenden Person
  b public.shifts;  -- Schicht der Partner:in
begin
  if not public.auth_is_manager() then
    raise exception 'Nur Chefs können einen Schichttausch bestätigen.'
      using errcode = '42501';
  end if;

  -- for update: zwei gleichzeitige Bestätigungen derselben Anfrage würden
  -- sonst beide den Statuscheck passieren und zweimal tauschen (= Rücktausch).
  select * into req from public.shift_swap_requests where id = p_request_id for update;
  if not found then
    raise exception 'Tauschanfrage nicht gefunden.' using errcode = 'P0002';
  end if;
  if req.status <> 'accepted' then
    raise exception 'Nur angenommene Anfragen können bestätigt werden (Status: %).', req.status
      using errcode = 'P0001';
  end if;

  select * into a from public.shifts
    where user_id = req.requester_id and shift_date = req.requester_date;
  select * into b from public.shifts
    where user_id = req.partner_id and shift_date = req.partner_date;

  -- Erst beide Zeilen weg, dann neu setzen: ein direktes Update liefe bei
  -- gleichem Tag in den unique(user_id, shift_date)-Konflikt.
  delete from public.shifts
    where user_id = req.requester_id and shift_date = req.requester_date;
  delete from public.shifts
    where user_id = req.partner_id and shift_date = req.partner_date;

  -- Eine Seite ohne Schicht ist erlaubt und heißt „übernimm meinen Tag, ich
  -- habe an deinem frei": dann bleibt die Gegenseite eben leer.
  if a.id is not null then
    insert into public.shifts (user_id, shift_date, shift_type, campaign_id, updated_at)
    values (req.partner_id, req.partner_date, a.shift_type, a.campaign_id, now());
  end if;
  if b.id is not null then
    insert into public.shifts (user_id, shift_date, shift_type, campaign_id, updated_at)
    values (req.requester_id, req.requester_date, b.shift_type, b.campaign_id, now());
  end if;

  update public.shift_swap_requests
     set status = 'approved',
         approved_by = auth.uid(),
         approved_at = now()
   where id = p_request_id;
end;
$$;

grant execute on function public.apply_shift_swap(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Realtime
-- ----------------------------------------------------------------------------
-- Ohne Realtime wäre das Postfach ein Postfach, das man selbst aufmachen muss —
-- eine Push-Meldung soll aber ankommen, während man woanders arbeitet.
-- Nur ergänzen, wenn noch nicht Mitglied (Re-Run-fest, wie Migration 020/022).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shift_swap_requests'
  ) then
    alter publication supabase_realtime add table public.shift_swap_requests;
  end if;
end $$;
