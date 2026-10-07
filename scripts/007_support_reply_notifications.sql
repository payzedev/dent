create table if not exists public.support_reply_reads (
  reply_id uuid not null references public.support_replies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (reply_id, user_id)
);

alter table public.support_reply_reads enable row level security;
drop policy if exists "users read own support reply receipts" on public.support_reply_reads;
create policy "users read own support reply receipts" on public.support_reply_reads
for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());

create or replace function public.get_unread_support_reply_count()
returns bigint language sql stable security definer set search_path = ''
as $$
  select count(*)::bigint
  from public.support_replies reply
  join public.support_reports report on report.id = reply.report_id
  join public.profiles author on author.id = reply.author_id
  where author.role = 'admin'
    and public.is_clinic_member(report.clinic_id)
    and not exists (
      select 1 from public.support_reply_reads receipt
      where receipt.reply_id = reply.id and receipt.user_id = (select auth.uid())
    )
$$;

create or replace function public.mark_support_replies_read(target_report uuid default null)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.support_reply_reads (reply_id, user_id)
  select reply.id, (select auth.uid())
  from public.support_replies reply
  join public.support_reports report on report.id = reply.report_id
  join public.profiles author on author.id = reply.author_id
  where author.role = 'admin'
    and (target_report is null or report.id = target_report)
    and public.is_clinic_member(report.clinic_id)
  on conflict (reply_id, user_id) do nothing;
end
$$;

revoke all on function public.get_unread_support_reply_count() from public, anon;
revoke all on function public.mark_support_replies_read(uuid) from public, anon;
grant execute on function public.get_unread_support_reply_count() to authenticated;
grant execute on function public.mark_support_replies_read(uuid) to authenticated;
