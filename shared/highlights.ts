// Común a navegador y servidor (highlights de sesión con IA, ver docs/highlights-ia.md).

// Texto de las notas de la sesión actual. Su SHA-256 se guarda con los
// highlights (session_highlights.notes_sha256) para avisar si las notas
// cambiaron después de generarlos.
export function notesForPrompt(notes: string, nextNotes: string): string {
  return `<notas_sesion>\n${notes.trim()}\n</notas_sesion>\n<notas_para_la_proxima>\n${nextNotes.trim()}\n</notas_para_la_proxima>`;
}

export const HIGHLIGHT_CATEGORIES = ["Me he dado cuenta de…", "Es importante recordar que…", "Estoy empezando a…"] as const;

export interface HighlightItem {
  titulo: string;
  desarrollo: string;
  frase_para_recordar: string; // "" si no hay
  categoria: string; // una de HIGHLIGHT_CATEGORIES o ""
}

// Texto editable que se guarda (y que ve el paciente cuando se publica):
//   ### Título
//   Me he dado cuenta de…        ← opcional (categoría)
//   Desarrollo…
//   > Frase para recordar        ← opcional
// Los highlights se separan con una línea en blanco.
export function highlightsToText(items: HighlightItem[]): string {
  return items
    .filter((h) => h.titulo.trim() || h.desarrollo.trim())
    .map((h) => {
      const lines = [`### ${h.titulo.trim()}`];
      if ((HIGHLIGHT_CATEGORIES as readonly string[]).includes(h.categoria.trim())) lines.push(h.categoria.trim());
      if (h.desarrollo.trim()) lines.push(h.desarrollo.trim());
      if (h.frase_para_recordar.trim()) lines.push(`> ${h.frase_para_recordar.trim().replace(/^[«"]|[»"]$/g, "")}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export interface HighlightBlock { title: string; category: string; body: string; quote: string }

// Lectura del texto (también si la psicóloga lo ha retocado a mano).
export function parseHighlightsText(text: string): HighlightBlock[] {
  const blocks: HighlightBlock[] = [];
  let cur: HighlightBlock | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("### ")) {
      cur = { title: line.slice(4).trim(), category: "", body: "", quote: "" };
      blocks.push(cur);
      continue;
    }
    if (!line) continue;
    if (!cur) {
      cur = { title: "", category: "", body: "", quote: "" };
      blocks.push(cur);
    }
    if (line.startsWith(">")) cur.quote = [cur.quote, line.replace(/^>\s?/, "")].filter(Boolean).join(" ");
    else if (!cur.body && !cur.category && (HIGHLIGHT_CATEGORIES as readonly string[]).includes(line)) cur.category = line;
    else cur.body = [cur.body, line].filter(Boolean).join("\n");
  }
  return blocks.filter((b) => b.title || b.body || b.quote);
}
