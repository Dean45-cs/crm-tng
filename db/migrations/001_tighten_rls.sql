-- ============================================================================
-- Migration 001 — RLS verschärfen
-- ============================================================================
-- Vorher durften ALLE authentifizierten Nutzer fremde Verträge, Tarifwechsel
-- und Notizen bearbeiten und löschen (auth.role() = 'authenticated').
--
-- Danach: Bearbeiten/Löschen nur für den Ersteller (created_by) oder den
-- Owner/Co-Owner des zugehörigen Kunden (customer_ownerships).
--
-- Im Supabase-Dashboard unter SQL Editor einmal ausführen.
--
-- Hinweis: Alt-Datensätze mit created_by = null sind danach nur noch über
-- eine Kunden-Ownership editierbar.
-- ============================================================================

-- ---------- CONTRACTS ----------
drop policy if exists "contracts update own" on public.contracts;
drop policy if exists "contracts delete own" on public.contracts;

create policy "contracts update own" on public.contracts
  for update using (
    auth.uid() = created_by
    or exists (
      select 1 from public.customer_ownerships o
      where o.customer_number = contracts.customer_number
        and (o.owner = auth.uid() or auth.uid() = any(o.shared_with))
    )
  );
create policy "contracts delete own" on public.contracts
  for delete using (
    auth.uid() = created_by
    or exists (
      select 1 from public.customer_ownerships o
      where o.customer_number = contracts.customer_number
        and (o.owner = auth.uid() or auth.uid() = any(o.shared_with))
    )
  );

-- ---------- TARIFF CHANGES ----------
drop policy if exists "tariff update all" on public.tariff_changes;
drop policy if exists "tariff delete all" on public.tariff_changes;
drop policy if exists "tariff update own" on public.tariff_changes;
drop policy if exists "tariff delete own" on public.tariff_changes;

create policy "tariff update own" on public.tariff_changes
  for update using (
    auth.uid() = created_by
    or exists (
      select 1 from public.customer_ownerships o
      where o.customer_number = tariff_changes.customer_number
        and (o.owner = auth.uid() or auth.uid() = any(o.shared_with))
    )
  );
create policy "tariff delete own" on public.tariff_changes
  for delete using (
    auth.uid() = created_by
    or exists (
      select 1 from public.customer_ownerships o
      where o.customer_number = tariff_changes.customer_number
        and (o.owner = auth.uid() or auth.uid() = any(o.shared_with))
    )
  );

-- ---------- NOTES ----------
drop policy if exists "notes update all" on public.notes;
drop policy if exists "notes delete all" on public.notes;
drop policy if exists "notes update own" on public.notes;
drop policy if exists "notes delete own" on public.notes;

create policy "notes update own" on public.notes
  for update using (
    auth.uid() = created_by
    or exists (
      select 1 from public.customer_ownerships o
      where o.customer_number = notes.customer_number
        and (o.owner = auth.uid() or auth.uid() = any(o.shared_with))
    )
  );
create policy "notes delete own" on public.notes
  for delete using (
    auth.uid() = created_by
    or exists (
      select 1 from public.customer_ownerships o
      where o.customer_number = notes.customer_number
        and (o.owner = auth.uid() or auth.uid() = any(o.shared_with))
    )
  );
