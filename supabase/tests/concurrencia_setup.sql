-- Datos para la prueba de reservas simultáneas (ver run.sh).
\set ON_ERROR_STOP 1
insert into public.profiles (id, role, full_name, email, created_at)
values ('00000000-0000-0000-0000-0000000000aa', 'admin', 'Silvia', 'silvia@example.com', now() - interval '1 year');
insert into public.profiles (id, role, full_name, email, psychologist_id)
select ('00000000-0000-0000-0000-0000000001' || lpad(i::text, 2, '0'))::uuid, 'patient', 'Paciente ' || i,
       'p' || i || '@example.com', '00000000-0000-0000-0000-0000000000aa'
  from generate_series(1, 10) i;
-- Dos huecos la misma semana (dentro de 2 semanas, lunes 10:00 y 11:00).
insert into public.agenda_slots (id, psychologist_id, starts_at, ends_at)
select ('00000000-0000-0000-0000-00000000050' || h)::uuid, '00000000-0000-0000-0000-0000000000aa',
       ((public.madrid_week_start(now()) + 14)::timestamp + make_time(9 + h, 0, 0)) at time zone 'Europe/Madrid',
       ((public.madrid_week_start(now()) + 14)::timestamp + make_time(10 + h, 0, 0)) at time zone 'Europe/Madrid'
  from generate_series(1, 2) h;
