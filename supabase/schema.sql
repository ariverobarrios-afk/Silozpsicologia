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
-- Facturación.
--   · profiles.tax_id / address: datos fiscales del paciente (opcionales).
--   · invoice_settings: datos del emisor, serie, siguiente número y fecha
--     mínima (una sola fila).
--   · invoices: facturas emitidas, inmutables (sin políticas de insert/update/
--     delete: solo se crean con issue_invoices()). Numeración correlativa sin
--     huecos y fechas no anteriores a la última factura de la serie.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists tax_id text,
  add column if not exists address text;

create table if not exists public.invoice_settings (
  id              integer primary key default 1 check (id = 1),
  issuer_name     text not null default '',
  issuer_tax_id   text not null default '',
  issuer_address  text not null default '',
  issuer_email    text not null default '',
  issuer_phone    text not null default '',
  bank_name       text not null default '',
  bank_swift      text not null default '',
  series          text not null default 'IN',
  number_digits   integer not null default 6 check (number_digits between 1 and 10),
  next_number     integer not null default 1 check (next_number > 0),
  last_date       date,
  exemption_note  text not null default 'Factura exenta de IVA conforme al artículo 20.Uno.3 de la Ley 37/1992.',
  updated_at      timestamptz not null default now()
);
alter table public.invoice_settings enable row level security;
insert into public.invoice_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.invoices (
  id                 uuid primary key default gen_random_uuid(),
  series             text not null,
  number             integer not null check (number > 0),
  code               text not null unique,
  issue_date         date not null,
  patient_id         uuid not null references public.profiles (id) on delete restrict,
  recipient_name     text not null,
  recipient_tax_id   text,
  recipient_address  text,
  issuer             jsonb not null,
  description        text not null,
  quantity           integer not null default 1 check (quantity > 0),
  unit_price_cents   integer not null check (unit_price_cents >= 0),
  vat_percent        numeric(5,2) not null default 0,
  total_cents        integer not null check (total_cents >= 0),
  payment_method     text not null check (payment_method in ('transferencia', 'bizum', 'efectivo', 'tarjeta')),
  appointment_id     uuid unique references public.appointments (id) on delete restrict,
  bono_id            uuid unique references public.bonos (id) on delete restrict,
  created_at         timestamptz not null default now(),
  unique (series, number),
  check ((appointment_id is null) <> (bono_id is null))
);
create index if not exists invoices_issue_date_idx on public.invoices (series, issue_date);
alter table public.invoices enable row level security;

drop policy if exists "invoice_settings: admin lee" on public.invoice_settings;
create policy "invoice_settings: admin lee"
  on public.invoice_settings for select to authenticated using (public.is_admin());
drop policy if exists "invoice_settings: admin modifica" on public.invoice_settings;
create policy "invoice_settings: admin modifica"
  on public.invoice_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "invoices: admin lee" on public.invoices;
create policy "invoices: admin lee"
  on public.invoices for select to authenticated using (public.is_admin());

-- No se puede retroceder la numeración ni la fecha mínima por debajo de lo emitido.
create or replace function public.guard_invoice_settings()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  max_number integer;
  max_date date;
begin
  select max(number), max(issue_date) into max_number, max_date
    from public.invoices where series = new.series;
  if max_number is not null and new.next_number <= max_number then
    raise exception 'El siguiente número debe ser mayor que %, la última factura emitida de la serie %', max_number, new.series;
  end if;
  if max_date is not null and (new.last_date is null or new.last_date < max_date) then
    raise exception 'La fecha mínima no puede ser anterior a la última factura emitida (%)', to_char(max_date, 'DD/MM/YYYY');
  end if;
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists invoice_settings_guard on public.invoice_settings;
create trigger invoice_settings_guard
  before update on public.invoice_settings
  for each row execute function public.guard_invoice_settings();

-- Emite facturas de pagos cobrados. p_items: [{"kind":"cita"|"bono","id":"uuid"}, …]
-- en el orden de numeración. El importe y el concepto salen de la base de datos.
create or replace function public.issue_invoices(p_items jsonb, p_issue_date date, p_payment_method text)
returns setof public.invoices
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  s public.invoice_settings%rowtype;
  item jsonb;
  v_kind text;
  v_id uuid;
  v_patient uuid;
  v_desc text;
  v_amount integer;
  v_appt uuid;
  v_bono uuid;
  v_prof public.profiles%rowtype;
  v_number integer;
  v_max_date date;
  a record;
  b record;
  inv public.invoices%rowtype;
  today date := (now() at time zone 'Europe/Madrid')::date;
begin
  if not public.is_admin() then
    raise exception 'No autorizado';
  end if;
  if p_payment_method not in ('transferencia', 'bizum', 'efectivo', 'tarjeta') then
    raise exception 'Método de pago no válido';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'No hay pagos que facturar';
  end if;

  -- Bloquea los ajustes: dos emisiones a la vez no pueden repetir número.
  select * into s from public.invoice_settings where id = 1 for update;
  if not found then
    raise exception 'Faltan los datos de facturación';
  end if;

  if p_issue_date > today then
    raise exception 'La fecha de la factura no puede ser futura';
  end if;
  select max(issue_date) into v_max_date from public.invoices where series = s.series;
  if (s.last_date is not null and p_issue_date < s.last_date)
     or (v_max_date is not null and p_issue_date < v_max_date) then
    raise exception 'La fecha no puede ser anterior a la de la última factura (%)',
      to_char(greatest(coalesce(s.last_date, v_max_date), coalesce(v_max_date, s.last_date)), 'DD/MM/YYYY');
  end if;

  v_number := s.next_number;

  for item in select value from jsonb_array_elements(p_items) loop
    v_kind := item ->> 'kind';
    v_id := (item ->> 'id')::uuid;
    v_appt := null;
    v_bono := null;

    if v_kind = 'cita' then
      select * into a from public.appointments where id = v_id for update;
      if not found then raise exception 'Cita no encontrada'; end if;
      if a.paid_at is null or a.session_type = 'bono' or a.price_cents <= 0 or a.status = 'cancelada' then
        raise exception 'Hay una cita que no es un pago facturable';
      end if;
      if exists (select 1 from public.invoices where appointment_id = v_id) then
        raise exception 'Una de las citas ya tiene factura';
      end if;
      v_patient := a.patient_id;
      v_amount := a.price_cents;
      v_appt := v_id;
      v_desc := case a.session_type
        when 'primera' then 'Primera sesión de psicología sanitaria'
        when 'pareja' then 'Sesión de terapia de pareja'
        else 'Sesión individual de psicología sanitaria' end;
    elsif v_kind = 'bono' then
      select * into b from public.bonos where id = v_id for update;
      if not found then raise exception 'Bono no encontrado'; end if;
      if b.paid_at is null then
        raise exception 'Hay un bono sin pagar';
      end if;
      if exists (select 1 from public.invoices where bono_id = v_id) then
        raise exception 'Uno de los bonos ya tiene factura';
      end if;
      v_patient := b.patient_id;
      v_amount := b.price_cents;
      v_bono := v_id;
      v_desc := 'Bono ' || b.sessions_total || ' sesiones de psicología sanitaria';
    else
      raise exception 'Tipo de pago no válido';
    end if;

    select * into v_prof from public.profiles where id = v_patient;

    insert into public.invoices (
      series, number, code, issue_date, patient_id,
      recipient_name, recipient_tax_id, recipient_address, issuer,
      description, quantity, unit_price_cents, vat_percent, total_cents,
      payment_method, appointment_id, bono_id
    ) values (
      s.series, v_number, s.series || lpad(v_number::text, s.number_digits, '0'), p_issue_date, v_patient,
      coalesce(nullif(v_prof.full_name, ''), v_prof.email), v_prof.tax_id, v_prof.address,
      jsonb_build_object(
        'name', s.issuer_name, 'tax_id', s.issuer_tax_id, 'address', s.issuer_address,
        'email', s.issuer_email, 'phone', s.issuer_phone,
        'bank_name', s.bank_name, 'bank_swift', s.bank_swift, 'exemption_note', s.exemption_note
      ),
      v_desc, 1, v_amount, 0, v_amount,
      p_payment_method, v_appt, v_bono
    ) returning * into inv;

    return next inv;
    v_number := v_number + 1;
  end loop;

  update public.invoice_settings
     set next_number = v_number, last_date = p_issue_date
   where id = 1;
end;
$fn$;

revoke all on function public.issue_invoices(jsonb, date, text) from public, anon;
grant execute on function public.issue_invoices(jsonb, date, text) to authenticated;

-- Un pago ya facturado no puede cambiar de importe, tarifa, paciente ni estado de pago.
create or replace function public.guard_invoiced_payment()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if tg_table_name = 'appointments' then
    if exists (select 1 from public.invoices where appointment_id = old.id)
       and (new.paid_at is distinct from old.paid_at
            or new.price_cents is distinct from old.price_cents
            or new.session_type is distinct from old.session_type
            or new.patient_id is distinct from old.patient_id) then
      raise exception 'Esta cita ya está facturada: no se puede cambiar su pago, tarifa ni paciente';
    end if;
  else
    if exists (select 1 from public.invoices where bono_id = old.id)
       and (new.paid_at is distinct from old.paid_at
            or new.price_cents is distinct from old.price_cents
            or new.patient_id is distinct from old.patient_id) then
      raise exception 'Este bono ya está facturado: no se puede cambiar su pago, precio ni paciente';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists appointments_guard_invoiced on public.appointments;
create trigger appointments_guard_invoiced
  before update on public.appointments
  for each row execute function public.guard_invoiced_payment();
drop trigger if exists bonos_guard_invoiced on public.bonos;
create trigger bonos_guard_invoiced
  before update on public.bonos
  for each row execute function public.guard_invoiced_payment();

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
