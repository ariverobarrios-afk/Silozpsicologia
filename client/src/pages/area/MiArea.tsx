import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { CalendarDays, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { supabase, type Appointment, type Bono, type Invoice } from "@/lib/supabase";
import { openInvoice } from "@/lib/invoices";
import { BONO, bonoRemaining, euros } from "@/lib/tariffs";
import { fetchConsentOverview, type ConsentOverview } from "@/lib/consent";
import { ConsentBanner, ConsentCard, InfoUpdateBanner } from "./ConsentDocuments";
import { HighlightsView } from "./HighlightsView";
import { formatDayTitle } from "./format";
import { AppointmentItem } from "./AppointmentItem";
import { Banner, BookingSection, CancelBookingButton, useBookingContext } from "./BookingSection";
import { AreaLayout, RequireRole } from "./AreaLayout";
import { ShowMoreList } from "./ShowMoreList";

function MisCitas() {
  const { profile } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [bonos, setBonos] = useState<Bono[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState(false);
  const { settings, psychologist } = useBookingContext();
  const [cancelBanner, setCancelBanner] = useState<string | null>(null);
  const [consent, setConsent] = useState<ConsentOverview | null>(null);
  // Highlights que la psicóloga ha publicado (solo el texto publicado).
  const [highlights, setHighlights] = useState<Array<{ appointment_id: string; starts_at: string; content: string }>>([]);
  // Pestaña en la URL (#documentos) para que el enlace del email abra «Documentos».
  const [tab, setTab] = useState(() => (window.location.hash === "#documentos" ? "documentos" : "citas"));
  const changeTab = (value: string) => {
    setTab(value);
    window.history.replaceState(null, "", value === "documentos" ? "#documentos" : window.location.pathname);
  };

  const loadAppointments = useCallback(() => {
    if (!supabase || !profile) return;
    // RLS garantiza que solo vuelven las citas de este paciente; el filtro
    // explícito es solo para que la consulta sea clara.
    supabase
      .from("appointments")
      .select("*")
      .eq("patient_id", profile.id)
      .order("starts_at", { ascending: true })
      .then(({ data, error }) => {
        if (error) setError(true);
        else setAppointments((data as Appointment[]) ?? []);
      });
  }, [profile]);

  useEffect(() => {
    if (!supabase || !profile) return;
    loadAppointments();
    supabase
      .from("bonos")
      .select("*")
      .eq("patient_id", profile.id)
      .order("created_at")
      .then(({ data }) => setBonos((data as Bono[]) ?? []));
    // Sus facturas, de la más nueva a la más antigua por numeración.
    supabase
      .from("invoices")
      .select("*")
      .eq("patient_id", profile.id)
      .order("number", { ascending: false })
      .then(({ data }) => setInvoices((data as Invoice[]) ?? []));
    fetchConsentOverview(profile.id).then(setConsent);
    supabase.rpc("my_session_highlights").then(({ data }) =>
      setHighlights((data as Array<{ appointment_id: string; starts_at: string; content: string }> | null) ?? []));
  }, [profile, loadAppointments]);

  const consentPending = Boolean(consent && consent.status !== "firmado");

  const now = Date.now();
  const upcoming = (appointments ?? []).filter(
    (a) => new Date(a.starts_at).getTime() >= now && a.status === "programada"
  );
  const past = (appointments ?? [])
    .filter((a) => !upcoming.includes(a))
    .reverse();

  return (
    <AreaLayout title={profile?.full_name ? `Hola, ${profile.full_name.split(" ")[0]}` : "Mi área"}>
      <ConsentBanner overview={consent} />
      <InfoUpdateBanner overview={consent} />
      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="citas"><CalendarDays className="size-4" /> Citas</TabsTrigger>
          <TabsTrigger value="documentos">
            <FileText className="size-4" /> Documentos
            {consentPending && <span className="ml-1 size-2 rounded-full bg-amber-500" aria-label="pendiente de firma" />}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="citas">
          {error && <p className="text-destructive">No se pudieron cargar tus citas. Recarga la página.</p>}
          {!appointments && !error && <Spinner className="size-6 text-primary" />}
          {appointments && bonos
            .filter((b) => bonoRemaining(b, appointments) > 0)
            .map((b) => {
              const left = bonoRemaining(b, appointments);
              return (
                <div key={b.id} className="mb-8 rounded-2xl border border-primary/30 bg-primary/10 p-4">
                  <p className="font-medium text-foreground">{BONO.label}</p>
                  <p className="text-sm text-muted-foreground">
                    Te {left === 1 ? "queda 1 sesión" : `quedan ${left} sesiones`} de {b.sessions_total}.
                  </p>
                </div>
              );
            })}
          {/* Si está activado el bloqueo, no se reserva hasta firmar (el aviso de arriba lleva a la firma). */}
          {appointments && !(consentPending && consent?.block_booking) && (
            <BookingSection appointments={appointments} settings={settings} psychologist={psychologist}
              onBooked={loadAppointments} />
          )}
          {appointments && consentPending && consent?.block_booking && (
            <section className="mb-10">
              <h2 className="mb-2 font-serif text-2xl font-semibold text-foreground">Reservar cita</h2>
              <p className="text-muted-foreground">Para reservar cita, primero firma el consentimiento (aviso de arriba).</p>
            </section>
          )}
          {appointments && (
            <div className="grid gap-10 lg:grid-cols-2">
              <section className="flex flex-col">
                <h2 className="mb-4 font-serif text-2xl font-semibold text-foreground">Mis próximas citas</h2>
                {cancelBanner && (
                  <Banner message={cancelBanner} psychologist={psychologist} onClose={() => setCancelBanner(null)} />
                )}
                {upcoming.length === 0 ? (
                  <p className="text-muted-foreground">No tienes citas programadas.</p>
                ) : (
                  <ShowMoreList className="flex flex-col gap-3">
                    {upcoming.map((a) => (
                      <AppointmentItem key={a.id} appointment={a}
                        actions={a.origin === "reserva_paciente" && (
                          <CancelBookingButton appointment={a} settings={settings}
                            onTooLate={setCancelBanner}
                            onCancelled={() => { setCancelBanner(null); loadAppointments(); }} />
                        )} />
                    ))}
                  </ShowMoreList>
                )}
              </section>
              <section className="flex flex-col">
                <h2 className="mb-4 font-serif text-2xl font-semibold text-foreground">Historial</h2>
                {past.length === 0 ? (
                  <p className="text-muted-foreground">Aún no hay citas anteriores.</p>
                ) : (
                  <ShowMoreList className="flex flex-col gap-3">
                    {past.map((a) => <AppointmentItem key={a.id} appointment={a} />)}
                  </ShowMoreList>
                )}
              </section>
            </div>
          )}
          {highlights.length > 0 && (
            <section className="mt-10 flex flex-col">
              <h2 className="mb-1 font-serif text-2xl font-semibold text-foreground">Highlights de tus sesiones</h2>
              <p className="mb-4 text-sm text-muted-foreground">Lo que merece la pena recordar de cada sesión, revisado por tu psicóloga.</p>
              <ShowMoreList className="flex flex-col gap-4">
                {highlights.map((h) => (
                  <li key={h.appointment_id} className="rounded-2xl border border-border bg-card p-4">
                    <p className="mb-3 text-sm font-medium text-muted-foreground">{formatDayTitle(h.starts_at)}</p>
                    <HighlightsView text={h.content} />
                  </li>
                ))}
              </ShowMoreList>
            </section>
          )}
        </TabsContent>

        <TabsContent value="documentos" className="flex flex-col gap-10">
          <section className="flex flex-col">
            <h2 className="mb-4 font-serif text-2xl font-semibold text-foreground">Documentos</h2>
            <ConsentCard overview={consent} canSign />
          </section>
          <section className="flex flex-col">
            <h2 className="mb-4 font-serif text-2xl font-semibold text-foreground">Mis facturas</h2>
            {invoices.length === 0 ? (
              <p className="text-muted-foreground">Todavía no tienes facturas.</p>
            ) : (
              <ShowMoreList className="divide-y divide-border rounded-2xl border border-border bg-card">
                {invoices.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{inv.code}</p>
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(`${inv.issue_date}T12:00:00`), "d/M/yyyy")} · {inv.description}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-medium text-foreground">{euros(inv.total_cents)}</span>
                      <Button size="sm" variant="outline" onClick={() => openInvoice(inv)}
                        aria-label={`Descargar factura ${inv.code}`}>
                        <Download className="size-4" />
                        Descargar
                      </Button>
                    </div>
                  </li>
                ))}
              </ShowMoreList>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </AreaLayout>
  );
}

export default function MiArea() {
  return (
    <RequireRole role="patient">
      <MisCitas />
    </RequireRole>
  );
}
