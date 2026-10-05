import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase, type Appointment, type Bono } from "@/lib/supabase";
import { BONO, bonoRemaining } from "@/lib/tariffs";
import { AppointmentItem } from "./AppointmentItem";
import { AreaLayout, RequireRole } from "./AreaLayout";

function MisCitas() {
  const { profile } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [bonos, setBonos] = useState<Bono[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
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
    supabase
      .from("bonos")
      .select("*")
      .eq("patient_id", profile.id)
      .order("created_at")
      .then(({ data }) => setBonos((data as Bono[]) ?? []));
  }, [profile]);

  const now = Date.now();
  const upcoming = (appointments ?? []).filter(
    (a) => new Date(a.starts_at).getTime() >= now && a.status === "programada"
  );
  const past = (appointments ?? [])
    .filter((a) => !upcoming.includes(a))
    .reverse();

  return (
    <AreaLayout title={profile?.full_name ? `Hola, ${profile.full_name.split(" ")[0]}` : "Mi área"}>
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
      {appointments && (
        <div className="grid gap-10 lg:grid-cols-2">
          <section>
            <h2 className="mb-4 font-serif text-2xl font-semibold text-foreground">Próximas citas</h2>
            {upcoming.length === 0 ? (
              <p className="text-muted-foreground">No tienes citas programadas.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {upcoming.map((a) => <AppointmentItem key={a.id} appointment={a} />)}
              </ul>
            )}
          </section>
          <section>
            <h2 className="mb-4 font-serif text-2xl font-semibold text-foreground">Historial</h2>
            {past.length === 0 ? (
              <p className="text-muted-foreground">Aún no hay citas anteriores.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {past.map((a) => <AppointmentItem key={a.id} appointment={a} />)}
              </ul>
            )}
          </section>
        </div>
      )}
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
