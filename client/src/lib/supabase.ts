import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLIC_URL, SUPABASE_PUBLISHABLE_KEY } from "../../../shared/supabasePublic";

// Claves PÚBLICAS de Supabase (pensadas para el navegador; la seguridad real
// la ponen las políticas RLS de supabase/schema.sql). Por defecto las de
// shared/supabasePublic.ts; se pueden sobrescribir con VITE_ o con el
// NEXT_PUBLIC_ que crea la integración Supabase ↔ Vercel.
const env = import.meta.env;
const url: string | undefined =
  env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_PUBLIC_URL;
const anonKey: string | undefined =
  env.VITE_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

// Si faltan las claves, el resto de la web sigue funcionando y el área privada
// muestra un aviso en lugar de romper.
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, anonKey!, {
      // "implicit": los enlaces de invitación que genera el servidor no admiten PKCE.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
    })
  : null;

export type Role = "admin" | "patient";

export type ProcessType = "individual" | "pareja";

export interface Profile {
  id: string;
  role: Role;
  full_name: string;
  email: string;
  phone: string | null;
  active: boolean;
  process_type: ProcessType | null;
  created_at: string;
}

export type Modality = "presencial" | "online";
export type AppointmentStatus = "programada" | "realizada" | "cancelada";

export type SessionType = "primera" | "individual" | "pareja" | "bono";

export interface Appointment {
  id: string;
  patient_id: string;
  starts_at: string;
  duration_minutes: number;
  modality: Modality;
  status: AppointmentStatus;
  session_type: SessionType;
  price_cents: number; // precio congelado al crear la cita (0 si va con bono)
  paid_at: string | null; // null = pendiente de pago
  bono_id: string | null;
}

export interface Bono {
  id: string;
  patient_id: string;
  sessions_total: number;
  price_cents: number;
  paid_at: string | null;
  created_at: string;
}

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  programada: "Programada",
  realizada: "Realizada",
  cancelada: "Cancelada",
};

export const MODALITY_LABEL: Record<Modality, string> = {
  presencial: "Presencial",
  online: "Online",
};
