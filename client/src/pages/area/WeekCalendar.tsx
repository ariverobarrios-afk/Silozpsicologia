import { useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  addDays,
  addWeeks,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfWeek,
} from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Appointment } from "@/lib/supabase";
import { isPendingPayment } from "@/lib/tariffs";

const HOUR_PX = 56; // alto de una hora en la rejilla
const DEFAULT_START = 8; // franja visible por defecto: 8:00–21:00
const DEFAULT_END = 21;

const BLOCK_CLASS: Record<Appointment["status"], string> = {
  programada: "border-primary bg-[oklch(0.95_0.04_155)] text-foreground hover:bg-[oklch(0.91_0.055_155)]",
  realizada: "border-muted-foreground/40 bg-muted text-muted-foreground hover:bg-muted/80",
  cancelada: "border-destructive/50 bg-destructive/10 text-muted-foreground line-through hover:bg-destructive/15",
};
// Las primeras sesiones destacan en un tono cálido para verlas de un vistazo.
const FIRST_BLOCK_CLASS = "border-amber-500 bg-amber-100 text-amber-950 hover:bg-amber-200";
// Días de Psicolink: la columna entera en azul suave para que destaque.
const PSICOLINK_COLUMN_CLASS = "bg-sky-100/70";

// Pagos pendientes: en rojo, por encima de cualquier otro color.
const ALERT_BLOCK_CLASS = "border-destructive bg-destructive/15 text-foreground ring-1 ring-destructive/40 hover:bg-destructive/25";

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

// Reparte las citas que se solapan en carriles para que no se tapen.
function layoutDay(items: Appointment[]) {
  const sorted = [...items].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const placed: { a: Appointment; lane: number; lanes: number }[] = [];
  let group: typeof placed = [];
  let groupEnd = -1;
  const laneEnds: number[] = [];

  const flush = () => {
    const lanes = Math.max(1, ...group.map((g) => g.lane + 1));
    group.forEach((g) => (g.lanes = lanes));
    placed.push(...group);
    group = [];
    laneEnds.length = 0;
  };

  for (const a of sorted) {
    const start = minutesOfDay(new Date(a.starts_at));
    const end = start + a.duration_minutes;
    if (group.length && start >= groupEnd) flush();
    let lane = laneEnds.findIndex((e) => e <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = end;
    groupEnd = Math.max(groupEnd, end);
    group.push({ a, lane, lanes: 1 });
  }
  if (group.length) flush();
  return placed;
}

export function WeekCalendar({
  appointments,
  patientName,
  onSelect,
  onCreate,
  alertFor,
  isPsicolink,
  onTogglePsicolink,
}: {
  appointments: Appointment[];
  patientName: (id: string) => string;
  onSelect: (a: Appointment) => void;
  onCreate: (date: Date, time: string) => void;
  alertFor?: (a: Appointment) => string | null;
  isPsicolink?: (day: Date) => boolean;
  onTogglePsicolink?: (day: Date) => void;
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekEnd = addDays(weekStart, 7);

  const inWeek = appointments.filter((a) => {
    const d = new Date(a.starts_at);
    return d >= weekStart && d < weekEnd;
  });

  // Ampliar la franja horaria si alguna cita cae fuera de 8:00–21:00.
  let startHour = DEFAULT_START;
  let endHour = DEFAULT_END;
  for (const a of inWeek) {
    const s = new Date(a.starts_at);
    startHour = Math.min(startHour, s.getHours());
    endHour = Math.max(endHour, Math.ceil((minutesOfDay(s) + a.duration_minutes) / 60));
  }
  endHour = Math.min(endHour, 24);
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const gridHeight = hours.length * HOUR_PX;

  const last = addDays(weekStart, 6);
  const rangeLabel = isSameMonth(weekStart, last)
    ? `${format(weekStart, "d")} – ${format(last, "d 'de' MMMM yyyy", { locale: es })}`
    : `${format(weekStart, "d MMM", { locale: es })} – ${format(last, "d MMM yyyy", { locale: es })}`;

  const handleEmptyClick = (day: Date, e: MouseEvent<HTMLDivElement>) => {
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    // Redondear a la media hora en la que se ha hecho clic.
    const minutes = startHour * 60 + Math.floor((y / HOUR_PX) * 2) * 30;
    const h = String(Math.floor(minutes / 60)).padStart(2, "0");
    const m = String(minutes % 60).padStart(2, "0");
    onCreate(day, `${h}:${m}`);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
          Hoy
        </Button>
        <Button variant="ghost" size="icon" aria-label="Semana anterior" onClick={() => setWeekStart(addWeeks(weekStart, -1))}>
          <ChevronLeft className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Semana siguiente" onClick={() => setWeekStart(addWeeks(weekStart, 1))}>
          <ChevronRight className="size-5" />
        </Button>
        <h2 className="font-serif text-xl font-semibold text-foreground">{rangeLabel}</h2>
        <span className="ml-auto text-sm text-muted-foreground">
          {inWeek.filter((a) => a.status !== "cancelada").length} citas esta semana
        </span>
      </div>

      {/* En pantallas estrechas la rejilla se desplaza en horizontal dentro de su caja. */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <div className="min-w-[760px]">
          {/* Cabecera de días */}
          <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-border">
            <div />
            {days.map((d) => {
              const today = isSameDay(d, now);
              const psicolink = isPsicolink?.(d) ?? false;
              return (
                <div key={d.toISOString()}
                  className={cn("border-l border-border px-2 py-2 text-center", psicolink && PSICOLINK_COLUMN_CLASS)}>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {format(d, "EEE", { locale: es })}
                  </div>
                  <div
                    className={cn(
                      "mx-auto mt-0.5 flex size-8 items-center justify-center rounded-full text-sm font-medium",
                      today ? "bg-primary text-primary-foreground" : "text-foreground"
                    )}
                  >
                    {format(d, "d")}
                  </div>
                  {onTogglePsicolink && (
                    <button
                      type="button"
                      onClick={() => onTogglePsicolink(d)}
                      aria-pressed={psicolink}
                      title={psicolink ? "Día de Psicolink (clic para quitar)" : "Marcar como día de Psicolink"}
                      className={cn(
                        "mt-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
                        psicolink
                          ? "bg-sky-600 text-white hover:bg-sky-700"
                          : "border border-dashed border-border text-muted-foreground/60 hover:border-sky-400 hover:text-sky-700"
                      )}
                    >
                      Psicolink
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Rejilla horaria */}
          <div className="grid grid-cols-[56px_repeat(7,1fr)]">
            <div className="relative" style={{ height: gridHeight }}>
              {hours.map((h, i) => (
                <div key={h} className="absolute right-2 -translate-y-1/2 text-xs text-muted-foreground"
                  style={{ top: i * HOUR_PX }}>
                  {i === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
                </div>
              ))}
            </div>

            {days.map((day) => {
              const dayItems = inWeek.filter((a) => isSameDay(new Date(a.starts_at), day));
              const showNow = isSameDay(day, now);
              const nowTop = ((minutesOfDay(now) - startHour * 60) / 60) * HOUR_PX;
              return (
                <div
                  key={day.toISOString()}
                  className={cn(
                    "relative cursor-pointer border-l border-border",
                    isPsicolink?.(day) ? PSICOLINK_COLUMN_CLASS
                      : startOfDay(day) < startOfDay(now) && "bg-muted/30"
                  )}
                  style={{ height: gridHeight }}
                  onClick={(e) => handleEmptyClick(day, e)}
                  title="Clic para crear una cita"
                >
                  {hours.map((h, i) => (
                    <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-border/70"
                      style={{ top: i * HOUR_PX }} />
                  ))}

                  {showNow && nowTop >= 0 && nowTop <= gridHeight && (
                    <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-destructive"
                      style={{ top: nowTop }}>
                      <span className="absolute -left-1 -top-[5px] size-2 rounded-full bg-destructive" />
                    </div>
                  )}

                  {layoutDay(dayItems).map(({ a, lane, lanes }) => {
                    const start = new Date(a.starts_at);
                    const top = ((minutesOfDay(start) - startHour * 60) / 60) * HOUR_PX;
                    const height = Math.max((a.duration_minutes / 60) * HOUR_PX - 2, 22);
                    const isFirst = a.session_type === "primera" && a.status !== "cancelada";
                    const unpaid = isPendingPayment(a) && start.getTime() < now.getTime();
                    const alert = alertFor?.(a) ?? null;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(a);
                        }}
                        className={cn(
                          "absolute z-10 overflow-hidden rounded-[6px] border-l-4 px-1.5 py-1 text-left text-xs leading-tight shadow-sm transition-colors",
                          alert ? ALERT_BLOCK_CLASS
                          // Primera sesión ya pagada: color normal (sigue llevando «1ª sesión»).
                          : isFirst && !a.paid_at ? FIRST_BLOCK_CLASS
                          : BLOCK_CLASS[a.status]
                        )}
                        style={{
                          top: top + 1,
                          height,
                          left: `calc(${(lane / lanes) * 100}% + 2px)`,
                          width: `calc(${100 / lanes}% - 4px)`,
                        }}
                        title={[
                          patientName(a.patient_id),
                          format(start, "HH:mm"),
                          `${a.duration_minutes} min`,
                          isFirst && "Primera sesión",
                          alert ?? (unpaid && "Pendiente de pago"),
                        ].filter(Boolean).join(" · ")}
                      >
                        {(unpaid || alert) && (
                          <span className={cn(
                            "absolute right-1 top-1 rounded-sm px-1 text-[10px] font-semibold leading-4 text-white",
                            alert ? "bg-destructive" : "bg-amber-500"
                          )}
                            aria-label="Pendiente de pago">€</span>
                        )}
                        {isFirst && (
                          <span className="block text-[10px] font-semibold uppercase tracking-wide">1ª sesión</span>
                        )}
                        <span className="block truncate font-medium">{patientName(a.patient_id)}</span>
                        <span className="block truncate opacity-80">
                          {format(start, "HH:mm")}–{format(new Date(start.getTime() + a.duration_minutes * 60_000), "HH:mm")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Haz clic en un hueco para crear una cita a esa hora, o en una cita para editarla.
      </p>
    </div>
  );
}
