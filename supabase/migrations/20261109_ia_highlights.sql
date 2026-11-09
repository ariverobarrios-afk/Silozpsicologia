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
