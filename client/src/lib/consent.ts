import { supabase } from "./supabase";
import type { ConsentDocument, ConsentSettings, ConsentTherapist } from "../../../shared/consent";

export type ConsentStatus = "pendiente" | "actualizacion" | "firmado";

export interface ConsentOverview {
  status: ConsentStatus;
  block_booking: boolean;
  consents: Array<{ id: string; signed_at: string; versions: { privacy: string; rules: string; withdrawal: string } }>;
}

export interface ConsentContext {
  status: ConsentStatus;
  ready: boolean;
  documents: ConsentDocument[];
  settings: ConsentSettings | null;
  therapist: ConsentTherapist | null;
  patient: { full_name: string; email: string; phone: string | null; tax_id: string | null; birth_date: string | null };
}

export const CONSENT_TITLE = "Consentimiento informado y normas del servicio";

export const CONSENT_STATUS_LABEL: Record<ConsentStatus, string> = {
  pendiente: "Pendiente de firma",
  actualizacion: "Pendiente de firma (actualización)",
  firmado: "Firmado",
};

export async function fetchConsentOverview(patientId: string): Promise<ConsentOverview | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("consent_overview", { p_patient: patientId });
  if (error) return null;
  return data as ConsentOverview;
}

export async function fetchConsentContext(): Promise<ConsentContext | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("consent_context");
  if (error) return null;
  return data as ConsentContext;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  return { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` };
}

// Pide al servidor un enlace de descarga (caduca en 1 hora) y descarga el PDF.
export async function downloadConsentPdf(consentId: string): Promise<boolean> {
  try {
    const resp = await fetch("/api/consent-file", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ consentId }),
    });
    const body = (await resp.json().catch(() => ({}))) as { success?: boolean; url?: string };
    if (!resp.ok || !body.url) return false;
    window.location.assign(body.url);
    return true;
  } catch {
    return false;
  }
}

export interface SignResponse {
  success: boolean;
  code?: string;
  message?: string;
  consentId?: string;
  email?: string;
  emailSent?: boolean;
  fields?: string[];
}

export async function submitConsent(payload: unknown): Promise<SignResponse> {
  try {
    const resp = await fetch("/api/consent", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify(payload),
    });
    const body = (await resp.json().catch(() => ({}))) as SignResponse;
    if (!resp.ok) return { ...body, success: false, message: body.message || "No se pudo firmar. Inténtalo de nuevo." };
    return body;
  } catch {
    return { success: false, message: "No hay conexión. Comprueba tu internet e inténtalo de nuevo." };
  }
}
