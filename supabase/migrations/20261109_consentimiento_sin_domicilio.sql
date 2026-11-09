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
