// Piezas comunes de api/book-slot.ts y api/cancel-booking.ts.
//
// Las reglas (hueco abierto y de su psicóloga, ventana, una cita por semana,
// plazo de cancelación, toma atómica del hueco) viven en la base de datos:
// funciones book_slot y cancel_booking de supabase/schema.sql. Aquí solo se
// identifica al paciente por su sesión, se llama a la función y, una vez
// guardado, se envían los emails.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLIC_URL } from "../shared/supabasePublic";
import { capitalize, madridDate, madridLongDay, madridTime, madridWeekday } from "../shared/madrid";
import { emailSencillo, env } from "./email";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export type Authed = { admin: SupabaseClient; patientId: string } | { response: Response };

// Comprueba el token de sesión y devuelve el id del usuario que llama.
export async function authenticate(req: Request): Promise<Authed> {
  if (req.method !== "POST") {
    return { response: json({ success: false, message: "Método no permitido" }, 405) };
  }
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) {
    return {
      response: json(
        { success: false, message: "El área privada aún no está configurada (falta SUPABASE_SERVICE_ROLE_KEY)." },
        500
      ),
    };
  }
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { response: json({ success: false, message: "No autorizado" }, 401) };

  const admin = createClient(
    env("SUPABASE_URL") || env("VITE_SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL") || SUPABASE_PUBLIC_URL,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    return { response: json({ success: false, message: "Sesión no válida" }, 401) };
  }
  return { admin, patientId: data.user.id };
}

// Errores de book_slot / cancel_booking → respuesta para el paciente.
const ERRORS: Record<string, { status: number; code: string; message: string }> = {
  SLOT_UNAVAILABLE: { status: 409, code: "slot_unavailable", message: "Ese hueco ya no está disponible, elige otro." },
  WEEK_LIMIT: {
    status: 409,
    code: "week_limit",
    message: "Ya tienes una cita esta semana. Si necesitas otra, ponte en contacto con tu psicóloga.",
  },
  CANCEL_TOO_LATE: {
    status: 409,
    code: "too_late",
    message: "Ya no se puede cancelar esta cita desde aquí. Avisa directamente a tu psicóloga.",
  },
  NOT_CANCELLABLE: { status: 409, code: "not_cancellable", message: "Esta cita ya no se puede cancelar." },
  COMMENT_TOO_LONG: { status: 400, code: "comment_too_long", message: "El comentario es demasiado largo (máx. 300 caracteres)." },
  NOT_ALLOWED: { status: 403, code: "not_allowed", message: "No autorizado" },
};

export function rpcErrorResponse(message: string, fallback: string): Response {
  const key = Object.keys(ERRORS).find((k) => message.includes(k));
  if (key) {
    const e = ERRORS[key];
    return json({ success: false, code: e.code, message: e.message }, e.status);
  }
  console.error("Error inesperado de la base de datos:", message);
  return json({ success: false, code: "error", message: fallback }, 502);
}

export function appUrl(req: Request): string {
  return (env("APP_URL") || new URL(req.url).origin).replace(/\/$/, "");
}

export interface BookingInfo {
  appointment_id: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  comment?: string | null;
  patient_name: string;
  patient_email: string;
  psychologist_name: string;
  psychologist_email: string;
  psychologist_phone?: string | null;
  cancel_limit_hours?: number;
}

// «lunes 16/11/2026 a las 10:00»
export function cuando(iso: string): string {
  return `${madridWeekday(iso)} ${madridDate(iso)} a las ${madridTime(iso)}`;
}

function filasCita(b: BookingInfo): Array<[string, string]> {
  return [
    ["Paciente", b.patient_name || b.patient_email || "Paciente"],
    ["Fecha", capitalize(madridLongDay(b.starts_at, true))],
    ["Hora", `${madridTime(b.starts_at)} – ${madridTime(b.ends_at)}`],
    ["Duración", `${b.duration_minutes} min`],
  ];
}

export function emailReservaPsicologa(b: BookingInfo, baseUrl: string) {
  const nombre = b.patient_name || b.patient_email || "Paciente";
  const { html, texto } = emailSencillo({
    titulo: "Nueva cita reservada por un paciente",
    filas: [...filasCita(b), ...(b.comment ? [["Comentario", b.comment] as [string, string]] : [])],
    parrafos: ["La cita ya está en tu agenda, como cualquier otra."],
    enlace: { texto: "Ver la cita en la agenda", url: `${baseUrl}/panel#cita/${b.appointment_id}` },
  });
  return {
    para: b.psychologist_email,
    asunto: `Nueva cita reservada: ${nombre} — ${cuando(b.starts_at)}`,
    html,
    texto,
    responderA: b.patient_email || undefined,
  };
}

export function emailCancelacionPsicologa(b: BookingInfo, baseUrl: string, reabierto: boolean) {
  const nombre = b.patient_name || b.patient_email || "Paciente";
  const { html, texto } = emailSencillo({
    titulo: "Cita cancelada por el paciente",
    filas: filasCita(b),
    parrafos: [
      reabierto
        ? "El hueco vuelve a estar abierto para que otro paciente pueda reservarlo."
        : "El hueco no se ha reabierto porque esa hora ya está ocupada en tu agenda.",
    ],
    enlace: { texto: "Ver la cita en la agenda", url: `${baseUrl}/panel#cita/${b.appointment_id}` },
  });
  return {
    para: b.psychologist_email,
    asunto: `Cita cancelada por el paciente: ${nombre} — ${cuando(b.starts_at)}`,
    html,
    texto,
    responderA: b.patient_email || undefined,
  };
}

export function emailConfirmacionPaciente(b: BookingInfo, baseUrl: string) {
  const horas = b.cancel_limit_hours ?? 24;
  const psicologa = b.psychologist_name || "tu psicóloga";
  const nombre = (b.patient_name || "").split(" ")[0];
  const { html, texto } = emailSencillo({
    titulo: "Tu cita está confirmada",
    filas: [
      ["Fecha", capitalize(madridLongDay(b.starts_at, true))],
      ["Hora", `${madridTime(b.starts_at)} – ${madridTime(b.ends_at)} (hora de Madrid)`],
      ["Psicóloga", psicologa],
    ],
    parrafos: [
      `${nombre ? `Hola, ${nombre}. ` : ""}Has reservado tu cita con ${psicologa} y te la confirmamos: no tienes que hacer nada más.`,
      `Si no puedes venir, cancélala desde tu área privada hasta ${horas} horas antes. Pasado ese plazo, avisa directamente a ${psicologa}.`,
    ],
    enlace: { texto: "Ver mis citas", url: `${baseUrl}/mi-area` },
  });
  return {
    para: b.patient_email,
    asunto: `Cita confirmada: ${cuando(b.starts_at)}`,
    html,
    texto,
    responderA: b.psychologist_email || undefined,
  };
}
