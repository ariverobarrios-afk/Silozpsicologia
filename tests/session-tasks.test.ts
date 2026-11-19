import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptFor, checkFile, formatBytes, isInlineImage, MAX_FILE_BYTES } from "../shared/sessionTasks";
import { emailRespuestaTarea } from "../server/sessionTasks";
import sessionTasks from "../api/session-tasks";

test("documentos de la sesión: solo PDF", () => {
  const ok = checkFile("documento", "Registro de pensamientos.PDF", 1000);
  assert.deepEqual(ok, { ok: true, ext: "pdf", mime: "application/pdf", name: "Registro de pensamientos.PDF" });
  assert.equal(checkFile("documento", "foto.png", 1000).ok, false);
  assert.equal(checkFile("documento", "sin-extension", 1000).ok, false);
  assert.equal(acceptFor("documento"), ".pdf");
});

test("imagen de la tarea: solo imágenes", () => {
  assert.equal(checkFile("imagen_tarea", "esquema.jpeg", 10).ok, true);
  assert.equal(checkFile("imagen_tarea", "hoja.pdf", 10).ok, false);
  assert.equal(checkFile("imagen_tarea", "dibujo.svg", 10).ok, false, "SVG no: puede llevar scripts");
});

test("adjuntos del paciente: imágenes, PDF y documentos; nada ejecutable", () => {
  for (const name of ["foto.HEIC", "tarea.pdf", "diario.docx", "notas.txt", "carta.odt"]) {
    assert.equal(checkFile("respuesta", name, 10).ok, true, name);
  }
  for (const name of ["pagina.html", "virus.exe", "macro.docm", "dibujo.svg", "script.js", "pdf", ""]) {
    assert.equal(checkFile("respuesta", name, 10).ok, false, name);
  }
  // El tipo sale de la extensión, no de lo que diga el navegador.
  const r = checkFile("respuesta", "C:\\fotos\\..\\mi foto.JPG", 10);
  assert.ok(r.ok && r.mime === "image/jpeg" && r.name === "mi foto.JPG");
});

test("tamaño: ni vacío ni más de 20 MB", () => {
  assert.equal(checkFile("respuesta", "a.pdf", 0).ok, false);
  assert.equal(checkFile("respuesta", "a.pdf", Number.NaN).ok, false);
  assert.equal(checkFile("respuesta", "a.pdf", MAX_FILE_BYTES).ok, true);
  const big = checkFile("respuesta", "a.pdf", MAX_FILE_BYTES + 1);
  assert.ok(!big.ok && /20 MB/.test(big.message));
  assert.equal(formatBytes(500), "1 KB");
  assert.equal(formatBytes(1536 * 1024), "1,5 MB");
  assert.equal(isInlineImage("image/png"), true);
  assert.equal(isInlineImage("image/heic"), false);
});

test("email a la psicóloga: avisa sin incluir la respuesta", () => {
  const e = emailRespuestaTarea({
    task_id: "22222222-2222-2222-2222-222222222222",
    appointment_id: "11111111-1111-1111-1111-111111111111",
    starts_at: "2026-11-16T09:00:00Z",
    answered_at: "2026-11-18T09:00:00Z",
    changed: true,
    patient_name: "Ana <Pérez>",
    patient_email: "ana@example.com",
    psychologist_email: "silvia@example.com",
  }, "https://silozpsicologia.com");
  assert.equal(e.para, "silvia@example.com");
  assert.equal(e.asunto, "Tarea respondida: Ana <Pérez> — sesión del 16/11/2026");
  assert.match(e.texto, /https:\/\/silozpsicologia\.com\/panel\/sesion\/11111111-1111-1111-1111-111111111111#tareas/);
  assert.ok(e.html.includes("Ana &lt;Pérez&gt;"), "el nombre se escapa en el HTML");
});

test("el endpoint rechaza peticiones sin sesión", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  const get = await sessionTasks(new Request("https://x.test/api", { method: "GET" }));
  assert.equal(get.status, 405);
  const anon = await sessionTasks(new Request("https://x.test/api", { method: "POST", body: "{}" }));
  assert.equal(anon.status, 401);
});
