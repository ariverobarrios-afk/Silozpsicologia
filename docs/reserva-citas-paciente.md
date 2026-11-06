# Reserva de citas por el paciente

La psicóloga **abre huecos** en su agenda y el paciente, desde «Mi área», **reserva uno**.
La reserva se convierte en una cita normal y la psicóloga recibe un email.
Solo se pueden reservar los huecos abiertos con «Abrir agenda». El tiempo libre de la agenda no se puede reservar.

## Flujos

| Quién | Dónde | Qué |
|---|---|---|
| Psicóloga | `/panel` → Agenda → **Abrir agenda** | Fecha, franja (desde–hasta), duración de cada hueco y nº de semanas. Se omiten los huecos pasados y los que chocan con citas, eventos u otros huecos, y se avisa: «Se han abierto 6 huecos; 2 se han omitido porque ya tenías algo a esa hora». |
| Psicóloga | Agenda → pulsar un bloque **Libre** (borde discontinuo) | **Cerrar hueco** (deja de ofrecerse y desaparece) o **Convertir en cita**. Esta segunda opción abre «Nueva cita» con esa fecha y hora, y al guardar el hueco queda `reservado` y enlazado a la cita. |
| Paciente | `/mi-area` → **Reservar cita** | Huecos de su psicóloga agrupados por día (hora de Madrid). Las semanas en las que ya tiene cita salen atenuadas con «Ya tienes cita esta semana». Si pulsa uno de esos huecos sale un aviso con el email y el teléfono de su psicóloga. Al elegir un hueco ve una confirmación con un comentario opcional (máx. 300 caracteres). |
| Paciente | `/mi-area` → **Mis próximas citas** → **Cancelar cita** | El botón solo aparece en las citas que reservó él. Con más de 24 h pide confirmación y cancela: la cita pasa a `cancelada`, el hueco se reabre y la psicóloga recibe un email. Con 24 h o menos no se cancela nada y sale el aviso «Avisa directamente a tu psicóloga». |
| Psicóloga | Agenda | Una cita reservada es una cita normal (se edita, cobra y cancela igual) y lleva la marca «Reservada por el paciente». Si ella la cancela o la mueve, el hueco **no** se reabre. |

## Modelo de datos (`supabase/schema.sql`, sección final = `supabase/migrations/20261106_reserva_citas_paciente.sql`)

- **`agenda_slots`** (nueva): `id`, `psychologist_id` → profiles, `starts_at`, `ends_at`, `status` (`abierto` \| `reservado` \| `cerrado`), `appointment_id` (único, → appointments), `booked_by_patient_id`, `booked_at`, `created_at`, `updated_at`.
  - Restricción `EXCLUDE` (extensión `btree_gist`): dos huecos **abiertos** de la misma psicóloga no pueden solaparse.
- **`appointments.origin`**: `manual` (por defecto) \| `reserva_paciente`.
- **`profiles.psychologist_id`**: la psicóloga de cada paciente. La migración rellena este campo en los pacientes que ya existen con la única admin, y un trigger se lo pone a los pacientes nuevos.
- **`booking_settings`** (una fila): ajustes que se pueden cambiar (ver abajo).
- Si el paciente deja un comentario, también se guarda en `appointment_notes` («Comentario del paciente al reservar: …»), que solo ve la psicóloga.

### Funciones (toda la lógica está en la base de datos)

| Función | Quién | Qué hace |
|---|---|---|
| `open_agenda_slots(fecha, desde, hasta, minutos, semanas)` | psicóloga (`authenticated` + `is_admin`) | Crea sus huecos y devuelve `{created, skipped_busy, skipped_past}`. Interpreta las horas en Europe/Madrid. |
| `close_agenda_slot(id)` | psicóloga | Cierra un hueco **propio** que siga abierto. |
| `book_slot(paciente, hueco, comentario)` | solo `service_role` | Hace la reserva en una sola transacción (detalle debajo de esta tabla). |
| `cancel_booking(paciente, cita)` | solo `service_role` | Solo admite citas propias, con `origin = reserva_paciente`, `programada` y con más de 24 h de margen. Reabre el hueco o, si esa hora ya está ocupada, lo cierra. |
| `my_psychologist()` | paciente | Devuelve nombre, email y teléfono de su psicóloga (para el contacto). |

Qué hace `book_slot` dentro de la transacción:

1. Bloquea la fila del paciente.
2. Toma el hueco con `UPDATE … WHERE status = 'abierto' … RETURNING`.
3. Comprueba la regla de una cita por semana.
4. Crea la cita con la misma tarifa que propone el panel: primera sesión, después un bono con sesiones libres y, si no hay, sesión individual o de pareja.
5. Enlaza el hueco con la cita.

Triggers: cuando se crea o se mueve una cita, el hueco abierto que empieza a esa hora pasa a `reservado` y se enlaza con ella. Cualquier otro hueco abierto que se solape se cierra. Si un evento se solapa con un hueco abierto, también lo cierra. Así nunca se ofrece una hora ocupada.

### Seguridad (RLS)

- **Huecos:** la psicóloga solo lee los suyos. El paciente solo lee los huecos `abierto` de **su** psicóloga dentro de la ventana de reserva. Nadie puede escribir directamente: todo pasa por las funciones.
- **Citas:** sigue igual que antes (el paciente solo lee las suyas).
- **Reservar y cancelar:** no se pueden llamar desde el navegador. Solo las llaman las funciones de Vercel, que identifican al paciente por su token de sesión. Así ningún paciente puede hacerse pasar por otro, y ninguna reserva se queda sin su email.

## Endpoints (Vercel Edge)

| Ruta | Cuerpo | Respuestas |
|---|---|---|
| `POST /api/book-slot` (Bearer token del paciente) | `{ slotId, comment? }` | `200 {success, appointmentId}` · `409 slot_unavailable` · `409 week_limit` · `400 comment_too_long` · `403 not_allowed` · `401` |
| `POST /api/cancel-booking` (Bearer token del paciente) | `{ appointmentId }` | `200 {success}` · `409 too_late` · `409 not_cancellable` · `403 not_allowed` · `401` |

Los emails se envían **después** de que la reserva o la cancelación ya están guardadas (`server/email.ts` → `enviarEmail({para, asunto, html, texto})`, con Resend). Si el envío falla, se registra en los logs de Vercel y la reserva sigue en pie.

- **A la psicóloga al reservar:** asunto «Nueva cita reservada: {paciente} — {día} {fecha} a las {hora}». Incluye un enlace a `/panel#cita/<id>`, que abre la cita.
- **A la psicóloga al cancelar el paciente:** asunto «Cita cancelada por el paciente: …».
- **Al paciente al reservar:** solo si tiene email. Lleva la confirmación y la política de cancelación.

## Ajustes (`booking_settings`, se cambian con SQL sin desplegar)

| Ajuste | Por defecto | Significado |
|---|---|---|
| `min_advance_hours` | 24 | Antelación mínima para reservar. |
| `max_window_days` | 42 (6 semanas) | Hasta cuándo se ven y reservan huecos. |
| `cancel_limit_hours` | 24 | El paciente cancela desde la app solo si faltan **más** de estas horas. |
| Semana | lunes–domingo, Europe/Madrid | Regla de una cita por semana. Cuentan todas las citas no canceladas, manuales o reservadas. Es fija y está en `madrid_week_start()`. |

```sql
update public.booking_settings set min_advance_hours = 48 where id = 1;
```

## Decisiones distintas de la spec (y por qué)

1. **Duración por defecto de 60 min, no 50.** La app solo admite citas que empiezan en punto o a y media (restricción `appointments_half_hour`), y huecos seguidos de 50 min no encajarían: 10:00, 10:50… Por eso la duración de cada hueco va de 30 min a 4 h en tramos de media hora. La cita creada dura lo mismo que el hueco. Al convertir un hueco a mano, el diálogo propone 50 min, como siempre.
2. **«Repetir N semanas» = número total de semanas.** La spec decía «0 = solo ese día», pero su criterio de aceptación («lunes 10–14, 60 min, repetir 2 semanas → 8 huecos») implica que 2 = ese lunes y el siguiente. El campo se llama «Semanas» (1 = solo ese día, máximo 12). 0 se trata como 1.
3. **Nombres en inglés** (`agenda_slots`, `psychologist_id`, `origin`) para seguir el estilo del esquema (`appointments`, `agenda_events`). Los valores de estado van en español (`abierto`…), como `programada`/`cancelada`.
4. **Los eventos de la agenda no tienen dueña** (hoy solo hay una psicóloga). Al comprobar solapes cuentan todos los eventos.
5. **Coherencia automática:** una cita o un evento que pisa un hueco abierto lo cierra (la spec solo pedía comprobarlo al abrir agenda). Sin esto, un hueco podría seguir ofreciéndose sobre una cita creada después.
6. **Reserva y cancelación solo con `service_role`** (no como RPC que llame el navegador), para que el email salga siempre.
7. **Contacto:** la app no tenía canal de contacto en el área privada. Se muestran el email y el teléfono de la ficha de la psicóloga y, si faltan, los de la web (`silozpsicologia@gmail.com`, +34 620 450 696).
8. **Resend sin SDK:** la spec pedía el SDK oficial, pero arrastra módulos que el runtime Edge de Vercel no admite (el despliegue fallaba). `server/email.ts` llama a la API REST de Resend con `fetch`, igual que `api/contact.ts`.
9. **Rama:** el trabajo está en `claude/new-session-6oixn7` (la rama asignada a esta sesión) en lugar de `feature/reserva-citas-paciente`.

## Pruebas

- `npm test`: zona horaria y semanas de Madrid, plazo de cancelación, contenido de los emails, mapeo de errores y endpoints sin sesión.
- `TEST_PG_URL=postgresql://postgres@localhost/postgres npm run test:db`: necesita un Postgres local **de usar y tirar**, nunca el de Supabase. Aplica el esquema completo dos veces y comprueba:
  - todas las reglas de autorización y negocio (`supabase/tests/reserva_citas.test.sql`);
  - 10 reservas simultáneas del mismo hueco: solo una prospera y las otras 9 reciben `SLOT_UNAVAILABLE`;
  - un mismo paciente reservando a la vez dos huecos de la misma semana: solo se guarda uno.
