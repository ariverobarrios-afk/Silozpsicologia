import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIcs, initials, psicolinkDays } from "../shared/ics";
import calendar from "../api/calendar";

test("iCalendar: cabecera, eventos con hora y de día completo, escapado", () => {
  const ics = buildIcs({
    name: "Siloz Psicología",
    now: new Date("2026-11-09T10:00:00Z"),
    events: [
      { uid: "a1@silozpsicologia.com", start: new Date("2026-08-27T16:00:00Z"), end: new Date("2026-08-27T16:50:00Z"),
        summary: "Sesión – A.R.B.", description: "Online; sesión individual\nhttps://x", url: "https://silozpsicologia.com/panel" },
      { uid: "p1@silozpsicologia.com", start: new Date(), end: new Date(), allDay: "2026-08-26", summary: "Psicolink" },
    ],
  });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.match(ics, /\r\nDTSTART:20260827T160000Z\r\nDTEND:20260827T165000Z\r\n/);
  assert.match(ics, /\r\nDTSTART;VALUE=DATE:20260826\r\nDTEND;VALUE=DATE:20260827\r\n/);
  assert.match(ics, /DESCRIPTION:Online\\; sesión individual\\nhttps:\/\/x/);
  assert.match(ics, /DTSTAMP:20261109T100000Z/);
  // Ninguna línea supera los 75 octetos.
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
});

test("líneas largas se pliegan sin romper caracteres", () => {
  const long = "Sesión ".repeat(30);
  const ics = buildIcs({ name: "x", events: [{ uid: "u", start: new Date(0), end: new Date(0), summary: long }] });
  const unfolded = ics.replace(/\r\n /g, "");
  assert.ok(unfolded.includes(`SUMMARY:${long}`));
});

test("iniciales", () => {
  assert.equal(initials("Alberto Rivero Barrios"), "A.R.B.");
  assert.equal(initials("María José de la Peña"), "M.J.P.");
  assert.equal(initials(""), "Paciente");
});

test("días de Psicolink: miércoles y viernes salvo cambios", () => {
  // Del lunes 24 al domingo 30 de agosto de 2026.
  assert.deepEqual(psicolinkDays("2026-08-24", "2026-08-30", new Map()), ["2026-08-26", "2026-08-28"]);
  assert.deepEqual(psicolinkDays("2026-08-24", "2026-08-30", new Map([["2026-08-26", false], ["2026-08-24", true]])), ["2026-08-24", "2026-08-28"]);
});

test("endpoint del calendario: sin token o sin configurar", async () => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.equal((await calendar(new Request("https://x/api/calendar?t=" + "a".repeat(64)))).status, 500);
  process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
  assert.equal((await calendar(new Request("https://x/api/calendar"))).status, 404);
  assert.equal((await calendar(new Request("https://x/api/calendar?t=corto"))).status, 404);
  assert.equal((await calendar(new Request("https://x/api/calendar?t=" + "a".repeat(64), { method: "POST" }))).status, 405);
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test("endpoint del calendario: lo que ve la psicóloga y lo que ve el paciente", async () => {
  const realFetch = globalThis.fetch;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "x";
  const soon = new Date(Date.now() + 7 * 86_400_000);
  soon.setUTCHours(16, 0, 0, 0);
  const tables: Record<string, unknown> = {
    calendar_feeds: { user_id: "U" },
    appointments: [
      { id: "a1", patient_id: "P", starts_at: soon.toISOString(), duration_minutes: 50, session_type: "individual", modality: "online" },
    ],
    agenda_events: [{ id: "e1", title: "Reunión de equipo", starts_at: soon.toISOString(), duration_minutes: 60 }],
    agenda_days: [],
  };
  let me = { id: "U", role: "admin", active: true, full_name: "Silvia", psychologist_id: null as string | null };
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const table = url.pathname.split("/").pop()!;
    let body: unknown = tables[table] ?? [];
    if (table === "profiles") {
      const id = url.searchParams.get("id") ?? "";
      body = id.startsWith("in.") ? [{ id: "P", full_name: "Alberto Rivero Barrios" }] : id === "eq.U" ? me : { full_name: "Silvia López" };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const url = "https://silozpsicologia.com/api/calendar?t=" + "a".repeat(64);
    const admin = await (await calendar(new Request(url))).text();
    assert.match(admin, /X-WR-CALNAME:Siloz Psicología – Agenda/);
    assert.match(admin, /SUMMARY:Sesión – A\.R\.B\./);
    assert.doesNotMatch(admin, /Alberto|Rivero|Barrios/);
    assert.match(admin, /SUMMARY:Reunión de equipo/);
    assert.match(admin, /SUMMARY:Psicolink/);
    assert.match(admin.replace(/\r\n /g, ""), /URL:https:\/\/silozpsicologia\.com\/panel\/sesion\/a1/);

    me = { id: "U", role: "patient", active: true, full_name: "Alberto Rivero Barrios", psychologist_id: "S" };
    const patient = await (await calendar(new Request(url))).text();
    assert.match(patient, /SUMMARY:Sesión con Silvia – Siloz Psicología/);
    assert.doesNotMatch(patient, /Reunión|Psicolink|panel/);

    me = { ...me, active: false };
    assert.equal((await calendar(new Request(url))).status, 404);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});
