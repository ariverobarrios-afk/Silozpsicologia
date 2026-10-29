import { useState, type ReactNode } from "react";
import { format } from "date-fns";
import { ArrowLeft, CalendarPlus, FileText, IdCard, Mail, Pencil, Ticket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PAYMENT_METHOD_LABEL, type Appointment, type Bono, type Invoice, type ProcessType, type Profile } from "@/lib/supabase";
import { openInvoice } from "@/lib/invoices";
import { BONO, PROCESS_LABEL, SESSION_TYPES, bonoRemaining, bonoUsed, euros, isPendingPayment } from "@/lib/tariffs";
import { AppointmentItem } from "./AppointmentItem";
import { PaymentDialog } from "./PaymentDialog";
import { ShowMoreList } from "./ShowMoreList";
import { formatDay, formatDayTitle, formatTime } from "./format";

const shortDate = (iso: string) => format(new Date(iso.length === 10 ? `${iso}T12:00:00` : iso), "d/M/yyyy");

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-serif text-xl font-semibold text-foreground first-letter:uppercase">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-serif text-xl font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// Ficha de un paciente para Silvia: todo lo suyo de un vistazo y las acciones
// (citas, bonos, cobros, datos fiscales, invitación, facturas).
export function PatientProfile({
  patient: p,
  appointments,
  bonos,
  invoices,
  alertFor,
  onBack,
  onNewAppointment,
  onEditAppointment,
  onSellBono,
  onEditData,
  onInvite,
  onToggleActive,
  onSetProcess,
  onChanged,
}: {
  patient: Profile;
  appointments: Appointment[];
  bonos: Bono[];
  invoices: Invoice[];
  alertFor: (a: Appointment) => string | null;
  onBack: () => void;
  onNewAppointment: () => void;
  onEditAppointment: (a: Appointment) => void;
  onSellBono: () => void;
  onEditData: () => void;
  onInvite: () => void;
  onToggleActive: () => void;
  onSetProcess: (value: ProcessType) => void;
  onChanged: () => void;
}) {
  const [paying, setPaying] = useState<{ kind: "cita" | "bono"; id: string; label: string } | null>(null);
  const now = Date.now();

  const own = appointments.filter((a) => a.patient_id === p.id);
  const upcoming = own.filter((a) => new Date(a.starts_at).getTime() >= now && a.status === "programada");
  const past = own.filter((a) => !upcoming.includes(a)).reverse();
  const done = own.filter((a) => a.status === "realizada").length;

  const ownBonos = bonos.filter((b) => b.patient_id === p.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const activeBono = ownBonos.find((b) => bonoRemaining(b, appointments) > 0);

  const pendingAppts = own.filter((a) => isPendingPayment(a) && new Date(a.starts_at).getTime() <= now);
  const unpaidBonos = ownBonos.filter((b) => !b.paid_at);
  const pendingCents =
    pendingAppts.reduce((s, a) => s + a.price_cents, 0) + unpaidBonos.reduce((s, b) => s + b.price_cents, 0);

  const ownInvoices = invoices.filter((inv) => inv.patient_id === p.id).sort((a, b) => b.number - a.number);
  const invoicedCents = ownInvoices.reduce((s, inv) => s + inv.total_cents, 0);

  const editButton = (a: Appointment) => (
    <Button variant="ghost" size="sm" onClick={() => onEditAppointment(a)} aria-label="Editar cita">
      <Pencil className="size-4" />
    </Button>
  );

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-3" onClick={onBack}>
          <ArrowLeft className="size-4" />
          Pacientes
        </Button>
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 className="font-serif text-2xl font-semibold text-foreground">
              {p.full_name || "(sin nombre)"}
              {!p.active && <span className="ml-2 align-middle text-sm font-normal text-destructive">· desactivado</span>}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {[p.email || "Sin email", p.phone, p.tax_id ? `DNI ${p.tax_id}` : "Sin DNI"].filter(Boolean).join(" · ")}
            </p>
            {p.address && <p className="text-sm text-muted-foreground">{p.address.split("\n").join(", ")}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Select value={p.process_type ?? ""} onValueChange={(v) => v && onSetProcess(v as ProcessType)}>
                <SelectTrigger size="sm" className="h-7 w-auto text-xs" aria-label="Tipo de proceso">
                  <SelectValue placeholder="Proceso sin asignar" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PROCESS_LABEL) as ProcessType[]).map((k) => (
                    <SelectItem key={k} value={k}>{PROCESS_LABEL[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!p.invited_at && (
                <Badge variant="outline" className="border-border bg-secondary text-muted-foreground">Sin invitación enviada</Badge>
              )}
              {activeBono && (
                <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                  Bono: quedan {bonoRemaining(activeBono, appointments)} de {activeBono.sessions_total}
                </Badge>
              )}
              {pendingCents > 0 && (
                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">Pendiente {euros(pendingCents)}</Badge>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 lg:max-w-[420px] lg:justify-end">
            <Button size="sm" className="rounded-full" onClick={onNewAppointment} disabled={!p.active}>
              <CalendarPlus className="size-4" />
              Nueva cita
            </Button>
            <Button variant="outline" size="sm" onClick={onSellBono} disabled={!p.active}>
              <Ticket className="size-4" />
              Vender bono
            </Button>
            <Button variant="outline" size="sm" onClick={onEditData}>
              <IdCard className="size-4" />
              Datos fiscales
            </Button>
            {!p.invited_at && (
              <Button variant="outline" size="sm" onClick={onInvite}>
                <Mail className="size-4" />
                Enviar invitación
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onToggleActive}>
              {p.active ? "Desactivar" : "Activar"}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Próxima cita"
          value={upcoming[0] ? `${formatDay(upcoming[0].starts_at)}` : "Sin citas"}
          hint={upcoming[0] ? formatTime(upcoming[0].starts_at) : undefined} />
        <Tile label="Sesiones realizadas" value={String(done)} hint={`${own.length} citas en total`} />
        <Tile label="Pendiente de cobro" value={euros(pendingCents)}
          hint={pendingCents > 0 ? `${pendingAppts.length + unpaidBonos.length} pagos` : "Todo cobrado"} />
        <Tile label="Facturado" value={euros(invoicedCents)}
          hint={`${ownInvoices.length} ${ownInvoices.length === 1 ? "factura" : "facturas"}`} />
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-8">
          <Section title="Próximas citas">
            {upcoming.length === 0 ? (
              <p className="text-muted-foreground">No tiene citas programadas.</p>
            ) : (
              <ShowMoreList className="flex flex-col gap-3">
                {upcoming.map((a) => (
                  <AppointmentItem key={a.id} appointment={a} alert={alertFor(a)} actions={editButton(a)} />
                ))}
              </ShowMoreList>
            )}
          </Section>
          <Section title="Historial">
            {past.length === 0 ? (
              <p className="text-muted-foreground">Aún no hay citas anteriores.</p>
            ) : (
              <ShowMoreList className="flex flex-col gap-3">
                {past.map((a) => (
                  <AppointmentItem key={a.id} appointment={a} alert={alertFor(a)} actions={editButton(a)} />
                ))}
              </ShowMoreList>
            )}
          </Section>
        </div>

        <div className="flex flex-col gap-8">
          <Section title="Pagos pendientes">
            {pendingAppts.length + unpaidBonos.length === 0 ? (
              <p className="text-muted-foreground">Todo cobrado.</p>
            ) : (
              <ul className="divide-y divide-border rounded-2xl border border-amber-300 bg-amber-50/60">
                {unpaidBonos.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span>{BONO.label} · vendido el {shortDate(b.created_at)}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <strong>{euros(b.price_cents)}</strong>
                      <Button size="sm" variant="outline"
                        onClick={() => setPaying({ kind: "bono", id: b.id, label: `${BONO.label} · ${euros(b.price_cents)}` })}>
                        Registrar pago
                      </Button>
                    </span>
                  </li>
                ))}
                {pendingAppts.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span>{SESSION_TYPES[a.session_type].label} · {shortDate(a.starts_at)}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <strong>{euros(a.price_cents)}</strong>
                      <Button size="sm" variant="outline"
                        onClick={() => setPaying({
                          kind: "cita",
                          id: a.id,
                          label: `${SESSION_TYPES[a.session_type].label} del ${formatDayTitle(a.starts_at).toLowerCase()} · ${euros(a.price_cents)}`,
                        })}>
                        Registrar pago
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Bonos">
            {ownBonos.length === 0 ? (
              <p className="text-muted-foreground">No tiene bonos.</p>
            ) : (
              <ShowMoreList className="flex flex-col gap-3">
                {ownBonos.map((b) => {
                  const used = bonoUsed(b, appointments);
                  return (
                    <li key={b.id} className="rounded-2xl border border-border bg-card p-4">
                      <p className="text-sm font-medium text-foreground">
                        {BONO.label} · {shortDate(b.created_at)} · {euros(b.price_cents)}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <div className="flex gap-1" aria-label={`${used} de ${b.sessions_total} sesiones usadas`}>
                          {Array.from({ length: b.sessions_total }, (_, i) => (
                            <span key={i} className={`size-3 rounded-full ${i < used ? "bg-primary" : "bg-muted"}`} />
                          ))}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {used} de {b.sessions_total} usadas
                          {used >= b.sessions_total ? " · agotado" : ` · quedan ${b.sessions_total - used}`}
                          {" · "}
                          {b.paid_at
                            ? `pagado el ${shortDate(b.paid_at)}${b.payment_method ? ` (${PAYMENT_METHOD_LABEL[b.payment_method]})` : ""}`
                            : "pendiente de pago"}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ShowMoreList>
            )}
          </Section>

          <Section title="Facturas">
            {ownInvoices.length === 0 ? (
              <p className="text-muted-foreground">Todavía no tiene facturas.</p>
            ) : (
              <ShowMoreList className="divide-y divide-border rounded-2xl border border-border bg-card">
                {ownInvoices.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{inv.code}</p>
                      <p className="text-sm text-muted-foreground">{shortDate(inv.issue_date)} · {inv.description}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-medium text-foreground">{euros(inv.total_cents)}</span>
                      <Button size="sm" variant="outline" onClick={() => openInvoice(inv)} aria-label={`Ver factura ${inv.code}`}>
                        <FileText className="size-4" />
                        Ver
                      </Button>
                    </div>
                  </li>
                ))}
              </ShowMoreList>
            )}
          </Section>
        </div>
      </div>

      {paying && (
        <PaymentDialog
          kind={paying.kind}
          id={paying.id}
          title="Registrar pago"
          description={`${p.full_name} · ${paying.label}`}
          onClose={() => setPaying(null)}
          onPaid={() => { setPaying(null); onChanged(); }}
        />
      )}
    </div>
  );
}
