import { test } from "node:test";
import assert from "node:assert/strict";
import { highlightsToText, notesForPrompt, parseHighlights, pseudonymize } from "../server/highlights";
import sessionHighlights from "../api/session-highlights";

const patient = { full_name: "María José de la Peña Núñez", email: "mj.pena@gmail.com", phone: "+34 600 12 34 56", tax_id: "12345678Z" };

test("seudonimización: nombre, apellidos, DNI, email y teléfono", () => {
  const notes =
    "maria jose llega tarde. La señora PEÑA cuenta que su hermana Nuñez la apoya. " +
    "DNI 12345678-Z, escribe a mj.pena@gmail.com o al 600 123 456. Otra: X1234567L.";
  const out = pseudonymize(notes, patient);
  assert.doesNotMatch(out, /mar[ií]a|jos[eé]|pe[ñn]a|n[uú][ñn]ez|12345678|gmail|600|X1234567L/i);
  assert.match(out, /\[PACIENTE\] \[PACIENTE\] llega tarde/);
  assert.match(out, /\[DNI\]/);
  assert.match(out, /\[EMAIL\]/);
  assert.match(out, /\[TELÉFONO\]/);
  // Las partículas («de», «la») no se tocan, ni palabras que solo contienen el nombre.
  assert.match(out, /La señora/);
  assert.equal(pseudonymize("Habla de marianas y de la penalidad", patient), "Habla de marianas y de la penalidad");
});

test("formato de los highlights", () => {
  const h = parseHighlights(JSON.stringify({ temas: ["Ansiedad en el trabajo"], hechos_relevantes: [], tareas_acordadas: ["Registro diario"], para_retomar: [" "] }))!;
  assert.equal(highlightsToText(h), "Temas trabajados\n- Ansiedad en el trabajo\n\nTareas acordadas\n- Registro diario");
  assert.equal(highlightsToText({ temas: [], hechos_relevantes: [], tareas_acordadas: [], para_retomar: [] }), "No hay nada destacable en las notas.");
  assert.equal(parseHighlights("no es json"), null);
  assert.match(notesForPrompt(" a ", "b"), /<notas_sesion>\na\n<\/notas_sesion>/);
});

test("endpoint sin configurar o sin sesión", async () => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r1 = await sessionHighlights(new Request("https://x/api/session-highlights", { method: "POST", body: "{}" }));
  assert.equal(r1.status, 500);
  process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
  const r2 = await sessionHighlights(new Request("https://x/api/session-highlights", { method: "POST", body: "{}" }));
  assert.equal(r2.status, 401);
  const r3 = await sessionHighlights(new Request("https://x/api/session-highlights", { method: "GET" }));
  assert.equal(r3.status, 405);
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});
