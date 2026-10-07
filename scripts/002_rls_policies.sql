revoke all on table public.categories from anon; grant select on table public.categories to authenticated;
revoke update on table public.profiles from anon, authenticated;
grant update (full_name, clinic_name, phone, avatar_url, locale) on table public.profiles to authenticated;
drop policy if exists "categories authenticated read" on public.categories; create policy "categories authenticated read" on public.categories for select to authenticated using (true);
drop policy if exists "categories admin write" on public.categories; create policy "categories admin write" on public.categories for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists "profiles own read" on public.profiles; create policy "profiles own read" on public.profiles for select to authenticated using ((select auth.uid())=id);
drop policy if exists "profiles own update" on public.profiles; create policy "profiles own update" on public.profiles for update to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);
drop policy if exists "inventory own access" on public.inventory_items; create policy "inventory own access" on public.inventory_items for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
