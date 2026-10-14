-- Pending Telegram catalog proposals. Apply after 014_telegram_catalog_hardening.sql.
alter table public.catalog_products
  add column if not exists proposed_brand_name text,
  add column if not exists proposed_category_name text,
  add column if not exists brand_resolution text not null default 'unresolved' check (brand_resolution in ('existing','pending','ambiguous','unresolved')),
  add column if not exists category_resolution text not null default 'unresolved' check (category_resolution in ('existing','pending','ambiguous','unresolved'));

create index if not exists catalog_products_pending_idx
  on public.catalog_products(is_approved, brand_resolution, category_resolution);

create or replace function public.create_telegram_catalog_product_pending(
  p_idempotency_key text, p_telegram_user_id text, p_created_by uuid, p_name text,
  p_description text default '', p_barcode text default null, p_category_id uuid default null,
  p_brand_id uuid default null, p_category_name text default null, p_brand_name text default null,
  p_presentation text default 'individual', p_product_type text default '', p_model text default '',
  p_color text default '', p_approved_image_path text default null
) returns table(product_id uuid, reused boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare existing public.telegram_catalog_operations%rowtype; created_id uuid; c_count int; b_count int; c_id uuid; b_id uuid; c_status text := 'unresolved'; b_status text := 'unresolved';
begin
  if length(trim(coalesce(p_idempotency_key,''))) not between 16 and 128 then raise exception using errcode='22023', message='invalid idempotency key'; end if;
  perform pg_advisory_xact_lock(hashtextextended(trim(p_idempotency_key),0));
  select * into existing from public.telegram_catalog_operations where idempotency_key=trim(p_idempotency_key) for update;
  if found then
    if existing.telegram_user_id <> p_telegram_user_id or existing.created_by <> p_created_by then raise exception using errcode='42501', message='idempotency conflict'; end if;
    return query select existing.product_id,true; return;
  end if;
  if nullif(trim(p_category_name),'') is not null and p_category_id is null then
    select count(*), min(id) into c_count,c_id from public.categories where is_active and lower(regexp_replace(trim(name_en), '\s+', ' ', 'g')) = lower(regexp_replace(trim(p_category_name), '\s+', ' ', 'g')) or is_active and lower(regexp_replace(trim(name_es), '\s+', ' ', 'g')) = lower(regexp_replace(trim(p_category_name), '\s+', ' ', 'g'));
    c_status := case when c_count=1 then 'existing' when c_count=0 then 'pending' else 'ambiguous' end;
  elsif p_category_id is not null then c_id := p_category_id; c_status := 'existing'; end if;
  if nullif(trim(p_brand_name),'') is not null and p_brand_id is null then
    select count(*), min(id) into b_count,b_id from public.brands where clinic_id is null and lower(regexp_replace(trim(name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(p_brand_name), '\s+', ' ', 'g'));
    b_status := case when b_count=1 then 'existing' when b_count=0 then 'pending' else 'ambiguous' end;
  elsif p_brand_id is not null then b_id := p_brand_id; b_status := 'existing'; end if;
  insert into public.catalog_products(name,description,barcode,category_id,brand_id,proposed_category_name,proposed_brand_name,category_resolution,brand_resolution,presentation,product_type,model,color,approved_image_path,is_approved)
  values(trim(p_name),trim(coalesce(p_description,'')),nullif(trim(p_barcode),''),c_id,b_id,nullif(trim(p_category_name),''),nullif(trim(p_brand_name),''),c_status,b_status,p_presentation,trim(coalesce(p_product_type,'')),trim(coalesce(p_model,'')),trim(coalesce(p_color,'')),p_approved_image_path,false)
  returning id into created_id;
  insert into public.telegram_catalog_operations(idempotency_key,telegram_user_id,product_id,created_by) values(trim(p_idempotency_key),p_telegram_user_id,created_id,p_created_by);
  return query select created_id,false;
end $$;
revoke all on function public.create_telegram_catalog_product_pending(text,text,uuid,text,text,text,uuid,uuid,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.create_telegram_catalog_product_pending(text,text,uuid,text,text,text,uuid,uuid,text,text,text,text,text,text,text) to service_role;

create or replace function public.approve_telegram_catalog_product(target_product uuid, target_brand_name text default null, target_category_name text default null, target_brand_id uuid default null, target_category_id uuid default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare b_id uuid := target_brand_id; c_id uuid := target_category_id; b_count int; c_count int;
begin
  if not public.is_admin() then raise exception using errcode='42501', message='not authorized'; end if;
  if b_id is null and nullif(trim(target_brand_name),'') is not null then
    select count(*),min(id) into b_count,b_id from public.brands where clinic_id is null and lower(regexp_replace(trim(name),'\s+',' ','g'))=lower(regexp_replace(trim(target_brand_name),'\s+',' ','g'));
    if b_count=0 then insert into public.brands(name) values(trim(target_brand_name)) returning id into b_id; elsif b_count>1 then raise exception using errcode='P0001', message='ambiguous brand'; end if;
  end if;
  if c_id is null and nullif(trim(target_category_name),'') is not null then select count(*),min(id) into c_count,c_id from public.categories where is_active and (lower(regexp_replace(trim(name_en),'\s+',' ','g'))=lower(regexp_replace(trim(target_category_name),'\s+',' ','g')) or lower(regexp_replace(trim(name_es),'\s+',' ','g'))=lower(regexp_replace(trim(target_category_name),'\s+',' ','g'))); if c_count<>1 then raise exception using errcode='P0001', message='category must resolve uniquely'; end if; end if;
  if b_id is null or c_id is null then raise exception using errcode='P0001', message='brand and category are required'; end if;
  update public.catalog_products set brand_id=b_id,category_id=c_id,brand_resolution='existing',category_resolution='existing',is_approved=true where id=target_product;
  if not found then raise exception using errcode='P0002', message='product not found'; end if;
end $$;
revoke all on function public.approve_telegram_catalog_product(uuid,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_telegram_catalog_product(uuid,text,text,uuid,uuid) to authenticated;
