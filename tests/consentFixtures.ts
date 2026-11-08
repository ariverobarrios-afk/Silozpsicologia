// Textos reales de la migración (para las pruebas del PDF y de la API).
import { readFileSync } from "node:fs";
import type { ConsentDocument } from "../shared/consent";

export function migrationDocuments(): ConsentDocument[] {
  const sql = readFileSync(new URL("../supabase/migrations/20261108_consentimiento_firma.sql", import.meta.url), "utf8");
  const re = /\('(privacy|rules|withdrawal)', '([^']+)', '([^']+)',\s*'([^']+)', '[^']+',\s*\$txt\$([\s\S]*?)\$txt\$\)/g;
  const docs: ConsentDocument[] = [];
  for (const m of sql.matchAll(re)) {
    docs.push({ id: `id-${m[1]}`, doc_type: m[1] as ConsentDocument["doc_type"], version: m[2], title: m[3], checkbox_label: m[4], body_md: m[5] });
  }
  return docs;
}

// Versiones sin domicilio (A 2.1, B 2.1, C 1.1) de la migración 20261109.
export function migrationDocumentsSinDomicilio(): ConsentDocument[] {
  const sql = readFileSync(new URL("../supabase/migrations/20261109_consentimiento_sin_domicilio.sql", import.meta.url), "utf8");
  const re = /select '(privacy|rules|withdrawal)', '([^']+)', '([^']+)',\s*'([^']+)',[\s\S]*?\$txt\$([\s\S]*?)\$txt\$/g;
  const docs: ConsentDocument[] = [];
  for (const m of sql.matchAll(re)) {
    docs.push({ id: `id-${m[1]}`, doc_type: m[1] as ConsentDocument["doc_type"], version: m[2], title: m[3], checkbox_label: m[4], body_md: m[5] });
  }
  return docs;
}

// PNG de 1×1 blanco y una «firma» de prueba (PNG real pequeño).
export const PNG_1PX = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
), (c) => c.charCodeAt(0));
