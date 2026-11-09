// Calendario en formato iCalendar (RFC 5545) para suscribirse desde Google
// Calendar, Calendario de Apple u Outlook (ver api/calendar.ts).

export interface IcsEvent {
  uid: string;
  start: Date; // con hora: en UTC; todo el día: se usa la fecha (yyyy-MM-dd)
  end: Date;
  allDay?: string; // yyyy-MM-dd si es un evento de día completo
  summary: string;
  description?: string;
  url?: string;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// Líneas de máximo 75 octetos (UTF-8), continuadas con un espacio.
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    const limit = out.length === 0 ? 75 : 74; // las continuaciones empiezan con un espacio
    if (enc.encode(cur + ch).length > limit) {
      out.push(cur);
      cur = "";
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((l, i) => (i === 0 ? l : ` ${l}`)).join("\r\n");
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateOnly = (iso: string) => iso.replace(/-/g, "");
function nextDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function buildIcs(opts: { name: string; events: IcsEvent[]; now?: Date }): string {
  const stamp = utc(opts.now ?? new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Siloz Psicologia//Area privada//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.name)}`,
    "X-WR-TIMEZONE:Europe/Madrid",
    // Sugerencia de refresco (Apple/Outlook la respetan; Google decide él).
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of opts.events) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(e.allDay)}`, `DTEND;VALUE=DATE:${dateOnly(nextDay(e.allDay))}`, "TRANSP:TRANSPARENT");
    } else {
      lines.push(`DTSTART:${utc(e.start)}`, `DTEND:${utc(e.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// «Alberto Rivero Barrios» → «A.R.B.» (sin las partículas «de», «la»…).
const PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "i", "da", "do", "dos", "van", "von"]);
export function initials(fullName: string): string {
  const letters = fullName
    .split(/[\s-]+/)
    .filter((w) => w && !PARTICLES.has(w.toLowerCase()))
    .map((w) => w[0]!.toUpperCase());
  return letters.length ? `${letters.join(".")}.` : "Paciente";
}

// Días de Psicolink entre dos fechas (yyyy-MM-dd): miércoles y viernes por
// defecto, salvo los días cambiados a mano (agenda_days). Igual que
// client/src/lib/psicolink.ts.
export const PSICOLINK_DEFAULT_WEEKDAYS = [3, 5];
export function psicolinkDays(from: string, to: string, overrides: Map<string, boolean>): string[] {
  const out: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    if (overrides.get(key) ?? PSICOLINK_DEFAULT_WEEKDAYS.includes(d.getUTCDay())) out.push(key);
  }
  return out;
}
