import { test } from "node:test";
import assert from "node:assert/strict";
import { madridDayKey, madridLongDay, madridTime, madridWeekKey } from "../shared/madrid";
import { canCancelOnline } from "../shared/bookingRules";

test("un hueco creado a las 10:00 de Madrid se muestra a las 10:00 (invierno y verano)", () => {
  assert.equal(madridTime("2026-11-16T09:00:00Z"), "10:00"); // CET (UTC+1)
  assert.equal(madridTime("2026-07-13T08:00:00Z"), "10:00"); // CEST (UTC+2)
});

test("la semana va de lunes a domingo en hora de Madrid", () => {
  // Lunes 16/11/2026 00:30 en Madrid = domingo 15 a las 23:30 UTC.
  assert.equal(madridWeekKey("2026-11-15T23:30:00Z"), "2026-11-16");
  // Domingo 22/11/2026 23:30 en Madrid sigue en la misma semana.
  assert.equal(madridWeekKey("2026-11-22T22:30:00Z"), "2026-11-16");
  // Lunes siguiente: semana nueva.
  assert.equal(madridWeekKey("2026-11-22T23:30:00Z"), "2026-11-23");
  // Martes con cita manual y lunes con hueco: misma semana.
  assert.equal(madridWeekKey("2026-11-17T15:00:00Z"), madridWeekKey("2026-11-16T09:00:00Z"));
  // Semana que cruza de año.
  assert.equal(madridWeekKey("2027-01-01T10:00:00Z"), "2026-12-28");
});

test("agrupar por día y nombre del día en español", () => {
  assert.equal(madridDayKey("2026-11-15T23:30:00Z"), "2026-11-16");
  assert.equal(madridLongDay("2026-11-16T09:00:00Z"), "lunes, 16 de noviembre");
});

test("cancelación online solo con más de 24 h", () => {
  const now = Date.parse("2026-11-10T10:00:00Z");
  assert.equal(canCancelOnline("2026-11-11T10:00:01Z", 24, now), true);
  assert.equal(canCancelOnline("2026-11-11T10:00:00Z", 24, now), false); // justo 24 h: no
  assert.equal(canCancelOnline("2026-11-10T20:00:00Z", 24, now), false);
});
