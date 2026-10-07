drop policy if exists "support replies create" on public.support_replies;
create policy "support replies create" on public.support_replies
for insert to authenticated
with check (
  author_id = (select auth.uid()) and (
    public.is_admin() or exists (
      select 1 from public.support_reports r
      where r.id = report_id and public.is_clinic_member(r.clinic_id)
    )
  )
);
