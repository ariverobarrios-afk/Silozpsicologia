import { WEB3FORMS_ACCESS_KEY } from "@/const";

export interface ContactPayload {
  name: string;
  email: string;
  phone?: string;
  message: string;
  sessionType?: string;
  whatToWork?: string;
  previousTherapy?: string;
  wantsProcess?: string;
}

/** Envía el formulario de contacto al email de Silvia vía Web3Forms (sin servidor). */
export async function sendContact(data: ContactPayload): Promise<void> {
  const na = "No indicado";
  const resumen = [
    `Nombre completo: ${data.name || na}`,
    `Teléfono: ${data.phone || na}`,
    `Email: ${data.email || na}`,
    `Tipo de sesión: ${data.sessionType || na}`,
    `¿Qué quiere trabajar?: ${data.whatToWork || na}`,
    `Terapia previa: ${data.previousTherapy || na}`,
    `¿Busca proceso terapéutico?: ${data.wantsProcess || na}`,
    ``,
    `Mensaje:`,
    `${data.message || na}`,
  ].join("\n");

  const response = await fetch("https://api.web3forms.com/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      access_key: WEB3FORMS_ACCESS_KEY,
      subject: `⭐ Nuevo lead web: ${data.name} — ${data.phone || data.email}`,
      from_name: "Web Siloz Psicología",
      name: data.name,
      email: data.email,
      message: resumen,
    }),
  });

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.message || "No se pudo enviar el mensaje");
  }
}
