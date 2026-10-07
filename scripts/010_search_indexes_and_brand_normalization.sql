create extension if not exists pg_trgm;

drop index if exists public.catalog_products_name_idx;
do $$
declare
  opclass_schema text;
  indexed_columns text[];
  indexed_table text;
  indexed_column text;
begin
  select namespace.nspname
  into opclass_schema
  from pg_opclass opclass
  join pg_am access_method on access_method.oid = opclass.opcmethod
  join pg_namespace namespace on namespace.oid = opclass.opcnamespace
  where opclass.opcname = 'gin_trgm_ops'
    and access_method.amname = 'gin'
  limit 1;

  if opclass_schema is null then
    raise exception 'The pg_trgm GIN operator class is unavailable';
  end if;

  foreach indexed_columns slice 1 in array array[
    ['catalog_products', 'name'],
    ['inventory_items', 'name'],
    ['inventory_items', 'description'],
    ['inventory_items', 'barcode']
  ] loop
    indexed_table := indexed_columns[1];
    indexed_column := indexed_columns[2];
    if not exists (
      select 1 from pg_indexes
      where schemaname = 'public'
        and indexname = indexed_table || '_' || indexed_column || '_trgm_idx'
    ) then
      execute format(
        'create index %I on public.%I using gin (%I %I.gin_trgm_ops)',
        indexed_table || '_' || indexed_column || '_trgm_idx',
        indexed_table,
        indexed_column,
        opclass_schema
      );
    end if;
  end loop;
end
$$;

with ranked_brands as (
  select id,
    first_value(id) over (
      partition by clinic_id, lower(btrim(name))
      order by created_at, id
    ) as canonical_id
  from public.brands
)
update public.inventory_items item
set brand_id = ranked.canonical_id
from ranked_brands ranked
where item.brand_id = ranked.id
  and ranked.id <> ranked.canonical_id;

with ranked_brands as (
  select id,
    first_value(id) over (
      partition by clinic_id, lower(btrim(name))
      order by created_at, id
    ) as canonical_id
  from public.brands
)
update public.catalog_products product
set brand_id = ranked.canonical_id
from ranked_brands ranked
where product.brand_id = ranked.id
  and ranked.id <> ranked.canonical_id;

with ranked_brands as (
  select id,
    row_number() over (
      partition by clinic_id, lower(btrim(name))
      order by created_at, id
    ) as duplicate_number
  from public.brands
)
delete from public.brands brand
using ranked_brands ranked
where brand.id = ranked.id
  and ranked.duplicate_number > 1;

update public.brands set name = btrim(name) where name <> btrim(name);

drop index if exists public.brands_global_name_key;
drop index if exists public.brands_clinic_name_key;
create unique index brands_global_name_key
  on public.brands(lower(btrim(name))) where clinic_id is null;
create unique index brands_clinic_name_key
  on public.brands(clinic_id, lower(btrim(name))) where clinic_id is not null;

create index if not exists support_replies_report_created_idx
  on public.support_replies(report_id, created_at);

create or replace function public.search_inventory(
  search_term text default '',
  category_filter uuid default null,
  status_filter text default null,
  result_offset integer default 0,
  result_limit integer default 50
)
returns table (
  id uuid,
  name text,
  description text,
  quantity integer,
  min_quantity integer,
  expiry_date date,
  status public.inventory_status,
  created_at timestamptz,
  barcode text,
  image_path text,
  category_id uuid,
  brand_id uuid,
  product_id uuid,
  presentation text,
  product_type text,
  model text,
  color text,
  total_count bigint
)
language sql stable security invoker set search_path = public
as $$
  with matching_items as (
    select item.*
    from public.inventory_items item
    where (category_filter is null or exists (
      select 1
      from public.inventory_item_categories item_category
      where item_category.item_id = item.id
        and item_category.category_id = category_filter
    ))
      and (status_filter is null or item.status::text = status_filter)
      and (
        nullif(trim(search_term), '') is null
        or item.name ilike '%' || replace(replace(replace(left(trim(search_term), 128), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
        or item.description ilike '%' || replace(replace(replace(left(trim(search_term), 128), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
        or item.barcode ilike '%' || replace(replace(replace(left(trim(search_term), 128), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
        or exists (
          select 1 from public.brands brand
          where brand.id = item.brand_id
            and brand.name ilike '%' || replace(replace(replace(left(trim(search_term), 128), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
        )
        or exists (
          select 1
          from public.inventory_item_categories item_category
          join public.categories category on category.id = item_category.category_id
          where item_category.item_id = item.id
            and (
              category.name_en ilike '%' || replace(replace(replace(left(trim(search_term), 128), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
              or category.name_es ilike '%' || replace(replace(replace(left(trim(search_term), 128), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
            )
        )
        or exists (
          select 1 from public.catalog_products product
          where product.id = item.product_id
            and product.name ilike '%' || replace(replace(replace(left(trim(search_term), 128), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
        )
      )
  )
  select item.id, item.name, item.description, item.quantity, item.min_quantity,
    item.expiry_date, item.status, item.created_at, item.barcode, item.image_path,
    item.category_id, item.brand_id, item.product_id, item.presentation,
    item.product_type, item.model, item.color, count(*) over()::bigint
  from matching_items item
  order by lower(item.name), item.id
  limit greatest(1, least(result_limit, 100))
  offset greatest(0, result_offset)
$$;

revoke all on function public.search_inventory(text, uuid, text, integer, integer) from public, anon;
grant execute on function public.search_inventory(text, uuid, text, integer, integer) to authenticated;
