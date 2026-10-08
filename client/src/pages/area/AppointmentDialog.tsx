import { useEffect, useMemo, useState, type FormEvent } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, CalendarIcon, Sparkles, Ticket, TicketCheck } from "lucide-react";
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
import { BONO, PROCESS_LABEL, SESSION_TYPES, bonoRemaining, bonoSessionNumber, euros, overdueDebts } from "@/lib/tariffs";
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
  onRefresh,
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
  onRefresh: () => Promise<void>; // recargar datos sin cerrar el diálogo
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
  const [sellingBono, setSellingBono] = useState(false);
  const [bonoPaidNow, setBonoPaidNow] = useState(false);
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

  // La primera sesión de un paciente se cobra siempre como tal: nunca con bono.
  // (Una cita que ya estaba guardada con bono se respeta para no dejarla sin tarifa.)
  const bonoBlocked =
    appointment?.session_type !== "bono" &&
    (isFirst || sessionType === "primera" || appointment?.session_type === "primera");

  // Solo puede haber una primera sesión (no cancelada) por paciente.
  const hasOtherFirst = useMemo(
    () =>
      appointments.some(
        (a) =>
          a.patient_id === patientId &&
          a.session_type === "primera" &&
          a.status !== "cancelada" &&
          a.id !== appointment?.id
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

  // Si la cita ya estaba guardada con un bono, esa sesión ya está descontada.
  const consumedBono =
    appointment?.bono_id && appointment.status !== "cancelada"
      ? bonos.find((b) => b.id === appointment.bono_id) ?? null
      : null;
  const consumedNumber = appointment ? bonoSessionNumber(appointment, appointments) : null;

  // Lo que el paciente ya debe (sin contar esta cita, que tiene su propio interruptor).
  const debts = patientId
    ? overdueDebts(patientId, appointments, bonos).filter((d) => d.id !== appointment?.id)
    : [];

  const markDebtPaid = async (kind: "bono" | "cita", id: string) => {
    const table = kind === "bono" ? "bonos" : "appointments";
    const { error } = await supabase!.from(table).update({ paid_at: new Date().toISOString() }).eq("id", id);
    if (error) toast.error("No se pudo marcar como pagado.");
    else {
      toast.success(kind === "bono" ? "Bono marcado como pagado." : "Sesión marcada como pagada.");
      await onRefresh();
    }
  };

  // Vender un bono al paciente y descontar de él esta misma cita.
  const sellBono = async () => {
    setBusy(true);
    const { data, error } = await supabase!
      .from("bonos")
      .insert({
        patient_id: patientId,
        sessions_total: BONO.sessions,
        price_cents: BONO.price_cents,
        paid_at: bonoPaidNow ? new Date().toISOString() : null,
      })
      .select()
      .single();
    if (error || !data) {
      setBusy(false);
      toast.error("No se pudo registrar el bono.");
      return;
    }
    await onRefresh();
    setBusy(false);
    setSellingBono(false);
    setSessionType("bono");
    setBonoId((data as Bono).id);
    toast.success("Bono registrado. Esta cita se descontará de él al guardar.");
  };

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
      toast.error(
        /una_primera/.test(error.message) ? "Este paciente ya tiene una primera sesión."
        : /facturad/i.test(error.message) ? error.message
        : /invoices/i.test(error.message) ? "Esta cita tiene factura: no se puede borrar."
        : /bono/i.test(error.message) ? error.message
        : "No se pudo guardar la cita."
      );
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
      toast.error(/invoices/i.test(error.message) ? "Esta cita tiene factura: no se puede borrar." : "No se pudo borrar la cita.");
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

        {consumedBono && consumedNumber && (
          <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/10 p-3 text-sm">
            <TicketCheck className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <p className="font-semibold text-foreground">
                Sesión {consumedNumber} de {consumedBono.sessions_total} del bono · ya descontada
              </p>
              <p className="text-muted-foreground">
                {BONO.label} del {format(new Date(consumedBono.created_at), "d/M/yyyy")} · quedan{" "}
                {bonoRemaining(consumedBono, appointments)} ·{" "}
                {consumedBono.paid_at ? "bono pagado" : <span className="font-medium text-destructive">bono pendiente de pago</span>}
              </p>
            </div>
          </div>
        )}

        {debts.length > 0 && (
          <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-3 text-sm">
            <p className="mb-2 flex items-center gap-2 font-semibold text-destructive">
              <AlertTriangle className="size-4" />
              Pagos pendientes · {euros(debts.reduce((sum, d) => sum + d.cents, 0))}
            </p>
            <ul className="flex flex-col gap-1.5">
              {debts.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2">
                  <span className="text-foreground">
                    {d.kind === "bono"
                      ? `${BONO.label} (${format(new Date(d.date), "d/M/yyyy")})`
                      : `Sesión del ${format(new Date(d.date), "d/M/yyyy")}`} · {euros(d.cents)}
                  </span>
                  <Button type="button" size="sm" variant="outline" className="h-7"
                    disabled={busy} onClick={() => markDebtPaid(d.kind, d.id)}>
                    Marcar pagado
                  </Button>
                </li>
              ))}
            </ul>
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
              <Select value={time} onValueChange={(v) => v && setTime(v)}>
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
            {/* key: al aparecer la opción de bono (p. ej. tras venderlo aquí) el
                desplegable se monta de nuevo; si no, pierde el valor elegido. */}
            <Select key={`${usableBonos.length > 0}-${hasOtherFirst}-${bonoBlocked}`} value={sessionType} onValueChange={(v) => {
              // Radix Select a veces emite "" al cambiar sus opciones: se ignora.
              if (!v) return;
              setSessionType(v as SessionType);
              if (v === "bono" && !bonoId && usableBonos[0]) setBonoId(usableBonos[0].id);
            }}>
              <SelectTrigger id="tarifa" className="w-full"><SelectValue placeholder="Elige la tarifa" /></SelectTrigger>
              <SelectContent>
                {!hasOtherFirst && (
                  <SelectItem value="primera">
                    {SESSION_TYPES.primera.label} · {euros(SESSION_TYPES.primera.price_cents)}
                  </SelectItem>
                )}
                <SelectItem value={regularType}>
                  {SESSION_TYPES[regularType].label} · {euros(SESSION_TYPES[regularType].price_cents)}
                </SelectItem>
                {appointment && appointment.session_type !== regularType &&
                  appointment.session_type !== "primera" && appointment.session_type !== "bono" && (
                  <SelectItem value={appointment.session_type}>
                    {SESSION_TYPES[appointment.session_type].label} · {euros(appointment.price_cents)}
                  </SelectItem>
                )}
                {usableBonos.length > 0 && !bonoBlocked && (
                  <SelectItem value="bono">Descontar de un bono</SelectItem>
                )}
              </SelectContent>
            </Select>
            {patientId && bonoBlocked && (
              <p className="text-xs text-muted-foreground">
                La primera sesión no se puede pagar con bono.
              </p>
            )}
            {patientId && usableBonos.length === 0 && !sellingBono && !bonoBlocked && (
              <Button type="button" variant="outline" size="sm" className="self-start"
                onClick={() => setSellingBono(true)}>
                <Ticket className="size-4" />
                Vender {BONO.label.toLowerCase()} ({euros(BONO.price_cents)}) y usarlo en esta cita
              </Button>
            )}
            {sellingBono && (
              <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                <p className="text-sm text-foreground">
                  {BONO.label} por {euros(BONO.price_cents)} para {patient?.full_name || patient?.email}.
                  Esta cita se descontará del bono.
                </p>
                {appointment?.paid_at && appointment.session_type !== "bono" && (
                  <p className="text-sm font-medium text-destructive">
                    Esta cita ya estaba cobrada ({euros(appointment.price_cents)}). Al pasarla al bono
                    dejará de contar como cobrada.
                  </p>
                )}
                <label className="flex items-center justify-between text-sm">
                  Ya está pagado
                  <Switch checked={bonoPaidNow} onCheckedChange={setBonoPaidNow} />
                </label>
                <div className="flex justify-end gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSellingBono(false)}>Cancelar</Button>
                  <Button type="button" size="sm" disabled={busy} onClick={sellBono}>Registrar bono</Button>
                </div>
              </div>
            )}
          </div>

          {sessionType === "bono" ? (
            <div className="flex flex-col gap-2">
              <Label>Bono</Label>
              <Select key={usableBonos.map((b) => b.id).join()} value={bonoId} onValueChange={(v) => v && setBonoId(v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Elige el bono" /></SelectTrigger>
                <SelectContent>
                  {usableBonos.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      Bono del {format(new Date(b.created_at), "d/M/yyyy")} ·{" "}
                      {b.id === consumedBono?.id && consumedNumber
                        ? `esta cita es la sesión ${consumedNumber} de ${b.sessions_total}`
                        : `quedan ${bonoRemaining(b, appointments)} de ${b.sessions_total}`}
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
