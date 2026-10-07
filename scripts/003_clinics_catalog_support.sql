create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.clinic_members (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner','staff')),
  created_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);

create table if not exists public.clinic_invites (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  email text not null,
  code_hash text unique not null,
  invited_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.clinic_invites enable row level security;

alter table public.profiles add column if not exists primary_clinic_id uuid references public.clinics(id);

insert into public.profiles (id, email, full_name, role)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'full_name', ''), 'user'::public.user_role
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

do $$
declare
  profile_row record;
  new_clinic_id uuid;
begin
  for profile_row in
    select id, clinic_name, full_name
    from public.profiles
    where primary_clinic_id is null
  loop
    insert into public.clinics (name)
    values (coalesce(nullif(profile_row.clinic_name, ''), nullif(profile_row.full_name, ''), 'My clinic'))
    returning id into new_clinic_id;

    update public.profiles
    set primary_clinic_id = new_clinic_id
    where id = profile_row.id;

    insert into public.clinic_members (clinic_id, user_id, role)
    values (new_clinic_id, profile_row.id, 'owner')
    on conflict (clinic_id, user_id) do nothing;
  end loop;
end
$$;

alter table public.inventory_items add column if not exists clinic_id uuid references public.clinics(id) on delete cascade;
update public.inventory_items i
set clinic_id = p.primary_clinic_id
from public.profiles p
where p.id = i.owner_id and i.clinic_id is null;
alter table public.inventory_items alter column clinic_id set not null;
alter table public.inventory_items add column if not exists product_id uuid;
alter table public.inventory_items add column if not exists brand_id uuid;
alter table public.inventory_items add column if not exists description text not null default '';
alter table public.inventory_items add column if not exists barcode text;
alter table public.inventory_items add column if not exists image_path text;
alter table public.inventory_items add column if not exists updated_at timestamptz not null default now();
create index if not exists inventory_items_clinic_idx on public.inventory_items(clinic_id);
create index if not exists inventory_items_barcode_idx on public.inventory_items(barcode) where barcode is not null;

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  created_at timestamptz not null default now()
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_items_brand_id_fkey') then
    alter table public.inventory_items add constraint inventory_items_brand_id_fkey
      foreign key (brand_id) references public.brands(id) on delete set null;
  end if;
end
$$;

create table if not exists public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  barcode text unique,
  category_id uuid references public.categories(id) on delete set null,
  brand_id uuid references public.brands(id) on delete set null,
  approved_image_path text,
  is_approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_items_product_id_fkey') then
    alter table public.inventory_items add constraint inventory_items_product_id_fkey
      foreign key (product_id) references public.catalog_products(id) on delete set null;
  end if;
end
$$;
create index if not exists catalog_products_name_idx on public.catalog_products using gin (to_tsvector('simple', name));
create index if not exists catalog_products_barcode_idx on public.catalog_products(barcode);

create or replace function public.search_catalog(search_term text, result_limit integer default 8)
returns table (
  id uuid,
  name text,
  description text,
  barcode text,
  category_id uuid,
  brand_id uuid,
  approved_image_path text
)
language sql stable security invoker set search_path = public
as $$
  select p.id, p.name, p.description, p.barcode, p.category_id, p.brand_id, p.approved_image_path
  from public.catalog_products p
  where p.is_approved
    and (
      p.barcode = left(trim(search_term), 128)
      or p.name ilike '%' || replace(replace(replace(left(trim(search_term), 128), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
    )
  order by (p.barcode = left(trim(search_term), 128)) desc, p.name
  limit greatest(1, least(result_limit, 12))
$$;

create or replace function public.get_home_stats()
returns table (
  slug text,
  name_en text,
  name_es text,
  color_hex text,
  units bigint,
  distinct_items bigint,
  missing_count bigint,
  expiring_count bigint,
  total_units bigint,
  total_missing bigint,
  total_expiring bigint
)
language sql stable security invoker set search_path = public
as $$
  with grouped as (
    select c.slug, c.name_en, c.name_es, c.color_hex,
      coalesce(sum(i.quantity), 0)::bigint as units,
      count(i.id)::bigint as distinct_items,
      count(i.id) filter (where i.quantity = 0)::bigint as missing_count,
      count(i.id) filter (where i.expiry_date is not null and i.expiry_date between current_date and current_date + 30)::bigint as expiring_count
    from public.categories c
    left join public.inventory_items i
      on i.category_id = c.id
      and i.clinic_id = (select p.primary_clinic_id from public.profiles p where p.id = (select auth.uid()))
    where c.is_active
    group by c.slug, c.name_en, c.name_es, c.color_hex, c.sort_order
    order by c.sort_order
  )
  select g.*,
    (select coalesce(sum(units), 0) from grouped),
    (select coalesce(sum(missing_count), 0) from grouped),
    (select coalesce(sum(expiring_count), 0) from grouped)
  from grouped g
$$;

create table if not exists public.support_reports (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  subject text not null,
  message text not null,
  image_path text,
  status text not null default 'open' check (status in ('open','in_progress','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_replies (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.support_reports(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  message text not null,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where u.id = (select auth.uid())
      and lower(u.email) = 'remgoficial@gmail.com'
      and u.email_confirmed_at is not null
  )
$$;

create or replace function public.is_clinic_member(target_clinic uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.clinic_members m
    where m.clinic_id = target_clinic and m.user_id = (select auth.uid())
  )
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

    if found then
      insert into public.clinic_members (clinic_id, user_id, role)
      values (invitation.clinic_id, new.id, 'staff')
      on conflict (clinic_id, user_id) do nothing;

      update public.profiles
      set primary_clinic_id = invitation.clinic_id
      where id = new.id;

      update public.clinic_invites
      set accepted_at = now(), accepted_by = new.id
      where id = invitation.id;
      return new;
    end if;
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

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed after update of email, email_confirmed_at on auth.users
for each row execute function public.promote_admin_on_confirm();

create or replace function public.promote_admin_on_confirm()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.profiles
  set role = case when lower(new.email) = 'remgoficial@gmail.com' and new.email_confirmed_at is not null then 'admin'::public.user_role else 'user'::public.user_role end,
      email = new.email
  where id = new.id;
  return new;
end
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists catalog_products_touch_updated_at on public.catalog_products;
create trigger catalog_products_touch_updated_at before update on public.catalog_products
for each row execute function public.touch_updated_at();
drop trigger if exists support_reports_touch_updated_at on public.support_reports;
create trigger support_reports_touch_updated_at before update on public.support_reports
for each row execute function public.touch_updated_at();
drop trigger if exists inventory_items_touch_updated_at on public.inventory_items;
create trigger inventory_items_touch_updated_at before update on public.inventory_items
for each row execute function public.touch_updated_at();

alter table public.clinics enable row level security;
alter table public.clinic_members enable row level security;
alter table public.brands enable row level security;
alter table public.catalog_products enable row level security;
alter table public.support_reports enable row level security;
alter table public.support_replies enable row level security;

drop policy if exists "clinic members read clinics" on public.clinics;
create policy "clinic members read clinics" on public.clinics for select to authenticated
using (public.is_clinic_member(id) or public.is_admin());
drop policy if exists "clinic members read membership" on public.clinic_members;
create policy "clinic members read membership" on public.clinic_members for select to authenticated
using (public.is_clinic_member(clinic_id) or public.is_admin());
drop policy if exists "clinic members read colleague profiles" on public.profiles;
create policy "clinic members read colleague profiles" on public.profiles for select to authenticated
using (public.is_clinic_member(primary_clinic_id) or public.is_admin());
drop policy if exists "clinic owners update clinics" on public.clinics;
create policy "clinic owners update clinics" on public.clinics for update to authenticated
using (exists (
  select 1 from public.clinic_members m
  where m.clinic_id = id and m.user_id = (select auth.uid()) and m.role = 'owner'
))
with check (exists (
  select 1 from public.clinic_members m
  where m.clinic_id = id and m.user_id = (select auth.uid()) and m.role = 'owner'
));

drop policy if exists "brands authenticated read" on public.brands;
create policy "brands authenticated read" on public.brands for select to authenticated using (true);
drop policy if exists "brands admin manage" on public.brands;
create policy "brands admin manage" on public.brands for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "approved catalog read" on public.catalog_products;
create policy "approved catalog read" on public.catalog_products for select to authenticated
using (is_approved or public.is_admin());
drop policy if exists "admin manage catalog" on public.catalog_products;
create policy "admin manage catalog" on public.catalog_products for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "inventory clinic access" on public.inventory_items;
drop policy if exists "inventory own access" on public.inventory_items;
create policy "inventory clinic access" on public.inventory_items for all to authenticated
using (public.is_clinic_member(clinic_id) or public.is_admin())
with check (public.is_clinic_member(clinic_id) or public.is_admin());

drop policy if exists "profiles admin read" on public.profiles;
create policy "profiles admin read" on public.profiles for select to authenticated using (public.is_admin());

create or replace function public.set_user_suspension(target_user uuid, suspend boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  if target_user = (select auth.uid()) or exists (
    select 1 from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = target_user and lower(u.email) = 'remgoficial@gmail.com'
  ) then
    raise exception 'The administrator account cannot be suspended';
  end if;
  update public.profiles set status = case when suspend then 'suspended' else 'active' end where id = target_user;
  update auth.users set banned_until = case when suspend then now() + interval '100 years' else null end where id = target_user;
end
$$;

drop policy if exists "support clinic read" on public.support_reports;
create policy "support clinic read" on public.support_reports for select to authenticated
using (public.is_clinic_member(clinic_id) or public.is_admin());
drop policy if exists "support clinic create" on public.support_reports;
create policy "support clinic create" on public.support_reports for insert to authenticated
with check (public.is_clinic_member(clinic_id) and created_by = (select auth.uid()));
drop policy if exists "support clinic update" on public.support_reports;
create policy "support clinic update" on public.support_reports for update to authenticated
using (public.is_admin()) with check (public.is_admin());
drop policy if exists "support replies read" on public.support_replies;
create policy "support replies read" on public.support_replies for select to authenticated
using (
  public.is_admin() or exists (
    select 1 from public.support_reports r
    where r.id = report_id and public.is_clinic_member(r.clinic_id)
  )
);
drop policy if exists "support replies create" on public.support_replies;
create policy "support replies create" on public.support_replies for insert to authenticated
with check (
  author_id = (select auth.uid()) and (
    public.is_admin() or exists (
      select 1 from public.support_reports r
      where r.id = report_id and public.is_clinic_member(r.clinic_id)
    )
  )
);

update public.profiles p
set role = case
  when lower(u.email) = 'remgoficial@gmail.com' and u.email_confirmed_at is not null then 'admin'::public.user_role
  else 'user'::public.user_role
end
from auth.users u
where u.id = p.id;

revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_clinic_member(uuid) from public, anon;
revoke all on function public.search_catalog(text, integer) from public, anon;
revoke all on function public.set_user_suspension(uuid, boolean) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_clinic_member(uuid) to authenticated;
grant execute on function public.search_catalog(text, integer) to authenticated;
grant execute on function public.set_user_suspension(uuid, boolean) to authenticated;
grant select, update on public.clinics to authenticated;
grant select on public.clinic_members to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, delete on public.clinic_invites to service_role;
grant select, insert, update, delete on public.brands, public.catalog_products, public.support_reports, public.support_replies to authenticated;
grant select, insert, update, delete on public.inventory_items to authenticated;
grant execute on function public.get_home_stats() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inventory-images', 'inventory-images', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
set public = false, file_size_limit = 5242880, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "clinic images read" on storage.objects;
create policy "clinic images read" on storage.objects for select to authenticated
using (
  bucket_id = 'inventory-images' and (
    case
      when (storage.foldername(name))[1] = 'catalog' then
        public.is_admin() or exists (
          select 1 from public.catalog_products p
          where p.approved_image_path = name and p.is_approved
        )
      else public.is_admin() or public.is_clinic_member((storage.foldername(name))[1]::uuid)
    end
  )
);
drop policy if exists "clinic images upload" on storage.objects;
create policy "clinic images upload" on storage.objects for insert to authenticated
with check (
  bucket_id = 'inventory-images' and (
    case
      when (storage.foldername(name))[1] = 'catalog' then public.is_admin()
      else public.is_admin() or public.is_clinic_member((storage.foldername(name))[1]::uuid)
    end
  )
);
drop policy if exists "clinic images update" on storage.objects;
create policy "clinic images update" on storage.objects for update to authenticated
using (
  bucket_id = 'inventory-images' and (
    case
      when (storage.foldername(name))[1] = 'catalog' then public.is_admin()
      else public.is_admin() or public.is_clinic_member((storage.foldername(name))[1]::uuid)
    end
  )
)
with check (
  bucket_id = 'inventory-images' and (
    case
      when (storage.foldername(name))[1] = 'catalog' then public.is_admin()
      else public.is_admin() or public.is_clinic_member((storage.foldername(name))[1]::uuid)
    end
  )
);
drop policy if exists "clinic images delete" on storage.objects;
create policy "clinic images delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'inventory-images' and (
    case
      when (storage.foldername(name))[1] = 'catalog' then public.is_admin()
      else public.is_admin() or public.is_clinic_member((storage.foldername(name))[1]::uuid)
    end
  )
);
