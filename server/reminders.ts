// Recordatorios por email al paciente (docs/recordatorios.md):
//
//   · de cita: 24 horas antes de cada cita programada;
//   · de pago: los domingos, a quien tenga sesiones ya pasadas (o un bono)
//     sin pagar, con el detalle y el total.
//
// Lo ejecuta api/reminders.ts cada 15 minutos. Cada envío se apunta ANTES en
// la base de datos (appointment_reminders / payment_reminders): la clave
// primaria garantiza que no se repite aunque dos ejecuciones se solapen. Si el
// email falla, se borra el apunte para reintentarlo en la siguiente.
//
// Los emails no llevan datos personales de la psicóloga (ni nombre, ni
// teléfono, ni email de respuesta): solo los de la cita o el pago.
import type { SupabaseClient } from "@supabase/supabase-js";
import { capitalize, madridDate, madridDayKey, madridLongDay, madridParts, madridTime, madridWeekday } from "../shared/madrid";
import { emailSencillo, enviarEmail, type EmailInput } from "./email";

const HOUR = 3_600_000;
// Se avisa cuando faltan 24 h o menos. Las citas que se crean con menos de
// 12 h de margen no reciben recordatorio (se acaban de acordar).
export const REMINDER_HOURS = 24;
export const REMINDER_MIN_HOURS = 12;
// Hora (de Madrid) a partir de la que salen los recordatorios de pago el domingo.
export const PAYMENT_REMINDER_HOUR = 10;
// Tope por ejecución (la función Edge tiene el tiempo limitado); el resto
// sale en la siguiente, 15 minutos después.
const MAX_PER_RUN = 15;
// Resend admite pocas peticiones por segundo.
const PAUSE_MS = 600;

const MODALITY: Record<string, string> = { presencial: "Presencial", online: "Online" };

export function euros(cents: number): string {
  const value = cents / 100;
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(".", ",")} €`;
}

function saludo(fullName: string | null | undefined): string {
  const nombre = (fullName || "").trim().split(/\s+/)[0];
  return nombre ? `Hola, ${nombre}.` : "Hola.";
}

export interface ReminderAppointment {
  id: string;
  patient_id: string;
  starts_at: string;
  duration_minutes: number;
  modality: string;
}

export interface ReminderPatient {
  id: string;
  full_name: string | null;
  email: string | null;
  invited_at?: string | null;
}

export function emailRecordatorioCita(a: ReminderAppointment, p: ReminderPatient, baseUrl: string): EmailInput {
  const fin = new Date(new Date(a.starts_at).getTime() + a.duration_minutes * 60_000);
  const { html, texto } = emailSencillo({
    titulo: "Recordatorio de tu próxima sesión",
    filas: [
      ["Día", capitalize(madridLongDay(a.starts_at, true))],
      ["Hora", `${madridTime(a.starts_at)} – ${madridTime(fin)} (hora de Madrid)`],
      ...(MODALITY[a.modality] ? [["Modalidad", MODALITY[a.modality]] as [string, string]] : []),
    ],
    parrafos: [
      `${saludo(p.full_name)} Te recordamos que tienes una sesión en Siloz Psicología el ${madridWeekday(a.starts_at)} ${madridDate(a.starts_at)} a las ${madridTime(a.starts_at)}.`,
      "Este es un mensaje automático: no respondas a este correo.",
    ],
    // El área privada solo sirve a quien tiene acceso.
    enlace: p.invited_at ? { texto: "Ver mis citas", url: `${baseUrl}/mi-area` } : undefined,
  });
  return {
    para: p.email || "",
    asunto: `Recordatorio: sesión el ${madridWeekday(a.starts_at)} ${madridDate(a.starts_at)} a las ${madridTime(a.starts_at)}`,
    html,
    texto,
  };
}

export interface DebtLine {
  kind: "cita" | "bono";
  date: string; // fecha de la sesión o de la venta del bono
  cents: number;
  sessions?: number; // sesiones del bono
}

export function emailRecordatorioPago(p: ReminderPatient, debts: DebtLine[]): EmailInput {
  const total = debts.reduce((sum, d) => sum + d.cents, 0);
  const sesiones = debts.filter((d) => d.kind === "cita").length;
  const { html, texto } = emailSencillo({
    titulo: "Recordatorio de pago",
    filas: [
      ...debts.map((d): [string, string] => [
        d.kind === "cita"
          ? `Sesión del ${madridWeekday(d.date)} ${madridDate(d.date)}`
          : `Bono de ${d.sessions ?? 5} sesiones (${madridDate(d.date)})`,
        euros(d.cents),
      ]),
      ["Total pendiente", euros(total)],
    ],
    parrafos: [
      `${saludo(p.full_name)} Te recordamos que a día de hoy ${
        debts.length === 1 ? "tienes pendiente de pago lo indicado arriba" : "tienes pendientes de pago los importes indicados arriba"
      }${sesiones > 0 ? `, ${sesiones === 1 ? "de una sesión ya realizada" : "de sesiones ya realizadas"} en Siloz Psicología` : " en Siloz Psicología"}.`,
      "Si ya has hecho el pago en los últimos días, no tengas en cuenta este mensaje.",
      "Este es un mensaje automático: no respondas a este correo.",
    ],
  });
  return { para: p.email || "", asunto: `Recordatorio de pago: ${euros(total)} pendientes`, html, texto };
}

// ¿Toca enviar ya el recordatorio de esta cita?
export function reminderDue(startsAt: string, now: Date): boolean {
  const ms = new Date(startsAt).getTime() - now.getTime();
  return ms > REMINDER_MIN_HOURS * HOUR && ms <= REMINDER_HOURS * HOUR;
}

// ¿Es domingo (en Madrid) y ya ha llegado la hora de los recordatorios de pago?
export function paymentReminderDue(now: Date): boolean {
  return madridWeekday(now) === "domingo" && madridParts(now).hour >= PAYMENT_REMINDER_HOUR;
}

// Deudas por paciente: sesiones ya pasadas sin cobrar y bonos sin pagar
// (mismo criterio que «Pendiente» en el panel: client/src/lib/tariffs.ts).
export function groupDebts(
  appointments: Array<{ patient_id: string; starts_at: string; price_cents: number }>,
  bonos: Array<{ patient_id: string; created_at: string; price_cents: number; sessions_total: number }>
): Map<string, DebtLine[]> {
  const map = new Map<string, DebtLine[]>();
  const add = (id: string, line: DebtLine) => map.set(id, [...(map.get(id) ?? []), line]);
  for (const b of bonos) {
    if (b.price_cents > 0) add(b.patient_id, { kind: "bono", date: b.created_at, cents: b.price_cents, sessions: b.sessions_total });
  }
  for (const a of appointments) add(a.patient_id, { kind: "cita", date: a.starts_at, cents: a.price_cents });
  map.forEach((lines) => lines.sort((x, y) => x.date.localeCompare(y.date)));
  return map;
}

export interface ReminderSummary {
  appointments: { sent: number; failed: number };
  payments: { sent: number; failed: number; pending: number } | null; // null = hoy no toca
}

const pause = () => new Promise((resolve) => setTimeout(resolve, PAUSE_MS));

async function recordatoriosDeCita(admin: SupabaseClient, now: Date, baseUrl: string) {
  const result = { sent: 0, failed: 0 };
  const { data: appts, error } = await admin
    .from("appointments")
    .select("id, patient_id, starts_at, duration_minutes, modality")
    .eq("status", "programada")
    .gt("starts_at", new Date(now.getTime() + REMINDER_MIN_HOURS * HOUR).toISOString())
    .lte("starts_at", new Date(now.getTime() + REMINDER_HOURS * HOUR).toISOString())
    .order("starts_at");
  if (error) throw new Error(`citas: ${error.message}`);
  const due = (appts as ReminderAppointment[]).filter((a) => reminderDue(a.starts_at, now));
  if (due.length === 0) return result;

  const [{ data: sent, error: sentError }, { data: patients, error: patientsError }] = await Promise.all([
    admin.from("appointment_reminders").select("appointment_id, starts_at").in("appointment_id", due.map((a) => a.id)),
    admin.from("profiles").select("id, full_name, email, invited_at")
      .in("id", Array.from(new Set(due.map((a) => a.patient_id)))).eq("role", "patient").eq("active", true),
  ]);
  if (sentError || patientsError) throw new Error(`citas: ${(sentError || patientsError)!.message}`);
  const already = new Set((sent ?? []).map((r) => `${r.appointment_id}|${new Date(r.starts_at).getTime()}`));
  const byId = new Map((patients as ReminderPatient[]).map((p) => [p.id, p]));

  for (const a of due) {
    const patient = byId.get(a.patient_id);
    if (!patient?.email || already.has(`${a.id}|${new Date(a.starts_at).getTime()}`)) continue;
    if (result.sent + result.failed >= MAX_PER_RUN) break;
    const claim = { appointment_id: a.id, starts_at: a.starts_at };
    const { error: claimError } = await admin.from("appointment_reminders").insert(claim);
    if (claimError) continue; // otra ejecución se ha adelantado
    if (result.sent + result.failed > 0) await pause();
    const r = await enviarEmail(emailRecordatorioCita(a, patient, baseUrl));
    if (r.ok) result.sent++;
    else {
      result.failed++;
      await admin.from("appointment_reminders").delete().match(claim);
    }
  }
  return result;
}

async function recordatoriosDePago(admin: SupabaseClient, now: Date) {
  const result = { sent: 0, failed: 0, pending: 0 };
  const week = madridDayKey(now);
  const [appts, bonos, patients, sent] = await Promise.all([
    admin.from("appointments").select("patient_id, starts_at, price_cents")
      .neq("session_type", "bono").neq("status", "cancelada").gt("price_cents", 0)
      .is("paid_at", null).lt("starts_at", now.toISOString()),
    admin.from("bonos").select("patient_id, created_at, price_cents, sessions_total").is("paid_at", null),
    admin.from("profiles").select("id, full_name, email").eq("role", "patient").eq("active", true),
    admin.from("payment_reminders").select("patient_id").eq("week", week),
  ]);
  const failed = [appts, bonos, patients, sent].find((q) => q.error);
  if (failed?.error) throw new Error(`pagos: ${failed.error.message}`);

  const debts = groupDebts(appts.data ?? [], bonos.data ?? []);
  const already = new Set((sent.data ?? []).map((r) => r.patient_id));
  const todo = (patients.data as ReminderPatient[]).filter((p) => p.email && debts.has(p.id) && !already.has(p.id));

  for (const patient of todo) {
    if (result.sent + result.failed >= MAX_PER_RUN) {
      result.pending = todo.length - result.sent - result.failed;
      break;
    }
    const lines = debts.get(patient.id)!;
    const claim = { patient_id: patient.id, week };
    const { error: claimError } = await admin
      .from("payment_reminders")
      .insert({ ...claim, total_cents: lines.reduce((sum, d) => sum + d.cents, 0) });
    if (claimError) continue;
    if (result.sent + result.failed > 0) await pause();
    const r = await enviarEmail(emailRecordatorioPago(patient, lines));
    if (r.ok) result.sent++;
    else {
      result.failed++;
      await admin.from("payment_reminders").delete().match(claim);
    }
  }
  return result;
}

export async function runReminders(admin: SupabaseClient, now: Date, baseUrl: string): Promise<ReminderSummary> {
  const appointments = await recordatoriosDeCita(admin, now, baseUrl);
  const payments = paymentReminderDue(now) ? await recordatoriosDePago(admin, now) : null;
  return { appointments, payments };
}
