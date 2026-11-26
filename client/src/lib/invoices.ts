import { format } from "date-fns";
import type { Appointment, Bono, Invoice, InvoiceSettings, PaymentMethod } from "./supabase";
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
  method: PaymentMethod | null; // cómo se cobró, si consta
}

// Pagos cobrados sin factura. Con skipped = true, los marcados «no facturar»;
// si no, los que aún están pendientes de facturar.
export function billablePayments(appointments: Appointment[], bonos: Bono[], invoices: Invoice[], skipped = false): BillablePayment[] {
  const invoicedAppts = new Set(invoices.map((i) => i.appointment_id).filter(Boolean));
  const invoicedBonos = new Set(invoices.map((i) => i.bono_id).filter(Boolean));
  return [
    ...appointments
      .filter((a) => a.paid_at && a.session_type !== "bono" && a.price_cents > 0 && a.status !== "cancelada" && !invoicedAppts.has(a.id))
      .filter((a) => Boolean(a.invoice_skipped_at) === skipped)
      .map((a) => ({
        kind: "cita" as const, id: a.id, patient_id: a.patient_id, cents: a.price_cents,
        label: SESSION_TYPES[a.session_type].label, date: a.starts_at, paid_at: a.paid_at!, method: a.payment_method,
      })),
    ...bonos
      .filter((b) => b.paid_at && !invoicedBonos.has(b.id) && Boolean(b.invoice_skipped_at) === skipped)
      .map((b) => ({
        kind: "bono" as const, id: b.id, patient_id: b.patient_id, cents: b.price_cents,
        label: `Bono ${b.sessions_total} sesiones`, date: b.created_at, paid_at: b.paid_at!, method: b.payment_method,
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

// Símbolo de Siloz (el mismo que usa la web).
export const INVOICE_LOGO_PATH = "/images/simbolo-reloj-arena.png";

const INVOICE_CSS = `
  * { box-sizing: border-box; }
  .sheet { font-family: Helvetica, Arial, sans-serif; color: #111; font-size: 11pt; line-height: normal; text-align: left; }
  .page { max-width: 180mm; margin: 0 auto; padding: 8mm 16px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 16px; border-bottom: 1px solid #ddd; }
  .logo { height: 22mm; width: auto; margin-left: 12mm; }
  .title { text-align: right; }
  h1 { font-size: 20pt; font-weight: bold; margin: 0 0 14px; }
  .meta div { margin: 2px 0; }
  .parties { display: flex; gap: 24px; margin: 30px 0 40px; }
  .parties > div { flex: 1; }
  .parties h2 { font-size: 10pt; font-weight: bold; margin: 0 0 6px; text-transform: uppercase; }
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
  .toolbar { position: sticky; top: 0; z-index: 1; display: flex; justify-content: space-between; gap: 12px;
    padding: calc(10px + env(safe-area-inset-top)) 16px 10px; background: #f6f6f6; border-bottom: 1px solid #ddd;
    font-family: Helvetica, Arial, sans-serif; }
  .toolbar button { font: inherit; font-size: 15px; color: #111; padding: 9px 16px; border-radius: 6px; border: 1px solid #999; background: #fff; cursor: pointer; }
  @media print { .toolbar { display: none; } .page { padding: 0; } }
`;

// Reglas para la página que contiene el visor: al imprimir solo sale la factura.
const INVOICE_PRINT_CSS = `
  @page { size: A4; margin: 18mm 16mm; }
  @media print {
    html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
    body > *:not(#invoice-viewer) { display: none !important; }
    #invoice-viewer { position: static !important; overflow: visible !important; }
  }
`;

// Cuerpo de la factura con el mismo formato que las que ya emitía Silvia.
export function invoiceHtml(inv: Invoice, logoUrl?: string): string {
  const date = format(new Date(`${inv.issue_date}T12:00:00`), "dd/MM/yyyy");
  const operationDate = inv.operation_date ? format(new Date(`${inv.operation_date}T12:00:00`), "dd/MM/yyyy") : null;
  const vat = Math.round((inv.unit_price_cents * inv.quantity * inv.vat_percent) / 100);
  const subtotal = inv.unit_price_cents * inv.quantity;
  const i = inv.issuer;
  return `<div class="page">
  <div class="head">
    ${logoUrl ? `<img class="logo" src="${esc(logoUrl)}" alt="Siloz Psicología">` : "<span></span>"}
    <div class="title">
      <h1>Factura</h1>
      <div class="meta">
        <div>Número #: ${esc(inv.code)}</div>
        <div>Fecha: ${date}</div>
        <div>Debido: ${date}</div>
        ${operationDate ? `<div>Fecha de la operación (cobro): ${operationDate}</div>` : ""}
      </div>
    </div>
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
    ${inv.payment_method ? `<div><strong>MÉTODO DE PAGO: ${esc(PAYMENT_METHOD_LABEL[inv.payment_method])}</strong></div>` : ""}
    ${inv.payment_method === "transferencia" && i.bank_name ? `<div>Nombre del banco: ${esc(i.bank_name)}</div>` : ""}
    ${inv.payment_method === "transferencia" && i.bank_swift ? `<div>SWIFT/BIC: ${esc(i.bank_swift)}</div>` : ""}
  </div>
  <div class="note">${esc(i.exemption_note)}</div>
</div>
`;
}

let closeViewer: (() => void) | null = null;

// Muestra la factura a pantalla completa dentro de la propia web, con un botón
// para volver y otro para guardarla como PDF. No se abre en otra ventana: en
// el iPad (web instalada como app) esa ventana no tiene forma de volver atrás.
export function openInvoice(inv: Invoice): void {
  closeViewer?.();

  const host = document.createElement("div");
  host.id = "invoice-viewer";
  // pointer-events: los diálogos abiertos desactivan los clics en el resto de la página.
  host.style.cssText =
    "position:fixed;inset:0;z-index:2147483000;background:#fff;overflow:auto;pointer-events:auto;-webkit-overflow-scrolling:touch;";
  // En un shadow root los estilos de la factura y los de la web no se mezclan.
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${INVOICE_CSS}</style>
<div class="sheet">
  <div class="toolbar">
    <button type="button" data-action="back">← Volver</button>
    <button type="button" data-action="print">Descargar / imprimir PDF</button>
  </div>
  ${invoiceHtml(inv, `${window.location.origin}${INVOICE_LOGO_PATH}`)}
</div>`;

  const printCss = document.createElement("style");
  printCss.textContent = INVOICE_PRINT_CSS;
  const prevTitle = document.title;
  const prevOverflow = document.body.style.overflow;

  const back = () => window.history.back();
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    back();
  };
  const close = () => {
    window.removeEventListener("popstate", close);
    document.removeEventListener("keydown", onKey, true);
    host.remove();
    printCss.remove();
    document.title = prevTitle;
    document.body.style.overflow = prevOverflow;
    closeViewer = null;
  };
  closeViewer = close;

  // Que tocar la factura no cuente como «clic fuera» del diálogo que haya debajo.
  host.addEventListener("pointerdown", (e) => e.stopPropagation());
  root.querySelector('[data-action="back"]')!.addEventListener("click", back);
  root.querySelector('[data-action="print"]')!.addEventListener("click", () => window.print());

  // El PDF se guarda con el título de la página como nombre.
  document.title = `Factura_${inv.code}`;
  document.body.style.overflow = "hidden";
  document.head.appendChild(printCss);
  document.body.appendChild(host);

  // Una entrada en el historial: el gesto o botón «atrás» también cierra la factura.
  window.history.pushState({ ...window.history.state, invoiceViewer: true }, "");
  window.addEventListener("popstate", close);
  document.addEventListener("keydown", onKey, true);
}
