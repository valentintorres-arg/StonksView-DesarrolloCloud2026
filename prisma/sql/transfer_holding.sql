-- transfer_holding — issue #14 (1.3)
--
-- Transferencia interna de una tenencia entre dos sedes propias (exchange,
-- wallet, broker...) dentro del mismo portfolio. NO es una venta: no genera
-- fila en `sales` ni altera el costo base.
--
-- Modelo de lotes: cada fila de `holdings` es un lote con su `cost_basis`
-- POR UNIDAD y su `acquired_at`. Un mismo símbolo puede tener varios lotes
-- (BTC comprado a 30k y a 60k). Por eso la transferencia mueve unidades de
-- UN lote y en destino:
--   - suma a un lote existente solo si es "el mismo lote" (mismo símbolo,
--     clase, costo por unidad, fecha de adquisición y ratio), o
--   - crea un lote nuevo copiando costo por unidad, fecha, ratio y lockup.
-- Nunca promedia lotes distintos: eso rompería la ganancia realizada y el
-- orden FIFO/LIFO de sell_holding.
--
-- Si se transfiere el lote completo, el lote origen se borra y la fila en
-- `transfers` queda con from_holding_id = NULL (las FKs no tienen CASCADE).
--
-- `fee` es la comisión de la compra original: queda en el lote origen y no
-- se reparte. Si el origen se transfiere entero (y se borra), su fee pasa al
-- lote destino: se copia si el lote es nuevo o se suma si ya existía.
--
-- Seguridad: SECURITY INVOKER — corre con el usuario que llama vía RPC, así
-- que RLS aplica. Además se verifica explícitamente que el portfolio sea de
-- auth.uid(). Atomicidad: todo ocurre en la transacción de la llamada y el
-- lote origen se bloquea con FOR UPDATE, así que dos transferencias
-- simultáneas sobre el mismo lote se serializan.
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
  v_to_name        text := nullif(btrim(p_to_source_name), '');
  v_to_type        text;
  v_full           boolean;
  v_merged         boolean;
  v_to_holding_id  uuid;
  v_transfer_id    uuid;
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

  -- Lote origen, bloqueado, y solo si el portfolio es del usuario autenticado.
  select h.* into v_src
  from public.holdings h
  join public.portfolios p on p.id = h.portfolio_id
  where h.id = p_from_holding_id
    and p.user_id = auth.uid()
  for update of h;

  if not found then
    raise exception 'Holding % no encontrado', p_from_holding_id using errcode = 'P0002';
  end if;

  if p_quantity > v_src.quantity then
    raise exception 'Cantidad insuficiente: se pidieron %, el lote tiene %',
      p_quantity, v_src.quantity using errcode = '22023';
  end if;

  v_to_type := coalesce(nullif(btrim(p_to_source_type), ''), v_src.source_type);

  if v_to_name = v_src.source_name and v_to_type = v_src.source_type then
    raise exception 'La sede destino es la misma que la de origen' using errcode = '22023';
  end if;

  v_full := p_quantity = v_src.quantity;

  -- ¿Ya existe el mismo lote en la sede destino?
  select h.id into v_to_holding_id
  from public.holdings h
  where h.portfolio_id = v_src.portfolio_id
    and h.symbol       = v_src.symbol
    and h.asset_class  = v_src.asset_class
    and h.source_name  = v_to_name
    and h.source_type  = v_to_type
    and h.id          <> v_src.id
    and h.cost_basis  is not distinct from v_src.cost_basis
    and h.acquired_at is not distinct from v_src.acquired_at
    and h.ratio       is not distinct from v_src.ratio
  order by h.created_at
  limit 1
  for update;

  v_merged := v_to_holding_id is not null;

  if v_merged then
    update public.holdings
    set quantity   = quantity + p_quantity,
        -- Si el origen se borra entero, su fee no se pierde: se suma al destino.
        fee        = case
                       when v_full and v_src.fee is not null then coalesce(fee, 0) + v_src.fee
                       else fee
                     end,
        updated_at = now()
    where id = v_to_holding_id;
  else
    insert into public.holdings (
      portfolio_id, symbol, asset_class, quantity, cost_basis,
      source_type, source_name, acquired_at, notes, fee, lockup_expiry, ratio
    ) values (
      v_src.portfolio_id, v_src.symbol, v_src.asset_class, p_quantity, v_src.cost_basis,
      v_to_type, v_to_name, v_src.acquired_at, v_src.notes,
      case when v_full then v_src.fee end,
      v_src.lockup_expiry, v_src.ratio
    )
    returning id into v_to_holding_id;
  end if;

  if v_full then
    -- Las transferencias viejas que apuntan a este lote pierden la referencia
    -- (conservan symbol/sedes/cantidad), así el lote se puede borrar.
    update public.transfers set from_holding_id = null where from_holding_id = v_src.id;
    update public.transfers set to_holding_id   = null where to_holding_id   = v_src.id;
    delete from public.holdings where id = v_src.id;
  else
    update public.holdings
    set quantity   = quantity - p_quantity,
        updated_at = now()
    where id = v_src.id;
  end if;

  insert into public.transfers (
    portfolio_id, symbol, quantity, from_holding_id, to_holding_id,
    from_source_name, to_source_name
  ) values (
    v_src.portfolio_id, v_src.symbol, p_quantity,
    case when v_full then null else v_src.id end,
    v_to_holding_id, v_src.source_name, v_to_name
  )
  returning id into v_transfer_id;

  return jsonb_build_object(
    'transfer_id',     v_transfer_id,
    'from_holding_id', case when v_full then null else v_src.id end,
    'to_holding_id',   v_to_holding_id,
    'quantity',        p_quantity,
    'merged',          v_merged
  );
end;
$$;

revoke all on function public.transfer_holding(uuid, numeric, text, text) from public, anon;
grant execute on function public.transfer_holding(uuid, numeric, text, text) to authenticated;

comment on function public.transfer_holding(uuid, numeric, text, text) is
  'Transfiere unidades de un lote entre sedes propias del mismo portfolio, conservando costo por unidad y fecha de adquisición. No genera venta. Issue #14.';
