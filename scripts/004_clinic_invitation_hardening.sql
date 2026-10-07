create index if not exists clinic_invites_pending_idx on public.clinic_invites(clinic_id, email, expires_at)
where accepted_at is null;

alter table public.inventory_items drop constraint if exists inventory_items_category_id_fkey;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'inventory_items_category_delete_set_null_fkey'
      and conrelid = 'public.inventory_items'::regclass
  ) then
    alter table public.inventory_items
      add constraint inventory_items_category_delete_set_null_fkey
      foreign key (category_id) references public.categories(id) on delete set null;
  end if;
end
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  new_clinic_id uuid;
  invitation public.clinic_invites%rowtype;
  invite_code text;
begin
  insert into public.profiles (id, email, full_name, role, clinic_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'user',
    coalesce(nullif(new.raw_user_meta_data->>'clinic_name', ''), '')
  )
  on conflict (id) do nothing;

  invite_code := new.raw_user_meta_data->>'clinic_invite_code';
  if invite_code is not null then
    select * into invitation
    from public.clinic_invites
    where code_hash = encode(digest(invite_code, 'sha256'), 'hex')
      and email = lower(new.email)
      and accepted_at is null
      and expires_at > now()
    for update;

    if not found then
      raise exception 'Clinic invitation is invalid or expired';
    end if;

    insert into public.clinic_members (clinic_id, user_id, role)
    values (invitation.clinic_id, new.id, 'staff')
    on conflict (clinic_id, user_id) do nothing;

    update public.profiles
    set primary_clinic_id = invitation.clinic_id,
        clinic_name = (select c.name from public.clinics c where c.id = invitation.clinic_id)
    where id = new.id;

    update public.clinic_invites
    set accepted_at = now(), accepted_by = new.id
    where id = invitation.id;
    return new;
  end if;

  insert into public.clinics (name)
  values (coalesce(nullif(new.raw_user_meta_data->>'clinic_name', ''), 'My clinic'))
  returning id into new_clinic_id;

  insert into public.clinic_members (clinic_id, user_id, role)
  values (new_clinic_id, new.id, 'owner');

  update public.profiles set primary_clinic_id = new_clinic_id
  where id = new.id and primary_clinic_id is null;
  return new;
end
$$;
