// Envío de emails transaccionales con Resend (https://resend.com), reutilizable
// por cualquier función de api/.
//
// Variables de entorno (Vercel → Settings → Environment Variables):
//   RESEND_API_KEY  (obligatoria) Clave de API de Resend.
//   EMAIL_FROM      (opcional)    Remitente. Por defecto «Siloz Psicología
//                                 <no-reply@silozpsicologia.com>», el mismo que
//                                 usan las invitaciones (dominio verificado en Resend).
//
// Se llama a la API REST de Resend con fetch (no al SDK `resend`): el SDK
// arrastra módulos que el runtime Edge de Vercel no admite y rompe el despliegue.

export interface EmailInput {
  para: string | string[];
  asunto: string;
  html: string;
  texto: string;
  responderA?: string;
}

export type EmailResult = { ok: true; id?: string } | { ok: false; error: string };

export function env(key: string): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[key];
}

// Nunca lanza: un fallo de email no debe deshacer lo que ya se ha guardado.
// Devuelve el resultado y deja el error en los logs de Vercel.
export async function enviarEmail(input: EmailInput): Promise<EmailResult> {
  const apiKey = env("RESEND_API_KEY");
  if (!apiKey) {
    console.error("Email no enviado: falta RESEND_API_KEY", input.asunto);
    return { ok: false, error: "missing_api_key" };
  }
  const to = (Array.isArray(input.para) ? input.para : [input.para]).filter(Boolean);
  if (to.length === 0) return { ok: false, error: "no_recipient" };
  const from =
    env("EMAIL_FROM") || "Siloz Psicología <no-reply@silozpsicologia.com>";
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: input.asunto,
        html: input.html,
        text: input.texto,
        ...(input.responderA ? { reply_to: input.responderA } : {}),
      }),
    });
    const body = (await resp.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!resp.ok) {
      console.error("Resend rechazó el email:", input.asunto, resp.status, body.message);
      return { ok: false, error: body.message || `HTTP ${resp.status}` };
    }
    return { ok: true, id: body.id };
  } catch (err) {
    console.error("Fallo al enviar el email:", input.asunto, err);
    return { ok: false, error: String(err) };
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Email sencillo: título, tabla de datos, párrafos y un enlace opcional.
export function emailSencillo(opts: {
  titulo: string;
  filas: Array<[string, string]>;
  parrafos?: string[];
  enlace?: { texto: string; url: string };
}): { html: string; texto: string } {
  const filasHtml = opts.filas
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap;vertical-align:top"><strong>${escapeHtml(k)}</strong></td><td style="padding:4px 0;white-space:pre-wrap">${escapeHtml(v)}</td></tr>`
    )
    .join("");
  const parrafosHtml = (opts.parrafos ?? [])
    .map((p) => `<p style="font-size:14px;line-height:1.5;margin:12px 0">${escapeHtml(p)}</p>`)
    .join("");
  const enlaceHtml = opts.enlace
    ? `<p style="margin:20px 0"><a href="${escapeHtml(opts.enlace.url)}" style="color:#2f6b4f">${escapeHtml(opts.enlace.texto)}</a></p>`
    : "";
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px">
<h2 style="margin:0 0 12px">${escapeHtml(opts.titulo)}</h2>
<table style="border-collapse:collapse;font-size:14px">${filasHtml}</table>
${parrafosHtml}${enlaceHtml}</div>`;
  const texto = [
    opts.titulo,
    "",
    ...opts.filas.map(([k, v]) => `${k}: ${v}`),
    ...(opts.parrafos?.length ? ["", ...opts.parrafos] : []),
    ...(opts.enlace ? ["", `${opts.enlace.texto}: ${opts.enlace.url}`] : []),
  ].join("\n");
  return { html, texto };
}
