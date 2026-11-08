import { Route, Switch } from "wouter";
import { AuthProvider } from "@/contexts/AuthContext";
import NotFound from "@/pages/NotFound";
import Acceso from "./Acceso";
import NuevaContrasena from "./NuevaContrasena";
import Panel from "./Panel";
import MiArea from "./MiArea";
import Consentimiento from "./Consentimiento";
import Sesion from "./Sesion";
import { useAreaManifest, useNoIndex } from "./AreaLayout";

// Se carga bajo demanda desde App.tsx: así Supabase y el área privada no
// pesan en la web pública.
export default function AreaRoutes() {
  useNoIndex();
  useAreaManifest();
  return (
    <AuthProvider>
      <Switch>
        <Route path="/acceso" component={Acceso} />
        <Route path="/acceso/nueva-contrasena" component={NuevaContrasena} />
        <Route path="/panel" component={Panel} />
        <Route path="/panel/sesion/:id" component={Sesion} />
        <Route path="/mi-area" component={MiArea} />
        <Route path="/mi-area/consentimiento" component={Consentimiento} />
        <Route component={NotFound} />
      </Switch>
    </AuthProvider>
  );
}
