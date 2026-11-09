import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ageOn,
  canonicalText,
  formErrors,
  formatEuros,
  isValidDniNie,
  madridToday,
  missingFields,
  parseParagraphs,
  placeholderValues,
  renderTemplate,
  splitFullName,
} from "../shared/consent";

const settings = {
  responsable_nombre: "Silvia López Fernández",
  responsable_dni: "03933796Z",
  email_contacto: "silozpsicologia@gmail.com",
  iban: "ES34 2100 7823 6213 0025 8116",
  plataforma_videollamada: "Google Meet",
};
const therapist = {
  full_name: "Silvia López Fernández",
  dni: "03933796Z",
  collegiate_number: "M-40562",
  price_single_eur: "55.00",
  price_pack5_eur: 250,
  session_minutes: 50,
};

test("DNI y NIE con letra de control", () => {
  assert.equal(isValidDniNie("03933796Z"), true);
  assert.equal(isValidDniNie("03933796-z"), true);
  assert.equal(isValidDniNie("03933796A"), false);
  assert.equal(isValidDniNie("12345678Z"), true);
  assert.equal(isValidDniNie("X1234567L"), true);
  assert.equal(isValidDniNie("Y1234567X"), true);
  assert.equal(isValidDniNie("X1234567A"), false);
  assert.equal(isValidDniNie("1234567Z"), false);
  assert.equal(isValidDniNie(""), false);
});

test("edad y mayoría de edad", () => {
  assert.equal(ageOn("2008-11-08", "2026-11-08"), 18);
  assert.equal(ageOn("2008-11-09", "2026-11-08"), 17);
  const today = "2026-11-08";
  const base = { name: "Ana", surname: "Pérez", idNumber: "12345678Z", email: "a@b.es", phone: "", birthdate: "1990-05-01" };
  assert.deepEqual(formErrors(base, today), {});
  assert.match(formErrors({ ...base, birthdate: "2010-01-01" }, today).birthdate ?? "", /menores/);
  assert.match(formErrors({ ...base, birthdate: "2027-01-01" }, today).birthdate ?? "", /no válida/);
  assert.match(formErrors({ ...base, idNumber: "12345678A" }, today).idNumber ?? "", /letra/);
  assert.match(formErrors({ ...base, email: "x@" }, today).email ?? "", /Email/);
});

test("campos obligatorios que faltan", () => {
  const form = { name: "Ana", surname: "", idNumber: "", email: "a@b.es", phone: "", birthdate: "" };
  assert.deepEqual(missingFields(form), ["surname", "idNumber", "birthdate"]);
});

test("placeholders: se sustituyen todos y se detectan los que faltan", () => {
  const values = placeholderValues(settings, therapist);
  assert.equal(values.precio_sesion, "55");
  assert.equal(values.duracion_sesion, "50");
  const { text, missing } = renderTemplate("{{profesional_nombre}} ({{profesional_colegiada}}) cobra {{precio_sesion}} €, {{nada}}", values);
  assert.equal(text, "Silvia López Fernández (M-40562) cobra 55 €, {{nada}}");
  assert.deepEqual(missing, ["nada"]);
  assert.equal(formatEuros("49.5"), "49,50");
});

test("párrafos y negritas", () => {
  const p = parseParagraphs("**Uno.** texto\ncontinúa\n\nDos **fuerte** fin");
  assert.equal(p.length, 2);
  assert.deepEqual(p[0], [{ text: "Uno.", bold: true }, { text: " texto continúa", bold: false }]);
  assert.deepEqual(p[1][1], { text: "fuerte", bold: true });
});

test("texto canónico estable (es lo que se hashea)", () => {
  const docs = [{ title: "A", version: "2.0", text: "**Hola.** mundo", checkbox_label: "Acepto" }];
  assert.equal(canonicalText(docs), "A (versión 2.0)\n\nHola. mundo\n\n[X] Acepto");
});

test("nombre completo → nombre y apellidos", () => {
  assert.deepEqual(splitFullName("Alberto Rivero Barrios"), { name: "Alberto", surname: "Rivero Barrios" });
  assert.deepEqual(splitFullName("Silvia"), { name: "Silvia", surname: "" });
});

test("hoy en Madrid", () => {
  // 23:30 UTC del 31/12 ya es 1/1 en Madrid.
  assert.equal(madridToday(new Date("2026-12-31T23:30:00Z")), "2027-01-01");
});
