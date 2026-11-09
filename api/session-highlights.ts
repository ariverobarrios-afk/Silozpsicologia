// Función serverless de Vercel (Edge): highlights de una sesión con Claude.
//
//   POST /api/session-highlights   Authorization: Bearer <token de sesión de la psicóloga>
//   { "appointmentId": "uuid" }
//
// Solo administración. Comprueba que el paciente no se ha opuesto al uso de IA
// (profiles.ai_opt_out) y que ha firmado el consentimiento; seudonimiza las
// notas (server/highlights.ts) y las envía a la API de Anthropic con:
//   · modelo claude-opus-5-5 (no es «Covered Model»: sin retención obligatoria extra),
//   · inference_geo "us" (el texto del consentimiento dice «Estados Unidos»),
//   · respuesta estructurada (temas, hechos, tareas, para retomar),
//   · fallbacks "default" por si el modelo declina por seguridad.
// Guarda el resultado en session_highlights (solo lo ve la psicóloga).
//
// Nunca se escriben en los logs las notas ni la respuesta.
// Variables: SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.
import Anthropic from "@anthropic-ai/sdk";
import { authenticate, json } from "../server/booking";
import { env } from "../server/email";
import { sha256Hex } from "../server/consent";
import {
  HIGHLIGHTS_MODEL,
  HIGHLIGHTS_SCHEMA,
  HIGHLIGHTS_SYSTEM,
  highlightsToText,
  notesForPrompt,
  parseHighlights,
  pseudonymize,
} from "../server/highlights";

export const config = { runtime: "edge" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status: number, code: string, message: string) => json({ success: false, code, message }, status);

export default async function handler(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if ("response" in auth) return auth.response;
  const { admin, patientId: userId } = auth;

  const { data: caller } = await admin.from("profiles").select("role, active").eq("id", userId).maybeSingle();
  if (caller?.role !== "admin" || !caller.active) return fail(403, "not_allowed", "No autorizado.");

  let appointmentId = "";
  try {
    appointmentId = String(((await req.json()) as { appointmentId?: unknown }).appointmentId ?? "");
  } catch {
    return fail(400, "bad_request", "Petición inválida.");
  }
  if (!UUID_RE.test(appointmentId)) return fail(404, "not_found", "Sesión no encontrada.");

  const { data: appt } = await admin.from("appointments").select("id, patient_id").eq("id", appointmentId).maybeSingle();
  if (!appt) return fail(404, "not_found", "Sesión no encontrada.");
  const [{ data: patient }, { data: status }, { data: notesRow }] = await Promise.all([
    admin.from("profiles").select("full_name, email, phone, tax_id, ai_opt_out").eq("id", appt.patient_id).maybeSingle(),
    admin.rpc("consent_status_for", { p_patient: appt.patient_id }),
    admin.from("appointment_notes").select("notes, next_notes").eq("appointment_id", appointmentId).maybeSingle(),
  ]);
  if (!patient) return fail(404, "not_found", "Paciente no encontrado.");
  if (patient.ai_opt_out) return fail(403, "opt_out", "Este paciente se ha opuesto al uso de IA con sus notas.");
  if (status === "pendiente") {
    return fail(409, "no_consent", "El paciente todavía no ha firmado el consentimiento, que le informa del uso de IA.");
  }
  const notes = notesRow?.notes?.trim() ?? "";
  const nextNotes = notesRow?.next_notes?.trim() ?? "";
  if (!notes && !nextNotes) return fail(400, "no_notes", "Escribe primero las notas de la sesión.");

  const apiKey = env("ANTHROPIC_API_KEY");
  if (!apiKey) return fail(500, "not_configured", "Los highlights con IA aún no están configurados (falta ANTHROPIC_API_KEY en Vercel).");

  const original = notesForPrompt(notes, nextNotes);
  const prompt = pseudonymize(original, patient);
  const client = new Anthropic({ apiKey });

  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model: HIGHLIGHTS_MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      inference_geo: "us",
      system: HIGHLIGHTS_SYSTEM,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: HIGHLIGHTS_SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    // Solo el estado: nunca el contenido de la petición.
    const status = err instanceof Anthropic.APIError ? err.status : "red";
    console.error("Highlights: fallo de la API de Anthropic", status);
    if (err instanceof Anthropic.AuthenticationError) {
      return fail(500, "not_configured", "La clave de Anthropic no es válida. Revísala en Vercel.");
    }
    if (err instanceof Anthropic.RateLimitError) {
      return fail(429, "rate_limited", "Demasiadas peticiones a la IA. Espera un minuto y vuelve a probar.");
    }
    return fail(502, "api_error", "La IA no ha respondido. Inténtalo de nuevo en un momento.");
  }

  if (response.stop_reason === "refusal") {
    console.error("Highlights: el modelo declinó", response.stop_details?.category ?? "sin categoría");
    return fail(422, "refusal", "La IA no ha podido resumir estas notas. Puedes escribir los puntos clave a mano.");
  }
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = response.stop_reason === "max_tokens" ? null : parseHighlights(text);
  if (!parsed) {
    console.error("Highlights: respuesta no válida", response.stop_reason);
    return fail(502, "bad_output", "La respuesta de la IA no tenía el formato esperado. Inténtalo de nuevo.");
  }

  const content = highlightsToText(parsed);
  const row = {
    appointment_id: appointmentId,
    content,
    model: response.model,
    notes_sha256: await sha256Hex(original),
    generated_at: new Date().toISOString(),
    edited_at: null,
  };
  const { error } = await admin.from("session_highlights").upsert(row);
  if (error) {
    console.error("Highlights: no se pudo guardar", error.code);
    return fail(500, "db", "No se pudo guardar el resumen. Inténtalo de nuevo.");
  }
  return json({ success: true, ...row });
}
