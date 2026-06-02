import { useEffect } from "react";
import { Link } from "wouter";
import { FileText, Download, ArrowRight, Loader2 } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { AnalyticsEvents } from "@/lib/analytics";
import { resources as staticResources } from "@/data/content";

// Iconos por tipo de recurso
const typeIcons = {
  pdf: "📄",
  audio: "🎧",
  video: "🎬",
  guide: "📚",
};

const typeLabels = {
  pdf: "PDF",
  audio: "Audio",
  video: "Vídeo",
  guide: "Guía",
};

export default function Recursos() {
  const resources = staticResources;
  const isLoading = false;

  useEffect(() => {
    // Actualizar meta tags para SEO
    document.title = "Recursos | Siloz Psicología - Guías y Herramientas Gratuitas";
    
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute("content", "Descarga guías, ejercicios y recursos gratuitos sobre bienestar emocional, ansiedad, depresión y autoestima. Herramientas prácticas de Silvia López.");
    }

    // Scroll to top
    window.scrollTo(0, 0);
  }, []);

  const handleDownload = (resource: { slug: string; fileUrl: string }) => {
    // Registrar evento de descarga en analytics
    AnalyticsEvents.navigateToSection(`download-${resource.slug}`);
    
    // Abrir el archivo en una nueva pestaña o iniciar descarga
    window.open(resource.fileUrl, '_blank');
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="pt-24 pb-16">
        <div className="container max-w-6xl">
          {/* Encabezado */}
          <div className="text-center mb-12">
            <h1 className="font-serif text-4xl md:text-5xl font-bold text-foreground mb-4">
              Recursos
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Guías, ejercicios y herramientas gratuitas para tu bienestar emocional
            </p>
          </div>

          {/* Loading state */}
          {isLoading && (
            <div className="flex justify-center items-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}

          {/* Lista de recursos */}
          {!isLoading && resources && resources.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-6">
              {resources.map((resource) => (
                <div
                  key={resource.slug}
                  className="group bg-card rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 border border-border hover:border-primary/30 flex flex-col"
                >
                  {/* Imagen o Icono */}
                  <div className="aspect-[3/1] overflow-hidden bg-primary/5 flex items-center justify-center">
                    {resource.imageUrl ? (
                      <img
                        src={resource.imageUrl}
                        alt={resource.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="flex items-center gap-3">
                        <span className="text-5xl">{typeIcons[resource.type]}</span>
                        <FileText size={48} className="text-primary/30" />
                      </div>
                    )}
                  </div>
                  
                  {/* Contenido */}
                  <div className="p-6 flex flex-col flex-grow">
                    {/* Badges */}
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      {resource.category.split(';').map((cat, idx) => (
                        <span key={idx} className="inline-block px-3 py-1 text-xs font-medium bg-primary/10 text-primary rounded-full">
                          {cat.trim()}
                        </span>
                      ))}
                      <span className="inline-block px-3 py-1 text-xs font-medium bg-muted text-muted-foreground rounded-full">
                        {typeLabels[resource.type]}
                      </span>
                    </div>
                    
                    {/* Título */}
                    <h2 className="font-serif text-xl font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">
                      {resource.title}
                    </h2>
                    
                    {/* Descripción */}
                    <p className="text-muted-foreground text-sm mb-4 flex-grow">
                      {resource.description}
                    </p>
                    
                    {/* Botón de descarga */}
                    <Button
                      onClick={() => handleDownload(resource)}
                      className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                    >
                      <Download size={16} className="mr-2" />
                      Descargar {typeLabels[resource.type]}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {/* Estado vacío cuando no hay recursos */}
          {!isLoading && (!resources || resources.length === 0) && (
            <div className="text-center py-16 bg-card rounded-2xl border border-border">
              <div className="text-6xl mb-4">📚</div>
              <h2 className="font-serif text-2xl font-semibold text-foreground mb-2">
                Próximamente
              </h2>
              <p className="text-muted-foreground max-w-md mx-auto mb-6">
                Estamos preparando guías, ejercicios y recursos gratuitos para ayudarte en tu camino hacia el bienestar. ¡Vuelve pronto!
              </p>
              <Link href="/">
                <Button className="bg-primary hover:bg-primary/90">
                  Volver al inicio
                  <ArrowRight size={16} className="ml-2" />
                </Button>
              </Link>
            </div>
          )}

          {/* CTA al final */}
          {resources && resources.length > 0 && (
            <div className="mt-16 p-8 bg-primary/5 rounded-2xl border border-primary/20 text-center">
              <h3 className="font-serif text-2xl font-semibold text-foreground mb-3">
                ¿Necesitas ayuda personalizada?
              </h3>
              <p className="text-muted-foreground mb-6 max-w-lg mx-auto">
                Los recursos son un buen punto de partida, pero si sientes que necesitas 
                apoyo profesional, estoy aquí para ayudarte.
              </p>
              <Link href="/#contacto">
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-3 rounded-full">
                  Solicitar sesión de valoración
                </Button>
              </Link>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
