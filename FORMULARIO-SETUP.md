# Configurar el formulario de contacto

El formulario envía cada solicitud a una función serverless de Vercel
(`api/contact.ts`) que hace dos cosas:

1. **Email** → te avisa por correo de cada nuevo lead (vía **Resend**).
2. **Google Sheets** → apunta el lead en una hoja de cálculo (historial).

Mientras no configures Resend, el formulario devolverá un error al enviar.
Google Sheets es **opcional**: si no lo configuras, los emails siguen llegando.

---

## Paso 1 — Email con Resend (obligatorio)

1. Crea una cuenta gratis en https://resend.com (3.000 emails/mes gratis).
2. Ve a **API Keys** → **Create API Key** y copia la clave (empieza por `re_`).
3. En Vercel: proyecto **silozpsicologia** → **Settings** → **Environment
   Variables** y añade:

   | Name                 | Value                                            |
   | -------------------- | ------------------------------------------------ |
   | `RESEND_API_KEY`     | la clave `re_...` que acabas de copiar           |
   | `CONTACT_TO_EMAIL`   | `a.riverobarrios@gmail.com` (a dónde llegan)     |

   > De momento los correos saldrán desde la dirección de pruebas de Resend
   > (`onboarding@resend.dev`). Con ella **solo se puede enviar al email de tu
   > propia cuenta de Resend**, así que regístrate en Resend con
   > `a.riverobarrios@gmail.com` para que funcione sin más.

4. **Redeploy** del proyecto en Vercel para que tome las variables.

### (Recomendado) Enviar desde tu dominio
Para que el correo llegue como `contacto@silozpsicologia.com` y no caiga en
spam:

1. En Resend → **Domains** → **Add Domain** → `silozpsicologia.com`.
2. Añade los registros DNS (DKIM/SPF) que te indique donde gestionas el dominio.
3. Cuando aparezca como *Verified*, añade en Vercel la variable:

   | Name                 | Value                                              |
   | -------------------- | -------------------------------------------------- |
   | `CONTACT_FROM_EMAIL` | `Siloz Psicología <contacto@silozpsicologia.com>`  |

---

## Paso 2 — Guardar en Google Sheets (opcional)

Usamos **Google Apps Script** (sin cuentas de Google Cloud ni claves complejas).

1. Crea una hoja nueva en https://sheets.google.com (p. ej. "Leads web Siloz").
2. Menú **Extensiones** → **Apps Script**.
3. Borra lo que haya y pega este código (cambia `TU_SECRETO` por una palabra
   secreta tuya):

   ```javascript
   const SECRET = "TU_SECRETO";

   function doPost(e) {
     try {
       const data = JSON.parse(e.postData.contents);
       if (SECRET && data.secret !== SECRET) {
         return ContentService.createTextOutput("forbidden");
       }
       const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
       if (sheet.getLastRow() === 0) {
         sheet.appendRow([
           "Fecha", "Nombre", "Teléfono", "Email", "Tipo de sesión",
           "Qué trabajar", "Terapia previa", "Busca proceso", "Mensaje",
         ]);
       }
       sheet.appendRow([
         data.timestamp || new Date(),
         data.name || "",
         data.phone || "",
         data.email || "",
         data.sessionType || "",
         data.whatToWork || "",
         data.previousTherapy || "",
         data.wantsProcess || "",
         data.message || "",
       ]);
       return ContentService.createTextOutput("ok");
     } catch (err) {
       return ContentService.createTextOutput("error: " + err);
     }
   }
   ```

4. **Implementar** (Deploy) → **Nueva implementación** → tipo **Aplicación web**:
   - *Ejecutar como*: **Yo**
   - *Quién tiene acceso*: **Cualquier usuario**
   - Copia la **URL del Web App** que termina en `/exec`.
5. En Vercel añade dos variables más y haz **Redeploy**:

   | Name                    | Value                                  |
   | ----------------------- | -------------------------------------- |
   | `SHEETS_WEBHOOK_URL`    | la URL `.../exec` del Apps Script      |
   | `SHEETS_WEBHOOK_SECRET` | el mismo `TU_SECRETO` del script       |

---

## Probarlo

Tras el redeploy, entra en la web, envía el formulario y comprueba que:
- llega el email a `a.riverobarrios@gmail.com`, y
- (si configuraste el paso 2) aparece una fila nueva en la hoja.

> Consejo: revisa la carpeta de spam la primera vez. Verificar el dominio en
> Resend (paso 1, recomendado) evita que acabe ahí.
