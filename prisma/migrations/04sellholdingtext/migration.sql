-- 04sellholdingtext — sell_holding devuelve los montos como texto decimal
--
-- Los numeric dentro de un jsonb llegan al cliente como number de JSON y en
-- JavaScript se parsean como float: un costo o una ganancia con muchos
-- decimales puede perder precisión. Esta migración recrea sell_holding sin
-- cambiar su lógica, pero con las cantidades y montos de la respuesta y de
-- lots_consumed como string (p. ej. "698.00"), igual que los devuelve
-- Postgres. Las ventas ya guardadas no se modifican.

create or replace function public.sell_holding(
  p_portfolio_id uuid,
  p_symbol       text,
  p_asset_class  text,
  p_quantity     numeric,
  p_sale_price   numeric,
  p_method       text        default 'fifo',
  p_sold_at      timestamptz default now(),
  p_source_name  text        default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_symbol      text := nullif(btrim(p_symbol), '');
  v_method      text := lower(btrim(coalesce(p_method, '')));
  v_source      text := nullif(btrim(p_source_name), '');
  v_available   numeric;
  v_remaining   numeric;
  v_take        numeric;
  v_fee_part    numeric;
  v_lot_cost    numeric;
  v_cost_total  numeric := 0;
  v_proceeds    numeric;
  v_lots        jsonb := '[]'::jsonb;
  v_lot         public.holdings%rowtype;
  v_sale_id     uuid;
begin
  if p_portfolio_id is null then
    raise exception 'p_portfolio_id es obligatorio' using errcode = '22004';
  end if;
  if v_symbol is null or p_asset_class is null then
    raise exception 'El símbolo y la clase de activo son obligatorios' using errcode = '22004';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La cantidad a vender debe ser mayor a 0' using errcode = '22023';
  end if;
  if p_sale_price is null or p_sale_price < 0 then
    raise exception 'El precio de venta no puede ser negativo' using errcode = '22023';
  end if;
  if v_method not in ('fifo', 'lifo') then
    raise exception 'El método debe ser fifo o lifo' using errcode = '22023';
  end if;
  if p_sold_at is null then
    raise exception 'La fecha de venta es obligatoria' using errcode = '22004';
  end if;

  if not exists (
    select 1 from public.portfolios p
    where p.id = p_portfolio_id and p.user_id = auth.uid()
  ) then
    raise exception 'Portfolio % no encontrado', p_portfolio_id using errcode = 'P0002';
  end if;

  -- Mismo lock que transfer_holding: serializa ventas y transferencias.
  perform pg_advisory_xact_lock(
    hashtextextended('transfer_holding:' || p_portfolio_id::text || ':' || v_symbol, 0)
  );

  select coalesce(sum(h.quantity), 0) into v_available
  from public.holdings h
  where h.portfolio_id = p_portfolio_id
    and h.symbol = v_symbol
    and h.asset_class = p_asset_class
    and (v_source is null or lower(btrim(h.source_name)) = lower(v_source));

  if p_quantity > v_available then
    raise exception 'Cantidad insuficiente: se pidieron %, hay %', p_quantity, v_available
      using errcode = '22023';
  end if;

  v_remaining := p_quantity;

  for v_lot in
    select h.*
    from public.holdings h
    where h.portfolio_id = p_portfolio_id
      and h.symbol = v_symbol
      and h.asset_class = p_asset_class
      and h.quantity > 0
      and (v_source is null or lower(btrim(h.source_name)) = lower(v_source))
    order by
      case when v_method = 'fifo' then coalesce(h.acquired_at, h.created_at) end asc,
      case when v_method = 'lifo' then coalesce(h.acquired_at, h.created_at) end desc,
      case when v_method = 'fifo' then h.created_at end asc,
      case when v_method = 'lifo' then h.created_at end desc,
      case when v_method = 'fifo' then h.id::text end asc,
      case when v_method = 'lifo' then h.id::text end desc
    for update
  loop
    exit when v_remaining <= 0;

    if v_lot.cost_basis is null then
      raise exception 'El lote % (%) no tiene costo base; cargalo antes de vender',
        v_lot.id, v_lot.source_name using errcode = '22023';
    end if;

    v_take := least(v_remaining, v_lot.quantity);

    -- Comisión proporcional; si se consume el lote entero va la comisión
    -- completa, sin redondeo.
    if v_take = v_lot.quantity then
      v_fee_part := coalesce(v_lot.fee, 0);
    else
      v_fee_part := coalesce(v_lot.fee, 0) * v_take / v_lot.quantity;
    end if;

    v_lot_cost := v_take * v_lot.cost_basis + v_fee_part;
    v_cost_total := v_cost_total + v_lot_cost;

    update public.holdings
    set quantity   = quantity - v_take,
        fee        = case when fee is null then null else fee - v_fee_part end,
        updated_at = now()
    where id = v_lot.id;

    v_lots := v_lots || jsonb_build_array(jsonb_build_object(
      'holding_id',  v_lot.id,
      'source_name', v_lot.source_name,
      'acquired_at', v_lot.acquired_at,
      'quantity',    v_take::text,
      'unit_cost',   v_lot.cost_basis::text,
      'fee',         v_fee_part::text,
      'cost',        v_lot_cost::text
    ));

    v_remaining := v_remaining - v_take;
  end loop;

  v_proceeds := p_quantity * p_sale_price;

  insert into public.sales (
    portfolio_id, symbol, quantity, sale_price, proceeds, cost_basis,
    realized_gain, method, lots_consumed, sold_at
  ) values (
    p_portfolio_id, v_symbol, p_quantity, p_sale_price, v_proceeds, v_cost_total,
    v_proceeds - v_cost_total, v_method, v_lots, p_sold_at
  )
  returning id into v_sale_id;

  insert into public.transactions (
    portfolio_id, symbol, asset_class, type, quantity, price, occurred_at, notes
  ) values (
    p_portfolio_id, v_symbol, p_asset_class, 'sell', p_quantity, p_sale_price, p_sold_at,
    format('Venta %s (sale %s)', upper(v_method), v_sale_id)
  );

  return jsonb_build_object(
    'sale_id',       v_sale_id,
    'quantity',      p_quantity::text,
    'sale_price',    p_sale_price::text,
    'proceeds',      v_proceeds::text,
    'cost_basis',    v_cost_total::text,
    'realized_gain', (v_proceeds - v_cost_total)::text,
    'method',        v_method,
    'lots_consumed', v_lots
  );
end;
$$;

revoke all on function public.sell_holding(uuid, text, text, numeric, numeric, text, timestamptz, text)
  from public, anon;
grant execute on function public.sell_holding(uuid, text, text, numeric, numeric, text, timestamptz, text)
  to authenticated;

comment on function public.sell_holding(uuid, text, text, numeric, numeric, text, timestamptz, text) is
  'Vende un activo consumiendo lotes FIFO/LIFO: calcula proceeds, costo y ganancia realizada, guarda lots_consumed y crea la fila en sales. Issue #15.';
