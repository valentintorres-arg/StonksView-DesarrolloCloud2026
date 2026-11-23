-- transfer_holding — issue #14 (1.3)
--
-- Transferencia interna de una tenencia entre dos sedes propias (exchange,
-- wallet, broker...) dentro del mismo portfolio. NO es una venta: no genera
-- fila en `sales` ni altera el costo base.
--
-- Modelo de lotes: cada fila de `holdings` es un lote con su `cost_basis`
-- POR UNIDAD y su `acquired_at`. Un mismo símbolo puede tener varios lotes
-- (BTC comprado a 30k y a 60k). Por eso la transferencia mueve unidades de
-- UN lote:
--   - Transferencia total: el lote se reubica (se le cambia la sede). Conserva
--     su id, así el historial de `transfers` sigue enlazado y nunca se borra
--     un lote. Su `fee` viaja con él.
--   - Transferencia parcial: se descuenta del lote origen y en destino se
--     suma a un lote existente solo si es "el mismo lote" (mismo símbolo,
--     clase, costo por unidad, fecha de adquisición, ratio y lockup), o se
--     crea uno nuevo copiando esos datos. `fee` (comisión de la compra
--     original) queda en el lote origen.
-- Nunca promedia lotes distintos: eso rompería la ganancia realizada y el
-- orden FIFO/LIFO de sell_holding.
--
-- Sedes: se comparan sin distinguir mayúsculas ni espacios ("binance" es
-- "Binance"). Si la sede destino ya existe en el portfolio se reutiliza su
-- nombre tal como está guardado.
--
-- Registro: una fila en `transfers` y el par transfer_out / transfer_in en
-- `transactions` (sin precio: no es una operación de mercado).
--
-- Seguridad: SECURITY INVOKER — corre con el usuario que llama vía RPC, así
-- que RLS aplica. Además se verifica explícitamente que el portfolio sea de
-- auth.uid(). Requiere policies de SELECT/INSERT/UPDATE en holdings e INSERT
-- en transfers y transactions (no necesita UPDATE ni DELETE en transfers).
--
-- Concurrencia: todo ocurre en la transacción de la llamada. Se toma un
-- advisory lock por (portfolio, símbolo) antes de bloquear filas, así todas
-- las transferencias de un mismo activo en un portfolio se serializan: no hay
-- deadlocks entre transferencias cruzadas ni lotes destino duplicados.
--
-- Idempotente: se puede volver a correr (CREATE OR REPLACE).
-- Uso desde el backend:
--   supabase.rpc('transfer_holding', {
--     p_from_holding_id, p_quantity, p_to_source_name, p_to_source_type
--   })

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
          updated_at = now()
      where id = v_to_holding_id;
    else
      insert into public.holdings (
        portfolio_id, symbol, asset_class, quantity, cost_basis,
        source_type, source_name, acquired_at, notes, fee, lockup_expiry, ratio
      ) values (
        v_src.portfolio_id, v_src.symbol, v_src.asset_class, p_quantity, v_src.cost_basis,
        v_to_type, v_to_name, v_src.acquired_at, v_src.notes, null,
        v_src.lockup_expiry, v_src.ratio
      )
      returning id into v_to_holding_id;
    end if;

    update public.holdings
    set quantity   = quantity - p_quantity,
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
