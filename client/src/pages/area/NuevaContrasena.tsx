import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { AreaLayout, FullPageSpinner, NotConfigured, homeFor } from "./AreaLayout";

// Destino de los enlaces de invitación y de recuperación de contraseña.
// Supabase inicia la sesión con el token del enlace; aquí solo se elige la clave.
export default function NuevaContrasena() {
  const { session, profile, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!supabaseConfigured || !supabase) return <NotConfigured />;
  if (loading) return <FullPageSpinner />;

  if (!session) {
    return (
      <AreaLayout title="Crear contraseña">
        <p className="mb-4 text-muted-foreground">
          El enlace no es válido o ha caducado. Puedes pedir uno nuevo desde la página de acceso.
        </p>
        <Link href="/acceso" className="text-primary underline-offset-4 hover:underline">
          Ir al acceso
        </Link>
      </AreaLayout>
    );
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");
    if (password !== repeat) return setError("Las contraseñas no coinciden.");
    setBusy(true);
    const { error } = await supabase!.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError("No se pudo guardar la contraseña. Inténtalo de nuevo.");
    setLocation(homeFor(profile?.role));
  };

  return (
    <AreaLayout title="Crear contraseña">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>Elige tu contraseña</CardTitle>
          <CardDescription>{session.user.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Nueva contraseña</Label>
              <Input id="password" type="password" autoComplete="new-password" required minLength={8}
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="repeat">Repite la contraseña</Label>
              <Input id="repeat" type="password" autoComplete="new-password" required minLength={8}
                value={repeat} onChange={(e) => setRepeat(e.target.value)} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy} className="rounded-full">Guardar y entrar</Button>
          </form>
        </CardContent>
      </Card>
    </AreaLayout>
  );
}
