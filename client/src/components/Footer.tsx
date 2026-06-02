import { Mail, Phone } from "lucide-react";
import { Link } from "wouter";

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-secondary/30 border-t border-border mt-20">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Brand */}
          <div>
            <h3 className="font-serif text-2xl font-semibold mb-3 text-primary">
              Siloz Psicología
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Psicología Online Integradora. Un espacio seguro para tu bienestar emocional.
            </p>
          </div>

          {/* Enlaces rápidos */}
          <div>
            <h4 className="font-serif text-lg font-semibold mb-4">Enlaces rápidos</h4>
            <ul className="space-y-2">
              <li>
                <button
                  onClick={() => document.getElementById("inicio")?.scrollIntoView({ behavior: "smooth" })}
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  Inicio
                </button>
              </li>
              <li>
                <button
                  onClick={() => document.getElementById("sobre-mi")?.scrollIntoView({ behavior: "smooth" })}
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  Sobre mí
                </button>
              </li>
              <li>
                <button
                  onClick={() => document.getElementById("tarifas")?.scrollIntoView({ behavior: "smooth" })}
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  Tarifas
                </button>
              </li>
              <li>
                <button
                  onClick={() => document.getElementById("contacto")?.scrollIntoView({ behavior: "smooth" })}
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  Contacto
                </button>
              </li>
            </ul>
          </div>

          {/* Contenido */}
          <div>
            <h4 className="font-serif text-lg font-semibold mb-4">Contenido</h4>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/blog"
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  Blog
                </Link>
              </li>
              <li>
                <Link
                  href="/recursos"
                  className="text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  Recursos
                </Link>
              </li>
            </ul>
          </div>

          {/* Contacto */}
          <div>
            <h4 className="font-serif text-lg font-semibold mb-4">Contacto</h4>
            <ul className="space-y-3">
              <li className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail size={16} className="text-primary" />
                <span>silozpsicologia@gmail.com</span>
              </li>
              <li className="flex items-center gap-2 text-sm text-muted-foreground">
                <Phone size={16} className="text-primary" />
                <a href="tel:+34620450696" className="hover:text-primary transition-colors">
                  620 450 696
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-border mt-8 pt-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-sm text-muted-foreground">
              © {currentYear} Siloz Psicología. Todos los derechos reservados.
            </p>
            <div className="flex gap-4">
              <Link 
                href="/aviso-legal"
                className="text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                Aviso Legal y Privacidad
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
