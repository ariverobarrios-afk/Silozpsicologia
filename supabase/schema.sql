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

-- Fecha de la operación (el cobro): puede ser anterior a la de la factura si
-- ya había facturas con fecha posterior.
alter table public.invoices add column if not exists operation_date date;

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
  v_paid date;
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
      v_paid := (a.paid_at at time zone 'Europe/Madrid')::date;
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
      v_paid := (b.paid_at at time zone 'Europe/Madrid')::date;
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
      payment_method, appointment_id, bono_id, operation_date
    ) values (
      s.series, v_number, s.series || lpad(v_number::text, s.number_digits, '0'), p_issue_date, v_patient,
      coalesce(nullif(v_prof.full_name, ''), v_prof.email), v_prof.tax_id, v_prof.address,
      jsonb_build_object(
        'name', s.issuer_name, 'tax_id', s.issuer_tax_id, 'address', s.issuer_address,
        'email', s.issuer_email, 'phone', s.issuer_phone,
        'bank_name', s.bank_name, 'bank_swift', s.bank_swift, 'exemption_note', s.exemption_note
      ),
      v_desc, 1, v_amount, 0, v_amount,
      p_payment_method, v_appt, v_bono, v_paid
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
  -- Al invitar a un paciente sin cuenta su ficha cambia de id y el cambio
  -- llega aquí en cascada: entonces el id antiguo ya no existe en profiles.
  if new.patient_id is distinct from old.patient_id
     and not exists (select 1 from public.profiles where id = old.patient_id) then
    return new;
  end if;
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

-- Pagos que Silvia decide no facturar: dejan de salir en «Pendientes de
-- facturar» (se pueden recuperar). null = pendiente de decidir.
alter table public.appointments add column if not exists invoice_skipped_at timestamptz;
alter table public.bonos add column if not exists invoice_skipped_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- Pacientes sin acceso: Silvia puede dar de alta pacientes sin email (sin
-- cuenta en Auth) y gestionar su agenda igual. Si más adelante les invita, la
-- nueva cuenta se enlaza con su ficha y conserva citas, bonos y facturas.
--   · profiles.invited_at: cuándo se envió la invitación (null = nunca).
--   · El id del perfil ya no tiene que existir en auth.users; al invitar se
--     cambia por el de la nueva cuenta (ON UPDATE CASCADE en las tablas hijas).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles alter column id set default gen_random_uuid();
alter table public.profiles add column if not exists invited_at timestamptz;

-- Los perfiles con cuenta ya creada estaban invitados.
update public.profiles p
   set invited_at = coalesce(u.invited_at, u.created_at)
  from auth.users u
 where u.id = p.id and p.role = 'patient' and p.invited_at is null;

-- Primero bonos y luego citas: las cascadas se ejecutan en orden de creación
-- y check_bono_usage exige que bono y cita sean del mismo paciente.
alter table public.bonos drop constraint if exists bonos_patient_id_fkey;
alter table public.bonos add constraint bonos_patient_id_fkey
  foreign key (patient_id) references public.profiles (id) on delete cascade on update cascade;
alter table public.appointments drop constraint if exists appointments_patient_id_fkey;
alter table public.appointments add constraint appointments_patient_id_fkey
  foreign key (patient_id) references public.profiles (id) on delete cascade on update cascade;
do $do$
begin
  if to_regclass('public.invoices') is not null then
    alter table public.invoices drop constraint if exists invoices_patient_id_fkey;
    alter table public.invoices add constraint invoices_patient_id_fkey
      foreign key (patient_id) references public.profiles (id) on delete restrict on update cascade;
  end if;
end
$do$;

-- Al crear la cuenta: si la invitación viene de una ficha ya existente
-- (metadato profile_id, que solo pone api/invite-patient.ts con la clave
-- secreta) y la ficha tiene ese mismo email, se enlaza; si no, perfil nuevo.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid;
begin
  begin
    pid := nullif(new.raw_user_meta_data ->> 'profile_id', '')::uuid;
  exception when invalid_text_representation then
    pid := null;
  end;

  if pid is not null then
    update public.profiles p
       set id = new.id, email = coalesce(new.email, ''), invited_at = now()
     where p.id = pid
       and p.role = 'patient'
       and lower(p.email) = lower(coalesce(new.email, ''))
       and not exists (select 1 from auth.users u where u.id = pid);
    if found then
      return new;
    end if;
  end if;

  insert into public.profiles (id, email, full_name, phone, invited_at)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    now()
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Eventos de la agenda: tareas, reuniones, sesiones de otros centros… que
-- bloquean horas sin ser una cita (sin paciente, tarifa ni pago). Solo los ve
-- y gestiona la terapeuta.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.agenda_events (
  id                uuid primary key default gen_random_uuid(),
  title             text not null check (length(trim(title)) > 0),
  starts_at         timestamptz not null,
  duration_minutes  integer not null default 60 check (duration_minutes between 5 and 1440),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists agenda_events_starts_idx on public.agenda_events (starts_at);
alter table public.agenda_events enable row level security;

drop trigger if exists agenda_events_touch_updated_at on public.agenda_events;
create trigger agenda_events_touch_updated_at
  before update on public.agenda_events
  for each row execute function public.touch_updated_at();

drop policy if exists "agenda_events: admin lee" on public.agenda_events;
create policy "agenda_events: admin lee"
  on public.agenda_events for select to authenticated using (public.is_admin());
drop policy if exists "agenda_events: admin crea" on public.agenda_events;
create policy "agenda_events: admin crea"
  on public.agenda_events for insert to authenticated with check (public.is_admin());
drop policy if exists "agenda_events: admin modifica" on public.agenda_events;
create policy "agenda_events: admin modifica"
  on public.agenda_events for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "agenda_events: admin borra" on public.agenda_events;
create policy "agenda_events: admin borra"
  on public.agenda_events for delete to authenticated using (public.is_admin());

-- Preparado para pacientes que no son propios de Silvia sino de otro centro o
-- empresa (p. ej. Psicolink). null = paciente propio. Aún no se usa en la web.
alter table public.profiles add column if not exists external_center text;

-- ─────────────────────────────────────────────────────────────────────────────
-- Facturas anteriores a la web (importadas de la hoja de Silvia) y acceso de
-- los pacientes a sus facturas.
--   · invoices.imported: no está ligada a una cita ni a un bono de la web y
--     puede no tener método de pago.
--   · Cada paciente (activo) puede leer sus propias facturas para descargarlas.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.invoices add column if not exists imported boolean not null default false;
alter table public.invoices alter column payment_method drop not null;
alter table public.invoices drop constraint if exists invoices_check;
alter table public.invoices drop constraint if exists invoices_origen;
alter table public.invoices add constraint invoices_origen
  check (imported or ((appointment_id is null) <> (bono_id is null)));

drop policy if exists "invoices: admin lee" on public.invoices;
drop policy if exists "invoices: paciente ve las suyas, admin todas" on public.invoices;
create policy "invoices: paciente ve las suyas, admin todas"
  on public.invoices for select to authenticated
  using ((patient_id = auth.uid() and public.is_active()) or public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- Registrar un cobro: fecha real del pago y método, y (si se pide) emitir su
-- factura. La factura lleva la fecha del pago salvo que ya haya facturas con
-- fecha posterior: entonces lleva la de la última, para que números y fechas
-- sigan siendo correlativos.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.appointments add column if not exists payment_method text
  check (payment_method in ('transferencia', 'bizum', 'efectivo', 'tarjeta'));
alter table public.bonos add column if not exists payment_method text
  check (payment_method in ('transferencia', 'bizum', 'efectivo', 'tarjeta'));

create or replace function public.register_payment(
  p_kind text, p_id uuid, p_paid_on date, p_method text, p_invoice boolean default true
)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  s public.invoice_settings%rowtype;
  v_max_date date;
  v_date date;
  inv public.invoices%rowtype;
  today date := (now() at time zone 'Europe/Madrid')::date;
  v_paid_at timestamptz := (p_paid_on + time '12:00') at time zone 'Europe/Madrid';
begin
  if not public.is_admin() then
    raise exception 'No autorizado';
  end if;
  if p_method is null or p_method not in ('transferencia', 'bizum', 'efectivo', 'tarjeta') then
    raise exception 'Elige el método de pago';
  end if;
  if p_paid_on is null or p_paid_on > today then
    raise exception 'La fecha del pago no puede ser futura';
  end if;

  if p_kind = 'cita' then
    update public.appointments set paid_at = v_paid_at, payment_method = p_method where id = p_id;
  elsif p_kind = 'bono' then
    update public.bonos set paid_at = v_paid_at, payment_method = p_method where id = p_id;
  else
    raise exception 'Tipo de pago no válido';
  end if;
  if not found then
    raise exception 'Pago no encontrado';
  end if;

  if not p_invoice then
    return null;
  end if;

  select * into s from public.invoice_settings where id = 1;
  select max(issue_date) into v_max_date from public.invoices where series = s.series;
  v_date := greatest(p_paid_on, coalesce(s.last_date, p_paid_on), coalesce(v_max_date, p_paid_on));

  select * into inv
    from public.issue_invoices(jsonb_build_array(jsonb_build_object('kind', p_kind, 'id', p_id)), v_date, p_method);
  return inv;
end;
$fn$;

revoke all on function public.register_payment(text, uuid, date, text, boolean) from public, anon;
grant execute on function public.register_payment(text, uuid, date, text, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Notas de cada sesión (se escriben en la página de la sesión, /panel/sesion/<id>):
-- · notes      → notas de la sesión.
-- · next_notes → notas para la próxima sesión: la siguiente cita (no
--   cancelada) del paciente las muestra, la haya reservado quien sea.
-- Se ven también al pasar el ratón por la cita en la agenda. Van en una tabla
-- aparte, solo para administración: el paciente puede leer sus citas, pero
-- nunca estas notas.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.appointment_notes (
  appointment_id uuid primary key references public.appointments (id) on delete cascade,
  notes          text not null default '',
  next_notes     text not null default '',
  updated_at     timestamptz not null default now()
);
-- Instalaciones anteriores: solo había `notes` y no podía quedar vacía.
alter table public.appointment_notes add column if not exists next_notes text not null default '';
alter table public.appointment_notes alter column notes set default '';
alter table public.appointment_notes drop constraint if exists appointment_notes_notes_check;
alter table public.appointment_notes add constraint appointment_notes_notes_check check (length(notes) <= 5000);
alter table public.appointment_notes drop constraint if exists appointment_notes_next_notes_check;
alter table public.appointment_notes add constraint appointment_notes_next_notes_check check (length(next_notes) <= 5000);
-- Sin ninguna de las dos, la fila se borra en vez de quedar vacía.
alter table public.appointment_notes drop constraint if exists appointment_notes_not_empty;
alter table public.appointment_notes add constraint appointment_notes_not_empty
  check (length(trim(notes)) > 0 or length(trim(next_notes)) > 0);
alter table public.appointment_notes enable row level security;

drop trigger if exists appointment_notes_touch_updated_at on public.appointment_notes;
create trigger appointment_notes_touch_updated_at
  before update on public.appointment_notes
  for each row execute function public.touch_updated_at();

drop policy if exists "appointment_notes: admin lee" on public.appointment_notes;
create policy "appointment_notes: admin lee"
  on public.appointment_notes for select to authenticated using (public.is_admin());
drop policy if exists "appointment_notes: admin crea" on public.appointment_notes;
create policy "appointment_notes: admin crea"
  on public.appointment_notes for insert to authenticated with check (public.is_admin());
drop policy if exists "appointment_notes: admin modifica" on public.appointment_notes;
create policy "appointment_notes: admin modifica"
  on public.appointment_notes for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "appointment_notes: admin borra" on public.appointment_notes;
create policy "appointment_notes: admin borra"
  on public.appointment_notes for delete to authenticated using (public.is_admin());

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


-- ─────────────────────────────────────────────────────────────────────────────
-- Reserva de citas por el paciente (huecos abiertos en la agenda).
-- Documentación: docs/reserva-citas-paciente.md
--
--   · La psicóloga «abre agenda»: crea huecos (agenda_slots) con
--     open_agenda_slots(). Solo esos huecos son reservables; el tiempo libre de
--     la agenda NO lo es.
--   · El paciente ve (RLS) los huecos abiertos de SU psicóloga dentro de la
--     ventana permitida y reserva uno con book_slot(), que crea una cita normal
--     (origin = 'reserva_paciente'). Máximo una cita por semana natural.
--   · book_slot() y cancel_booking() solo los puede ejecutar el servidor
--     (service_role, desde api/book-slot.ts y api/cancel-booking.ts), que
--     identifica al paciente por su sesión y después envía los emails.
--
-- Idempotente: se puede volver a ejecutar sin romper nada.
-- ─────────────────────────────────────────────────────────────────────────────

-- Necesaria para impedir huecos abiertos solapados (restricción EXCLUDE).
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- ── Ajustes (una sola fila; Silvia puede cambiarlos sin desplegar) ──────────
create table if not exists public.booking_settings (
  id                  integer primary key default 1 check (id = 1),
  min_advance_hours   integer not null default 24 check (min_advance_hours >= 0),
  max_window_days     integer not null default 42 check (max_window_days > 0),
  cancel_limit_hours  integer not null default 24 check (cancel_limit_hours >= 0),
  updated_at          timestamptz not null default now()
);
insert into public.booking_settings (id) values (1) on conflict (id) do nothing;
alter table public.booking_settings enable row level security;

drop policy if exists "booking_settings: todos leen" on public.booking_settings;
create policy "booking_settings: todos leen"
  on public.booking_settings for select to authenticated using (true);
drop policy if exists "booking_settings: admin modifica" on public.booking_settings;
create policy "booking_settings: admin modifica"
  on public.booking_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── Psicóloga de cada paciente ──────────────────────────────────────────────
-- Hoy solo hay una (Silvia); el campo deja preparada la app para varias.
alter table public.profiles
  add column if not exists psychologist_id uuid
    references public.profiles (id) on delete set null on update cascade;
create index if not exists profiles_psychologist_idx on public.profiles (psychologist_id);

update public.profiles
   set psychologist_id = (select id from public.profiles where role = 'admin' order by created_at limit 1)
 where role = 'patient' and psychologist_id is null;

-- Pacientes nuevos: si nadie indica otra, su psicóloga es la (primera) admin.
create or replace function public.default_psychologist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.role = 'patient' and new.psychologist_id is null then
    new.psychologist_id := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  end if;
  return new;
end;
$fn$;
revoke all on function public.default_psychologist() from public, anon, authenticated;

drop trigger if exists profiles_default_psychologist on public.profiles;
create trigger profiles_default_psychologist
  before insert or update of role on public.profiles
  for each row execute function public.default_psychologist();

-- Psicóloga del usuario actual (para las políticas; evita recursión en RLS).
create or replace function public.my_psychologist_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select psychologist_id from public.profiles where id = auth.uid() and active;
$$;
revoke all on function public.my_psychologist_id() from public, anon;
grant execute on function public.my_psychologist_id() to authenticated;

-- Nombre y canal de contacto de la psicóloga del paciente (el paciente no
-- puede leer el perfil de ella por RLS; aquí solo se exponen estos campos).
create or replace function public.my_psychologist()
returns table (full_name text, email text, phone text)
language sql
stable
security definer
set search_path = ''
as $$
  select ps.full_name, ps.email, ps.phone
    from public.profiles me
    join public.profiles ps on ps.id = me.psychologist_id
   where me.id = auth.uid() and me.active;
$$;
revoke all on function public.my_psychologist() from public, anon;
grant execute on function public.my_psychologist() to authenticated;

-- ── Origen de cada cita ─────────────────────────────────────────────────────
alter table public.appointments
  add column if not exists origin text not null default 'manual'
    check (origin in ('manual', 'reserva_paciente'));

-- ── Huecos abiertos ─────────────────────────────────────────────────────────
create table if not exists public.agenda_slots (
  id                    uuid primary key default gen_random_uuid(),
  psychologist_id       uuid not null references public.profiles (id) on delete cascade on update cascade,
  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  status                text not null default 'abierto' check (status in ('abierto', 'reservado', 'cerrado')),
  appointment_id        uuid unique references public.appointments (id) on delete set null,
  booked_by_patient_id  uuid references public.profiles (id) on delete set null on update cascade,
  booked_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint agenda_slots_rango check (ends_at > starts_at),
  -- Dos huecos ABIERTOS de la misma psicóloga nunca se solapan.
  constraint agenda_slots_sin_solapes exclude using gist (
    psychologist_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status = 'abierto')
);
create index if not exists agenda_slots_psych_status_idx
  on public.agenda_slots (psychologist_id, status, starts_at);
alter table public.agenda_slots enable row level security;

drop trigger if exists agenda_slots_touch_updated_at on public.agenda_slots;
create trigger agenda_slots_touch_updated_at
  before update on public.agenda_slots
  for each row execute function public.touch_updated_at();

-- Lectura: la psicóloga ve los suyos; el paciente, solo los ABIERTOS de su
-- psicóloga dentro de la ventana de reserva. No hay políticas de escritura:
-- todo cambio pasa por las funciones de abajo.
drop policy if exists "agenda_slots: psicologa ve los suyos" on public.agenda_slots;
create policy "agenda_slots: psicologa ve los suyos"
  on public.agenda_slots for select to authenticated
  using (psychologist_id = auth.uid() and public.is_admin());

drop policy if exists "agenda_slots: paciente ve los abiertos de su psicologa" on public.agenda_slots;
create policy "agenda_slots: paciente ve los abiertos de su psicologa"
  on public.agenda_slots for select to authenticated
  using (
    status = 'abierto'
    and psychologist_id = public.my_psychologist_id()
    and starts_at >= now() + make_interval(hours => (select min_advance_hours from public.booking_settings where id = 1))
    and starts_at <= now() + make_interval(days => (select max_window_days from public.booking_settings where id = 1))
  );

-- ── Utilidades ──────────────────────────────────────────────────────────────
-- Lunes (en Madrid) de la semana natural de un instante.
create or replace function public.madrid_week_start(p_ts timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$
  select date_trunc('week', p_ts at time zone 'Europe/Madrid')::date;
$$;

-- ¿Hay ya una cita (no cancelada) o un evento en esa franja de la agenda de
-- esa psicóloga? (Los eventos aún no tienen dueña: hoy todos son de Silvia.)
create or replace function public.agenda_busy(p_psych uuid, p_start timestamptz, p_end timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.appointments a
             join public.profiles p on p.id = a.patient_id
            where p.psychologist_id = p_psych
              and a.status <> 'cancelada'
              and a.starts_at < p_end
              and a.starts_at + make_interval(mins => a.duration_minutes) > p_start)
      or exists (
           select 1 from public.agenda_events e
            where e.starts_at < p_end
              and e.starts_at + make_interval(mins => e.duration_minutes) > p_start);
$$;
revoke all on function public.agenda_busy(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ── Psicóloga: abrir agenda ─────────────────────────────────────────────────
-- Crea un hueco de p_slot_minutes por cada tramo entre p_from y p_to (hora de
-- Madrid) el día p_date y, si p_weeks > 1, el mismo día de las semanas
-- siguientes (p_weeks = número total de semanas; 0 o 1 = solo ese día).
-- Omite los huecos pasados y los que chocan con citas, eventos u otros huecos.
create or replace function public.open_agenda_slots(
  p_date date, p_from time, p_to time, p_slot_minutes integer default 60, p_weeks integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_psych uuid := auth.uid();
  v_weeks integer := greatest(coalesce(p_weeks, 1), 1);
  v_from integer := (extract(epoch from p_from) / 60)::integer;
  v_to integer := (extract(epoch from p_to) / 60)::integer;
  v_day date;
  v_m integer;
  v_start timestamptz;
  v_end timestamptz;
  v_created integer := 0;
  v_past integer := 0;
  v_busy integer := 0;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_date is null or p_from is null or p_to is null then
    raise exception 'Indica la fecha y la franja';
  end if;
  if p_slot_minutes is null or p_slot_minutes < 30 or p_slot_minutes > 240 or p_slot_minutes % 30 <> 0 then
    raise exception 'La duración de cada hueco debe ser de 30 min a 4 h, en tramos de media hora';
  end if;
  if v_from % 30 <> 0 or extract(second from p_from) <> 0 then
    raise exception 'La franja debe empezar en punto o a y media';
  end if;
  if v_to - v_from < p_slot_minutes then
    raise exception 'La franja es más corta que un hueco';
  end if;
  if v_weeks > 12 then
    raise exception 'Como máximo 12 semanas de una vez';
  end if;

  for w in 0 .. v_weeks - 1 loop
    v_day := p_date + 7 * w;
    v_m := v_from;
    while v_m + p_slot_minutes <= v_to loop
      v_start := (v_day::timestamp + make_interval(mins => v_m)) at time zone 'Europe/Madrid';
      v_end := v_start + make_interval(mins => p_slot_minutes);
      if v_start <= now() then
        v_past := v_past + 1;
      elsif public.agenda_busy(v_psych, v_start, v_end)
         or exists (select 1 from public.agenda_slots s
                     where s.psychologist_id = v_psych and s.status = 'abierto'
                       and s.starts_at < v_end and s.ends_at > v_start) then
        v_busy := v_busy + 1;
      else
        insert into public.agenda_slots (psychologist_id, starts_at, ends_at)
        values (v_psych, v_start, v_end);
        v_created := v_created + 1;
      end if;
      v_m := v_m + p_slot_minutes;
    end loop;
  end loop;

  return jsonb_build_object('created', v_created, 'skipped_busy', v_busy, 'skipped_past', v_past);
end;
$fn$;
revoke all on function public.open_agenda_slots(date, time, time, integer, integer) from public, anon;
grant execute on function public.open_agenda_slots(date, time, time, integer, integer) to authenticated;

-- ── Psicóloga: cerrar un hueco libre ────────────────────────────────────────
create or replace function public.close_agenda_slot(p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;
  update public.agenda_slots set status = 'cerrado'
   where id = p_slot_id and psychologist_id = auth.uid() and status = 'abierto';
  if not found then
    raise exception 'SLOT_UNAVAILABLE';
  end if;
end;
$fn$;
revoke all on function public.close_agenda_slot(uuid) from public, anon;
grant execute on function public.close_agenda_slot(uuid) to authenticated;

-- ── Coherencia agenda ↔ huecos ──────────────────────────────────────────────
-- Cuando entra en la agenda una cita (o se mueve), el hueco abierto que empieza
-- a esa misma hora queda «reservado» y enlazado a ella (así funciona
-- «Convertir en cita manual»), y cualquier otro hueco abierto que se solape se
-- cierra: nunca se ofrece a un paciente una hora que ya está ocupada.
create or replace function public.appointments_claim_slots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_psych uuid;
  v_end timestamptz;
begin
  if new.status = 'cancelada' then
    return new;
  end if;
  select psychologist_id into v_psych from public.profiles where id = new.patient_id;
  if v_psych is null then
    return new;
  end if;
  v_end := new.starts_at + make_interval(mins => new.duration_minutes);

  if not exists (select 1 from public.agenda_slots where appointment_id = new.id) then
    update public.agenda_slots
       set status = 'reservado', appointment_id = new.id,
           booked_by_patient_id = new.patient_id, booked_at = now()
     where psychologist_id = v_psych and status = 'abierto' and starts_at = new.starts_at;
  end if;

  update public.agenda_slots set status = 'cerrado'
   where psychologist_id = v_psych and status = 'abierto'
     and starts_at < v_end and ends_at > new.starts_at;
  return new;
end;
$fn$;
revoke all on function public.appointments_claim_slots() from public, anon, authenticated;

drop trigger if exists appointments_claim_slots on public.appointments;
create trigger appointments_claim_slots
  after insert or update of starts_at, duration_minutes, status, patient_id on public.appointments
  for each row execute function public.appointments_claim_slots();

create or replace function public.agenda_events_close_slots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update public.agenda_slots set status = 'cerrado'
   where status = 'abierto'
     and starts_at < new.starts_at + make_interval(mins => new.duration_minutes)
     and ends_at > new.starts_at;
  return new;
end;
$fn$;
revoke all on function public.agenda_events_close_slots() from public, anon, authenticated;

drop trigger if exists agenda_events_close_slots on public.agenda_events;
create trigger agenda_events_close_slots
  after insert or update of starts_at, duration_minutes on public.agenda_events
  for each row execute function public.agenda_events_close_slots();

-- ── Paciente: reservar ──────────────────────────────────────────────────────
-- Todo en una transacción. Errores (mensaje de la excepción):
--   NOT_ALLOWED       el paciente no existe, no está activo o no tiene psicóloga
--   SLOT_UNAVAILABLE  el hueco no existe, no es de su psicóloga, ya no está
--                     abierto o está fuera de la ventana de reserva
--   WEEK_LIMIT        ya tiene una cita (no cancelada) esa semana natural
--   COMMENT_TOO_LONG  comentario de más de 300 caracteres
-- Tarifa: la misma que propone el panel para una cita manual (ver
-- client/src/lib/tariffs.ts y AppointmentDialog): primera sesión → bono con
-- sesiones libres → sesión individual o de pareja según su proceso.
create or replace function public.book_slot(p_patient_id uuid, p_slot_id uuid, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_patient public.profiles%rowtype;
  v_psych public.profiles%rowtype;
  v_cfg public.booking_settings%rowtype;
  v_slot public.agenda_slots%rowtype;
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
  v_type text;
  v_price integer;
  v_bono uuid;
  v_appt uuid;
  v_minutes integer;
begin
  -- Bloquea al paciente: dos reservas suyas a la vez no se saltan la regla
  -- de una cita por semana.
  select * into v_patient from public.profiles
   where id = p_patient_id and role = 'patient' for update;
  if not found or not v_patient.active or v_patient.psychologist_id is null then
    raise exception 'NOT_ALLOWED';
  end if;
  if length(v_comment) > 300 then
    raise exception 'COMMENT_TOO_LONG';
  end if;
  select * into v_cfg from public.booking_settings where id = 1;

  -- Toma atómica del hueco: si otro paciente lo ha cogido a la vez, esta
  -- actualización espera a que termine y ya no encuentra el hueco abierto.
  update public.agenda_slots
     set status = 'reservado', booked_by_patient_id = p_patient_id, booked_at = now()
   where id = p_slot_id
     and status = 'abierto'
     and psychologist_id = v_patient.psychologist_id
     and starts_at >= now() + make_interval(hours => v_cfg.min_advance_hours)
     and starts_at <= now() + make_interval(days => v_cfg.max_window_days)
  returning * into v_slot;
  if not found then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  if exists (select 1 from public.appointments
              where patient_id = p_patient_id and status <> 'cancelada'
                and public.madrid_week_start(starts_at) = public.madrid_week_start(v_slot.starts_at)) then
    raise exception 'WEEK_LIMIT';
  end if;

  if public.agenda_busy(v_slot.psychologist_id, v_slot.starts_at, v_slot.ends_at) then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  -- Tarifa, igual que una cita manual.
  if not exists (select 1 from public.appointments where patient_id = p_patient_id and status <> 'cancelada') then
    v_type := 'primera'; v_price := 2500;
  else
    select b.id into v_bono from public.bonos b
     where b.patient_id = p_patient_id
       and b.sessions_total > (select count(*) from public.appointments a
                                where a.bono_id = b.id and a.status <> 'cancelada')
     order by b.created_at limit 1;
    if v_bono is not null then
      v_type := 'bono'; v_price := 0;
    elsif v_patient.process_type = 'pareja' then
      v_type := 'pareja'; v_price := 7000;
    else
      v_type := 'individual'; v_price := 5500;
    end if;
  end if;

  v_minutes := (extract(epoch from v_slot.ends_at - v_slot.starts_at) / 60)::integer;
  insert into public.appointments (
    patient_id, starts_at, duration_minutes, modality, status,
    session_type, price_cents, bono_id, origin
  ) values (
    p_patient_id, v_slot.starts_at, v_minutes, 'online', 'programada',
    v_type, v_price, v_bono, 'reserva_paciente'
  ) returning id into v_appt;

  update public.agenda_slots set appointment_id = v_appt where id = v_slot.id;

  -- El comentario queda también en las notas de la cita (solo las ve ella).
  if v_comment is not null then
    insert into public.appointment_notes (appointment_id, notes)
    values (v_appt, 'Comentario del paciente al reservar: ' || v_comment);
  end if;

  select * into v_psych from public.profiles where id = v_slot.psychologist_id;
  return jsonb_build_object(
    'appointment_id', v_appt,
    'slot_id', v_slot.id,
    'starts_at', v_slot.starts_at,
    'ends_at', v_slot.ends_at,
    'duration_minutes', v_minutes,
    'session_type', v_type,
    'comment', v_comment,
    'patient_name', v_patient.full_name,
    'patient_email', v_patient.email,
    'psychologist_name', v_psych.full_name,
    'psychologist_email', v_psych.email,
    'psychologist_phone', v_psych.phone,
    'cancel_limit_hours', v_cfg.cancel_limit_hours
  );
end;
$fn$;
revoke all on function public.book_slot(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.book_slot(uuid, uuid, text) to service_role;

-- ── Paciente: cancelar su reserva ───────────────────────────────────────────
-- Solo citas suyas, reservadas por él (origin = 'reserva_paciente'),
-- programadas y con más de cancel_limit_hours de antelación. El hueco vuelve
-- a estar abierto (si en ese rato se ha ocupado esa hora, se cierra).
-- Errores: NOT_ALLOWED, NOT_CANCELLABLE, CANCEL_TOO_LATE.
create or replace function public.cancel_booking(p_patient_id uuid, p_appointment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_appt public.appointments%rowtype;
  v_patient public.profiles%rowtype;
  v_psych public.profiles%rowtype;
  v_cfg public.booking_settings%rowtype;
  v_slot public.agenda_slots%rowtype;
  v_reopened boolean := false;
begin
  select * into v_patient from public.profiles where id = p_patient_id and role = 'patient';
  if not found or not v_patient.active then
    raise exception 'NOT_ALLOWED';
  end if;
  select * into v_appt from public.appointments
   where id = p_appointment_id and patient_id = p_patient_id and origin = 'reserva_paciente'
   for update;
  if not found then
    raise exception 'NOT_ALLOWED';
  end if;
  if v_appt.status <> 'programada' then
    raise exception 'NOT_CANCELLABLE';
  end if;
  select * into v_cfg from public.booking_settings where id = 1;
  if v_appt.starts_at - now() <= make_interval(hours => v_cfg.cancel_limit_hours) then
    raise exception 'CANCEL_TOO_LATE';
  end if;

  update public.appointments set status = 'cancelada' where id = v_appt.id;

  select * into v_slot from public.agenda_slots where appointment_id = v_appt.id for update;
  if found then
    if public.agenda_busy(v_slot.psychologist_id, v_slot.starts_at, v_slot.ends_at)
       or exists (select 1 from public.agenda_slots s
                   where s.psychologist_id = v_slot.psychologist_id and s.status = 'abierto'
                     and s.id <> v_slot.id and s.starts_at < v_slot.ends_at and s.ends_at > v_slot.starts_at) then
      update public.agenda_slots
         set status = 'cerrado', appointment_id = null, booked_by_patient_id = null, booked_at = null
       where id = v_slot.id;
    else
      update public.agenda_slots
         set status = 'abierto', appointment_id = null, booked_by_patient_id = null, booked_at = null
       where id = v_slot.id;
      v_reopened := true;
    end if;
  end if;

  select * into v_psych from public.profiles where id = v_patient.psychologist_id;
  return jsonb_build_object(
    'appointment_id', v_appt.id,
    'starts_at', v_appt.starts_at,
    'ends_at', v_appt.starts_at + make_interval(mins => v_appt.duration_minutes),
    'duration_minutes', v_appt.duration_minutes,
    'slot_reopened', v_reopened,
    'patient_name', v_patient.full_name,
    'patient_email', v_patient.email,
    'psychologist_name', v_psych.full_name,
    'psychologist_email', v_psych.email
  );
end;
$fn$;
revoke all on function public.cancel_booking(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_booking(uuid, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIRMA DEL CONSENTIMIENTO EN EL ÁREA DEL PACIENTE (docs/consentimiento-firma.md)
--
-- El paciente lee los documentos legales (protección de datos, normas del
-- servicio y desistimiento), los acepta y los firma desde «Mi área». El
-- servidor (api/consent.ts, con service_role) guarda la firma, genera el PDF
-- con evidencias y lo sube al bucket privado «consents».
--
-- · therapists            → profesionales que prestan el servicio (una fila por
--                           psicóloga, enlazada a su perfil de administración).
-- · consent_settings      → datos del centro (responsable del tratamiento, IBAN…).
-- · document_versions     → textos legales versionados; nunca se editan.
-- · consents              → una fila por firma, con sus evidencias.
-- · consent_attempts      → registro para limitar envíos (anti-abuso).
-- · profiles.birth_date   → fecha de nacimiento del paciente (la pide la firma).
--
-- RLS activado en todas y SIN políticas: nadie las lee ni escribe desde el
-- navegador. El navegador solo usa las funciones consent_context() y
-- consent_overview(), que comprueban quién llama.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles add column if not exists birth_date date;

create table if not exists public.therapists (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid unique references public.profiles (id) on delete set null,
  slug              text unique not null check (slug ~ '^[a-z0-9-]+$'),
  full_name         text not null,
  dni               text not null,
  collegiate_number text,
  email             text not null,
  price_single_eur  numeric(6,2) not null default 55,
  price_pack5_eur   numeric(6,2) not null default 250,
  session_minutes   int not null default 50,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);
alter table public.therapists enable row level security;

create table if not exists public.consent_settings (
  id                          int primary key default 1 check (id = 1),
  responsable_nombre          text not null,
  responsable_dni             text not null,
  responsable_direccion       text not null,
  email_contacto              text not null,
  iban                        text not null,
  plataforma_videollamada     text not null,
  -- Si es true, el paciente no puede reservar cita hasta firmar.
  block_booking_until_consent boolean not null default false,
  updated_at                  timestamptz not null default now()
);
alter table public.consent_settings enable row level security;

create table if not exists public.document_versions (
  id             uuid primary key default gen_random_uuid(),
  doc_type       text not null check (doc_type in ('privacy', 'rules', 'withdrawal')),
  version        text not null,
  title          text not null,
  body_md        text not null,          -- texto con placeholders {{...}}
  checkbox_label text not null,          -- texto de la casilla de aceptación
  effective_from date not null,
  -- false = cambio menor: quien firmó la versión anterior no tiene que volver a firmar.
  requires_resign boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (doc_type, version)
);
alter table public.document_versions enable row level security;

-- Los textos legales nunca se editan ni se borran: se inserta una versión nueva.
create or replace function public.document_versions_immutable()
returns trigger language plpgsql as $fn$
begin
  raise exception 'Los textos legales no se modifican: inserta una versión nueva en document_versions.';
end;
$fn$;
drop trigger if exists document_versions_no_update on public.document_versions;
create trigger document_versions_no_update
  before update or delete on public.document_versions
  for each row execute function public.document_versions_immutable();

create table if not exists public.consents (
  id                        uuid primary key default gen_random_uuid(),
  patient_id                uuid references public.profiles (id) on delete set null,
  therapist_id              uuid not null references public.therapists (id),
  patient_name              text not null,
  patient_surname           text not null,
  patient_id_number         text not null,      -- DNI/NIE
  patient_email             text not null,
  patient_phone             text,
  patient_birthdate         date not null,
  is_minor                  boolean not null default false,
  privacy_version_id        uuid not null references public.document_versions (id),
  rules_version_id          uuid not null references public.document_versions (id),
  withdrawal_version_id     uuid not null references public.document_versions (id),
  accepted_privacy          boolean not null check (accepted_privacy),
  accepted_rules            boolean not null check (accepted_rules),
  accepted_withdrawal_start boolean not null check (accepted_withdrawal_start),
  signature_png_path        text not null,
  pdf_path                  text not null,
  pdf_sha256                text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  rendered_text_sha256      text not null check (rendered_text_sha256 ~ '^[0-9a-f]{64}$'),
  signed_at                 timestamptz not null default now(),
  ip                        inet,
  user_agent                text,
  created_at                timestamptz not null default now()
);
alter table public.consents enable row level security;
create index if not exists consents_patient_idx on public.consents (patient_id, signed_at desc);

-- Una firma es una evidencia: no se modifica ni se borra.
create or replace function public.consents_immutable()
returns trigger language plpgsql as $fn$
begin
  -- Única excepción: al borrar un paciente, la firma se conserva sin el enlace.
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'patient_id') = (to_jsonb(old) - 'patient_id')
     and new.patient_id is null then
    return new;
  end if;
  raise exception 'Las firmas de consentimiento no se modifican ni se borran.';
end;
$fn$;
drop trigger if exists consents_no_change on public.consents;
create trigger consents_no_change
  before update or delete on public.consents
  for each row execute function public.consents_immutable();

create table if not exists public.consent_attempts (
  id         bigint generated always as identity primary key,
  user_id    uuid,
  ip_hash    text,                       -- SHA-256 de la IP (no se guarda la IP en claro)
  created_at timestamptz not null default now()
);
alter table public.consent_attempts enable row level security;
create index if not exists consent_attempts_recent_idx on public.consent_attempts (created_at);

-- Bucket privado para los PDF y las firmas (sin políticas: solo service_role).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('consents', 'consents', false, 5242880, array['application/pdf', 'image/png'])
on conflict (id) do update set public = false;

-- ─── Estado del consentimiento de un paciente ───────────────────────────────
-- Versiones vigentes: la última de cada tipo con effective_from <= hoy (Madrid).
create or replace function public.current_document_versions()
returns setof public.document_versions
language sql stable security definer set search_path = public as $fn$
  select distinct on (doc_type) *
    from public.document_versions
   where effective_from <= (now() at time zone 'Europe/Madrid')::date
   order by doc_type, effective_from desc, created_at desc;
$fn$;
revoke all on function public.current_document_versions() from public, anon, authenticated;
grant execute on function public.current_document_versions() to service_role;

-- 'pendiente' (nunca ha firmado) · 'actualizacion' (firmó una versión que ya
-- no está vigente y la nueva pide volver a firmar) · 'firmado'.
create or replace function public.consent_status_for(p_patient uuid)
returns text
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_last public.consents;
begin
  select * into v_last from public.consents
   where patient_id = p_patient order by signed_at desc limit 1;
  if not found then return 'pendiente'; end if;
  if exists (
    select 1 from public.current_document_versions() d
     where d.requires_resign
       and d.id <> case d.doc_type
                     when 'privacy' then v_last.privacy_version_id
                     when 'rules' then v_last.rules_version_id
                     else v_last.withdrawal_version_id end
  ) then
    return 'actualizacion';
  end if;
  return 'firmado';
end;
$fn$;
revoke all on function public.consent_status_for(uuid) from public, anon, authenticated;
grant execute on function public.consent_status_for(uuid) to service_role;

-- Estado y firmas de un paciente: el propio paciente o la administración.
create or replace function public.consent_overview(p_patient uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
begin
  if auth.uid() is null or (auth.uid() <> p_patient and not public.is_admin()) then
    raise exception 'NOT_ALLOWED';
  end if;
  return jsonb_build_object(
    'status', public.consent_status_for(p_patient),
    'block_booking', coalesce((select block_booking_until_consent from public.consent_settings where id = 1), false),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'signed_at', c.signed_at,
               'versions', jsonb_build_object('privacy', pv.version, 'rules', rv.version, 'withdrawal', wv.version)
             ) order by c.signed_at desc)
        from public.consents c
        join public.document_versions pv on pv.id = c.privacy_version_id
        join public.document_versions rv on rv.id = c.rules_version_id
        join public.document_versions wv on wv.id = c.withdrawal_version_id
       where c.patient_id = p_patient), '[]'::jsonb)
  );
end;
$fn$;
revoke all on function public.consent_overview(uuid) from public, anon;
grant execute on function public.consent_overview(uuid) to authenticated;

-- Todo lo que necesita la página de firma del paciente que llama: textos
-- vigentes, datos para los placeholders y lo que ya hay en su ficha.
create or replace function public.consent_context()
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_patient public.profiles;
  v_ther    public.therapists;
  v_set     public.consent_settings;
begin
  select * into v_patient from public.profiles where id = auth.uid() and role = 'patient' and active;
  if not found then raise exception 'NOT_ALLOWED'; end if;
  select * into v_set from public.consent_settings where id = 1;
  select * into v_ther from public.therapists
   where profile_id = v_patient.psychologist_id and active;
  return jsonb_build_object(
    'status', public.consent_status_for(v_patient.id),
    'ready', v_set.id is not null and v_ther.id is not null,
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'doc_type', d.doc_type, 'version', d.version, 'title', d.title,
               'body_md', d.body_md, 'checkbox_label', d.checkbox_label)
             order by array_position(array['privacy', 'rules', 'withdrawal'], d.doc_type))
        from public.current_document_versions() d), '[]'::jsonb),
    'settings', case when v_set.id is null then null else jsonb_build_object(
      'responsable_nombre', v_set.responsable_nombre, 'responsable_dni', v_set.responsable_dni,
      'responsable_direccion', v_set.responsable_direccion, 'email_contacto', v_set.email_contacto,
      'iban', v_set.iban, 'plataforma_videollamada', v_set.plataforma_videollamada) end,
    'therapist', case when v_ther.id is null then null else jsonb_build_object(
      'full_name', v_ther.full_name, 'dni', v_ther.dni, 'collegiate_number', v_ther.collegiate_number,
      'price_single_eur', v_ther.price_single_eur, 'price_pack5_eur', v_ther.price_pack5_eur,
      'session_minutes', v_ther.session_minutes) end,
    'patient', jsonb_build_object(
      'full_name', v_patient.full_name, 'email', v_patient.email, 'phone', v_patient.phone,
      'tax_id', v_patient.tax_id, 'birth_date', v_patient.birth_date)
  );
end;
$fn$;
revoke all on function public.consent_context() from public, anon;
grant execute on function public.consent_context() to authenticated;

-- ─── Datos iniciales ────────────────────────────────────────────────────────
insert into public.consent_settings
  (id, responsable_nombre, responsable_dni, responsable_direccion, email_contacto, iban, plataforma_videollamada)
values
  (1, 'Silvia López Fernández', '03933796Z', '',  -- sin domicilio: ver 20261109_consentimiento_sin_domicilio.sql
   'silozpsicologia@gmail.com', 'ES34 2100 7823 6213 0025 8116', 'Google Meet')
on conflict (id) do nothing;

insert into public.therapists (profile_id, slug, full_name, dni, collegiate_number, email, session_minutes)
select p.id, 'silvia', 'Silvia López Fernández', '03933796Z', 'M-40562', 'silozpsicologia@gmail.com', 50
  from public.profiles p
 where p.role = 'admin' and p.email = 'silozpsicologia@gmail.com'
on conflict (slug) do nothing;

insert into public.document_versions (doc_type, version, title, checkbox_label, effective_from, body_md) values
('privacy', '2.0', 'Información y consentimiento sobre protección de datos',
 'He leído la información sobre protección de datos y presto mi consentimiento.', '2026-11-08',
$txt$**Responsable del tratamiento.** Le informamos que los datos personales que facilite serán tratados por {{responsable_nombre}}, con DNI {{responsable_dni}} y domicilio profesional en {{responsable_direccion}}, con la finalidad de la prevención, diagnóstico y tratamiento psicológico, así como para la gestión administrativa y sanitaria de los servicios que el centro le preste en cada momento. El profesional que prestará la asistencia es {{profesional_nombre}} (DNI {{profesional_dni}}, colegiada n.º {{profesional_colegiada}}), que trata sus datos bajo la responsabilidad y las instrucciones de la responsable del tratamiento y sujeta a secreto profesional.

**Conservación.** Los datos personales se conservarán durante el tiempo necesario para la prestación del servicio asistencial y, posteriormente, durante los plazos legalmente establecidos, en particular conforme a la Ley 41/2002, de 14 de noviembre, básica reguladora de la autonomía del paciente y de derechos y obligaciones en materia de información y documentación clínica. Una vez transcurridos dichos plazos, los datos serán suprimidos, salvo en los supuestos legalmente previstos.

**Base legal.** La base legal para el tratamiento de sus datos es el consentimiento explícito del interesado y la necesidad del tratamiento para la prestación de asistencia sanitaria, todo ello conforme al Reglamento (UE) 2016/679 del Parlamento Europeo y del Consejo, de 27 de abril de 2016 (RGPD), y la Ley Orgánica 3/2018, de Protección de Datos Personales y Garantía de los Derechos Digitales.

**Destinatarios y encargados del tratamiento.** Sus datos no se cederán a terceros, salvo obligación legal. Para la prestación del servicio, la responsable recurre a proveedores que actúan como encargados del tratamiento y acceden a los datos únicamente en la medida necesaria para prestar su servicio y bajo las garantías del RGPD: alojamiento de correo electrónico y archivos, plataforma de videollamada ({{plataforma_videollamada}}), alojamiento de la web y base de datos del sistema de firma, y mensajería instantánea. Algunos de estos proveedores pueden realizar transferencias internacionales de datos al amparo de las garantías previstas en el RGPD (decisiones de adecuación o cláusulas contractuales tipo). Puede solicitar más información sobre los encargados en {{email_contacto}}.

**Derechos.** Podrá ejercer en cualquier momento sus derechos de acceso, rectificación, supresión, limitación del tratamiento, portabilidad y oposición, mediante escrito dirigido a la responsable del tratamiento en la dirección indicada o mediante correo electrónico a {{email_contacto}}, adjuntando documento que acredite su identidad. Igualmente, podrá presentar una reclamación ante la Agencia Española de Protección de Datos (AEPD). Para garantizar la seguridad de los datos personales, en determinados supuestos podrá solicitarse acreditación de identidad.

El paciente declara haber sido informado de forma clara y comprensible sobre el tratamiento de sus datos personales y presta su consentimiento para ello.$txt$),
('rules', '2.0', 'Normas del servicio',
 'He leído y acepto las normas del servicio.', '2026-11-08',
$txt$Por favor, lea detenidamente las normas explicadas a continuación. Su objetivo es maximizar la eficacia del tratamiento y garantizar el adecuado funcionamiento del servicio para todos los pacientes. El servicio lo presta {{responsable_nombre}} ("el centro"), a través de la profesional {{profesional_nombre}} (DNI {{profesional_dni}}).

**Asistencia e implicación.** Para que el tratamiento sea eficaz, es esencial acudir a todas las sesiones pautadas por su terapeuta. Asimismo, es imprescindible su implicación y trabajo en terapia, por lo que deberá cumplimentar los cuestionarios y tareas que le sean indicados.

**Formato y duración.** Las sesiones se realizan en formato online a través de {{plataforma_videollamada}} y tienen una duración de {{duracion_sesion}} minutos.

**Cancelaciones por parte del paciente.** Las sesiones no deberán anularse salvo por causas de fuerza mayor, ya que ello repercute negativamente en la continuidad del tratamiento y perjudica a otros pacientes que podrían ser atendidos en ese horario. En caso de no poder acudir, deberá comunicarlo con la mayor antelación posible. Cuando la cancelación no se realice con al menos 24 horas de antelación respecto a la hora de la sesión, se aplicarán las siguientes condiciones: en las dos primeras ocasiones se abonará el 50 % del coste de la sesión y, a partir de la tercera, el 100 %. Las sesiones canceladas sin respetar el preaviso o no realizadas se abonarán como sesión suelta y no podrán descontarse de los bonos.

**Cancelaciones por parte del centro.** Si la terapeuta cancelase una sesión con menos de 24 horas de antelación por causas no imputables al paciente, la sesión se repondrá en la fecha más próxima posible sin coste adicional y, si el paciente lo prefiere, se le bonificará el 50 % de la siguiente sesión.

**Puntualidad.** Se ruega puntualidad. Si la terapeuta se retrasa por causas asistenciales, el paciente dispondrá del tiempo completo de su sesión. Si el retraso es del paciente, la sesión finalizará a la hora inicialmente acordada.

**Precio y bonos.** El coste del servicio es de {{precio_sesion}} euros por sesión suelta o de {{precio_bono5}} euros por un bono de 5 sesiones. Los bonos no caducan. Se recomienda consumirlos con frecuencia semanal, salvo pauta distinta acordada con la terapeuta. Transcurrido el plazo legal de desistimiento de 14 días (ver bloque siguiente), las sesiones de bono no consumidas no son reembolsables, salvo que la imposibilidad de prestar el servicio sea imputable al centro, en cuyo caso se reembolsará la parte no consumida.

**Pago.** Las sesiones se abonan con carácter previo a su realización. Si existen pagos pendientes, no podrá prestarse el servicio. El pago puede realizarse justo antes de la sesión siempre que se remita el justificante. Método de pago: transferencia bancaria a la cuenta {{iban}}. La actividad de psicoterapia sanitaria está exenta de IVA.

**Continuidad.** Para obtener el máximo beneficio terapéutico, mantener los resultados a largo plazo y prevenir recaídas, se recomienda continuar el tratamiento hasta su finalización, según lo acordado con la terapeuta.

**Reclamaciones.** Puede dirigir cualquier reclamación a {{email_contacto}} o por escrito a {{responsable_direccion}}.$txt$),
('withdrawal', '1.0', 'Derecho de desistimiento y solicitud de inicio del servicio',
 'Solicito expresamente que el servicio comience antes de que finalice el plazo de desistimiento de 14 días, y entiendo que, si desisto, abonaré la parte proporcional de las sesiones realizadas y que el derecho se extingue una vez prestado el servicio en su totalidad.', '2026-11-08',
$txt$Al contratar el servicio a distancia, dispone de un plazo de 14 días naturales desde la fecha de aceptación de estas condiciones para desistir del contrato sin necesidad de justificación, comunicándolo a {{email_contacto}} o por escrito a {{responsable_direccion}}. Puede utilizar el formulario que figura al final de este documento, aunque no es obligatorio.

Si solicita que el servicio comience durante el plazo de desistimiento y posteriormente desiste, abonará la parte proporcional de las sesiones ya realizadas. Si el servicio se ha prestado completamente dentro del plazo con su consentimiento, el derecho de desistimiento se extingue. En caso de bonos, el desistimiento dentro del plazo da derecho al reembolso de las sesiones no consumidas.

**Formulario de desistimiento (modelo):** A la atención de {{responsable_nombre}}, {{responsable_direccion}}, {{email_contacto}}. Por la presente le comunico que desisto de mi contrato de prestación de servicios de psicoterapia aceptado el día ____. Nombre del consumidor: ____. Dirección: ____. Fecha y firma: ____.$txt$)
on conflict (doc_type, version) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- CONSENTIMIENTO SIN DOMICILIO (docs/consentimiento-firma.md → «Sin domicilio»)
--
-- El domicilio de la responsable del tratamiento (su domicilio particular)
-- deja de aparecer en todo lo que ve el paciente. Para identificarla bastan
-- nombre, DNI y email de contacto.
--
-- · Textos nuevos A 2.1 · B 2.1 · C 1.1: iguales que A 2.0 · B 2.0 · C 1.0
--   sin el domicilio. requires_resign = false: quien ya firmó NO tiene que
--   volver a firmar. supersedes_id enlaza cada versión con la que sustituye.
-- · consent_text_snapshots: copia literal del texto que se firmó (con sus datos
--   sustituidos). Para las firmas existentes se reconstruye aquí y se
--   comprueba contra consents.rendered_text_sha256 antes de guardarla. Es la
--   constancia de lo firmado originalmente y el único sitio donde queda el
--   domicilio (no se muestra a nadie: RLS sin políticas).
-- · consents.pdf_template: plantilla del PDF guardado (1 = con domicilio).
-- · consent_reissues: PDF reemitido (sin domicilio) que sustituye al
--   archivo guardado. consents sigue intacto (fecha, firma, IP, versiones y la
--   huella del PDF original); el archivo vigente se comprueba con
--   consent_reissues.pdf_sha256.
-- · consent_settings.responsable_direccion se vacía (solo existía para esto). La
--   columna se deja, sin uso, para que schema.sql se pueda volver a ejecutar.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.document_versions
  add column if not exists supersedes_id uuid references public.document_versions (id);

alter table public.consents add column if not exists pdf_template int not null default 1;

create table if not exists public.consent_text_snapshots (
  consent_id    uuid primary key references public.consents (id),
  rendered_text text not null,             -- texto canónico firmado (shared/consent.ts → canonicalText)
  created_at    timestamptz not null default now()
);
alter table public.consent_text_snapshots enable row level security;

create table if not exists public.consent_reissues (
  consent_id   uuid primary key references public.consents (id),
  pdf_template int not null,
  pdf_sha256   text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  versions     jsonb not null,             -- {privacy, rules, withdrawal}: versiones del texto de la copia
  reissued_at  timestamptz not null default now()
);
alter table public.consent_reissues enable row level security;

-- ─── Constancia del texto firmado (antes de quitar el domicilio) ────────────
do $do$
declare
  r record;
  v_vid uuid;
  v_text text;
  v_parts text[];
  v_doc public.document_versions;
  v_vals jsonb;
  k text;
  v_body text;
begin
  -- Solo las firmas con el PDF antiguo (con domicilio) y mientras el
  -- domicilio siga en los ajustes; las firmas nuevas guardan su copia al firmar.
  if (select responsable_direccion from public.consent_settings where id = 1) is null then
    return;
  end if;
  for r in
    select c.*, s.responsable_nombre, s.responsable_dni, s.responsable_direccion, s.email_contacto,
           s.iban, s.plataforma_videollamada, t.full_name as t_name, t.dni as t_dni,
           t.collegiate_number, t.price_single_eur, t.price_pack5_eur, t.session_minutes
      from public.consents c
      join public.therapists t on t.id = c.therapist_id
      cross join public.consent_settings s
     where c.pdf_template = 1
       and not exists (select 1 from public.consent_text_snapshots x where x.consent_id = c.id)
  loop
    v_vals := jsonb_build_object(
      'responsable_nombre', r.responsable_nombre, 'responsable_dni', r.responsable_dni,
      'responsable_direccion', r.responsable_direccion, 'email_contacto', r.email_contacto,
      'iban', r.iban, 'plataforma_videollamada', r.plataforma_videollamada,
      'profesional_nombre', r.t_name, 'profesional_dni', r.t_dni,
      'profesional_colegiada', coalesce(nullif(r.collegiate_number, ''), '—'),
      'precio_sesion', case when r.price_single_eur = trunc(r.price_single_eur) then trunc(r.price_single_eur)::text
                            else replace(to_char(r.price_single_eur, 'FM999990.00'), '.', ',') end,
      'precio_bono5', case when r.price_pack5_eur = trunc(r.price_pack5_eur) then trunc(r.price_pack5_eur)::text
                           else replace(to_char(r.price_pack5_eur, 'FM999990.00'), '.', ',') end,
      'duracion_sesion', r.session_minutes::text,
      'paciente_nombre', r.patient_name || ' ' || r.patient_surname,
      'paciente_dni', r.patient_id_number);
    v_parts := array[]::text[];
    foreach v_vid in array array[r.privacy_version_id, r.rules_version_id, r.withdrawal_version_id] loop
      select * into v_doc from public.document_versions where id = v_vid;
      v_body := v_doc.body_md;
      for k in select jsonb_object_keys(v_vals) loop
        v_body := replace(v_body, '{{' || k || '}}', v_vals ->> k);
      end loop;
      -- Igual que plainText(): sin «**», párrafos separados por una línea en blanco.
      v_body := array_to_string(array(
        select btrim(regexp_replace(p, '\s*\n\s*', ' ', 'g'))
          from unnest(regexp_split_to_array(replace(v_body, '**', ''), '\n\s*\n')) as p
         where btrim(p) <> ''), E'\n\n');
      v_parts := v_parts || (v_doc.title || ' (versión ' || v_doc.version || ')' || E'\n\n' || v_body
                             || E'\n\n[X] ' || v_doc.checkbox_label);
    end loop;
    v_text := array_to_string(v_parts, E'\n\n----\n\n');
    if encode(sha256(convert_to(v_text, 'UTF8')), 'hex') <> r.rendered_text_sha256 then
      raise exception 'El texto reconstruido de la firma % no coincide con su huella: no se sigue.', r.id;
    end if;
    insert into public.consent_text_snapshots (consent_id, rendered_text) values (r.id, v_text);
  end loop;
end
$do$;

-- ─── Textos sin domicilio ───────────────────────────────────────────────────
insert into public.document_versions
  (doc_type, version, title, checkbox_label, effective_from, requires_resign, supersedes_id, body_md)
select 'privacy', '2.1', 'Información y consentimiento sobre protección de datos',
 'He leído la información sobre protección de datos y presto mi consentimiento.',
 (now() at time zone 'Europe/Madrid')::date, false,
 (select id from public.document_versions where doc_type = 'privacy' and version = '2.0'),
$txt$**Responsable del tratamiento.** Le informamos que los datos personales que facilite serán tratados por {{responsable_nombre}}, con DNI {{responsable_dni}} y correo electrónico de contacto {{email_contacto}}, con la finalidad de la prevención, diagnóstico y tratamiento psicológico, así como para la gestión administrativa y sanitaria de los servicios que el centro le preste en cada momento. El profesional que prestará la asistencia es {{profesional_nombre}} (DNI {{profesional_dni}}, colegiada n.º {{profesional_colegiada}}), que trata sus datos bajo la responsabilidad y las instrucciones de la responsable del tratamiento y sujeta a secreto profesional.

**Conservación.** Los datos personales se conservarán durante el tiempo necesario para la prestación del servicio asistencial y, posteriormente, durante los plazos legalmente establecidos, en particular conforme a la Ley 41/2002, de 14 de noviembre, básica reguladora de la autonomía del paciente y de derechos y obligaciones en materia de información y documentación clínica. Una vez transcurridos dichos plazos, los datos serán suprimidos, salvo en los supuestos legalmente previstos.

**Base legal.** La base legal para el tratamiento de sus datos es el consentimiento explícito del interesado y la necesidad del tratamiento para la prestación de asistencia sanitaria, todo ello conforme al Reglamento (UE) 2016/679 del Parlamento Europeo y del Consejo, de 27 de abril de 2016 (RGPD), y la Ley Orgánica 3/2018, de Protección de Datos Personales y Garantía de los Derechos Digitales.

**Destinatarios y encargados del tratamiento.** Sus datos no se cederán a terceros, salvo obligación legal. Para la prestación del servicio, la responsable recurre a proveedores que actúan como encargados del tratamiento y acceden a los datos únicamente en la medida necesaria para prestar su servicio y bajo las garantías del RGPD: alojamiento de correo electrónico y archivos, plataforma de videollamada ({{plataforma_videollamada}}), alojamiento de la web y base de datos del sistema de firma, y mensajería instantánea. Algunos de estos proveedores pueden realizar transferencias internacionales de datos al amparo de las garantías previstas en el RGPD (decisiones de adecuación o cláusulas contractuales tipo). Puede solicitar más información sobre los encargados en {{email_contacto}}.

**Derechos.** Podrá ejercer en cualquier momento sus derechos de acceso, rectificación, supresión, limitación del tratamiento, portabilidad y oposición mediante correo electrónico dirigido a la responsable del tratamiento a {{email_contacto}}, adjuntando documento que acredite su identidad. Igualmente, podrá presentar una reclamación ante la Agencia Española de Protección de Datos (AEPD). Para garantizar la seguridad de los datos personales, en determinados supuestos podrá solicitarse acreditación de identidad.

El paciente declara haber sido informado de forma clara y comprensible sobre el tratamiento de sus datos personales y presta su consentimiento para ello.$txt$
where not exists (select 1 from public.document_versions where doc_type = 'privacy' and version = '2.1');

insert into public.document_versions
  (doc_type, version, title, checkbox_label, effective_from, requires_resign, supersedes_id, body_md)
select 'rules', '2.1', 'Normas del servicio', 'He leído y acepto las normas del servicio.',
 (now() at time zone 'Europe/Madrid')::date, false,
 (select id from public.document_versions where doc_type = 'rules' and version = '2.0'),
$txt$Por favor, lea detenidamente las normas explicadas a continuación. Su objetivo es maximizar la eficacia del tratamiento y garantizar el adecuado funcionamiento del servicio para todos los pacientes. El servicio lo presta {{responsable_nombre}} ("el centro"), a través de la profesional {{profesional_nombre}} (DNI {{profesional_dni}}).

**Asistencia e implicación.** Para que el tratamiento sea eficaz, es esencial acudir a todas las sesiones pautadas por su terapeuta. Asimismo, es imprescindible su implicación y trabajo en terapia, por lo que deberá cumplimentar los cuestionarios y tareas que le sean indicados.

**Formato y duración.** Las sesiones se realizan en formato online a través de {{plataforma_videollamada}} y tienen una duración de {{duracion_sesion}} minutos.

**Cancelaciones por parte del paciente.** Las sesiones no deberán anularse salvo por causas de fuerza mayor, ya que ello repercute negativamente en la continuidad del tratamiento y perjudica a otros pacientes que podrían ser atendidos en ese horario. En caso de no poder acudir, deberá comunicarlo con la mayor antelación posible. Cuando la cancelación no se realice con al menos 24 horas de antelación respecto a la hora de la sesión, se aplicarán las siguientes condiciones: en las dos primeras ocasiones se abonará el 50 % del coste de la sesión y, a partir de la tercera, el 100 %. Las sesiones canceladas sin respetar el preaviso o no realizadas se abonarán como sesión suelta y no podrán descontarse de los bonos.

**Cancelaciones por parte del centro.** Si la terapeuta cancelase una sesión con menos de 24 horas de antelación por causas no imputables al paciente, la sesión se repondrá en la fecha más próxima posible sin coste adicional y, si el paciente lo prefiere, se le bonificará el 50 % de la siguiente sesión.

**Puntualidad.** Se ruega puntualidad. Si la terapeuta se retrasa por causas asistenciales, el paciente dispondrá del tiempo completo de su sesión. Si el retraso es del paciente, la sesión finalizará a la hora inicialmente acordada.

**Precio y bonos.** El coste del servicio es de {{precio_sesion}} euros por sesión suelta o de {{precio_bono5}} euros por un bono de 5 sesiones. Los bonos no caducan. Se recomienda consumirlos con frecuencia semanal, salvo pauta distinta acordada con la terapeuta. Transcurrido el plazo legal de desistimiento de 14 días (ver bloque siguiente), las sesiones de bono no consumidas no son reembolsables, salvo que la imposibilidad de prestar el servicio sea imputable al centro, en cuyo caso se reembolsará la parte no consumida.

**Pago.** Las sesiones se abonan con carácter previo a su realización. Si existen pagos pendientes, no podrá prestarse el servicio. El pago puede realizarse justo antes de la sesión siempre que se remita el justificante. Método de pago: transferencia bancaria a la cuenta {{iban}}. La actividad de psicoterapia sanitaria está exenta de IVA.

**Continuidad.** Para obtener el máximo beneficio terapéutico, mantener los resultados a largo plazo y prevenir recaídas, se recomienda continuar el tratamiento hasta su finalización, según lo acordado con la terapeuta.

**Reclamaciones.** Puede dirigir cualquier reclamación a {{email_contacto}}.$txt$
where not exists (select 1 from public.document_versions where doc_type = 'rules' and version = '2.1');

insert into public.document_versions
  (doc_type, version, title, checkbox_label, effective_from, requires_resign, supersedes_id, body_md)
select 'withdrawal', '1.1', 'Derecho de desistimiento y solicitud de inicio del servicio',
 'Solicito expresamente que el servicio comience antes de que finalice el plazo de desistimiento de 14 días, y entiendo que, si desisto, abonaré la parte proporcional de las sesiones realizadas y que el derecho se extingue una vez prestado el servicio en su totalidad.',
 (now() at time zone 'Europe/Madrid')::date, false,
 (select id from public.document_versions where doc_type = 'withdrawal' and version = '1.0'),
$txt$Al contratar el servicio a distancia, dispone de un plazo de 14 días naturales desde la fecha de aceptación de estas condiciones para desistir del contrato sin necesidad de justificación, comunicándolo a {{email_contacto}}. Puede utilizar el formulario que figura al final de este documento, aunque no es obligatorio.

Si solicita que el servicio comience durante el plazo de desistimiento y posteriormente desiste, abonará la parte proporcional de las sesiones ya realizadas. Si el servicio se ha prestado completamente dentro del plazo con su consentimiento, el derecho de desistimiento se extingue. En caso de bonos, el desistimiento dentro del plazo da derecho al reembolso de las sesiones no consumidas.

**Formulario de desistimiento (modelo):** A la atención de {{responsable_nombre}}, {{email_contacto}}. Por la presente le comunico que desisto de mi contrato de prestación de servicios de psicoterapia aceptado el día ____. Nombre del consumidor: ____. Dirección: ____. Fecha y firma: ____.$txt$
where not exists (select 1 from public.document_versions where doc_type = 'withdrawal' and version = '1.1');

-- Versiones para la copia reemitida de una firma: desde la versión firmada se
-- siguen las sucesoras que no piden volver a firmar (cambios sin efecto para
-- el paciente, como quitar el domicilio). Solo para el servidor.
create or replace function public.consent_reissue_versions(p_consent uuid)
returns setof public.document_versions
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_id uuid;
  v_next uuid;
  c public.consents;
begin
  select * into c from public.consents where id = p_consent;
  if not found then return; end if;
  foreach v_id in array array[c.privacy_version_id, c.rules_version_id, c.withdrawal_version_id] loop
    loop
      select d.id into v_next from public.document_versions d
       where d.supersedes_id = v_id and not d.requires_resign
         and d.effective_from <= (now() at time zone 'Europe/Madrid')::date
       order by d.effective_from desc, d.created_at desc limit 1;
      exit when v_next is null;
      v_id := v_next;
    end loop;
    return query select * from public.document_versions where id = v_id;
  end loop;
end;
$fn$;
revoke all on function public.consent_reissue_versions(uuid) from public, anon, authenticated;
grant execute on function public.consent_reissue_versions(uuid) to service_role;

-- ─── El domicilio deja de existir en los ajustes ───────────────────────────
create or replace function public.consent_context()
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_patient public.profiles;
  v_ther    public.therapists;
  v_set     public.consent_settings;
begin
  select * into v_patient from public.profiles where id = auth.uid() and role = 'patient' and active;
  if not found then raise exception 'NOT_ALLOWED'; end if;
  select * into v_set from public.consent_settings where id = 1;
  select * into v_ther from public.therapists
   where profile_id = v_patient.psychologist_id and active;
  return jsonb_build_object(
    'status', public.consent_status_for(v_patient.id),
    'ready', v_set.id is not null and v_ther.id is not null,
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'doc_type', d.doc_type, 'version', d.version, 'title', d.title,
               'body_md', d.body_md, 'checkbox_label', d.checkbox_label)
             order by array_position(array['privacy', 'rules', 'withdrawal'], d.doc_type))
        from public.current_document_versions() d), '[]'::jsonb),
    'settings', case when v_set.id is null then null else jsonb_build_object(
      'responsable_nombre', v_set.responsable_nombre, 'responsable_dni', v_set.responsable_dni,
      'email_contacto', v_set.email_contacto,
      'iban', v_set.iban, 'plataforma_videollamada', v_set.plataforma_videollamada) end,
    'therapist', case when v_ther.id is null then null else jsonb_build_object(
      'full_name', v_ther.full_name, 'dni', v_ther.dni, 'collegiate_number', v_ther.collegiate_number,
      'price_single_eur', v_ther.price_single_eur, 'price_pack5_eur', v_ther.price_pack5_eur,
      'session_minutes', v_ther.session_minutes) end,
    'patient', jsonb_build_object(
      'full_name', v_patient.full_name, 'email', v_patient.email, 'phone', v_patient.phone,
      'tax_id', v_patient.tax_id, 'birth_date', v_patient.birth_date)
  );
end;
$fn$;
revoke all on function public.consent_context() from public, anon;
grant execute on function public.consent_context() to authenticated;

alter table public.consent_settings alter column responsable_direccion drop not null;
update public.consent_settings set responsable_direccion = null where responsable_direccion is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- HIGHLIGHTS DE SESIÓN CON IA (Claude, API de Anthropic) Y CONSENTIMIENTO A 2.2
-- (docs/highlights-ia.md)
--
-- · Texto A 2.2: el 2.1 más el párrafo «Uso de inteligencia artificial» y la
--   mención en «Destinatarios y encargados» (texto aprobado por el cliente).
--   requires_resign = false: quien ya firmó NO tiene que volver a firmar; se le
--   informa con un aviso en su área (consent_overview.info_update).
--   supersedes_id = null a propósito: NO es un cambio sin efecto para el
--   paciente, así que los PDF de firmas anteriores no se reemiten con este texto.
-- · profiles.ai_opt_out: el paciente se opone al uso de IA con sus notas (lo
--   marca la psicóloga en la ficha cuando el paciente lo pide por email).
-- · session_highlights: highlights generados por IA de cada sesión (texto de
--   Silvia como instrucciones). Borrador solo para administración (RLS); el
--   paciente ve únicamente lo que la psicóloga publica (published_content), a
--   través de my_session_highlights().
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles add column if not exists ai_opt_out boolean not null default false;

create table if not exists public.session_highlights (
  appointment_id uuid primary key references public.appointments (id) on delete cascade,
  content        text not null check (length(content) <= 10000),
  model          text not null,           -- modelo que lo generó (p. ej. claude-opus-5-5)
  notes_sha256   text not null,           -- huella de las notas de las que salió
  generated_at   timestamptz not null default now(),
  edited_at      timestamptz,             -- la psicóloga lo ha retocado a mano
  published_content text check (length(published_content) <= 10000), -- lo que ve el paciente
  published_at   timestamptz,             -- null = no publicado
  updated_at     timestamptz not null default now()
);
alter table public.session_highlights enable row level security;

drop trigger if exists session_highlights_touch_updated_at on public.session_highlights;
create trigger session_highlights_touch_updated_at
  before update on public.session_highlights
  for each row execute function public.touch_updated_at();

drop policy if exists "session_highlights: admin lee" on public.session_highlights;
create policy "session_highlights: admin lee"
  on public.session_highlights for select to authenticated using (public.is_admin());
drop policy if exists "session_highlights: admin modifica" on public.session_highlights;
create policy "session_highlights: admin modifica"
  on public.session_highlights for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "session_highlights: admin borra" on public.session_highlights;
create policy "session_highlights: admin borra"
  on public.session_highlights for delete to authenticated using (public.is_admin());
-- (Los crea solo el servidor, api/session-highlights.ts, con service_role.)

insert into public.document_versions
  (doc_type, version, title, checkbox_label, effective_from, requires_resign, supersedes_id, body_md)
select 'privacy', '2.2', 'Información y consentimiento sobre protección de datos',
 'He leído la información sobre protección de datos y presto mi consentimiento.',
 (now() at time zone 'Europe/Madrid')::date, false, null,
$txt$**Responsable del tratamiento.** Le informamos que los datos personales que facilite serán tratados por {{responsable_nombre}}, con DNI {{responsable_dni}} y correo electrónico de contacto {{email_contacto}}, con la finalidad de la prevención, diagnóstico y tratamiento psicológico, así como para la gestión administrativa y sanitaria de los servicios que el centro le preste en cada momento. El profesional que prestará la asistencia es {{profesional_nombre}} (DNI {{profesional_dni}}, colegiada n.º {{profesional_colegiada}}), que trata sus datos bajo la responsabilidad y las instrucciones de la responsable del tratamiento y sujeta a secreto profesional.

**Conservación.** Los datos personales se conservarán durante el tiempo necesario para la prestación del servicio asistencial y, posteriormente, durante los plazos legalmente establecidos, en particular conforme a la Ley 41/2002, de 14 de noviembre, básica reguladora de la autonomía del paciente y de derechos y obligaciones en materia de información y documentación clínica. Una vez transcurridos dichos plazos, los datos serán suprimidos, salvo en los supuestos legalmente previstos.

**Base legal.** La base legal para el tratamiento de sus datos es el consentimiento explícito del interesado y la necesidad del tratamiento para la prestación de asistencia sanitaria, todo ello conforme al Reglamento (UE) 2016/679 del Parlamento Europeo y del Consejo, de 27 de abril de 2016 (RGPD), y la Ley Orgánica 3/2018, de Protección de Datos Personales y Garantía de los Derechos Digitales.

**Destinatarios y encargados del tratamiento.** Sus datos no se cederán a terceros, salvo obligación legal. Para la prestación del servicio, la responsable recurre a proveedores que actúan como encargados del tratamiento y acceden a los datos únicamente en la medida necesaria para prestar su servicio y bajo las garantías del RGPD: alojamiento de correo electrónico y archivos, plataforma de videollamada ({{plataforma_videollamada}}), alojamiento de la web y base de datos del sistema de firma, mensajería instantánea y herramienta de inteligencia artificial para resumir notas de sesión (Anthropic; ver «Uso de inteligencia artificial»). Algunos de estos proveedores pueden realizar transferencias internacionales de datos al amparo de las garantías previstas en el RGPD (decisiones de adecuación o cláusulas contractuales tipo). Puede solicitar más información sobre los encargados en {{email_contacto}}.

**Uso de inteligencia artificial.** Como apoyo a la documentación clínica, la psicóloga puede utilizar una herramienta de inteligencia artificial para resumir sus notas de sesión. A la herramienta se envía solo el texto de las notas, sin su nombre, DNI ni datos de contacto. El proveedor, Anthropic Ireland, Limited (cuya matriz, Anthropic, PBC, está en Estados Unidos), actúa como encargado del tratamiento: no utiliza los datos para entrenar sus modelos y los borra en un plazo máximo de 30 días, salvo que sus sistemas de seguridad marquen un contenido, en cuyo caso puede conservarlo hasta 2 años. Los datos pueden tratarse en Estados Unidos, con las garantías de las cláusulas contractuales tipo aprobadas por la Comisión Europea. La herramienta no hace diagnósticos ni toma decisiones. A partir de las notas propone unos «highlights»: aprendizajes y reflexiones de la sesión que pueden serle útiles. La psicóloga los revisa y, si lo considera oportuno, se los hace llegar en su área privada; los highlights que reciba se habrán elaborado con ayuda de esta herramienta. Para dar continuidad, pueden tenerse en cuenta las notas de algunas sesiones anteriores. Puede oponerse a este uso en cualquier momento, sin que afecte a la atención que recibe, escribiendo a {{email_contacto}}.

**Derechos.** Podrá ejercer en cualquier momento sus derechos de acceso, rectificación, supresión, limitación del tratamiento, portabilidad y oposición mediante correo electrónico dirigido a la responsable del tratamiento a {{email_contacto}}, adjuntando documento que acredite su identidad. Igualmente, podrá presentar una reclamación ante la Agencia Española de Protección de Datos (AEPD). Para garantizar la seguridad de los datos personales, en determinados supuestos podrá solicitarse acreditación de identidad.

El paciente declara haber sido informado de forma clara y comprensible sobre el tratamiento de sus datos personales y presta su consentimiento para ello.$txt$
where not exists (select 1 from public.document_versions where doc_type = 'privacy' and version = '2.2');

-- Estado y firmas de un paciente (+ info_update: firmó un texto de protección
-- de datos anterior al vigente sin obligación de refirmar → se le avisa).
create or replace function public.consent_overview(p_patient uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_status text;
  v_last public.consents;
begin
  if auth.uid() is null or (auth.uid() <> p_patient and not public.is_admin()) then
    raise exception 'NOT_ALLOWED';
  end if;
  v_status := public.consent_status_for(p_patient);
  select * into v_last from public.consents where patient_id = p_patient order by signed_at desc limit 1;
  return jsonb_build_object(
    'status', v_status,
    'block_booking', coalesce((select block_booking_until_consent from public.consent_settings where id = 1), false),
    'info_update', v_status = 'firmado' and v_last.id is not null and v_last.privacy_version_id is distinct from
                   (select id from public.current_document_versions() where doc_type = 'privacy'),
    'ai_opt_out', coalesce((select ai_opt_out from public.profiles where id = p_patient), false),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'signed_at', c.signed_at,
               'versions', jsonb_build_object('privacy', pv.version, 'rules', rv.version, 'withdrawal', wv.version)
             ) order by c.signed_at desc)
        from public.consents c
        join public.document_versions pv on pv.id = c.privacy_version_id
        join public.document_versions rv on rv.id = c.rules_version_id
        join public.document_versions wv on wv.id = c.withdrawal_version_id
       where c.patient_id = p_patient), '[]'::jsonb)
  );
end;
$fn$;
revoke all on function public.consent_overview(uuid) from public, anon;
grant execute on function public.consent_overview(uuid) to authenticated;

-- Highlights publicados del paciente que llama (solo el texto publicado).
create or replace function public.my_session_highlights()
returns table (appointment_id uuid, starts_at timestamptz, content text, published_at timestamptz)
language sql stable security definer set search_path = public as $fn$
  select h.appointment_id, a.starts_at, h.published_content, h.published_at
    from public.session_highlights h
    join public.appointments a on a.id = h.appointment_id
   where a.patient_id = auth.uid() and h.published_at is not null and h.published_content is not null
   order by a.starts_at desc;
$fn$;
revoke all on function public.my_session_highlights() from public, anon;
grant execute on function public.my_session_highlights() to authenticated;
