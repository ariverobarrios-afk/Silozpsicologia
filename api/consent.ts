// Función serverless de Vercel (Edge): el paciente firma el consentimiento.
//
//   POST /api/consent   Authorization: Bearer <token de sesión del paciente>
//   { name, surname, idNumber, phone, birthdate, accepted{privacy,rules,withdrawal},
//     versionIds{privacy,rules,withdrawal}, signature: "data:image/png;base64,…", turnstileToken? }
//
// 1. Identifica al paciente por su sesión (el email sale de su cuenta, no del formulario).
// 2. Limita a 5 intentos por hora por paciente o IP; Turnstile si está configurado.
// 3. Valida en el servidor: datos, DNI/NIE con letra, mayoría de edad, las tres
//    casillas, firma con trazo y que los textos firmados sean los vigentes.
// 4. Vuelve a renderizar los textos aquí (no se fía del navegador) y calcula su SHA-256.
// 5. Genera el PDF con evidencias, lo sube con la firma al bucket privado
//    «consents» y guarda la fila en `consents`.
// 6. Actualiza la ficha del paciente con los datos introducidos.
// 7. Envía el PDF por email al paciente y a la psicóloga (un fallo del email
//    no deshace la firma).
//
// Nunca se escriben en los logs datos del paciente (ni DNI ni nombre).
// Variables: SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM (opcional),
// TURNSTILE_SECRET_KEY (opcional), APP_URL (opcional).
import { appUrl, authenticate, json } from "../server/booking";
import { enviarEmail, emailSencillo } from "../server/email";
import { CURRENT_PDF_TEMPLATE, buildConsentPdf, madridDateTime } from "../server/consentPdf";
import { loadLogo } from "../server/consentReissue";
import {
  CONSENT_FROM,
  RATE_LIMIT_PER_HOUR,
  bytesToBase64,
  clientIp,
  decodeSignatureDataUrl,
  parseBody,
  sha256Hex,
  signatureHasInk,
  verifyTurnstile,
} from "../server/consent";
import {
  DOC_ORDER,
  ageOn,
  canonicalText,
  formErrors,
  madridToday,
  missingFields,
  normalizeIdNumber,
  placeholderValues,
  renderTemplate,
  REQUIRED_LABELS,
  type ConsentDocument,
  type ConsentSettings,
  type ConsentTherapist,
} from "../shared/consent";

export const config = { runtime: "edge" };

const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  json({ success: false, code, message, ...extra }, status);

export default async function handler(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if ("response" in auth) return auth.response;
  const { admin, patientId } = auth;

  const { data: profile } = await admin
    .from("profiles")
    .select("id, role, active, email, psychologist_id")
    .eq("id", patientId)
    .maybeSingle();
  if (!profile || profile.role !== "patient" || !profile.active) {
    return fail(403, "not_allowed", "Esta cuenta no puede firmar el consentimiento.");
  }
  if (!profile.email) return fail(400, "no_email", "Tu cuenta no tiene email. Contacta con tu psicóloga.");

  // ── Anti-abuso ──
  const ip = clientIp(req);
  const ipHash = ip ? await sha256Hex(`consent:${ip}`) : null;
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin
    .from("consent_attempts")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since)
    .or(ipHash ? `user_id.eq.${patientId},ip_hash.eq.${ipHash}` : `user_id.eq.${patientId}`);
  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
    return fail(429, "rate_limited", "Has hecho demasiados intentos. Espera un rato y vuelve a probar.");
  }
  await admin.from("consent_attempts").insert({ user_id: patientId, ip_hash: ipHash });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail(400, "bad_request", "Petición inválida.");
  }
  const body = parseBody(raw);
  if (!body) return fail(400, "bad_request", "Petición inválida.");
  if (!(await verifyTurnstile(body.turnstileToken, ip))) {
    return fail(400, "turnstile", "No hemos podido comprobar que no eres un robot. Recarga la página.");
  }

  // ── Datos del paciente ──
  const today = madridToday();
  const form = { name: body.name, surname: body.surname, idNumber: body.idNumber, email: profile.email, phone: body.phone, birthdate: body.birthdate };
  const missing = missingFields(form);
  if (missing.length) {
    return fail(400, "missing_fields", `Faltan datos: ${missing.map((k) => REQUIRED_LABELS[k]).join(", ")}.`, { fields: missing });
  }
  const errors = formErrors(form, today);
  if (Object.keys(errors).length) {
    const minor = body.birthdate && ageOn(body.birthdate, today) < 18;
    return fail(400, minor ? "minor" : "invalid_fields", Object.values(errors)[0]!, { errors });
  }
  if (!body.accepted.privacy || !body.accepted.rules || !body.accepted.withdrawal) {
    return fail(400, "not_accepted", "Tienes que marcar las tres casillas de aceptación.");
  }
  const signaturePng = decodeSignatureDataUrl(body.signature);
  if (!signaturePng || !(await signatureHasInk(signaturePng))) {
    return fail(400, "no_signature", "Falta la firma: firma en el recuadro con el dedo o el ratón.");
  }

  // ── Textos vigentes y datos para los placeholders ──
  const [{ data: docsData }, { data: settings }, { data: therapist }] = await Promise.all([
    admin.rpc("current_document_versions"),
    admin.from("consent_settings").select("*").eq("id", 1).maybeSingle(),
    admin.from("therapists").select("*").eq("profile_id", profile.psychologist_id).eq("active", true).maybeSingle(),
  ]);
  const docs = DOC_ORDER.map((t) => ((docsData ?? []) as ConsentDocument[]).find((d) => d.doc_type === t));
  if (!settings || !therapist || docs.some((d) => !d)) {
    console.error("Consentimiento: falta configuración (ajustes, profesional o textos)");
    return fail(500, "not_configured", "El consentimiento todavía no está disponible. Contacta con tu psicóloga.");
  }
  const current = docs as ConsentDocument[];
  if (current.some((d) => body.versionIds[d.doc_type] !== d.id)) {
    return fail(409, "documents_changed", "Los documentos se han actualizado mientras los leías. Recarga la página para ver la versión vigente.");
  }

  const idNumber = normalizeIdNumber(body.idNumber);
  const values = placeholderValues(settings as ConsentSettings, therapist as ConsentTherapist, {
    nombre: `${body.name} ${body.surname}`, dni: idNumber,
  });
  const rendered = current.map((d) => ({ ...d, ...renderTemplate(d.body_md, values) }));
  if (rendered.some((d) => d.missing.length)) {
    console.error("Consentimiento: placeholders sin valor", rendered.flatMap((d) => d.missing));
    return fail(500, "not_configured", "El consentimiento todavía no está disponible. Contacta con tu psicóloga.");
  }
  const signedText = canonicalText(rendered.map((d) => ({ title: d.title, version: d.version, text: d.text, checkbox_label: d.checkbox_label })));
  const renderedTextSha256 = await sha256Hex(signedText);

  // ── PDF ──
  const consentId = crypto.randomUUID();
  const signedAt = new Date();
  const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null;
  const base = appUrl(req);
  const logoPng = await loadLogo(base);
  const s = settings as ConsentSettings;
  const t = therapist as ConsentTherapist & { id: string; slug: string; email: string };
  const pdf = await buildConsentPdf({
    consentId,
    signedAt,
    patient: { name: body.name, surname: body.surname, idNumber, email: profile.email, phone: body.phone, birthdate: body.birthdate },
    therapist: t,
    responsable: { nombre: s.responsable_nombre, dni: s.responsable_dni, email: s.email_contacto },
    documents: rendered.map((d, i) => ({ label: "ABC"[i], title: d.title, version: d.version, text: d.text, checkbox_label: d.checkbox_label })),
    signaturePng,
    logoPng,
    ip,
    userAgent,
    renderedTextSha256,
  });
  const pdfSha256 = await sha256Hex(pdf);

  // ── Guardar ──
  const year = signedAt.getUTCFullYear();
  const pdfPath = `${t.slug}/${year}/${consentId}.pdf`;
  const pngPath = `${t.slug}/${year}/${consentId}.png`;
  const bucket = admin.storage.from("consents");
  const up1 = await bucket.upload(pngPath, signaturePng, { contentType: "image/png", upsert: false });
  const up2 = up1.error ? up1 : await bucket.upload(pdfPath, pdf, { contentType: "application/pdf", upsert: false });
  if (up1.error || up2.error) {
    console.error("Consentimiento: fallo al subir archivos", (up1.error ?? up2.error)?.message);
    await bucket.remove([pngPath, pdfPath]);
    return fail(500, "storage", "No se pudo guardar la firma. Inténtalo de nuevo.");
  }
  const { error: insertError } = await admin.from("consents").insert({
    id: consentId,
    patient_id: patientId,
    therapist_id: t.id,
    patient_name: body.name,
    patient_surname: body.surname,
    patient_id_number: idNumber,
    patient_email: profile.email,
    patient_phone: body.phone || null,
    patient_birthdate: body.birthdate,
    is_minor: false,
    privacy_version_id: body.versionIds.privacy,
    rules_version_id: body.versionIds.rules,
    withdrawal_version_id: body.versionIds.withdrawal,
    accepted_privacy: true,
    accepted_rules: true,
    accepted_withdrawal_start: true,
    signature_png_path: pngPath,
    pdf_path: pdfPath,
    pdf_sha256: pdfSha256,
    rendered_text_sha256: renderedTextSha256,
    signed_at: signedAt.toISOString(),
    ip,
    user_agent: userAgent,
    pdf_template: CURRENT_PDF_TEMPLATE,
  });
  if (insertError) {
    console.error("Consentimiento: fallo al guardar el registro", insertError.code);
    await bucket.remove([pngPath, pdfPath]);
    return fail(500, "db", "No se pudo guardar la firma. Inténtalo de nuevo.");
  }

  // Copia literal del texto firmado (constancia, aunque cambien los ajustes).
  const { error: snapshotError } = await admin.from("consent_text_snapshots").insert({ consent_id: consentId, rendered_text: signedText });
  if (snapshotError) console.error("Consentimiento: no se guardó la copia del texto", snapshotError.code);

  // Escritura de vuelta en la ficha (un fallo aquí no anula la firma).
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      full_name: `${body.name} ${body.surname}`.trim(),
      tax_id: idNumber,
      birth_date: body.birthdate,
      ...(body.phone ? { phone: body.phone } : {}),
    })
    .eq("id", patientId);
  if (profileError) console.error("Consentimiento: no se actualizó la ficha", profileError.code);

  // ── Emails con el PDF ──
  const fullName = `${body.name} ${body.surname}`;
  const adjuntos = [{ nombre: `Consentimiento-Siloz-Psicologia-${signedAt.toISOString().slice(0, 10)}.pdf`, contenidoBase64: bytesToBase64(pdf) }];
  const when = madridDateTime(signedAt);
  const paciente = emailSencillo({
    titulo: "Tu copia firmada de los documentos de Siloz Psicología",
    filas: [["Firmado", when], ["Documentos", "Protección de datos, normas del servicio y desistimiento"], ["ID", consentId]],
    parrafos: [
      `Hola, ${body.name}. Te adjuntamos el PDF con los documentos que acabas de firmar.`,
      "También lo tienes siempre disponible en tu área privada, en la pestaña «Documentos».",
    ],
    enlace: { texto: "Ir a mi área", url: `${base}/mi-area#documentos` },
  });
  const psicologa = emailSencillo({
    titulo: `Consentimiento firmado: ${fullName}`,
    filas: [["Paciente", fullName], ["Firmado", when], ["ID", consentId]],
    parrafos: ["Se adjunta el PDF firmado. También está en la ficha del paciente."],
  });
  const [emailPaciente] = await Promise.all([
    enviarEmail({ para: profile.email, asunto: "Tu copia firmada de los documentos de Siloz Psicología", ...paciente, adjuntos, de: CONSENT_FROM(), responderA: s.email_contacto }),
    enviarEmail({ para: t.email, asunto: `Consentimiento firmado: ${fullName}`, ...psicologa, adjuntos, de: CONSENT_FROM(), responderA: s.email_contacto }),
  ]);

  return json({ success: true, consentId, signedAt: signedAt.toISOString(), email: profile.email, emailSent: emailPaciente.ok });
}
