// Tareas de la sesión (docs/tareas-sesion.md): lo que comparten la web y el
// servidor. Los archivos viven en el bucket privado «session-tasks».

export const TASKS_BUCKET = "session-tasks";

// documento = PDF de la sesión (psicóloga) · imagen_tarea = imagen de una
// tarea (psicóloga) · respuesta = adjunto del paciente a su respuesta.
export type TaskFileKind = "documento" | "imagen_tarea" | "respuesta";

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB (igual que el bucket)
export const MAX_TASK_TEXT = 5000;
export const MAX_ANSWER_FILES = 5;

const IMAGES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
};
const DOCS: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  txt: "text/plain",
};

// Extensiones admitidas por tipo de archivo → tipo MIME con el que se guarda.
// El tipo sale siempre de la extensión (no de lo que diga el navegador), así
// nunca se sirve HTML, SVG ni nada ejecutable.
const ALLOWED: Record<TaskFileKind, Record<string, string>> = {
  documento: { pdf: DOCS.pdf },
  imagen_tarea: IMAGES,
  respuesta: { ...IMAGES, ...DOCS },
};

// Valor para el atributo accept de <input type="file">.
export function acceptFor(kind: TaskFileKind): string {
  return Object.keys(ALLOWED[kind]).map((e) => `.${e}`).join(",");
}

export const isImageMime = (mime: string) => mime.startsWith("image/");
// Imágenes que el navegador sabe pintar (HEIC no, salvo en Safari).
export const isInlineImage = (mime: string) => /^image\/(jpeg|png|webp|gif)$/.test(mime);

export type FileCheck =
  | { ok: true; ext: string; mime: string; name: string }
  | { ok: false; error: "type" | "size" | "name"; message: string };

const WHAT: Record<TaskFileKind, string> = {
  documento: "Solo se pueden subir archivos PDF.",
  imagen_tarea: "Solo se pueden adjuntar imágenes (JPG, PNG, WEBP, GIF o HEIC).",
  respuesta: "Solo se pueden adjuntar imágenes, PDF o documentos de texto (Word, ODT, RTF, TXT).",
};

// Comprueba nombre, tipo y tamaño de un archivo antes de subirlo.
export function checkFile(kind: TaskFileKind, fileName: string, size: number): FileCheck {
  // Sin rutas ni caracteres de control; como mucho 200 caracteres.
  const name = (fileName.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(-200);
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  if (!name || !ext) return { ok: false, error: "name", message: WHAT[kind] };
  const mime = ALLOWED[kind]?.[ext];
  if (!mime) return { ok: false, error: "type", message: WHAT[kind] };
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: "size", message: "El archivo está vacío." };
  if (size > MAX_FILE_BYTES) return { ok: false, error: "size", message: "El archivo pesa más de 20 MB." };
  return { ok: true, ext, mime, name };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export interface TaskFile {
  id: string;
  kind?: TaskFileKind;
  file_name: string;
  mime_type: string;
  size_bytes: number;
}
