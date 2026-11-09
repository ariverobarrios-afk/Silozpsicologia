import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useLocation, useRoute } from "wouter";
import { AlertTriangle, ArrowLeft, Check, ChevronLeft, ChevronRight, CloudOff, Loader2, NotebookPen, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { supabase, type Appointment, type Profile, type SessionNotes } from "@/lib/supabase";
import { AppointmentItem } from "./AppointmentItem";
import { HighlightsPanel } from "./HighlightsPanel";
import { AreaLayout, RequireRole } from "./AreaLayout";
import { formatDayTitle, formatTime } from "./format";
import { nextSession, previousSession } from "./sessionNotes";

// Página de una sesión (/panel/sesion/<id de la cita>): aquí se gestiona todo
// lo de la sesión. De momento, sus notas y las notas para la próxima, que la
// siguiente cita del paciente hereda la reserve quien la reserve.

const MAX = 5000;
const AUTOSAVE_MS = 1500; // se guarda al dejar de escribir este tiempo
const RETRY_MS = 5000;

// Borrador local mientras hay cambios sin guardar: si se cierra la pestaña o
// el móvil la descarta, se recupera al volver. Se borra al guardarse y al
// cerrar sesión (AuthContext). `base` = lo que había guardado al empezar a
// escribir, para no pisar cambios hechos después desde otro dispositivo.
export const DRAFT_PREFIX = "siloz:notas-borrador:";
type Draft = { notes: string; next: string; base: { notes: string; next: string }; at: string };
const readDraft = (id: string): Draft | null => {
  try { return JSON.parse(localStorage.getItem(DRAFT_PREFIX + id) || "null"); } catch { return null; }
};
const writeDraft = (id: string, d: Draft) => {
  try { localStorage.setItem(DRAFT_PREFIX + id, JSON.stringify(d)); } catch { /* sin almacenamiento */ }
};
const clearDraft = (id: string) => {
  try { localStorage.removeItem(DRAFT_PREFIX + id); } catch { /* sin almacenamiento */ }
};

type SaveState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  | { kind: "offline" }
  | { kind: "error" };

function SaveStatus({ state, dirty }: { state: SaveState; dirty: boolean }) {
  const base = "flex items-center gap-1.5 text-sm";
  if (state.kind === "saving") return <span className={`${base} text-muted-foreground`}><Loader2 className="size-4 animate-spin" /> Guardando…</span>;
  if (state.kind === "offline") return <span className={`${base} text-amber-700`}><CloudOff className="size-4" /> Sin conexión: se guardará al volver</span>;
  if (state.kind === "error") return <span className={`${base} text-destructive`}><AlertTriangle className="size-4" /> No se pudo guardar. Reintentando…</span>;
  if (dirty) return <span className={`${base} text-muted-foreground`}>Cambios sin guardar…</span>;
  if (state.kind === "saved") {
    const hh = state.at.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    return <span className={`${base} text-primary`}><Check className="size-4" /> Guardado a las {hh}</span>;
  }
  return <span className={`${base} text-muted-foreground`}>Se guarda solo mientras escribes.</span>;
}

function SesionContent({ id }: { id: string }) {
  const [, setLocation] = useLocation();
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [patient, setPatient] = useState<Profile | null>(null);
  const [all, setAll] = useState<Appointment[]>([]);
  const [notesMap, setNotesMap] = useState<Map<string, SessionNotes>>(new Map());
  const [state, setState] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [notes, setNotes] = useState("");
  const [nextNotes, setNextNotes] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  // Lo último guardado en la base de datos (recortado) y lo que hay escrito ahora.
  const saved = useRef({ notes: "", next: "" });
  const latest = useRef({ notes: "", next: "" });
  latest.current = { notes, next: nextNotes };
  const saving = useRef(false);
  const again = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Borrador de este dispositivo que no se recupera solo (las notas cambiaron en otro sitio).
  const [conflict, setConflict] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    setState("loading");
    const { data: a, error } = await supabase.from("appointments").select("*").eq("id", id).maybeSingle();
    if (error) return setState("error");
    if (!a) return setState("notfound");
    const appt = a as Appointment;
    const [p, list] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", appt.patient_id).maybeSingle(),
      supabase.from("appointments").select("*").eq("patient_id", appt.patient_id).order("starts_at"),
    ]);
    if (p.error || list.error) return setState("error");
    const appts = (list.data as Appointment[]) ?? [];
    const n = await supabase
      .from("appointment_notes")
      .select("appointment_id, notes, next_notes")
      .in("appointment_id", appts.map((x) => x.id));
    if (n.error) return setState("error");
    const map = new Map(((n.data as SessionNotes[]) ?? []).map((x) => [x.appointment_id, x]));
    setAppointment(appt);
    setPatient((p.data as Profile | null) ?? null);
    setAll(appts);
    setNotesMap(map);
    const server = { notes: map.get(appt.id)?.notes ?? "", next: map.get(appt.id)?.next_notes ?? "" };
    saved.current = server;
    setNotes(server.notes);
    setNextNotes(server.next);
    // ¿Quedó algo sin guardar en este dispositivo?
    const draft = readDraft(appt.id);
    if (draft && (draft.notes.trim() !== server.notes || draft.next.trim() !== server.next)) {
      if (draft.base.notes === server.notes && draft.base.next === server.next) {
        setNotes(draft.notes);
        setNextNotes(draft.next);
        toast.info("Se han recuperado notas que no llegaron a guardarse. Se guardan ahora.");
      } else {
        setConflict(draft);
      }
    } else if (draft) {
      clearDraft(appt.id);
    }
    setState("ready");
    window.scrollTo({ top: 0 });
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const isDirty = () =>
    latest.current.notes.trim() !== saved.current.notes || latest.current.next.trim() !== saved.current.next;
  const dirty = state === "ready" && (notes.trim() !== saved.current.notes || nextNotes.trim() !== saved.current.next);

  // Guarda lo último escrito. Nunca hay dos guardados a la vez: si llega un
  // cambio mientras se guarda, se vuelve a guardar al terminar.
  const saveNow = useCallback(async (): Promise<boolean> => {
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    if (saving.current) { again.current = true; return false; }
    const row = { appointment_id: id, notes: latest.current.notes.trim(), next_notes: latest.current.next.trim() };
    if (row.notes === saved.current.notes && row.next_notes === saved.current.next) return true;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setSaveState({ kind: "offline" });
      return false;
    }
    saving.current = true;
    setSaveState({ kind: "saving" });
    const { error } = row.notes || row.next_notes
      ? await supabase!.from("appointment_notes").upsert(row)
      : await supabase!.from("appointment_notes").delete().eq("appointment_id", id);
    saving.current = false;
    if (error) {
      setSaveState({ kind: navigator.onLine === false ? "offline" : "error" });
      retryTimer.current = setTimeout(() => { void saveNow(); }, RETRY_MS);
      return false;
    }
    saved.current = { notes: row.notes, next: row.next_notes };
    setNotesMap((m) => new Map(m).set(id, row));
    setSaveState({ kind: "saved", at: new Date() });
    if (again.current) {
      again.current = false;
      return saveNow();
    }
    if (!isDirty()) clearDraft(id);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Al escribir: borrador local al momento y guardado al dejar de escribir.
  useEffect(() => {
    if (state !== "ready" || !isDirty()) return;
    const prev = readDraft(id);
    writeDraft(id, { notes, next: nextNotes, base: prev?.base ?? { ...saved.current }, at: new Date().toISOString() });
    setSaveState((s) => (s.kind === "saving" || s.kind === "offline" || s.kind === "error" ? s : { kind: "pending" }));
    const t = setTimeout(() => { void saveNow(); }, AUTOSAVE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, nextNotes, state, id, saveNow]);

  // Al recuperar la conexión, al ocultar la pestaña (cambiar de app en el
  // móvil) o al salir: se guarda en ese momento.
  useEffect(() => {
    const flush = () => { if (isDirty()) void saveNow(); };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("online", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveNow]);

  // Aviso al cerrar la pestaña con cambios sin guardar.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Al navegar dentro de la app se guarda antes; solo se pregunta si no se ha podido.
  const go = async (to: string) => {
    if (isDirty()) {
      await saveNow();
      if (isDirty() && !window.confirm("No se han podido guardar los últimos cambios de las notas (se conservan como borrador en este dispositivo). ¿Salir igualmente?")) return;
    }
    setLocation(to);
  };
  // Enlaces de verdad (se pueden abrir en otra pestaña); el clic normal
  // navega dentro de la app y avisa si hay notas sin guardar.
  const link = (to: string) => ({
    href: to,
    onClick: (e: MouseEvent<HTMLAnchorElement>) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      void go(to);
    },
  });


  if (state === "loading") {
    return (
      <AreaLayout title="Sesión">
        <Spinner className="size-6 text-primary" />
      </AreaLayout>
    );
  }
  if (state !== "ready" || !appointment) {
    return (
      <AreaLayout title="Sesión">
        <p className="mb-4 text-muted-foreground">
          {state === "notfound" ? "Esta cita no existe (puede que se haya borrado)." : "No se pudo cargar la sesión. Recarga la página."}
        </p>
        <Button variant="outline" onClick={() => setLocation("/panel")}>
          <ArrowLeft className="size-4" /> Volver a la agenda
        </Button>
      </AreaLayout>
    );
  }

  const prev = previousSession(all, appointment);
  const next = nextSession(all, appointment);
  const inherited = prev ? notesMap.get(prev.id)?.next_notes.trim() ?? "" : "";
  const name = patient?.full_name || patient?.email || "Paciente";
  const shortDate = (a: Appointment) => `${formatDayTitle(a.starts_at)}, ${formatTime(a.starts_at)}`;

  return (
    <AreaLayout title={name}>
      <div className="flex max-w-3xl flex-col gap-6">
        <div className="-mt-2 flex flex-wrap items-center gap-2 md:-mt-4">
          <Button asChild variant="ghost" size="sm" className="-ml-3">
            <a {...link("/panel")}><ArrowLeft className="size-4" /> Agenda</a>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a {...link(`/panel#paciente/${appointment.patient_id}`)}><User className="size-4" /> Ficha del paciente</a>
          </Button>
        </div>

        <ul><AppointmentItem appointment={appointment} /></ul>

        <section className="rounded-2xl border border-primary/30 bg-primary/10 p-4">
          <p className="flex items-center gap-2 font-medium text-foreground">
            <NotebookPen className="size-4 text-primary" /> Para esta sesión
          </p>
          {!prev ? (
            <p className="mt-1 text-sm text-muted-foreground">Es su primera sesión: no hay notas de una sesión anterior.</p>
          ) : inherited ? (
            <>
              <p className="mt-1 text-xs text-muted-foreground">Lo que apuntaste en la sesión anterior ({shortDate(prev)}):</p>
              <p className="mt-2 whitespace-pre-line text-foreground">{inherited}</p>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              No dejaste notas para esta sesión en la anterior ({shortDate(prev)}).
            </p>
          )}
        </section>

        {conflict && (
          <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p>
              <strong>Hay notas de este dispositivo que no llegaron a guardarse</strong> ({new Date(conflict.at).toLocaleString("es-ES")}),
              pero desde entonces las notas se han cambiado en otro sitio. ¿Qué quieres conservar?
            </p>
            <div className="max-h-40 overflow-y-auto whitespace-pre-line rounded-md border border-amber-200 bg-white/70 p-2 text-xs">
              {conflict.notes || "—"}{conflict.next ? `\n\nPara la próxima: ${conflict.next}` : ""}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => {
                setNotes(conflict.notes); setNextNotes(conflict.next);
                writeDraft(id, { ...conflict, base: { ...saved.current } });
                setConflict(null);
              }}>Usar el borrador</Button>
              <Button size="sm" variant="ghost" onClick={() => { clearDraft(id); setConflict(null); }}>Descartarlo</Button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="session-notes">Notas de la sesión</Label>
          <Textarea id="session-notes" rows={8} className="min-h-40" maxLength={MAX} value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Qué se ha trabajado, cómo ha ido, cosas importantes…" />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="next-notes">Notas para la próxima sesión</Label>
          <Textarea id="next-notes" rows={5} className="min-h-28" maxLength={MAX} value={nextNotes}
            onChange={(e) => setNextNotes(e.target.value)}
            placeholder="Objetivos para la siguiente, qué retomar, tareas que le has propuesto…" />
          <p className="text-xs text-muted-foreground">
            {next
              ? `Aparecerán en su próxima cita (${shortDate(next)}).`
              : "Aparecerán en su próxima cita en cuanto se reserve, la reserves tú o el paciente."}
            {" "}Solo las ves tú: el paciente no.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3" aria-live="polite">
          <SaveStatus state={saveState} dirty={dirty} />
          <Button onClick={() => void saveNow()} disabled={!dirty || saveState.kind === "saving"} variant="outline" className="rounded-full">
            Guardar ahora
          </Button>
        </div>

        <HighlightsPanel appointmentId={appointment.id} patientId={appointment.patient_id}
          saved={saved.current}
          ensureSaved={async () => { await saveNow(); return !isDirty(); }} />

        {(prev || next) && (
          <nav className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
            {prev ? (
              <Button asChild variant="ghost" size="sm">
                <a {...link(`/panel/sesion/${prev.id}`)}><ChevronLeft className="size-4" /> Sesión anterior</a>
              </Button>
            ) : <span />}
            {next && (
              <Button asChild variant="ghost" size="sm">
                <a {...link(`/panel/sesion/${next.id}`)}>Sesión siguiente <ChevronRight className="size-4" /></a>
              </Button>
            )}
          </nav>
        )}
      </div>
    </AreaLayout>
  );
}

export default function Sesion() {
  const [, params] = useRoute("/panel/sesion/:id");
  return (
    <RequireRole role="admin">
      {params?.id ? <SesionContent key={params.id} id={params.id} /> : null}
    </RequireRole>
  );
}
