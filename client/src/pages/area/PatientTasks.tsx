import { useRef, useState } from "react";
import { Check, Loader2, Paperclip, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { answerTask, deleteTaskFile, uploadTaskFile, type PatientTask, type PatientTaskSession } from "@/lib/sessionTasks";
import { MAX_ANSWER_FILES, MAX_TASK_TEXT, acceptFor, checkFile, formatBytes } from "../../../../shared/sessionTasks";
import { formatDayTitle } from "./format";
import { ShowMoreList } from "./ShowMoreList";
import { TaskFileChip, TaskImage } from "./TaskFiles";

// «Tareas» del área del paciente: por cada sesión, los documentos que la
// psicóloga ha compartido y las tareas que ha publicado, cada una en su
// desplegable. El paciente responde con texto y puede adjuntar archivos.

export const pendingTasks = (sessions: PatientTaskSession[]) =>
  sessions.reduce((n, s) => n + s.tasks.filter((t) => !t.answered_at).length, 0);

const time = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

function TaskAnswer({ task, index, onChanged }: { task: PatientTask; index: number; onChanged: () => Promise<void> }) {
  const [draft, setDraft] = useState(task.answer ?? "");
  const [picked, setPicked] = useState<File[]>([]); // elegidos, aún sin enviar
  const [sending, setSending] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const image = task.files.find((f) => f.kind === "imagen_tarea");
  const sent = task.files.filter((f) => f.kind === "respuesta");
  const room = MAX_ANSWER_FILES - sent.length - picked.length;
  const dirty = draft.trim() !== (task.answer ?? "") || picked.length > 0;
  const canSend = dirty && (draft.trim() !== "" || sent.length + picked.length > 0);

  const pick = (list: FileList | null) => {
    const next: File[] = [];
    for (const file of Array.from(list ?? [])) {
      const check = checkFile("respuesta", file.name, file.size);
      if (!check.ok) toast.error(`${file.name}: ${check.message}`);
      else if (next.length >= room) toast.error(`Como mucho ${MAX_ANSWER_FILES} archivos por respuesta.`);
      else next.push(file);
    }
    setPicked((p) => [...p, ...next]);
  };

  // Primero se suben los archivos elegidos y después se guarda la respuesta
  // (que es lo que avisa a la psicóloga).
  const send = async () => {
    setSending(true);
    const left: File[] = [];
    let uploaded = 0;
    for (const file of picked) {
      const r = await uploadTaskFile("respuesta", { taskId: task.id }, file);
      if (r.ok) uploaded += 1;
      else { left.push(file); toast.error(r.message); }
    }
    setPicked(left);
    if (left.length > 0) {
      if (uploaded > 0) await onChanged();
      setSending(false);
      return;
    }
    const r = await answerTask(task.id, draft);
    if (!r.success) {
      toast.error(r.message);
      if (uploaded > 0) await onChanged();
      setSending(false);
      return;
    }
    await onChanged();
    setDraft(draft.trim());
    setSending(false);
    toast.success(task.answered_at ? "Respuesta actualizada." : "Respuesta enviada a tu psicóloga.");
  };

  const removeSent = async (fileId: string) => {
    if (!window.confirm("¿Quitar este archivo de tu respuesta?")) return;
    setRemoving(fileId);
    const r = await deleteTaskFile(fileId);
    if (!r.success) toast.error(r.message);
    else await onChanged();
    setRemoving(null);
  };

  return (
    <AccordionItem value={task.id} className="rounded-xl border border-border bg-background px-3 last:border-b">
      <AccordionTrigger className="items-center py-3 hover:no-underline">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="shrink-0 font-medium text-foreground">Tarea {index + 1}</span>
          <span className="min-w-0 flex-1 truncate font-normal text-muted-foreground">{task.body}</span>
          {task.answered_at
            ? <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary"><Check className="size-3" /> Respondida</Badge>
            : <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">Pendiente</Badge>}
        </span>
      </AccordionTrigger>
      <AccordionContent className="flex flex-col gap-3">
        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">{task.body}</p>
        {image && <TaskImage file={image} />}

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <label htmlFor={`respuesta-${task.id}`} className="text-sm font-medium text-foreground">Tu respuesta</label>
          <Textarea id={`respuesta-${task.id}`} value={draft} onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_TASK_TEXT} className="min-h-28 text-sm" placeholder="Escribe aquí tu respuesta…" />
          {sent.map((f) => (
            <TaskFileChip key={f.id} file={f} onRemove={() => removeSent(f.id)} removing={removing === f.id} />
          ))}
          {picked.map((f, i) => (
            <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm">
              <Paperclip className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(f.size)} · sin enviar</span>
              <button type="button" aria-label={`Quitar ${f.name}`} disabled={sending}
                onClick={() => setPicked((p) => p.filter((_, j) => j !== i))}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
          ))}
          <input ref={input} type="file" multiple accept={acceptFor("respuesta")} className="hidden"
            onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={send} disabled={sending || !canSend} className="rounded-full">
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {sending ? "Enviando…" : task.answered_at ? "Guardar cambios" : "Enviar respuesta"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => input.current?.click()} disabled={sending || room <= 0}>
              <Paperclip className="size-4" /> Adjuntar archivo
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {task.answered_at ? `Enviada el ${time(task.answered_at)}. Puedes cambiarla cuando quieras. ` : ""}
            Puedes adjuntar imágenes, PDF o documentos (máx. {MAX_ANSWER_FILES} archivos de 20 MB). Solo los ve tu psicóloga.
          </p>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

export function PatientTasks({ sessions, onChanged }: {
  sessions: PatientTaskSession[] | null;
  onChanged: () => Promise<void>;
}) {
  return (
    <section className="flex flex-col">
      <h2 className="mb-1 font-serif text-2xl font-semibold text-foreground">Tareas</h2>
      <p className="mb-4 text-sm text-muted-foreground">Los documentos y las tareas que tu psicóloga te deja después de cada sesión.</p>
      {!sessions ? (
        <p className="text-muted-foreground">Cargando…</p>
      ) : sessions.length === 0 ? (
        <p className="text-muted-foreground">Todavía no tienes tareas ni documentos. Cuando tu psicóloga te deje alguno, aparecerá aquí.</p>
      ) : (
        <ShowMoreList className="flex flex-col gap-4">
          {sessions.map((s) => (
            <li key={s.appointment_id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
              <p className="text-sm font-medium text-muted-foreground">Sesión del {formatDayTitle(s.starts_at).toLowerCase()}</p>
              {s.documents.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-foreground">Documentos</p>
                  {s.documents.map((f) => <TaskFileChip key={f.id} file={f} />)}
                </div>
              )}
              {s.tasks.length > 0 && (
                <Accordion type="single" collapsible className="flex flex-col gap-2"
                  defaultValue={s.tasks.find((t) => !t.answered_at)?.id}>
                  {s.tasks.map((t, i) => <TaskAnswer key={t.id} task={t} index={i} onChanged={onChanged} />)}
                </Accordion>
              )}
            </li>
          ))}
        </ShowMoreList>
      )}
    </section>
  );
}
