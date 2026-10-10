create table if not exists public.telegram_accounts (
  telegram_user_id text primary key check (telegram_user_id ~ '^[0-9]{1,30}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, telegram_user_id)
);

create table if not exists public.telegram_catalog_operations (
  idempotency_key text primary key check (length(idempotency_key) between 16 and 128),
  telegram_user_id text not null references public.telegram_accounts(telegram_user_id) on delete restrict,
  product_id uuid not null references public.catalog_products(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.telegram_accounts enable row level security;
alter table public.telegram_catalog_operations enable row level security;

create policy "admins manage telegram accounts" on public.telegram_accounts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins read telegram operations" on public.telegram_catalog_operations
  for select to authenticated using (public.is_admin());

create index if not exists telegram_operations_product_idx on public.telegram_catalog_operations(product_id);
