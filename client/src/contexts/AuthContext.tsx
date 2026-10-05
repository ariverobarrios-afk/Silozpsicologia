import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type Profile } from "@/lib/supabase";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let cancelled = false;

    const loadProfile = async (s: Session | null) => {
      setSession(s);
      if (!s) {
        setProfile(null);
        setLoading(false);
        return;
      }
      const { data } = await client
        .from("profiles")
        .select("*")
        .eq("id", s.user.id)
        .single();
      if (!cancelled) {
        setProfile((data as Profile | null) ?? null);
        setLoading(false);
      }
    };

    client.auth.getSession().then(({ data }) => loadProfile(data.session));
    const { data: sub } = client.auth.onAuthStateChange((_event, s) => {
      // Diferido: Supabase recomienda no llamar a la API dentro del callback.
      setTimeout(() => loadProfile(s), 0);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase?.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
