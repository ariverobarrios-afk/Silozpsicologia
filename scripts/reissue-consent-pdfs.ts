// Regenera en bloque los PDF de consentimiento guardados con una plantilla
// anterior (p. ej. con el domicilio de la responsable). Idempotente: los que ya
// usan la plantilla actual se saltan, así que se puede ejecutar las veces que haga falta.
// No es imprescindible: api/consent-file.ts hace lo mismo con cada PDF al descargarlo.
//
//   SUPABASE_SERVICE_ROLE_KEY=… [APP_URL=https://silozpsicologia.com] npx tsx scripts/reissue-consent-pdfs.ts
//
// No imprime datos de pacientes: solo el ID de cada consentimiento.
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLIC_URL } from "../shared/supabasePublic";
import { loadLogo, reissueConsentPdf } from "../server/consentReissue";

const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.error("Falta SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const admin = createClient(process.env.SUPABASE_URL || SUPABASE_PUBLIC_URL, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const baseUrl = (process.env.APP_URL || "https://silozpsicologia.com").replace(/\/$/, "");
const logoPng = await loadLogo(baseUrl);

const { data, error } = await admin.from("consents").select("id").order("signed_at");
if (error) {
  console.error("No se pudieron leer los consentimientos:", error.message);
  process.exit(1);
}
let reissued = 0;
let skipped = 0;
let failed = 0;
for (const { id } of data ?? []) {
  const r = await reissueConsentPdf(admin, id, { baseUrl, logoPng });
  if (!r.ok) { failed++; console.error(`✗ ${id}: ${r.error}`); }
  else if (r.reissued) { reissued++; console.log(`✓ ${id} reemitido (sha256 ${r.pdfSha256})`); }
  else skipped++;
}
console.log(`\n${data?.length ?? 0} consentimientos · ${reissued} reemitidos · ${skipped} ya al día · ${failed} con error`);
process.exit(failed ? 1 : 0);
