// Función serverless de Vercel (Edge): la terapeuta invita a un paciente.
//
// Crea el usuario en Supabase Auth y le envía un email de invitación para que
// elija su contraseña. El perfil (rol 'patient') lo crea el trigger de la base
// de datos (ver supabase/schema.sql).
//
// Necesita la clave service_role de Supabase, que NUNCA debe llegar al
// navegador; por eso esto vive aquí y no en el frontend. Antes de hacer nada
// comprobamos que quien llama es una usuaria con rol 'admin'.
//
// Variables de entorno (Vercel → Settings → Environment Variables):
//   SUPABASE_URL               URL del proyecto (https://xxxx.supabase.co)
//   SUPABASE_SERVICE_ROLE_KEY  Clave secreta service_role (¡no la publiques!)

import { createClient } from "@supabase/supabase-js";

export const config = { runtime: "edge" };

interface InvitePayload {
  email?: string;
  fullName?: string;
  phone?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function env(key: string): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string> } }).process
    ?.env?.[key];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return json({ success: false, message: "Método no permitido" }, 405);
  }

  const supabaseUrl =
    env("SUPABASE_URL") ||
    env("VITE_SUPABASE_URL") ||
    env("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json(
      {
        success: false,
        message:
          "El área privada aún no está configurada (faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY).",
      },
      500
    );
  }

  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) {
    return json({ success: false, message: "No autorizado" }, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) ¿Quién llama? Validamos el token con Supabase.
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    return json({ success: false, message: "Sesión no válida" }, 401);
  }

  // 2) ¿Es la terapeuta?
  const { data: caller, error: callerError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();
  if (callerError || caller?.role !== "admin") {
    return json({ success: false, message: "No autorizado" }, 403);
  }

  // 3) Validar datos del paciente.
  let data: InvitePayload;
  try {
    data = (await req.json()) as InvitePayload;
  } catch {
    return json({ success: false, message: "Petición inválida" }, 400);
  }

  const email = (data.email || "").trim().toLowerCase();
  const fullName = (data.fullName || "").trim();
  const phone = (data.phone || "").trim();
  if (!EMAIL_RE.test(email) || !fullName) {
    return json(
      { success: false, message: "Indica nombre y un email válido." },
      400
    );
  }

  // 4) Invitar. El enlace del email lleva al paciente a elegir su contraseña
  //    en esta misma web (sirve igual en producción y en versiones de prueba,
  //    siempre que la URL esté permitida en Supabase → Authentication → URL
  //    Configuration → Redirect URLs).
  const origin = new URL(req.url).origin;
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    email,
    {
      data: { full_name: fullName, phone },
      redirectTo: `${origin}/acceso/nueva-contrasena`,
    }
  );

  if (inviteError) {
    const yaExiste = /already/i.test(inviteError.message);
    console.error("Invitación fallida:", inviteError.message);
    return json(
      {
        success: false,
        message: yaExiste
          ? "Ya existe una cuenta con ese email."
          : "No se pudo enviar la invitación.",
      },
      yaExiste ? 409 : 502
    );
  }

  return json({ success: true });
}
