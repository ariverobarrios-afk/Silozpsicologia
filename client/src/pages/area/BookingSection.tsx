import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarCheck, Mail, Phone, X } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { supabase, type AgendaSlot, type Appointment, type BookingSettings } from "@/lib/supabase";
import {
  DEFAULT_BOOKING_SETTINGS,
  FALLBACK_CONTACT,
  bookSlot,
  canCancelOnline,
  cancelBooking,
  type PsychologistContact,
} from "@/lib/booking";
import { capitalize, madridDayKey, madridLongDay, madridTime, madridWeekKey } from "../../../../shared/madrid";

const COMMENT_MAX = 300;

const minutesBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000);

// Datos que comparten la reserva y la cancelación: ajustes y contacto de la psicóloga.
export function useBookingContext() {
  const [settings, setSettings] = useState<BookingSettings>(DEFAULT_BOOKING_SETTINGS);
  const [psychologist, setPsychologist] = useState<PsychologistContact | null>(null);
  useEffect(() => {
    if (!supabase) return;
    supabase.from("booking_settings").select("min_advance_hours, max_window_days, cancel_limit_hours").maybeSingle()
      .then(({ data }) => data && setSettings(data as BookingSettings));
    supabase.rpc("my_psychologist").then(({ data }) => {
      const row = (data as PsychologistContact[] | null)?.[0];
      if (row) setPsychologist(row);
    });
  }, []);
  return { settings, psychologist };
}

// Canal de contacto: email y teléfono de su psicóloga (o los de la consulta).
export function ContactLinks({ psychologist }: { psychologist: PsychologistContact | null }) {
  const email = psychologist?.email || FALLBACK_CONTACT.email;
  const phone = psychologist?.phone || FALLBACK_CONTACT.phone;
  return (
    <span className="mt-2 flex flex-wrap gap-2">
      <a href={`mailto:${email}`}
        className="inline-flex items-center gap-1.5 rounded-full border border-current/30 px-3 py-1 text-sm font-medium underline-offset-4 hover:underline">
        <Mail className="size-4" />{email}
      </a>
      <a href={`tel:${phone.replace(/\s+/g, "")}`}
        className="inline-flex items-center gap-1.5 rounded-full border border-current/30 px-3 py-1 text-sm font-medium underline-offset-4 hover:underline">
        <Phone className="size-4" />{phone}
      </a>
    </span>
  );
}

// Aviso destacado (no un toast que se va solo): reglas que el paciente debe leer.
export function Banner({ message, psychologist, onClose }: {
  message: string;
  psychologist: PsychologistContact | null;
  onClose: () => void;
}) {
  return (
    <div role="alert" className="mb-4 flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <AlertTriangle className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{message}</p>
        <ContactLinks psychologist={psychologist} />
      </div>
      <button type="button" onClick={onClose} aria-label="Cerrar aviso"
        className="flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-amber-100">
        <X className="size-4" />
      </button>
    </div>
  );
}

const WEEK_LIMIT_MESSAGE = "Ya tienes una cita esta semana. Si necesitas otra, ponte en contacto con tu psicóloga.";

export function BookingSection({
  appointments,
  settings,
  psychologist,
  onBooked,
}: {
  appointments: Appointment[];
  settings: BookingSettings;
  psychologist: PsychologistContact | null;
  onBooked: () => void;
}) {
  const [slots, setSlots] = useState<AgendaSlot[] | null>(null);
  const [error, setError] = useState(false);
  const [chosen, setChosen] = useState<AgendaSlot | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  // La base de datos (RLS) solo devuelve huecos abiertos de SU psicóloga y
  // dentro de la ventana de reserva; el filtro de fechas es solo por claridad.
  const loadSlots = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("agenda_slots")
      .select("id, starts_at, ends_at, status")
      .eq("status", "abierto")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true });
    if (error) setError(true);
    else setSlots((data as AgendaSlot[]) ?? []);
  }, []);
  // También al cambiar sus citas: al cancelar una, su hueco vuelve a ofrecerse.
  useEffect(() => { loadSlots(); }, [loadSlots, appointments]);

  // Semanas (lunes a domingo, hora de Madrid) en las que ya tiene una cita.
  const busyWeeks = useMemo(
    () => new Set(appointments.filter((a) => a.status !== "cancelada").map((a) => madridWeekKey(a.starts_at))),
    [appointments]
  );

  const byDay = useMemo(() => {
    const groups = new Map<string, AgendaSlot[]>();
    for (const s of slots ?? []) {
      const key = madridDayKey(s.starts_at);
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    return Array.from(groups.values());
  }, [slots]);

  const choose = (s: AgendaSlot) => {
    if (busyWeeks.has(madridWeekKey(s.starts_at))) {
      setBanner(WEEK_LIMIT_MESSAGE);
      return;
    }
    setBanner(null);
    setComment("");
    setChosen(s);
  };

  const confirm = async () => {
    if (!chosen) return;
    setBusy(true);
    const result = await bookSlot(chosen.id, comment.trim());
    setBusy(false);
    setChosen(null);
    if (result.success) {
      toast.success(`Cita reservada: ${madridLongDay(chosen.starts_at)} a las ${madridTime(chosen.starts_at)}.`);
      onBooked();
    } else if (result.code === "week_limit") {
      setBanner(result.message);
    } else if (result.code === "slot_unavailable") {
      toast.error(result.message);
    } else {
      toast.error(result.message);
    }
    loadSlots();
  };

  const psychologistName = psychologist?.full_name || "tu psicóloga";

  return (
    <section className="mb-10 flex flex-col">
      <h2 className="mb-1 font-serif text-2xl font-semibold text-foreground">Reservar cita</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Huecos que {psychologistName} ha abierto en su agenda. Se puede reservar con al menos{" "}
        {settings.min_advance_hours} h de antelación y una cita por semana. Horas de Madrid.
      </p>

      {banner && <Banner message={banner} psychologist={psychologist} onClose={() => setBanner(null)} />}
      {error && <p className="text-destructive">No se pudieron cargar los huecos. Recarga la página.</p>}
      {!slots && !error && <Spinner className="size-6 text-primary" />}

      {slots && slots.length === 0 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-foreground">Tu psicóloga no tiene huecos abiertos ahora mismo. Escríbele para pedir cita.</p>
          <span className="text-primary"><ContactLinks psychologist={psychologist} /></span>
        </div>
      )}

      {slots && slots.length > 0 && (
        <ul className="flex flex-col gap-4">
          {byDay.map((day) => {
            const blocked = busyWeeks.has(madridWeekKey(day[0].starts_at));
            return (
              <li key={day[0].id} className="rounded-2xl border border-border bg-card p-4">
                <p className={cn("font-medium text-foreground", blocked && "text-muted-foreground")}>
                  {capitalize(madridLongDay(day[0].starts_at))}
                </p>
                {blocked && <p className="text-sm text-muted-foreground">Ya tienes cita esta semana</p>}
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {day.map((s) => (
                    <button key={s.id} type="button" onClick={() => choose(s)} aria-disabled={blocked}
                      className={cn(
                        "flex min-h-12 flex-col items-center justify-center rounded-xl border px-2 py-2 text-center transition-colors",
                        blocked
                          ? "cursor-not-allowed border-border bg-muted/50 text-muted-foreground opacity-60"
                          : "border-primary/40 bg-primary/5 text-foreground hover:border-primary hover:bg-primary/10"
                      )}
                      title={blocked ? "Ya tienes cita esta semana" : undefined}>
                      <span className="text-base font-semibold">{madridTime(s.starts_at)}</span>
                      <span className="text-xs text-muted-foreground">{minutesBetween(s.starts_at, s.ends_at)} min</span>
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {chosen && (
        <Dialog open onOpenChange={(open) => !open && !busy && setChosen(null)}>
          <DialogContent className="sm:max-w-[440px]">
            <DialogHeader>
              <DialogTitle>Confirmar reserva</DialogTitle>
              <DialogDescription>Revisa los datos antes de confirmar.</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl bg-secondary p-4 text-sm">
              <dt className="text-muted-foreground">Fecha</dt>
              <dd className="font-medium text-foreground">{capitalize(madridLongDay(chosen.starts_at, true))}</dd>
              <dt className="text-muted-foreground">Hora</dt>
              <dd className="font-medium text-foreground">{madridTime(chosen.starts_at)} – {madridTime(chosen.ends_at)}</dd>
              <dt className="text-muted-foreground">Duración</dt>
              <dd className="font-medium text-foreground">{minutesBetween(chosen.starts_at, chosen.ends_at)} min</dd>
              <dt className="text-muted-foreground">Psicóloga</dt>
              <dd className="font-medium text-foreground">{psychologist?.full_name || "Tu psicóloga"}</dd>
            </dl>
            <div className="flex flex-col gap-2">
              <Label htmlFor="booking-comment">Comentario para tu psicóloga (opcional)</Label>
              <Textarea id="booking-comment" value={comment} maxLength={COMMENT_MAX} rows={3}
                onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX))} />
              <p className="text-right text-xs text-muted-foreground">{comment.length}/{COMMENT_MAX}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Podrás cancelarla desde aquí hasta {settings.cancel_limit_hours} h antes.
            </p>
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setChosen(null)}>Volver</Button>
              <Button type="button" className="rounded-full" disabled={busy} onClick={confirm}>
                {busy ? <Spinner className="size-4" /> : <CalendarCheck className="size-4" />}
                Confirmar reserva
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

// Botón «Cancelar cita» de una cita reservada por el propio paciente. Se ve
// siempre; dentro del plazo no cancela y avisa de que contacte con su psicóloga
// (el servidor lo rechaza igualmente).
export function CancelBookingButton({
  appointment,
  settings,
  onTooLate,
  onCancelled,
}: {
  appointment: Appointment;
  settings: BookingSettings;
  onTooLate: (message: string) => void;
  onCancelled: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const tooLateMessage = "Ya no se puede cancelar esta cita desde aquí. Avisa directamente a tu psicóloga.";

  const onClick = () => {
    if (!canCancelOnline(appointment.starts_at, settings.cancel_limit_hours)) onTooLate(tooLateMessage);
    else setConfirming(true);
  };

  const doCancel = async () => {
    setBusy(true);
    const result = await cancelBooking(appointment.id);
    setBusy(false);
    setConfirming(false);
    if (result.success) {
      toast.success("Cita cancelada.");
      onCancelled();
    } else if (result.code === "too_late") {
      onTooLate(result.message);
    } else {
      toast.error(result.message);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" className="text-destructive" onClick={onClick}>Cancelar cita</Button>
      <AlertDialog open={confirming} onOpenChange={(o) => !busy && setConfirming(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar esta cita?</AlertDialogTitle>
            <AlertDialogDescription>
              {capitalize(madridLongDay(appointment.starts_at, true))} a las {madridTime(appointment.starts_at)}.
              Tu psicóloga recibirá un aviso y el hueco quedará libre para otra persona.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>No, mantenerla</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); doCancel(); }}
              className="bg-destructive text-white hover:bg-destructive/90">
              Sí, cancelar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
