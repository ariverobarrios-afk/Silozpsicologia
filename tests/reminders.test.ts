import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emailRecordatorioCita,
  emailRecordatorioPago,
  groupDebts,
  paymentReminderDue,
  reminderDue,
} from "../server/reminders";
import handler from "../api/reminders";

const patient = { id: "p1", full_name: "Ana Pérez", email: "ana@example.com", invited_at: "2026-11-01T10:00:00Z" };

test("recordatorio de cita: día y hora de Madrid, sin datos de la psicóloga", () => {
  const e = emailRecordatorioCita(
    { id: "a1", patient_id: "p1", starts_at: "2026-11-25T09:00:00Z", duration_minutes: 60, modality: "online" },
    patient,
    "https://silozpsicologia.com"
  );
  assert.equal(e.para, "ana@example.com");
  assert.equal(e.asunto, "Recordatorio: sesión el miércoles 25/11/2026 a las 10:00");
  assert.match(e.texto, /Miércoles, 25 de noviembre de 2026/);
  assert.match(e.texto, /10:00 – 11:00/);
  assert.match(e.texto, /Hola, Ana\./);
  assert.match(e.texto, /https:\/\/silozpsicologia\.com\/mi-area/);
  assert.doesNotMatch(e.texto + e.html, /Silvia/i);
  assert.equal(e.responderA, undefined);
});

test("recordatorio de cita: sin enlace al área si no tiene acceso", () => {
  const e = emailRecordatorioCita(
    { id: "a1", patient_id: "p1", starts_at: "2026-11-25T09:00:00Z", duration_minutes: 60, modality: "presencial" },
    { ...patient, invited_at: null },
    "https://silozpsicologia.com"
  );
  assert.doesNotMatch(e.texto, /mi-area/);
});

test("se avisa entre 24 h y 12 h antes", () => {
  const now = new Date("2026-11-24T09:00:00Z");
  assert.equal(reminderDue("2026-11-25T09:00:00Z", now), true); // 24 h justas
  assert.equal(reminderDue("2026-11-25T09:10:00Z", now), false); // aún no
  assert.equal(reminderDue("2026-11-24T22:00:00Z", now), true); // 13 h
  assert.equal(reminderDue("2026-11-24T20:00:00Z", now), false); // cita acordada a última hora
  assert.equal(reminderDue("2026-11-24T08:00:00Z", now), false); // ya pasó
});

test("los recordatorios de pago salen el domingo a partir de las 10 (Madrid)", () => {
  assert.equal(paymentReminderDue(new Date("2026-11-29T08:30:00Z")), false); // domingo 9:30
  assert.equal(paymentReminderDue(new Date("2026-11-29T09:00:00Z")), true); // domingo 10:00
  assert.equal(paymentReminderDue(new Date("2026-11-29T22:30:00Z")), true); // domingo 23:30
  assert.equal(paymentReminderDue(new Date("2026-11-29T23:30:00Z")), false); // ya es lunes
  assert.equal(paymentReminderDue(new Date("2026-11-28T12:00:00Z")), false); // sábado
});

test("recordatorio de pago: sesiones, importes y total", () => {
  const debts = groupDebts(
    [
      { patient_id: "p1", starts_at: "2026-11-18T09:00:00Z", price_cents: 5500 },
      { patient_id: "p1", starts_at: "2026-11-11T09:00:00Z", price_cents: 5550 },
      { patient_id: "p2", starts_at: "2026-11-12T09:00:00Z", price_cents: 7000 },
    ],
    [{ patient_id: "p2", created_at: "2026-11-01T09:00:00Z", price_cents: 25000, sessions_total: 5 }]
  );
  assert.deepEqual(debts.get("p1")!.map((d) => d.date), ["2026-11-11T09:00:00Z", "2026-11-18T09:00:00Z"]);

  const e = emailRecordatorioPago(patient, debts.get("p1")!);
  assert.equal(e.asunto, "Recordatorio de pago: 110,50 € pendientes");
  assert.match(e.texto, /Sesión del miércoles 11\/11\/2026: 55,50 €/);
  assert.match(e.texto, /Sesión del miércoles 18\/11\/2026: 55 €/);
  assert.match(e.texto, /Total pendiente: 110,50 €/);
  assert.doesNotMatch(e.texto + e.html, /Silvia/i);

  const e2 = emailRecordatorioPago({ ...patient, id: "p2" }, debts.get("p2")!);
  assert.match(e2.texto, /Bono de 5 sesiones \(01\/11\/2026\): 250 €/);
  assert.match(e2.texto, /Total pendiente: 320 €/);
});

test("api/reminders rechaza llamadas sin token válido", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  const call = (init: RequestInit) => handler(new Request("https://example.com/api/reminders", init));
  assert.equal((await call({ method: "GET" })).status, 405);
  assert.equal((await call({ method: "POST", body: "{}" })).status, 401);
  assert.equal((await call({ method: "POST", body: JSON.stringify({ token: "nope" }) })).status, 401);
});
