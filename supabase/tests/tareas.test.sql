-- Tareas de la sesión: quién puede subir, ver y borrar archivos, la respuesta
-- del paciente y lo que ve en su área. Se ejecuta con supabase/tests/run.sh
-- (después de calendario.test.sql, sobre la misma base de datos).
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

\set adm '00000000-0000-0000-0000-0000000007a0'
\set p1  '00000000-0000-0000-0000-0000000007a1'
\set p2  '00000000-0000-0000-0000-0000000007a2'
\set a1  '00000000-0000-0000-0000-0000000007b1'
\set a2  '00000000-0000-0000-0000-0000000007b2'
\set t1  '00000000-0000-0000-0000-0000000007c1'
\set t2  '00000000-0000-0000-0000-0000000007c2'
\set fdoc  '00000000-0000-0000-0000-0000000007d1'
\set fdoc2 '00000000-0000-0000-0000-0000000007d2'
\set fimg  '00000000-0000-0000-0000-0000000007d3'
\set fans  '00000000-0000-0000-0000-0000000007d4'
\set fimg2 '00000000-0000-0000-0000-0000000007d5'

insert into public.profiles (id, role, full_name, email, active) values
  (:'adm', 'admin', 'Psico Tareas', 'psico-tareas@example.com', true);
insert into public.profiles (id, role, full_name, email, active, psychologist_id) values
  (:'p1', 'patient', 'Tarea Uno', 't1@example.com', true, :'adm'),
  (:'p2', 'patient', 'Tarea Dos', 't2@example.com', true, :'adm');
insert into public.appointments (id, patient_id, starts_at) values
  (:'a1', :'p1', '2026-11-02 10:00+00'),
  (:'a2', :'p2', '2026-11-03 10:00+00');

-- ── La psicóloga gestiona las tareas por RLS; el paciente no toca las tablas.
set role authenticated;
select set_config('request.jwt.claim.sub', :'adm', false);
insert into public.session_tasks (id, appointment_id, position, body) values
  (:'t1', :'a1', 1, 'Escribe tres cosas que hayan ido bien'),
  (:'t2', :'a1', 2, '');
select pg_temp.expect_error($$update public.session_tasks set published_at = now() where body = ''$$, 'session_tasks_published_not_empty');
select pg_temp.expect_error($$delete from public.session_tasks$$, 'permission denied');
select pg_temp.expect_error(
  format($$insert into public.session_task_files (appointment_id, kind, path, file_name, mime_type, size_bytes) values (%L, 'documento', 'x', 'x.pdf', 'application/pdf', 1)$$, :'a1'),
  'permission denied');

select set_config('request.jwt.claim.sub', :'p1', false);
select pg_temp.ok((select count(*) from public.session_tasks) = 0, 'el paciente no lee session_tasks');
select pg_temp.ok((select count(*) from public.session_task_files) = 0, 'el paciente no lee session_task_files');
select pg_temp.expect_error(
  format($$insert into public.session_tasks (appointment_id, body) values (%L, 'x')$$, :'a1'), 'row-level security');
select pg_temp.ok(public.my_session_tasks() = '[]'::jsonb, 'sin nada publicado, el paciente no ve nada');
select pg_temp.expect_error(format($$select public.answer_session_task(%L, %L, 'hola')$$, :'p1', :'t1'), 'permission denied');
select pg_temp.expect_error(format($$select public.session_task_file_for(%L, %L)$$, :'adm', :'fdoc'), 'permission denied');
reset role;

-- ── Subidas (lo que pregunta el servidor).
select pg_temp.ok(public.session_task_upload_check(:'adm', 'documento', :'a1', null) = :'a1', 'la psicóloga sube documentos');
select pg_temp.ok(public.session_task_upload_check(:'adm', 'imagen_tarea', null, :'t1') = :'a1', 'la psicóloga sube la imagen de una tarea');
select pg_temp.expect_error(format($$select public.session_task_upload_check(%L, 'documento', %L, null)$$, :'p1', :'a1'), 'NOT_ALLOWED');
select pg_temp.expect_error(format($$select public.session_task_upload_check(%L, 'imagen_tarea', null, %L)$$, :'p1', :'t1'), 'NOT_ALLOWED');
select pg_temp.expect_error(format($$select public.session_task_upload_check(%L, 'respuesta', null, %L)$$, :'p1', :'t1'), 'NOT_ALLOWED');
select pg_temp.expect_error(format($$select public.session_task_upload_check(%L, 'otro', %L, %L)$$, :'adm', :'a1', :'t1'), 'NOT_ALLOWED');

insert into public.session_task_files (id, appointment_id, task_id, kind, path, file_name, mime_type, size_bytes, uploaded_by, uploaded_at) values
  (:'fdoc',  :'a1', null,  'documento',    'a1/doc1.pdf', 'Registro.pdf', 'application/pdf', 1000, :'adm', now()),
  (:'fdoc2', :'a1', null,  'documento',    'a1/doc2.pdf', 'Interno.pdf',  'application/pdf', 1000, :'adm', now()),
  (:'fimg',  :'a1', :'t1', 'imagen_tarea', 'a1/img1.png', 'Esquema.png',  'image/png',       1000, :'adm', now()),
  (:'fimg2', :'a1', :'t2', 'imagen_tarea', 'a1/img2.png', 'Borrador.png', 'image/png',       1000, :'adm', now());
select pg_temp.expect_error(
  format($$insert into public.session_task_files (appointment_id, task_id, kind, path, file_name, mime_type, size_bytes) values (%L, null, 'respuesta', 'y', 'y.pdf', 'application/pdf', 1)$$, :'a1'),
  'session_task_files_task');

-- ── Borrador y documento sin marcar: el paciente no ve nada.
select pg_temp.ok((select count(*) from public.session_task_file_for(:'p1', :'fdoc')) = 0, 'documento no visible: el paciente no lo abre');
select pg_temp.ok((select count(*) from public.session_task_file_for(:'p1', :'fimg')) = 0, 'imagen de un borrador: el paciente no la abre');
select pg_temp.ok((select count(*) from public.session_task_file_for(:'adm', :'fdoc')) = 1, 'la psicóloga abre todo');

-- ── La psicóloga marca un documento como visible y publica la tarea 1.
set role authenticated;
select set_config('request.jwt.claim.sub', :'adm', false);
update public.session_task_files set visible_to_patient = true where id = :'fdoc';
select pg_temp.expect_error($$update public.session_task_files set path = 'otro'$$, 'permission denied');
update public.session_tasks set published_at = now() where id = :'t1';
select set_config('request.jwt.claim.sub', :'p1', false);
select public.my_session_tasks() as mine \gset
select pg_temp.ok(jsonb_array_length(:'mine'::jsonb) = 1, 'una sesión con cosas que enseñar');
select pg_temp.ok(jsonb_array_length(:'mine'::jsonb -> 0 -> 'documents') = 1
  and :'mine'::jsonb -> 0 -> 'documents' -> 0 ->> 'file_name' = 'Registro.pdf', 'solo el documento visible');
select pg_temp.ok(jsonb_array_length(:'mine'::jsonb -> 0 -> 'tasks') = 1
  and :'mine'::jsonb -> 0 -> 'tasks' -> 0 ->> 'id' = :'t1', 'solo la tarea publicada');
select pg_temp.ok(:'mine'::jsonb -> 0 -> 'tasks' -> 0 -> 'files' -> 0 ->> 'kind' = 'imagen_tarea', 'con su imagen');
select pg_temp.ok(:'mine'::text not like '%path%', 'nunca sale la ruta del archivo');
select set_config('request.jwt.claim.sub', :'p2', false);
select pg_temp.ok(public.my_session_tasks() = '[]'::jsonb, 'otro paciente no ve nada');
reset role;

select pg_temp.ok((select count(*) from public.session_task_file_for(:'p1', :'fdoc')) = 1, 'documento visible: lo abre');
select pg_temp.ok((select count(*) from public.session_task_file_for(:'p1', :'fdoc2')) = 0, 'el otro documento sigue oculto');
select pg_temp.ok((select count(*) from public.session_task_file_for(:'p1', :'fimg')) = 1, 'imagen de la tarea publicada: la abre');
select pg_temp.ok((select count(*) from public.session_task_file_for(:'p1', :'fimg2')) = 0, 'imagen del borrador: no');
select pg_temp.ok((select count(*) from public.session_task_file_for(:'p2', :'fdoc')) = 0, 'otro paciente no abre nada');
select pg_temp.ok((select count(*) from public.session_task_file_for(:'p1', :'fdoc', true)) = 0, 'el paciente no borra documentos');
select pg_temp.ok((select count(*) from public.session_task_file_for(:'p1', :'fimg', true)) = 0, 'ni la imagen de la tarea');

-- ── Respuesta del paciente.
select pg_temp.ok(public.session_task_upload_check(:'p1', 'respuesta', null, :'t1') = :'a1', 'el paciente adjunta a su tarea publicada');
select pg_temp.expect_error(format($$select public.session_task_upload_check(%L, 'respuesta', null, %L)$$, :'p2', :'t1'), 'NOT_ALLOWED');
select pg_temp.expect_error(format($$select public.answer_session_task(%L, %L, '   ')$$, :'p1', :'t1'), 'ANSWER_EMPTY');
select pg_temp.expect_error(format($$select public.answer_session_task(%L, %L, 'hola')$$, :'p2', :'t1'), 'NOT_ALLOWED');
select pg_temp.expect_error(format($$select public.answer_session_task(%L, %L, 'hola')$$, :'p1', :'t2'), 'NOT_ALLOWED');
select pg_temp.expect_error(format($$select public.answer_session_task(%L, %L, %L)$$, :'p1', :'t1', repeat('x', 5001)), 'ANSWER_TOO_LONG');

select public.answer_session_task(:'p1', :'t1', '  Dormí mejor  ') as r1 \gset
select pg_temp.ok((:'r1'::jsonb ->> 'changed')::boolean, 'primera respuesta: avisa');
select pg_temp.ok(:'r1'::jsonb ->> 'psychologist_email' = 'psico-tareas@example.com'
  and :'r1'::jsonb ->> 'patient_name' = 'Tarea Uno' and :'r1'::jsonb ->> 'appointment_id' = :'a1', 'datos para el email');
select pg_temp.ok((select answer = 'Dormí mejor' and answered_at is not null from public.session_tasks where id = :'t1'), 'respuesta guardada sin espacios');
select public.answer_session_task(:'p1', :'t1', 'Dormí mejor') as r2 \gset
select pg_temp.ok(not (:'r2'::jsonb ->> 'changed')::boolean, 'misma respuesta: no vuelve a avisar');
insert into public.session_task_files (id, appointment_id, task_id, kind, path, file_name, mime_type, size_bytes, uploaded_by, uploaded_at) values
  (:'fans', :'a1', :'t1', 'respuesta', 'a1/ans1.jpg', 'Foto.jpg', 'image/jpeg', 1000, :'p1', now() + interval '1 second');
select public.answer_session_task(:'p1', :'t1', 'Dormí mejor') as r3 \gset
select pg_temp.ok((:'r3'::jsonb ->> 'changed')::boolean, 'adjunto nuevo: avisa');
select pg_temp.ok((select count(*) from public.session_task_file_for(:'p1', :'fans', true)) = 1, 'el paciente quita sus adjuntos');
select pg_temp.ok((select count(*) from public.session_task_file_for(:'p2', :'fans')) = 0, 'otro paciente no ve los adjuntos');

-- Máximo 5 adjuntos por respuesta (los que están a medio subir no cuentan).
insert into public.session_task_files (appointment_id, task_id, kind, path, file_name, mime_type, size_bytes, uploaded_by, uploaded_at)
select :'a1', :'t1', 'respuesta', 'a1/extra' || i, 'x.pdf', 'application/pdf', 1, :'p1', case when i <= 3 then now() end
  from generate_series(1, 4) i;
select pg_temp.ok(public.session_task_upload_check(:'p1', 'respuesta', null, :'t1') = :'a1', 'con 4 confirmados aún cabe uno');
update public.session_task_files set uploaded_at = now() where path = 'a1/extra4';
select pg_temp.expect_error(format($$select public.session_task_upload_check(%L, 'respuesta', null, %L)$$, :'p1', :'t1'), 'TOO_MANY_FILES');

-- ── Retirada: el paciente deja de verla y de poder responder; la respuesta se conserva.
update public.session_tasks set published_at = null where id = :'t1';
select pg_temp.expect_error(format($$select public.answer_session_task(%L, %L, 'otra')$$, :'p1', :'t1'), 'NOT_ALLOWED');
select pg_temp.ok((select count(*) from public.session_task_file_for(:'p1', :'fans')) = 0, 'retirada: ya no abre sus adjuntos');
select pg_temp.ok((select answer = 'Dormí mejor' from public.session_tasks where id = :'t1'), 'la respuesta se conserva');

-- ── Paciente desactivado: nada.
update public.session_tasks set published_at = now() where id = :'t1';
update public.profiles set active = false where id = :'p1';
select pg_temp.expect_error(format($$select public.answer_session_task(%L, %L, 'otra')$$, :'p1', :'t1'), 'NOT_ALLOWED');
select pg_temp.ok((select count(*) from public.session_task_file_for(:'p1', :'fdoc')) = 0, 'desactivado: no abre archivos');
set role authenticated;
select set_config('request.jwt.claim.sub', :'p1', false);
select pg_temp.ok(public.my_session_tasks() = '[]'::jsonb, 'desactivado: no ve tareas');
reset role;

-- ── Al borrar la tarea o la cita, se van sus filas.
delete from public.session_tasks where id = :'t1';
select pg_temp.ok((select count(*) from public.session_task_files where task_id = :'t1') = 0, 'borrar la tarea borra sus archivos');
delete from public.appointments where id = :'a1';
select pg_temp.ok((select count(*) from public.session_task_files where appointment_id = :'a1') = 0
  and (select count(*) from public.session_tasks where appointment_id = :'a1') = 0, 'borrar la cita borra todo lo suyo');

\echo 'tareas.test.sql: OK'
