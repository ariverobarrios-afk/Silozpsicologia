// PDF del consentimiento firmado, generado en el servidor con pdf-lib (JS
// puro: funciona en Vercel sin binarios). Orden:
//   portada con logo y título · datos del paciente y de la profesional ·
//   bloques A, B y C completos · página «Evidencias de la firma».
// Pie en todas las páginas: «Documento firmado electrónicamente el … — ID …».
//
// La huella SHA-256 del PDF no va dentro del propio PDF (cambiaría al
// escribirla): se guarda en consents.pdf_sha256 y la página de evidencias lo
// explica. Sí va la huella del texto (rendered_text_sha256).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { parseParagraphs, type Span } from "../shared/consent";

export interface ConsentPdfInput {
  consentId: string;
  signedAt: Date;
  patient: { name: string; surname: string; idNumber: string; email: string; phone: string; birthdate: string };
  therapist: { full_name: string; dni: string; collegiate_number: string | null };
  responsable: { nombre: string; dni: string; email: string };
  documents: Array<{ label: string; title: string; version: string; text: string; checkbox_label: string }>;
  signaturePng: Uint8Array;
  logoPng?: Uint8Array | null;
  ip: string | null;
  userAgent: string | null;
  renderedTextSha256: string;
  // Copia reemitida de una firma anterior (p. ej. para quitar el domicilio):
  // versiones que se firmaron y fecha de la reemisión.
  reissue?: { reissuedAt: Date; signedVersions: Array<{ label: string; version: string }> };
}

// Versión de la plantilla del PDF (consents.pdf_template). 1 = con el domicilio
// de la responsable; 2 = sin domicilio. Subirla hace que los PDF guardados con
// una plantilla anterior se regeneren al descargarlos (server/consentReissue.ts).
export const CURRENT_PDF_TEMPLATE = 2;

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const FOOTER_SPACE = 40;
const INK = rgb(0.17, 0.2, 0.18);
const MUTED = rgb(0.4, 0.43, 0.41);
const ACCENT = rgb(0.18, 0.42, 0.31);

export function madridDateTime(d: Date): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short",
  }).format(d);
}

export function madridDate(d: Date): string {
  return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

function formatBirthdate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// Las fuentes estándar del PDF solo cubren Latin-1 (WinAnsi): español,
// catalán, gallego… Cualquier otro carácter se sustituye por «?».
function makeSafe(font: PDFFont) {
  const cache = new Map<string, boolean>();
  return (text: string) =>
    Array.from(text.replace(/\t/g, " ")).map((ch) => {
      let ok = cache.get(ch);
      if (ok === undefined) {
        try { font.widthOfTextAtSize(ch, 10); ok = true; } catch { ok = false; }
        cache.set(ch, ok);
      }
      return ok ? ch : "?";
    }).join("");
}

class Writer {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  constructor(public doc: PDFDocument, public regular: PDFFont, public bold: PDFFont) {
    this.newPage();
  }
  safe = (t: string) => makeSafe(this.regular)(t);
  newPage() {
    this.page = this.doc.addPage(A4);
    this.pages.push(this.page);
    this.y = A4[1] - MARGIN;
  }
  ensure(height: number) {
    if (this.y - height < MARGIN + FOOTER_SPACE) this.newPage();
  }
  gap(h: number) { this.y -= h; }

  // Párrafo con tramos en negrita, ajustado al ancho.
  rich(spans: Span[], size = 10.5, opts: { color?: ReturnType<typeof rgb>; indent?: number; lineGap?: number } = {}) {
    const width = A4[0] - 2 * MARGIN - (opts.indent ?? 0);
    const lineHeight = size * (opts.lineGap ?? 1.45);
    type Word = { text: string; font: PDFFont; w: number };
    const words: Word[] = [];
    for (const s of spans) {
      const font = s.bold ? this.bold : this.regular;
      // Conserva los espacios como palabras propias para medir bien.
      for (const piece of this.safe(s.text).split(/(\s+)/).filter(Boolean)) {
        const t = /^\s+$/.test(piece) ? " " : piece;
        words.push({ text: t, font, w: font.widthOfTextAtSize(t, size) });
      }
    }
    const lines: Word[][] = [];
    let line: Word[] = [];
    let lw = 0;
    for (const w of words) {
      if (w.text === " " && line.length === 0) continue;
      if (lw + w.w > width && line.length > 0 && w.text !== " ") {
        while (line.length && line[line.length - 1].text === " ") line.pop();
        lines.push(line);
        line = [];
        lw = 0;
      }
      // Palabra más larga que la línea (p. ej. un user-agent): se parte.
      if (w.w > width) {
        let chunk = "";
        for (const ch of w.text) {
          if (w.font.widthOfTextAtSize(chunk + ch, size) > width) {
            lines.push([{ ...w, text: chunk }]);
            chunk = "";
          }
          chunk += ch;
        }
        line = [{ ...w, text: chunk, w: w.font.widthOfTextAtSize(chunk, size) }];
        lw = line[0].w;
        continue;
      }
      line.push(w);
      lw += w.w;
    }
    if (line.length) lines.push(line);
    for (const l of lines) {
      this.ensure(lineHeight);
      let x = MARGIN + (opts.indent ?? 0);
      for (const w of l) {
        this.page.drawText(w.text, { x, y: this.y - size, size, font: w.font, color: opts.color ?? INK });
        x += w.w;
      }
      this.y -= lineHeight;
    }
  }
  text(t: string, size = 10.5, opts: { bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number } = {}) {
    this.rich([{ text: t, bold: Boolean(opts.bold) }], size, opts);
  }
  heading(t: string, size = 14) {
    this.ensure(size * 3);
    this.gap(6);
    this.rich([{ text: t, bold: true }], size, { color: ACCENT, lineGap: 1.3 });
    this.gap(4);
  }
  rule() {
    this.ensure(12);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y - 4 }, end: { x: A4[0] - MARGIN, y: this.y - 4 },
      thickness: 0.5, color: rgb(0.8, 0.8, 0.78),
    });
    this.gap(14);
  }
  // Tabla de dos columnas «clave: valor».
  rows(rows: Array<[string, string]>, size = 10) {
    const keyWidth = 150;
    for (const [k, v] of rows) {
      const startY = this.y;
      const startPage = this.page;
      this.ensure(size * 1.6);
      this.page.drawText(this.safe(k), { x: MARGIN, y: this.y - size, size, font: this.bold, color: MUTED });
      this.rich([{ text: v || "—", bold: false }], size, { indent: keyWidth, lineGap: 1.4 });
      if (this.page === startPage && this.y === startY) this.gap(size * 1.4);
      this.gap(2);
    }
  }
  image(img: PDFImage, maxW: number, maxH: number) {
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    this.ensure(h + 8);
    this.page.drawRectangle({ x: MARGIN, y: this.y - h - 8, width: w + 16, height: h + 8, borderColor: rgb(0.8, 0.8, 0.78), borderWidth: 0.5 });
    this.page.drawImage(img, { x: MARGIN + 8, y: this.y - h - 4, width: w, height: h });
    this.gap(h + 16);
  }
}

export async function buildConsentPdf(input: ConsentPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Siloz Psicología — Documentos de consentimiento");
  doc.setAuthor(input.responsable.nombre);
  doc.setSubject(`Consentimiento ${input.consentId}`);
  doc.setProducer("Siloz Psicología");
  doc.setCreator("silozpsicologia.com");
  doc.setCreationDate(input.signedAt);
  doc.setModificationDate(input.signedAt);

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, regular, bold);
  const p = input.patient;
  const fullName = `${p.name} ${p.surname}`.trim();

  // ── Portada ──
  if (input.logoPng) {
    try {
      const logo = await doc.embedPng(input.logoPng);
      const h = 64;
      const lw = (logo.width / logo.height) * h;
      w.page.drawImage(logo, { x: MARGIN, y: w.y - h, width: lw, height: h });
      w.gap(h + 18);
    } catch {
      // Sin logo si no se puede leer: el documento sigue siendo válido.
    }
  }
  w.text("Siloz Psicología — Documentos de consentimiento", 20, { bold: true });
  w.gap(4);
  w.text(`Firmado electrónicamente el ${madridDateTime(input.signedAt)}`, 10.5, { color: MUTED });
  w.gap(10);
  w.rule();

  w.heading("Datos del paciente", 12.5);
  w.rows([
    ["Nombre y apellidos", fullName],
    ["DNI/NIE", p.idNumber],
    ["Fecha de nacimiento", formatBirthdate(p.birthdate)],
    ["Email", p.email],
    ["Teléfono", p.phone],
  ]);
  w.gap(6);
  w.heading("Responsable del tratamiento", 12.5);
  w.rows([
    ["Nombre", input.responsable.nombre],
    ["DNI", input.responsable.dni],
    ["Contacto", input.responsable.email],
  ]);
  w.gap(6);
  w.heading("Profesional que presta el servicio", 12.5);
  w.rows([
    ["Nombre", input.therapist.full_name],
    ["DNI", input.therapist.dni],
    ["N.º de colegiada", input.therapist.collegiate_number ?? ""],
  ]);
  w.gap(6);
  w.heading("Contenido", 12.5);
  for (const d of input.documents) w.text(`${d.label}. ${d.title} (versión ${d.version})`, 10.5);
  w.text("Evidencias de la firma", 10.5);

  // ── Bloques A, B, C ──
  for (const d of input.documents) {
    w.newPage();
    w.text(`Bloque ${d.label}`, 10, { color: MUTED, bold: true });
    w.heading(d.title, 15);
    w.text(`Versión ${d.version}`, 9.5, { color: MUTED });
    w.gap(8);
    for (const para of parseParagraphs(d.text)) {
      w.rich(para, 10, { lineGap: 1.4 });
      w.gap(5);
    }
    w.gap(6);
    w.rich([{ text: "[X] ", bold: true }, { text: d.checkbox_label, bold: true }], 10, { color: ACCENT });
    w.text(`Marcado por ${fullName} el ${madridDateTime(input.signedAt)}.`, 9.5, { color: MUTED });
  }

  // ── Evidencias ──
  w.newPage();
  w.heading("Evidencias de la firma", 15);
  w.gap(4);
  w.rows([
    ["Firmante", fullName],
    ["DNI/NIE del firmante", p.idNumber],
  ]);
  w.gap(6);
  w.text("Firma manuscrita", 10, { bold: true, color: MUTED });
  w.gap(4);
  const sig = await doc.embedPng(input.signaturePng);
  w.image(sig, 260, 120);
  const signedUtc = input.signedAt.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  w.rows([
    ["Fecha y hora (Madrid)", madridDateTime(input.signedAt)],
    ["Fecha y hora (UTC)", signedUtc],
    ["Dirección IP", input.ip ?? "No disponible"],
    ["Navegador (user-agent)", input.userAgent ?? "No disponible"],
    ["ID del consentimiento", input.consentId],
    ...(input.reissue
      ? [
          ...input.reissue.signedVersions.map((v): [string, string] => [`Versión firmada bloque ${v.label}`, v.version]),
          ...input.documents.map((d): [string, string] => [`Versión de esta copia ${d.label}`, `${d.title}: ${d.version}`]),
          ["Copia reemitida el", madridDateTime(input.reissue.reissuedAt)] as [string, string],
        ]
      : input.documents.map((d): [string, string] => [`Versión bloque ${d.label}`, `${d.title}: ${d.version}`])),
    [input.reissue ? "SHA-256 del texto firmado" : "SHA-256 del texto", input.renderedTextSha256],
  ], 9);
  w.gap(10);
  w.text(
    "La fecha y la hora las fija el servidor en el momento de la firma, no el dispositivo del paciente. " +
      "El SHA-256 del texto es la huella de los tres documentos tal como se mostraron, con los datos sustituidos. " +
      "La huella SHA-256 de este PDF se calcula sobre el archivo completo y se conserva en el registro del " +
      "consentimiento (no puede incluirse dentro del propio archivo sin alterarla).",
    9, { color: MUTED }
  );
  if (input.reissue) {
    w.gap(6);
    w.text(
      "Esta es una copia reemitida de la firma original: la fecha y la hora, la firma, la IP y el navegador " +
        "son los de la firma. Los textos son los mismos que se firmaron, sin el domicilio de la responsable del " +
        "tratamiento (versiones posteriores que no cambian nada para el paciente). El texto firmado original y " +
        "su huella SHA-256 se conservan en el registro del consentimiento.",
      9, { color: MUTED }
    );
  }

  // ── Pie en todas las páginas ──
  const footer = makeSafe(regular)(`Documento firmado electrónicamente el ${madridDate(input.signedAt)} — ID ${input.consentId}`);
  w.pages.forEach((pg, i) => {
    pg.drawText(footer, { x: MARGIN, y: 28, size: 8, font: regular, color: MUTED });
    const n = `${i + 1} / ${w.pages.length}`;
    pg.drawText(n, { x: A4[0] - MARGIN - regular.widthOfTextAtSize(n, 8), y: 28, size: 8, font: regular, color: MUTED });
  });

  return doc.save({ useObjectStreams: false });
}
