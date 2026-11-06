import type { BookingSettings } from "./supabase";
import { supabase } from "./supabase";

// Valores por defecto si no se pudieran leer de booking_settings (los reales
// los decide la base de datos, que es quien valida).
export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  min_advance_hours: 24,
  max_window_days: 42,
  cancel_limit_hours: 24,
};

// Contacto de la consulta (el de la web pública) por si la ficha de la
// psicóloga no tiene email o teléfono.
export const FALLBACK_CONTACT = { email: "silozpsicologia@gmail.com", phone: "+34 620 450 696" };

export interface PsychologistContact {
  full_name: string;
  email: string;
  phone: string | null;
}

export { canCancelOnline } from "../../../shared/bookingRules";

export type BookingApiResult =
  | { success: true; appointmentId?: string }
  | { success: false; code: string; message: string };

async function callApi(path: string, payload: unknown): Promise<BookingApiResult> {
  try {
    const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
    const resp = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}` },
      body: JSON.stringify(payload),
    });
    const body = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (resp.ok && body.success) return { success: true, appointmentId: body.appointmentId as string | undefined };
    return {
      success: false,
      code: (body.code as string) || "error",
      message: (body.message as string) || "No se pudo completar. Inténtalo de nuevo.",
    };
  } catch {
    return { success: false, code: "network", message: "No hay conexión. Inténtalo de nuevo." };
  }
}

export const bookSlot = (slotId: string, comment: string) => callApi("/api/book-slot", { slotId, comment });
export const cancelBooking = (appointmentId: string) => callApi("/api/cancel-booking", { appointmentId });
