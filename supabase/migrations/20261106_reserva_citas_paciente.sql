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
