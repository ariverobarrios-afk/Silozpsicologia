import { useEffect, type ReactNode } from "react";
import { Link, Redirect } from "wouter";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/contexts/AuthContext";
import { supabaseConfigured, type Role } from "@/lib/supabase";

// Las páginas privadas no deben aparecer en buscadores.
export function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}

export function homeFor(role: Role | undefined): string {
  return role === "admin" ? "/panel" : "/mi-area";
}

export function AreaLayout({ title, children }: { title: string; children: ReactNode }) {
  const { profile, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/95">
        <div className="container flex h-16 items-center justify-between gap-4">
          <Link href="/" className="font-serif text-xl font-semibold text-foreground hover:text-primary">
            Siloz Psicología
          </Link>
          {profile && (
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {profile.full_name || profile.email}
              </span>
              <Button variant="outline" size="sm" onClick={signOut}>
                <LogOut className="size-4" />
                Salir
              </Button>
            </div>
          )}
        </div>
      </header>
      <main className="container py-8 md:py-12">
        <h1 className="mb-8 font-serif text-3xl font-bold text-foreground md:text-4xl">{title}</h1>
        {children}
      </main>
    </div>
  );
}

export function NotConfigured() {
  return (
    <AreaLayout title="Área privada">
      <p className="text-muted-foreground">
        El área privada todavía no está configurada. Vuelve a intentarlo más adelante.
      </p>
    </AreaLayout>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Spinner className="size-8 text-primary" />
    </div>
  );
}

// Protege una página: sin sesión → /acceso; rol equivocado → su propia área.
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { session, profile, loading } = useAuth();
  if (!supabaseConfigured) return <NotConfigured />;
  if (loading) return <FullPageSpinner />;
  if (!session) return <Redirect to="/acceso" />;
  if (!profile) {
    return (
      <AreaLayout title="Área privada">
        <p className="text-muted-foreground">
          Tu cuenta no tiene un perfil asociado. Contacta con la consulta.
        </p>
      </AreaLayout>
    );
  }
  if (profile.role !== role) return <Redirect to={homeFor(profile.role)} />;
  if (!profile.active) {
    return (
      <AreaLayout title="Área privada">
        <p className="text-muted-foreground">
          Tu acceso está desactivado. Si crees que es un error, contacta con la consulta.
        </p>
      </AreaLayout>
    );
  }
  return <>{children}</>;
}
