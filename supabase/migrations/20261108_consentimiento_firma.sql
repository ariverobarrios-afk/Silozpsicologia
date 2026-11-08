-- ─────────────────────────────────────────────────────────────────────────────
-- FIRMA DEL CONSENTIMIENTO EN EL ÁREA DEL PACIENTE (docs/consentimiento-firma.md)
--
-- El paciente lee los documentos legales (protección de datos, normas del
-- servicio y desistimiento), los acepta y los firma desde «Mi área». El
-- servidor (api/consent.ts, con service_role) guarda la firma, genera el PDF
-- con evidencias y lo sube al bucket privado «consents».
--
-- · therapists            → profesionales que prestan el servicio (una fila por
--                           psicóloga, enlazada a su perfil de administración).
-- · consent_settings      → datos del centro (responsable del tratamiento, IBAN…).
-- · document_versions     → textos legales versionados; nunca se editan.
-- · consents              → una fila por firma, con sus evidencias.
-- · consent_attempts      → registro para limitar envíos (anti-abuso).
-- · profiles.birth_date   → fecha de nacimiento del paciente (la pide la firma).
--
-- RLS activado en todas y SIN políticas: nadie las lee ni escribe desde el
-- navegador. El navegador solo usa las funciones consent_context() y
-- consent_overview(), que comprueban quién llama.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles add column if not exists birth_date date;

create table if not exists public.therapists (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid unique references public.profiles (id) on delete set null,
  slug              text unique not null check (slug ~ '^[a-z0-9-]+$'),
  full_name         text not null,
  dni               text not null,
  collegiate_number text,
  email             text not null,
  price_single_eur  numeric(6,2) not null default 55,
  price_pack5_eur   numeric(6,2) not null default 250,
  session_minutes   int not null default 50,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);
alter table public.therapists enable row level security;

create table if not exists public.consent_settings (
  id                          int primary key default 1 check (id = 1),
  responsable_nombre          text not null,
  responsable_dni             text not null,
  responsable_direccion       text not null,
  email_contacto              text not null,
  iban                        text not null,
  plataforma_videollamada     text not null,
  -- Si es true, el paciente no puede reservar cita hasta firmar.
  block_booking_until_consent boolean not null default false,
  updated_at                  timestamptz not null default now()
);
alter table public.consent_settings enable row level security;

create table if not exists public.document_versions (
  id             uuid primary key default gen_random_uuid(),
  doc_type       text not null check (doc_type in ('privacy', 'rules', 'withdrawal')),
  version        text not null,
  title          text not null,
  body_md        text not null,          -- texto con placeholders {{...}}
  checkbox_label text not null,          -- texto de la casilla de aceptación
  effective_from date not null,
  -- false = cambio menor: quien firmó la versión anterior no tiene que volver a firmar.
  requires_resign boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (doc_type, version)
);
alter table public.document_versions enable row level security;

-- Los textos legales nunca se editan ni se borran: se inserta una versión nueva.
create or replace function public.document_versions_immutable()
returns trigger language plpgsql as $fn$
begin
  raise exception 'Los textos legales no se modifican: inserta una versión nueva en document_versions.';
end;
$fn$;
drop trigger if exists document_versions_no_update on public.document_versions;
create trigger document_versions_no_update
  before update or delete on public.document_versions
  for each row execute function public.document_versions_immutable();

create table if not exists public.consents (
  id                        uuid primary key default gen_random_uuid(),
  patient_id                uuid references public.profiles (id) on delete set null,
  therapist_id              uuid not null references public.therapists (id),
  patient_name              text not null,
  patient_surname           text not null,
  patient_id_number         text not null,      -- DNI/NIE
  patient_email             text not null,
  patient_phone             text,
  patient_birthdate         date not null,
  is_minor                  boolean not null default false,
  privacy_version_id        uuid not null references public.document_versions (id),
  rules_version_id          uuid not null references public.document_versions (id),
  withdrawal_version_id     uuid not null references public.document_versions (id),
  accepted_privacy          boolean not null check (accepted_privacy),
  accepted_rules            boolean not null check (accepted_rules),
  accepted_withdrawal_start boolean not null check (accepted_withdrawal_start),
  signature_png_path        text not null,
  pdf_path                  text not null,
  pdf_sha256                text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  rendered_text_sha256      text not null check (rendered_text_sha256 ~ '^[0-9a-f]{64}$'),
  signed_at                 timestamptz not null default now(),
  ip                        inet,
  user_agent                text,
  created_at                timestamptz not null default now()
);
alter table public.consents enable row level security;
create index if not exists consents_patient_idx on public.consents (patient_id, signed_at desc);

-- Una firma es una evidencia: no se modifica ni se borra.
create or replace function public.consents_immutable()
returns trigger language plpgsql as $fn$
begin
  -- Única excepción: al borrar un paciente, la firma se conserva sin el enlace.
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'patient_id') = (to_jsonb(old) - 'patient_id')
     and new.patient_id is null then
    return new;
  end if;
  raise exception 'Las firmas de consentimiento no se modifican ni se borran.';
end;
$fn$;
drop trigger if exists consents_no_change on public.consents;
create trigger consents_no_change
  before update or delete on public.consents
  for each row execute function public.consents_immutable();

create table if not exists public.consent_attempts (
  id         bigint generated always as identity primary key,
  user_id    uuid,
  ip_hash    text,                       -- SHA-256 de la IP (no se guarda la IP en claro)
  created_at timestamptz not null default now()
);
alter table public.consent_attempts enable row level security;
create index if not exists consent_attempts_recent_idx on public.consent_attempts (created_at);

-- Bucket privado para los PDF y las firmas (sin políticas: solo service_role).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('consents', 'consents', false, 5242880, array['application/pdf', 'image/png'])
on conflict (id) do update set public = false;

-- ─── Estado del consentimiento de un paciente ───────────────────────────────
-- Versiones vigentes: la última de cada tipo con effective_from <= hoy (Madrid).
create or replace function public.current_document_versions()
returns setof public.document_versions
language sql stable security definer set search_path = public as $fn$
  select distinct on (doc_type) *
    from public.document_versions
   where effective_from <= (now() at time zone 'Europe/Madrid')::date
   order by doc_type, effective_from desc, created_at desc;
$fn$;
revoke all on function public.current_document_versions() from public, anon, authenticated;
grant execute on function public.current_document_versions() to service_role;

-- 'pendiente' (nunca ha firmado) · 'actualizacion' (firmó una versión que ya
-- no está vigente y la nueva pide volver a firmar) · 'firmado'.
create or replace function public.consent_status_for(p_patient uuid)
returns text
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_last public.consents;
begin
  select * into v_last from public.consents
   where patient_id = p_patient order by signed_at desc limit 1;
  if not found then return 'pendiente'; end if;
  if exists (
    select 1 from public.current_document_versions() d
     where d.requires_resign
       and d.id <> case d.doc_type
                     when 'privacy' then v_last.privacy_version_id
                     when 'rules' then v_last.rules_version_id
                     else v_last.withdrawal_version_id end
  ) then
    return 'actualizacion';
  end if;
  return 'firmado';
end;
$fn$;
revoke all on function public.consent_status_for(uuid) from public, anon, authenticated;
grant execute on function public.consent_status_for(uuid) to service_role;

-- Estado y firmas de un paciente: el propio paciente o la administración.
create or replace function public.consent_overview(p_patient uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
begin
  if auth.uid() is null or (auth.uid() <> p_patient and not public.is_admin()) then
    raise exception 'NOT_ALLOWED';
  end if;
  return jsonb_build_object(
    'status', public.consent_status_for(p_patient),
    'block_booking', coalesce((select block_booking_until_consent from public.consent_settings where id = 1), false),
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

-- Todo lo que necesita la página de firma del paciente que llama: textos
-- vigentes, datos para los placeholders y lo que ya hay en su ficha.
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
      'responsable_direccion', v_set.responsable_direccion, 'email_contacto', v_set.email_contacto,
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

-- ─── Datos iniciales ────────────────────────────────────────────────────────
insert into public.consent_settings
  (id, responsable_nombre, responsable_dni, responsable_direccion, email_contacto, iban, plataforma_videollamada)
values
  (1, 'Silvia López Fernández', '03933796Z', 'C/ Antonio López nº 8, Cobisa (Toledo)',
   'silozpsicologia@gmail.com', 'ES34 2100 7823 6213 0025 8116', 'Google Meet')
on conflict (id) do nothing;

insert into public.therapists (profile_id, slug, full_name, dni, collegiate_number, email, session_minutes)
select p.id, 'silvia', 'Silvia López Fernández', '03933796Z', 'M-40562', 'silozpsicologia@gmail.com', 50
  from public.profiles p
 where p.role = 'admin' and p.email = 'silozpsicologia@gmail.com'
on conflict (slug) do nothing;

insert into public.document_versions (doc_type, version, title, checkbox_label, effective_from, body_md) values
('privacy', '2.0', 'Información y consentimiento sobre protección de datos',
 'He leído la información sobre protección de datos y presto mi consentimiento.', '2026-11-08',
$txt$**Responsable del tratamiento.** Le informamos que los datos personales que facilite serán tratados por {{responsable_nombre}}, con DNI {{responsable_dni}} y domicilio profesional en {{responsable_direccion}}, con la finalidad de la prevención, diagnóstico y tratamiento psicológico, así como para la gestión administrativa y sanitaria de los servicios que el centro le preste en cada momento. El profesional que prestará la asistencia es {{profesional_nombre}} (DNI {{profesional_dni}}, colegiada n.º {{profesional_colegiada}}), que trata sus datos bajo la responsabilidad y las instrucciones de la responsable del tratamiento y sujeta a secreto profesional.

**Conservación.** Los datos personales se conservarán durante el tiempo necesario para la prestación del servicio asistencial y, posteriormente, durante los plazos legalmente establecidos, en particular conforme a la Ley 41/2002, de 14 de noviembre, básica reguladora de la autonomía del paciente y de derechos y obligaciones en materia de información y documentación clínica. Una vez transcurridos dichos plazos, los datos serán suprimidos, salvo en los supuestos legalmente previstos.

**Base legal.** La base legal para el tratamiento de sus datos es el consentimiento explícito del interesado y la necesidad del tratamiento para la prestación de asistencia sanitaria, todo ello conforme al Reglamento (UE) 2016/679 del Parlamento Europeo y del Consejo, de 27 de abril de 2016 (RGPD), y la Ley Orgánica 3/2018, de Protección de Datos Personales y Garantía de los Derechos Digitales.

**Destinatarios y encargados del tratamiento.** Sus datos no se cederán a terceros, salvo obligación legal. Para la prestación del servicio, la responsable recurre a proveedores que actúan como encargados del tratamiento y acceden a los datos únicamente en la medida necesaria para prestar su servicio y bajo las garantías del RGPD: alojamiento de correo electrónico y archivos, plataforma de videollamada ({{plataforma_videollamada}}), alojamiento de la web y base de datos del sistema de firma, y mensajería instantánea. Algunos de estos proveedores pueden realizar transferencias internacionales de datos al amparo de las garantías previstas en el RGPD (decisiones de adecuación o cláusulas contractuales tipo). Puede solicitar más información sobre los encargados en {{email_contacto}}.

**Derechos.** Podrá ejercer en cualquier momento sus derechos de acceso, rectificación, supresión, limitación del tratamiento, portabilidad y oposición, mediante escrito dirigido a la responsable del tratamiento en la dirección indicada o mediante correo electrónico a {{email_contacto}}, adjuntando documento que acredite su identidad. Igualmente, podrá presentar una reclamación ante la Agencia Española de Protección de Datos (AEPD). Para garantizar la seguridad de los datos personales, en determinados supuestos podrá solicitarse acreditación de identidad.

El paciente declara haber sido informado de forma clara y comprensible sobre el tratamiento de sus datos personales y presta su consentimiento para ello.$txt$),
('rules', '2.0', 'Normas del servicio',
 'He leído y acepto las normas del servicio.', '2026-11-08',
$txt$Por favor, lea detenidamente las normas explicadas a continuación. Su objetivo es maximizar la eficacia del tratamiento y garantizar el adecuado funcionamiento del servicio para todos los pacientes. El servicio lo presta {{responsable_nombre}} ("el centro"), a través de la profesional {{profesional_nombre}} (DNI {{profesional_dni}}).

**Asistencia e implicación.** Para que el tratamiento sea eficaz, es esencial acudir a todas las sesiones pautadas por su terapeuta. Asimismo, es imprescindible su implicación y trabajo en terapia, por lo que deberá cumplimentar los cuestionarios y tareas que le sean indicados.

**Formato y duración.** Las sesiones se realizan en formato online a través de {{plataforma_videollamada}} y tienen una duración de {{duracion_sesion}} minutos.

**Cancelaciones por parte del paciente.** Las sesiones no deberán anularse salvo por causas de fuerza mayor, ya que ello repercute negativamente en la continuidad del tratamiento y perjudica a otros pacientes que podrían ser atendidos en ese horario. En caso de no poder acudir, deberá comunicarlo con la mayor antelación posible. Cuando la cancelación no se realice con al menos 24 horas de antelación respecto a la hora de la sesión, se aplicarán las siguientes condiciones: en las dos primeras ocasiones se abonará el 50 % del coste de la sesión y, a partir de la tercera, el 100 %. Las sesiones canceladas sin respetar el preaviso o no realizadas se abonarán como sesión suelta y no podrán descontarse de los bonos.

**Cancelaciones por parte del centro.** Si la terapeuta cancelase una sesión con menos de 24 horas de antelación por causas no imputables al paciente, la sesión se repondrá en la fecha más próxima posible sin coste adicional y, si el paciente lo prefiere, se le bonificará el 50 % de la siguiente sesión.

**Puntualidad.** Se ruega puntualidad. Si la terapeuta se retrasa por causas asistenciales, el paciente dispondrá del tiempo completo de su sesión. Si el retraso es del paciente, la sesión finalizará a la hora inicialmente acordada.

**Precio y bonos.** El coste del servicio es de {{precio_sesion}} euros por sesión suelta o de {{precio_bono5}} euros por un bono de 5 sesiones. Los bonos no caducan. Se recomienda consumirlos con frecuencia semanal, salvo pauta distinta acordada con la terapeuta. Transcurrido el plazo legal de desistimiento de 14 días (ver bloque siguiente), las sesiones de bono no consumidas no son reembolsables, salvo que la imposibilidad de prestar el servicio sea imputable al centro, en cuyo caso se reembolsará la parte no consumida.

**Pago.** Las sesiones se abonan con carácter previo a su realización. Si existen pagos pendientes, no podrá prestarse el servicio. El pago puede realizarse justo antes de la sesión siempre que se remita el justificante. Método de pago: transferencia bancaria a la cuenta {{iban}}. La actividad de psicoterapia sanitaria está exenta de IVA.

**Continuidad.** Para obtener el máximo beneficio terapéutico, mantener los resultados a largo plazo y prevenir recaídas, se recomienda continuar el tratamiento hasta su finalización, según lo acordado con la terapeuta.

**Reclamaciones.** Puede dirigir cualquier reclamación a {{email_contacto}} o por escrito a {{responsable_direccion}}.$txt$),
('withdrawal', '1.0', 'Derecho de desistimiento y solicitud de inicio del servicio',
 'Solicito expresamente que el servicio comience antes de que finalice el plazo de desistimiento de 14 días, y entiendo que, si desisto, abonaré la parte proporcional de las sesiones realizadas y que el derecho se extingue una vez prestado el servicio en su totalidad.', '2026-11-08',
$txt$Al contratar el servicio a distancia, dispone de un plazo de 14 días naturales desde la fecha de aceptación de estas condiciones para desistir del contrato sin necesidad de justificación, comunicándolo a {{email_contacto}} o por escrito a {{responsable_direccion}}. Puede utilizar el formulario que figura al final de este documento, aunque no es obligatorio.

Si solicita que el servicio comience durante el plazo de desistimiento y posteriormente desiste, abonará la parte proporcional de las sesiones ya realizadas. Si el servicio se ha prestado completamente dentro del plazo con su consentimiento, el derecho de desistimiento se extingue. En caso de bonos, el desistimiento dentro del plazo da derecho al reembolso de las sesiones no consumidas.

**Formulario de desistimiento (modelo):** A la atención de {{responsable_nombre}}, {{responsable_direccion}}, {{email_contacto}}. Por la presente le comunico que desisto de mi contrato de prestación de servicios de psicoterapia aceptado el día ____. Nombre del consumidor: ____. Dirección: ____. Fecha y firma: ____.$txt$)
on conflict (doc_type, version) do nothing;
