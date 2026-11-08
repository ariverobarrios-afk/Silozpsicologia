import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { useLocation, useRoute } from "wouter";
import { ArrowLeft, ChevronLeft, ChevronRight, NotebookPen, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { supabase, type Appointment, type Profile, type SessionNotes } from "@/lib/supabase";
import { AppointmentItem } from "./AppointmentItem";
import { AreaLayout, RequireRole } from "./AreaLayout";
import { formatDayTitle, formatTime } from "./format";
import { nextSession, previousSession } from "./sessionNotes";

// Página de una sesión (/panel/sesion/<id de la cita>): aquí se gestiona todo
// lo de la sesión. De momento, sus notas y las notas para la próxima, que la
// siguiente cita del paciente hereda la reserve quien la reserve.

const MAX = 5000;

function SesionContent({ id }: { id: string }) {
  const [, setLocation] = useLocation();
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [patient, setPatient] = useState<Profile | null>(null);
  const [all, setAll] = useState<Appointment[]>([]);
  const [notesMap, setNotesMap] = useState<Map<string, SessionNotes>>(new Map());
  const [state, setState] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [notes, setNotes] = useState("");
  const [nextNotes, setNextNotes] = useState("");
  const [busy, setBusy] = useState(false);

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
    setNotes(map.get(appt.id)?.notes ?? "");
    setNextNotes(map.get(appt.id)?.next_notes ?? "");
    setState("ready");
    window.scrollTo({ top: 0 });
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const savedNotes = notesMap.get(id)?.notes ?? "";
  const savedNext = notesMap.get(id)?.next_notes ?? "";
  const dirty = notes.trim() !== savedNotes.trim() || nextNotes.trim() !== savedNext.trim();

  // Aviso al cerrar la pestaña con cambios sin guardar.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const go = (to: string) => {
    if (dirty && !window.confirm("Tienes cambios sin guardar en las notas. ¿Salir sin guardar?")) return;
    setLocation(to);
  };
  // Enlaces de verdad (se pueden abrir en otra pestaña); el clic normal
  // navega dentro de la app y avisa si hay notas sin guardar.
  const link = (to: string) => ({
    href: to,
    onClick: (e: MouseEvent<HTMLAnchorElement>) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      go(to);
    },
  });

  const save = async () => {
    setBusy(true);
    const row = { appointment_id: id, notes: notes.trim(), next_notes: nextNotes.trim() };
    const { error } = row.notes || row.next_notes
      ? await supabase!.from("appointment_notes").upsert(row)
      : await supabase!.from("appointment_notes").delete().eq("appointment_id", id);
    setBusy(false);
    if (error) {
      toast.error("No se pudieron guardar las notas. Vuelve a intentarlo.");
      return;
    }
    setNotesMap(new Map(notesMap).set(id, row));
    setNotes(row.notes);
    setNextNotes(row.next_notes);
    toast.success("Notas guardadas.");
  };

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

        <div className="flex justify-end">
          <Button onClick={save} disabled={busy || !dirty} className="rounded-full">
            {busy ? "Guardando…" : dirty ? "Guardar notas" : "Guardado"}
          </Button>
        </div>

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
