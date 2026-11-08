import type { Appointment, SessionNotes } from "@/lib/supabase";

// Las notas viven en `appointment_notes` (solo las lee la administración):
// · notes      → lo que pasó en la sesión.
// · next_notes → lo que hay que tener en cuenta en la siguiente.
// Las «notas para la próxima» se enlazan por paciente y fecha, no por quién
// reservó: la siguiente cita (no cancelada) del paciente las hereda, tanto si
// la crea la psicóloga como si la reserva el paciente.

const byDate = (a: Appointment, b: Appointment) => a.starts_at.localeCompare(b.starts_at);

function sessionsOf(all: Appointment[], patientId: string): Appointment[] {
  return all.filter((x) => x.patient_id === patientId && x.status !== "cancelada").sort(byDate);
}

// Sesión anterior (no cancelada) del mismo paciente.
export function previousSession(all: Appointment[], a: Appointment): Appointment | undefined {
  return sessionsOf(all, a.patient_id).filter((x) => x.id !== a.id && x.starts_at < a.starts_at).at(-1);
}

// Sesión siguiente (no cancelada) del mismo paciente.
export function nextSession(all: Appointment[], a: Appointment): Appointment | undefined {
  return sessionsOf(all, a.patient_id).find((x) => x.id !== a.id && x.starts_at > a.starts_at);
}

// Texto para la agenda (al pasar el ratón, o dentro de la cita en el móvil):
// lo que se dejó apuntado para esta sesión y sus propias notas.
export function agendaNotes(
  a: Appointment,
  all: Appointment[],
  notes: Map<string, SessionNotes>
): string | undefined {
  const prev = previousSession(all, a);
  const forThis = prev ? notes.get(prev.id)?.next_notes.trim() : "";
  const own = notes.get(a.id)?.notes.trim();
  const parts = [
    forThis && `Para esta sesión: ${forThis}`,
    own && `Notas de la sesión: ${own}`,
  ].filter(Boolean);
  return parts.length ? parts.join("\n\n") : undefined;
}
