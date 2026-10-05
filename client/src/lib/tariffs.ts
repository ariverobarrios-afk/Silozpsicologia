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

export interface DebtItem {
  kind: "bono" | "cita";
  id: string;
  cents: number;
  date: string; // venta del bono o fecha de la cita
}

// Lo que un paciente debe ya: bonos sin pagar y sesiones pasadas sin cobrar.
export function overdueDebts(
  patientId: string,
  appointments: Appointment[],
  bonos: Bono[],
  now = new Date()
): DebtItem[] {
  return [
    ...bonos
      .filter((b) => b.patient_id === patientId && !b.paid_at)
      .map((b) => ({ kind: "bono" as const, id: b.id, cents: b.price_cents, date: b.created_at })),
    ...appointments
      .filter((a) => a.patient_id === patientId && isPendingPayment(a) && new Date(a.starts_at) <= now)
      .map((a) => ({ kind: "cita" as const, id: a.id, cents: a.price_cents, date: a.starts_at })),
  ];
}

// Motivo por el que una cita debe verse en rojo: solo si ella misma está sin pagar.
export function paymentAlert(
  a: Appointment,
  appointments: Appointment[],
  bonos: Bono[],
  now = new Date()
): string | null {
  if (a.status === "cancelada") return null;
  if (isPendingPayment(a)) return "Sesión pendiente de pago";
  if (a.bono_id && bonos.some((b) => b.id === a.bono_id && !b.paid_at)) return "Bono pendiente de pago";
  // Una cita ya pagada se ve normal aunque el paciente deba otra cosa: esas
  // deudas se avisan al abrir la cita y en la pestaña «Pagos».
  return null;
}

// Qué sesión del bono es esta cita (1, 2, …) por orden de fecha; null si no va con bono.
export function bonoSessionNumber(a: Appointment, appointments: Appointment[]): number | null {
  if (!a.bono_id || a.status === "cancelada") return null;
  const ordered = appointments
    .filter((x) => x.bono_id === a.bono_id && x.status !== "cancelada")
    .sort((x, y) => x.starts_at.localeCompare(y.starts_at));
  const i = ordered.findIndex((x) => x.id === a.id);
  return i === -1 ? null : i + 1;
}
