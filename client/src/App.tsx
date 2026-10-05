import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { lazy, Suspense } from "react";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import AvisoLegal from "./pages/AvisoLegal";
import Ansiedad from "./pages/Ansiedad";
import Depresion from "./pages/Depresion";
import Blog from "./pages/Blog";
import BlogPost from "./pages/BlogPost";
import Recursos from "./pages/Recursos";
import Gracias from "./pages/Gracias";

// Área privada (pacientes y terapeuta), cargada solo cuando se visita.
const AreaRoutes = lazy(() => import("./pages/area"));
const AREA_PATHS = ["/acceso", "/acceso/nueva-contrasena", "/panel", "/mi-area"];

// Ruta final: el área privada se monta una sola vez para todas sus páginas
// (la sesión no se recarga al navegar entre ellas); lo demás es 404.
function Fallback() {
  const [location] = useLocation();
  if (!AREA_PATHS.includes(location)) return <NotFound />;
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <AreaRoutes />
    </Suspense>
  );
}

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/aviso-legal"} component={AvisoLegal} />
      <Route path={"/ansiedad"} component={Ansiedad} />
      <Route path={"/depresion"} component={Depresion} />
      <Route path={"/blog"} component={Blog} />
      <Route path={"/blog/:slug"} component={BlogPost} />
      <Route path={"/recursos"} component={Recursos} />
      <Route path={"/gracias"} component={Gracias} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route (incluye el área privada) */}
      <Route component={Fallback} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
