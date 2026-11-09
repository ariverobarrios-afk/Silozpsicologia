import { format } from "date-fns";

// Días que Silvia reserva para Psicolink (el otro gabinete con el que colabora).
// Por defecto miércoles (3) y viernes (5); cada día se puede cambiar a mano y
// ese cambio se guarda en la tabla agenda_days.
export const PSICOLINK_DEFAULT_WEEKDAYS = [3, 5];

export interface AgendaDay {
  day: string; // yyyy-MM-dd
  psicolink: boolean;
}

export function dayKey(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function isPsicolinkDay(d: Date, overrides: Map<string, boolean>): boolean {
  return overrides.get(dayKey(d)) ?? PSICOLINK_DEFAULT_WEEKDAYS.includes(d.getDay());
}
