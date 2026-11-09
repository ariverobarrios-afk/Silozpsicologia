import { useState, type FormEvent } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarClock, CalendarIcon, CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase, type AgendaEvent } from "@/lib/supabase";
import { TIME_SLOTS } from "./AppointmentDialog";
import { fromInputs, toTimeInput } from "./format";

const DURATIONS = [30, 60, 90, 120, 180, 240, 300, 360, 480, 600];

export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// Al añadir algo en la agenda: ¿una cita con un paciente o un evento?
export function NewEntryDialog({
  canAddAppointment,
  onClose,
  onAppointment,
  onEvent,
}: {
  canAddAppointment: boolean;
  onClose: () => void;
  onAppointment: () => void;
  onEvent: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>¿Qué quieres añadir?</DialogTitle>
          <DialogDescription>Los eventos bloquean esas horas en tu agenda; los pacientes no los ven.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button variant="outline" className="h-auto flex-col gap-1 rounded-2xl py-5" onClick={onAppointment}
            disabled={!canAddAppointment} title={canAddAppointment ? undefined : "Primero da de alta a un paciente"}>
            <CalendarPlus className="size-6 text-primary" />
            <span className="font-medium">Cita</span>
            <span className="text-xs font-normal text-muted-foreground">Sesión con un paciente</span>
          </Button>
          <Button variant="outline" className="h-auto flex-col gap-1 rounded-2xl py-5" onClick={onEvent}>
            <CalendarClock className="size-6 text-violet-600" />
            <span className="font-medium">Evento</span>
            <span className="text-xs font-normal text-muted-foreground">Tarea, reunión, otro centro…</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EventDialog({
  event,
  defaultDate,
  defaultTime,
  onClose,
  onSaved,
}: {
  event: AgendaEvent | null;
  defaultDate?: Date;
  defaultTime?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(event?.title ?? "");
  const [date, setDate] = useState<Date | undefined>(event ? new Date(event.starts_at) : defaultDate);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const initialTime = event ? toTimeInput(event.starts_at) : defaultTime ?? "";
  const [time, setTime] = useState(TIME_SLOTS.includes(initialTime) ? initialTime : "");
  const [duration, setDuration] = useState(String(event?.duration_minutes ?? 60));
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const durations = DURATIONS.includes(Number(duration)) ? DURATIONS : [...DURATIONS, Number(duration)].sort((a, b) => a - b);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date || !time) {
      toast.error("Indica el nombre, la fecha y la hora del evento.");
      return;
    }
    const row = {
      title: title.trim(),
      starts_at: fromInputs(format(date, "yyyy-MM-dd"), time),
      duration_minutes: Number(duration),
    };
    setBusy(true);
    const { error } = event
      ? await supabase!.from("agenda_events").update(row).eq("id", event.id)
      : await supabase!.from("agenda_events").insert(row);
    setBusy(false);
    if (error) {
      toast.error("No se pudo guardar el evento.");
      return;
    }
    toast.success(event ? "Evento actualizado." : "Evento añadido a la agenda.");
    onSaved();
  };

  const onDelete = async () => {
    if (!event) return;
    setBusy(true);
    const { error } = await supabase!.from("agenda_events").delete().eq("id", event.id);
    setBusy(false);
    if (error) {
      toast.error("No se pudo borrar el evento.");
      return;
    }
    toast.success("Evento borrado.");
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{event ? "Editar evento" : "Nuevo evento"}</DialogTitle>
          <DialogDescription>Bloquea esas horas en tu agenda. Los pacientes no lo ven.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ev-title">Nombre del evento</Label>
            <Input id="ev-title" required autoFocus value={title} placeholder="Ej.: Reunión, formación, Psicolink…"
              onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ev-date">Fecha</Label>
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button id="ev-date" type="button" variant="outline" className="w-full justify-start rounded-md font-normal">
                  <CalendarIcon className="size-4 text-muted-foreground" />
                  {date ? (
                    <span className="first-letter:uppercase">{format(date, "EEEE d 'de' MMMM yyyy", { locale: es })}</span>
                  ) : (
                    <span className="text-muted-foreground">Elige una fecha</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" locale={es} weekStartsOn={1} selected={date} defaultMonth={date}
                  onSelect={(d) => { setDate(d); setCalendarOpen(false); }} />
              </PopoverContent>
            </Popover>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ev-time">Hora de inicio</Label>
              <Select value={time} onValueChange={(v) => v && setTime(v)}>
                <SelectTrigger id="ev-time" className="w-full"><SelectValue placeholder="Elige una hora" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {TIME_SLOTS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="ev-duration">Duración</Label>
              <Select value={duration} onValueChange={(v) => v && setDuration(v)}>
                <SelectTrigger id="ev-duration" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {durations.map((m) => <SelectItem key={m} value={String(m)}>{durationLabel(m)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {event ? (
              confirmDelete ? (
                <Button type="button" variant="destructive" disabled={busy} onClick={onDelete}>Sí, borrar</Button>
              ) : (
                <Button type="button" variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)}>
                  Borrar evento
                </Button>
              )
            ) : <span />}
            <Button type="submit" disabled={busy} className="rounded-full">
              {event ? "Guardar cambios" : "Añadir evento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
