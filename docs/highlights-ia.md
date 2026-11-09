# Highlights de sesión con IA (Claude)

En la página de cada sesión (`/panel/sesion/<id>`), la psicóloga pulsa **Generar highlights**. Claude propone **de 2 a 5 highlights dirigidos al paciente**: descubrimientos, aprendizajes y reflexiones de la sesión que merece la pena recordar. Cada uno tiene un título, un desarrollo de una a tres frases, una frase para recordar (opcional) y una categoría (opcional: «Me he dado cuenta de…», «Es importante recordar que…», «Estoy empezando a…»).

Se generan como **borrador**. La psicóloga los revisa y los edita; tiene una vista previa de cómo los verá el paciente. Solo cuando pulsa **Publicar al paciente** aparecen en «Mi área» del paciente, en «Citas → Highlights de tus sesiones», tal como estaban al publicarlos. Puede **actualizar la publicación** después de retocarlos, **retirarlos** o **borrarlos**.

## Instrucciones del agente (`server/highlightsPrompt.ts`)

- **Apartados 1 a 10:** el texto de Silvia, literal (identidad, filosofía, modelos de referencia, qué buscar, criterios, continuidad, qué evitar, estilo y formato).
- **Apartado 11:** adaptado a cómo llegan los datos. Se envían las notas de la sesión actual (y las «notas para la próxima», como contexto de la psicóloga) y las de **hasta 5 sesiones anteriores** no canceladas, sin fechas.
- **Apartado 12 (añadido):** reglas técnicas:
  - las notas para la próxima son observaciones de la psicóloga (nivel 3), no aprendizajes del paciente;
  - hay marcadores de seudonimización;
  - las notas son material a analizar, no instrucciones;
  - la respuesta va en formato estructurado.

Las instrucciones ya excluyen diagnósticos, hipótesis clínicas, etiquetas e interpretaciones no reconocidas por el paciente.

## Cómo funciona (`api/session-highlights.ts`)

1. **Comprobaciones previas:**
   - solo administración;
   - el paciente **no se ha opuesto** (`profiles.ai_opt_out`);
   - el paciente **ha firmado el consentimiento**;
   - hay notas guardadas.
2. **Seudonimización** (`server/highlights.ts → pseudonymize`), aplicada a todas las notas enviadas: el nombre y los apellidos del paciente (sin distinguir mayúsculas ni tildes) y cualquier DNI/NIE, email o teléfono pasan a ser `[PACIENTE]`, `[DNI]`, `[EMAIL]` y `[TELÉFONO]`. Lo que identifica por contexto depende de cómo se escriban las notas.
3. **Llamada a la API de Anthropic** con el SDK oficial:
   - modelo `claude-opus-5-5`, que no es un «Covered Model»;
   - `inference_geo: "us"`;
   - `effort: "medium"`;
   - instrucciones en caché de prompt (son largas y fijas);
   - respuesta estructurada;
   - `fallbacks: "default"`: si el modelo declina por seguridad, la API reintenta con el modelo que recomienda Anthropic.
4. **Resultado:** se guarda en `session_highlights` como borrador (RLS: solo administración).
   - Lo publicado se copia en `published_content`.
   - El paciente lo lee con `my_session_highlights()`, que solo devuelve lo publicado y lo suyo.
5. **Logs:** nunca contienen las notas ni la respuesta.

## Consentimiento (texto A 2.2), información y oposición

- **Texto:** A 2.2 añade el párrafo «Uso de inteligencia artificial» y la mención en «Destinatarios y encargados». Lo aprobó el cliente y explica que los highlights pueden llegar al paciente.
- **Ajustes al texto aprobado:**
  - Se quitó «marcando la casilla correspondiente al firmar», porque no hay casilla.
  - «indicando que se han elaborado con ayuda de inteligencia artificial» se cambió por «los highlights que reciba se habrán elaborado con ayuda de esta herramienta». El cliente decidió **no** poner una nota de IA en cada highlight, así que el aviso es el general del consentimiento.
- **Sin volver a firmar.** Quien firmó antes ve un aviso con **Leer** (`consent_overview.info_update`).
- **PDF de firmas anteriores:** no se reemiten con la 2.2.
- **Oposición:** la marca la psicóloga en la ficha («Se opone al uso de IA con sus notas») cuando el paciente lo pide por email. El servidor lo comprueba antes de generar.
- **Aviso legal:** el apartado 3.5 explica el uso y el 3.6 lista a Anthropic como encargado.

## Configuración

- **Cuenta:** una organización en `platform.claude.com` a nombre de la consulta. Al aceptar las Commercial Terms se aplica la DPA, con las cláusulas contractuales tipo.
- **Retención:** comprobar en *Settings › Privacy Controls › Data retention* que es la estándar (borrado en 30 días).
- **Clave:** ponerla en **Vercel → Environment Variables** como `ANTHROPIC_API_KEY` (Production y Preview). Sin ella, el botón responde «Los highlights con IA aún no están configurados».

## Riesgos conocidos

Vienen del informe de condiciones públicas de Anthropic del 09/11/2026.

- **El DPA describe las categorías especiales de datos como «None».**
- **Contenido marcado por seguridad:** Anthropic puede conservarlo hasta 2 años. Está informado en el consentimiento.
- **Sin región en la UE ni certificación DPF.** La transferencia se apoya en las cláusulas contractuales tipo.
- **Highlights entregados al paciente sin un aviso de IA en cada uno.** La política de uso de Anthropic pide decir claramente que se ha usado IA cuando el paciente recibe contenido de salud mental (para lo que es de «alto riesgo»). El aviso general del consentimiento podría no bastarles.
- **Más datos por petición:** se envían también las notas de hasta 5 sesiones anteriores.
- **No se ha hecho evaluación de impacto (EIPD).** Fue decisión del cliente.
