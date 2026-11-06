-- Pruebas de la reserva de citas por el paciente (reglas de negocio y
-- autorización). Se ejecutan con supabase/tests/run.sh sobre un Postgres local
-- con bootstrap.sql + schema.sql aplicados. Cada fallo aborta con un mensaje.
\set ON_ERROR_STOP 1
\set QUIET 1

-- ── Utilidades ──────────────────────────────────────────────────────────────
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALLO: %', msg; end if;
end $$;

create or replace function pg_temp.expect_error(stmt text, pattern text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm not ilike '%' || pattern || '%' then
      raise exception 'FALLO: se esperaba «%» y llegó «%» (%)', pattern, sqlerrm, stmt;
    end if;
    return;
  end;
  raise exception 'FALLO: se esperaba el error «%» y no hubo error (%)', pattern, stmt;
end $$;

-- ── Datos ───────────────────────────────────────────────────────────────────
\set silvia   '00000000-0000-0000-0000-00000000000a'
\set otra     '00000000-0000-0000-0000-00000000000b'
\set p1       '00000000-0000-0000-0000-000000000001'
\set p2       '00000000-0000-0000-0000-000000000002'
\set p3       '00000000-0000-0000-0000-000000000003'
\set p4       '00000000-0000-0000-0000-000000000004'
\set p5       '00000000-0000-0000-0000-000000000005'

insert into public.profiles (id, role, full_name, email, created_at) values
  (:'silvia', 'admin', 'Silvia', 'silvia@example.com', now() - interval '1 year'),
  (:'otra',   'admin', 'Otra Psicóloga', 'otra@example.com', now());
insert into public.profiles (id, role, full_name, email, psychologist_id, active) values
  (:'p1', 'patient', 'Paciente Uno',    'p1@example.com', :'silvia', true),
  (:'p2', 'patient', 'Paciente Dos',    'p2@example.com', :'silvia', true),
  (:'p3', 'patient', 'Paciente Tres',   'p3@example.com', :'otra',   true),
  (:'p4', 'patient', 'Paciente Cuatro', '',               :'silvia', true),
  (:'p5', 'patient', 'Paciente Inactivo', 'p5@example.com', :'silvia', false);

-- Un paciente nuevo sin psicóloga indicada queda asignado a la primera admin.
insert into public.profiles (role, full_name, email) values ('patient', 'Sin asignar', 'x@example.com');
select pg_temp.ok((select psychologist_id from public.profiles where email = 'x@example.com') = :'silvia',
  'paciente nuevo recibe psicóloga por defecto');

-- Lunes (Madrid) dentro de dos semanas y el de la semana siguiente.
select public.madrid_week_start(now()) + 14 as wk, public.madrid_week_start(now()) + 21 as wk2 \gset

-- Martes de la semana wk: cita MANUAL de P4 (16:00) → bloquea esa semana para P4.
insert into public.appointments (patient_id, starts_at, duration_minutes, session_type, price_cents)
values (:'p4', ((:'wk'::date + 1)::timestamp + time '16:00') at time zone 'Europe/Madrid', 50, 'individual', 5500);
-- Martes de la semana wk2: cita manual de P2 a las 11:00 y un evento a las 13:00.
insert into public.appointments (patient_id, starts_at, duration_minutes, session_type, price_cents)
values (:'p2', ((:'wk2'::date + 1)::timestamp + time '11:00') at time zone 'Europe/Madrid', 50, 'primera', 2500);
insert into public.agenda_events (title, starts_at, duration_minutes)
values ('Reunión', ((:'wk2'::date + 1)::timestamp + time '13:00') at time zone 'Europe/Madrid', 60);

-- ── 1. Psicóloga abre agenda ────────────────────────────────────────────────
set role authenticated;
select set_config('request.jwt.claim.sub', :'silvia', false);

-- «Lunes 10:00–14:00, 60 min, repetir 2 semanas» → 8 huecos.
select public.open_agenda_slots(:'wk'::date, '10:00', '14:00', 60, 2) as r \gset
select pg_temp.ok(:'r'::jsonb = '{"created": 8, "skipped_busy": 0, "skipped_past": 0}', 'abrir 8 huecos: ' || :'r');
select pg_temp.ok((select count(*) from public.agenda_slots where status = 'abierto') = 8, 'hay 8 huecos abiertos');
select pg_temp.ok(
  (select array_agg(distinct to_char(starts_at at time zone 'Europe/Madrid', 'HH24:MI') order by to_char(starts_at at time zone 'Europe/Madrid', 'HH24:MI')) from public.agenda_slots)
  = array['10:00','11:00','12:00','13:00'], 'los huecos están a las 10, 11, 12 y 13 h de Madrid');

-- Volver a abrir lo mismo: todo se omite por solaparse con huecos abiertos.
select public.open_agenda_slots(:'wk'::date, '10:00', '14:00', 60, 1) as r \gset
select pg_temp.ok(:'r'::jsonb = '{"created": 0, "skipped_busy": 4, "skipped_past": 0}', 'no duplica huecos: ' || :'r');

-- Martes wk2 10–14: la cita de las 11 y el evento de las 13 hacen omitir 2.
select public.open_agenda_slots(:'wk2'::date + 1, '10:00', '14:00', 60, 1) as r \gset
select pg_temp.ok(:'r'::jsonb = '{"created": 2, "skipped_busy": 2, "skipped_past": 0}', 'omite solapes con citas y eventos: ' || :'r');

-- En el pasado no se crea nada.
select public.open_agenda_slots(public.madrid_week_start(now()) - 7, '10:00', '12:00', 60, 1) as r \gset
select pg_temp.ok(:'r'::jsonb = '{"created": 0, "skipped_busy": 0, "skipped_past": 2}', 'no abre huecos pasados: ' || :'r');

-- Validaciones.
select pg_temp.expect_error(format('select public.open_agenda_slots(%L, ''10:00'', ''14:00'', 50, 1)', :'wk'), 'duración');
select pg_temp.expect_error(format('select public.open_agenda_slots(%L, ''10:15'', ''14:00'', 60, 1)', :'wk'), 'en punto');

-- Huecos de la otra psicóloga (lunes wk2 a las 9).
select set_config('request.jwt.claim.sub', :'otra', false);
select public.open_agenda_slots(:'wk2'::date, '09:00', '10:00', 60, 1) as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'created')::int = 1, 'la otra psicóloga abre su hueco (no choca con los de Silvia)');
select pg_temp.ok((select count(*) from public.agenda_slots) = 1, 'cada psicóloga solo ve sus huecos');
select id as slot_otra from public.agenda_slots \gset

reset role;
-- Huecos fuera de la ventana (creados a mano): dentro de 2 h y dentro de 8 semanas.
insert into public.agenda_slots (psychologist_id, starts_at, ends_at) values
  (:'silvia', date_trunc('hour', now()) + interval '2 hours', date_trunc('hour', now()) + interval '3 hours'),
  (:'silvia', date_trunc('hour', now()) + interval '56 days', date_trunc('hour', now()) + interval '56 days 1 hour');

select id as slot_mon10 from public.agenda_slots
 where psychologist_id = :'silvia' and starts_at = (:'wk'::timestamp + time '10:00') at time zone 'Europe/Madrid' \gset
select id as slot_mon11 from public.agenda_slots
 where psychologist_id = :'silvia' and starts_at = (:'wk'::timestamp + time '11:00') at time zone 'Europe/Madrid' \gset
select id as slot_mon12 from public.agenda_slots
 where psychologist_id = :'silvia' and starts_at = (:'wk'::timestamp + time '12:00') at time zone 'Europe/Madrid' \gset
select id as slot_wk2_10 from public.agenda_slots
 where psychologist_id = :'silvia' and starts_at = (:'wk2'::timestamp + time '10:00') at time zone 'Europe/Madrid' \gset
select id as slot_tue2_10 from public.agenda_slots
 where psychologist_id = :'silvia' and starts_at = ((:'wk2'::date + 1)::timestamp + time '10:00') at time zone 'Europe/Madrid' \gset
select id as slot_tue2_12 from public.agenda_slots
 where psychologist_id = :'silvia' and starts_at = ((:'wk2'::date + 1)::timestamp + time '12:00') at time zone 'Europe/Madrid' \gset

-- ── 2. Lo que ve cada paciente ──────────────────────────────────────────────
set role authenticated;
select set_config('request.jwt.claim.sub', :'p1', false);
select pg_temp.ok((select count(*) from public.agenda_slots) = 10,
  'P1 ve solo los 10 huecos abiertos de Silvia dentro de la ventana (ni el de 2 h, ni el de 8 semanas, ni los de la otra)');
select pg_temp.ok(not exists (select 1 from public.agenda_slots where psychologist_id = :'otra'), 'P1 no ve huecos de otra psicóloga');
select pg_temp.ok((select full_name from public.my_psychologist()) = 'Silvia', 'P1 ve el nombre de su psicóloga');
select pg_temp.ok((select count(*) from public.profiles) = 1, 'P1 solo lee su propio perfil');
select pg_temp.ok((select count(*) from public.appointments) = 0, 'P1 no ve citas de otros pacientes');

select set_config('request.jwt.claim.sub', :'p3', false);
select pg_temp.ok((select count(*) from public.agenda_slots) = 1, 'P3 solo ve el hueco de su psicóloga');

select set_config('request.jwt.claim.sub', :'p5', false);
select pg_temp.ok((select count(*) from public.agenda_slots) = 0, 'un paciente desactivado no ve huecos');

-- Escrituras directas y funciones de servidor: prohibidas al paciente.
select set_config('request.jwt.claim.sub', :'p1', false);
select pg_temp.expect_error(format(
  'insert into public.agenda_slots (psychologist_id, starts_at, ends_at) values (%L, now() + interval ''3 days'', now() + interval ''3 days 1 hour'')', :'silvia'),
  'row-level security');
update public.agenda_slots set status = 'cerrado' where id = :'slot_mon10';  -- RLS: 0 filas
select pg_temp.ok((select status from public.agenda_slots where id = :'slot_mon10') = 'abierto', 'un update del paciente no cambia nada');
select pg_temp.expect_error(format('select public.book_slot(%L, %L)', :'p1', :'slot_mon10'), 'permission denied');
select pg_temp.expect_error(format('select public.cancel_booking(%L, %L)', :'p1', :'slot_mon10'), 'permission denied');
select pg_temp.expect_error(format('select public.open_agenda_slots(%L, ''10:00'', ''14:00'', 60, 1)', :'wk'), 'NOT_ALLOWED');
select pg_temp.expect_error(format('select public.close_agenda_slot(%L)', :'slot_mon10'), 'NOT_ALLOWED');

-- ── 3. Reservar (como el servidor, service_role) ────────────────────────────
reset role;
set role service_role;

-- Una cita por semana: P4 ya tiene cita manual el martes de wk.
select pg_temp.expect_error(format('select public.book_slot(%L, %L)', :'p4', :'slot_mon10'), 'WEEK_LIMIT');
select pg_temp.ok((select status from public.agenda_slots where id = :'slot_mon10') = 'abierto', 'el rechazo por semana no toca el hueco');
-- La semana siguiente sí puede.
select public.book_slot(:'p4', :'slot_wk2_10') as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'session_type') = 'individual', 'P4 (con historial) reserva con tarifa individual');

-- Reserva normal de P1 (primera sesión) con comentario.
select public.book_slot(:'p1', :'slot_mon10', '  Prefiero videollamada  ') as r \gset
select (:'r'::jsonb ->> 'appointment_id') as appt_p1 \gset
select pg_temp.ok((:'r'::jsonb ->> 'psychologist_email') = 'silvia@example.com', 'devuelve el email de la psicóloga');
select pg_temp.ok((:'r'::jsonb ->> 'comment') = 'Prefiero videollamada', 'comentario recortado');
select pg_temp.ok((select origin = 'reserva_paciente' and status = 'programada' and session_type = 'primera'
                     and price_cents = 2500 and duration_minutes = 60 and patient_id = :'p1'
                     from public.appointments where id = :'appt_p1'), 'la cita es normal, con origin reserva_paciente');
select pg_temp.ok((select status = 'reservado' and appointment_id = :'appt_p1' and booked_by_patient_id = :'p1' and booked_at is not null
                     from public.agenda_slots where id = :'slot_mon10'), 'el hueco queda reservado y enlazado');
select pg_temp.ok((select notes from public.appointment_notes where appointment_id = :'appt_p1') like '%Prefiero videollamada',
  'el comentario queda en las notas de la cita');

-- Segunda reserva de P1 en la misma semana → no.
select pg_temp.expect_error(format('select public.book_slot(%L, %L)', :'p1', :'slot_mon11'), 'WEEK_LIMIT');
-- Hueco ya reservado, de otra psicóloga, inexistente, fuera de ventana, paciente inactivo.
select pg_temp.expect_error(format('select public.book_slot(%L, %L)', :'p2', :'slot_mon10'), 'SLOT_UNAVAILABLE');
select pg_temp.expect_error(format('select public.book_slot(%L, %L)', :'p2', :'slot_otra'), 'SLOT_UNAVAILABLE');
select pg_temp.expect_error(format('select public.book_slot(%L, %L)', :'p2', gen_random_uuid()), 'SLOT_UNAVAILABLE');
select pg_temp.expect_error(format('select public.book_slot(%L, id) from public.agenda_slots where starts_at < now() + interval ''1 day'' and status = ''abierto''', :'p2'), 'SLOT_UNAVAILABLE');
select pg_temp.expect_error(format('select public.book_slot(%L, %L)', :'p5', :'slot_mon11'), 'NOT_ALLOWED');
select pg_temp.expect_error(format('select public.book_slot(%L, %L)', :'silvia', :'slot_mon11'), 'NOT_ALLOWED');
select pg_temp.expect_error(format('select public.book_slot(%L, %L, %L)', :'p2', :'slot_mon11', repeat('x', 301)), 'COMMENT_TOO_LONG');

-- P1 ve su cita; P2 no.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'p1', false);
select pg_temp.ok((select count(*) from public.appointments where id = :'appt_p1') = 1, 'P1 ve su cita reservada');
select pg_temp.ok(not exists (select 1 from public.agenda_slots where id = :'slot_mon10'), 'P1 ya no ve el hueco reservado');
select pg_temp.ok((select count(*) from public.appointment_notes) = 0, 'el paciente no lee las notas');
select set_config('request.jwt.claim.sub', :'p2', false);
select pg_temp.ok((select count(*) from public.appointments where id = :'appt_p1') = 0, 'P2 no ve la cita de P1');

-- ── 4. Cancelar ─────────────────────────────────────────────────────────────
reset role;
set role service_role;
-- Otro paciente no puede cancelarla; tampoco una cita manual.
select pg_temp.expect_error(format('select public.cancel_booking(%L, %L)', :'p2', :'appt_p1'), 'NOT_ALLOWED');
select id as appt_p4_manual from public.appointments where patient_id = :'p4' and origin = 'manual' \gset
select pg_temp.expect_error(format('select public.cancel_booking(%L, %L)', :'p4', :'appt_p4_manual'), 'NOT_ALLOWED');

-- Con más de 24 h: se cancela y el hueco vuelve a estar abierto.
select public.cancel_booking(:'p1', :'appt_p1') as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'slot_reopened')::boolean, 'informa de que el hueco se reabre');
select pg_temp.ok((select status from public.appointments where id = :'appt_p1') = 'cancelada', 'cita cancelada');
select pg_temp.ok((select status = 'abierto' and appointment_id is null and booked_by_patient_id is null
                     from public.agenda_slots where id = :'slot_mon10'), 'hueco reabierto');
select pg_temp.expect_error(format('select public.cancel_booking(%L, %L)', :'p1', :'appt_p1'), 'NOT_CANCELLABLE');
-- Tras cancelar, la semana vuelve a estar libre para P1.
select public.book_slot(:'p1', :'slot_mon11') as r \gset
select (:'r'::jsonb ->> 'appointment_id') as appt_p1b \gset
select pg_temp.ok((:'r'::jsonb ->> 'session_type') = 'primera', 'la cita cancelada no cuenta como primera sesión');

-- Con 24 h o menos: rechazado y sin cambios.
reset role;
insert into public.appointments (patient_id, starts_at, duration_minutes, session_type, price_cents, origin)
values (:'p2', date_trunc('hour', now()) + interval '5 hours', 60, 'individual', 5500, 'reserva_paciente')
returning id as appt_soon \gset
set role service_role;
select pg_temp.expect_error(format('select public.cancel_booking(%L, %L)', :'p2', :'appt_soon'), 'CANCEL_TOO_LATE');
select pg_temp.ok((select status from public.appointments where id = :'appt_soon') = 'programada', 'dentro del plazo no se cancela');

-- ── 5. Psicóloga: cerrar, convertir en cita, cancelar ella ──────────────────
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'otra', false);
select pg_temp.expect_error(format('select public.close_agenda_slot(%L)', :'slot_mon12'), 'SLOT_UNAVAILABLE');
select set_config('request.jwt.claim.sub', :'silvia', false);
select public.close_agenda_slot(:'slot_mon12');
select pg_temp.ok((select status from public.agenda_slots where id = :'slot_mon12') = 'cerrado', 'Silvia cierra su hueco');
select pg_temp.expect_error(format('select public.close_agenda_slot(%L)', :'slot_mon12'), 'SLOT_UNAVAILABLE');
select set_config('request.jwt.claim.sub', :'p2', false);
select pg_temp.ok(not exists (select 1 from public.agenda_slots where id = :'slot_mon12'), 'el paciente deja de ver el hueco cerrado');

-- Convertir en cita manual: una cita a la hora de inicio de un hueco lo reserva.
select set_config('request.jwt.claim.sub', :'silvia', false);
insert into public.appointments (patient_id, starts_at, duration_minutes, session_type, price_cents)
select :'p2', starts_at, 50, 'individual', 5500 from public.agenda_slots where id = :'slot_tue2_10'
returning id as appt_conv \gset
select pg_temp.ok((select status = 'reservado' and appointment_id = :'appt_conv'
                     from public.agenda_slots where id = :'slot_tue2_10'), 'convertir en cita manual reserva el hueco');
select pg_temp.ok((select origin from public.appointments where id = :'appt_conv') = 'manual', 'la cita convertida es manual');
-- Un evento encima de un hueco abierto lo cierra.
insert into public.agenda_events (title, starts_at, duration_minutes)
select 'Formación', starts_at + interval '30 minutes', 30 from public.agenda_slots where id = :'slot_tue2_12';
select pg_temp.ok((select status from public.agenda_slots where id = :'slot_tue2_12') = 'cerrado', 'un evento cierra el hueco que pisa');

-- Si Silvia cancela una cita reservada por el paciente, el hueco NO se reabre.
update public.appointments set status = 'cancelada' where id = :'appt_p1b';
select pg_temp.ok((select status from public.agenda_slots where appointment_id = :'appt_p1b') = 'reservado',
  'cancelación por la psicóloga: el hueco no se reabre');

reset role;
\echo 'reserva_citas.test.sql: todas las pruebas OK'
