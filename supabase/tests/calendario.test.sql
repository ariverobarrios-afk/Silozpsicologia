-- Enlace privado del calendario: cada usuario obtiene y renueva el suyo;
-- nadie lee la tabla directamente. Se ejecuta con supabase/tests/run.sh
-- (después de consentimiento.test.sql, sobre la misma base de datos).
\set ON_ERROR_STOP 1
\set QUIET 1

create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALLO: %', msg; end if;
end $$;
create or replace function pg_temp.expect_error(stmt text, pattern text) returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    if sqlerrm not ilike '%' || pattern || '%' then raise exception 'FALLO: se esperaba «%» y llegó «%»', pattern, sqlerrm; end if;
    return;
  end;
  raise exception 'FALLO: se esperaba el error «%» (%)', pattern, stmt;
end $$;

\set c1 '00000000-0000-0000-0000-0000000000f1'
\set c2 '00000000-0000-0000-0000-0000000000f2'
insert into public.profiles (id, role, full_name, email, active) values
  (:'c1', 'patient', 'Cal Uno', 'c1@example.com', true),
  (:'c2', 'patient', 'Cal Dos', 'c2@example.com', false);

set role authenticated;
select set_config('request.jwt.claim.sub', :'c1', false);
select public.my_calendar_token() as t1 \gset
select pg_temp.ok(:'t1' ~ '^[0-9a-f]{64}$', 'token de 64 hex');
select pg_temp.ok(public.my_calendar_token() = :'t1', 'el mismo token al volver a pedirlo');
select public.rotate_calendar_token() as t2 \gset
select pg_temp.ok(:'t2' <> :'t1' and public.my_calendar_token() = :'t2', 'enlace nuevo sustituye al anterior');
select pg_temp.ok((select count(*) from public.calendar_feeds) = 0, 'no se lee la tabla directamente');
select pg_temp.expect_error('select public.new_calendar_token()', 'permission denied');
-- Usuario desactivado o sin sesión: no.
select set_config('request.jwt.claim.sub', :'c2', false);
select pg_temp.expect_error('select public.my_calendar_token()', 'NOT_ALLOWED');
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect_error('select public.my_calendar_token()', 'NOT_ALLOWED');
reset role;
select pg_temp.ok((select count(*) from public.calendar_feeds where user_id = :'c1') = 1, 'una fila por usuario');

\echo 'calendario.test.sql: OK'
