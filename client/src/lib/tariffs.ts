import type { Appointment, Bono, ProcessType, SessionType } from "./supabase";

// Tarifas vigentes de la consulta. El precio se copia en cada cita al crearla,
// así que cambiar estas cifras no altera el historial.
export const SESSION_TYPES: Record<SessionType, { label: string; price_cents: number }> = {
  primera: { label: "Primera sesión", price_cents: 2500 },
  individual: { label: "Sesión individual", price_cents: 5500 },
  pareja: { label: "Sesión de pareja", price_cents: 7000 },
  bono: { label: "Sesión de bono", price_cents: 0 },
};

export const BONO = { sessions: 5, price_cents: 25000, label: "Bono 5 sesiones" };

export const PROCESS_LABEL: Record<ProcessType, string> = {
  individual: "Proceso individual",
  pareja: "Proceso de pareja",
};

export function euros(cents: number): string {
  const value = cents / 100;
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(".", ",")} €`;
}

// Sesiones consumidas de un bono (las canceladas no cuentan).
export function bonoUsed(bono: Bono, appointments: Appointment[]): number {
  return appointments.filter((a) => a.bono_id === bono.id && a.status !== "cancelada").length;
}

export function bonoRemaining(bono: Bono, appointments: Appointment[]): number {
  return bono.sessions_total - bonoUsed(bono, appointments);
}

// Una cita con importe propio (no de bono), no cancelada y sin cobrar.
export function isPendingPayment(a: Appointment): boolean {
  return a.session_type !== "bono" && a.status !== "cancelada" && a.price_cents > 0 && !a.paid_at;
}
