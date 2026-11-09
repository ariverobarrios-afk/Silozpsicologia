import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import consent from "../api/consent";
import consentFile from "../api/consent-file";
import { buildConsentPdf } from "../server/consentPdf";
import { bytesToBase64, clientIp, decodeSignatureDataUrl, parseBody, sha256Hex, signatureHasInk } from "../server/consent";
import { canonicalText, placeholderValues, renderTemplate } from "../shared/consent";
import { migrationDocuments, migrationDocumentsSinDomicilio } from "./consentFixtures";

// PNG RGBA de 8 bits como el que genera un canvas (fondo transparente).
function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function png(width: number, height: number, ink: Array<[number, number]>, filter = 0): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) raw[y * (1 + width * 4)] = filter;
  for (const [x, y] of ink) raw.set([20, 40, 30, 255], y * (1 + width * 4) + 1 + x * 4);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array())];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return all;
}

test("firma vacía vs firma con trazo (comprobación en el servidor)", async () => {
  assert.equal(await signatureHasInk(png(40, 20, [])), false);
  // Un byte de filtro distinto de 0 en una imagen vacía no cuenta como trazo.
  assert.equal(await signatureHasInk(png(40, 20, [], 2)), false);
  assert.equal(await signatureHasInk(png(40, 20, [[10, 5], [11, 5]])), true);
  assert.equal(await signatureHasInk(new Uint8Array([1, 2, 3])), false);
});

test("data URL de la firma: solo PNG", () => {
  const p = png(4, 4, [[1, 1]]);
  assert.ok(decodeSignatureDataUrl(`data:image/png;base64,${bytesToBase64(p)}`));
  assert.equal(decodeSignatureDataUrl(`data:image/jpeg;base64,${bytesToBase64(p)}`), null);
  assert.equal(decodeSignatureDataUrl(`data:image/png;base64,${btoa("no es png")}`), null);
  assert.equal(decodeSignatureDataUrl(42), null);
});

test("cuerpo: las casillas solo cuentan si son exactamente true", () => {
  const b = parseBody({ name: " Ana ", accepted: { privacy: "true", rules: true, withdrawal: 1 } })!;
  assert.equal(b.name, "Ana");
  assert.deepEqual(b.accepted, { privacy: false, rules: true, withdrawal: false });
  assert.equal(parseBody(null), null);
});

test("IP del cliente desde x-forwarded-for", () => {
  assert.equal(clientIp(new Request("https://x", { headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" } })), "203.0.113.5");
  assert.equal(clientIp(new Request("https://x", { headers: { "x-forwarded-for": "<script>" } })), null);
});

test("los textos reales se renderizan sin placeholders pendientes y generan un PDF válido", async () => {
  const docs = migrationDocumentsSinDomicilio();
  const values = placeholderValues(
    { responsable_nombre: "Silvia López Fernández", responsable_dni: "03933796Z", email_contacto: "silozpsicologia@gmail.com", iban: "ES34 2100 7823 6213 0025 8116", plataforma_videollamada: "Google Meet" },
    { full_name: "Silvia López Fernández", dni: "03933796Z", collegiate_number: "M-40562", price_single_eur: 55, price_pack5_eur: 250, session_minutes: 50 }
  );
  const rendered = docs.map((d) => ({ ...d, ...renderTemplate(d.body_md, values) }));
  for (const d of rendered) assert.deepEqual(d.missing, [], `${d.doc_type} sin placeholders`);
  assert.match(rendered[0].text, /colegiada n\.º M-40562/);
  assert.match(rendered[1].text, /duración de 50 minutos/);
  assert.match(rendered[1].text, /55 euros por sesión suelta o de 250 euros/);
  const hash = await sha256Hex(canonicalText(rendered.map((d) => ({ title: d.title, version: d.version, text: d.text, checkbox_label: d.checkbox_label }))));
  assert.match(hash, /^[0-9a-f]{64}$/);

  const bytes = await buildConsentPdf({
    consentId: "00000000-0000-0000-0000-000000000001",
    signedAt: new Date("2026-11-08T10:00:00Z"),
    patient: { name: "Ana", surname: "Pérez Núñez", idNumber: "12345678Z", email: "ana@example.com", phone: "", birthdate: "1990-01-31" },
    therapist: { full_name: "Silvia López Fernández", dni: "03933796Z", collegiate_number: "M-40562" },
    responsable: { nombre: "Silvia López Fernández", dni: "03933796Z", email: "silozpsicologia@gmail.com" },
    reissue: { reissuedAt: new Date("2026-11-09T10:00:00Z"), signedVersions: [{ label: "A", version: "2.0" }] },
    documents: rendered.map((d, i) => ({ label: "ABC"[i], title: d.title, version: d.version, text: d.text, checkbox_label: d.checkbox_label })),
    signaturePng: png(60, 20, [[5, 5], [6, 6], [7, 7]]),
    ip: "203.0.113.5",
    userAgent: "Prueba 😀 con emoji",
    renderedTextSha256: hash,
  });
  const loaded = await PDFDocument.load(bytes);
  assert.ok(loaded.getPageCount() >= 4, "portada + 3 bloques + evidencias");
  assert.equal(loaded.getTitle(), "Siloz Psicología — Documentos de consentimiento");
  // El hash del archivo es estable para el mismo contenido.
  assert.equal(await sha256Hex(bytes), await sha256Hex(new Uint8Array(bytes)));
});

test("endpoints sin configurar o sin sesión", async () => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r1 = await consent(new Request("https://x/api/consent", { method: "POST", body: "{}" }));
  assert.equal(r1.status, 500);
  process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
  const r2 = await consent(new Request("https://x/api/consent", { method: "POST", body: "{}" }));
  assert.equal(r2.status, 401);
  const r3 = await consentFile(new Request("https://x/api/consent-file", { method: "GET" }));
  assert.equal(r3.status, 405);
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test("textos sin domicilio (A 2.1, B 2.1, C 1.1): sin dirección y con todos los datos", () => {
  const docs = migrationDocumentsSinDomicilio();
  assert.deepEqual(docs.map((d) => `${d.doc_type} ${d.version}`), ["privacy 2.1", "rules 2.1", "withdrawal 1.1"]);
  const values = placeholderValues(
    { responsable_nombre: "Silvia López Fernández", responsable_dni: "03933796Z", email_contacto: "silozpsicologia@gmail.com", iban: "ES34", plataforma_videollamada: "Google Meet" },
    { full_name: "Silvia López Fernández", dni: "03933796Z", collegiate_number: "M-40562", price_single_eur: 55, price_pack5_eur: 250, session_minutes: 50 }
  );
  for (const d of docs) {
    assert.doesNotMatch(d.body_md, /responsable_direccion|domicilio|dirección indicada|por escrito a/i, d.doc_type);
    assert.deepEqual(renderTemplate(d.body_md, values).missing, [], d.doc_type);
  }
  // Los textos antiguos ya no se pueden emitir: piden un dato que ya no existe.
  const old = migrationDocuments().find((d) => d.doc_type === "privacy")!;
  assert.deepEqual(renderTemplate(old.body_md, values).missing, ["responsable_direccion"]);
  // Fuera del domicilio, el texto es el mismo que el firmado.
  const strip = (t: string) => t.replace(/\s+/g, " ");
  const a20 = strip(old.body_md), a21 = strip(docs[0].body_md);
  assert.equal(a21.split("**Conservación.**")[1].split("**Derechos.**")[0], a20.split("**Conservación.**")[1].split("**Derechos.**")[0]);
});
