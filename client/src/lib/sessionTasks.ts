import { supabase } from "@/lib/supabase";
import { authHeaders } from "@/lib/consent";
import { TASKS_BUCKET, checkFile, type TaskFile, type TaskFileKind } from "../../../shared/sessionTasks";

// Tareas de la sesión (docs/tareas-sesion.md): llamadas a /api/session-tasks.

export interface SessionTask {
  id: string;
  appointment_id: string;
  position: number;
  body: string;
  published_at: string | null; // null = borrador (el paciente no la ve)
  answer: string | null;
  answered_at: string | null;
  created_at: string;
}

// Fila completa de un archivo (lo que ve la psicóloga).
export interface SessionTaskFile extends TaskFile {
  appointment_id: string;
  task_id: string | null;
  kind: TaskFileKind;
  visible_to_patient: boolean;
  uploaded_at: string | null;
  created_at: string;
}

// Lo que ve el paciente (my_session_tasks).
export interface PatientTask {
  id: string;
  body: string;
  published_at: string;
  answer: string | null;
  answered_at: string | null;
  files: Array<TaskFile & { kind: TaskFileKind }>;
}
export interface PatientTaskSession {
  appointment_id: string;
  starts_at: string;
  documents: TaskFile[];
  tasks: PatientTask[];
}

type ApiResult<T> = ({ success: true } & T) | { success: false; code?: string; message: string };

async function call<T>(payload: Record<string, unknown>): Promise<ApiResult<T>> {
  try {
    const resp = await fetch("/api/session-tasks", {
      method: "POST", headers: await authHeaders(), body: JSON.stringify(payload),
    });
    const body = (await resp.json().catch(() => ({}))) as { success?: boolean; code?: string; message?: string } & T;
    if (!resp.ok || !body.success) {
      return { success: false, code: body.code, message: body.message || "No se pudo completar. Inténtalo de nuevo." };
    }
    return { ...body, success: true };
  } catch {
    return { success: false, message: "No hay conexión. Inténtalo de nuevo." };
  }
}

// Sube un archivo: pide un enlace firmado, lo sube directamente a Storage y
// lo confirma. Devuelve la fila del archivo o el mensaje de error.
export async function uploadTaskFile(
  kind: TaskFileKind,
  target: { appointmentId?: string; taskId?: string },
  file: File,
): Promise<{ ok: true; file: SessionTaskFile } | { ok: false; message: string }> {
  const check = checkFile(kind, file.name, file.size);
  if (!check.ok) return { ok: false, message: check.message };
  const ticket = await call<{ fileId: string; path: string; token: string; contentType: string }>({
    action: "upload-url", kind, ...target, fileName: file.name, size: file.size,
  });
  if (!ticket.success) return { ok: false, message: ticket.message };
  const up = await supabase!.storage.from(TASKS_BUCKET)
    .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: ticket.contentType });
  if (up.error) return { ok: false, message: `No se pudo subir «${check.name}». Revisa la conexión e inténtalo de nuevo.` };
  const done = await call<{ file: SessionTaskFile }>({ action: "confirm", fileId: ticket.fileId });
  if (!done.success) return { ok: false, message: done.message };
  return { ok: true, file: done.file };
}

export async function taskFileUrl(fileId: string): Promise<string | null> {
  const r = await call<{ url: string }>({ action: "file-url", fileId });
  return r.success ? r.url : null;
}

// Abre un archivo en otra pestaña (los que no se pueden ver, se descargan).
// La pestaña se abre antes de pedir el enlace para que el navegador no la bloquee.
export async function openTaskFile(fileId: string): Promise<boolean> {
  const tab = window.open("", "_blank");
  const url = await taskFileUrl(fileId);
  if (!url) {
    tab?.close();
    return false;
  }
  if (tab) tab.location.href = url;
  else window.location.assign(url);
  return true;
}

export const deleteTaskFile = (fileId: string) => call<object>({ action: "delete-file", fileId });
export const deleteTask = (taskId: string) => call<object>({ action: "delete-task", taskId });
export const answerTask = (taskId: string, answer: string) =>
  call<{ answeredAt: string; emailSent: boolean }>({ action: "answer", taskId, answer });

export async function fetchMyTasks(): Promise<PatientTaskSession[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("my_session_tasks");
  return error ? [] : ((data as PatientTaskSession[] | null) ?? []);
}
