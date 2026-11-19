// Función serverless de Vercel (Edge): tareas de la sesión (docs/tareas-sesion.md).
//
//   POST /api/session-tasks   Authorization: Bearer <token de sesión>
//   { "action": ..., ... }
//
// Acciones (quién puede hacer qué lo decide la base de datos, con las
// funciones de supabase/migrations/20261119_tareas_sesion.sql):
//   upload-url   { kind, appointmentId | taskId, fileName, size }
//                → enlace firmado para subir el archivo directamente a Storage
//                  (no pasa por esta función: Vercel limita el cuerpo a 4,5 MB).
//   confirm      { fileId }  → comprueba que el archivo se ha subido y lo da por bueno.
//   file-url     { fileId }  → enlace de descarga que caduca en 1 hora.
//   delete-file  { fileId }
//   delete-task  { taskId }  → solo administración; borra también sus archivos.
//   answer       { taskId, answer } → el paciente guarda su respuesta; se avisa
//                  por email a la psicóloga si hay algo nuevo.
//
// El bucket es privado y no tiene políticas: sin esta función no se puede
// subir ni descargar nada. Variables: SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.
import type { SupabaseClient } from "@supabase/supabase-js";
import { appUrl, authenticate, json } from "../server/booking";
import { enviarEmail } from "../server/email";
import { emailRespuestaTarea, type TaskAnswerInfo } from "../server/sessionTasks";
import { MAX_ANSWER_FILES, MAX_FILE_BYTES, TASKS_BUCKET, checkFile, isInlineImage, type TaskFileKind } from "../shared/sessionTasks";

export const config = { runtime: "edge" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: TaskFileKind[] = ["documento", "imagen_tarea", "respuesta"];
const fail = (status: number, code: string, message: string) => json({ success: false, code, message }, status);
const notAllowed = () => fail(403, "not_allowed", "No autorizado.");
const uuid = (v: unknown) => (typeof v === "string" && UUID_RE.test(v) ? v : null);

interface FileRow {
  id: string;
  appointment_id: string;
  task_id: string | null;
  kind: TaskFileKind;
  path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  uploaded_at: string | null;
}

async function fileFor(admin: SupabaseClient, userId: string, fileId: string, write: boolean): Promise<FileRow | null> {
  const { data } = await admin.rpc("session_task_file_for", { p_user: userId, p_file: fileId, p_write: write });
  return ((data as FileRow[] | null) ?? [])[0] ?? null;
}

async function removeFiles(admin: SupabaseClient, rows: Array<{ id: string; path: string }>) {
  if (rows.length === 0) return;
  await admin.from("session_task_files").delete().in("id", rows.map((r) => r.id));
  const { error } = await admin.storage.from(TASKS_BUCKET).remove(rows.map((r) => r.path));
  if (error) console.error("Tareas: no se pudo borrar del almacenamiento", error.message);
}

export default async function handler(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if ("response" in auth) return auth.response;
  const { admin, patientId: userId } = auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return fail(400, "bad_request", "Petición inválida.");
  }
  if (!body || typeof body !== "object") return fail(400, "bad_request", "Petición inválida.");

  switch (body.action) {
    case "upload-url": {
      const kind = KINDS.find((k) => k === body.kind);
      const appointmentId = uuid(body.appointmentId);
      const taskId = uuid(body.taskId);
      if (!kind || (kind === "documento" ? !appointmentId : !taskId)) return notAllowed();
      const check = checkFile(kind, String(body.fileName ?? ""), Number(body.size));
      if (!check.ok) return fail(400, `file_${check.error}`, check.message);

      const { data: appt, error } = await admin.rpc("session_task_upload_check", {
        p_user: userId, p_kind: kind, p_appointment: appointmentId, p_task: taskId,
      });
      if (error || !appt) {
        if (error?.message.includes("TOO_MANY_FILES")) {
          return fail(409, "too_many_files", kind === "respuesta"
            ? `Como mucho ${MAX_ANSWER_FILES} archivos por respuesta. Borra alguno para adjuntar otro.`
            : "Esta sesión ya tiene el máximo de documentos (20).");
        }
        return notAllowed();
      }

      // Subidas que se quedaron a medias hace más de un día: fuera.
      const { data: stale } = await admin.from("session_task_files").select("id, path")
        .eq("appointment_id", appt).is("uploaded_at", null)
        .lt("created_at", new Date(Date.now() - 86_400_000).toISOString());
      await removeFiles(admin, stale ?? []);

      const id = crypto.randomUUID();
      const path = `${appt}/${kind}/${id}.${check.ext}`;
      const { error: insertError } = await admin.from("session_task_files").insert({
        id, appointment_id: appt, task_id: kind === "documento" ? null : taskId, kind, path,
        file_name: check.name, mime_type: check.mime, size_bytes: Number(body.size), uploaded_by: userId,
      });
      if (insertError) {
        console.error("Tareas: no se pudo registrar el archivo", insertError.code);
        return fail(500, "db", "No se pudo preparar la subida. Inténtalo de nuevo.");
      }
      const { data: signed, error: signError } = await admin.storage.from(TASKS_BUCKET).createSignedUploadUrl(path);
      if (signError || !signed) {
        console.error("Tareas: no se pudo firmar la subida", signError?.message);
        await admin.from("session_task_files").delete().eq("id", id);
        return fail(500, "storage", "No se pudo preparar la subida. Inténtalo de nuevo.");
      }
      return json({ success: true, fileId: id, path, token: signed.token, contentType: check.mime });
    }

    case "confirm": {
      const fileId = uuid(body.fileId);
      if (!fileId) return notAllowed();
      // Solo quien pidió la subida, y solo una vez.
      const { data: row } = await admin.from("session_task_files").select("*")
        .eq("id", fileId).eq("uploaded_by", userId).is("uploaded_at", null).maybeSingle();
      const file = row as FileRow | null;
      if (!file) return notAllowed();
      const { data: info } = await admin.storage.from(TASKS_BUCKET).info(file.path);
      const size = Number(info?.size ?? 0);
      if (!info || size <= 0 || size > MAX_FILE_BYTES) {
        await removeFiles(admin, [file]);
        return fail(400, "upload_missing", "El archivo no se ha subido bien. Inténtalo de nuevo.");
      }
      // Por si la tarea se retiró, o se llegó al máximo, mientras se subía.
      const { error: checkError } = await admin.rpc("session_task_upload_check", {
        p_user: userId, p_kind: file.kind, p_appointment: file.appointment_id, p_task: file.task_id,
      });
      if (checkError) {
        await removeFiles(admin, [file]);
        return checkError.message.includes("TOO_MANY_FILES")
          ? fail(409, "too_many_files", `Como mucho ${MAX_ANSWER_FILES} archivos por respuesta.`)
          : notAllowed();
      }
      const uploaded_at = new Date().toISOString();
      const { error } = await admin.from("session_task_files")
        .update({ uploaded_at, size_bytes: size }).eq("id", file.id);
      if (error) return fail(500, "db", "No se pudo guardar el archivo. Inténtalo de nuevo.");
      // Una tarea solo lleva una imagen: la nueva sustituye a la anterior.
      if (file.kind === "imagen_tarea") {
        const { data: old } = await admin.from("session_task_files").select("id, path")
          .eq("task_id", file.task_id).eq("kind", "imagen_tarea").neq("id", file.id);
        await removeFiles(admin, old ?? []);
      }
      return json({
        success: true,
        file: { ...file, size_bytes: size, uploaded_at, visible_to_patient: false },
      });
    }

    case "file-url": {
      const fileId = uuid(body.fileId);
      const file = fileId ? await fileFor(admin, userId, fileId, false) : null;
      if (!file || !file.uploaded_at) return fail(404, "not_found", "Archivo no encontrado.");
      // Las imágenes y los PDF se abren en el navegador; lo demás se descarga.
      const inline = isInlineImage(file.mime_type) || file.mime_type === "application/pdf";
      const { data, error } = await admin.storage.from(TASKS_BUCKET)
        .createSignedUrl(file.path, 3600, inline ? undefined : { download: file.file_name });
      if (error || !data) {
        console.error("Tareas: no se pudo firmar la descarga", error?.message);
        return fail(500, "storage", "No se pudo preparar el archivo.");
      }
      return json({ success: true, url: data.signedUrl });
    }

    case "delete-file": {
      const fileId = uuid(body.fileId);
      const file = fileId ? await fileFor(admin, userId, fileId, true) : null;
      if (!file) return notAllowed();
      await removeFiles(admin, [file]);
      return json({ success: true });
    }

    case "delete-task": {
      const taskId = uuid(body.taskId);
      const { data: isAdmin } = await admin.rpc("session_tasks_is_admin", { p_user: userId });
      if (!taskId || !isAdmin) return notAllowed();
      const { data: files } = await admin.from("session_task_files").select("id, path").eq("task_id", taskId);
      await removeFiles(admin, files ?? []);
      const { error } = await admin.from("session_tasks").delete().eq("id", taskId);
      if (error) return fail(500, "db", "No se pudo borrar la tarea.");
      return json({ success: true });
    }

    case "answer": {
      const taskId = uuid(body.taskId);
      if (!taskId || typeof body.answer !== "string") return notAllowed();
      const { data, error } = await admin.rpc("answer_session_task", {
        p_patient: userId, p_task: taskId, p_answer: body.answer,
      });
      if (error) {
        if (error.message.includes("ANSWER_EMPTY")) return fail(400, "empty", "Escribe tu respuesta o adjunta un archivo.");
        if (error.message.includes("ANSWER_TOO_LONG")) return fail(400, "too_long", "La respuesta es demasiado larga (máx. 5000 caracteres).");
        if (error.message.includes("NOT_ALLOWED")) {
          return fail(403, "not_allowed", "Esta tarea ya no está disponible. Recarga la página.");
        }
        console.error("Tareas: no se pudo guardar la respuesta", error.code);
        return fail(502, "db", "No se pudo guardar la respuesta. Inténtalo de nuevo.");
      }
      const info = data as TaskAnswerInfo;
      const sent = info.changed && info.psychologist_email
        ? await enviarEmail(emailRespuestaTarea(info, appUrl(req)))
        : { ok: false };
      return json({ success: true, answeredAt: info.answered_at, emailSent: sent.ok });
    }

    default:
      return fail(400, "bad_request", "Petición inválida.");
  }
}
