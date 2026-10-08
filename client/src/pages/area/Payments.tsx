import { useState, type FormEvent } from "react";
import { format, isSameMonth } from "date-fns";
import { es } from "date-fns/locale";
import { Ticket } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase, type Appointment, type Bono, type Profile } from "@/lib/supabase";
import { BONO, SESSION_TYPES, bonoUsed, euros, isPendingPayment } from "@/lib/tariffs";
import { FIRST_SESSION_CLASS } from "./AppointmentItem";
import { formatDayTitle, formatTime } from "./format";

function SummaryCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-serif text-2xl font-semibold text-foreground">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function PaymentsTab({
  patients,
  appointments,
  bonos,
  patientName,
  onChanged,
  onSellBono,
}: {
  patients: Profile[];
  appointments: Appointment[];
  bonos: Bono[];
  patientName: (id: string) => string;
  onChanged: () => void;
  onSellBono: (patientId?: string) => void;
}) {
  const now = new Date();
  const pending = appointments.filter(isPendingPayment);
  const pendingDue = pending.filter((a) => new Date(a.starts_at) <= now);
  const pendingUpcoming = pending.filter((a) => new Date(a.starts_at) > now);
  const unpaidBonos = bonos.filter((b) => !b.paid_at);

  const dueTotal =
    pendingDue.reduce((s, a) => s + a.price_cents, 0) + unpaidBonos.reduce((s, b) => s + b.price_cents, 0);
  const upcomingTotal = pendingUpcoming.reduce((s, a) => s + a.price_cents, 0);
  const monthTotal =
    appointments
      .filter((a) => a.paid_at && a.session_type !== "bono" && isSameMonth(new Date(a.paid_at), now))
      .reduce((s, a) => s + a.price_cents, 0) +
    bonos.filter((b) => b.paid_at && isSameMonth(new Date(b.paid_at), now)).reduce((s, b) => s + b.price_cents, 0);

  const markAppointmentPaid = async (a: Appointment) => {
    const { error } = await supabase!.from("appointments").update({ paid_at: new Date().toISOString() }).eq("id", a.id);
    if (error) toast.error("No se pudo marcar como pagada.");
    else {
      toast.success("Cita marcada como pagada.");
      onChanged();
    }
  };

  const setBonoPaid = async (b: Bono, paid: boolean) => {
    const { error } = await supabase!.from("bonos").update({ paid_at: paid ? new Date().toISOString() : null }).eq("id", b.id);
    if (error) toast.error(/facturad/i.test(error.message) ? error.message : "No se pudo actualizar el bono.");
    else onChanged();
  };

  const deleteBono = async (b: Bono) => {
    const { error } = await supabase!.from("bonos").delete().eq("id", b.id);
    if (error) toast.error(/invoices/i.test(error.message) ? "No se puede borrar: el bono tiene factura." : "No se puede borrar: el bono ya tiene sesiones.");
    else {
      toast.success("Bono borrado.");
      onChanged();
    }
  };

  const sortedBonos = [...bonos].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div className="flex flex-col gap-10">
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Pendiente de cobro" value={euros(dueTotal)}
          hint="Sesiones ya pasadas y bonos sin pagar" />
        <SummaryCard label="Por cobrar en próximas citas" value={euros(upcomingTotal)} />
        <SummaryCard label={`Cobrado en ${format(now, "MMMM", { locale: es })}`} value={euros(monthTotal)} />
      </div>

      <section>
        <h2 className="mb-4 font-serif text-2xl font-semibold text-foreground">Pendiente de cobro</h2>
        {pendingDue.length === 0 && unpaidBonos.length === 0 ? (
          <p className="text-muted-foreground">Todo cobrado. 🎉</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {unpaidBonos.map((b) => (
              <li key={b.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-foreground">{patientName(b.patient_id)}</p>
                  <p className="text-sm text-muted-foreground">
                    {BONO.label} · vendido el {format(new Date(b.created_at), "d/M/yyyy")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{euros(b.price_cents)}</span>
                  <Button size="sm" variant="outline" onClick={() => setBonoPaid(b, true)}>Marcar pagado</Button>
                </div>
              </li>
            ))}
            {pendingDue.map((a) => (
              <li key={a.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-foreground">{patientName(a.patient_id)}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatDayTitle(a.starts_at)}, {formatTime(a.starts_at)} · {SESSION_TYPES[a.session_type].label}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {a.session_type === "primera" && (
                    <Badge variant="outline" className={FIRST_SESSION_CLASS}>Primera sesión</Badge>
                  )}
                  <span className="font-medium text-foreground">{euros(a.price_cents)}</span>
                  <Button size="sm" variant="outline" onClick={() => markAppointmentPaid(a)}>Marcar pagada</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-serif text-2xl font-semibold text-foreground">Bonos</h2>
          <Button className="rounded-full" onClick={() => onSellBono()} disabled={patients.length === 0}>
            <Ticket className="size-4" />
            Vender bono
          </Button>
        </div>
        {sortedBonos.length === 0 ? (
          <p className="text-muted-foreground">Todavía no se ha vendido ningún bono.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {sortedBonos.map((b) => {
              const used = bonoUsed(b, appointments);
              return (
                <li key={b.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{patientName(b.patient_id)}</p>
                    <p className="text-sm text-muted-foreground">
                      {BONO.label} · {format(new Date(b.created_at), "d/M/yyyy")} · {euros(b.price_cents)}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex gap-1" aria-label={`${used} de ${b.sessions_total} sesiones usadas`}>
                        {Array.from({ length: b.sessions_total }, (_, i) => (
                          <span key={i} className={`size-3 rounded-full ${i < used ? "bg-primary" : "bg-muted"}`} />
                        ))}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {used} de {b.sessions_total} usadas
                        {used >= b.sessions_total ? " · agotado" : ` · quedan ${b.sessions_total - used}`}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      Pagado
                      <Switch checked={Boolean(b.paid_at)} onCheckedChange={(v) => setBonoPaid(b, v)} />
                    </label>
                    {used === 0 && (
                      <Button size="sm" variant="ghost" onClick={() => deleteBono(b)}>Borrar</Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export function BonoDialog({
  patients,
  defaultPatientId,
  onClose,
  onSaved,
}: {
  patients: Profile[];
  defaultPatientId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [patientId, setPatientId] = useState(defaultPatientId ?? "");
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!patientId) {
      toast.error("Elige un paciente.");
      return;
    }
    setBusy(true);
    const { error } = await supabase!.from("bonos").insert({
      patient_id: patientId,
      sessions_total: BONO.sessions,
      price_cents: BONO.price_cents,
      paid_at: paid ? new Date().toISOString() : null,
    });
    setBusy(false);
    if (error) {
      toast.error("No se pudo registrar el bono.");
      return;
    }
    toast.success("Bono registrado. Las próximas citas se descontarán de él.");
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Vender {BONO.label.toLowerCase()}</DialogTitle>
          <DialogDescription>
            {BONO.sessions} sesiones por {euros(BONO.price_cents)}. Las citas nuevas del paciente se
            descontarán del bono automáticamente.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Paciente</Label>
            <Select value={patientId} onValueChange={setPatientId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Elige un paciente" /></SelectTrigger>
              <SelectContent>
                {patients.filter((p) => p.active).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm">
            Ya está pagado
            <Switch checked={paid} onCheckedChange={setPaid} />
          </label>
          <DialogFooter>
            <Button type="submit" disabled={busy} className="rounded-full">Registrar bono</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
