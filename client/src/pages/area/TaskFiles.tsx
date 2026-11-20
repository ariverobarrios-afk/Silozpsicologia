import { useEffect, useState, type ReactNode } from "react";
import { FileText, Image as ImageIcon, Loader2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { openTaskFile, taskFileUrl } from "@/lib/sessionTasks";
import { formatBytes, isImageMime, isInlineImage, type TaskFile } from "../../../../shared/sessionTasks";

// Piezas de archivos que comparten las tareas de la psicóloga y del paciente.

// Un archivo: nombre (abre o descarga con un enlace que da el servidor),
// tamaño y, si se puede, botón de quitar.
export function TaskFileChip({ file, onRemove, removing, children }: {
  file: TaskFile;
  onRemove?: () => void;
  removing?: boolean;
  children?: ReactNode; // acciones extra a la derecha
}) {
  const [opening, setOpening] = useState(false);
  const open = async () => {
    setOpening(true);
    const ok = await openTaskFile(file.id);
    setOpening(false);
    if (!ok) toast.error("No se pudo abrir el archivo. Inténtalo de nuevo.");
  };
  const Icon = file.mime_type === "application/pdf" ? FileText : isImageMime(file.mime_type) ? ImageIcon : Paperclip;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-background px-3 py-2">
      <button type="button" onClick={open} disabled={opening}
        className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-foreground hover:underline">
        {opening ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <Icon className="size-4 shrink-0 text-primary" />}
        <span className="truncate">{file.file_name}</span>
        <span className="shrink-0 text-xs font-normal text-muted-foreground">{formatBytes(file.size_bytes)}</span>
      </button>
      {children}
      {onRemove && (
        <button type="button" onClick={onRemove} disabled={removing} aria-label={`Quitar ${file.file_name}`}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
          {removing ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
        </button>
      )}
    </div>
  );
}

// La imagen de una tarea, a la vista. Si el navegador no sabe pintarla (HEIC),
// se enseña como un archivo más.
export function TaskImage({ file }: { file: TaskFile }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const inline = isInlineImage(file.mime_type);
  useEffect(() => {
    if (!inline) return;
    let alive = true;
    taskFileUrl(file.id).then((u) => { if (alive) { if (u) setUrl(u); else setFailed(true); } });
    return () => { alive = false; };
  }, [file.id, inline]);
  if (!inline || failed) return <TaskFileChip file={file} />;
  if (!url) return <div className="h-40 w-full max-w-sm animate-pulse rounded-md bg-muted" aria-label="Cargando imagen" />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block w-fit">
      <img src={url} alt={file.file_name} onError={() => setFailed(true)}
        className="max-h-80 max-w-full rounded-md border border-border object-contain" />
    </a>
  );
}
