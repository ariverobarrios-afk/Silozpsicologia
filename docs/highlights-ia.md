# Highlights de sesión con IA (Claude)

En la página de cada sesión (`/panel/sesion/<id>`), la psicóloga pulsa **Generar highlights**. Sus notas se resumen en cuatro secciones: temas trabajados, hechos relevantes, tareas acordadas y para retomar. El resumen se guarda en la sesión, se puede retocar a mano o volver a generar, y **solo lo ve ella**.

## Cómo funciona (`api/session-highlights.ts`)

1. **Comprobaciones previas:**
   - solo administración;
   - el paciente **no se ha opuesto** (`profiles.ai_opt_out`);
   - el paciente **ha firmado el consentimiento** (cualquier versión);
   - hay notas guardadas.
2. **Seudonimización** (`server/highlights.ts → pseudonymize`): se cambian por marcadores el nombre y los apellidos del paciente (sin distinguir mayúsculas ni tildes), y cualquier DNI/NIE, email o teléfono. Quedan como `[PACIENTE]`, `[DNI]`, `[EMAIL]` y `[TELÉFONO]`. Lo que identifica por contexto (lugares, nombres de terceros…) depende de cómo se escriban las notas.
3. **Llamada a la API de Anthropic** con el SDK oficial (`@anthropic-ai/sdk`):
   - modelo `claude-opus-5-5`. No es un «Covered Model» (Fable/Mythos), así que no tiene retención obligatoria extra;
   - `inference_geo: "us"`, coherente con el texto del consentimiento («Estados Unidos»);
   - `effort: "low"`;
   - respuesta estructurada (JSON con las cuatro secciones);
   - `fallbacks: "default"`: si el modelo declina por seguridad, la propia API reintenta con el modelo que recomienda Anthropic. Puede ser otro modelo de Anthropic, con las mismas condiciones de cuenta;
   - instrucciones fijas (`HIGHLIGHTS_SYSTEM`): **solo resumir lo escrito**, sin diagnósticos, hipótesis, valoraciones de riesgo ni recomendaciones de tratamiento. Así el uso encaja en la exclusión de «internal summarization» de la Usage Policy de Anthropic.
4. **Resultado:** se guarda en `session_highlights` (RLS: solo administración) junto con el modelo y el SHA-256 de las notas. Así se avisa si las notas cambian después de generarlo.
5. **Logs:** nunca contienen las notas ni la respuesta, solo códigos de error.

## Consentimiento (texto A 2.2) y oposición

- **Texto nuevo:** A 2.2 añade el párrafo «Uso de inteligencia artificial» y la mención en «Destinatarios y encargados». Lo aprobó el cliente; se quitó «marcando la casilla correspondiente al firmar», porque no hay casilla.
- **Sin volver a firmar** (`requires_resign = false`). Quien firmó un texto anterior ve en su área el aviso «Hemos actualizado la información sobre protección de datos», con **Leer** y **Entendido** (`consent_overview.info_update`).
- **PDF de firmas anteriores:** no se reemiten con la 2.2 (`supersedes_id` nulo), porque no es un cambio sin efecto para el paciente.
- **Oposición:** el paciente escribe a la consulta y la psicóloga activa «Se opone al uso de IA con sus notas» en la ficha. Mientras esté activado no se pueden generar highlights de sus sesiones (lo comprueba el servidor).
- **Aviso legal** (`/aviso-legal`): el apartado 3.5 explica el uso y el 3.6 lista a Anthropic como encargado.

## Configuración

- **Cuenta:** una organización en `platform.claude.com` a nombre de la consulta. Al aceptar las Commercial Terms se aplica la DPA, con las cláusulas contractuales tipo.
- **Retención:** comprobar en *Settings › Privacy Controls › Data retention* que es la estándar (borrado en 30 días).
- **Clave:** crear una API key y ponerla en **Vercel → Settings → Environment Variables** como `ANTHROPIC_API_KEY` (Production y Preview). Sin ella, el botón responde «Los highlights con IA aún no están configurados».

## Riesgos conocidos

Vienen del informe de condiciones públicas de Anthropic del 09/11/2026.

- **El DPA describe las categorías especiales de datos como «None».** No prohíbe enviar datos de salud, pero tampoco los contempla.
- **Contenido marcado por seguridad.** Si los sistemas de seguridad de Anthropic marcan algo, pueden conservarlo hasta 2 años. Las notas sobre autolesiones o violencia podrían marcarse. Está informado en el texto del consentimiento.
- **Sin región en la UE ni certificación DPF.** La transferencia se apoya solo en las cláusulas contractuales tipo.
- **No se ha hecho evaluación de impacto (EIPD).** Fue decisión del cliente, aunque la lista de la AEPD la exige cuando concurren datos de salud y tecnologías nuevas.
