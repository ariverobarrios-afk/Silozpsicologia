import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Redirect } from "wouter";
import SignaturePad from "signature_pad";
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, Download, Eraser, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  CONSENT_TITLE,
  downloadConsentPdf,
  fetchConsentContext,
  submitConsent,
  type ConsentContext,
} from "@/lib/consent";
import {
  REQUIRED_LABELS,
  formErrors,
  madridToday,
  missingFields,
  parseParagraphs,
  placeholderValues,
  renderTemplate,
  splitFullName,
  type ConsentDocument,
  type ConsentForm,
  type DocType,
} from "../../../../shared/consent";
import { AreaLayout, RequireRole } from "./AreaLayout";

// Página de firma del consentimiento (/mi-area/consentimiento). Los textos se
// muestran ya con los datos del centro y de la profesional; el servidor los
// vuelve a generar al firmar, sin fiarse de lo que se ve aquí.

const UNLOCK_SECONDS = 10;
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {parseParagraphs(text).map((spans, i) => (
        <p key={i} className="mb-3 last:mb-0">
          {spans.map((s, j) => (s.bold ? <strong key={j} className="font-semibold text-foreground">{s.text}</strong> : <span key={j}>{s.text}</span>))}
        </p>
      ))}
    </>
  );
}

// Un bloque legal: desplegable (abierto al principio), con su casilla, que se
// habilita al llegar al final del texto o tras 10 segundos abierto.
function DocBlock({ label, doc, text, checked, onCheck }: {
  label: string;
  doc: ConsentDocument;
  text: string;
  checked: boolean;
  onCheck: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(UNLOCK_SECONDS);
  const boxRef = useRef<HTMLDivElement>(null);

  const checkScrolled = useCallback(() => {
    const el = boxRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 12) setUnlocked(true);
  }, []);

  useEffect(() => {
    if (!open || unlocked) return;
    checkScrolled(); // texto corto que cabe entero
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) { setUnlocked(true); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [open, unlocked, checkScrolled]);

  const id = `accept-${doc.doc_type}`;
  return (
    <section className={cn("rounded-2xl border bg-card", checked ? "border-primary/40" : "border-border")}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-4 text-left">
        <span>
          <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">Bloque {label} · versión {doc.version}</span>
          <span className="font-serif text-lg font-semibold text-foreground">{doc.title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {checked && <CheckCircle2 className="size-5 text-primary" aria-label="aceptado" />}
          <ChevronDown className={cn("size-5 text-muted-foreground transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && (
        <div ref={boxRef} onScroll={checkScrolled} tabIndex={0}
          className="mx-4 max-h-80 overflow-y-auto rounded-md border border-border bg-background p-4 text-sm leading-relaxed text-muted-foreground">
          <Paragraphs text={text} />
        </div>
      )}
      <div className="flex items-start gap-3 p-4">
        <Checkbox id={id} checked={checked} disabled={!unlocked} onCheckedChange={(v) => onCheck(v === true)} className="mt-0.5" />
        <div>
          <Label htmlFor={id} className={cn("leading-snug", !unlocked && "text-muted-foreground")}>{doc.checkbox_label}</Label>
          {!unlocked && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="size-3" />
              {open ? `Lee el texto hasta el final para poder marcarla (o espera ${secondsLeft} s).` : "Abre el bloque y léelo para poder marcarla."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// Recuadro de firma (signature_pad), a todo el ancho y adaptado a pantallas retina.
function SignatureBox({ onChange, padRef }: { onChange: (empty: boolean) => void; padRef: React.MutableRefObject<SignaturePad | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current!;
    const pad = new SignaturePad(canvas, { penColor: "#1d2b24", backgroundColor: "rgba(0,0,0,0)", minWidth: 0.8, maxWidth: 2.6 });
    padRef.current = pad;
    const resize = () => {
      const data = pad.toData();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      canvas.getContext("2d")!.scale(ratio, ratio);
      pad.clear();
      pad.fromData(data);
    };
    resize();
    const onEnd = () => onChange(pad.isEmpty());
    pad.addEventListener("endStroke", onEnd);
    window.addEventListener("resize", resize);
    return () => {
      pad.removeEventListener("endStroke", onEnd);
      window.removeEventListener("resize", resize);
      pad.off();
    };
  }, [onChange, padRef]);
  return (
    <div className="flex flex-col gap-2">
      <canvas ref={canvasRef} aria-label="Recuadro de firma"
        className="h-48 w-full rounded-2xl border-2 border-dashed border-primary/40 bg-white"
        style={{ touchAction: "none" }} />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Firma con el dedo o con el ratón dentro del recuadro.</p>
        <Button type="button" variant="ghost" size="sm" onClick={() => { padRef.current?.clear(); onChange(true); }}>
          <Eraser className="size-4" /> Borrar
        </Button>
      </div>
    </div>
  );
}

// Cloudflare Turnstile, solo si hay clave configurada (VITE_TURNSTILE_SITE_KEY).
function useTurnstile(container: React.RefObject<HTMLDivElement | null>) {
  const [token, setToken] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !container.current) return;
    const w = window as unknown as { turnstile?: { render: (el: HTMLElement, o: object) => void } };
    const render = () => w.turnstile?.render(container.current!, { sitekey: TURNSTILE_SITE_KEY, callback: setToken, "expired-callback": () => setToken(undefined) });
    if (w.turnstile) { render(); return; }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [container]);
  return { enabled: Boolean(TURNSTILE_SITE_KEY), token };
}

function Field({ id, label, value, onChange, error, highlight, type = "text", readOnly, hint, autoComplete }: {
  id: string; label: string; value: string; onChange?: (v: string) => void; error?: string; highlight?: boolean;
  type?: string; readOnly?: boolean; hint?: string; autoComplete?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} readOnly={readOnly} autoComplete={autoComplete}
        onChange={(e) => onChange?.(e.target.value)} aria-invalid={Boolean(error)}
        className={cn(highlight && !value && "border-amber-400 bg-amber-50 ring-2 ring-amber-200", readOnly && "bg-muted text-muted-foreground")} />
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function SignForm({ ctx }: { ctx: ConsentContext }) {
  const today = madridToday();
  const initial = useMemo<ConsentForm>(() => {
    const { name, surname } = splitFullName(ctx.patient.full_name || "");
    return {
      name, surname,
      idNumber: ctx.patient.tax_id ?? "",
      email: ctx.patient.email ?? "",
      phone: ctx.patient.phone ?? "",
      birthdate: ctx.patient.birth_date ?? "",
    };
  }, [ctx]);
  const [form, setForm] = useState<ConsentForm>(initial);
  const initiallyMissing = useMemo(() => new Set(missingFields(initial)), [initial]);
  const [accepted, setAccepted] = useState<Record<DocType, boolean>>({ privacy: false, rules: false, withdrawal: false });
  const [signatureEmpty, setSignatureEmpty] = useState(true);
  const padRef = useRef<SignaturePad | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstile = useTurnstile(turnstileRef);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<{ message: string; code?: string } | null>(null);
  const [done, setDone] = useState<{ consentId: string; email: string; emailSent: boolean } | null>(null);

  const values = useMemo(
    () => placeholderValues(ctx.settings!, ctx.therapist!, { nombre: `${form.name} ${form.surname}`.trim(), dni: form.idNumber }),
    [ctx, form.name, form.surname, form.idNumber]
  );
  const missing = missingFields(form);
  const errors = formErrors(form, today);
  const isMinor = Boolean(errors.birthdate && /menores/.test(errors.birthdate));
  const set = (k: keyof ConsentForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const onSignatureChange = useCallback((empty: boolean) => setSignatureEmpty(empty), []);

  const blockers: string[] = [];
  if (missing.length) blockers.push("completa tus datos");
  if (Object.keys(errors).length) blockers.push("revisa los datos marcados");
  if (!accepted.privacy || !accepted.rules || !accepted.withdrawal) blockers.push("marca las tres casillas");
  if (signatureEmpty) blockers.push("firma en el recuadro");
  if (turnstile.enabled && !turnstile.token) blockers.push("completa la verificación");
  const canSubmit = blockers.length === 0 && !busy;

  const onSubmit = async () => {
    if (!canSubmit || !padRef.current) return;
    setBusy(true);
    setServerError(null);
    const ids = Object.fromEntries(ctx.documents.map((d) => [d.doc_type, d.id]));
    const res = await submitConsent({
      name: form.name.trim(), surname: form.surname.trim(), idNumber: form.idNumber.trim(),
      phone: form.phone.trim(), birthdate: form.birthdate,
      accepted, versionIds: ids, signature: padRef.current.toDataURL("image/png"),
      turnstileToken: turnstile.token,
    });
    setBusy(false);
    if (!res.success || !res.consentId) {
      setServerError({ message: res.message || "No se pudo firmar.", code: res.code });
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      return;
    }
    setDone({ consentId: res.consentId, email: res.email ?? form.email, emailSent: res.emailSent !== false });
    window.scrollTo({ top: 0 });
  };

  if (done) {
    return (
      <div className="flex max-w-2xl flex-col gap-4 rounded-2xl border border-primary/30 bg-primary/10 p-6">
        <CheckCircle2 className="size-8 text-primary" />
        <h2 className="font-serif text-2xl font-semibold text-foreground">Documento firmado</h2>
        <p className="text-foreground">
          {done.emailSent ? <>Te hemos enviado una copia a <strong>{done.email}</strong>.</> : "Ya está guardado. No hemos podido enviarte el email, pero puedes descargarlo aquí cuando quieras."}
          {" "}También lo tienes siempre en tu área, en «Documentos».
        </p>
        <p className="text-sm text-muted-foreground">ID del documento: <span className="font-mono">{done.consentId}</span></p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="rounded-full" onClick={async () => {
            if (!(await downloadConsentPdf(done.consentId))) toast.error("No se pudo descargar el PDF. Vuelve a intentarlo.");
          }}>
            <Download className="size-4" /> Descargar PDF
          </Button>
          <Button asChild className="rounded-full"><Link href="/mi-area">Volver a mi área</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <p className="text-muted-foreground">
        Lee los tres documentos, marca las casillas y firma al final. Recibirás una copia en PDF por email y la tendrás siempre en tu área.
      </p>

      <section className="flex flex-col gap-4">
        <h2 className="font-serif text-2xl font-semibold text-foreground">Tus datos</h2>
        {initiallyMissing.size > 0 && missing.length > 0 && (
          <div role="alert" className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <p>
              <strong>Para completar tu ficha necesitamos estos datos:</strong>{" "}
              {missing.map((k) => REQUIRED_LABELS[k]).join(", ")}.
            </p>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="c-name" label="Nombre" value={form.name} onChange={set("name")} error={errors.name}
            highlight={initiallyMissing.has("name")} autoComplete="given-name" />
          <Field id="c-surname" label="Apellidos" value={form.surname} onChange={set("surname")} error={errors.surname}
            highlight={initiallyMissing.has("surname")} autoComplete="family-name" />
          <Field id="c-id" label="DNI/NIE" value={form.idNumber} onChange={set("idNumber")} error={errors.idNumber}
            highlight={initiallyMissing.has("idNumber")} hint="Con su letra, por ejemplo 12345678Z." />
          <Field id="c-birth" label="Fecha de nacimiento" type="date" value={form.birthdate} onChange={set("birthdate")}
            error={isMinor ? undefined : errors.birthdate} highlight={initiallyMissing.has("birthdate")} autoComplete="bday" />
          <Field id="c-email" label="Email" value={form.email} readOnly hint="Es el email de tu cuenta: ahí te enviaremos la copia." />
          <Field id="c-phone" label="Teléfono (opcional)" type="tel" value={form.phone} onChange={set("phone")} error={errors.phone} autoComplete="tel" />
        </div>
        {isMinor && (
          <div role="alert" className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <p>{errors.birthdate}</p>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-serif text-2xl font-semibold text-foreground">Documentos</h2>
        {ctx.documents.map((d, i) => (
          <DocBlock key={d.id} label={"ABC"[i]} doc={d} text={renderTemplate(d.body_md, values).text}
            checked={accepted[d.doc_type]} onCheck={(v) => setAccepted((a) => ({ ...a, [d.doc_type]: v }))} />
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-serif text-2xl font-semibold text-foreground">Firma</h2>
        <SignatureBox onChange={onSignatureChange} padRef={padRef} />
        {turnstile.enabled && <div ref={turnstileRef} />}
        {serverError && (
          <div role="alert" className="flex flex-col gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            <p>{serverError.message}</p>
            {serverError.code === "documents_changed" && (
              <Button variant="outline" size="sm" className="self-start" onClick={() => window.location.reload()}>Recargar</Button>
            )}
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {blockers.length ? `Para firmar: ${blockers.join(", ")}.` : "Todo listo. Al pulsar «Firmar» quedará registrada la fecha, la hora y tu firma."}
          </p>
          <Button onClick={onSubmit} disabled={!canSubmit} size="lg" className="shrink-0 rounded-full">
            {busy ? "Firmando…" : "Firmar"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function ConsentPage() {
  const [ctx, setCtx] = useState<ConsentContext | null | "error">(null);
  useEffect(() => {
    fetchConsentContext().then((c) => setCtx(c ?? "error"));
  }, []);

  if (ctx === "error") {
    return <p className="text-destructive">No se pudo cargar el documento. Recarga la página.</p>;
  }
  if (!ctx) return <Spinner className="size-6 text-primary" />;
  // Ya firmada la versión vigente: a «Mis documentos».
  if (ctx.status === "firmado") return <Redirect to="/mi-area#documentos" />;
  if (!ctx.ready || !ctx.settings || !ctx.therapist || ctx.documents.length < 3) {
    return <p className="text-muted-foreground">El documento todavía no está disponible. Contacta con tu psicóloga.</p>;
  }
  return <SignForm ctx={ctx} />;
}

export default function Consentimiento() {
  return (
    <RequireRole role="patient">
      <AreaLayout title={CONSENT_TITLE}>
        <Link href="/mi-area" className="-mt-2 mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground md:-mt-4">
          <ArrowLeft className="size-4" /> Mi área
        </Link>
        <ConsentPage />
      </AreaLayout>
    </RequireRole>
  );
}
