import { useState, type FormEvent } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarIcon, CalendarPlus, CalendarX } from "lucide-react";
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
import { supabase, type AgendaSlot } from "@/lib/supabase";
import { capitalize, madridLongDay, madridTime } from "../../../../shared/madrid";
import { TIME_SLOTS } from "./AppointmentDialog";
import { durationLabel } from "./EventDialog";

// Duración de cada hueco: múltiplos de media hora, porque las citas solo
// empiezan en punto o a y media (huecos seguidos de 50 min no encajarían).
const SLOT_DURATIONS = [30, 60, 90, 120];
const END_TIMES = [...TIME_SLOTS.slice(1), "23:00"];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// «Abrir agenda»: crea huecos libres que los pacientes pueden reservar.
export function OpenAgendaDialog({
  defaultDate,
  onClose,
  onSaved,
}: {
  defaultDate?: Date;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState<Date | undefined>(defaultDate);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [from, setFrom] = useState("10:00");
  const [to, setTo] = useState("14:00");
  const [duration, setDuration] = useState("60");
  const [weeks, setWeeks] = useState("1");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!date) {
      toast.error("Elige la fecha.");
      return;
    }
    if (to <= from) {
      toast.error("La hora de fin debe ser posterior a la de inicio.");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase!.rpc("open_agenda_slots", {
      p_date: format(date, "yyyy-MM-dd"),
      p_from: from,
      p_to: to,
      p_slot_minutes: Number(duration),
      p_weeks: Math.max(1, Number(weeks) || 1),
    });
    setBusy(false);
    if (error) {
      toast.error(/NOT_ALLOWED/.test(error.message) ? "No autorizado." : error.message || "No se pudo abrir la agenda.");
      return;
    }
    const r = data as { created: number; skipped_busy: number; skipped_past: number };
    const parts = [
      r.created ? `Se han abierto ${plural(r.created, "hueco", "huecos")}` : "No se ha abierto ningún hueco",
      r.skipped_busy ? `${plural(r.skipped_busy, "se ha omitido", "se han omitido")} porque ya tenías algo a esa hora` : "",
      r.skipped_past ? `${plural(r.skipped_past, "estaba", "estaban")} en el pasado` : "",
    ].filter(Boolean);
    const message = parts.length > 2 ? `${parts[0]}; ${parts[1]} y ${parts[2]}.` : `${parts.join("; ")}.`;
    if (r.created) toast.success(message);
    else toast.warning(message);
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Abrir agenda</DialogTitle>
          <DialogDescription>
            Crea huecos libres que tus pacientes podrán reservar desde su área. Solo se ofrecen los huecos que abras
            aquí; se omiten los que choquen con algo que ya tengas.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="oa-date">Fecha</Label>
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button id="oa-date" type="button" variant="outline" className="w-full justify-start rounded-md font-normal">
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
                  disabled={{ before: new Date() }}
                  onSelect={(d) => { setDate(d); setCalendarOpen(false); }} />
              </PopoverContent>
            </Popover>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="oa-from">Desde</Label>
              <Select value={from} onValueChange={(v) => v && setFrom(v)}>
                <SelectTrigger id="oa-from" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {TIME_SLOTS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="oa-to">Hasta</Label>
              <Select value={to} onValueChange={(v) => v && setTo(v)}>
                <SelectTrigger id="oa-to" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {END_TIMES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="oa-duration">Duración de cada hueco</Label>
              <Select value={duration} onValueChange={(v) => v && setDuration(v)}>
                <SelectTrigger id="oa-duration" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SLOT_DURATIONS.map((m) => <SelectItem key={m} value={String(m)}>{durationLabel(m)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="oa-weeks">Semanas</Label>
              <Input id="oa-weeks" type="number" min={1} max={12} value={weeks}
                onChange={(e) => setWeeks(e.target.value)} />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Semanas: 1 = solo ese día; 4 = ese mismo día de la semana durante 4 semanas.
          </p>
          <DialogFooter>
            <Button type="submit" disabled={busy} className="rounded-full">
              <CalendarPlus className="size-4" />
              Abrir huecos
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Al pulsar un hueco libre en la agenda: cerrarlo o asignarlo a un paciente.
export function SlotDialog({
  slot,
  onClose,
  onClosed,
  onConvert,
}: {
  slot: AgendaSlot;
  onClose: () => void;
  onClosed: () => void;
  onConvert: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const closeSlot = async () => {
    setBusy(true);
    const { error } = await supabase!.rpc("close_agenda_slot", { p_slot_id: slot.id });
    setBusy(false);
    if (error) {
      toast.error(/SLOT_UNAVAILABLE/.test(error.message)
        ? "Este hueco ya no está libre (puede que un paciente acabe de reservarlo)."
        : "No se pudo cerrar el hueco.");
    } else {
      toast.success("Hueco cerrado: ya no se ofrece a los pacientes.");
    }
    onClosed();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Hueco libre</DialogTitle>
          <DialogDescription>
            {capitalize(madridLongDay(slot.starts_at, true))}, {madridTime(slot.starts_at)} – {madridTime(slot.ends_at)}.
            Tus pacientes pueden reservarlo desde su área.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button variant="outline" className="h-auto flex-col gap-1 rounded-2xl py-5" disabled={busy} onClick={onConvert}>
            <CalendarPlus className="size-6 text-primary" />
            <span className="font-medium">Convertir en cita</span>
            <span className="text-xs font-normal text-muted-foreground">Asignarlo tú a un paciente</span>
          </Button>
          <Button variant="outline" className="h-auto flex-col gap-1 rounded-2xl py-5" disabled={busy} onClick={closeSlot}>
            <CalendarX className="size-6 text-destructive" />
            <span className="font-medium">Cerrar hueco</span>
            <span className="text-xs font-normal text-muted-foreground">Deja de ofrecerse</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
