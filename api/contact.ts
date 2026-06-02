// Función serverless de Vercel (Edge) que recibe el formulario de contacto.
//
// Hace dos cosas con cada lead:
//   1. Envía un email vía Resend (https://resend.com) al buzón de la consulta.
//   2. (Opcional) Lo registra en Google Sheets a través de un webhook de
//      Google Apps Script, para tener un historial ordenado.
//
// Variables de entorno (se configuran en Vercel → Settings → Environment Variables):
//   RESEND_API_KEY        (obligatoria)  Clave de API de Resend.
//   CONTACT_TO_EMAIL      (opcional)     Email donde llegan los avisos.
//                                        Por defecto: a.riverobarrios@gmail.com
//   CONTACT_FROM_EMAIL    (opcional)     Remitente. Por defecto el de pruebas de
//                                        Resend; ideal poner uno de tu dominio.
//   SHEETS_WEBHOOK_URL    (opcional)     URL del Web App de Apps Script.
//   SHEETS_WEBHOOK_SECRET (opcional)     Secreto compartido con el Apps Script.

export const config = { runtime: "edge" };

interface ContactPayload {
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
  sessionType?: string;
  whatToWork?: string;
  previousTherapy?: string;
  wantsProcess?: string;
  // Honeypot anti-spam: campo oculto que un humano nunca rellena.
  website?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function env(key: string): string | undefined {
  // En el runtime Edge de Vercel las variables se exponen en process.env.
  return (globalThis as { process?: { env?: Record<string, string> } }).process
    ?.env?.[key];
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return json({ success: false, message: "Método no permitido" }, 405);
  }

  let data: ContactPayload;
  try {
    data = (await req.json()) as ContactPayload;
  } catch {
    return json({ success: false, message: "Petición inválida" }, 400);
  }

  // Trampa anti-spam: si el campo oculto viene relleno, es un bot.
  // Respondemos "ok" para no darle pistas, pero no enviamos nada.
  if (data.website && data.website.trim() !== "") {
    return json({ success: true });
  }

  if (!data.name || !data.email || !data.message) {
    return json(
      { success: false, message: "Faltan campos obligatorios" },
      400
    );
  }

  const apiKey = env("RESEND_API_KEY");
  if (!apiKey) {
    return json(
      {
        success: false,
        message:
          "El formulario aún no está configurado (falta RESEND_API_KEY).",
      },
      500
    );
  }

  const toEmail = env("CONTACT_TO_EMAIL") || "a.riverobarrios@gmail.com";
  const fromEmail =
    env("CONTACT_FROM_EMAIL") || "Siloz Psicología <onboarding@resend.dev>";

  const na = "No indicado";
  const filas: Array<[string, string]> = [
    ["Nombre completo", data.name || na],
    ["Teléfono", data.phone || na],
    ["Email", data.email || na],
    ["Tipo de sesión", data.sessionType || na],
    ["¿Qué quiere trabajar?", data.whatToWork || na],
    ["Terapia previa", data.previousTherapy || na],
    ["¿Busca proceso terapéutico?", data.wantsProcess || na],
  ];

  const textoPlano =
    filas.map(([k, v]) => `${k}: ${v}`).join("\n") +
    `\n\nMensaje:\n${data.message || na}`;

  const htmlFilas = filas
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap"><strong>${k}</strong></td><td style="padding:4px 0">${escapeHtml(
          v
        )}</td></tr>`
    )
    .join("");

  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px">
      <h2 style="margin:0 0 12px">⭐ Nuevo lead desde la web</h2>
      <table style="border-collapse:collapse;font-size:14px">${htmlFilas}</table>
      <h3 style="margin:20px 0 6px">Mensaje</h3>
      <p style="white-space:pre-wrap;font-size:14px;line-height:1.5">${escapeHtml(
        data.message || na
      )}</p>
    </div>`;

  // 1) Enviar el email vía Resend.
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        reply_to: data.email,
        subject: `⭐ Nuevo lead web: ${data.name} — ${data.phone || data.email}`,
        text: textoPlano,
        html,
      }),
    });

    if (!resp.ok) {
      const detalle = await resp.text();
      console.error("Resend error:", resp.status, detalle);
      return json(
        { success: false, message: "No se pudo enviar el mensaje." },
        502
      );
    }
  } catch (err) {
    console.error("Resend fetch falló:", err);
    return json(
      { success: false, message: "No se pudo enviar el mensaje." },
      502
    );
  }

  // 2) Registrar en Google Sheets (opcional). Si falla, no perdemos el lead:
  //    el email ya se ha enviado, así que solo lo dejamos en los logs.
  const sheetsUrl = env("SHEETS_WEBHOOK_URL");
  if (sheetsUrl) {
    try {
      await fetch(sheetsUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: env("SHEETS_WEBHOOK_SECRET") || "",
          timestamp: new Date().toISOString(),
          name: data.name,
          phone: data.phone || "",
          email: data.email,
          sessionType: data.sessionType || "",
          whatToWork: data.whatToWork || "",
          previousTherapy: data.previousTherapy || "",
          wantsProcess: data.wantsProcess || "",
          message: data.message,
        }),
      });
    } catch (err) {
      console.error("Webhook de Google Sheets falló:", err);
    }
  }

  return json({ success: true });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
