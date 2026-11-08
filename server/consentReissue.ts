// Reemisión del PDF de una firma ya hecha, con la plantilla y los textos
// vigentes «sin cambios para el paciente» (p. ej. sin el domicilio de la
// responsable). Se usa al descargar (api/consent-file.ts) y en bloque
// (scripts/reissue-consent-pdfs.ts). Es idempotente: si el PDF guardado ya usa
// la plantilla actual, no hace nada.
//
// No cambia nada de la firma: fecha y hora, imagen de la firma, IP, navegador,
// versiones firmadas y huella del texto firmado siguen en `consents` tal cual.
// Sustituye el archivo PDF guardado y anota la reemisión en `consent_reissues`.
import type { SupabaseClient } from "@supabase/supabase-js";
import { DOC_ORDER, placeholderValues, renderTemplate, type ConsentDocument, type ConsentSettings, type ConsentTherapist } from "../shared/consent";
import { CURRENT_PDF_TEMPLATE, buildConsentPdf } from "./consentPdf";
import { sha256Hex } from "./consent";

export type ReissueResult =
  | { ok: true; reissued: boolean; pdfSha256?: string }
  | { ok: false; error: string };

export async function loadLogo(baseUrl: string): Promise<Uint8Array | null> {
  try {
    const r = await fetch(`${baseUrl}/images/logo-reloj-arena.png`, { signal: AbortSignal.timeout(3000) });
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

export async function consentNeedsReissue(admin: SupabaseClient, consentId: string): Promise<boolean | null> {
  const [{ data: c }, { data: r }] = await Promise.all([
    admin.from("consents").select("pdf_template").eq("id", consentId).maybeSingle(),
    admin.from("consent_reissues").select("pdf_template").eq("consent_id", consentId).maybeSingle(),
  ]);
  if (!c) return null;
  return Math.max(c.pdf_template ?? 1, r?.pdf_template ?? 0) < CURRENT_PDF_TEMPLATE;
}

export async function reissueConsentPdf(
  admin: SupabaseClient,
  consentId: string,
  opts: { baseUrl: string; logoPng?: Uint8Array | null; force?: boolean }
): Promise<ReissueResult> {
  const needs = await consentNeedsReissue(admin, consentId);
  if (needs === null) return { ok: false, error: "not_found" };
  if (!needs && !opts.force) return { ok: true, reissued: false };

  const { data: c } = await admin.from("consents").select("*").eq("id", consentId).single();
  const signedIds = [c.privacy_version_id, c.rules_version_id, c.withdrawal_version_id];
  const [{ data: versionsData }, { data: signedData }, { data: settings }, { data: therapist }, sig] = await Promise.all([
    admin.rpc("consent_reissue_versions", { p_consent: consentId }),
    admin.from("document_versions").select("id, doc_type, version").in("id", signedIds),
    admin.from("consent_settings").select("*").eq("id", 1).maybeSingle(),
    admin.from("therapists").select("*").eq("id", c.therapist_id).maybeSingle(),
    admin.storage.from("consents").download(c.signature_png_path),
  ]);
  const docs = DOC_ORDER.map((t) => ((versionsData ?? []) as ConsentDocument[]).find((d) => d.doc_type === t));
  if (!settings || !therapist || docs.some((d) => !d)) return { ok: false, error: "missing_config" };
  if (sig.error || !sig.data) return { ok: false, error: "missing_signature" };

  const values = placeholderValues(settings as ConsentSettings, therapist as ConsentTherapist, {
    nombre: `${c.patient_name} ${c.patient_surname}`, dni: c.patient_id_number,
  });
  const rendered = (docs as ConsentDocument[]).map((d) => ({ ...d, ...renderTemplate(d.body_md, values) }));
  // Un texto que aún pida un dato que ya no existe (p. ej. el domicilio) no se emite.
  if (rendered.some((d) => d.missing.length)) return { ok: false, error: "placeholders" };

  const signed = DOC_ORDER.map((t, i) => ({
    label: "ABC"[i],
    version: ((signedData ?? []) as Array<{ doc_type: string; version: string }>).find((d) => d.doc_type === t)?.version ?? "?",
  }));
  const reissuedAt = new Date();
  const pdf = await buildConsentPdf({
    consentId,
    signedAt: new Date(c.signed_at),
    patient: {
      name: c.patient_name, surname: c.patient_surname, idNumber: c.patient_id_number,
      email: c.patient_email, phone: c.patient_phone ?? "", birthdate: c.patient_birthdate,
    },
    therapist: therapist as ConsentTherapist,
    responsable: { nombre: settings.responsable_nombre, dni: settings.responsable_dni, email: settings.email_contacto },
    documents: rendered.map((d, i) => ({ label: "ABC"[i], title: d.title, version: d.version, text: d.text, checkbox_label: d.checkbox_label })),
    signaturePng: new Uint8Array(await sig.data.arrayBuffer()),
    logoPng: opts.logoPng === undefined ? await loadLogo(opts.baseUrl) : opts.logoPng,
    ip: c.ip,
    userAgent: c.user_agent,
    renderedTextSha256: c.rendered_text_sha256,
    reissue: { reissuedAt, signedVersions: signed },
  });
  const pdfSha256 = await sha256Hex(pdf);

  const up = await admin.storage.from("consents").upload(c.pdf_path, pdf, { contentType: "application/pdf", upsert: true });
  if (up.error) return { ok: false, error: "storage" };
  const { error } = await admin.from("consent_reissues").upsert({
    consent_id: consentId,
    pdf_template: CURRENT_PDF_TEMPLATE,
    pdf_sha256: pdfSha256,
    versions: Object.fromEntries(rendered.map((d) => [d.doc_type, d.version])),
    reissued_at: reissuedAt.toISOString(),
  });
  if (error) return { ok: false, error: "db" };
  return { ok: true, reissued: true, pdfSha256 };
}
