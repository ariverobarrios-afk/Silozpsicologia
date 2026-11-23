// Función serverless de Vercel (Edge): envía los recordatorios de cita (24 h
// antes) y, los domingos, los de pago. Ver docs/recordatorios.md.
//
//   POST /api/reminders   { "token": "uuid" }
//
// La llama la base de datos cada 15 minutos (pg_cron → run_reminders(), en
// supabase/schema.sql), que antes deja un token de un solo uso en
// reminder_tokens. Solo se sigue si ese token existe y se consigue borrar:
// así nadie más puede disparar los envíos y no hace falta ninguna clave nueva.
//
// Variables de entorno: SUPABASE_SERVICE_ROLE_KEY y RESEND_API_KEY (ya
// existen); APP_URL (opcional) para el enlace al área privada.
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLIC_URL } from "../shared/supabasePublic";
import { appUrl, json } from "../server/booking";
import { env } from "../server/email";
import { runReminders } from "../server/reminders";

export const config = { runtime: "edge" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_MINUTES = 10;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ success: false, message: "Método no permitido" }, 405);
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return json({ success: false, message: "Falta SUPABASE_SERVICE_ROLE_KEY." }, 500);

  let token = "";
  try {
    token = String(((await req.json()) as { token?: unknown }).token ?? "");
  } catch {
    // se rechaza abajo
  }
  if (!UUID_RE.test(token)) return json({ success: false, message: "No autorizado" }, 401);

  const admin = createClient(
    env("SUPABASE_URL") || env("VITE_SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL") || SUPABASE_PUBLIC_URL,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { data: used, error } = await admin
    .from("reminder_tokens")
    .delete()
    .eq("token", token)
    .gt("created_at", new Date(Date.now() - TOKEN_MINUTES * 60_000).toISOString())
    .select("token");
  if (error || !used || used.length !== 1) return json({ success: false, message: "No autorizado" }, 401);

  try {
    const summary = await runReminders(admin, new Date(), appUrl(req));
    console.log("Recordatorios:", JSON.stringify(summary));
    return json({ success: true, ...summary });
  } catch (err) {
    console.error("Recordatorios fallidos:", err);
    return json({ success: false, message: "No se pudieron enviar los recordatorios." }, 502);
  }
}
