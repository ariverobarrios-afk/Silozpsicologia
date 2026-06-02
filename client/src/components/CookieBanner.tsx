import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { saveCookieConsent, getCookieConsent, initializeWithConsent } from "@/lib/cookieConsent";
import { AnalyticsEvents } from "@/lib/analytics";

export default function CookieBanner() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Verificar si ya hay consentimiento
    const consent = getCookieConsent();
    
    if (!consent) {
      // No hay consentimiento, mostrar banner
      setIsVisible(true);
    } else {
      // Ya hay consentimiento, inicializar scripts si es necesario
      initializeWithConsent();
    }
  }, []);

  const handleAccept = () => {
    saveCookieConsent("accepted");
    setIsVisible(false);
    // Enviar evento a analytics (solo si ya está cargado)
    AnalyticsEvents.acceptCookies();
  };

  const handleReject = () => {
    saveCookieConsent("rejected");
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border shadow-2xl animate-in slide-in-from-bottom duration-500">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex-1">
            <h3 className="font-serif text-lg font-semibold mb-2">
              🍪 Uso de cookies
            </h3>
            <p className="text-sm text-muted-foreground mb-2">
              Utilizamos cookies técnicas (necesarias para el funcionamiento del sitio) y cookies de análisis y publicidad de Google Ads para mejorar tu experiencia y medir la efectividad de nuestros servicios.
            </p>
            <p className="text-sm text-muted-foreground">
              Al hacer clic en "Aceptar", consientes el uso de todas las cookies. Si haces clic en "Rechazar", solo se usarán las cookies técnicas necesarias.{" "}
              <Link href="/aviso-legal" className="text-primary hover:underline font-medium">
                Leer política de privacidad y cookies
              </Link>
            </p>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <Button
              onClick={handleReject}
              variant="outline"
              className="flex-1 md:flex-none"
            >
              Solo esenciales
            </Button>
            <Button
              onClick={handleAccept}
              className="flex-1 md:flex-none bg-primary hover:bg-primary/90"
            >
              Aceptar todas
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
