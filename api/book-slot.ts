// Función serverless de Vercel (Edge): el paciente reserva un hueco abierto
// de su psicóloga.
//
//   POST /api/book-slot   Authorization: Bearer <token de sesión del paciente>
//   { "slotId": "uuid", "comment": "opcional, máx. 300" }
//
// Todas las comprobaciones y la reserva se hacen en una única transacción en
// la base de datos (función book_slot). Después, ya guardada la cita, se
// avisa por email a la psicóloga (y al paciente, si tiene email). Un fallo del
// email NO deshace la reserva.
//
// Variables de entorno: SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, EMAIL_FROM
// (opcional), APP_URL (opcional, para los enlaces de los emails).
import { appUrl, authenticate, emailConfirmacionPaciente, emailReservaPsicologa, json, rpcErrorResponse, type BookingInfo } from "../server/booking";
import { enviarEmail } from "../server/email";

export const config = { runtime: "edge" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if ("response" in auth) return auth.response;

  let body: { slotId?: string; comment?: string };
  try {
    body = await req.json();
  } catch {
    return json({ success: false, message: "Petición inválida" }, 400);
  }
  if (!body.slotId || !UUID_RE.test(body.slotId)) {
    return json({ success: false, code: "slot_unavailable", message: "Ese hueco ya no está disponible, elige otro." }, 409);
  }
  const comment = typeof body.comment === "string" ? body.comment : null;

  const { data, error } = await auth.admin.rpc("book_slot", {
    p_patient_id: auth.patientId,
    p_slot_id: body.slotId,
    p_comment: comment,
  });
  if (error) return rpcErrorResponse(error.message, "No se pudo reservar la cita. Inténtalo de nuevo.");

  const booking = data as BookingInfo;
  const base = appUrl(req);
  const emails = [enviarEmail(emailReservaPsicologa(booking, base))];
  if (booking.patient_email) emails.push(enviarEmail(emailConfirmacionPaciente(booking, base)));
  const [psicologa] = await Promise.all(emails);

  return json({
    success: true,
    appointmentId: booking.appointment_id,
    startsAt: booking.starts_at,
    emailSent: psicologa.ok,
  });
}
