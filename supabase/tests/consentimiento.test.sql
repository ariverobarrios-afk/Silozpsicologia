-- Pruebas de la firma del consentimiento: estado (pendiente / firmado /
-- actualización), quién puede leer qué y que las firmas y los textos no se
-- pueden cambiar. Se ejecutan con supabase/tests/run.sh.
\set ON_ERROR_STOP 1
\set QUIET 1

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

\set silvia '00000000-0000-0000-0000-00000000000a'
\set p1     '00000000-0000-0000-0000-000000000001'
\set p2     '00000000-0000-0000-0000-000000000002'

insert into public.profiles (id, role, full_name, email) values (:'silvia', 'admin', 'Silvia', 'silvia@example.com');
insert into public.profiles (id, role, full_name, email, psychologist_id, active) values
  (:'p1', 'patient', 'Ana Pérez', 'p1@example.com', :'silvia', true),
  (:'p2', 'patient', 'Luis Gómez', 'p2@example.com', :'silvia', true);

-- Los textos y ajustes iniciales están cargados.
select pg_temp.ok((select count(*) from public.current_document_versions()) = 3, 'tres documentos vigentes');
select pg_temp.ok((select iban from public.consent_settings) like 'ES34%', 'ajustes del centro cargados');
-- Sin domicilio: ni en los ajustes ni en los textos vigentes.
select pg_temp.ok((select coalesce(responsable_direccion, '') from public.consent_settings) = '', 'ajustes sin domicilio');
select pg_temp.ok(not exists (select 1 from public.current_document_versions()
                               where body_md like '%responsable_direccion%' or body_md ilike '%domicilio%'),
  'textos vigentes sin domicilio');
select pg_temp.ok((select string_agg(version, ',' order by doc_type) from public.current_document_versions()) = '2.2,2.1,1.1',
  'vigentes: A 2.2 (con IA), B 2.1, C 1.1');
select pg_temp.ok((select body_md from public.current_document_versions() where doc_type = 'privacy') like '%Uso de inteligencia artificial%',
  'A 2.2 incluye el párrafo de IA');

-- Sin psicóloga en therapists, la página avisa de que no está lista.
set role authenticated;
select set_config('request.jwt.claim.sub', :'p1', false);
select pg_temp.ok((public.consent_context()->>'ready')::boolean = false, 'sin profesional: no está lista');
reset role;

insert into public.therapists (profile_id, slug, full_name, dni, collegiate_number, email)
values (:'silvia', 'silvia', 'Silvia López Fernández', '03933796Z', 'M-40562', 'silvia@example.com');

-- ── El paciente ve su contexto y su estado ──────────────────────────────────
set role authenticated;
select set_config('request.jwt.claim.sub', :'p1', false);
select pg_temp.ok((public.consent_context()->>'ready')::boolean, 'con profesional: lista');
select pg_temp.ok(public.consent_context()->>'status' = 'pendiente', 'paciente nuevo: pendiente');
select pg_temp.ok(jsonb_array_length(public.consent_context()->'documents') = 3, 'recibe los tres textos');
select pg_temp.ok(public.consent_context()#>>'{documents,0,doc_type}' = 'privacy', 'orden: protección de datos primero');
select pg_temp.ok(public.consent_context()#>>'{therapist,collegiate_number}' = 'M-40562', 'datos de la profesional');
select pg_temp.ok(public.consent_overview(:'p1')->>'status' = 'pendiente', 'overview propio');
select pg_temp.expect_error(format('select public.consent_overview(%L)', :'p2'), 'NOT_ALLOWED');
-- Nada de lectura directa de las tablas (RLS sin políticas).
select pg_temp.ok((select count(*) from public.document_versions) = 0, 'paciente no lee document_versions directamente');
select pg_temp.ok((select count(*) from public.therapists) = 0, 'paciente no lee therapists directamente');
select pg_temp.expect_error('select public.consent_status_for(gen_random_uuid())', 'permission denied');
select pg_temp.expect_error($$insert into public.consents (therapist_id, patient_name, patient_surname,
  patient_id_number, patient_email, patient_birthdate, privacy_version_id, rules_version_id,
  withdrawal_version_id, accepted_privacy, accepted_rules, accepted_withdrawal_start,
  signature_png_path, pdf_path, pdf_sha256, rendered_text_sha256)
  values (gen_random_uuid(), 'a', 'b', 'c', 'd', '2000-01-01', gen_random_uuid(), gen_random_uuid(),
          gen_random_uuid(), true, true, true, 'x', 'y', repeat('a', 64), repeat('b', 64))$$,
  'row-level security');
reset role;

-- Un admin sí ve el estado de cualquier paciente; nadie sin sesión.
set role authenticated;
select set_config('request.jwt.claim.sub', :'silvia', false);
select pg_temp.ok(public.consent_overview(:'p1')->>'status' = 'pendiente', 'admin ve el estado');
select pg_temp.expect_error('select public.consent_context()', 'NOT_ALLOWED');
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect_error(format('select public.consent_overview(%L)', :'p1'), 'NOT_ALLOWED');
reset role;

-- ── Firma (la inserta el servidor con service_role) ─────────────────────────
set role service_role;
insert into public.consents (id, patient_id, therapist_id, patient_name, patient_surname,
  patient_id_number, patient_email, patient_birthdate, privacy_version_id, rules_version_id,
  withdrawal_version_id, accepted_privacy, accepted_rules, accepted_withdrawal_start,
  signature_png_path, pdf_path, pdf_sha256, rendered_text_sha256, ip, user_agent)
select '00000000-0000-0000-0000-0000000000c1', :'p1', t.id, 'Ana', 'Pérez', '12345678Z', 'p1@example.com',
       '1990-01-01',
       (select id from public.document_versions where doc_type = 'privacy' and version = '2.0'),
       (select id from public.document_versions where doc_type = 'rules' and version = '2.0'),
       (select id from public.document_versions where doc_type = 'withdrawal' and version = '1.0'),
       true, true, true, 'silvia/2026/x.png', 'silvia/2026/x.pdf', repeat('a', 64), repeat('b', 64),
       '203.0.113.7', 'Prueba'
  from public.therapists t;
-- Las casillas son obligatorias también en la base de datos.
select pg_temp.expect_error($$insert into public.consents (patient_id, therapist_id, patient_name, patient_surname,
  patient_id_number, patient_email, patient_birthdate, privacy_version_id, rules_version_id,
  withdrawal_version_id, accepted_privacy, accepted_rules, accepted_withdrawal_start,
  signature_png_path, pdf_path, pdf_sha256, rendered_text_sha256)
  select null, t.id, 'a', 'b', 'c', 'd', '2000-01-01', v.id, v.id, v.id, true, false, true, 'x', 'y',
         repeat('a', 64), repeat('b', 64) from public.therapists t, public.document_versions v limit 1$$,
  'accepted_rules');
select pg_temp.ok(public.consent_status_for(:'p1') = 'firmado', 'tras firmar (versiones 2.0): firmado, las 2.1 sin domicilio no piden refirmar');
-- Copia reemitida: de la versión firmada a sus sucesoras sin refirma (sin domicilio).
select pg_temp.ok((select string_agg(doc_type || ' ' || version, ', ' order by doc_type)
                     from public.consent_reissue_versions('00000000-0000-0000-0000-0000000000c1'))
                  = 'privacy 2.1, rules 2.1, withdrawal 1.1', 'reemisión con las versiones sin domicilio (no con la 2.2 de IA, que no firmó)');
select pg_temp.ok((select pdf_template from public.consents where id = '00000000-0000-0000-0000-0000000000c1') = 1,
  'firma anterior: PDF con la plantilla 1');
select pg_temp.ok(public.consent_status_for(:'p2') = 'pendiente', 'otro paciente sigue pendiente');

-- Las firmas no se modifican ni se borran.
select pg_temp.expect_error($$update public.consents set patient_name = 'X'$$, 'no se modifican');
select pg_temp.expect_error($$delete from public.consents$$, 'no se modifican');
-- Los textos tampoco: se inserta una versión nueva.
select pg_temp.expect_error($$update public.document_versions set body_md = 'x'$$, 'versión nueva');
select pg_temp.expect_error($$delete from public.document_versions$$, 'versión nueva');

-- ── Versión nueva de un texto ───────────────────────────────────────────────
-- Cambio menor (no pide volver a firmar): sigue firmado.
insert into public.document_versions (doc_type, version, title, body_md, checkbox_label, effective_from, requires_resign)
values ('rules', '2.2', 'Normas del servicio', 'Texto 2.2', 'Acepto', (now() at time zone 'Europe/Madrid')::date, false);
select pg_temp.ok(public.consent_status_for(:'p1') = 'firmado', 'versión sin refirma: sigue firmado');
-- Una versión con fecha futura aún no cuenta.
insert into public.document_versions (doc_type, version, title, body_md, checkbox_label, effective_from)
values ('privacy', '3.0', 'Protección de datos', 'Texto 3.0', 'Acepto', (now() at time zone 'Europe/Madrid')::date + 30);
select pg_temp.ok(public.consent_status_for(:'p1') = 'firmado', 'versión futura: sigue firmado');
-- Versión vigente que pide refirma: pasa a «actualización».
insert into public.document_versions (doc_type, version, title, body_md, checkbox_label, effective_from)
values ('withdrawal', '1.2', 'Desistimiento', 'Texto 1.2', 'Acepto', (now() at time zone 'Europe/Madrid')::date);
select pg_temp.ok(public.consent_status_for(:'p1') = 'actualizacion', 'versión con refirma: actualización');
reset role;

-- La firma anterior se conserva y sigue listada (con sus versiones).
set role authenticated;
select set_config('request.jwt.claim.sub', :'p1', false);
select pg_temp.ok(jsonb_array_length(public.consent_overview(:'p1')->'consents') = 1, 'la firma antigua sigue listada');
select pg_temp.ok(public.consent_overview(:'p1')#>>'{consents,0,versions,withdrawal}' = '1.0', 'con la versión que firmó');
reset role;

-- Al borrar al paciente, la firma se conserva (sin el enlace).
delete from public.profiles where id = :'p1';
select pg_temp.ok((select count(*) from public.consents where patient_id is null) = 1, 'firma conservada al borrar paciente');

\echo 'consentimiento.test.sql: OK'

-- ── IA: aviso de texto actualizado, oposición y highlights ──────────────────
\set p6 '00000000-0000-0000-0000-000000000006'
insert into public.profiles (id, role, full_name, email, psychologist_id, active)
values (:'p6', 'patient', 'Paciente Seis', 'p6@example.com', :'silvia', true);
set role service_role;
insert into public.consents (id, patient_id, therapist_id, patient_name, patient_surname,
  patient_id_number, patient_email, patient_birthdate, privacy_version_id, rules_version_id,
  withdrawal_version_id, accepted_privacy, accepted_rules, accepted_withdrawal_start,
  signature_png_path, pdf_path, pdf_sha256, rendered_text_sha256)
select '00000000-0000-0000-0000-0000000000c6', :'p6', t.id, 'P', 'Seis', '12345678Z', 'p6@example.com', '1990-01-01',
       (select id from public.document_versions where doc_type = 'privacy' and version = '2.1'),
       (select id from public.current_document_versions() where doc_type = 'rules'),
       (select id from public.current_document_versions() where doc_type = 'withdrawal'),
       true, true, true, 'x.png', 'x.pdf', repeat('a', 64), repeat('b', 64)
  from public.therapists t;
reset role;
-- (Las versiones de prueba de arriba, rules 2.2 y withdrawal 1.2, ya son las vigentes.)
set role authenticated;
select set_config('request.jwt.claim.sub', :'p6', false);
select pg_temp.ok((public.consent_overview(:'p6')->>'info_update')::boolean, 'firmó A 2.1: se le avisa del texto 2.2');
select pg_temp.ok((public.consent_overview(:'p6')->>'ai_opt_out')::boolean = false, 'sin oposición por defecto');
-- El paciente no puede cambiar su oposición (solo la administración actualiza perfiles).
update public.profiles set ai_opt_out = true where id = :'p6';
select pg_temp.ok((select ai_opt_out from public.profiles where id = :'p6') = false, 'el paciente no cambia ai_opt_out');
-- Ni ve highlights.
select pg_temp.ok((select count(*) from public.session_highlights) = 0, 'paciente no lee highlights');
reset role;
insert into public.appointments (id, patient_id, starts_at, duration_minutes, session_type, price_cents)
values ('00000000-0000-0000-0000-0000000000a6', :'p6', date_trunc('hour', now()) - interval '2 days', 50, 'individual', 5500);
insert into public.session_highlights (appointment_id, content, model, notes_sha256)
values ('00000000-0000-0000-0000-0000000000a6', '- Tema', 'claude-opus-5-5', repeat('c', 64));
set role authenticated;
select set_config('request.jwt.claim.sub', :'p6', false);
select pg_temp.ok((select count(*) from public.session_highlights) = 0, 'paciente no lee highlights (con datos)');
select set_config('request.jwt.claim.sub', :'silvia', false);
select pg_temp.ok((select count(*) from public.session_highlights) = 1, 'admin lee highlights');
update public.profiles set ai_opt_out = true where id = :'p6';
select pg_temp.ok((public.consent_overview(:'p6')->>'ai_opt_out')::boolean, 'admin marca la oposición');
reset role;

\echo 'consentimiento.test.sql (IA): OK'
