import { useEffect, useMemo, useRef, useState, type MouseEvent, type TouchEvent } from "react";
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
import { useIsMobile } from "@/hooks/useMobile";
import { cn } from "@/lib/utils";
import type { AgendaEvent, AgendaSlot, Appointment } from "@/lib/supabase";
import { isPendingPayment } from "@/lib/tariffs";
import { notePreview } from "./format";

const HOUR_PX = 56; // alto de una hora en la rejilla
const HOUR_PX_MOBILE = 80; // en el móvil (vista de un día) hay sitio para más texto
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

// Eventos (tareas, reuniones…): violeta y rayado, para no confundirlos con citas.
const EVENT_BLOCK_CLASS =
  "border-violet-500 bg-[repeating-linear-gradient(135deg,oklch(0.95_0.03_295)_0_6px,oklch(0.92_0.045_295)_6px_12px)] text-violet-950 hover:brightness-95";

// Huecos abiertos para que reserven los pacientes: borde discontinuo y fondo claro.
const OPEN_SLOT_CLASS =
  "border-2 border-dashed border-primary/60 bg-background/80 text-primary hover:bg-primary/5";

// Pagos pendientes: en rojo, por encima de cualquier otro color.
const ALERT_BLOCK_CLASS = "border-destructive bg-destructive/15 text-foreground ring-1 ring-destructive/40 hover:bg-destructive/25";

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

// Lo que ocupa un hueco en la rejilla: una cita, un evento o un hueco abierto.
type Slot =
  | { kind: "cita"; a: Appointment }
  | { kind: "evento"; e: AgendaEvent }
  | { kind: "libre"; h: AgendaSlot };
const slotMinutes = (h: AgendaSlot) => Math.round((new Date(h.ends_at).getTime() - new Date(h.starts_at).getTime()) / 60_000);
const slotTiming = (s: Slot): { starts_at: string; duration_minutes: number } =>
  s.kind === "cita" ? s.a : s.kind === "evento" ? s.e : { starts_at: s.h.starts_at, duration_minutes: slotMinutes(s.h) };

// Reparte las citas y eventos que se solapan en carriles para que no se tapen.
function layoutDay(items: Slot[]) {
  const sorted = [...items].sort((x, y) => slotTiming(x).starts_at.localeCompare(slotTiming(y).starts_at));
  const placed: { s: Slot; lane: number; lanes: number }[] = [];
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

  for (const s of sorted) {
    const { starts_at, duration_minutes } = slotTiming(s);
    const start = minutesOfDay(new Date(starts_at));
    const end = start + duration_minutes;
    if (group.length && start >= groupEnd) flush();
    let lane = laneEnds.findIndex((e) => e <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = end;
    groupEnd = Math.max(groupEnd, end);
    group.push({ s, lane, lanes: 1 });
  }
  if (group.length) flush();
  return placed;
}

export function WeekCalendar({
  appointments,
  events = [],
  openSlots = [],
  patientName,
  notesFor,
  onSelect,
  onSelectEvent,
  onSelectSlot,
  onCreate,
  alertFor,
  isPsicolink,
  onTogglePsicolink,
}: {
  appointments: Appointment[];
  events?: AgendaEvent[];
  openSlots?: AgendaSlot[]; // huecos abiertos («Libre»)
  patientName: (id: string) => string;
  notesFor?: (a: Appointment) => string | undefined;
  onSelect: (a: Appointment) => void;
  onSelectEvent?: (e: AgendaEvent) => void;
  onSelectSlot?: (h: AgendaSlot) => void;
  onCreate: (date: Date, time: string) => void;
  alertFor?: (a: Appointment) => string | null;
  isPsicolink?: (day: Date) => boolean;
  onTogglePsicolink?: (day: Date) => void;
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  // En el móvil se ve un solo día (el elegido en la tira de la semana).
  const isMobile = useIsMobile();
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const hourPx = isMobile ? HOUR_PX_MOBILE : HOUR_PX;
  const pickDay = (d: Date) => {
    setSelectedDay(startOfDay(d));
    setWeekStart(startOfWeek(d, { weekStartsOn: 1 }));
  };
  const goToday = () => pickDay(new Date());
  const step = (dir: 1 | -1) => (isMobile ? pickDay(addDays(selectedDay, dir)) : setWeekStart(addWeeks(weekStart, dir)));
  // Deslizar el dedo a izquierda o derecha cambia de día.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const t0 = touchStart.current;
    touchStart.current = null;
    if (!t0 || !isMobile) return;
    const dx = e.changedTouches[0].clientX - t0.x;
    const dy = e.changedTouches[0].clientY - t0.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) step(dx < 0 ? 1 : -1);
  };
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const gridDays = isMobile ? [selectedDay] : days;
  const weekEnd = addDays(weekStart, 7);

  const isInWeek = (iso: string) => {
    const d = new Date(iso);
    return d >= weekStart && d < weekEnd;
  };
  const inWeek = appointments.filter((a) => isInWeek(a.starts_at));
  const eventsInWeek = events.filter((e) => isInWeek(e.starts_at));
  const slotsInWeek = openSlots.filter((h) => isInWeek(h.starts_at));

  // Ampliar la franja horaria si alguna cita o evento cae fuera de 8:00–21:00.
  let startHour = DEFAULT_START;
  let endHour = DEFAULT_END;
  for (const a of [...inWeek, ...eventsInWeek, ...slotsInWeek.map((h) => ({ starts_at: h.starts_at, duration_minutes: slotMinutes(h) }))]) {
    const s = new Date(a.starts_at);
    startHour = Math.min(startHour, s.getHours());
    endHour = Math.max(endHour, Math.ceil((minutesOfDay(s) + a.duration_minutes) / 60));
  }
  endHour = Math.min(endHour, 24);
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const gridHeight = hours.length * hourPx;

  const last = addDays(weekStart, 6);
  const rangeLabel = isSameMonth(weekStart, last)
    ? `${format(weekStart, "d")} – ${format(last, "d 'de' MMMM yyyy", { locale: es })}`
    : `${format(weekStart, "d MMM", { locale: es })} – ${format(last, "d MMM yyyy", { locale: es })}`;
  const dayLabel = format(selectedDay, "EEEE d 'de' MMMM", { locale: es });
  const dayCount = inWeek.filter((a) => a.status !== "cancelada" && isSameDay(new Date(a.starts_at), selectedDay)).length;
  const gridCols = isMobile ? "grid-cols-[44px_1fr]" : "grid-cols-[56px_repeat(7,1fr)]";

  const handleEmptyClick = (day: Date, e: MouseEvent<HTMLDivElement>) => {
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    // Redondear a la media hora en la que se ha hecho clic.
    const minutes = startHour * 60 + Math.floor((y / hourPx) * 2) * 30;
    const h = String(Math.floor(minutes / 60)).padStart(2, "0");
    const m = String(minutes % 60).padStart(2, "0");
    onCreate(day, `${h}:${m}`);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={goToday}>
          Hoy
        </Button>
        <Button variant="ghost" size="icon" aria-label={isMobile ? "Día anterior" : "Semana anterior"} onClick={() => step(-1)}>
          <ChevronLeft className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" aria-label={isMobile ? "Día siguiente" : "Semana siguiente"} onClick={() => step(1)}>
          <ChevronRight className="size-5" />
        </Button>
        {isMobile ? (
          <h2 className="font-serif text-lg font-semibold text-foreground first-letter:uppercase">{dayLabel}</h2>
        ) : (
          <h2 className="font-serif text-xl font-semibold text-foreground">{rangeLabel}</h2>
        )}
        <span className="ml-auto text-sm text-muted-foreground">
          {isMobile
            ? `${dayCount} ${dayCount === 1 ? "cita" : "citas"}`
            : `${inWeek.filter((a) => a.status !== "cancelada").length} citas esta semana`}
        </span>
      </div>

      {/* Móvil: tira con los 7 días de la semana para elegir cuál ver. */}
      {isMobile && (
        <div className="mb-3 grid grid-cols-7 gap-1">
          {days.map((d) => {
            const selected = isSameDay(d, selectedDay);
            const count = inWeek.filter((a) => a.status !== "cancelada" && isSameDay(new Date(a.starts_at), d)).length;
            return (
              <button key={d.toISOString()} type="button" onClick={() => pickDay(d)} aria-pressed={selected}
                className={cn(
                  "flex flex-col items-center rounded-xl py-1.5 text-xs transition-colors",
                  selected ? "bg-primary text-primary-foreground"
                  : isPsicolink?.(d) ? "bg-sky-100 text-foreground"
                  : "text-foreground hover:bg-muted"
                )}>
                <span className={cn("uppercase", !selected && "text-muted-foreground")}>{format(d, "EEEEE", { locale: es })}</span>
                <span className={cn("text-base font-semibold", isSameDay(d, now) && !selected && "text-primary underline underline-offset-4")}>
                  {format(d, "d")}
                </span>
                <span className={cn("mt-0.5 size-1.5 rounded-full", count ? (selected ? "bg-primary-foreground" : "bg-primary") : "bg-transparent")} />
              </button>
            );
          })}
        </div>
      )}
      {isMobile && onTogglePsicolink && (
        <button type="button" onClick={() => onTogglePsicolink(selectedDay)} aria-pressed={isPsicolink?.(selectedDay)}
          className={cn(
            "mb-3 rounded-full px-3 py-1 text-xs font-medium transition-colors",
            isPsicolink?.(selectedDay)
              ? "bg-sky-600 text-white"
              : "border border-dashed border-border text-muted-foreground"
          )}>
          {isPsicolink?.(selectedDay) ? "Día de Psicolink (toca para quitar)" : "Marcar como día de Psicolink"}
        </button>
      )}

      {/* En pantallas estrechas la rejilla se desplaza en horizontal dentro de su caja. */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className={isMobile ? "" : "min-w-[760px]"}>
          {/* Cabecera de días (en el móvil la sustituye la tira de arriba) */}
          {!isMobile && <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-border">
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
          </div>}

          {/* Rejilla horaria */}
          <div className={cn("grid", gridCols)}>
            <div className="relative" style={{ height: gridHeight }}>
              {hours.map((h, i) => (
                <div key={h} className="absolute right-2 -translate-y-1/2 text-xs text-muted-foreground"
                  style={{ top: i * hourPx }}>
                  {i === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
                </div>
              ))}
            </div>

            {gridDays.map((day) => {
              const dayItems: Slot[] = [
                ...inWeek.filter((a) => isSameDay(new Date(a.starts_at), day)).map((a) => ({ kind: "cita" as const, a })),
                ...eventsInWeek.filter((e) => isSameDay(new Date(e.starts_at), day)).map((e) => ({ kind: "evento" as const, e })),
                ...slotsInWeek.filter((h) => isSameDay(new Date(h.starts_at), day)).map((h) => ({ kind: "libre" as const, h })),
              ];
              const showNow = isSameDay(day, now);
              const nowTop = ((minutesOfDay(now) - startHour * 60) / 60) * hourPx;
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
                  title={isMobile ? undefined : "Clic para añadir una cita o un evento"}
                >
                  {hours.map((h, i) => (
                    <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-border/70"
                      style={{ top: i * hourPx }} />
                  ))}

                  {showNow && nowTop >= 0 && nowTop <= gridHeight && (
                    <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-destructive"
                      style={{ top: nowTop }}>
                      <span className="absolute -left-1 -top-[5px] size-2 rounded-full bg-destructive" />
                    </div>
                  )}

                  {layoutDay(dayItems).map(({ s, lane, lanes }) => {
                    const position = (startIso: string, minutes: number) => {
                      const top = ((minutesOfDay(new Date(startIso)) - startHour * 60) / 60) * hourPx;
                      return {
                        top: top + 1,
                        height: Math.max((minutes / 60) * hourPx - 2, 22),
                        left: `calc(${(lane / lanes) * 100}% + 2px)`,
                        width: `calc(${100 / lanes}% - 4px)`,
                      };
                    };
                    if (s.kind === "libre") {
                      const h = s.h;
                      return (
                        <button
                          key={`libre-${h.id}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectSlot?.(h);
                          }}
                          className={cn(
                            "absolute z-10 overflow-hidden rounded-[6px] px-1.5 py-1 text-left text-xs leading-tight transition-colors",
                            OPEN_SLOT_CLASS
                          )}
                          style={position(h.starts_at, slotMinutes(h))}
                          title={`Hueco libre · ${format(new Date(h.starts_at), "HH:mm")}–${format(new Date(h.ends_at), "HH:mm")} · reservable por tus pacientes`}
                        >
                          <span className="block text-[10px] font-semibold uppercase tracking-wide">Libre</span>
                          <span className="block truncate opacity-80">
                            {format(new Date(h.starts_at), "HH:mm")}–{format(new Date(h.ends_at), "HH:mm")}
                          </span>
                        </button>
                      );
                    }
                    if (s.kind === "evento") {
                      const ev = s.e;
                      const start = new Date(ev.starts_at);
                      const end = new Date(start.getTime() + ev.duration_minutes * 60_000);
                      return (
                        <button
                          key={`ev-${ev.id}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectEvent?.(ev);
                          }}
                          className={cn(
                            "absolute z-10 overflow-hidden rounded-[6px] border-l-4 px-1.5 py-1 text-left text-xs leading-tight shadow-sm transition",
                            EVENT_BLOCK_CLASS
                          )}
                          style={position(ev.starts_at, ev.duration_minutes)}
                          title={[ev.title, `${format(start, "HH:mm")}–${format(end, "HH:mm")}`, "Evento"].join(" · ")}
                        >
                          <span className="block text-[10px] font-semibold uppercase tracking-wide">Evento</span>
                          <span className="block truncate font-medium">{ev.title}</span>
                          <span className="block truncate opacity-80">
                            {format(start, "HH:mm")}–{format(end, "HH:mm")}
                          </span>
                        </button>
                      );
                    }
                    const a = s.a;
                    const start = new Date(a.starts_at);
                    const isFirst = a.session_type === "primera" && a.status !== "cancelada";
                    const unpaid = isPendingPayment(a) && start.getTime() < now.getTime();
                    const alert = alertFor?.(a) ?? null;
                    const notes = notesFor?.(a);
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
                        style={position(a.starts_at, a.duration_minutes)}
                        title={[
                          patientName(a.patient_id),
                          format(start, "HH:mm"),
                          `${a.duration_minutes} min`,
                          isFirst && "Primera sesión",
                          alert ?? (unpaid && "Pendiente de pago"),
                        ].filter(Boolean).join(" · ") + (notes ? `\n\n${notePreview(notes)}` : "")}
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
                        {/* En el móvil no hay «pasar el ratón»: las notas se ven en la propia cita. */}
                        {isMobile && notes && (
                          <span className="mt-0.5 line-clamp-2 whitespace-pre-line italic opacity-80">{notes}</span>
                        )}
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
        {isMobile
          ? "Toca un hueco para añadir una cita o un evento, o uno ya creado para editarlo. Desliza a los lados para cambiar de día."
          : "Haz clic en un hueco para añadir una cita o un evento a esa hora, o en uno ya creado para editarlo."}
      </p>
    </div>
  );
}
