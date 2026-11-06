import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cuando,
  emailCancelacionPsicologa,
  emailConfirmacionPaciente,
  emailReservaPsicologa,
  rpcErrorResponse,
  type BookingInfo,
} from "../server/booking";
import { enviarEmail } from "../server/email";
import bookSlot from "../api/book-slot";
import cancelBooking from "../api/cancel-booking";

const booking: BookingInfo = {
  appointment_id: "11111111-1111-1111-1111-111111111111",
  starts_at: "2026-11-16T09:00:00Z",
  ends_at: "2026-11-16T10:00:00Z",
  duration_minutes: 60,
  comment: "Prefiero <b>videollamada</b>",
  patient_name: "Ana Pérez",
  patient_email: "ana@example.com",
  psychologist_name: "Silvia",
  psychologist_email: "silvia@example.com",
  cancel_limit_hours: 24,
};

test("errores de la base de datos → respuesta clara", async () => {
  const cases: Array<[string, number, string]> = [
    ["SLOT_UNAVAILABLE", 409, "slot_unavailable"],
    ["WEEK_LIMIT", 409, "week_limit"],
    ["CANCEL_TOO_LATE", 409, "too_late"],
    ["NOT_ALLOWED", 403, "not_allowed"],
  ];
  for (const [dbError, status, code] of cases) {
    const r = rpcErrorResponse(dbError, "x");
    assert.equal(r.status, status);
    assert.equal((await r.json()).code, code);
  }
  const week = await rpcErrorResponse("WEEK_LIMIT", "x").json();
  assert.match(week.message, /Ya tienes una cita esta semana.*psicóloga/);
});

test("email a la psicóloga al reservar", () => {
  const e = emailReservaPsicologa(booking, "https://silozpsicologia.com");
  assert.equal(e.para, "silvia@example.com");
  assert.equal(e.asunto, "Nueva cita reservada: Ana Pérez — lunes 16/11/2026 a las 10:00");
  assert.match(e.texto, /Hora: 10:00 – 11:00/);
  assert.match(e.texto, /Duración: 60 min/);
  assert.match(e.texto, /Comentario: Prefiero <b>videollamada<\/b>/);
  assert.match(e.texto, /https:\/\/silozpsicologia\.com\/panel#cita\/11111111/);
  assert.ok(e.html.includes("&lt;b&gt;videollamada"), "el comentario se escapa en el HTML");
  assert.equal(e.responderA, "ana@example.com");
});

test("email de cancelación y confirmación al paciente", () => {
  const c = emailCancelacionPsicologa(booking, "https://x.test", true);
  assert.equal(c.asunto, `Cita cancelada por el paciente: Ana Pérez — ${cuando(booking.starts_at)}`);
  const p = emailConfirmacionPaciente(booking, "https://x.test");
  assert.equal(p.para, "ana@example.com");
  assert.match(p.texto, /hasta 24 horas antes/);
  assert.match(p.texto, /Psicóloga: Silvia/);
});

test("enviarEmail no lanza si falta la configuración", async () => {
  delete process.env.RESEND_API_KEY;
  const r = await enviarEmail({ para: "a@b.c", asunto: "x", html: "x", texto: "x" });
  assert.deepEqual(r, { ok: false, error: "missing_api_key" });
});

test("los endpoints rechazan peticiones sin sesión", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  for (const handler of [bookSlot, cancelBooking]) {
    const get = await handler(new Request("https://x.test/api", { method: "GET" }));
    assert.equal(get.status, 405);
    const anon = await handler(new Request("https://x.test/api", { method: "POST", body: "{}" }));
    assert.equal(anon.status, 401);
  }
});
