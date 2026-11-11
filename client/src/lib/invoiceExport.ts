import { PAYMENT_METHOD_LABEL, type Invoice } from "@/lib/supabase";

// Excel de facturas emitidas para el gestor: una fila por factura y una fila
// final con los totales. exceljs se carga solo al exportar (pesa bastante).

const dateCell = (iso: string | null) => {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  // Fecha a mediodía UTC para que Excel no la desplace por la zona horaria.
  return new Date(Date.UTC(y, m - 1, d, 12));
};

export async function downloadInvoicesExcel(invoices: Invoice[], fileName: string) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Siloz Psicología";
  const ws = wb.addWorksheet("Facturas", { views: [{ state: "frozen", ySplit: 1 }] });

  const money = '#,##0.00 "€"';
  ws.columns = [
    { header: "Nº factura", key: "code", width: 14 },
    { header: "Fecha factura", key: "issue_date", width: 14, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Fecha cobro", key: "operation_date", width: 14, style: { numFmt: "dd/mm/yyyy" } },
    { header: "Paciente", key: "recipient_name", width: 30 },
    { header: "DNI / NIF", key: "recipient_tax_id", width: 14 },
    { header: "Concepto", key: "description", width: 44 },
    { header: "Cantidad", key: "quantity", width: 10 },
    { header: "Precio unitario", key: "unit_price", width: 15, style: { numFmt: money } },
    { header: "Base imponible", key: "base", width: 15, style: { numFmt: money } },
    { header: "IVA %", key: "vat_percent", width: 8 },
    { header: "Cuota IVA", key: "vat", width: 12, style: { numFmt: money } },
    { header: "Total", key: "total", width: 12, style: { numFmt: money } },
    { header: "Método de pago", key: "payment_method", width: 22 },
  ];

  const sorted = [...invoices].sort(
    (a, b) => a.issue_date.localeCompare(b.issue_date) || a.number - b.number,
  );
  for (const inv of sorted) {
    const base = inv.unit_price_cents * inv.quantity;
    ws.addRow({
      code: inv.code,
      issue_date: dateCell(inv.issue_date),
      operation_date: dateCell(inv.operation_date),
      recipient_name: inv.recipient_name,
      recipient_tax_id: inv.recipient_tax_id ?? "",
      description: inv.description,
      quantity: inv.quantity,
      unit_price: inv.unit_price_cents / 100,
      base: base / 100,
      vat_percent: Number(inv.vat_percent),
      vat: (inv.total_cents - base) / 100,
      total: inv.total_cents / 100,
      payment_method: inv.payment_method ? PAYMENT_METHOD_LABEL[inv.payment_method] : "",
    });
  }

  const header = ws.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFE9E1" } };

  if (sorted.length > 0) {
    const first = 2;
    const last = sorted.length + 1;
    const totals = ws.addRow({ recipient_name: `${sorted.length} ${sorted.length === 1 ? "factura" : "facturas"}` });
    totals.getCell("code").value = "TOTAL";
    const sums: Record<string, number> = { base: 0, vat: 0, total: 0 };
    for (const inv of sorted) {
      const base = inv.unit_price_cents * inv.quantity;
      sums.base += base;
      sums.vat += inv.total_cents - base;
      sums.total += inv.total_cents;
    }
    for (const key of ["base", "vat", "total"]) {
      const col = ws.getColumn(key).letter;
      totals.getCell(key).value = { formula: `SUM(${col}${first}:${col}${last})`, result: sums[key] / 100 };
    }
    totals.font = { bold: true };
    totals.border = { top: { style: "thin" } };
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
