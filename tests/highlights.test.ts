import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHighlightsInput, highlightsToText, parseHighlights, pseudonymize } from "../server/highlights";
import { parseHighlightsText } from "../shared/highlights";
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

test("formato de los highlights: texto editable y lectura", () => {
  const items = parseHighlights(JSON.stringify({ highlights: [
    { titulo: "Una parte de ti quiere protegerte", desarrollo: "Has podido reconocer que el control te da seguridad.", frase_para_recordar: "«No tengo que tenerlo todo bajo control»", categoria: "Me he dado cuenta de…" },
    { titulo: "Lo que duele también cuenta", desarrollo: "Hoy has podido decir que algo te duele.", frase_para_recordar: "", categoria: "" },
  ] }))!;
  const text = highlightsToText(items);
  assert.equal(text,
    "### Una parte de ti quiere protegerte\nMe he dado cuenta de…\nHas podido reconocer que el control te da seguridad.\n> No tengo que tenerlo todo bajo control\n\n" +
    "### Lo que duele también cuenta\nHoy has podido decir que algo te duele.");
  const blocks = parseHighlightsText(text);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0], { title: "Una parte de ti quiere protegerte", category: "Me he dado cuenta de…", body: "Has podido reconocer que el control te da seguridad.", quote: "No tengo que tenerlo todo bajo control" });
  assert.equal(blocks[1].category, "");
  // Texto retocado a mano sin formato: no se pierde.
  assert.deepEqual(parseHighlightsText("Algo escrito a mano"), [{ title: "", category: "", body: "Algo escrito a mano", quote: "" }]);
  assert.equal(highlightsToText([]), "");
  assert.equal(parseHighlights("no es json"), null);
});

test("entrada: sesión actual y anteriores (sin las vacías)", () => {
  const input = buildHighlightsInput({ notes: "hoy", next: "luego" }, [{ notes: "antes", next: "" }, { notes: "", next: "" }]);
  assert.match(input, /^<sesion_actual>\n<notas_sesion>\nhoy\n<\/notas_sesion>\n<notas_para_la_proxima>\nluego/);
  assert.match(input, /<sesion_anterior orden="1">\n<notas_sesion>\nantes/);
  assert.doesNotMatch(input, /orden="2"/);
  assert.doesNotMatch(buildHighlightsInput({ notes: "hoy", next: "" }, []), /sesiones_anteriores/);
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
