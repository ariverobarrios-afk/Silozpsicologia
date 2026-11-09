import { useEffect, useState, type FormEvent } from "react";
import { format } from "date-fns";
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
import { PAYMENT_METHOD_LABEL, supabase, type Invoice, type PaymentMethod } from "@/lib/supabase";
import { openInvoice } from "@/lib/invoices";

// Datos de un cobro: cuándo se pagó, cómo, y si se emite ya su factura.
export interface PaymentInput {
  paidOn: string; // yyyy-MM-dd
  method: PaymentMethod | "";
  invoice: boolean;
}

export const newPaymentInput = (): PaymentInput => ({
  paidOn: format(new Date(), "yyyy-MM-dd"),
  method: "",
  invoice: true,
});

export function paymentInputError(p: PaymentInput): string | null {
  if (!p.paidOn) return "Indica la fecha del pago.";
  if (p.paidOn > format(new Date(), "yyyy-MM-dd")) return "La fecha del pago no puede ser futura.";
  if (!p.method) return "Elige el método de pago.";
  return null;
}

const shortDate = (key: string) => format(new Date(`${key}T12:00:00`), "d/M/yyyy");

// Fecha mínima de la próxima factura (la de la última emitida o la fijada en
// Datos de facturación): si el pago es anterior, la factura lleva esta fecha.
function useInvoiceMinDate(): string | null {
  const [min, setMin] = useState<string | null>(null);
  useEffect(() => {
    if (!supabase) return;
    Promise.all([
      supabase.from("invoice_settings").select("series, last_date").eq("id", 1).maybeSingle(),
      supabase.from("invoices").select("issue_date, series").order("issue_date", { ascending: false }).limit(20),
    ]).then(([{ data: s }, { data: inv }]) => {
      const settings = s as { series: string; last_date: string | null } | null;
      const last = ((inv as { issue_date: string; series: string }[] | null) ?? [])
        .find((i) => i.series === settings?.series)?.issue_date ?? null;
      const dates = [settings?.last_date, last].filter(Boolean) as string[];
      setMin(dates.length ? dates.sort().at(-1)! : null);
    });
  }, []);
  return min;
}

export function PaymentFields({
  value,
  onChange,
  canInvoice = true,
  idPrefix = "pay",
}: {
  value: PaymentInput;
  onChange: (v: PaymentInput) => void;
  canInvoice?: boolean;
  idPrefix?: string;
}) {
  const minDate = useInvoiceMinDate();
  const invoiceDate = minDate && value.paidOn && value.paidOn < minDate ? minDate : value.paidOn;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-date`}>Fecha del pago</Label>
          <Input id={`${idPrefix}-date`} type="date" required value={value.paidOn} max={format(new Date(), "yyyy-MM-dd")}
            onChange={(e) => onChange({ ...value, paidOn: e.target.value })} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${idPrefix}-method`}>Método de pago</Label>
          <Select value={value.method} onValueChange={(v) => v && onChange({ ...value, method: v as PaymentMethod })}>
            <SelectTrigger id={`${idPrefix}-method`} className="w-full"><SelectValue placeholder="Elige" /></SelectTrigger>
            <SelectContent>
              {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => (
                <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {canInvoice && (
        <label className="flex items-start gap-3 rounded-xl border border-border px-3 py-2.5 text-sm">
          <Checkbox className="mt-0.5" checked={value.invoice} onCheckedChange={(v) => onChange({ ...value, invoice: Boolean(v) })} />
          <span>
            <span className="block font-medium text-foreground">Emitir factura</span>
            {value.invoice && invoiceDate && (
              <span className="block text-xs text-muted-foreground">
                Con fecha {shortDate(invoiceDate)}
                {invoiceDate !== value.paidOn && " (la de la última factura, para que las fechas sigan correlativas)"}.
              </span>
            )}
            {!value.invoice && (
              <span className="block text-xs text-muted-foreground">Quedará en Facturas → Pendientes de facturar.</span>
            )}
          </span>
        </label>
      )}
    </div>
  );
}

// Guarda el cobro (y su factura, si se pide) en la base de datos.
export async function registerPayment(kind: "cita" | "bono", id: string, p: PaymentInput): Promise<boolean> {
  const { data, error } = await supabase!.rpc("register_payment", {
    p_kind: kind,
    p_id: id,
    p_paid_on: p.paidOn,
    p_method: p.method,
    p_invoice: p.invoice,
  });
  if (error) {
    toast.error(error.message || "No se pudo registrar el pago.");
    return false;
  }
  const inv = data as Invoice | null;
  if (inv?.code) {
    toast.success(`Pago registrado y factura ${inv.code} emitida.`, {
      action: { label: "Ver factura", onClick: () => openInvoice(inv) },
    });
  } else {
    toast.success("Pago registrado.");
  }
  return true;
}

export function PaymentDialog({
  kind,
  id,
  title,
  description,
  canInvoice = true,
  onClose,
  onPaid,
}: {
  kind: "cita" | "bono";
  id: string;
  title: string;
  description: string;
  canInvoice?: boolean;
  onClose: () => void;
  onPaid: () => void;
}) {
  const [value, setValue] = useState<PaymentInput>(() => ({ ...newPaymentInput(), invoice: canInvoice }));
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const err = paymentInputError(value);
    if (err) {
      toast.error(err);
      return;
    }
    setBusy(true);
    const ok = await registerPayment(kind, id, value);
    setBusy(false);
    if (ok) onPaid();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <PaymentFields value={value} onChange={setValue} canInvoice={canInvoice} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={busy} className="rounded-full">Registrar pago</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
