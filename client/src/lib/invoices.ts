import { format } from "date-fns";
import type { Appointment, Bono, Invoice, InvoiceSettings } from "./supabase";
import { PAYMENT_METHOD_LABEL } from "./supabase";
import { SESSION_TYPES } from "./tariffs";

// Un pago cobrado que puede facturarse: una cita con importe propio o un bono.
export interface BillablePayment {
  kind: "cita" | "bono";
  id: string;
  patient_id: string;
  cents: number;
  label: string; // concepto
  date: string; // fecha del servicio (cita) o de venta (bono)
  paid_at: string;
}

export function billablePayments(appointments: Appointment[], bonos: Bono[], invoices: Invoice[]): BillablePayment[] {
  const invoicedAppts = new Set(invoices.map((i) => i.appointment_id).filter(Boolean));
  const invoicedBonos = new Set(invoices.map((i) => i.bono_id).filter(Boolean));
  return [
    ...appointments
      .filter((a) => a.paid_at && a.session_type !== "bono" && a.price_cents > 0 && a.status !== "cancelada" && !invoicedAppts.has(a.id))
      .map((a) => ({
        kind: "cita" as const, id: a.id, patient_id: a.patient_id, cents: a.price_cents,
        label: SESSION_TYPES[a.session_type].label, date: a.starts_at, paid_at: a.paid_at!,
      })),
    ...bonos
      .filter((b) => b.paid_at && !invoicedBonos.has(b.id))
      .map((b) => ({
        kind: "bono" as const, id: b.id, patient_id: b.patient_id, cents: b.price_cents,
        label: `Bono ${b.sessions_total} sesiones`, date: b.created_at, paid_at: b.paid_at!,
      })),
  ].sort((x, y) => x.paid_at.localeCompare(y.paid_at) || x.date.localeCompare(y.date));
}

export function invoiceCode(settings: Pick<InvoiceSettings, "series" | "number_digits">, n: number): string {
  return settings.series + String(n).padStart(settings.number_digits, "0");
}

function esc(v: string | null | undefined): string {
  return (v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function money(cents: number): string {
  return (cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function lines(text: string | null | undefined): string {
  return esc(text).split("\n").filter(Boolean).map((l) => `<div>${l}</div>`).join("");
}

// HTML de la factura con el mismo formato que las que ya emitía Silvia.
export function invoiceHtml(inv: Invoice): string {
  const date = format(new Date(`${inv.issue_date}T12:00:00`), "dd/MM/yyyy");
  const vat = Math.round((inv.unit_price_cents * inv.quantity * inv.vat_percent) / 100);
  const subtotal = inv.unit_price_cents * inv.quantity;
  const i = inv.issuer;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Factura_${esc(inv.code)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; color: #111; font-size: 11pt; margin: 0; }
  .page { max-width: 180mm; margin: 0 auto; padding: 8mm 0; }
  h1 { font-size: 20pt; margin: 0 0 14px; }
  .meta div { margin: 2px 0; }
  .parties { display: flex; gap: 24px; margin: 30px 0 40px; }
  .parties > div { flex: 1; }
  .parties h2 { font-size: 10pt; margin: 0 0 6px; text-transform: uppercase; }
  .parties div div { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th { background: #f0f0f0; text-align: left; font-size: 9pt; text-transform: uppercase; padding: 8px; border: 1px solid #ccc; }
  td { padding: 8px; border: 1px solid #ccc; font-size: 10pt; }
  .num { text-align: right; white-space: nowrap; }
  .totals { margin-left: auto; margin-top: 12px; width: 45%; }
  .totals div { display: flex; justify-content: space-between; padding: 3px 8px; font-size: 10pt; }
  .totals .total { font-weight: bold; font-size: 12pt; }
  .pay { margin-top: 30px; font-size: 10pt; }
  .pay div { margin: 3px 0; }
  .note { margin-top: 18px; font-size: 10pt; }
  .toolbar { position: fixed; top: 10px; right: 10px; }
  .toolbar button { font: inherit; padding: 8px 14px; border-radius: 6px; border: 1px solid #999; background: #fff; cursor: pointer; }
  @media print { .toolbar { display: none; } .page { padding: 0; } }
</style></head><body>
<div class="toolbar"><button onclick="window.print()">Descargar / imprimir PDF</button></div>
<div class="page">
  <h1>Factura</h1>
  <div class="meta">
    <div>Número #: ${esc(inv.code)}</div>
    <div>Fecha: ${date}</div>
    <div>Debido: ${date}</div>
  </div>
  <div class="parties">
    <div>
      <h2>Factura de</h2>
      <div>${esc(i.name)}</div>
      <div>${esc(i.tax_id)}</div>
      ${lines(i.address)}
      <div>${esc(i.email)}</div>
      <div>${esc(i.phone)}</div>
    </div>
    <div>
      <h2>Facturar a</h2>
      <div>${esc(inv.recipient_name)}</div>
      ${inv.recipient_tax_id ? `<div>${esc(inv.recipient_tax_id)}</div>` : ""}
      ${inv.recipient_address ? lines(inv.recipient_address) : "<div>España</div>"}
    </div>
  </div>
  <table>
    <thead><tr><th>Descripción</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">IVA(%)</th><th class="num">Importe</th></tr></thead>
    <tbody><tr>
      <td>${esc(inv.description)}</td>
      <td class="num">${inv.quantity}</td>
      <td class="num">${money(inv.unit_price_cents)}</td>
      <td class="num">${Number(inv.vat_percent)}</td>
      <td class="num">${money(inv.total_cents)}</td>
    </tr></tbody>
  </table>
  <div class="totals">
    <div><span>Subtotal</span><span>${money(subtotal)}</span></div>
    <div><span>IVA</span><span>${money(vat)}</span></div>
    <div class="total"><span>Importe total</span><span>${money(inv.total_cents)}</span></div>
  </div>
  <div class="pay">
    <div><strong>MÉTODO DE PAGO: ${esc(PAYMENT_METHOD_LABEL[inv.payment_method])}</strong></div>
    ${inv.payment_method === "transferencia" && i.bank_name ? `<div>Nombre del banco: ${esc(i.bank_name)}</div>` : ""}
    ${inv.payment_method === "transferencia" && i.bank_swift ? `<div>SWIFT/BIC: ${esc(i.bank_swift)}</div>` : ""}
  </div>
  <div class="note">${esc(i.exemption_note)}</div>
</div>
</body></html>`;
}

// Abre la factura en una pestaña nueva lista para guardar como PDF.
export function openInvoice(inv: Invoice): void {
  const w = window.open("", "_blank");
  if (!w) {
    alert("El navegador ha bloqueado la ventana de la factura. Permite las ventanas emergentes para esta web.");
    return;
  }
  w.document.open();
  w.document.write(invoiceHtml(inv));
  w.document.close();
}
