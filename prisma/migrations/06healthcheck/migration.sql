-- 06healthcheck — función mínima para el chequeo de salud (GET /health)
--
-- /health verifica que la base responda, pero corre sin usuario (con la clave
-- anon) y 01init le quitó a anon el acceso a todas las tablas: la consulta a
-- price_cache que hacía siempre fallaba y el endpoint respondía 503.
--
-- En vez de abrirle una tabla a anon, se expone una función que no lee
-- ninguna: si responde, PostgREST y Postgres están arriba. SECURITY INVOKER y
-- sin acceso a datos, así que no le da a anon nada más que saber que la base
-- está viva.

create or replace function public.health_check()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select true
$$;

revoke all on function public.health_check() from public;
grant execute on function public.health_check() to anon, authenticated, service_role;

comment on function public.health_check() is
  'Chequeo de salud para GET /health: no lee datos; si responde, la base está arriba.';
