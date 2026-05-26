-- ============================================================================
-- 013_customer_access_requests.sql
-- ============================================================================
-- Kunden sind ab jetzt für alle aktiven Nutzer lesbar (Ansicht). Bearbeiten
-- bleibt an Rechte gebunden (Besitzer:in, geteilt oder Chef:in). Wer keine
-- Bearbeitungsrechte hat, kann sie mit Begründung anfragen; der/die Besitzer:in
-- (oder ein:e Chef:in) nimmt an oder lehnt ab.
-- Im SQL Editor ausführen (nur nötig, wenn das Schema vor diesem Update kam).
-- ============================================================================

create table if not exists public.customer_access_requests (
  id uuid primary key default gen_random_uuid(),
  customer_number text not null,
  requester_id uuid not null references public.users(id) on delete cascade,
  owner_id uuid references public.users(id) on delete set null,
  comment text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz default now(),
  decided_at timestamptz,
  decided_by uuid references public.users(id) on delete set null
);

create index if not exists idx_access_req_owner on public.customer_access_requests(owner_id);
create index if not exists idx_access_req_requester on public.customer_access_requests(requester_id);
-- Pro Kunde nur eine offene Anfrage je Anfragenden.
create unique index if not exists uniq_pending_access_request
  on public.customer_access_requests (customer_number, requester_id)
  where status = 'pending';

alter table public.customer_access_requests enable row level security;

-- Lesen: Anfragende:r, betroffene:r Besitzer:in und Chef:innen.
create policy "access_req read involved" on public.customer_access_requests
  for select using (
    public.auth_is_active()
    and (requester_id = auth.uid() or owner_id = auth.uid() or public.auth_is_manager())
  );
-- Anlegen: nur für sich selbst.
create policy "access_req insert own" on public.customer_access_requests
  for insert with check (public.auth_is_active() and requester_id = auth.uid());
-- Entscheiden (annehmen/ablehnen): Besitzer:in oder Chef:in.
create policy "access_req decide owner or manager" on public.customer_access_requests
  for update using (
    public.auth_is_active()
    and (owner_id = auth.uid() or public.auth_is_manager())
  );

-- Damit Chef:innen Freigaben auch für fremde Kunden verwalten können
-- (z.B. beim Annehmen einer Anfrage), darf jetzt auch ein:e Manager:in die
-- Kunden-Zuordnung ändern.
drop policy if exists "ownership update owner" on public.customer_ownerships;
create policy "ownership update owner or manager" on public.customer_ownerships
  for update using (public.auth_is_active() and (auth.uid() = owner or public.auth_is_manager()));

alter publication supabase_realtime add table public.customer_access_requests;
