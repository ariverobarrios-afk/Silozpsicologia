// Lógica común de la firma del consentimiento (navegador y servidor).
//
// El servidor NO se fía del texto que ve el navegador: vuelve a renderizar
// los documentos con estas mismas funciones a partir de la base de datos y
// calcula el hash sobre su propio resultado.

export type DocType = "privacy" | "rules" | "withdrawal";

export const DOC_ORDER: DocType[] = ["privacy", "rules", "withdrawal"];

export interface ConsentDocument {
  id: string;
  doc_type: DocType;
  version: string;
  title: string;
  body_md: string; // texto con {{placeholders}}, párrafos separados por línea en blanco y **negritas**
  checkbox_label: string;
}

export interface ConsentSettings {
  responsable_nombre: string;
  responsable_dni: string;
  responsable_direccion: string;
  email_contacto: string;
  iban: string;
  plataforma_videollamada: string;
}

export interface ConsentTherapist {
  full_name: string;
  dni: string;
  collegiate_number: string | null;
  price_single_eur: number | string;
  price_pack5_eur: number | string;
  session_minutes: number;
}

// «55» o «55,50» (los precios llegan de la base de datos como número o texto).
export function formatEuros(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return String(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", ",");
}

export function placeholderValues(
  settings: ConsentSettings,
  therapist: ConsentTherapist,
  patient?: { nombre?: string; dni?: string }
): Record<string, string> {
  return {
    responsable_nombre: settings.responsable_nombre,
    responsable_dni: settings.responsable_dni,
    responsable_direccion: settings.responsable_direccion,
    email_contacto: settings.email_contacto,
    iban: settings.iban,
    plataforma_videollamada: settings.plataforma_videollamada,
    profesional_nombre: therapist.full_name,
    profesional_dni: therapist.dni,
    profesional_colegiada: therapist.collegiate_number || "—",
    precio_sesion: formatEuros(therapist.price_single_eur),
    precio_bono5: formatEuros(therapist.price_pack5_eur),
    duracion_sesion: String(therapist.session_minutes),
    paciente_nombre: patient?.nombre ?? "",
    paciente_dni: patient?.dni ?? "",
  };
}

// Sustituye {{clave}}. Si queda alguna sin valor, lo indica en `missing`
// (el servidor rechaza la firma antes que firmar un texto incompleto).
export function renderTemplate(body: string, values: Record<string, string>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = body.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (whole, key: string) => {
    if (key in values) return values[key];
    missing.push(key);
    return whole;
  });
  return { text, missing };
}

// Párrafos (separados por línea en blanco) con tramos en **negrita**.
export type Span = { text: string; bold: boolean };
export function parseParagraphs(text: string): Span[][] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
    .map((p) =>
      p
        .split(/(\*\*[^*]+\*\*)/)
        .filter(Boolean)
        .map((part) =>
          part.startsWith("**") && part.endsWith("**")
            ? { text: part.slice(2, -2), bold: true }
            : { text: part, bold: false }
        )
    );
}

export function plainText(text: string): string {
  return parseParagraphs(text)
    .map((spans) => spans.map((s) => s.text).join(""))
    .join("\n\n");
}

// Texto canónico de los tres documentos ya renderizados: lo que se hashea
// (rendered_text_sha256) y lo que contiene el PDF.
export function canonicalText(docs: Array<{ title: string; version: string; text: string; checkbox_label: string }>): string {
  return docs
    .map((d) => `${d.title} (versión ${d.version})\n\n${plainText(d.text)}\n\n[X] ${d.checkbox_label}`)
    .join("\n\n----\n\n");
}

// ─── Validaciones ───────────────────────────────────────────────────────────
const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

export function normalizeIdNumber(value: string): string {
  return value.toUpperCase().replace(/[\s.-]/g, "");
}

// DNI (8 cifras + letra) o NIE (X/Y/Z + 7 cifras + letra), con letra de control.
export function isValidDniNie(value: string): boolean {
  const v = normalizeIdNumber(value);
  let digits: string;
  if (/^\d{8}[A-Z]$/.test(v)) digits = v.slice(0, 8);
  else if (/^[XYZ]\d{7}[A-Z]$/.test(v)) digits = String("XYZ".indexOf(v[0])) + v.slice(1, 8);
  else return false;
  return DNI_LETTERS[Number(digits) % 23] === v[8];
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export function isValidDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

// Años cumplidos en `today` (ambas en yyyy-MM-dd).
export function ageOn(birthdate: string, today: string): number {
  const [by, bm, bd] = birthdate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  return age;
}

// «Ana María Pérez Gómez» → nombre «Ana», apellidos «María Pérez Gómez».
// Es solo la propuesta inicial: el paciente la corrige en el formulario.
export function splitFullName(full: string): { name: string; surname: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { name: parts[0] ?? "", surname: parts.slice(1).join(" ") };
}

export interface ConsentForm {
  name: string;
  surname: string;
  idNumber: string;
  email: string;
  phone: string;
  birthdate: string; // yyyy-MM-dd
}

export const REQUIRED_LABELS: Record<Exclude<keyof ConsentForm, "phone">, string> = {
  name: "nombre",
  surname: "apellidos",
  idNumber: "DNI/NIE",
  email: "email",
  birthdate: "fecha de nacimiento",
};

// Campos obligatorios vacíos (para el aviso «necesitamos estos datos»).
export function missingFields(form: ConsentForm): Array<keyof typeof REQUIRED_LABELS> {
  return (Object.keys(REQUIRED_LABELS) as Array<keyof typeof REQUIRED_LABELS>).filter((k) => !form[k].trim());
}

// Errores de formato (no de campos vacíos). Mismo criterio en cliente y servidor.
export function formErrors(form: ConsentForm, today: string): Partial<Record<keyof ConsentForm, string>> {
  const errors: Partial<Record<keyof ConsentForm, string>> = {};
  if (form.name.trim().length > 80) errors.name = "Demasiado largo.";
  if (form.surname.trim().length > 120) errors.surname = "Demasiado largo.";
  if (form.idNumber.trim() && !isValidDniNie(form.idNumber)) errors.idNumber = "DNI/NIE no válido (revisa la letra).";
  if (form.email.trim() && !isValidEmail(form.email)) errors.email = "Email no válido.";
  if (form.phone.trim() && !/^\+?[\d\s()-]{6,20}$/.test(form.phone.trim())) errors.phone = "Teléfono no válido.";
  if (form.birthdate.trim()) {
    if (!isValidDate(form.birthdate) || form.birthdate > today || form.birthdate < "1900-01-01") {
      errors.birthdate = "Fecha no válida.";
    } else if (ageOn(form.birthdate, today) < 18) {
      errors.birthdate =
        "Para menores de edad el consentimiento debe prestarlo el padre, madre o tutor legal. Contacta con tu psicóloga.";
    }
  }
  return errors;
}

// Fecha de hoy en Madrid (yyyy-MM-dd).
export function madridToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(now);
}
