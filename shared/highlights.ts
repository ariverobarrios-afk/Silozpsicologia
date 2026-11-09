// Común a navegador y servidor: texto de las notas que se envía a la IA. Su
// SHA-256 se guarda con el resumen (session_highlights.notes_sha256) para
// avisar si las notas cambiaron después de generarlo.
export function notesForPrompt(notes: string, nextNotes: string): string {
  return `<notas_sesion>\n${notes.trim()}\n</notas_sesion>\n\n<notas_proxima_sesion>\n${nextNotes.trim()}\n</notas_proxima_sesion>`;
}
