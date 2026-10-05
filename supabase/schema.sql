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
  modality          text not null default 'presencial' check (modality in ('presencial', 'online')),
  status            text not null default 'programada'
                    check (status in ('programada', 'realizada', 'cancelada')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

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

revoke all on function public.is_admin() from public;
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

revoke all on function public.is_active() from public;
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Mantener updated_at al día.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
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
