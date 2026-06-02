export interface ContactPayload {
  name: string;
  email: string;
  phone?: string;
  message: string;
  sessionType?: string;
  whatToWork?: string;
  previousTherapy?: string;
  wantsProcess?: string;
  // Honeypot anti-spam (campo oculto). Si viene relleno, es un bot.
  website?: string;
}

/**
 * Envía el formulario de contacto a la función serverless `/api/contact`,
 * que reenvía el lead por email (Resend) y lo registra en Google Sheets.
 */
export async function sendContact(data: ContactPayload): Promise<void> {
  const response = await fetch("/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(data),
  });

  let result: { success?: boolean; message?: string } = {};
  try {
    result = await response.json();
  } catch {
    // Respuesta no-JSON (p. ej. error de plataforma): tratamos por el status.
  }

  if (!response.ok || !result.success) {
    throw new Error(result.message || "No se pudo enviar el mensaje");
  }
}
