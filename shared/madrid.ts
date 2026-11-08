// Fechas de la agenda en hora de Madrid, la misma en el navegador del
// paciente (esté donde esté) y en el servidor que envía los emails. Sin
// dependencias: solo Intl, disponible en navegadores, Node y Vercel Edge.
export const AGENDA_TZ = "Europe/Madrid";

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: AGENDA_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export interface MadridParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

export function madridParts(iso: string | Date): MadridParts {
  const get = (type: string) =>
    Number(partsFmt.formatToParts(new Date(iso)).find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

const pad = (n: number) => String(n).padStart(2, "0");

// «2026-11-16»: día (de Madrid) de un instante. Sirve para agrupar por día.
export function madridDayKey(iso: string | Date): string {
  const p = madridParts(iso);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

// Lunes (de Madrid, «yyyy-MM-dd») de la semana natural de un instante: dos
// citas con la misma clave caen en la misma semana (lunes a domingo).
export function madridWeekKey(iso: string | Date): string {
  const p = madridParts(iso);
  // Mediodía UTC de ese día de calendario: getUTCDay() da su día de la semana.
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day, 12));
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - sinceMonday);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// «10:00»
export function madridTime(iso: string | Date): string {
  const p = madridParts(iso);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

// «16/11/2026»
export function madridDate(iso: string | Date): string {
  const p = madridParts(iso);
  return `${pad(p.day)}/${pad(p.month)}/${p.year}`;
}

// «lunes»
export function madridWeekday(iso: string | Date): string {
  return new Intl.DateTimeFormat("es-ES", { timeZone: AGENDA_TZ, weekday: "long" }).format(new Date(iso));
}

// «lunes, 16 de noviembre» (con año si se pide)
export function madridLongDay(iso: string | Date, withYear = false): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: AGENDA_TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(new Date(iso));
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
