-- 05transferfeeprop — transfer_holding reparte la comisión en forma proporcional
--
-- Antes, en una transferencia parcial la comisión de compra (fee) quedaba
-- entera en el lote origen y el lote destino nacía sin comisión: el total del
-- portfolio era correcto, pero el costo por unidad del remanente subía y la
-- ganancia por lote quedaba distorsionada. Ahora la comisión se reparte en
-- proporción a la cantidad transferida, igual que la imputa sell_holding:
--   - el lote origen se queda con fee × (cantidad que queda / cantidad original)
--   - el destino recibe fee × (cantidad transferida / cantidad original),
--     sumada a la que ya tenga si se fusiona con un lote idéntico.
-- La transferencia total no cambia: el lote se reubica con toda su comisión.
-- Los lotes ya transferidos no se recalculan.

create or replace function public.transfer_holding(
  p_from_holding_id uuid,
  p_quantity        numeric,
  p_to_source_name  text,
  p_to_source_type  text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_src            public.holdings%rowtype;
  v_portfolio_id   uuid;
  v_symbol         text;
  v_to_name        text := nullif(btrim(p_to_source_name), '');
  v_to_type        text;
  v_full           boolean;
  v_merged         boolean := false;
  v_to_holding_id  uuid;
  v_transfer_id    uuid;
  v_note           text;
  v_fee_part       numeric;
begin
  if p_from_holding_id is null then
    raise exception 'p_from_holding_id es obligatorio' using errcode = '22004';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La cantidad a transferir debe ser mayor a 0' using errcode = '22023';
  end if;

  if v_to_name is null then
    raise exception 'La sede destino es obligatoria' using errcode = '22023';
  end if;

  -- Portfolio y símbolo del lote, solo si el portfolio es del usuario.
  select h.portfolio_id, h.symbol into v_portfolio_id, v_symbol
  from public.holdings h
  join public.portfolios p on p.id = h.portfolio_id
  where h.id = p_from_holding_id
    and p.user_id = auth.uid();

  if not found then
    raise exception 'Holding % no encontrado', p_from_holding_id using errcode = 'P0002';
  end if;

  -- Serializa las transferencias de este activo en este portfolio.
  perform pg_advisory_xact_lock(
    hashtextextended('transfer_holding:' || v_portfolio_id::text || ':' || v_symbol, 0)
  );

  -- Relee el lote bloqueado (pudo cambiar mientras se esperaba el lock).
  select h.* into v_src
  from public.holdings h
  where h.id = p_from_holding_id
    and h.portfolio_id = v_portfolio_id
  for update;

  if not found then
    raise exception 'Holding % no encontrado', p_from_holding_id using errcode = 'P0002';
  end if;

  if p_quantity > v_src.quantity then
    raise exception 'Cantidad insuficiente: se pidieron %, el lote tiene %',
      p_quantity, v_src.quantity using errcode = '22023';
  end if;

  v_to_type := coalesce(nullif(btrim(p_to_source_type), ''), v_src.source_type);

  if lower(v_to_name) = lower(btrim(v_src.source_name))
     and v_to_type = v_src.source_type then
    raise exception 'La sede destino es la misma que la de origen' using errcode = '22023';
  end if;

  -- Reutiliza el nombre de la sede si ya existe en el portfolio.
  v_to_name := coalesce(
    (select h.source_name
     from public.holdings h
     where h.portfolio_id = v_src.portfolio_id
       and lower(btrim(h.source_name)) = lower(v_to_name)
     order by h.created_at, h.id
     limit 1),
    v_to_name
  );

  v_full := p_quantity = v_src.quantity;

  if v_full then
    -- Reubica el lote entero: mismo id, misma fee, nueva sede.
    update public.holdings
    set source_name = v_to_name,
        source_type = v_to_type,
        updated_at  = now()
    where id = v_src.id;

    v_to_holding_id := v_src.id;
  else
    -- Parte de la comisión de compra que viaja con las unidades transferidas,
    -- proporcional a la cantidad (igual que la imputa sell_holding). Si el lote
    -- no tiene comisión queda null.
    v_fee_part := v_src.fee * p_quantity / v_src.quantity;

    -- ¿Ya existe el mismo lote en la sede destino?
    select h.id into v_to_holding_id
    from public.holdings h
    where h.portfolio_id = v_src.portfolio_id
      and h.symbol       = v_src.symbol
      and h.asset_class  = v_src.asset_class
      and lower(btrim(h.source_name)) = lower(v_to_name)
      and h.source_type  = v_to_type
      and h.id          <> v_src.id
      and h.cost_basis    is not distinct from v_src.cost_basis
      and h.acquired_at   is not distinct from v_src.acquired_at
      and h.ratio         is not distinct from v_src.ratio
      and h.lockup_expiry is not distinct from v_src.lockup_expiry
    order by h.created_at, h.id
    limit 1
    for update;

    v_merged := v_to_holding_id is not null;

    if v_merged then
      update public.holdings
      set quantity   = quantity + p_quantity,
          fee        = case when v_fee_part is null then fee else coalesce(fee, 0) + v_fee_part end,
          updated_at = now()
      where id = v_to_holding_id;
    else
      insert into public.holdings (
        portfolio_id, symbol, asset_class, quantity, cost_basis,
        source_type, source_name, acquired_at, notes, fee, lockup_expiry, ratio
      ) values (
        v_src.portfolio_id, v_src.symbol, v_src.asset_class, p_quantity, v_src.cost_basis,
        v_to_type, v_to_name, v_src.acquired_at, v_src.notes, v_fee_part,
        v_src.lockup_expiry, v_src.ratio
      )
      returning id into v_to_holding_id;
    end if;

    update public.holdings
    set quantity   = quantity - p_quantity,
        fee        = fee - v_fee_part,
        updated_at = now()
    where id = v_src.id;
  end if;

  insert into public.transfers (
    portfolio_id, symbol, quantity, from_holding_id, to_holding_id,
    from_source_name, to_source_name
  ) values (
    v_src.portfolio_id, v_src.symbol, p_quantity, v_src.id,
    v_to_holding_id, v_src.source_name, v_to_name
  )
  returning id into v_transfer_id;

  v_note := format('Transferencia %s → %s (transfer %s)', v_src.source_name, v_to_name, v_transfer_id);

  insert into public.transactions (portfolio_id, symbol, asset_class, type, quantity, price, notes)
  values
    (v_src.portfolio_id, v_src.symbol, v_src.asset_class, 'transfer_out', p_quantity, null, v_note),
    (v_src.portfolio_id, v_src.symbol, v_src.asset_class, 'transfer_in',  p_quantity, null, v_note);

  return jsonb_build_object(
    'transfer_id',     v_transfer_id,
    'from_holding_id', v_src.id,
    'to_holding_id',   v_to_holding_id,
    'quantity',        p_quantity,
    'merged',          v_merged,
    'relocated',       v_full
  );
end;
$$;

revoke all on function public.transfer_holding(uuid, numeric, text, text) from public, anon;
grant execute on function public.transfer_holding(uuid, numeric, text, text) to authenticated;

comment on function public.transfer_holding(uuid, numeric, text, text) is
  'Transfiere unidades de un lote entre sedes propias del mismo portfolio, conservando costo por unidad, fecha de adquisición y lockup. No genera venta ni borra lotes. Issue #14.';
