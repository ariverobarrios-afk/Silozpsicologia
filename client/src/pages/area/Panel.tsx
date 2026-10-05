import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDays, CalendarPlus, List, Pencil, UserPlus } from "lucide-react";
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
import { supabase, type Appointment, type Bono, type ProcessType, type Profile } from "@/lib/supabase";
import { PROCESS_LABEL, bonoRemaining, euros, isPendingPayment } from "@/lib/tariffs";
import { AppointmentDialog } from "./AppointmentDialog";
import { AppointmentItem } from "./AppointmentItem";
import { BonoDialog, PaymentsTab } from "./Payments";
import { WeekCalendar } from "./WeekCalendar";
import { AreaLayout, RequireRole } from "./AreaLayout";
import { formatDay, formatTime } from "./format";

const ALL = "todos";

function PanelTerapeuta() {
  const [patients, setPatients] = useState<Profile[] | null>(null);
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [tab, setTab] = useState("agenda");
  const [filter, setFilter] = useState<string>(ALL);
  const [editing, setEditing] = useState<Appointment | "new" | null>(null);
  const [newDefaults, setNewDefaults] = useState<{ patientId?: string; date?: Date; time?: string }>({});
  const [view, setView] = useState<"calendario" | "lista">("calendario");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [bonos, setBonos] = useState<Bono[] | null>(null);
  const [sellBonoFor, setSellBonoFor] = useState<{ patientId?: string } | null>(null);

  const reload = useCallback(async () => {
    if (!supabase) return;
    const [p, a, b] = await Promise.all([
      supabase.from("profiles").select("*").eq("role", "patient").order("full_name"),
      supabase.from("appointments").select("*").order("starts_at", { ascending: true }),
      supabase.from("bonos").select("*").order("created_at", { ascending: true }),
    ]);
    if (p.error || a.error || b.error) {
      toast.error("No se pudieron cargar los datos.");
      return;
    }
    setPatients(p.data as Profile[]);
    setAppointments(a.data as Appointment[]);
    setBonos(b.data as Bono[]);
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

  const openNew = (patientId?: string, date?: Date, time?: string) => {
    setNewDefaults({ patientId, date, time });
    setEditing("new");
  };

  const setProcess = async (p: Profile, value: ProcessType) => {
    const { error } = await supabase!.from("profiles").update({ process_type: value }).eq("id", p.id);
    if (error) toast.error("No se pudo guardar el tipo de proceso.");
    else reload();
  };

  if (!patients || !appointments || !bonos) {
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
          <TabsTrigger value="pagos">Pagos</TabsTrigger>
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
            <div className="flex items-center gap-2">
              <div className="flex rounded-full border border-border bg-secondary p-1" role="group" aria-label="Vista">
                <Button variant={view === "calendario" ? "default" : "ghost"} size="sm" className="rounded-full"
                  aria-pressed={view === "calendario"} onClick={() => setView("calendario")}>
                  <CalendarDays className="size-4" />
                  Calendario
                </Button>
                <Button variant={view === "lista" ? "default" : "ghost"} size="sm" className="rounded-full"
                  aria-pressed={view === "lista"} onClick={() => setView("lista")}>
                  <List className="size-4" />
                  Lista
                </Button>
              </div>
              <Button onClick={() => openNew(filter === ALL ? undefined : filter)} disabled={patients.length === 0}
                className="rounded-full">
                <CalendarPlus className="size-4" />
                Nueva cita
              </Button>
            </div>
          </div>
          {patients.length === 0 && (
            <p className="mb-6 text-muted-foreground">
              Primero invita a un paciente desde la pestaña «Pacientes».
            </p>
          )}

          {view === "calendario" ? (
            <WeekCalendar
              appointments={visible}
              patientName={patientName}
              onSelect={(a) => setEditing(a)}
              onCreate={(date, time) => {
                if (patients.length > 0) openNew(filter === ALL ? undefined : filter, date, time);
              }}
            />
          ) : (
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
          )}
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
                const activeBono = bonos.find(
                  (b) => b.patient_id === p.id && bonoRemaining(b, appointments) > 0
                );
                const pendingCents =
                  own.filter((a) => isPendingPayment(a) && new Date(a.starts_at).getTime() <= now)
                    .reduce((sum, a) => sum + a.price_cents, 0) +
                  bonos.filter((b) => b.patient_id === p.id && !b.paid_at).reduce((sum, b) => sum + b.price_cents, 0);
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
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Select value={p.process_type ?? ""} onValueChange={(v) => setProcess(p, v as ProcessType)}>
                          <SelectTrigger size="sm" className="h-7 w-auto text-xs">
                            <SelectValue placeholder="Proceso sin asignar" />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(PROCESS_LABEL) as ProcessType[]).map((k) => (
                              <SelectItem key={k} value={k}>{PROCESS_LABEL[k]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {activeBono && (
                          <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                            Bono: quedan {bonoRemaining(activeBono, appointments)} de {activeBono.sessions_total}
                          </Badge>
                        )}
                        {pendingCents > 0 && (
                          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
                            Pendiente {euros(pendingCents)}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => { setFilter(p.id); setTab("agenda"); }}>
                        Ver citas
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openNew(p.id)}>
                        Nueva cita
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setSellBonoFor({ patientId: p.id })}>
                        Vender bono
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

        <TabsContent value="pagos">
          <PaymentsTab
            patients={patients}
            appointments={appointments}
            bonos={bonos}
            patientName={patientName}
            onChanged={reload}
            onSellBono={(patientId) => setSellBonoFor({ patientId })}
          />
        </TabsContent>
      </Tabs>

      {editing && (
        <AppointmentDialog
          patients={patients.filter((p) => p.active || (editing !== "new" && p.id === editing.patient_id))}
          appointment={editing === "new" ? null : editing}
          appointments={appointments}
          bonos={bonos}
          defaultPatientId={newDefaults.patientId}
          defaultDate={newDefaults.date}
          defaultTime={newDefaults.time}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
      {sellBonoFor && (
        <BonoDialog
          patients={patients}
          defaultPatientId={sellBonoFor.patientId}
          onClose={() => setSellBonoFor(null)}
          onSaved={() => { setSellBonoFor(null); reload(); }}
        />
      )}
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} onInvited={reload} />
    </AreaLayout>
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
