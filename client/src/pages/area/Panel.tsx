import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarPlus, Pencil, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import {
  MODALITY_LABEL,
  STATUS_LABEL,
  supabase,
  type Appointment,
  type AppointmentStatus,
  type Modality,
  type Profile,
} from "@/lib/supabase";
import { AppointmentItem } from "./AppointmentItem";
import { AreaLayout, RequireRole } from "./AreaLayout";
import { formatDay, formatTime, fromInputs, toDateInput, toTimeInput } from "./format";

const ALL = "todos";

function PanelTerapeuta() {
  const [patients, setPatients] = useState<Profile[] | null>(null);
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [tab, setTab] = useState("agenda");
  const [filter, setFilter] = useState<string>(ALL);
  const [editing, setEditing] = useState<Appointment | "new" | null>(null);
  const [newForPatient, setNewForPatient] = useState<string | undefined>();
  const [inviteOpen, setInviteOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!supabase) return;
    const [p, a] = await Promise.all([
      supabase.from("profiles").select("*").eq("role", "patient").order("full_name"),
      supabase.from("appointments").select("*").order("starts_at", { ascending: true }),
    ]);
    if (p.error || a.error) {
      toast.error("No se pudieron cargar los datos.");
      return;
    }
    setPatients(p.data as Profile[]);
    setAppointments(a.data as Appointment[]);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const patientName = useMemo(() => {
    const map = new Map((patients ?? []).map((p) => [p.id, p.full_name || p.email]));
    return (id: string) => map.get(id) ?? "Paciente";
  }, [patients]);

  const now = Date.now();
  const visible = (appointments ?? []).filter((a) => filter === ALL || a.patient_id === filter);
  const upcoming = visible.filter((a) => new Date(a.starts_at).getTime() >= now);
  const past = visible.filter((a) => new Date(a.starts_at).getTime() < now).reverse();

  const markDone = async (a: Appointment) => {
    const { error } = await supabase!.from("appointments").update({ status: "realizada" }).eq("id", a.id);
    if (error) toast.error("No se pudo actualizar la cita.");
    else reload();
  };

  const toggleActive = async (p: Profile) => {
    const { error } = await supabase!.from("profiles").update({ active: !p.active }).eq("id", p.id);
    if (error) toast.error("No se pudo actualizar el paciente.");
    else {
      toast.success(p.active ? "Acceso desactivado." : "Acceso activado.");
      reload();
    }
  };

  const openNew = (patientId?: string) => {
    setNewForPatient(patientId);
    setEditing("new");
  };

  if (!patients || !appointments) {
    return (
      <AreaLayout title="Panel de consulta">
        <Spinner className="size-6 text-primary" />
      </AreaLayout>
    );
  }

  const editButton = (a: Appointment) => (
    <Button variant="ghost" size="sm" onClick={() => setEditing(a)} aria-label="Editar cita">
      <Pencil className="size-4" />
    </Button>
  );

  return (
    <AreaLayout title="Panel de consulta">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="agenda">Agenda</TabsTrigger>
          <TabsTrigger value="pacientes">Pacientes ({patients.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="agenda">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos los pacientes</SelectItem>
                {patients.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => openNew(filter === ALL ? undefined : filter)} disabled={patients.length === 0}
              className="rounded-full">
              <CalendarPlus className="size-4" />
              Nueva cita
            </Button>
          </div>
          {patients.length === 0 && (
            <p className="mb-6 text-muted-foreground">
              Primero invita a un paciente desde la pestaña «Pacientes».
            </p>
          )}

          <div className="grid gap-10 lg:grid-cols-2">
            <section>
              <h2 className="mb-4 font-serif text-2xl font-semibold text-foreground">Próximas</h2>
              {upcoming.length === 0 ? (
                <p className="text-muted-foreground">No hay citas próximas.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {upcoming.map((a) => (
                    <AppointmentItem key={a.id} appointment={a} title={patientName(a.patient_id)}
                      actions={editButton(a)} />
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h2 className="mb-4 font-serif text-2xl font-semibold text-foreground">Anteriores</h2>
              {past.length === 0 ? (
                <p className="text-muted-foreground">No hay citas anteriores.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {past.map((a) => (
                    <AppointmentItem key={a.id} appointment={a} title={patientName(a.patient_id)}
                      actions={
                        <>
                          {a.status === "programada" && (
                            <Button variant="outline" size="sm" onClick={() => markDone(a)}>
                              Marcar realizada
                            </Button>
                          )}
                          {editButton(a)}
                        </>
                      } />
                  ))}
                </ul>
              )}
            </section>
          </div>
        </TabsContent>

        <TabsContent value="pacientes">
          <div className="mb-6 flex justify-end">
            <Button onClick={() => setInviteOpen(true)} className="rounded-full">
              <UserPlus className="size-4" />
              Invitar paciente
            </Button>
          </div>
          {patients.length === 0 ? (
            <p className="text-muted-foreground">Todavía no hay pacientes.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {patients.map((p) => {
                const own = appointments.filter((a) => a.patient_id === p.id);
                const next = own.find(
                  (a) => new Date(a.starts_at).getTime() >= now && a.status === "programada"
                );
                return (
                  <li key={p.id}
                    className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">
                        {p.full_name || "(sin nombre)"}
                        {!p.active && <span className="ml-2 text-sm text-destructive">· desactivado</span>}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {p.email}{p.phone ? ` · ${p.phone}` : ""}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {own.length} {own.length === 1 ? "cita" : "citas"}
                        {next && ` · próxima: ${formatDay(next.starts_at)}, ${formatTime(next.starts_at)}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => { setFilter(p.id); setTab("agenda"); }}>
                        Ver citas
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openNew(p.id)}>
                        Nueva cita
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => toggleActive(p)}>
                        {p.active ? "Desactivar" : "Activar"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      {editing && (
        <AppointmentDialog
          patients={patients.filter((p) => p.active || (editing !== "new" && p.id === editing.patient_id))}
          appointment={editing === "new" ? null : editing}
          defaultPatientId={newForPatient}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} onInvited={reload} />
    </AreaLayout>
  );
}

function AppointmentDialog({
  patients,
  appointment,
  defaultPatientId,
  onClose,
  onSaved,
}: {
  patients: Profile[];
  appointment: Appointment | null;
  defaultPatientId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [patientId, setPatientId] = useState(appointment?.patient_id ?? defaultPatientId ?? "");
  const [date, setDate] = useState(appointment ? toDateInput(appointment.starts_at) : "");
  const [time, setTime] = useState(appointment ? toTimeInput(appointment.starts_at) : "");
  const [duration, setDuration] = useState(String(appointment?.duration_minutes ?? 50));
  const [modality, setModality] = useState<Modality>(appointment?.modality ?? "presencial");
  const [status, setStatus] = useState<AppointmentStatus>(appointment?.status ?? "programada");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!patientId || !date || !time) {
      toast.error("Elige paciente, fecha y hora.");
      return;
    }
    const row = {
      patient_id: patientId,
      starts_at: fromInputs(date, time),
      duration_minutes: Number(duration) || 50,
      modality,
      status,
    };
    setBusy(true);
    const { error } = appointment
      ? await supabase!.from("appointments").update(row).eq("id", appointment.id)
      : await supabase!.from("appointments").insert(row);
    setBusy(false);
    if (error) {
      toast.error("No se pudo guardar la cita.");
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
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{appointment ? "Editar cita" : "Nueva cita"}</DialogTitle>
          <DialogDescription>El paciente verá esta cita en su área privada.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Paciente</Label>
            <Select value={patientId} onValueChange={setPatientId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Elige un paciente" /></SelectTrigger>
              <SelectContent>
                {patients.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="date">Fecha</Label>
              <Input id="date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="time">Hora</Label>
              <Input id="time" type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="duration">Duración (min)</Label>
              <Input id="duration" type="number" min={5} max={480} step={5} value={duration}
                onChange={(e) => setDuration(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Modalidad</Label>
              <Select value={modality} onValueChange={(v) => setModality(v as Modality)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(MODALITY_LABEL) as Modality[]).map((m) => (
                    <SelectItem key={m} value={m}>{MODALITY_LABEL[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
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

function InviteDialog({
  open,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: () => void;
}) {
  const { session } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const resp = await fetch("/api/invite-patient", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ fullName, email, phone }),
      });
      const body = (await resp.json().catch(() => ({}))) as { success?: boolean; message?: string };
      if (!resp.ok || !body.success) {
        toast.error(body.message || "No se pudo enviar la invitación.");
        return;
      }
      toast.success(`Invitación enviada a ${email}.`);
      setFullName("");
      setEmail("");
      setPhone("");
      onOpenChange(false);
      onInvited();
    } catch {
      toast.error("No se pudo enviar la invitación.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Invitar paciente</DialogTitle>
          <DialogDescription>
            Recibirá un email para crear su contraseña y acceder a sus citas.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="inv-name">Nombre completo</Label>
            <Input id="inv-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="inv-email">Email</Label>
            <Input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="inv-phone">Teléfono (opcional)</Label>
            <Input id="inv-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy} className="rounded-full">Enviar invitación</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Panel() {
  return (
    <RequireRole role="admin">
      <PanelTerapeuta />
    </RequireRole>
  );
}
