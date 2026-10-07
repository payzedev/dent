alter table public.catalog_products
  add column if not exists presentation text not null default 'individual';
alter table public.inventory_items
  add column if not exists presentation text not null default 'individual';

alter table public.catalog_products
  drop constraint if exists catalog_products_presentation_check;
alter table public.catalog_products
  add constraint catalog_products_presentation_check
  check (presentation in ('individual', 'set', 'box'));
alter table public.inventory_items
  drop constraint if exists inventory_items_presentation_check;
alter table public.inventory_items
  add constraint inventory_items_presentation_check
  check (presentation in ('individual', 'set', 'box'));

create table if not exists public.catalog_product_categories (
  product_id uuid not null references public.catalog_products(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product_id, category_id)
);

create table if not exists public.inventory_item_categories (
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, category_id)
);

insert into public.catalog_product_categories (product_id, category_id)
select id, category_id from public.catalog_products where category_id is not null
on conflict do nothing;
insert into public.inventory_item_categories (item_id, category_id)
select id, category_id from public.inventory_items where category_id is not null
on conflict do nothing;

create index if not exists catalog_product_categories_category_idx
  on public.catalog_product_categories(category_id, product_id);
create index if not exists inventory_item_categories_category_idx
  on public.inventory_item_categories(category_id, item_id);

alter table public.catalog_product_categories enable row level security;
alter table public.inventory_item_categories enable row level security;

drop policy if exists "approved product categories read" on public.catalog_product_categories;
create policy "approved product categories read" on public.catalog_product_categories
for select to authenticated
using (
  public.is_admin() or exists (
    select 1 from public.catalog_products p
    where p.id = product_id and p.is_approved
  )
);
drop policy if exists "admin manage product categories" on public.catalog_product_categories;
create policy "admin manage product categories" on public.catalog_product_categories
for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "clinic inventory categories access" on public.inventory_item_categories;
create policy "clinic inventory categories access" on public.inventory_item_categories
for all to authenticated
using (
  public.is_admin() or exists (
    select 1 from public.inventory_items i
    where i.id = item_id and public.is_clinic_member(i.clinic_id)
  )
)
with check (
  public.is_admin() or exists (
    select 1 from public.inventory_items i
    where i.id = item_id and public.is_clinic_member(i.clinic_id)
  )
);

grant select, insert, update, delete
  on public.catalog_product_categories, public.inventory_item_categories
  to authenticated;

create or replace function public.set_catalog_product_categories(
  target_product uuid,
  target_categories uuid[]
)
returns void language plpgsql security invoker set search_path = public
as $$
declare
  category uuid;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;

  update public.catalog_products
  set category_id = (target_categories)[1]
  where id = target_product;
  if not found then
    raise exception 'Catalog product not found';
  end if;

  delete from public.catalog_product_categories where product_id = target_product;
  foreach category in array coalesce(target_categories, '{}'::uuid[]) loop
    insert into public.catalog_product_categories (product_id, category_id)
    values (target_product, category)
    on conflict do nothing;
  end loop;
end
$$;

create or replace function public.set_inventory_item_categories(
  target_item uuid,
  target_categories uuid[]
)
returns void language plpgsql security invoker set search_path = public
as $$
declare
  category uuid;
begin
  update public.inventory_items
  set category_id = (target_categories)[1]
  where id = target_item;
  if not found then
    raise exception 'Inventory item not found';
  end if;

  delete from public.inventory_item_categories where item_id = target_item;
  foreach category in array coalesce(target_categories, '{}'::uuid[]) loop
    insert into public.inventory_item_categories (item_id, category_id)
    values (target_item, category)
    on conflict do nothing;
  end loop;
end
$$;

revoke all on function public.set_catalog_product_categories(uuid, uuid[]) from public, anon;
revoke all on function public.set_inventory_item_categories(uuid, uuid[]) from public, anon;
grant execute on function public.set_catalog_product_categories(uuid, uuid[]) to authenticated;
grant execute on function public.set_inventory_item_categories(uuid, uuid[]) to authenticated;

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
  presentation text
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
    p.presentation
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
  with clinic_items as (
    select i.id, i.quantity, i.expiry_date
    from public.inventory_items i
    where i.clinic_id = (
      select p.primary_clinic_id from public.profiles p where p.id = (select auth.uid())
    )
  ), grouped as (
    select c.slug, c.name_en, c.name_es, c.color_hex, c.sort_order,
      coalesce(sum(i.quantity), 0)::bigint as units,
      count(distinct i.id)::bigint as distinct_items,
      count(distinct i.id) filter (where i.quantity = 0)::bigint as missing_count,
      count(distinct i.id) filter (where i.expiry_date is not null and i.expiry_date between current_date and current_date + 30)::bigint as expiring_count
    from public.categories c
    left join public.inventory_item_categories ic on ic.category_id = c.id
    left join clinic_items i on i.id = ic.item_id
    where c.is_active
    group by c.slug, c.name_en, c.name_es, c.color_hex, c.sort_order
  ), totals as (
    select
      coalesce(sum(quantity), 0)::bigint as units,
      count(id) filter (where quantity = 0)::bigint as missing,
      count(id) filter (where expiry_date is not null and expiry_date between current_date and current_date + 30)::bigint as expiring
    from clinic_items
  )
  select g.slug, g.name_en, g.name_es, g.color_hex, g.units, g.distinct_items,
    g.missing_count, g.expiring_count, t.units, t.missing, t.expiring
  from grouped g cross join totals t
  order by g.sort_order
$$;
grant execute on function public.get_home_stats() to authenticated;
