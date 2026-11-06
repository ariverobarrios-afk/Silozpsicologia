// Función serverless de Vercel (Edge): el paciente cancela una cita que
// reservó él mismo, con más antelación que el plazo de cancelación.
//
//   POST /api/cancel-booking   Authorization: Bearer <token de sesión del paciente>
//   { "appointmentId": "uuid" }
//
// La comprobación (que la cita sea suya, reservada por él, programada y fuera
// del plazo) y la cancelación + reapertura del hueco se hacen en la base de
// datos (función cancel_booking). Después se avisa por email a la psicóloga.
import { appUrl, authenticate, emailCancelacionPsicologa, json, rpcErrorResponse, type BookingInfo } from "../server/booking";
import { enviarEmail } from "../server/email";

export const config = { runtime: "edge" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if ("response" in auth) return auth.response;

  let body: { appointmentId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ success: false, message: "Petición inválida" }, 400);
  }
  if (!body.appointmentId || !UUID_RE.test(body.appointmentId)) {
    return json({ success: false, code: "not_allowed", message: "No autorizado" }, 403);
  }

  const { data, error } = await auth.admin.rpc("cancel_booking", {
    p_patient_id: auth.patientId,
    p_appointment_id: body.appointmentId,
  });
  if (error) return rpcErrorResponse(error.message, "No se pudo cancelar la cita. Inténtalo de nuevo.");

  const info = data as BookingInfo & { slot_reopened: boolean };
  const sent = await enviarEmail(emailCancelacionPsicologa(info, appUrl(req), info.slot_reopened));

  return json({ success: true, emailSent: sent.ok });
}
