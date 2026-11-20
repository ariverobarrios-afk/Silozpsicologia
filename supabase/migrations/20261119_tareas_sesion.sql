-- ─────────────────────────────────────────────────────────────────────────────
-- TAREAS DE LA SESIÓN (docs/tareas-sesion.md)
--
-- En la página de una sesión (/panel/sesion/<cita>) la psicóloga puede:
-- · subir documentos PDF y decidir, uno a uno, si el paciente los ve;
-- · escribir tareas (con una imagen opcional) y publicarlas. El paciente las ve
--   en su área («Tareas»), responde con texto y puede adjuntar archivos; la
--   psicóloga ve la respuesta en la sesión y recibe un email de aviso.
--
-- · session_tasks: una fila por tarea. published_at null = borrador (el
--   paciente no la ve). answer / answered_at: la respuesta del paciente.
-- · session_task_files: los archivos, que viven en el bucket privado
--   «session-tasks». kind = 'documento' (PDF de la sesión), 'imagen_tarea'
--   (imagen de una tarea) o 'respuesta' (adjunto del paciente). uploaded_at
--   null = subida sin confirmar (no cuenta ni se enseña).
--
-- Permisos: la administración lee todo y gestiona las tareas por RLS. El
-- paciente no toca las tablas: lee con my_session_tasks() y escribe a través
-- del servidor (api/session-tasks.ts, con service_role), que pregunta a las
-- funciones de aquí qué puede hacer cada usuario. El bucket no tiene
-- políticas: los archivos solo se suben y descargan con enlaces firmados que
-- da el servidor.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.session_tasks (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  position       integer not null default 0,
  body           text not null default '' check (length(body) <= 5000),
  published_at   timestamptz,             -- null = borrador
  answer         text check (length(answer) <= 5000),
  answered_at    timestamptz,             -- última vez que el paciente guardó su respuesta
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint session_tasks_published_not_empty check (published_at is null or length(trim(body)) > 0)
);
create index if not exists session_tasks_appointment_idx on public.session_tasks (appointment_id, position, created_at);
alter table public.session_tasks enable row level security;

drop trigger if exists session_tasks_touch_updated_at on public.session_tasks;
create trigger session_tasks_touch_updated_at
  before update on public.session_tasks
  for each row execute function public.touch_updated_at();

drop policy if exists "session_tasks: admin lee" on public.session_tasks;
create policy "session_tasks: admin lee"
  on public.session_tasks for select to authenticated using (public.is_admin());
drop policy if exists "session_tasks: admin crea" on public.session_tasks;
create policy "session_tasks: admin crea"
  on public.session_tasks for insert to authenticated with check (public.is_admin());
drop policy if exists "session_tasks: admin modifica" on public.session_tasks;
create policy "session_tasks: admin modifica"
  on public.session_tasks for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- (Se borran desde el servidor, que borra también sus archivos.)

create table if not exists public.session_task_files (
  id                 uuid primary key default gen_random_uuid(),
  appointment_id     uuid not null references public.appointments (id) on delete cascade,
  task_id            uuid references public.session_tasks (id) on delete cascade,
  kind               text not null check (kind in ('documento', 'imagen_tarea', 'respuesta')),
  path               text not null unique,     -- ruta en el bucket «session-tasks»
  file_name          text not null check (length(file_name) between 1 and 200),
  mime_type          text not null,
  size_bytes         bigint not null check (size_bytes > 0),
  visible_to_patient boolean not null default false,  -- solo cuenta en 'documento'
  uploaded_by        uuid references public.profiles (id) on delete set null,
  uploaded_at        timestamptz,              -- null = subida sin confirmar
  created_at         timestamptz not null default now(),
  constraint session_task_files_task check ((kind = 'documento') = (task_id is null))
);
create index if not exists session_task_files_appointment_idx on public.session_task_files (appointment_id);
create index if not exists session_task_files_task_idx on public.session_task_files (task_id);
alter table public.session_task_files enable row level security;

drop policy if exists "session_task_files: admin lee" on public.session_task_files;
create policy "session_task_files: admin lee"
  on public.session_task_files for select to authenticated using (public.is_admin());
-- La psicóloga solo cambia «visible para el paciente» (privilegio de columna);
-- crear y borrar archivos es cosa del servidor.
drop policy if exists "session_task_files: admin modifica" on public.session_task_files;
create policy "session_task_files: admin modifica"
  on public.session_task_files for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke insert, update, delete on public.session_task_files from anon, authenticated;
grant update (visible_to_patient) on public.session_task_files to authenticated;
revoke delete on public.session_tasks from anon, authenticated;

-- Bucket privado (sin políticas: solo service_role y enlaces firmados). 20 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('session-tasks', 'session-tasks', false, 20971520, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text', 'application/rtf', 'text/plain'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ¿Es administración activa?
create or replace function public.session_tasks_is_admin(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $fn$
  select exists (select 1 from public.profiles where id = p_user and role = 'admin' and active);
$fn$;
revoke all on function public.session_tasks_is_admin(uuid) from public, anon, authenticated;
grant execute on function public.session_tasks_is_admin(uuid) to service_role;

-- ¿Puede p_user subir un archivo de este tipo? Devuelve la cita a la que
-- pertenece o lanza NOT_ALLOWED / TOO_MANY_FILES.
--   documento     → administración, sobre una cita.
--   imagen_tarea  → administración, sobre una tarea.
--   respuesta     → el paciente de la cita, sobre una tarea publicada (máx. 5).
create or replace function public.session_task_upload_check(p_user uuid, p_kind text, p_appointment uuid, p_task uuid)
returns uuid
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_appt uuid;
  v_admin boolean := public.session_tasks_is_admin(p_user);
begin
  if p_kind = 'documento' then
    select id into v_appt from public.appointments where id = p_appointment;
    if v_appt is null or not v_admin then raise exception 'NOT_ALLOWED'; end if;
    if (select count(*) from public.session_task_files
         where appointment_id = v_appt and kind = 'documento' and uploaded_at is not null) >= 20 then
      raise exception 'TOO_MANY_FILES';
    end if;
  elsif p_kind = 'imagen_tarea' then
    select appointment_id into v_appt from public.session_tasks where id = p_task;
    if v_appt is null or not v_admin then raise exception 'NOT_ALLOWED'; end if;
  elsif p_kind = 'respuesta' then
    select t.appointment_id into v_appt
      from public.session_tasks t
      join public.appointments a on a.id = t.appointment_id
      join public.profiles p on p.id = a.patient_id
     where t.id = p_task and t.published_at is not null and a.patient_id = p_user and p.active;
    if v_appt is null then raise exception 'NOT_ALLOWED'; end if;
    if (select count(*) from public.session_task_files
         where task_id = p_task and kind = 'respuesta' and uploaded_at is not null) >= 5 then
      raise exception 'TOO_MANY_FILES';
    end if;
  else
    raise exception 'NOT_ALLOWED';
  end if;
  return v_appt;
end;
$fn$;
revoke all on function public.session_task_upload_check(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.session_task_upload_check(uuid, text, uuid, uuid) to service_role;

-- El archivo, si p_user puede verlo (p_write = false) o borrarlo (true).
-- Ver:    administración todo; el paciente, de sus citas, los documentos
--         marcados como visibles y lo que cuelga de una tarea publicada.
-- Borrar: administración todo; el paciente, los adjuntos de su respuesta.
create or replace function public.session_task_file_for(p_user uuid, p_file uuid, p_write boolean default false)
returns setof public.session_task_files
language sql stable security definer set search_path = public as $fn$
  select f.*
    from public.session_task_files f
    join public.appointments a on a.id = f.appointment_id
    left join public.session_tasks t on t.id = f.task_id
   where f.id = p_file
     and (public.session_tasks_is_admin(p_user)
          or (a.patient_id = p_user
              and f.uploaded_at is not null
              and exists (select 1 from public.profiles p where p.id = p_user and p.active)
              and case
                    when p_write then f.kind = 'respuesta' and t.published_at is not null
                    when f.kind = 'documento' then f.visible_to_patient
                    else t.published_at is not null
                  end));
$fn$;
revoke all on function public.session_task_file_for(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.session_task_file_for(uuid, uuid, boolean) to service_role;

-- El paciente guarda su respuesta a una tarea publicada. Hace falta texto o
-- algún adjunto. Devuelve los datos para avisar a la psicóloga; «changed»
-- dice si hay algo nuevo desde el último aviso (texto distinto o adjuntos
-- posteriores), para no enviar emails repetidos.
create or replace function public.answer_session_task(p_patient uuid, p_task uuid, p_answer text)
returns jsonb
language plpgsql security definer set search_path = public as $fn$
declare
  v_task public.session_tasks;
  v_appt public.appointments;
  v_patient public.profiles;
  v_psych public.profiles;
  v_answer text := trim(coalesce(p_answer, ''));
  v_files integer;
  v_changed boolean;
begin
  select * into v_task from public.session_tasks where id = p_task for update;
  if not found or v_task.published_at is null then raise exception 'NOT_ALLOWED'; end if;
  select * into v_appt from public.appointments where id = v_task.appointment_id;
  select * into v_patient from public.profiles where id = v_appt.patient_id;
  if v_appt.patient_id <> p_patient or not v_patient.active then raise exception 'NOT_ALLOWED'; end if;
  if length(v_answer) > 5000 then raise exception 'ANSWER_TOO_LONG'; end if;
  select count(*) into v_files from public.session_task_files
   where task_id = p_task and kind = 'respuesta' and uploaded_at is not null;
  if v_answer = '' and v_files = 0 then raise exception 'ANSWER_EMPTY'; end if;

  v_changed := v_task.answered_at is null
    or coalesce(v_task.answer, '') <> v_answer
    or exists (select 1 from public.session_task_files
                where task_id = p_task and kind = 'respuesta' and uploaded_at > v_task.answered_at);
  update public.session_tasks set answer = v_answer, answered_at = now() where id = p_task
    returning * into v_task;

  select * into v_psych from public.profiles where id = v_patient.psychologist_id;
  return jsonb_build_object(
    'task_id', v_task.id,
    'appointment_id', v_appt.id,
    'starts_at', v_appt.starts_at,
    'answered_at', v_task.answered_at,
    'changed', v_changed,
    'patient_name', v_patient.full_name,
    'patient_email', v_patient.email,
    'psychologist_email', coalesce(v_psych.email, '')
  );
end;
$fn$;
revoke all on function public.answer_session_task(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.answer_session_task(uuid, uuid, text) to service_role;

-- Lo que ve el paciente que llama: por cada sesión suya con algo que enseñar,
-- los documentos visibles y las tareas publicadas (con su respuesta).
create or replace function public.my_session_tasks()
returns jsonb
language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_agg(s.item order by s.starts_at desc), '[]'::jsonb)
    from (
      select a.starts_at, jsonb_build_object(
               'appointment_id', a.id,
               'starts_at', a.starts_at,
               'documents', coalesce((
                 select jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name,
                          'mime_type', f.mime_type, 'size_bytes', f.size_bytes) order by f.created_at)
                   from public.session_task_files f
                  where f.appointment_id = a.id and f.kind = 'documento'
                    and f.visible_to_patient and f.uploaded_at is not null), '[]'::jsonb),
               'tasks', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', t.id, 'body', t.body, 'published_at', t.published_at,
                          'answer', t.answer, 'answered_at', t.answered_at,
                          'files', coalesce((
                            select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'file_name', f.file_name,
                                     'mime_type', f.mime_type, 'size_bytes', f.size_bytes) order by f.created_at)
                              from public.session_task_files f
                             where f.task_id = t.id and f.uploaded_at is not null), '[]'::jsonb)
                        ) order by t.position, t.created_at)
                   from public.session_tasks t
                  where t.appointment_id = a.id and t.published_at is not null), '[]'::jsonb)
             ) as item
        from public.appointments a
        join public.profiles p on p.id = a.patient_id and p.active
       where a.patient_id = auth.uid()
    ) s
   where jsonb_array_length(s.item -> 'documents') > 0 or jsonb_array_length(s.item -> 'tasks') > 0;
$fn$;
revoke all on function public.my_session_tasks() from public, anon;
grant execute on function public.my_session_tasks() to authenticated;
