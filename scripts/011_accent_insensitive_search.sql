create extension if not exists unaccent;

do $$
declare
  extension_schema text;
  function_body text;
begin
  select namespace.nspname
  into extension_schema
  from pg_proc proc_entry
  join pg_namespace namespace on namespace.oid = proc_entry.pronamespace
  where proc_entry.proname = 'unaccent'
    and proc_entry.pronargs = 2
  limit 1;

  if extension_schema is null then
    raise exception 'The unaccent extension function is unavailable';
  end if;

  function_body := format(
    'select %I.unaccent(%L::regdictionary, $1)',
    extension_schema,
    extension_schema || '.unaccent'
  );

  execute format(
    'create or replace function public.unaccent_search(text) returns text language sql immutable parallel safe strict set search_path = pg_catalog as %L',
    function_body
  );
end
$$;

drop index if exists public.catalog_products_name_trgm_idx;
drop index if exists public.inventory_items_name_trgm_idx;
drop index if exists public.inventory_items_description_trgm_idx;
drop index if exists public.inventory_items_barcode_trgm_idx;
drop index if exists public.brands_name_trgm_idx;
drop index if exists public.categories_name_en_trgm_idx;
drop index if exists public.categories_name_es_trgm_idx;

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
    ['inventory_items', 'barcode'],
    ['brands', 'name'],
    ['categories', 'name_en'],
    ['categories', 'name_es']
  ] loop
    indexed_table := indexed_columns[1];
    indexed_column := indexed_columns[2];
    execute format(
      'create index %I on public.%I using gin (public.unaccent_search(%I) %I.gin_trgm_ops)',
      indexed_table || '_' || indexed_column || '_trgm_idx',
      indexed_table,
      indexed_column,
      opclass_schema
    );
  end loop;
end
$$;

create or replace function public.search_catalog(search_term text, result_limit integer default 8)
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
      or public.unaccent_search(p.name) ilike '%' || public.unaccent_search(
        replace(replace(replace(left(trim(search_term), 128), '\', '\\'), '%', '\%'), '_', '\_')
      ) || '%' escape '\'
    )
  order by (p.barcode = left(trim(search_term), 128)) desc, p.name
  limit greatest(1, least(result_limit, 12))
$$;
revoke all on function public.search_catalog(text, integer) from public, anon;
grant execute on function public.search_catalog(text, integer) to authenticated;

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
        or public.unaccent_search(item.name) ilike '%' || public.unaccent_search(replace(replace(replace(left(trim(search_term), 128), '\', '\\'), '%', '\%'), '_', '\_')) || '%' escape '\'
        or public.unaccent_search(item.description) ilike '%' || public.unaccent_search(replace(replace(replace(left(trim(search_term), 128), '\', '\\'), '%', '\%'), '_', '\_')) || '%' escape '\'
        or public.unaccent_search(item.barcode) ilike '%' || public.unaccent_search(replace(replace(replace(left(trim(search_term), 128), '\', '\\'), '%', '\%'), '_', '\_')) || '%' escape '\'
        or exists (
          select 1 from public.brands brand
          where brand.id = item.brand_id
            and public.unaccent_search(brand.name) ilike '%' || public.unaccent_search(replace(replace(replace(left(trim(search_term), 128), '\', '\\'), '%', '\%'), '_', '\_')) || '%' escape '\'
        )
        or exists (
          select 1
          from public.inventory_item_categories item_category
          join public.categories category on category.id = item_category.category_id
          where item_category.item_id = item.id
            and (
              public.unaccent_search(category.name_en) ilike '%' || public.unaccent_search(replace(replace(replace(left(trim(search_term), 128), '\', '\\'), '%', '\%'), '_', '\_')) || '%' escape '\'
              or public.unaccent_search(category.name_es) ilike '%' || public.unaccent_search(replace(replace(replace(left(trim(search_term), 128), '\', '\\'), '%', '\%'), '_', '\_')) || '%' escape '\'
            )
        )
        or exists (
          select 1 from public.catalog_products product
          where product.id = item.product_id
            and public.unaccent_search(product.name) ilike '%' || public.unaccent_search(replace(replace(replace(left(trim(search_term), 128), '\', '\\'), '%', '\%'), '_', '\_')) || '%' escape '\'
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
