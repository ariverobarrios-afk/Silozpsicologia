import { useEffect } from "react";
import { Link } from "wouter";
import { Home, BookOpen, FileText, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export default function Gracias() {
  useEffect(() => {
    // Actualizar meta tags
    document.title = "¡Gracias! | Siloz Psicología";
    
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute("content", "Gracias por contactar con Siloz Psicología. Hemos recibido tu mensaje y nos pondremos en contacto contigo lo antes posible.");
    }

    // Scroll to top
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="pt-24 pb-16">
        <div className="container max-w-3xl">
          {/* Contenido principal */}
          <div className="text-center py-12 px-6 bg-card rounded-3xl border border-border shadow-sm">
            {/* Icono de confirmación */}
            <div className="mb-6 flex justify-center">
              <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center">
                <CheckCircle size={48} className="text-primary" />
              </div>
            </div>
            
            {/* Título */}
            <h1 className="font-serif text-3xl md:text-4xl font-bold text-foreground mb-4">
              ¡Gracias por contactarnos!
            </h1>
            
            {/* Mensaje */}
            <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-4">
              Hemos recibido tu mensaje correctamente.
            </p>
            <p className="text-muted-foreground max-w-xl mx-auto mb-8">
              Nos pondremos en contacto contigo <strong>lo antes posible</strong> para concretar los detalles de tu sesión de valoración inicial. Normalmente respondemos en menos de 24 horas.
            </p>

            {/* Separador decorativo */}
            <div className="flex items-center justify-center gap-4 mb-8">
              <div className="h-px w-16 bg-border"></div>
              <span className="text-2xl">🌿</span>
              <div className="h-px w-16 bg-border"></div>
            </div>

            {/* Mensaje adicional */}
            <p className="text-sm text-muted-foreground mb-8">
              Mientras tanto, te invitamos a explorar nuestro contenido:
            </p>

            {/* Botones de navegación */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/">
                <Button 
                  variant="outline" 
                  className="w-full sm:w-auto px-6 py-3 rounded-full border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-all"
                >
                  <Home size={18} className="mr-2" />
                  Volver al inicio
                </Button>
              </Link>
              
              <Link href="/blog">
                <Button 
                  className="w-full sm:w-auto px-6 py-3 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  <BookOpen size={18} className="mr-2" />
                  Leer el Blog
                </Button>
              </Link>
              
              <Link href="/recursos">
                <Button 
                  variant="outline"
                  className="w-full sm:w-auto px-6 py-3 rounded-full border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-all"
                >
                  <FileText size={18} className="mr-2" />
                  Ver Recursos
                </Button>
              </Link>
            </div>
          </div>

          {/* Información de contacto alternativa */}
          <div className="mt-8 text-center">
            <p className="text-sm text-muted-foreground">
              ¿Tienes alguna pregunta urgente? Escríbenos a{" "}
              <a 
                href="mailto:silozpsicologia@gmail.com" 
                className="text-primary hover:underline"
              >
                silozpsicologia@gmail.com
              </a>
            </p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
