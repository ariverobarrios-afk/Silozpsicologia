import { useEffect, useMemo, useState, type FormEvent } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarIcon, Sparkles } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  STATUS_LABEL,
  supabase,
  type Appointment,
  type AppointmentStatus,
  type Bono,
  type ProcessType,
  type Profile,
  type SessionType,
} from "@/lib/supabase";
import { BONO, PROCESS_LABEL, SESSION_TYPES, bonoRemaining, euros } from "@/lib/tariffs";
import { fromInputs, toTimeInput } from "./format";

// Las sesiones solo empiezan en punto o a y media.
export const TIME_SLOTS = Array.from({ length: 32 }, (_, i) => {
  const minutes = 7 * 60 + i * 30; // 07:00 … 22:30
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${minutes % 60 === 0 ? "00" : "30"}`;
});

export function AppointmentDialog({
  patients,
  appointments,
  bonos,
  appointment,
  defaultPatientId,
  defaultDate,
  defaultTime,
  onClose,
  onSaved,
}: {
  patients: Profile[];
  appointments: Appointment[];
  bonos: Bono[];
  appointment: Appointment | null;
  defaultPatientId?: string;
  defaultDate?: Date;
  defaultTime?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [patientId, setPatientId] = useState(appointment?.patient_id ?? defaultPatientId ?? "");
  const [date, setDate] = useState<Date | undefined>(
    appointment ? new Date(appointment.starts_at) : defaultDate
  );
  const [calendarOpen, setCalendarOpen] = useState(false);
  const initialTime = appointment ? toTimeInput(appointment.starts_at) : defaultTime ?? "";
  // Una cita antigua a una hora fuera de franja obliga a elegir una válida.
  const [time, setTime] = useState(TIME_SLOTS.includes(initialTime) ? initialTime : "");
  const [duration, setDuration] = useState(String(appointment?.duration_minutes ?? 50));
  const [status, setStatus] = useState<AppointmentStatus>(appointment?.status ?? "programada");
  const [sessionType, setSessionType] = useState<SessionType | "">(appointment?.session_type ?? "");
  const [bonoId, setBonoId] = useState<string>(appointment?.bono_id ?? "");
  const [paid, setPaid] = useState(Boolean(appointment?.paid_at));
  const [processType, setProcessType] = useState<ProcessType | "">("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const patient = patients.find((p) => p.id === patientId);

  // ¿Es la primera sesión? (ninguna otra cita no cancelada de este paciente)
  const isFirst = useMemo(
    () =>
      Boolean(patientId) &&
      !appointments.some(
        (a) => a.patient_id === patientId && a.status !== "cancelada" && a.id !== appointment?.id
      ),
    [appointments, patientId, appointment]
  );

  // Bonos del paciente con sesiones libres (más el de esta cita, si ya usa uno).
  const usableBonos = useMemo(
    () =>
      bonos
        .filter((b) => b.patient_id === patientId)
        .filter((b) => b.id === appointment?.bono_id || bonoRemaining(b, appointments) > 0)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [bonos, patientId, appointments, appointment]
  );

  // Al elegir paciente en una cita nueva, proponer la tarifa adecuada:
  // primera sesión → bono con sesiones libres → tarifa de su proceso.
  useEffect(() => {
    if (appointment || !patientId) return;
    setProcessType(patient?.process_type ?? "");
    if (isFirst) {
      setSessionType("primera");
    } else if (usableBonos.length > 0) {
      setSessionType("bono");
      setBonoId(usableBonos[0].id);
    } else {
      setSessionType(patient?.process_type === "pareja" ? "pareja" : "individual");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const needsProcess = Boolean(patient) && !patient?.process_type;

  // Si Silvia cambia el tipo de proceso, ajustar la tarifa normal propuesta.
  useEffect(() => {
    if (processType && (sessionType === "individual" || sessionType === "pareja")) {
      setSessionType(processType === "pareja" ? "pareja" : "individual");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processType]);
  const effectiveProcess = (patient?.process_type ?? processType) || "individual";
  const regularType: SessionType = effectiveProcess === "pareja" ? "pareja" : "individual";

  // Precio: se mantiene el de la cita si no cambia su tarifa (puede haber
  // cambiado la lista de precios desde entonces).
  const price =
    sessionType === "" ? 0
    : appointment && appointment.session_type === sessionType ? appointment.price_cents
    : SESSION_TYPES[sessionType].price_cents;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!patientId || !date || !time || !sessionType) {
      toast.error("Elige paciente, fecha, hora y tarifa.");
      return;
    }
    if (needsProcess && !processType) {
      toast.error("Indica si es un proceso individual o de pareja.");
      return;
    }
    if (sessionType === "bono" && !bonoId) {
      toast.error("Elige el bono del que se descuenta la sesión.");
      return;
    }
    setBusy(true);
    if (needsProcess && processType) {
      const { error } = await supabase!.from("profiles").update({ process_type: processType }).eq("id", patientId);
      if (error) {
        setBusy(false);
        toast.error("No se pudo guardar el tipo de proceso.");
        return;
      }
    }
    const isBono = sessionType === "bono";
    const row = {
      patient_id: patientId,
      starts_at: fromInputs(format(date, "yyyy-MM-dd"), time),
      duration_minutes: Number(duration) || 50,
      // La consulta es solo online.
      modality: "online" as const,
      status,
      session_type: sessionType,
      price_cents: isBono ? 0 : price,
      bono_id: isBono ? bonoId : null,
      // Conserva la fecha de cobro original si ya estaba pagada.
      paid_at: isBono || !paid ? null : appointment?.paid_at ?? new Date().toISOString(),
    };
    const { error } = appointment
      ? await supabase!.from("appointments").update(row).eq("id", appointment.id)
      : await supabase!.from("appointments").insert(row);
    setBusy(false);
    if (error) {
      toast.error(/bono/i.test(error.message) ? error.message : "No se pudo guardar la cita.");
      return;
    }
    toast.success(appointment ? "Cita actualizada." : "Cita creada.");
    onSaved();
  };

  const onDelete = async () => {
    if (!appointment) return;
    setBusy(true);
    const { error } = await supabase!.from("appointments").delete().eq("id", appointment.id);
    setBusy(false);
    if (error) {
      toast.error("No se pudo borrar la cita.");
      return;
    }
    toast.success("Cita borrada.");
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{appointment ? "Editar cita" : "Nueva cita"}</DialogTitle>
          <DialogDescription>El paciente verá esta cita en su área privada.</DialogDescription>
        </DialogHeader>

        {sessionType === "primera" && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-100 p-3 text-amber-950">
            <Sparkles className="mt-0.5 size-5 shrink-0" />
            <div className="text-sm">
              <p className="font-semibold">Primera sesión{patient ? ` de ${patient.full_name || patient.email}` : ""}</p>
              <p>Tarifa de primera sesión: {euros(SESSION_TYPES.primera.price_cents)}.</p>
            </div>
          </div>
        )}

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Paciente</Label>
            <Select value={patientId} onValueChange={setPatientId} disabled={Boolean(appointment)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Elige un paciente" /></SelectTrigger>
              <SelectContent>
                {patients.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needsProcess && (
            <div className="flex flex-col gap-2">
              <Label>Tipo de proceso</Label>
              <Select value={processType} onValueChange={(v) => setProcessType(v as ProcessType)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="¿Individual o de pareja?" /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PROCESS_LABEL) as ProcessType[]).map((k) => (
                    <SelectItem key={k} value={k}>{PROCESS_LABEL[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Se guarda en la ficha del paciente.</p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="date">Fecha</Label>
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button id="date" type="button" variant="outline"
                  className="w-full justify-start rounded-md font-normal">
                  <CalendarIcon className="size-4 text-muted-foreground" />
                  {date ? (
                    <span className="first-letter:uppercase">
                      {format(date, "EEEE d 'de' MMMM yyyy", { locale: es })}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Elige una fecha</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  locale={es}
                  weekStartsOn={1}
                  selected={date}
                  defaultMonth={date}
                  onSelect={(d) => {
                    setDate(d);
                    setCalendarOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="time">Hora</Label>
              <Select value={time} onValueChange={setTime}>
                <SelectTrigger id="time" className="w-full"><SelectValue placeholder="Elige una hora" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {TIME_SLOTS.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {initialTime && !TIME_SLOTS.includes(initialTime) && (
                <p className="text-xs text-muted-foreground">
                  Estaba a las {initialTime}; elige una hora en punto o y media.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="duration">Duración (min)</Label>
              <Input id="duration" type="number" min={5} max={480} step={5} value={duration}
                onChange={(e) => setDuration(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="tarifa">Tarifa</Label>
            <Select value={sessionType} onValueChange={(v) => {
              setSessionType(v as SessionType);
              if (v === "bono" && !bonoId && usableBonos[0]) setBonoId(usableBonos[0].id);
            }}>
              <SelectTrigger id="tarifa" className="w-full"><SelectValue placeholder="Elige la tarifa" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="primera">
                  {SESSION_TYPES.primera.label} · {euros(SESSION_TYPES.primera.price_cents)}
                </SelectItem>
                <SelectItem value={regularType}>
                  {SESSION_TYPES[regularType].label} · {euros(SESSION_TYPES[regularType].price_cents)}
                </SelectItem>
                {appointment && appointment.session_type !== regularType &&
                  appointment.session_type !== "primera" && appointment.session_type !== "bono" && (
                  <SelectItem value={appointment.session_type}>
                    {SESSION_TYPES[appointment.session_type].label} · {euros(appointment.price_cents)}
                  </SelectItem>
                )}
                {usableBonos.length > 0 && (
                  <SelectItem value="bono">Descontar de un bono</SelectItem>
                )}
              </SelectContent>
            </Select>
            {patientId && usableBonos.length === 0 && sessionType !== "primera" && (
              <p className="text-xs text-muted-foreground">
                Sin bono activo. Puedes venderle un {BONO.label.toLowerCase()} desde «Pagos».
              </p>
            )}
          </div>

          {sessionType === "bono" ? (
            <div className="flex flex-col gap-2">
              <Label>Bono</Label>
              <Select value={bonoId} onValueChange={setBonoId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Elige el bono" /></SelectTrigger>
                <SelectContent>
                  {usableBonos.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      Bono del {format(new Date(b.created_at), "d/M/yyyy")} · quedan {bonoRemaining(b, appointments)} de {b.sessions_total}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : sessionType !== "" && (
            <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Importe: {euros(price)}</p>
                <p className="text-xs text-muted-foreground">{paid ? "Cobrada" : "Pendiente de cobro"}</p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                Pagada
                <Switch checked={paid} onCheckedChange={setPaid} />
              </label>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label>Estado</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as AppointmentStatus)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_LABEL) as AppointmentStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {appointment ? (
              <Button type="button" variant={confirmDelete ? "destructive" : "ghost"} disabled={busy}
                onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}>
                {confirmDelete ? "Confirmar borrado" : "Borrar"}
              </Button>
            ) : <span />}
            <Button type="submit" disabled={busy} className="rounded-full">Guardar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
