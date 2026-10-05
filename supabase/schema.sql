-- Esquema del área privada de Siloz Psicología (Supabase / Postgres).
--
-- Cómo aplicarlo: Supabase → SQL Editor → New query → pega este archivo → Run.
-- Es idempotente: se puede volver a ejecutar sin romper nada.
--
-- Seguridad: TODO el acceso a los datos pasa por Row Level Security (RLS).
--   · La terapeuta (role = 'admin') ve y gestiona todos los pacientes y citas.
--   · Cada paciente (role = 'patient') solo puede LEER su propio perfil y sus
--     propias citas. No puede crear, modificar ni borrar nada.
-- Aunque alguien manipulara la web, la base de datos rechaza lo que no le toca.

-- ─────────────────────────────────────────────────────────────────────────────
-- Perfiles: un registro por usuario de Supabase Auth.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        text not null default 'patient' check (role in ('admin', 'patient')),
  full_name   text not null default '',
  email       text not null default '',
  phone       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Citas.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.appointments (
  id                uuid primary key default gen_random_uuid(),
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  starts_at         timestamptz not null,
  duration_minutes  integer not null default 50 check (duration_minutes between 5 and 480),
  modality          text not null default 'online' check (modality in ('presencial', 'online')),
  status            text not null default 'programada'
                    check (status in ('programada', 'realizada', 'cancelada')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- La consulta es solo online (se mantiene 'presencial' como valor válido por si
-- algún día cambia).
alter table public.appointments alter column modality set default 'online';

-- Las sesiones solo empiezan en punto o a y media (España tiene desfases de
-- horas enteras, así que los minutos en UTC son los mismos que en local).
-- NOT VALID: no se revisan citas ya existentes, pero sí toda cita nueva o editada.
do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_half_hour') then
    alter table public.appointments add constraint appointments_half_hour
      check (extract(minute from starts_at) in (0, 30) and extract(second from starts_at) = 0) not valid;
  end if;
end
$do$;

create index if not exists appointments_patient_starts_idx
  on public.appointments (patient_id, starts_at desc);
create index if not exists appointments_starts_idx
  on public.appointments (starts_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- ¿El usuario actual es la terapeuta? (security definer para no entrar en
-- recursión con las propias políticas de profiles).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ¿La cuenta del usuario actual está activa? (Silvia puede desactivar el
-- acceso de un paciente sin borrar su historial.)
create or replace function public.is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active
  );
$$;

revoke all on function public.is_active() from public, anon;
grant execute on function public.is_active() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Al crear un usuario en Auth (p. ej. al invitar a un paciente) se crea su
-- perfil automáticamente con rol 'patient'. El rol 'admin' NUNCA se asigna
-- desde aquí: se pone a mano (ver final del archivo).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Solo la invoca el trigger; nadie debe poder llamarla por la API.
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Mantener updated_at al día.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists appointments_touch_updated_at on public.appointments;
create trigger appointments_touch_updated_at
  before update on public.appointments
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles     enable row level security;
alter table public.appointments enable row level security;

-- Perfiles
drop policy if exists "profiles: leer el propio o admin" on public.profiles;
create policy "profiles: leer el propio o admin"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles: admin actualiza" on public.profiles;
create policy "profiles: admin actualiza"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- (No hay política de insert/delete en profiles: los perfiles los crea el
--  trigger y se borran en cascada al borrar el usuario en Auth.)

-- Citas
drop policy if exists "citas: paciente ve las suyas, admin todas" on public.appointments;
create policy "citas: paciente ve las suyas, admin todas"
  on public.appointments for select
  to authenticated
  using ((patient_id = auth.uid() and public.is_active()) or public.is_admin());

drop policy if exists "citas: admin crea" on public.appointments;
create policy "citas: admin crea"
  on public.appointments for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "citas: admin modifica" on public.appointments;
create policy "citas: admin modifica"
  on public.appointments for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "citas: admin borra" on public.appointments;
create policy "citas: admin borra"
  on public.appointments for delete
  to authenticated
  using (public.is_admin());

-- Impedir que un usuario se cambie a sí mismo el rol (defensa extra: aunque
-- la política de update ya exige admin, esto evita que un admin se degrade
-- por error y se quede sin acceso).
create or replace function public.protect_own_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role and old.id = auth.uid() then
    raise exception 'No puedes cambiar tu propio rol';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_own_role on public.profiles;
create trigger profiles_protect_own_role
  before update on public.profiles
  for each row execute function public.protect_own_role();

-- ─────────────────────────────────────────────────────────────────────────────
-- Control de pagos.
--   · profiles.process_type: proceso individual o de pareja (lo asigna Silvia).
--   · appointments.session_type / price_cents: tarifa aplicada a la cita
--     (precio congelado al crearla) y paid_at: cuándo se cobró (null = pendiente).
--   · bonos: bono de N sesiones; cada cita de tipo 'bono' consume una.
-- Tarifas vigentes en client/src/lib/tariffs.ts.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists process_type text check (process_type in ('individual', 'pareja'));

create table if not exists public.bonos (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  sessions_total  integer not null default 5 check (sessions_total > 0),
  price_cents     integer not null default 25000 check (price_cents >= 0),
  paid_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists bonos_patient_idx on public.bonos (patient_id);
alter table public.bonos enable row level security;

alter table public.appointments
  add column if not exists session_type text not null default 'individual'
    check (session_type in ('primera', 'individual', 'pareja', 'bono')),
  add column if not exists price_cents integer not null default 0 check (price_cents >= 0),
  add column if not exists paid_at timestamptz,
  add column if not exists bono_id uuid references public.bonos (id) on delete restrict;
create index if not exists appointments_bono_idx on public.appointments (bono_id);

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_bono_coherente') then
    alter table public.appointments add constraint appointments_bono_coherente
      check ((session_type = 'bono') = (bono_id is not null));
  end if;
end
$do$;

drop policy if exists "bonos: paciente ve los suyos, admin todos" on public.bonos;
create policy "bonos: paciente ve los suyos, admin todos"
  on public.bonos for select
  to authenticated
  using ((patient_id = auth.uid() and public.is_active()) or public.is_admin());

drop policy if exists "bonos: admin crea" on public.bonos;
create policy "bonos: admin crea"
  on public.bonos for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "bonos: admin modifica" on public.bonos;
create policy "bonos: admin modifica"
  on public.bonos for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "bonos: admin borra" on public.bonos;
create policy "bonos: admin borra"
  on public.bonos for delete
  to authenticated
  using (public.is_admin());

-- Solo una primera sesión (no cancelada) por paciente.
create unique index if not exists appointments_una_primera_por_paciente
  on public.appointments (patient_id)
  where session_type = 'primera' and status <> 'cancelada';

-- Un bono solo vale para su paciente y no admite más citas (no canceladas)
-- que sesiones tiene.
create or replace function public.check_bono_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  b record;
  used integer;
begin
  if new.bono_id is null or new.status = 'cancelada' then
    return new;
  end if;
  select patient_id, sessions_total into b from public.bonos where id = new.bono_id;
  if b.patient_id is distinct from new.patient_id then
    raise exception 'El bono no pertenece a este paciente';
  end if;
  select count(*) into used from public.appointments
   where bono_id = new.bono_id and status <> 'cancelada' and id <> new.id;
  if used >= b.sessions_total then
    raise exception 'El bono ya no tiene sesiones disponibles';
  end if;
  return new;
end;
$fn$;

revoke all on function public.check_bono_usage() from public, anon, authenticated;

drop trigger if exists appointments_check_bono on public.appointments;
create trigger appointments_check_bono
  before insert or update on public.appointments
  for each row execute function public.check_bono_usage();

-- ─────────────────────────────────────────────────────────────────────────────
-- Días reservados a Psicolink (el otro gabinete). Por defecto miércoles y
-- viernes (regla en client/src/lib/psicolink.ts); aquí solo se guardan los
-- cambios puntuales. Solo los ve y cambia la terapeuta.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.agenda_days (
  day         date primary key,
  psicolink   boolean not null,
  updated_at  timestamptz not null default now()
);
alter table public.agenda_days enable row level security;

drop policy if exists "agenda_days: admin lee" on public.agenda_days;
create policy "agenda_days: admin lee"
  on public.agenda_days for select to authenticated using (public.is_admin());
drop policy if exists "agenda_days: admin crea" on public.agenda_days;
create policy "agenda_days: admin crea"
  on public.agenda_days for insert to authenticated with check (public.is_admin());
drop policy if exists "agenda_days: admin modifica" on public.agenda_days;
create policy "agenda_days: admin modifica"
  on public.agenda_days for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- DAR ACCESO DE ADMINISTRADORA A SILVIA (ejecutar UNA vez, a mano):
--
--   1. Supabase → Authentication → Users → "Add user" → "Send invitation"
--      (o "Create new user") con el email de Silvia.
--   2. Después ejecuta aquí, cambiando el email:
--
--      update public.profiles
--         set role = 'admin', full_name = 'Silvia'
--       where email = 'EMAIL_DE_SILVIA@ejemplo.com';
-- ─────────────────────────────────────────────────────────────────────────────
