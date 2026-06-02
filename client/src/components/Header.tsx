import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnalyticsEvents } from "@/lib/analytics";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ContactForm from "@/components/ContactForm";

export default function Header() {
  const [location, setLocation] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);

  const scrollToSection = (sectionId: string) => {
    // Enviar evento de navegación a analytics
    if (sectionId === 'contacto') {
      AnalyticsEvents.clickCTA();
    } else {
      AnalyticsEvents.navigateToSection(sectionId);
    }
    
    // Si no estamos en la página principal, navegar primero
    if (location !== "/") {
      setLocation("/");
      // Esperar a que la navegación se complete antes de hacer scroll
      setTimeout(() => {
        const element = document.getElementById(sectionId);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 100);
    } else {
      const element = document.getElementById(sectionId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
    setMobileMenuOpen(false);
  };

  const navigateToPage = (path: string) => {
    AnalyticsEvents.navigateToSection(path.replace('/', ''));
    setLocation(path);
    setMobileMenuOpen(false);
  };

  // Items que hacen scroll en la página principal
  const scrollItems = [
    { id: "inicio", label: "INICIO" },
    { id: "sobre-mi", label: "SOBRE MÍ" },
    { id: "preguntas-frecuentes", label: "PREGUNTAS FRECUENTES" },
    { id: "tarifas", label: "TARIFAS" },
  ];

  // Items que navegan a páginas nuevas
  const pageItems = [
    { path: "/blog", label: "BLOG" },
    { path: "/recursos", label: "RECURSOS" },
  ];

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border">
      <div className="container">
        <div className="grid grid-cols-3 items-center h-16">
          {/* Menu Hamburguesa - Columna izquierda */}
          <div className="flex justify-start">
            <button
              onClick={() => {
                setMobileMenuOpen(!mobileMenuOpen);
                if (!mobileMenuOpen) {
                  AnalyticsEvents.openMenu();
                }
              }}
              className="p-2 text-foreground hover:text-primary transition-colors"
              aria-label="Menú"
            >
              {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>

          {/* Botón CTA Central - Columna central */}
          <div className="flex justify-center">
            <Button
              onClick={() => {
                setContactDialogOpen(true);
                AnalyticsEvents.clickCTA();
              }}
              className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium px-6 py-2 rounded-full shadow-md hover:shadow-lg transition-all"
            >
              Solicita tu cita
            </Button>
          </div>

          {/* Logo - Columna derecha */}
          <div className="flex justify-end">
            <button
              onClick={() => scrollToSection("inicio")}
              className="flex items-center gap-2 text-foreground hover:text-primary transition-colors"
            >
            <svg
              className="w-8 h-8"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"
                fill="currentColor"
                opacity="0.3"
              />
              <path
                d="M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z"
                fill="currentColor"
              />
            </svg>
            <span className="font-serif text-xl font-semibold hidden sm:inline">Siloz Psicología</span>
          </button>
          </div>
        </div>

        {/* Menú Desplegable */}
        {mobileMenuOpen && (
          <nav className="py-4 border-t border-border animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex flex-col gap-3">
              {/* Items que hacen scroll */}
              {scrollItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => scrollToSection(item.id)}
                  className="text-left px-4 py-3 text-sm font-medium text-foreground/70 hover:text-primary hover:bg-accent/50 rounded-lg transition-colors"
                >
                  {item.label}
                </button>
              ))}
              
              {/* Separador */}
              <div className="border-t border-border my-2" />
              
              {/* Items que navegan a páginas */}
              {pageItems.map((item) => (
                <button
                  key={item.path}
                  onClick={() => navigateToPage(item.path)}
                  className="text-left px-4 py-3 text-sm font-medium text-foreground/70 hover:text-primary hover:bg-accent/50 rounded-lg transition-colors"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </nav>
        )}
      </div>

      {/* Diálogo de contacto */}
      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Solicita tu sesión de valoración inicial</DialogTitle>
            <DialogDescription>
              Rellena el formulario y te responderé lo antes posible para iniciar el proceso terapéutico.
            </DialogDescription>
          </DialogHeader>
          <ContactForm formLocation="header" />
        </DialogContent>
      </Dialog>
    </header>
  );
}
