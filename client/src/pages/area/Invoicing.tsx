import { useMemo, useState, type FormEvent } from "react";
import { format } from "date-fns";
import { AlertTriangle, FileText, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import {
  PAYMENT_METHOD_LABEL,
  supabase,
  type Appointment,
  type Bono,
  type Invoice,
  type InvoiceSettings,
  type PaymentMethod,
  type Profile,
} from "@/lib/supabase";
import { billablePayments, invoiceCode, openInvoice, type BillablePayment } from "@/lib/invoices";
import { euros } from "@/lib/tariffs";

const todayKey = () => format(new Date(), "yyyy-MM-dd");
const shortDate = (iso: string) => format(new Date(iso.length === 10 ? `${iso}T12:00:00` : iso), "d/M/yyyy");

export function InvoicingSection({
  patients,
  appointments,
  bonos,
  invoices,
  settings,
  patientName,
  onChanged,
}: {
  patients: Profile[];
  appointments: Appointment[];
  bonos: Bono[];
  invoices: Invoice[];
  settings: InvoiceSettings | null;
  patientName: (id: string) => string;
  onChanged: () => Promise<void> | void;
}) {
  const pending = useMemo(() => billablePayments(appointments, bonos, invoices), [appointments, bonos, invoices]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [issuing, setIssuing] = useState<BillablePayment[] | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const keyOf = (p: BillablePayment) => `${p.kind}:${p.id}`;
  const selectedItems = pending.filter((p) => selected.has(keyOf(p)));
  const allSelected = pending.length > 0 && selectedItems.length === pending.length;
  const toggle = (p: BillablePayment) => {
    const next = new Set(selected);
    if (next.has(keyOf(p))) next.delete(keyOf(p));
    else next.add(keyOf(p));
    setSelected(next);
  };

  const sortedInvoices = [...invoices].sort((a, b) => b.number - a.number || b.series.localeCompare(a.series));

  return (
    <div className="mt-10 flex flex-col gap-10">
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-serif text-2xl font-semibold text-foreground">Pagos sin factura</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="rounded-full" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="size-4" />
              Datos de facturación
            </Button>
            <Button className="rounded-full" disabled={selectedItems.length === 0 || !settings}
              onClick={() => setIssuing(selectedItems)}>
              <FileText className="size-4" />
              Facturar seleccionados ({selectedItems.length})
            </Button>
          </div>
        </div>
        {settings && (
          <p className="mb-4 text-sm text-muted-foreground">
            Próxima factura: <strong className="text-foreground">{invoiceCode(settings, settings.next_number)}</strong>
            {settings.last_date && <> · fecha igual o posterior al {shortDate(settings.last_date)}</>}
          </p>
        )}
        {pending.length === 0 ? (
          <p className="text-muted-foreground">Todos los pagos cobrados tienen factura.</p>
        ) : (
          <div className="rounded-2xl border border-border bg-card">
            <label className="flex items-center gap-3 border-b border-border px-4 py-3 text-sm text-muted-foreground">
              <Checkbox checked={allSelected}
                onCheckedChange={(v) => setSelected(v ? new Set(pending.map(keyOf)) : new Set())} />
              Seleccionar todos ({pending.length})
            </label>
            <ul>
              {pending.map((p) => {
                const patient = patients.find((x) => x.id === p.patient_id);
                return (
                  <li key={keyOf(p)} className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                    <label className="flex min-w-0 items-start gap-3">
                      <Checkbox className="mt-1" checked={selected.has(keyOf(p))} onCheckedChange={() => toggle(p)} />
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground">{patientName(p.patient_id)}</span>
                        <span className="block text-sm text-muted-foreground">
                          {p.label} · {p.kind === "cita" ? `sesión del ${shortDate(p.date)}` : `vendido el ${shortDate(p.date)}`} · cobrado el {shortDate(p.paid_at)}
                        </span>
                        {!patient?.tax_id && (
                          <span className="block text-xs text-amber-800">Falta el DNI del paciente (Pacientes → Datos fiscales)</span>
                        )}
                      </span>
                    </label>
                    <div className="flex shrink-0 items-center gap-2 pl-7 sm:pl-0">
                      <span className="font-medium text-foreground">{euros(p.cents)}</span>
                      <Button size="sm" variant="outline" disabled={!settings} onClick={() => setIssuing([p])}>Facturar</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 font-serif text-2xl font-semibold text-foreground">Facturas emitidas</h2>
        {sortedInvoices.length === 0 ? (
          <p className="text-muted-foreground">Todavía no se ha emitido ninguna factura desde la web.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {sortedInvoices.map((inv) => (
              <li key={inv.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{inv.code} · {inv.recipient_name}</p>
                  <p className="text-sm text-muted-foreground">
                    {shortDate(inv.issue_date)} · {inv.description} · {PAYMENT_METHOD_LABEL[inv.payment_method]}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-medium text-foreground">{euros(inv.total_cents)}</span>
                  <Button size="sm" variant="outline" onClick={() => openInvoice(inv)}>
                    <FileText className="size-4" />
                    Ver / PDF
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {issuing && settings && (
        <IssueDialog
          items={issuing}
          settings={settings}
          patients={patients}
          patientName={patientName}
          onClose={() => setIssuing(null)}
          onIssued={async (created) => {
            setIssuing(null);
            setSelected(new Set());
            await onChanged();
            if (created.length === 1) openInvoice(created[0]);
          }}
        />
      )}
      {settingsOpen && settings && (
        <SettingsDialog
          settings={settings}
          hasInvoices={invoices.some((i) => i.series === settings.series)}
          onClose={() => setSettingsOpen(false)}
          onSaved={async () => { setSettingsOpen(false); await onChanged(); }}
        />
      )}
    </div>
  );
}

function IssueDialog({
  items,
  settings,
  patients,
  patientName,
  onClose,
  onIssued,
}: {
  items: BillablePayment[];
  settings: InvoiceSettings;
  patients: Profile[];
  patientName: (id: string) => string;
  onClose: () => void;
  onIssued: (created: Invoice[]) => void;
}) {
  const minDate = settings.last_date ?? undefined;
  const max = todayKey();
  const [date, setDate] = useState(minDate && minDate > max ? minDate : max);
  const [method, setMethod] = useState<PaymentMethod>("transferencia");
  const [busy, setBusy] = useState(false);
  const missingTax = items.filter((p) => !patients.find((x) => x.id === p.patient_id)?.tax_id);
  const total = items.reduce((s, p) => s + p.cents, 0);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (minDate && date < minDate) {
      toast.error(`La fecha no puede ser anterior al ${shortDate(minDate)}.`);
      return;
    }
    if (date > max) {
      toast.error("La fecha de la factura no puede ser futura.");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase!.rpc("issue_invoices", {
      p_items: items.map((p) => ({ kind: p.kind, id: p.id })),
      p_issue_date: date,
      p_payment_method: method,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudieron emitir las facturas.");
      return;
    }
    const created = (data as Invoice[]) ?? [];
    toast.success(created.length === 1 ? `Factura ${created[0].code} emitida.` : `${created.length} facturas emitidas.`);
    onIssued(created);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{items.length === 1 ? "Emitir factura" : `Emitir ${items.length} facturas`}</DialogTitle>
          <DialogDescription>
            Una factura por pago, con numeración correlativa. Una vez emitidas no se pueden modificar ni borrar.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <ul className="flex flex-col gap-1 rounded-xl border border-border p-3 text-sm">
            {items.map((p, i) => (
              <li key={`${p.kind}:${p.id}`} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">
                  <strong>{invoiceCode(settings, settings.next_number + i)}</strong> · {patientName(p.patient_id)} · {p.label}
                </span>
                <span className="shrink-0">{euros(p.cents)}</span>
              </li>
            ))}
            {items.length > 1 && (
              <li className="mt-1 flex justify-between border-t border-border pt-2 font-medium">
                <span>Total</span><span>{euros(total)}</span>
              </li>
            )}
          </ul>

          {missingTax.length > 0 && (
            <div className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p>
                {missingTax.length === 1 ? "Un paciente no tiene" : `${missingTax.length} pagos son de pacientes sin`} DNI.
                La factura saldrá sin él. Puedes añadirlo antes en Pacientes → Datos fiscales.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="inv-date">Fecha de factura</Label>
              <Input id="inv-date" type="date" required value={date} min={minDate} max={max}
                onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Método de pago</Label>
              <Select value={method} onValueChange={(v) => v && setMethod(v as PaymentMethod)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => (
                    <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {minDate && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Las fechas deben ser correlativas: no antes del {shortDate(minDate)} (última factura) ni futuras.
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={busy} className="rounded-full">
              {items.length === 1 ? "Emitir factura" : `Emitir ${items.length} facturas`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({
  settings,
  hasInvoices,
  onClose,
  onSaved,
}: {
  settings: InvoiceSettings;
  hasInvoices: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof InvoiceSettings>(k: K, v: InvoiceSettings[K]) => setForm({ ...form, [k]: v });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase!.from("invoice_settings").update({
      issuer_name: form.issuer_name,
      issuer_tax_id: form.issuer_tax_id,
      issuer_address: form.issuer_address,
      issuer_email: form.issuer_email,
      issuer_phone: form.issuer_phone,
      bank_name: form.bank_name,
      bank_swift: form.bank_swift,
      series: form.series.trim(),
      number_digits: Number(form.number_digits) || 6,
      next_number: Number(form.next_number) || 1,
      last_date: form.last_date || null,
      exemption_note: form.exemption_note,
    }).eq("id", 1);
    setBusy(false);
    if (error) {
      toast.error(error.message || "No se pudieron guardar los datos.");
      return;
    }
    toast.success("Datos de facturación guardados.");
    onSaved();
  };

  const field = (id: keyof InvoiceSettings, label: string, props: Record<string, unknown> = {}) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`s-${id}`}>{label}</Label>
      <Input id={`s-${id}`} value={String(form[id] ?? "")} onChange={(e) => set(id, e.target.value as never)} {...props} />
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Datos de facturación</DialogTitle>
          <DialogDescription>
            Se copian en cada factura al emitirla; cambiarlos no altera las facturas ya emitidas.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <p className="text-sm font-semibold text-foreground">Numeración</p>
          <div className="grid grid-cols-3 gap-4">
            {field("series", "Serie", { required: true })}
            {field("next_number", "Siguiente nº", { type: "number", min: 1, required: true })}
            {field("number_digits", "Dígitos", { type: "number", min: 1, max: 10, required: true })}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {field("last_date", "No facturar antes del", { type: "date" })}
            <div className="flex flex-col justify-end pb-2 text-sm text-muted-foreground">
              Próxima: <strong className="text-foreground">{invoiceCode({ series: form.series, number_digits: Number(form.number_digits) || 6 }, Number(form.next_number) || 1)}</strong>
            </div>
          </div>
          {hasInvoices && (
            <p className="-mt-2 text-xs text-muted-foreground">
              Ya hay facturas emitidas en esta serie: no se puede volver a un número ni a una fecha anteriores.
            </p>
          )}

          <p className="mt-2 text-sm font-semibold text-foreground">Emisor</p>
          <div className="grid grid-cols-2 gap-4">
            {field("issuer_name", "Nombre", { required: true })}
            {field("issuer_tax_id", "NIF", { required: true })}
            {field("issuer_email", "Email")}
            {field("issuer_phone", "Teléfono")}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="s-address">Dirección (una línea por renglón)</Label>
            <Textarea id="s-address" rows={3} value={form.issuer_address}
              onChange={(e) => set("issuer_address", e.target.value)} />
          </div>

          <p className="mt-2 text-sm font-semibold text-foreground">Transferencia</p>
          <div className="grid grid-cols-2 gap-4">
            {field("bank_name", "Banco")}
            {field("bank_swift", "SWIFT/BIC")}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="s-note">Nota al pie</Label>
            <Textarea id="s-note" rows={2} value={form.exemption_note}
              onChange={(e) => set("exemption_note", e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={busy} className="rounded-full">Guardar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Datos del paciente que salen en sus facturas.
export function PatientDataDialog({
  patient,
  onClose,
  onSaved,
}: {
  patient: Profile;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(patient.full_name);
  const [phone, setPhone] = useState(patient.phone ?? "");
  const [taxId, setTaxId] = useState(patient.tax_id ?? "");
  const [address, setAddress] = useState(patient.address ?? "");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase!.from("profiles").update({
      full_name: fullName.trim(),
      phone: phone.trim() || null,
      tax_id: taxId.trim().toUpperCase() || null,
      address: address.trim() || null,
    }).eq("id", patient.id);
    setBusy(false);
    if (error) {
      toast.error("No se pudieron guardar los datos.");
      return;
    }
    toast.success("Datos del paciente guardados.");
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Datos fiscales</DialogTitle>
          <DialogDescription>Aparecen en «Facturar a» de las facturas nuevas de {patient.email}.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="pd-name">Nombre completo</Label>
            <Input id="pd-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="pd-tax">DNI / NIF</Label>
              <Input id="pd-tax" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pd-phone">Teléfono</Label>
              <Input id="pd-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pd-address">Dirección (opcional; si no, sale «España»)</Label>
            <Textarea id="pd-address" rows={3} value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={busy} className="rounded-full">Guardar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PatientInvoicesDialog({
  patient,
  invoices,
  onClose,
}: {
  patient: Profile;
  invoices: Invoice[];
  onClose: () => void;
}) {
  const own = invoices
    .filter((inv) => inv.patient_id === patient.id)
    .sort((a, b) => b.number - a.number);
  const total = own.reduce((s, inv) => s + inv.total_cents, 0);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Facturas de {patient.full_name || patient.email}</DialogTitle>
          <DialogDescription>
            {own.length === 0
              ? "Todavía no tiene facturas emitidas desde la web."
              : `${own.length} ${own.length === 1 ? "factura" : "facturas"} · ${euros(total)} en total`}
          </DialogDescription>
        </DialogHeader>
        {own.length > 0 && (
          <ul className="flex max-h-[60vh] flex-col divide-y divide-border overflow-y-auto rounded-xl border border-border">
            {own.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{inv.code}</p>
                  <p className="text-sm text-muted-foreground">
                    {shortDate(inv.issue_date)} · {inv.description} · {PAYMENT_METHOD_LABEL[inv.payment_method]}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-medium text-foreground">{euros(inv.total_cents)}</span>
                  <Button size="sm" variant="outline" onClick={() => openInvoice(inv)}>
                    <FileText className="size-4" />
                    Ver / PDF
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
