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

// Valor para <input type="time"> en hora local.
export function toTimeInput(iso: string): string {
  return format(new Date(iso), "HH:mm");
}

// Combina fecha y hora locales (las del navegador de Silvia) en un ISO UTC.
export function fromInputs(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}

// Vista previa de las notas de una cita (p. ej. al pasar el ratón en la
// agenda): hasta `maxWords` palabras; si hay más, termina en «…».
export function notePreview(notes: string, maxWords = 50): string {
  const words = notes.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return notes.trim();
  return `${words.slice(0, maxWords).join(" ")}…`;
}
