# Firma del consentimiento en el área del paciente

Sustituye al PDF que se firmaba «por fuera». El paciente lee el **Consentimiento informado y normas del servicio** en su área, marca las tres casillas, firma con el dedo o el ratón, recibe el PDF por email y lo tiene siempre en «Documentos». La psicóloga no hace nada: ve el estado en la ficha. Firma electrónica simple con evidencias, en infraestructura propia (sin DocuSign).

## Flujo

| Quién | Dónde | Qué |
|---|---|---|
| Paciente | `/mi-area` | Pestañas **Citas** y **Documentos** (`/mi-area#documentos`). Mientras esté pendiente, aviso «Tienes un documento pendiente de firma» → **Firmar ahora**, y un punto naranja en «Documentos». |
| Paciente | `/mi-area/consentimiento` | Datos precargados de la ficha (nombre, apellidos, DNI/NIE, fecha de nacimiento, teléfono; el email es el de la cuenta). Si falta alguno obligatorio: «Para completar tu ficha necesitamos estos datos: …» y el campo resaltado. Tres bloques abiertos; la casilla de cada uno se habilita al llegar al final del texto o a los 10 s. Firma en canvas (`signature_pad`), «Borrar» y «Firmar». Menores de 18: aviso y no se puede firmar. Si ya firmó la versión vigente, redirige a Documentos. |
| Paciente | `/mi-area#documentos` | El documento con «Firmado el …» y **Descargar PDF** (enlace de 1 h generado al pulsar). Firmas anteriores, si las hay. **Mis facturas**, siempre visible. |
| Psicóloga | Ficha del paciente → **Consentimiento** | Pendiente / Firmado el … con **Descargar PDF**. |

## Servidor (`api/consent.ts`, Vercel Edge)

1. Identifica al paciente por su sesión. El email del PDF es el de su cuenta, no el que mande el navegador.
2. **Anti-abuso:** 5 intentos por hora por paciente o por IP (`consent_attempts`, IP guardada como SHA-256). Turnstile si se configuran las claves (ver abajo).
3. **Valida en el servidor:** campos obligatorios, DNI/NIE con letra de control, mayoría de edad, las tres casillas a `true`, firma PNG **con trazo** (se descomprime el PNG y se buscan píxeles no transparentes) y que los textos firmados sean los vigentes (si cambian mientras lee: 409 «Recarga»). La base de datos vuelve a exigir las casillas (`check`).
4. Vuelve a renderizar los textos con los datos de la base de datos y calcula `rendered_text_sha256` sobre el texto canónico (`shared/consent.ts → canonicalText`).
5. Genera el PDF (`server/consentPdf.ts`, pdf-lib, sin binarios) y calcula `pdf_sha256`.
6. Sube la firma y el PDF a `consents/{slug}/{año}/{id}.png|.pdf` (bucket privado) e inserta la fila en `consents`. Si falla, borra lo subido.
7. Escribe en la ficha nombre completo, DNI, fecha de nacimiento y teléfono.
8. Envía el PDF adjunto al paciente y a la psicóloga (Resend). Un fallo del email no deshace la firma.

`api/consent-file.ts` da la URL firmada (1 h) del PDF al propio paciente o a la administración.

En los logs nunca se escriben datos del paciente, y nada del paciente va en la URL.

## El PDF

El orden de las páginas es:

1. Portada con el logo y el título, los datos del paciente, de la responsable del tratamiento y de la profesional, y un índice.
2. Bloques A, B y C completos. Cada uno lleva su casilla marcada y debajo «Marcado por … el …».
3. Página «Evidencias de la firma», con:
   - firmante y DNI/NIE;
   - la imagen de la firma;
   - fecha y hora en Madrid y en UTC, fijadas por el servidor;
   - IP y user-agent;
   - ID del consentimiento;
   - versión de cada bloque;
   - SHA-256 del texto.

Todas las páginas llevan el pie «Documento firmado electrónicamente el … — ID …».

**Huella del PDF:** se guarda **solo en la base de datos** (`consents.pdf_sha256`), calculada sobre el archivo tal cual se sube. No puede ir dentro del propio PDF sin cambiarla. La página de evidencias lo explica. Para comprobarla basta con descargar el PDF y calcular su SHA-256: tiene que coincidir con el registro.

## Datos (`supabase/migrations/20261108_consentimiento_firma.sql`, también al final de `schema.sql`)

- `therapists`: profesionales. Cada fila se enlaza con el perfil de administración (`profile_id`), que es lo que ya tiene cada paciente en `profiles.psychologist_id`. **Dar de alta a otra psicóloga es insertar una fila aquí.** Sus pacientes verán sus datos sin tocar código.
- `consent_settings` (una fila): datos de la responsable del tratamiento, IBAN, plataforma y `block_booking_until_consent`.
- `document_versions`: textos con `{{placeholders}}`. No se pueden editar ni borrar (trigger). **Para cambiar un texto se inserta una versión nueva.** Si `requires_resign` es `true` (por defecto), quien firmó la anterior vuelve a «Pendiente de firma (actualización)». Las firmas antiguas se conservan y se pueden seguir descargando.
- `consents`: una fila por firma. No se puede modificar ni borrar. Si se borra al paciente, la firma se conserva sin el enlace.
- `profiles.birth_date`: nueva.
- Bucket `consents`: privado, sin políticas (solo `service_role`).
- **RLS activado y sin políticas** en las tablas nuevas. El navegador solo llama a `consent_context()` (el paciente, su propia página de firma) y `consent_overview(paciente)` (el propio paciente o la administración).

Textos cargados: A protección de datos **2.0**, B normas **2.0**, C desistimiento **1.0**. Están literales del brief, con vigencia desde el 08/11/2026.

Valores actuales:
- Silvia López Fernández, DNI 03933796Z, colegiada M-40562.
- C/ Antonio López nº 8, Cobisa (Toledo).
- `silozpsicologia@gmail.com`.
- IBAN ES34 2100 7823 6213 0025 8116 (el del documento anterior).
- Google Meet, sesiones de 50 minutos, 55 € la sesión y 250 € el bono de 5.

```sql
-- Bloquear la reserva hasta firmar (ahora: no se bloquea)
update public.consent_settings set block_booking_until_consent = true where id = 1;
-- Cambiar un dato del centro (se aplica a las firmas nuevas; las antiguas no cambian)
update public.consent_settings set plataforma_videollamada = 'Zoom' where id = 1;
```

## Variables de entorno (Vercel)

| Variable | Estado |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` | Ya existen (las usan invitaciones, reservas y el formulario). |
| `RESEND_FROM` | Opcional. Por defecto `Siloz Psicología <consentimientos@silozpsicologia.com>` (dominio ya verificado en Resend), con `reply-to` a `silozpsicologia@gmail.com`. |
| `TURNSTILE_SECRET_KEY` + `VITE_TURNSTILE_SITE_KEY` | Opcionales. Si se ponen las dos, el formulario pide la verificación de Cloudflare Turnstile. Sin ellas, el límite de 5 intentos por hora sigue activo. |

## Decisiones distintas del brief

1. **Sin tabla `patients` aparte.** Los datos del paciente están en `profiles`. Se ha añadido `birth_date`; nombre y apellidos se guardan juntos en `full_name` y por separado en la firma.
2. **`therapists` enlazada a `profiles`** (`profile_id`), porque la app ya asigna una psicóloga a cada paciente. Los datos del centro (responsable, IBAN, plataforma) van en `consent_settings`, no en `therapists`.
3. **`consents.patient_id`** (no estaba en el brief) para enlazar cada firma con su paciente.
4. **Runtime Edge** en lugar de Node 20, igual que las demás funciones del proyecto (reservas). pdf-lib es JavaScript puro y funciona igual.
5. **Turnstile opcional:** el formulario solo lo usan pacientes con sesión iniciada, y necesita claves de Cloudflare que aún no existen. Sin ellas se mantiene el límite de 5 envíos por hora.
6. **Sin página `/politica-privacidad` nueva:** la política ya existe en el apartado 3 de `/aviso-legal`, y `/politica-privacidad` redirige ahí. El placeholder `{{url_politica_privacidad}}` no se usa en los textos.
7. **Bloqueo de la reserva:** existe (`block_booking_until_consent`), pero está **desactivado**, por decisión del cliente.
8. **Duración de 50 minutos**, la que usa la agenda.
9. **Fuente del PDF:** Helvetica estándar (alfabeto latino). Un carácter fuera de él, como un emoji en el user-agent, sale como «?».

## Pruebas

- `npm test`: validaciones (DNI/NIE, edad, campos), placeholders con los textos reales, PDF válido, firma vacía o con trazo, cuerpo de la petición y endpoints sin sesión.
- `npm run test:db` (Postgres local, nunca el de Supabase): `supabase/tests/consentimiento.test.sql` comprueba:
  - estados pendiente / firmado / actualización, y versiones futuras o sin refirma;
  - permisos (paciente, otro paciente, admin, anónimo);
  - RLS sin lectura directa;
  - inmutabilidad de firmas y textos;
  - que la firma se conserva al borrar al paciente.
