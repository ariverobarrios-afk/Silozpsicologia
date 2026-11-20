# Tareas de la sesión

Apartado «Tareas» de la página de una sesión (`/panel/sesion/<cita>`), debajo de los highlights.

## Qué hace

**La psicóloga, en la sesión:**

- **Documentos (PDF):** sube uno o varios PDF. Cada uno lleva un interruptor «Visible para el paciente»; mientras esté apagado solo lo ve ella.
- **Tareas:** «Añadir tarea» crea un desplegable nuevo. Escribe el texto y, si quiere, adjunta **una imagen** (opcional). La tarea es un borrador hasta que pulsa **«Publicar al paciente»**; puede retirarla, editarla o borrarla después.
- Cuando el paciente responde, la respuesta (texto y archivos) aparece dentro del desplegable de esa tarea, que pasa a «Respondida».

**El paciente, en su área → Citas → «Tareas»** (`/mi-area#tareas`):

- Ve, por sesión, los documentos visibles y las tareas publicadas, cada una en su desplegable. La pestaña lleva un contador con las que tiene sin responder.
- Responde con texto y puede adjuntar hasta 5 archivos (imágenes, PDF, Word, ODT, RTF o TXT; 20 MB cada uno). Puede cambiar su respuesta más adelante.

**Aviso por email:** al guardar una respuesta nueva (texto distinto o archivos nuevos), la psicóloga del paciente recibe un email con el nombre del paciente, la sesión y un enlace a la sesión. El email **no incluye** el texto de la tarea ni la respuesta.

## Cómo está hecho

| Pieza | Dónde |
|---|---|
| Tablas `session_tasks` y `session_task_files`, bucket privado `session-tasks`, funciones de permisos | `supabase/migrations/20261119_tareas_sesion.sql` (también al final de `supabase/schema.sql`) |
| Subir, descargar y borrar archivos; guardar la respuesta y avisar | `api/session-tasks.ts` |
| Tipos de archivo y tamaños admitidos | `shared/sessionTasks.ts` |
| Pantalla de la psicóloga / del paciente | `client/src/pages/area/TasksPanel.tsx` / `PatientTasks.tsx` |

- **Permisos:** la psicóloga gestiona las tareas por RLS. El paciente no puede leer ni escribir las tablas: lee con `my_session_tasks()` (solo lo publicado o visible, de sus citas) y escribe a través del servidor.
- **Archivos:** el bucket no tiene políticas. Se suben con un enlace firmado de un solo uso y se abren con enlaces que caducan en 1 hora; ambos los da el servidor tras comprobar quién pide qué. El tipo de archivo se decide por la extensión contra una lista cerrada (sin HTML, SVG ni ejecutables).
- **Variables de entorno:** las que ya existen (`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`; `APP_URL` opcional para el enlace del email).

## Pruebas

- `npm test` → `tests/session-tasks.test.ts` (tipos de archivo, email, endpoint sin sesión).
- `npm run test:db` → `supabase/tests/tareas.test.sql` (permisos, respuesta, lo que ve el paciente).

## Pendiente de decidir

- **Protección de datos:** las tareas, las respuestas y los archivos del paciente son datos de salud guardados en Supabase (UE), como las notas. Conviene revisar si el texto del consentimiento y el aviso legal deben mencionarlo.
- **Al borrar una cita** se borran sus tareas y registros, pero los archivos quedan en el bucket (no accesibles desde la web).
- No se avisa al paciente por email cuando se publica una tarea.
