import { useState } from "react";
import { CalendarCheck as CalendarSyncIcon, Copy, Link2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

// Suscripción al calendario (api/calendar.ts): Google Calendar, Apple u Outlook
// leen un enlace privado y muestran las citas, que se actualizan solas.
export function CalendarSync({ who }: { who: "patient" | "admin" }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (rotate = false) => {
    if (rotate && !window.confirm("Se creará un enlace nuevo y el anterior dejará de funcionar. Tendrás que volver a añadir el calendario. ¿Seguir?")) return;
    setBusy(true);
    const { data, error } = await supabase!.rpc(rotate ? "rotate_calendar_token" : "my_calendar_token");
    setBusy(false);
    if (error || typeof data !== "string") return toast.error("No se pudo preparar el enlace del calendario.");
    setToken(data);
    if (rotate) toast.success("Enlace nuevo creado. El anterior ya no funciona.");
  };

  const feed = token ? `${window.location.origin}/api/calendar?t=${token}` : "";
  const webcal = feed.replace(/^https?:/, "webcal:");
  const google = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <CalendarSyncIcon className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <p className="font-medium text-foreground">Ver {who === "admin" ? "tu agenda" : "tus citas"} en tu calendario</p>
          <p className="text-sm text-muted-foreground">
            {who === "admin"
              ? "Citas (con las iniciales del paciente), eventos y días de Psicolink en Google Calendar, el calendario del iPhone u Outlook."
              : "Añade tus citas a Google Calendar, al calendario del iPhone u Outlook. Se actualizan solas."}
            {" "}Google puede tardar unas horas en mostrar los cambios.
          </p>
        </div>
      </div>
      {!token ? (
        <Button variant="outline" className="self-start rounded-full" disabled={busy} onClick={() => load()}>
          <Link2 className="size-4" /> {busy ? "Preparando…" : "Conectar con mi calendario"}
        </Button>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" className="rounded-full">
              <a href={google} target="_blank" rel="noopener noreferrer">Añadir a Google Calendar</a>
            </Button>
            <Button asChild size="sm" variant="outline" className="rounded-full">
              <a href={webcal}>iPhone / Mac</a>
            </Button>
            <Button size="sm" variant="outline" className="rounded-full" onClick={async () => {
              try { await navigator.clipboard.writeText(feed); toast.success("Enlace copiado. Pégalo en tu calendario («Añadir desde URL»)."); }
              catch { toast.error("No se pudo copiar. Mantén pulsado el enlace de abajo para copiarlo."); }
            }}>
              <Copy className="size-4" /> Copiar enlace
            </Button>
          </div>
          <p className="break-all rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">{feed}</p>
          <p className="text-xs text-muted-foreground">
            Es un enlace privado: quien lo tenga puede ver {who === "admin" ? "tu agenda" : "tus citas"}. No lo compartas.{" "}
            <button type="button" className="underline underline-offset-2 hover:text-foreground" disabled={busy} onClick={() => load(true)}>
              <RefreshCw className="mr-1 inline size-3" />Generar enlace nuevo
            </button>
          </p>
        </>
      )}
    </div>
  );
}
