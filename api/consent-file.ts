// Función serverless de Vercel (Edge): enlace de descarga del PDF firmado.
//
//   POST /api/consent-file   Authorization: Bearer <token de sesión>
//   { "consentId": "uuid" }
//
// Devuelve una URL firmada de Supabase Storage que caduca en 1 hora. Solo
// para el propio paciente o para la administración (la psicóloga). El bucket
// es privado y no tiene políticas: sin esta función no se puede descargar.
import { appUrl, authenticate, json } from "../server/booking";
import { reissueConsentPdf } from "../server/consentReissue";

export const config = { runtime: "edge" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if ("response" in auth) return auth.response;
  const { admin, patientId: userId } = auth;

  let consentId = "";
  try {
    consentId = String(((await req.json()) as { consentId?: unknown }).consentId ?? "");
  } catch {
    return json({ success: false, message: "Petición inválida" }, 400);
  }
  if (!UUID_RE.test(consentId)) return json({ success: false, message: "Documento no encontrado" }, 404);

  const [{ data: consent }, { data: caller }] = await Promise.all([
    admin.from("consents").select("patient_id, pdf_path, signed_at").eq("id", consentId).maybeSingle(),
    admin.from("profiles").select("role, active").eq("id", userId).maybeSingle(),
  ]);
  const isAdmin = caller?.role === "admin" && caller.active;
  if (!consent || (!isAdmin && consent.patient_id !== userId)) {
    return json({ success: false, message: "Documento no encontrado" }, 404);
  }

  // Si el PDF guardado es de una plantilla anterior (p. ej. con el domicilio),
  // se regenera antes de descargarlo. Si no se puede, no se sirve el antiguo.
  const reissue = await reissueConsentPdf(admin, consentId, { baseUrl: appUrl(req) });
  if (!reissue.ok) {
    console.error("Consentimiento: no se pudo reemitir el PDF", reissue.error);
    return json({ success: false, message: "No se pudo preparar la descarga. Inténtalo más tarde." }, 500);
  }

  const fileName = `Consentimiento-Siloz-Psicologia-${String(consent.signed_at).slice(0, 10)}.pdf`;
  const { data, error } = await admin.storage
    .from("consents")
    .createSignedUrl(consent.pdf_path, 3600, { download: fileName });
  if (error || !data) {
    console.error("Consentimiento: no se pudo firmar la URL", error?.message);
    return json({ success: false, message: "No se pudo preparar la descarga." }, 500);
  }
  return json({ success: true, url: data.signedUrl });
}
