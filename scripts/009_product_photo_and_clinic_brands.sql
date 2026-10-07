alter table public.inventory_items
  add column if not exists product_type text not null default '',
  add column if not exists model text not null default '',
  add column if not exists color text not null default '';

alter table public.catalog_products
  add column if not exists product_type text not null default '',
  add column if not exists model text not null default '',
  add column if not exists color text not null default '';

alter table public.brands
  add column if not exists clinic_id uuid references public.clinics(id) on delete cascade;

drop function if exists public.search_catalog(text, integer);
create function public.search_catalog(search_term text, result_limit integer default 8)
returns table (
  id uuid,
  name text,
  description text,
  barcode text,
  category_id uuid,
  brand_id uuid,
  approved_image_path text,
  category_ids uuid[],
  presentation text,
  product_type text,
  model text,
  color text
)
language sql stable security invoker set search_path = public
as $$
  select p.id, p.name, p.description, p.barcode, p.category_id, p.brand_id,
    p.approved_image_path,
    coalesce((
      select array_agg(pc.category_id order by (pc.category_id = p.category_id) desc, pc.category_id)
      from public.catalog_product_categories pc
      where pc.product_id = p.id
    ), case when p.category_id is null then '{}'::uuid[] else array[p.category_id] end),
    p.presentation,
    p.product_type,
    p.model,
    p.color
  from public.catalog_products p
  where p.is_approved
    and (
      p.barcode = left(trim(search_term), 128)
      or p.name ilike '%' || replace(replace(replace(left(trim(search_term), 128), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
    )
  order by (p.barcode = left(trim(search_term), 128)) desc, p.name
  limit greatest(1, least(result_limit, 12))
$$;
revoke all on function public.search_catalog(text, integer) from public, anon;
grant execute on function public.search_catalog(text, integer) to authenticated;

alter table public.brands drop constraint if exists brands_name_key;
create unique index if not exists brands_global_name_key
  on public.brands(name) where clinic_id is null;
create unique index if not exists brands_clinic_name_key
  on public.brands(clinic_id, name) where clinic_id is not null;

drop policy if exists "brands authenticated read" on public.brands;
create policy "brands clinic and global read" on public.brands for select to authenticated
using (clinic_id is null or public.is_clinic_member(clinic_id) or public.is_admin());
drop policy if exists "brands admin manage" on public.brands;
drop policy if exists "brands clinic create" on public.brands;
create policy "brands clinic create" on public.brands for insert to authenticated
with check (clinic_id is not null and public.is_clinic_member(clinic_id));
create policy "brands admin manage" on public.brands for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create table if not exists public.product_search_rejections (
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  lookup_key text not null,
  candidate_key text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (clinic_id, lookup_key, candidate_key)
);

alter table public.product_search_rejections enable row level security;
drop policy if exists "clinic members manage rejected product suggestions" on public.product_search_rejections;
create policy "clinic members manage rejected product suggestions" on public.product_search_rejections
for all to authenticated
using (public.is_clinic_member(clinic_id))
with check (public.is_clinic_member(clinic_id) and created_by = (select auth.uid()));
