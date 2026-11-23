-- 01init — schema inicial de StonksView en Supabase.
--
-- Generado a partir de prisma/schema.prisma + los CHECK documentados en sus
-- comentarios + lo que Prisma no representa: RLS, grants y triggers.
--
-- Modelo de seguridad:
--   - Todo lo que cuelga de un portfolio solo es visible/editable si
--     portfolios.user_id = auth.uid().
--   - Tablas por usuario (push_subscriptions, news_watches, price_alerts):
--     user_id = auth.uid().
--   - price_cache / price_history_cache: compartidas, solo lectura para
--     usuarios logueados; las escribe el backend con service_role.
--   - transfers, sales y ai_insights son append-only (sin UPDATE/DELETE).
--   - anon no tiene acceso a nada.
--
-- user_id referencia auth.users(id) como uuid plano (igual que en Prisma).
-- Ninguna FK tiene ON DELETE CASCADE (igual que la base original).
--
-- Baseline de Prisma: en una base donde ya se aplicó, marcarla con
--   npx prisma migrate resolve --applied 01init

-- ============================== Tablas ==============================

create table public.portfolios (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid(),
  name           text not null,
  base_currency  text not null default 'USD',
  created_at     timestamptz(6) not null default now()
);
create index portfolios_user_id_idx on public.portfolios (user_id);

create table public.holdings (
  id             uuid primary key default gen_random_uuid(),
  portfolio_id   uuid not null references public.portfolios (id),
  symbol         text not null,
  asset_class    text not null check (asset_class in ('crypto','stock','etf','forex','other','cedear')),
  quantity       numeric not null check (quantity > 0),
  cost_basis     numeric check (cost_basis >= 0),
  source_type    text not null check (source_type in ('exchange','wallet','broker','other')),
  source_name    text not null,
  acquired_at    timestamptz(6),
  notes          text,
  created_at     timestamptz(6) not null default now(),
  fee            numeric check (fee >= 0),
  lockup_expiry  timestamptz(6),
  updated_at     timestamptz(6) not null default now(),
  ratio          numeric check (ratio > 0)
);
create index holdings_portfolio_id_idx on public.holdings (portfolio_id);
create index holdings_symbol_idx on public.holdings (symbol);

create table public.transactions (
  id            uuid primary key default gen_random_uuid(),
  portfolio_id  uuid not null references public.portfolios (id),
  symbol        text not null,
  asset_class   text not null check (asset_class in ('crypto','stock','etf','forex','other','cedear')),
  type          text not null check (type in ('buy','sell','transfer_in','transfer_out')),
  quantity      numeric not null check (quantity > 0),
  price         numeric check (price >= 0),
  occurred_at   timestamptz(6) not null default now(),
  notes         text
);
create index transactions_portfolio_id_idx on public.transactions (portfolio_id);

create table public.price_cache (
  symbol              text not null,
  asset_class         text not null,
  source              text not null,
  price               numeric not null,
  currency            text not null default 'USD',
  change_percent_24h  numeric,
  fetched_at          timestamptz(6) not null default now(),
  primary key (symbol, asset_class, source)
);

create table public.price_history_cache (
  symbol       text not null,
  asset_class  text not null,
  days         integer not null,
  points       jsonb not null,
  fetched_at   timestamptz(6) not null default now(),
  primary key (symbol, asset_class, days)
);

create table public.transfers (
  id                uuid primary key default gen_random_uuid(),
  portfolio_id      uuid not null references public.portfolios (id),
  symbol            text not null,
  quantity          numeric not null check (quantity > 0),
  from_holding_id   uuid references public.holdings (id),
  to_holding_id     uuid references public.holdings (id),
  from_source_name  text not null,
  to_source_name    text not null,
  created_at        timestamptz(6) not null default now()
);
create index transfers_portfolio_id_idx on public.transfers (portfolio_id);
create index transfers_from_holding_id_idx on public.transfers (from_holding_id);
create index transfers_to_holding_id_idx on public.transfers (to_holding_id);

create table public.sales (
  id             uuid primary key default gen_random_uuid(),
  portfolio_id   uuid not null references public.portfolios (id),
  symbol         text not null,
  quantity       numeric not null check (quantity > 0),
  sale_price     numeric not null check (sale_price >= 0),
  proceeds       numeric not null,
  cost_basis     numeric not null,
  realized_gain  numeric not null,
  method         text not null check (method in ('fifo','lifo')),
  lots_consumed  jsonb not null,
  sold_at        timestamptz(6) not null,
  created_at     timestamptz(6) not null default now()
);
create index sales_portfolio_id_idx on public.sales (portfolio_id);

create table public.snapshots (
  id                uuid primary key default gen_random_uuid(),
  portfolio_id      uuid not null references public.portfolios (id),
  label             text,
  total_value       numeric not null,
  total_cost_basis  numeric not null,
  by_asset_class    jsonb not null,
  holdings          jsonb not null,
  created_at        timestamptz(6) not null default now()
);
create index snapshots_portfolio_id_idx on public.snapshots (portfolio_id);

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz(6) not null default now()
);
create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

create table public.price_alerts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid(),
  portfolio_id    uuid not null references public.portfolios (id),
  symbol          text not null,
  asset_class     text not null check (asset_class in ('crypto','stock','etf','forex','other','cedear')),
  source_name     text,
  condition       text not null check (condition in ('above','below')),
  target_price    numeric not null check (target_price > 0),
  active          boolean not null default true,
  triggered_at    timestamptz(6),
  created_at      timestamptz(6) not null default now(),
  kind            text not null default 'price' check (kind in ('price','percent')),
  percent_change  numeric,
  base_price      numeric
);
create index price_alerts_user_id_idx on public.price_alerts (user_id);
create index price_alerts_active_idx on public.price_alerts (active);
create index price_alerts_portfolio_id_idx on public.price_alerts (portfolio_id);

create table public.news_watches (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null default auth.uid(),
  symbol                 text not null,
  last_notified_item_id  text,
  created_at             timestamptz(6) not null default now()
);
create index news_watches_user_id_idx on public.news_watches (user_id);

create table public.ai_insights (
  id                uuid primary key default gen_random_uuid(),
  portfolio_id      uuid not null references public.portfolios (id),
  contexto_enviado  jsonb not null,
  respuesta_texto   text,
  estado            text not null default 'ok' check (estado in ('ok','no_disponible')),
  created_at        timestamptz(6) not null default now()
);
create index ai_insights_portfolio_id_idx on public.ai_insights (portfolio_id);

-- ============================== Triggers ==============================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger holdings_set_updated_at
  before update on public.holdings
  for each row execute function public.set_updated_at();

-- ============================== RLS ==============================

alter table public.portfolios          enable row level security;
alter table public.holdings            enable row level security;
alter table public.transactions        enable row level security;
alter table public.price_cache         enable row level security;
alter table public.price_history_cache enable row level security;
alter table public.transfers           enable row level security;
alter table public.sales               enable row level security;
alter table public.snapshots           enable row level security;
alter table public.push_subscriptions  enable row level security;
alter table public.price_alerts        enable row level security;
alter table public.news_watches        enable row level security;
alter table public.ai_insights         enable row level security;

-- portfolios: dueño directo
create policy portfolios_owner_all on public.portfolios
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Tablas que cuelgan de un portfolio: el portfolio tiene que ser del usuario.
-- (El subselect sobre portfolios ya pasa por su propia RLS.)
create policy holdings_owner_all on public.holdings
  for all to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())));

create policy transactions_owner_all on public.transactions
  for all to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())));

create policy snapshots_owner_all on public.snapshots
  for all to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())));

-- Append-only: SELECT + INSERT
create policy transfers_owner_select on public.transfers
  for select to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())));
create policy transfers_owner_insert on public.transfers
  for insert to authenticated
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())));

create policy sales_owner_select on public.sales
  for select to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())));
create policy sales_owner_insert on public.sales
  for insert to authenticated
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())));

create policy ai_insights_owner_select on public.ai_insights
  for select to authenticated
  using (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())));
create policy ai_insights_owner_insert on public.ai_insights
  for insert to authenticated
  with check (exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid())));

-- Por usuario
create policy push_subscriptions_owner_all on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy news_watches_owner_all on public.news_watches
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy price_alerts_owner_all on public.price_alerts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.portfolios p where p.id = portfolio_id and p.user_id = (select auth.uid()))
  );

-- Caches compartidas: lectura para logueados, escritura solo service_role
create policy price_cache_read on public.price_cache
  for select to authenticated using (true);
create policy price_history_cache_read on public.price_history_cache
  for select to authenticated using (true);

-- ============================== Grants ==============================
-- Explícitos: no dependemos del "auto-grant" del proyecto.

revoke all on all tables in schema public from anon, authenticated;

grant select, insert, update, delete on
  public.portfolios, public.holdings, public.transactions, public.snapshots,
  public.push_subscriptions, public.news_watches, public.price_alerts
  to authenticated;
grant select, insert on public.transfers, public.sales, public.ai_insights to authenticated;
grant select on public.price_cache, public.price_history_cache to authenticated;

grant all on all tables in schema public to service_role;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
