-- ─────────────────────────────────────────────────────────────────────────────
-- SUSCRIPCIÓN AL CALENDARIO (Google Calendar, Apple, Outlook) — api/calendar.ts
--
-- Cada usuario (psicóloga o paciente) tiene un enlace privado con un token
-- aleatorio de 64 caracteres. Quien tenga el enlace ve su calendario, así que
-- se puede generar uno nuevo (el anterior deja de funcionar).
-- RLS sin políticas: el navegador solo usa my_calendar_token() y
-- rotate_calendar_token(), que actúan sobre el usuario que llama.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.calendar_feeds (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  token      text not null unique check (token ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.calendar_feeds enable row level security;

-- 64 caracteres hexadecimales aleatorios (dos UUID v4 sin guiones).
create or replace function public.new_calendar_token()
returns text language sql volatile as $fn$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$fn$;
revoke all on function public.new_calendar_token() from public, anon, authenticated;

-- Token del usuario que llama (lo crea la primera vez). Solo usuarios activos.
create or replace function public.my_calendar_token()
returns text
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_token text;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and active) then
    raise exception 'NOT_ALLOWED';
  end if;
  select token into v_token from public.calendar_feeds where user_id = auth.uid();
  if v_token is null then
    insert into public.calendar_feeds (user_id, token) values (auth.uid(), public.new_calendar_token())
    on conflict (user_id) do nothing;
    select token into v_token from public.calendar_feeds where user_id = auth.uid();
  end if;
  return v_token;
end;
$fn$;
revoke all on function public.my_calendar_token() from public, anon;
grant execute on function public.my_calendar_token() to authenticated;

-- Enlace nuevo: el anterior deja de funcionar.
create or replace function public.rotate_calendar_token()
returns text
language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_token text := public.new_calendar_token();
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and active) then
    raise exception 'NOT_ALLOWED';
  end if;
  insert into public.calendar_feeds (user_id, token) values (auth.uid(), v_token)
  on conflict (user_id) do update set token = excluded.token, created_at = now();
  return v_token;
end;
$fn$;
revoke all on function public.rotate_calendar_token() from public, anon;
grant execute on function public.rotate_calendar_token() to authenticated;
