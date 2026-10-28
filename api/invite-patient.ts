// Función serverless de Vercel (Edge): la terapeuta da de alta o invita a un
// paciente.
//
//   · Alta con invitación (hay email e invite = true): crea el usuario en
//     Supabase Auth y le envía un email para que elija su contraseña. El
//     perfil (rol 'patient') lo crea el trigger de la base de datos.
//   · Alta sin invitación (sin email o invite = false): solo crea la ficha
//     del paciente, sin cuenta. Silvia gestiona su agenda igual.
//   · Invitar a una ficha ya existente (profileId): le pone el email y le
//     envía la invitación; el trigger enlaza la cuenta nueva con la ficha
//     (ver supabase/schema.sql), así conserva citas y bonos.
//
// Necesita la clave service_role de Supabase, que NUNCA debe llegar al
// navegador; por eso esto vive aquí y no en el frontend. Antes de hacer nada
// comprobamos que quien llama es una usuaria con rol 'admin'.
//
// Variables de entorno (Vercel → Settings → Environment Variables):
//   SUPABASE_SERVICE_ROLE_KEY  Clave secreta (sb_secret_… o service_role).
//                              ¡No la publiques!
//   SUPABASE_URL               (opcional) Por defecto la de shared/supabasePublic.ts

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLIC_URL } from "../shared/supabasePublic";

export const config = { runtime: "edge" };

interface InvitePayload {
  email?: string;
  fullName?: string;
  phone?: string;
  invite?: boolean;
  profileId?: string;
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
    env("NEXT_PUBLIC_SUPABASE_URL") ||
    SUPABASE_PUBLIC_URL;
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) {
    return json(
      {
        success: false,
        message:
          "El área privada aún no está configurada (falta SUPABASE_SERVICE_ROLE_KEY).",
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
  const profileId = (data.profileId || "").trim();
  if (email && !EMAIL_RE.test(email)) {
    return json({ success: false, message: "El email no es válido." }, 400);
  }

  // 4a) Alta sin invitación: solo la ficha.
  if (!profileId && (!email || data.invite === false)) {
    if (!fullName) {
      return json({ success: false, message: "Indica el nombre." }, 400);
    }
    const { error: insertError } = await admin
      .from("profiles")
      .insert({ role: "patient", full_name: fullName, email, phone: phone || null });
    if (insertError) {
      console.error("Alta fallida:", insertError.message);
      return json({ success: false, message: "No se pudo dar de alta al paciente." }, 502);
    }
    return json({ success: true, invited: false });
  }

  if (!email) {
    return json({ success: false, message: "Indica un email válido." }, 400);
  }

  // 4b) Invitar a una ficha que aún no tiene cuenta: primero se le guarda el
  //     email (el trigger solo enlaza si coincide).
  let metadata: Record<string, string> = { full_name: fullName, phone };
  if (profileId) {
    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id, role, full_name, phone, invited_at")
      .eq("id", profileId)
      .single();
    if (targetError || !target || target.role !== "patient") {
      return json({ success: false, message: "Paciente no encontrado." }, 404);
    }
    if (target.invited_at) {
      return json({ success: false, message: "Este paciente ya tiene la invitación enviada." }, 409);
    }
    const { error: updateError } = await admin
      .from("profiles")
      .update({ email })
      .eq("id", profileId);
    if (updateError) {
      return json({ success: false, message: "No se pudo guardar el email." }, 502);
    }
    metadata = { full_name: target.full_name, phone: target.phone ?? "", profile_id: profileId };
  } else if (!fullName) {
    return json({ success: false, message: "Indica nombre y un email válido." }, 400);
  }

  // 5) Invitar. El enlace del email lleva al paciente a elegir su contraseña
  //    en esta misma web (sirve igual en producción y en versiones de prueba,
  //    siempre que la URL esté permitida en Supabase → Authentication → URL
  //    Configuration → Redirect URLs).
  const origin = new URL(req.url).origin;
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    email,
    {
      data: metadata,
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

  return json({ success: true, invited: true });
}
