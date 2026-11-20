import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardList, FileUp, ImagePlus, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";
import { deleteTask, deleteTaskFile, uploadTaskFile, type SessionTask, type SessionTaskFile } from "@/lib/sessionTasks";
import { MAX_TASK_TEXT, acceptFor } from "../../../../shared/sessionTasks";
import { TaskFileChip, TaskImage } from "./TaskFiles";

// Tareas de la sesión (psicóloga): documentos PDF que puede enseñar o no al
// paciente y tareas, cada una en su desplegable, con una imagen opcional. El
// paciente solo ve lo que se publica y responde desde su área; su respuesta
// aparece aquí. Ver docs/tareas-sesion.md.

const time = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

function TaskEditor({ task, index, files, onChange, onFiles, onDeleted }: {
  task: SessionTask;
  index: number;
  files: SessionTaskFile[];
  onChange: (t: SessionTask) => void;
  onFiles: (update: (all: SessionTaskFile[]) => SessionTaskFile[]) => void;
  onDeleted: () => void;
}) {
  const [draft, setDraft] = useState(task.body);
  const [busy, setBusy] = useState<"save" | "pub" | "del" | "img" | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const image = files.find((f) => f.kind === "imagen_tarea");
  const answerFiles = files.filter((f) => f.kind === "respuesta");
  const text = draft.trim();
  const edited = text !== task.body;
  const published = Boolean(task.published_at);

  const update = async (patch: Partial<SessionTask>, key: "save" | "pub", ok: string, ko: string) => {
    setBusy(key);
    const { error } = await supabase!.from("session_tasks").update(patch).eq("id", task.id);
    setBusy(null);
    if (error) return toast.error(ko);
    onChange({ ...task, ...patch });
    if (patch.body !== undefined) setDraft(patch.body);
    toast.success(ok);
  };
  const save = () => update({ body: text }, "save",
    published ? "Cambios guardados: el paciente ya ve el texto nuevo." : "Borrador guardado.", "No se pudieron guardar los cambios.");
  const publish = () => update({ body: text, published_at: new Date().toISOString() }, "pub",
    "Publicada: el paciente ya la ve en su área y puede responder.", "No se pudo publicar.");
  const unpublish = () => {
    if (!window.confirm(task.answered_at
      ? "¿Retirar la tarea del área del paciente? Su respuesta se conserva aquí, pero dejará de verla."
      : "¿Retirar la tarea del área del paciente?")) return;
    void update({ published_at: null }, "pub", "Retirada: el paciente ya no la ve.", "No se pudo retirar.");
  };

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    setBusy("img");
    const r = await uploadTaskFile("imagen_tarea", { taskId: task.id }, file);
    setBusy(null);
    if (!r.ok) return toast.error(r.message);
    onFiles((all) => [...all.filter((f) => !(f.task_id === task.id && f.kind === "imagen_tarea")), r.file]);
  };
  const removeImage = async () => {
    if (!image) return;
    setBusy("img");
    const r = await deleteTaskFile(image.id);
    setBusy(null);
    if (!r.success) return toast.error(r.message);
    onFiles((all) => all.filter((f) => f.id !== image.id));
  };

  const remove = async () => {
    if (!window.confirm(task.answered_at
      ? "¿Borrar esta tarea? Se borrarán también la respuesta del paciente y sus archivos."
      : "¿Borrar esta tarea?")) return;
    setBusy("del");
    const r = await deleteTask(task.id);
    setBusy(null);
    if (!r.success) return toast.error(r.message);
    onDeleted();
  };

  return (
    <AccordionItem value={task.id} className="rounded-xl border border-border bg-background px-3 last:border-b">
      <AccordionTrigger className="items-center py-3 hover:no-underline">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="shrink-0 font-medium text-foreground">Tarea {index + 1}</span>
          <span className="min-w-0 flex-1 truncate font-normal text-muted-foreground">{task.body || "Sin escribir"}</span>
          {task.answered_at
            ? <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">Respondida</Badge>
            : published
              ? <Badge variant="outline" className="border-border">Publicada</Badge>
              : <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">Borrador</Badge>}
        </span>
      </AccordionTrigger>
      <AccordionContent className="flex flex-col gap-3">
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={MAX_TASK_TEXT}
          className="min-h-28 text-sm" aria-label={`Texto de la tarea ${index + 1}`}
          placeholder="Escribe la tarea o la pregunta para el paciente…" />

        {image && (
          <div className="flex flex-col gap-2">
            <TaskImage file={image} />
            <TaskFileChip file={image} onRemove={removeImage} removing={busy === "img"} />
          </div>
        )}
        <input ref={imageInput} type="file" accept={acceptFor("imagen_tarea")} className="hidden"
          onChange={(e) => { void pickImage(e.target.files?.[0]); e.target.value = ""; }} />

        <p className={published ? "text-xs font-medium text-primary" : "text-xs font-medium text-amber-800"}>
          {published
            ? `Publicada al paciente el ${time(task.published_at!)}${edited ? " · hay cambios sin guardar" : ""}`
            : "Borrador: el paciente no la ve hasta que la publiques."}
        </p>
        <div className="flex flex-wrap gap-2">
          {!published && (
            <Button size="sm" onClick={publish} disabled={busy !== null || !text} className="rounded-full">
              <Send className="size-4" /> Publicar al paciente
            </Button>
          )}
          {edited && (
            <Button size="sm" variant={published ? "default" : "outline"} onClick={save}
              disabled={busy !== null || (published && !text)} className="rounded-full">
              {published ? "Guardar cambios" : "Guardar borrador"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => imageInput.current?.click()} disabled={busy !== null}>
            {busy === "img" ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
            {image ? "Cambiar imagen" : "Añadir imagen (opcional)"}
          </Button>
          {published && <Button size="sm" variant="ghost" onClick={unpublish} disabled={busy !== null}>Retirar</Button>}
          <Button size="sm" variant="ghost" onClick={remove} disabled={busy !== null}>
            <Trash2 className="size-4" /> Borrar
          </Button>
        </div>

        {task.answered_at ? (
          <div className="flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/10 p-3">
            <p className="text-xs font-medium text-primary">Respuesta del paciente · {time(task.answered_at)}</p>
            {task.answer && <p className="whitespace-pre-line text-sm text-foreground">{task.answer}</p>}
            {answerFiles.map((f) => <TaskFileChip key={f.id} file={f} />)}
          </div>
        ) : published && (
          <p className="text-xs text-muted-foreground">El paciente aún no ha respondido. Cuando lo haga, te llegará un email y verás aquí su respuesta.</p>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

export function TasksPanel({ appointmentId }: { appointmentId: string }) {
  const [tasks, setTasks] = useState<SessionTask[] | null>(null);
  const [files, setFiles] = useState<SessionTaskFile[]>([]);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState("");
  const [busy, setBusy] = useState<"add" | "pdf" | string | null>(null);
  const pdfInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [t, f] = await Promise.all([
      supabase.from("session_tasks").select("*").eq("appointment_id", appointmentId).order("position").order("created_at"),
      supabase.from("session_task_files").select("*").eq("appointment_id", appointmentId)
        .not("uploaded_at", "is", null).order("created_at"),
    ]);
    if (t.error || f.error) return setFailed(true);
    setTasks((t.data as SessionTask[]) ?? []);
    setFiles((f.data as SessionTaskFile[]) ?? []);
  }, [appointmentId]);

  useEffect(() => { void load(); }, [load]);

  // El email de aviso enlaza con #tareas: se baja hasta aquí al cargar.
  const section = useRef<HTMLElement>(null);
  const loaded = tasks !== null;
  useEffect(() => {
    if (loaded && window.location.hash === "#tareas") section.current?.scrollIntoView();
  }, [loaded]);

  const documents = files.filter((f) => f.kind === "documento");

  const uploadPdfs = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy("pdf");
    for (const file of Array.from(list)) {
      const r = await uploadTaskFile("documento", { appointmentId }, file);
      if (r.ok) setFiles((all) => [...all, r.file]);
      else toast.error(r.message);
    }
    setBusy(null);
  };

  const setVisible = async (file: SessionTaskFile, visible: boolean) => {
    setFiles((all) => all.map((f) => (f.id === file.id ? { ...f, visible_to_patient: visible } : f)));
    const { error } = await supabase!.from("session_task_files").update({ visible_to_patient: visible }).eq("id", file.id);
    if (error) {
      setFiles((all) => all.map((f) => (f.id === file.id ? { ...f, visible_to_patient: !visible } : f)));
      return toast.error("No se pudo cambiar. Inténtalo de nuevo.");
    }
    toast.success(visible ? "El paciente ya ve este documento en su área." : "El paciente ya no ve este documento.");
  };

  const removeDocument = async (file: SessionTaskFile) => {
    if (!window.confirm(`¿Borrar «${file.file_name}»?${file.visible_to_patient ? " El paciente dejará de verlo." : ""}`)) return;
    setBusy(file.id);
    const r = await deleteTaskFile(file.id);
    setBusy(null);
    if (!r.success) return toast.error(r.message);
    setFiles((all) => all.filter((f) => f.id !== file.id));
  };

  const addTask = async () => {
    setBusy("add");
    const position = (tasks ?? []).reduce((max, t) => Math.max(max, t.position), 0) + 1;
    const { data, error } = await supabase!.from("session_tasks")
      .insert({ appointment_id: appointmentId, position }).select("*").single();
    setBusy(null);
    if (error || !data) return toast.error("No se pudo crear la tarea.");
    setTasks((all) => [...(all ?? []), data as SessionTask]);
    setOpen((data as SessionTask).id);
  };

  let body: React.ReactNode;
  if (failed) {
    body = <p className="text-sm text-destructive">No se pudieron cargar las tareas. Recarga la página.</p>;
  } else if (!tasks) {
    body = <p className="text-sm text-muted-foreground">Cargando…</p>;
  } else {
    body = (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label className="text-sm">Documentos (PDF)</Label>
          {documents.length === 0 && <p className="text-sm text-muted-foreground">No hay documentos en esta sesión.</p>}
          {documents.map((f) => (
            <TaskFileChip key={f.id} file={f} onRemove={() => removeDocument(f)} removing={busy === f.id}>
              <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={f.visible_to_patient} onCheckedChange={(v) => setVisible(f, v)} />
                {f.visible_to_patient ? "Visible para el paciente" : "Solo lo ves tú"}
              </label>
            </TaskFileChip>
          ))}
          <input ref={pdfInput} type="file" accept={acceptFor("documento")} multiple className="hidden"
            onChange={(e) => { void uploadPdfs(e.target.files); e.target.value = ""; }} />
          <Button size="sm" variant="outline" className="self-start rounded-full" disabled={busy !== null}
            onClick={() => pdfInput.current?.click()}>
            {busy === "pdf" ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
            {busy === "pdf" ? "Subiendo…" : "Subir PDF"}
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-sm">Tareas para el paciente</Label>
          {tasks.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay tareas en esta sesión.</p>}
          <Accordion type="single" collapsible value={open} onValueChange={setOpen} className="flex flex-col gap-2">
            {tasks.map((t, i) => (
              <TaskEditor key={t.id} task={t} index={i}
                files={files.filter((f) => f.task_id === t.id)}
                onChange={(next) => setTasks((all) => (all ?? []).map((x) => (x.id === next.id ? next : x)))}
                onFiles={setFiles}
                onDeleted={() => {
                  setTasks((all) => (all ?? []).filter((x) => x.id !== t.id));
                  setFiles((all) => all.filter((f) => f.task_id !== t.id));
                }} />
            ))}
          </Accordion>
          <Button size="sm" variant="outline" className="self-start rounded-full" onClick={addTask} disabled={busy !== null}>
            {busy === "add" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Añadir tarea
          </Button>
        </div>
      </div>
    );
  }

  return (
    <section ref={section} id="tareas" className="scroll-mt-24 rounded-2xl border border-border bg-card p-4">
      <p className="mb-1 flex items-center gap-2 font-medium text-foreground">
        <ClipboardList className="size-4 text-primary" /> Tareas
      </p>
      <p className="mb-3 text-xs text-muted-foreground">
        Documentos y tareas de esta sesión. El paciente solo ve los documentos que marques como visibles y las tareas
        que publiques; puede responder a cada tarea y adjuntar archivos, y te avisamos por email cuando lo haga.
      </p>
      {body}
    </section>
  );
}
