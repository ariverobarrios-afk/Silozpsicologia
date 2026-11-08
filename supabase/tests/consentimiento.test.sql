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
       (select id from public.document_versions where doc_type = 'privacy'),
       (select id from public.document_versions where doc_type = 'rules'),
       (select id from public.document_versions where doc_type = 'withdrawal'),
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
select pg_temp.ok(public.consent_status_for(:'p1') = 'firmado', 'tras firmar: firmado');
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
values ('rules', '2.1', 'Normas del servicio', 'Texto 2.1', 'Acepto', current_date, false);
select pg_temp.ok(public.consent_status_for(:'p1') = 'firmado', 'versión sin refirma: sigue firmado');
-- Una versión con fecha futura aún no cuenta.
insert into public.document_versions (doc_type, version, title, body_md, checkbox_label, effective_from)
values ('privacy', '3.0', 'Protección de datos', 'Texto 3.0', 'Acepto', current_date + 30);
select pg_temp.ok(public.consent_status_for(:'p1') = 'firmado', 'versión futura: sigue firmado');
-- Versión vigente que pide refirma: pasa a «actualización».
insert into public.document_versions (doc_type, version, title, body_md, checkbox_label, effective_from)
values ('withdrawal', '1.1', 'Desistimiento', 'Texto 1.1', 'Acepto', current_date);
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
