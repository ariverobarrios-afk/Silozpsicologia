import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MODALITY_LABEL, STATUS_LABEL, type Appointment } from "@/lib/supabase";
import { SESSION_TYPES, euros } from "@/lib/tariffs";
import { formatDayTitle, formatTime } from "./format";

const STATUS_CLASS: Record<Appointment["status"], string> = {
  programada: "bg-primary/10 text-primary border-primary/20",
  realizada: "bg-secondary text-secondary-foreground border-border",
  cancelada: "bg-destructive/10 text-destructive border-destructive/20",
};

// Distintivo de primera sesión (mismo tono cálido que en el calendario).
export const FIRST_SESSION_CLASS = "border-amber-300 bg-amber-100 text-amber-900";

export function PaymentBadge({ appointment: a }: { appointment: Appointment }) {
  if (a.status === "cancelada") return null;
  if (a.session_type === "bono") {
    return <Badge variant="outline" className="border-border">Bono</Badge>;
  }
  if (a.price_cents === 0) return null;
  return a.paid_at ? (
    <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
      Pagada · {euros(a.price_cents)}
    </Badge>
  ) : (
    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
      Pendiente · {euros(a.price_cents)}
    </Badge>
  );
}

// Una fila de cita, compartida por el panel de Silvia y el área del paciente.
export function AppointmentItem({
  appointment,
  title,
  actions,
}: {
  appointment: Appointment;
  title?: string;
  actions?: ReactNode;
}) {
  const a = appointment;
  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between",
        a.status === "cancelada" && "opacity-70"
      )}
    >
      <div className="min-w-0">
        {title && <p className="truncate font-medium text-foreground">{title}</p>}
        <p className={title ? "text-sm text-muted-foreground" : "font-medium text-foreground"}>
          {formatDayTitle(a.starts_at)}
        </p>
        <p className="text-sm text-muted-foreground">
          {formatTime(a.starts_at)} · {a.duration_minutes} min · {MODALITY_LABEL[a.modality]}
          {a.session_type !== "primera" && ` · ${SESSION_TYPES[a.session_type].label}`}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {a.session_type === "primera" && (
          <Badge variant="outline" className={FIRST_SESSION_CLASS}>Primera sesión</Badge>
        )}
        <PaymentBadge appointment={a} />
        <Badge variant="outline" className={STATUS_CLASS[a.status]}>
          {STATUS_LABEL[a.status]}
        </Badge>
        {actions}
      </div>
    </li>
  );
}
