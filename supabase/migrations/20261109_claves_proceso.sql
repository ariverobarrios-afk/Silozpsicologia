-- ─────────────────────────────────────────────────────────────────────────────
-- CONSENTIMIENTO A 2.3: «highlights» pasa a llamarse «claves de mi proceso»
--
-- Mismo contenido que A 2.2 con el nuevo nombre que ve el paciente. Es un
-- cambio sin efecto para el paciente: requires_resign = false y
-- supersedes_id = A 2.2 (sucesora «cosmética»). consent_overview.info_update
-- ya no avisa a quien firmó una versión de la que la vigente es sucesora
-- cosmética (p. ej. quien firmó la 2.2), pero sí a quien firmó antes del
-- párrafo de IA (2.0/2.1).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.document_versions
  (doc_type, version, title, checkbox_label, effective_from, requires_resign, supersedes_id, body_md)
select 'privacy', '2.3', 'Información y consentimiento sobre protección de datos',
 'He leído la información sobre protección de datos y presto mi consentimiento.',
 (now() at time zone 'Europe/Madrid')::date, false,
 (select id from public.document_versions where doc_type = 'privacy' and version = '2.2'),
$txt$**Responsable del tratamiento.** Le informamos que los datos personales que facilite serán tratados por {{responsable_nombre}}, con DNI {{responsable_dni}} y correo electrónico de contacto {{email_contacto}}, con la finalidad de la prevención, diagnóstico y tratamiento psicológico, así como para la gestión administrativa y sanitaria de los servicios que el centro le preste en cada momento. El profesional que prestará la asistencia es {{profesional_nombre}} (DNI {{profesional_dni}}, colegiada n.º {{profesional_colegiada}}), que trata sus datos bajo la responsabilidad y las instrucciones de la responsable del tratamiento y sujeta a secreto profesional.

**Conservación.** Los datos personales se conservarán durante el tiempo necesario para la prestación del servicio asistencial y, posteriormente, durante los plazos legalmente establecidos, en particular conforme a la Ley 41/2002, de 14 de noviembre, básica reguladora de la autonomía del paciente y de derechos y obligaciones en materia de información y documentación clínica. Una vez transcurridos dichos plazos, los datos serán suprimidos, salvo en los supuestos legalmente previstos.

**Base legal.** La base legal para el tratamiento de sus datos es el consentimiento explícito del interesado y la necesidad del tratamiento para la prestación de asistencia sanitaria, todo ello conforme al Reglamento (UE) 2016/679 del Parlamento Europeo y del Consejo, de 27 de abril de 2016 (RGPD), y la Ley Orgánica 3/2018, de Protección de Datos Personales y Garantía de los Derechos Digitales.

**Destinatarios y encargados del tratamiento.** Sus datos no se cederán a terceros, salvo obligación legal. Para la prestación del servicio, la responsable recurre a proveedores que actúan como encargados del tratamiento y acceden a los datos únicamente en la medida necesaria para prestar su servicio y bajo las garantías del RGPD: alojamiento de correo electrónico y archivos, plataforma de videollamada ({{plataforma_videollamada}}), alojamiento de la web y base de datos del sistema de firma, mensajería instantánea y herramienta de inteligencia artificial para resumir notas de sesión (Anthropic; ver «Uso de inteligencia artificial»). Algunos de estos proveedores pueden realizar transferencias internacionales de datos al amparo de las garantías previstas en el RGPD (decisiones de adecuación o cláusulas contractuales tipo). Puede solicitar más información sobre los encargados en {{email_contacto}}.

**Uso de inteligencia artificial.** Como apoyo a la documentación clínica, la psicóloga puede utilizar una herramienta de inteligencia artificial para resumir sus notas de sesión. A la herramienta se envía solo el texto de las notas, sin su nombre, DNI ni datos de contacto. El proveedor, Anthropic Ireland, Limited (cuya matriz, Anthropic, PBC, está en Estados Unidos), actúa como encargado del tratamiento: no utiliza los datos para entrenar sus modelos y los borra en un plazo máximo de 30 días, salvo que sus sistemas de seguridad marquen un contenido, en cuyo caso puede conservarlo hasta 2 años. Los datos pueden tratarse en Estados Unidos, con las garantías de las cláusulas contractuales tipo aprobadas por la Comisión Europea. La herramienta no hace diagnósticos ni toma decisiones. A partir de las notas propone unas «claves de mi proceso»: aprendizajes y reflexiones de la sesión que pueden serle útiles. La psicóloga las revisa y, si lo considera oportuno, se las hace llegar en su área privada; las claves que reciba se habrán elaborado con ayuda de esta herramienta. Para dar continuidad, pueden tenerse en cuenta las notas de algunas sesiones anteriores. Puede oponerse a este uso en cualquier momento, sin que afecte a la atención que recibe, escribiendo a {{email_contacto}}.

**Derechos.** Podrá ejercer en cualquier momento sus derechos de acceso, rectificación, supresión, limitación del tratamiento, portabilidad y oposición mediante correo electrónico dirigido a la responsable del tratamiento a {{email_contacto}}, adjuntando documento que acredite su identidad. Igualmente, podrá presentar una reclamación ante la Agencia Española de Protección de Datos (AEPD). Para garantizar la seguridad de los datos personales, en determinados supuestos podrá solicitarse acreditación de identidad.

El paciente declara haber sido informado de forma clara y comprensible sobre el tratamiento de sus datos personales y presta su consentimiento para ello.$txt$
where not exists (select 1 from public.document_versions where doc_type = 'privacy' and version = '2.3');

-- Versión vigente y sus antecesoras «cosméticas» (cadena de supersedes_id).
create or replace function public.document_version_lineage(p_version uuid)
returns setof uuid
language sql stable security definer set search_path = public as $fn$
  with recursive chain(id, supersedes_id) as (
    select id, supersedes_id from public.document_versions where id = p_version
    union all
    select d.id, d.supersedes_id
      from public.document_versions d join chain c on d.id = c.supersedes_id
     where exists (select 1 from public.document_versions x where x.id = c.id and not x.requires_resign)
  )
  select id from chain;
$fn$;
revoke all on function public.document_version_lineage(uuid) from public, anon, authenticated;
grant execute on function public.document_version_lineage(uuid) to service_role;

create or replace function public.consent_overview(p_patient uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_status text;
  v_last public.consents;
  v_current uuid;
begin
  if auth.uid() is null or (auth.uid() <> p_patient and not public.is_admin()) then
    raise exception 'NOT_ALLOWED';
  end if;
  v_status := public.consent_status_for(p_patient);
  select * into v_last from public.consents where patient_id = p_patient order by signed_at desc limit 1;
  select id into v_current from public.current_document_versions() where doc_type = 'privacy';
  return jsonb_build_object(
    'status', v_status,
    'block_booking', coalesce((select block_booking_until_consent from public.consent_settings where id = 1), false),
    'info_update', v_status = 'firmado' and v_last.id is not null and v_current is not null
                   and v_last.privacy_version_id not in (select public.document_version_lineage(v_current)),
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
