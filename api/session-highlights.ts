// Función serverless de Vercel (Edge): highlights de una sesión con Claude.
//
//   POST /api/session-highlights   Authorization: Bearer <token de sesión de la psicóloga>
//   { "appointmentId": "uuid" }
//
// Solo administración. Comprueba que el paciente no se ha opuesto al uso de IA
// (profiles.ai_opt_out) y que ha firmado el consentimiento; seudonimiza las
// notas (server/highlights.ts) y las envía a la API de Anthropic
// (server/anthropic.ts, con fetch: el SDK no funciona en el runtime Edge) con:
//   · modelo claude-opus-5-5 (no es «Covered Model»: sin retención obligatoria extra),
//   · inference_geo "us" (el texto del consentimiento dice «Estados Unidos»),
//   · instrucciones de Silvia (server/highlightsPrompt.ts), con caché de prompt,
//   · la sesión actual y hasta 5 anteriores (continuidad del proceso),
//   · respuesta estructurada (2-5 highlights para el paciente),
//   · fallbacks "default" por si el modelo declina por seguridad.
// Guarda el resultado en session_highlights como borrador: el paciente solo lo
// ve cuando la psicóloga lo revisa y lo publica.
//
// Nunca se escriben en los logs las notas ni la respuesta.
// Variables: SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY.
import { createMessage } from "../server/anthropic";
import { authenticate, json } from "../server/booking";
import { env } from "../server/email";
import { sha256Hex } from "../server/consent";
import {
  HIGHLIGHTS_MODEL,
  HIGHLIGHTS_SCHEMA,
  HIGHLIGHTS_SYSTEM,
  buildHighlightsInput,
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

  const { data: appt } = await admin.from("appointments").select("id, patient_id, starts_at").eq("id", appointmentId).maybeSingle();
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

  // Hasta 5 sesiones anteriores (no canceladas), de la más reciente a la más antigua.
  const { data: prevAppts } = await admin.from("appointments").select("id")
    .eq("patient_id", appt.patient_id).neq("status", "cancelada").lt("starts_at", appt.starts_at)
    .order("starts_at", { ascending: false }).limit(5);
  const prevIds = (prevAppts ?? []).map((a) => a.id);
  const { data: prevNotes } = prevIds.length
    ? await admin.from("appointment_notes").select("appointment_id, notes, next_notes").in("appointment_id", prevIds)
    : { data: [] };
  const previous = prevIds.map((pid) => {
    const n = (prevNotes ?? []).find((x) => x.appointment_id === pid);
    return { notes: n?.notes ?? "", next: n?.next_notes ?? "" };
  });

  const original = notesForPrompt(notes, nextNotes);
  const prompt = pseudonymize(buildHighlightsInput({ notes, next: nextNotes }, previous), patient);
  const result = await createMessage(apiKey, {
    model: HIGHLIGHTS_MODEL,
    max_tokens: 8000,
    fallbacks: "default",
    inference_geo: "us",
    // Instrucciones largas y fijas: en caché para que repetir cueste menos.
    system: [{ type: "text", text: HIGHLIGHTS_SYSTEM, cache_control: { type: "ephemeral" } }],
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: HIGHLIGHTS_SCHEMA },
    },
    messages: [{ role: "user", content: prompt }],
  }, { betas: ["server-side-fallback-2026-07-01"] });

  if (!result.ok) {
    // Solo el estado: nunca el contenido de la petición.
    console.error("Highlights: fallo de la API de Anthropic", result.status, result.errorType ?? "");
    if (result.status === 401 || result.status === 403) {
      return fail(500, "not_configured", "La clave de Anthropic no es válida. Revísala en Vercel.");
    }
    if (result.status === 429) {
      return fail(429, "rate_limited", "Demasiadas peticiones a la IA. Espera un minuto y vuelve a probar.");
    }
    return fail(502, "api_error", "La IA no ha respondido. Inténtalo de nuevo en un momento.");
  }
  const response = result.message;

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
  if (!content) {
    return fail(422, "empty", "La IA no ha encontrado en estas notas nada que cumpla los criterios para un highlight.");
  }
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
