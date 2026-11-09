import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { parseParagraphs, placeholderValues, renderTemplate } from "../../../../shared/consent";
import { Link } from "wouter";
import { format } from "date-fns";
import { Download, FileSignature, FileText, Info } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CONSENT_STATUS_LABEL, CONSENT_TITLE, downloadConsentPdf, fetchConsentContext, type ConsentOverview } from "@/lib/consent";

export const SIGN_PATH = "/mi-area/consentimiento";

// Aviso fijo en «Mi área» mientras el consentimiento esté pendiente.
export function ConsentBanner({ overview }: { overview: ConsentOverview | null }) {
  if (!overview || overview.status === "firmado") return null;
  const update = overview.status === "actualizacion";
  return (
    <div role="alert" className="mb-6 flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <FileSignature className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="font-semibold">Tienes un documento pendiente de firma</p>
          <p className="text-sm">
            {update
              ? `Hemos actualizado el «${CONSENT_TITLE}». Léelo y fírmalo de nuevo.`
              : `Antes de empezar, lee y firma el «${CONSENT_TITLE}» (protección de datos). Son unos minutos.`}
          </p>
        </div>
      </div>
      <Button asChild className="shrink-0 rounded-full">
        <Link href={SIGN_PATH}>Firmar ahora</Link>
      </Button>
    </div>
  );
}

function DownloadButton({ consentId, label = "Descargar PDF" }: { consentId: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
      setBusy(true);
      const ok = await downloadConsentPdf(consentId);
      setBusy(false);
      if (!ok) toast.error("No se pudo descargar el PDF. Vuelve a intentarlo.");
    }}>
      <Download className="size-4" />
      {busy ? "Preparando…" : label}
    </Button>
  );
}

const fmt = (iso: string) => format(new Date(iso), "d/M/yyyy");

// Tarjeta del consentimiento: estado, firma vigente y firmas anteriores.
// `canSign`: el paciente ve «Firmar ahora»; la psicóloga no.
export function ConsentCard({ overview, canSign }: { overview: ConsentOverview | null; canSign: boolean }) {
  if (!overview) {
    return <p className="text-sm text-muted-foreground">No se pudo cargar el estado del consentimiento.</p>;
  }
  const [latest, ...older] = overview.consents;
  const signed = overview.status === "firmado";
  return (
    <div className={cn("rounded-2xl border bg-card p-4", signed ? "border-border" : "border-amber-300")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <FileText className="mt-0.5 size-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="font-medium text-foreground">{CONSENT_TITLE}</p>
            <p className="text-sm text-muted-foreground">Protección de datos, normas del servicio y desistimiento</p>
            <Badge variant="outline" className={cn("mt-2",
              signed ? "border-primary/30 bg-primary/10 text-primary" : "border-amber-300 bg-amber-50 text-amber-900")}>
              {signed && latest ? `Firmado el ${fmt(latest.signed_at)}` : CONSENT_STATUS_LABEL[overview.status]}
            </Badge>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {canSign && !signed && (
            <Button asChild size="sm" className="rounded-full"><Link href={SIGN_PATH}>Firmar ahora</Link></Button>
          )}
          {latest && <DownloadButton consentId={latest.id} label={signed ? "Descargar PDF" : `PDF del ${fmt(latest.signed_at)}`} />}
        </div>
      </div>
      {older.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Firmas anteriores</p>
          <ul className="flex flex-col gap-2">
            {older.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                  {fmt(c.signed_at)} · versiones {c.versions.privacy} / {c.versions.rules} / {c.versions.withdrawal}
                </span>
                <DownloadButton consentId={c.id} label="PDF" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Aviso informativo para quien firmó un texto de protección de datos anterior
// al vigente cuando el cambio no obliga a volver a firmar (p. ej. el uso de IA
// para resumir notas, versión 2.2). «Leer» muestra el texto vigente.
const INFO_SEEN_KEY = "siloz:aviso-proteccion-datos-visto";

export function InfoUpdateBanner({ overview }: { overview: ConsentOverview | null }) {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(INFO_SEEN_KEY) === "2.2"; } catch { return false; }
  });
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<{ title: string; version: string; body: string } | null | "error">(null);
  if (!overview?.info_update || hidden) return null;

  const read = async () => {
    setOpen(true);
    if (text && text !== "error") return;
    const ctx = await fetchConsentContext();
    const doc = ctx?.documents.find((d) => d.doc_type === "privacy");
    if (!ctx || !doc || !ctx.settings || !ctx.therapist) return setText("error");
    setText({ title: doc.title, version: doc.version, body: renderTemplate(doc.body_md, placeholderValues(ctx.settings, ctx.therapist)).text });
  };
  const dismiss = () => {
    try { localStorage.setItem(INFO_SEEN_KEY, "2.2"); } catch { /* sin almacenamiento */ }
    setHidden(true);
  };

  return (
    <div role="status" className="mb-6 flex flex-col gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 size-5 shrink-0 text-primary" />
        <p className="text-foreground">
          <strong>Hemos actualizado la información sobre protección de datos.</strong>{" "}
          Ahora explica cómo se usa una herramienta de inteligencia artificial para resumir las notas de las sesiones.
          No tienes que volver a firmar.
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="outline" onClick={read}>Leer</Button>
        <Button size="sm" variant="ghost" onClick={dismiss}>Entendido</Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{text && text !== "error" ? text.title : "Protección de datos"}</DialogTitle>
            <DialogDescription>{text && text !== "error" ? `Versión ${text.version}` : ""}</DialogDescription>
          </DialogHeader>
          {text === "error" ? (
            <p className="text-sm text-destructive">No se pudo cargar el texto. Vuelve a intentarlo.</p>
          ) : !text ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : (
            <div className="text-sm leading-relaxed text-muted-foreground">
              {parseParagraphs(text.body).map((spans, i) => (
                <p key={i} className="mb-3">
                  {spans.map((sp, j) => (sp.bold ? <strong key={j} className="text-foreground">{sp.text}</strong> : <span key={j}>{sp.text}</span>))}
                </p>
              ))}
            </div>
          )}
          <Button onClick={() => { dismiss(); setOpen(false); }} className="self-end rounded-full">Entendido</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
