// Función serverless de Vercel (Edge): calendario para suscribirse desde Google
// Calendar, Calendario de Apple u Outlook («Desde URL»).
//
//   GET /api/calendar?t=<token>
//
// El token (calendar_feeds) es privado y revocable: quien lo tenga ve el
// calendario, por eso se puede generar uno nuevo desde la web. Sin sesión,
// porque Google lo descarga desde sus servidores.
//   · Psicóloga: sus citas (con iniciales del paciente, nunca el nombre ni
//     notas), sus eventos y los días de Psicolink.
//   · Paciente: solo sus citas («Sesión con Silvia – Siloz Psicología»).
// No incluye citas canceladas. Va de 90 días atrás a un año vista.
// Variables: SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLIC_URL } from "../shared/supabasePublic";
import { appUrl } from "../server/booking";
import { env } from "../server/email";
import { buildIcs, initials, psicolinkDays, type IcsEvent } from "../shared/ics";

export const config = { runtime: "edge" };

const TOKEN_RE = /^[0-9a-f]{64}$/;
const DAY = 86_400_000;
const text = (body: string, status: number) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") return text("Método no permitido", 405);
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return text("Calendario no configurado", 500);
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!TOKEN_RE.test(token)) return text("Calendario no encontrado", 404);

  const admin = createClient(env("SUPABASE_URL") || SUPABASE_PUBLIC_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: feed } = await admin.from("calendar_feeds").select("user_id").eq("token", token).maybeSingle();
  if (!feed) return text("Calendario no encontrado", 404);
  const { data: me } = await admin.from("profiles")
    .select("id, role, active, full_name, psychologist_id").eq("id", feed.user_id).maybeSingle();
  if (!me || !me.active) return text("Calendario no encontrado", 404);

  const base = appUrl(req);
  const now = Date.now();
  const from = new Date(now - 90 * DAY).toISOString();
  const to = new Date(now + 365 * DAY).toISOString();
  const events: IcsEvent[] = [];
  const end = (startsAt: string, minutes: number) => new Date(new Date(startsAt).getTime() + minutes * 60_000);

  if (me.role === "admin") {
    const [{ data: appts }, { data: agenda }, { data: days }] = await Promise.all([
      admin.from("appointments").select("id, patient_id, starts_at, duration_minutes, session_type, modality")
        .neq("status", "cancelada").gte("starts_at", from).lte("starts_at", to),
      admin.from("agenda_events").select("id, title, starts_at, duration_minutes").gte("starts_at", from).lte("starts_at", to),
      admin.from("agenda_days").select("day, psicolink").gte("day", from.slice(0, 10)).lte("day", to.slice(0, 10)),
    ]);
    const ids = [...new Set((appts ?? []).map((a) => a.patient_id))];
    const { data: patients } = ids.length
      ? await admin.from("profiles").select("id, full_name").in("id", ids)
      : { data: [] as Array<{ id: string; full_name: string }> };
    const nameOf = new Map((patients ?? []).map((p) => [p.id, p.full_name ?? ""]));
    for (const a of appts ?? []) {
      const label = a.session_type === "primera" ? "Primera sesión" : "Sesión";
      events.push({
        uid: `cita-${a.id}@silozpsicologia.com`,
        start: new Date(a.starts_at),
        end: end(a.starts_at, a.duration_minutes),
        summary: `${label} – ${initials(nameOf.get(a.patient_id) ?? "")}`,
        description: `${a.duration_minutes} min · ${a.modality === "online" ? "Online" : "Presencial"}\nAbrir en el panel: ${base}/panel/sesion/${a.id}`,
        url: `${base}/panel/sesion/${a.id}`,
      });
    }
    for (const e of agenda ?? []) {
      events.push({
        uid: `evento-${e.id}@silozpsicologia.com`,
        start: new Date(e.starts_at),
        end: end(e.starts_at, e.duration_minutes),
        summary: e.title,
      });
    }
    const overrides = new Map((days ?? []).map((d) => [d.day as string, d.psicolink as boolean]));
    for (const day of psicolinkDays(from.slice(0, 10), to.slice(0, 10), overrides)) {
      events.push({ uid: `psicolink-${day}@silozpsicologia.com`, start: new Date(), end: new Date(), allDay: day, summary: "Psicolink" });
    }
  } else {
    const [{ data: appts }, { data: psych }] = await Promise.all([
      admin.from("appointments").select("id, starts_at, duration_minutes, modality")
        .eq("patient_id", me.id).neq("status", "cancelada").gte("starts_at", from).lte("starts_at", to),
      me.psychologist_id
        ? admin.from("profiles").select("full_name").eq("id", me.psychologist_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const psychName = (psych?.full_name ?? "").split(" ")[0] || "tu psicóloga";
    for (const a of appts ?? []) {
      events.push({
        uid: `cita-${a.id}@silozpsicologia.com`,
        start: new Date(a.starts_at),
        end: end(a.starts_at, a.duration_minutes),
        summary: `Sesión con ${psychName} – Siloz Psicología`,
        description: `Sesión ${a.modality === "online" ? "online" : "presencial"} de ${a.duration_minutes} min.\nTus citas: ${base}/mi-area`,
        url: `${base}/mi-area`,
      });
    }
  }

  const ics = buildIcs({ name: me.role === "admin" ? "Siloz Psicología – Agenda" : "Siloz Psicología", events });
  return new Response(req.method === "HEAD" ? null : ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="siloz-psicologia.ics"',
      "Cache-Control": "private, max-age=300",
    },
  });
}
