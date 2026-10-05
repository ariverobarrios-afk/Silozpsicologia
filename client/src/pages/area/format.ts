import { format } from "date-fns";
import { es } from "date-fns/locale";

export function formatDay(iso: string): string {
  return format(new Date(iso), "EEEE d 'de' MMMM yyyy", { locale: es });
}

// «Miércoles 7 de octubre 2026»: solo la primera letra en mayúscula.
export function formatDayTitle(iso: string): string {
  const s = formatDay(iso);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatTime(iso: string): string {
  return format(new Date(iso), "HH:mm");
}

// Valores para <input type="date"> y <input type="time"> en hora local.
export function toDateInput(iso: string): string {
  return format(new Date(iso), "yyyy-MM-dd");
}

export function toTimeInput(iso: string): string {
  return format(new Date(iso), "HH:mm");
}

// Combina fecha y hora locales (las del navegador de Silvia) en un ISO UTC.
export function fromInputs(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}
