import { useState, type FormEvent } from "react";
import { Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { AreaLayout, FullPageSpinner, NotConfigured, homeFor } from "./AreaLayout";

export default function Acceso() {
  const { session, profile, loading } = useAuth();
  const [mode, setMode] = useState<"login" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (!supabaseConfigured || !supabase) return <NotConfigured />;
  if (loading) return <FullPageSpinner />;
  if (session) return <Redirect to={homeFor(profile?.role)} />;

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase!.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError("Email o contraseña incorrectos.");
  };

  const onReset = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    await supabase!.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/acceso/nueva-contrasena`,
    });
    setBusy(false);
    // Mismo mensaje exista o no la cuenta, para no revelar quién es paciente.
    setInfo("Si el email corresponde a una cuenta, recibirás un enlace para crear una nueva contraseña.");
  };

  return (
    <AreaLayout title="Área privada">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>{mode === "login" ? "Inicia sesión" : "Recuperar contraseña"}</CardTitle>
          <CardDescription>
            {mode === "login"
              ? "Acceso para pacientes de Siloz Psicología."
              : "Te enviaremos un enlace para crear una nueva contraseña."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={mode === "login" ? onLogin : onReset} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} />
            </div>
            {mode === "login" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input id="password" type="password" autoComplete="current-password" required
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            {info && <p className="text-sm text-muted-foreground">{info}</p>}
            <Button type="submit" disabled={busy} className="rounded-full">
              {mode === "login" ? "Entrar" : "Enviar enlace"}
            </Button>
            <button type="button"
              onClick={() => { setMode(mode === "login" ? "reset" : "login"); setError(null); setInfo(null); }}
              className="text-sm text-muted-foreground underline-offset-4 hover:text-primary hover:underline">
              {mode === "login" ? "¿Has olvidado tu contraseña?" : "Volver a iniciar sesión"}
            </button>
          </form>
        </CardContent>
      </Card>
    </AreaLayout>
  );
}
