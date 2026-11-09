// Highlights de sesión con IA: piezas sin red (seudonimización, instrucciones
// y formato). La llamada a Claude está en api/session-highlights.ts.
// Ver docs/highlights-ia.md.

import { notesForPrompt, type HighlightItem } from "../shared/highlights";
export { notesForPrompt };

export const HIGHLIGHTS_MODEL = "claude-opus-5-5";

// Instrucciones del agente (texto de Silvia + reglas técnicas).
export { HIGHLIGHTS_SYSTEM } from "./highlightsPrompt";

// Respuesta estructurada (structured outputs): lista de highlights.
export const HIGHLIGHTS_SCHEMA = {
  type: "object",
  properties: {
    highlights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          titulo: { type: "string", description: "Frase breve que sintetiza el descubrimiento" },
          desarrollo: { type: "string", description: "De una a tres frases, en segunda persona, para el paciente" },
          frase_para_recordar: { type: "string", description: "Frase breve para recordar, o cadena vacía" },
          categoria: { type: "string", enum: ["Me he dado cuenta de…", "Es importante recordar que…", "Estoy empezando a…", ""] },
        },
        required: ["titulo", "desarrollo", "frase_para_recordar", "categoria"],
        additionalProperties: false,
      },
    },
  },
  required: ["highlights"],
  additionalProperties: false,
} as const;

export function parseHighlights(text: string): HighlightItem[] | null {
  try {
    const v = JSON.parse(text) as { highlights?: unknown };
    if (!Array.isArray(v.highlights)) return null;
    const str = (x: unknown) => (typeof x === "string" ? x : "");
    return v.highlights.slice(0, 8).map((h: Record<string, unknown>) => ({
      titulo: str(h.titulo), desarrollo: str(h.desarrollo),
      frase_para_recordar: str(h.frase_para_recordar), categoria: str(h.categoria),
    }));
  } catch {
    return null;
  }
}

export { highlightsToText } from "../shared/highlights";

// Mensaje con la sesión actual y hasta 5 anteriores (ya seudonimizadas fuera).
export function buildHighlightsInput(
  current: { notes: string; next: string },
  previous: Array<{ notes: string; next: string }>
): string {
  const cur = `<sesion_actual>\n${notesForPrompt(current.notes, current.next)}\n</sesion_actual>`;
  const prev = previous.filter((p) => p.notes.trim() || p.next.trim());
  if (!prev.length) return cur;
  const items = prev.map((p, i) => `<sesion_anterior orden="${i + 1}">\n${notesForPrompt(p.notes, p.next)}\n</sesion_anterior>`);
  return `${cur}\n\n<sesiones_anteriores>\n${items.join("\n")}\n</sesiones_anteriores>`;
}



// ─── Seudonimización ────────────────────────────────────────────────────────
// Quita lo que identifica directamente al paciente antes de enviar las notas:
// su nombre y apellidos (sin distinguir mayúsculas ni tildes), su DNI, email y
// teléfono, y cualquier otro DNI/NIE, email o teléfono que aparezca. No puede
// quitar todo lo que identifica por contexto (lugares, nombres de terceros…):
// eso depende de cómo se escriban las notas.
const VARIANTS: Record<string, string> = {
  a: "aáàäâ", e: "eéèëê", i: "iíìïî", o: "oóòöô", u: "uúùüû", n: "nñ", c: "cç",
};
function accentInsensitive(word: string): string {
  return Array.from(word.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase())
    .map((ch) => (VARIANTS[ch] ? `[${VARIANTS[ch]}]` : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
}
// Palabras de enlace de los nombres compuestos que no se tocan («de», «la», «del»…).
const PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "i", "da", "do", "dos", "van", "von"]);

export function pseudonymize(
  text: string,
  patient: { full_name?: string | null; email?: string | null; phone?: string | null; tax_id?: string | null }
): string {
  let out = text;
  // Primero lo que tiene forma fija.
  out = out.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[EMAIL]");
  out = out.replace(/\b[XYZxyz]?[-\s.]?\d{7,8}[-\s.]?[A-Za-z]\b/g, "[DNI]");
  out = out.replace(/(\+?\d{2}[\s.-]?)?\b[6789]\d{2}[\s.-]?\d{2,3}[\s.-]?\d{2,3}[\s.-]?\d{0,3}\b/g, (m) =>
    m.replace(/\D/g, "").length >= 9 ? "[TELÉFONO]" : m
  );
  // Nombre y apellidos del paciente, palabra a palabra.
  const words = (patient.full_name ?? "")
    .split(/[\s-]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !PARTICLES.has(w.toLowerCase()));
  for (const w of new Set(words)) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${accentInsensitive(w)}(?![\\p{L}\\p{N}])`, "giu");
    out = out.replace(re, "[PACIENTE]");
  }
  return out;
}
