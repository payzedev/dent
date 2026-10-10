-- Telegram catalog hardening. Apply after 013_telegram_catalog_atomic.sql.
-- Existing installations have global brands without a scope column; NULL means global.
alter table if exists public.brands add column if not exists clinic_id uuid references public.clinics(id) on delete cascade;
create index if not exists brands_global_name_idx on public.brands(name) where clinic_id is null;
-- The worker route uses service_role; do not expose these functions to anon/public.
grant execute on function public.search_catalog(text, integer) to service_role;

drop function if exists public.create_telegram_catalog_product(text, text, uuid, text, text, text, uuid, uuid, text, text, text, text, text);
create or replace function public.create_telegram_catalog_product(
  p_idempotency_key text, p_telegram_user_id text, p_created_by uuid, p_name text,
  p_description text default '', p_barcode text default null, p_category_id uuid default null,
  p_brand_id uuid default null, p_presentation text default 'individual',
  p_product_type text default '', p_model text default '', p_color text default '',
  p_approved_image_path text default null
) returns table (product_id uuid, reused boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare existing public.telegram_catalog_operations%rowtype; created_id uuid;
begin
  if length(trim(coalesce(p_idempotency_key, ''))) not between 16 and 128 then raise exception using errcode='22023', message='invalid idempotency key'; end if;
  perform pg_advisory_xact_lock(hashtextextended(trim(p_idempotency_key), 0));
  select * into existing from public.telegram_catalog_operations where idempotency_key=trim(p_idempotency_key) for update;
  if found then
    if existing.telegram_user_id <> p_telegram_user_id or existing.created_by <> p_created_by then
      raise exception using errcode='42501', message='idempotency conflict';
    end if;
    return query select existing.product_id, true; return;
  end if;
  if p_category_id is not null and not exists (select 1 from public.categories where id=p_category_id and is_active) then raise exception using errcode='23503', message='invalid category'; end if;
  if p_brand_id is not null and not exists (select 1 from public.brands where id=p_brand_id) then raise exception using errcode='23503', message='invalid brand'; end if;
  insert into public.catalog_products(name,description,barcode,category_id,brand_id,presentation,product_type,model,color,approved_image_path,is_approved)
  values(trim(p_name),trim(coalesce(p_description,'')),nullif(trim(p_barcode),''),p_category_id,p_brand_id,p_presentation,trim(coalesce(p_product_type,'')),trim(coalesce(p_model,'')),trim(coalesce(p_color,'')),p_approved_image_path,false)
  returning id into created_id;
  insert into public.telegram_catalog_operations(idempotency_key,telegram_user_id,product_id,created_by)
  values(trim(p_idempotency_key),p_telegram_user_id,created_id,p_created_by);
  return query select created_id,false;
end $$;
revoke all on function public.create_telegram_catalog_product(text,text,uuid,text,text,text,uuid,uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.create_telegram_catalog_product(text,text,uuid,text,text,text,uuid,uuid,text,text,text,text,text) to service_role;
