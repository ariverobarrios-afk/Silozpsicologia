import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";
import { authHeaders, fetchConsentOverview, type ConsentOverview } from "@/lib/consent";
import { notesForPrompt } from "../../../../shared/highlights";

// Highlights de la sesión generados con IA (Claude). Solo los ve la psicóloga.
// Ver docs/highlights-ia.md.

interface HighlightRow {
  appointment_id: string;
  content: string;
  model: string;
  notes_sha256: string;
  generated_at: string;
  edited_at: string | null;
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

const time = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

export function HighlightsPanel({ appointmentId, patientId, saved, ensureSaved }: {
  appointmentId: string;
  patientId: string;
  saved: { notes: string; next: string }; // notas ya guardadas
  ensureSaved: () => Promise<boolean>; // guarda lo pendiente antes de generar
}) {
  const [row, setRow] = useState<HighlightRow | null | undefined>(undefined);
  const [overview, setOverview] = useState<ConsentOverview | null | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"gen" | "save" | "del" | null>(null);
  const [notesHash, setNotesHash] = useState("");

  useEffect(() => {
    if (!supabase) return;
    supabase.from("session_highlights").select("*").eq("appointment_id", appointmentId).maybeSingle()
      .then(({ data }) => {
        setRow((data as HighlightRow | null) ?? null);
        setDraft((data as HighlightRow | null)?.content ?? "");
      });
    fetchConsentOverview(patientId).then(setOverview);
  }, [appointmentId, patientId]);

  useEffect(() => {
    sha256(notesForPrompt(saved.notes, saved.next)).then(setNotesHash);
  }, [saved.notes, saved.next]);

  const hasNotes = Boolean(saved.notes.trim() || saved.next.trim());
  const stale = Boolean(row && notesHash && row.notes_sha256 !== notesHash);
  const editedHere = Boolean(row && draft !== row.content);

  const generate = async () => {
    if (row?.edited_at && !window.confirm("Has retocado este resumen a mano. Si lo vuelves a generar, se perderán esos cambios. ¿Seguir?")) return;
    setBusy("gen");
    if (!(await ensureSaved())) {
      setBusy(null);
      toast.error("Primero tienen que guardarse las notas. Revisa la conexión.");
      return;
    }
    try {
      const resp = await fetch("/api/session-highlights", {
        method: "POST", headers: await authHeaders(), body: JSON.stringify({ appointmentId }),
      });
      const body = (await resp.json().catch(() => ({}))) as Partial<HighlightRow> & { success?: boolean; message?: string };
      if (!resp.ok || !body.success || !body.content) {
        toast.error(body.message || "No se pudo generar el resumen.");
        return;
      }
      const next = body as HighlightRow;
      setRow(next);
      setDraft(next.content);
    } catch {
      toast.error("No hay conexión. Inténtalo de nuevo.");
    } finally {
      setBusy(null);
    }
  };

  const saveEdit = async () => {
    setBusy("save");
    const edited_at = new Date().toISOString();
    const { error } = await supabase!.from("session_highlights")
      .update({ content: draft.trim(), edited_at }).eq("appointment_id", appointmentId);
    setBusy(null);
    if (error) return toast.error("No se pudieron guardar los cambios.");
    setRow((r) => (r ? { ...r, content: draft.trim(), edited_at } : r));
    setDraft(draft.trim());
    toast.success("Resumen guardado.");
  };

  const remove = async () => {
    if (!window.confirm("¿Borrar el resumen de esta sesión?")) return;
    setBusy("del");
    const { error } = await supabase!.from("session_highlights").delete().eq("appointment_id", appointmentId);
    setBusy(null);
    if (error) return toast.error("No se pudo borrar.");
    setRow(null);
    setDraft("");
  };

  let body: React.ReactNode;
  if (row === undefined || overview === undefined) {
    body = <p className="text-sm text-muted-foreground">Cargando…</p>;
  } else if (overview?.ai_opt_out) {
    body = <p className="text-sm text-muted-foreground">Este paciente se ha opuesto al uso de IA con sus notas. Puedes cambiarlo en su ficha.</p>;
  } else if (!overview || overview.status === "pendiente") {
    body = (
      <p className="text-sm text-muted-foreground">
        Disponible cuando el paciente haya firmado el consentimiento, que le informa del uso de IA.
      </p>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3">
        {row ? (
          <>
            {stale && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Las notas han cambiado desde que se generó este resumen. Vuelve a generarlo para actualizarlo.
              </p>
            )}
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={10000}
              className="min-h-40 bg-background text-sm" aria-label="Resumen de la sesión" />
            <p className="text-xs text-muted-foreground">
              Generado el {time(row.generated_at)}{row.edited_at ? ` · retocado el ${time(row.edited_at)}` : ""}.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Resume tus notas en temas, hechos relevantes, tareas acordadas y qué retomar.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {editedHere && (
            <Button size="sm" onClick={saveEdit} disabled={busy !== null} className="rounded-full">Guardar cambios</Button>
          )}
          <Button size="sm" variant={row ? "outline" : "default"} onClick={generate}
            disabled={busy !== null || !hasNotes} className="rounded-full">
            {busy === "gen" ? <Loader2 className="size-4 animate-spin" /> : row ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />}
            {busy === "gen" ? "Generando…" : row ? "Volver a generar" : "Generar highlights"}
          </Button>
          {row && (
            <Button size="sm" variant="ghost" onClick={remove} disabled={busy !== null}>
              <Trash2 className="size-4" /> Borrar
            </Button>
          )}
        </div>
        {!hasNotes && !row && <p className="text-xs text-muted-foreground">Escribe primero las notas de la sesión.</p>}
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <p className="mb-1 flex items-center gap-2 font-medium text-foreground">
        <Sparkles className="size-4 text-primary" /> Highlights (IA)
      </p>
      <p className="mb-3 text-xs text-muted-foreground">
        Se generan con Claude (Anthropic) a partir de tus notas, sin el nombre, DNI ni contacto del paciente.
        Revísalos: pueden contener errores. Solo los ves tú.
      </p>
      {body}
    </section>
  );
}
