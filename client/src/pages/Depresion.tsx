import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check, Heart, Clock, Shield, Home } from "lucide-react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { AnalyticsEvents } from "@/lib/analytics";
import { sendContact } from "@/lib/sendContact";

export default function Depresion() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    message: "Me gustaría solicitar información sobre terapia para la depresión.",
  });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    
    // Enviar evento de visita a landing page
    AnalyticsEvents.visitLandingPage('depresion');
    
    // Actualizar meta tags para SEO y Google Ads
    document.title = "Terapia Online para Depresión | Primera Sesión Gratuita";
    
    // Meta description
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
       metaDescription.setAttribute('content', 'Terapia psicológica online para la depresión. Sesión de valoración inicial disponible. Psióloga especializada en tratamiento de depresión. Reserva tu sesión hoy.');
    }
    
    // Open Graph tags
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) {
      ogTitle.setAttribute('content', 'Terapia Online para Depresión | Sesión de Valoración Inicial');
    }
    
    const ogDescription = document.querySelector('meta[property="og:description"]');
    if (ogDescription) {
       ogDescription.setAttribute('content', 'Terapia psicológica online para la depresión. Proceso terapéutico profesional. Psióloga especializada en tratamiento de depresión.');
    }
  }, []);

  const [, setLocationPath] = useLocation();
  
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await sendContact({
        name: formData.name,
        email: formData.email,
        phone: formData.phone || undefined,
        message: formData.message,
        sessionType: "depresion",
      });
      AnalyticsEvents.submitContactForm("depresion");
      setLocationPath("/gracias");
    } catch (error) {
      toast.error("Error al enviar el mensaje", {
        description:
          error instanceof Error ? error.message : "Inténtalo de nuevo o escríbeme directamente.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Back to Home Button */}
      <div className="container py-4">
        <Link href="/">
          <Button variant="outline" className="gap-2">
            <Home className="h-4 w-4" />
            Volver al inicio
          </Button>
        </Link>
      </div>
      
      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-primary/10 via-background to-primary/5 py-20 md:py-32">
        <div className="container">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-4xl md:text-6xl font-bold text-foreground mb-6">
              Depresión - Terapia Online
            </h1>
            <p className="text-xl md:text-2xl text-foreground/70 mb-8">
              Recupera la ilusión y la energía. Terapia especializada en depresión desde la comodidad de tu hogar.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Button
                size="lg"
                className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-6 text-lg rounded-full shadow-lg hover:shadow-xl transition-all"
                onClick={() => {
                  const form = document.getElementById("contact-form");
                  form?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                Reserva tu sesión de valoración
              </Button>
              <p className="text-sm text-foreground/60">
                ✓ Sesión inicial para valorar el mejor enfoque terapéutico
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Síntomas Section */}
      <section className="py-16 md:py-24 bg-background">
        <div className="container">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">
              ¿Te sientes identificado con estos síntomas?
            </h2>
            <div className="grid md:grid-cols-2 gap-6">
              {[
                "Tristeza profunda o sensación de vacío constante",
                "Pérdida de interés en actividades que antes disfrutabas",
                "Falta de energía y cansancio permanente",
                "Dificultad para concentrarte o tomar decisiones",
                "Cambios en el apetito o en el peso",
                "Problemas para dormir o dormir demasiado",
                "Sentimientos de culpa o inutilidad",
                "Pensamientos negativos recurrentes sobre ti mismo",
              ].map((symptom, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 p-4 bg-accent/30 rounded-lg hover:bg-accent/50 transition-colors"
                >
                  <Check className="w-6 h-6 text-primary flex-shrink-0 mt-1" />
                  <p className="text-foreground/80">{symptom}</p>
                </div>
              ))}
            </div>
            <p className="text-center mt-8 text-lg text-foreground/70">
              Si has experimentado varios de estos síntomas durante más de dos semanas, <strong>es momento de pedir ayuda</strong>. La depresión es tratable.
            </p>
          </div>
        </div>
      </section>

      {/* Cómo puedo ayudarte Section */}
      <section className="py-16 md:py-24 bg-accent/20">
        <div className="container">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">
              Cómo puedo ayudarte a superar la depresión
            </h2>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Heart className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-3">Terapia Integradora</h3>
                <p className="text-foreground/70">
                  Combino diferentes enfoques terapéuticos adaptados a tus necesidades específicas para resultados efectivos.
                </p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Clock className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-3">Proceso Gradual</h3>
                <p className="text-foreground/70">
                  Trabajamos a tu ritmo, con objetivos alcanzables que te permitan recuperar la motivación paso a paso.
                </p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Shield className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-3">Espacio Seguro</h3>
                <p className="text-foreground/70">
                  Un entorno de confianza, sin juicios, donde puedes expresarte libremente y trabajar a tu ritmo.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Proceso Section */}
      <section className="py-16 md:py-24 bg-background">
        <div className="container">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">
              Proceso de Terapia para la Depresión
            </h2>
            <div className="space-y-8">
              <div className="flex gap-6 items-start">
                <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-xl flex-shrink-0">
                  1
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">Sesión de valoración inicial</h3>
                  <p className="text-foreground/70">
                    Conoceremos tu situación actual, cómo te sientes y qué te ha traído hasta aquí. Un espacio para entender tu punto de partida.
                  </p>
                </div>
              </div>
              <div className="flex gap-6 items-start">
                <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-xl flex-shrink-0">
                  2
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">Evaluación y Plan Personalizado</h3>
                  <p className="text-foreground/70">
                    Identificamos las causas de tu depresión y diseñamos un plan de tratamiento adaptado a ti.
                  </p>
                </div>
              </div>
              <div className="flex gap-6 items-start">
                <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-xl flex-shrink-0">
                  3
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">Intervención Terapéutica</h3>
                  <p className="text-foreground/70">
                    Trabajamos juntos con técnicas probadas: activación conductual, reestructuración cognitiva, gestión emocional y más.
                  </p>
                </div>
              </div>
              <div className="flex gap-6 items-start">
                <div className="w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-xl flex-shrink-0">
                  4
                </div>
                <div>
                  <h3 className="text-xl font-semibold mb-2">Seguimiento y Prevención</h3>
                  <p className="text-foreground/70">
                    Te acompaño en el proceso hasta que recuperes tu bienestar y te doy herramientas para prevenir recaídas.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonial Section */}
      <section className="py-16 md:py-24 bg-accent/20">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <blockquote className="text-xl md:text-2xl italic text-foreground/80 mb-6">
              "Llevaba meses sin encontrar sentido a nada. Gracias a la terapia con Silvia, he vuelto a sentir ilusión por las cosas pequeñas de la vida. El cambio ha sido gradual pero real."
            </blockquote>
            <p className="text-foreground/60">— A.R., paciente de terapia online</p>
          </div>
        </div>
      </section>

      {/* CTA + Form Section */}
      <section id="contact-form" className="py-16 md:py-24 bg-background">
        <div className="container">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                Da el primer paso hacia tu bienestar
              </h2>
              <p className="text-xl text-foreground/70">
                Solicita tu sesión de valoración inicial y comienza un proceso terapéutico profesional.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="bg-card border border-border rounded-2xl p-8 shadow-lg">
              <div className="space-y-6">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium mb-2">
                    Nombre completo *
                  </label>
                  <input
                    type="text"
                    id="name"
                    name="name"
                    required
                    value={formData.name}
                    onChange={handleChange}
                    className="w-full px-4 py-3 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Tu nombre"
                  />
                </div>

                <div>
                  <label htmlFor="email" className="block text-sm font-medium mb-2">
                    Email *
                  </label>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                    className="w-full px-4 py-3 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="tu@email.com"
                  />
                </div>

                <div>
                  <label htmlFor="phone" className="block text-sm font-medium mb-2">
                    Teléfono (opcional)
                  </label>
                  <input
                    type="tel"
                    id="phone"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    className="w-full px-4 py-3 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="+34 600 000 000"
                  />
                </div>

                <div>
                  <label htmlFor="message" className="block text-sm font-medium mb-2">
                    Mensaje (opcional)
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    rows={4}
                    value={formData.message}
                    onChange={handleChange}
                    className="w-full px-4 py-3 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                    placeholder="Cuéntanos brevemente tu situación..."
                  />
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-6 text-lg rounded-full shadow-lg hover:shadow-xl transition-all"
                >
                  Solicitar sesión de valoración
                </Button>

                <p className="text-sm text-center text-foreground/60">
                  ✓ Respuesta en menos de 24 horas<br />
                  ✓ Proceso terapéutico profesional<br />
                  ✓ 100% online y confidencial
                </p>
              </div>
            </form>
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-12 bg-accent/20">
        <div className="container">
          <div className="max-w-4xl mx-auto">
            <div className="grid md:grid-cols-3 gap-8 text-center">
              <div>
                <p className="text-3xl font-bold text-primary mb-2">+10 años</p>
                <p className="text-foreground/70">de experiencia</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-primary mb-2">100%</p>
                <p className="text-foreground/70">online y confidencial</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-primary mb-2">Valoración</p>
                <p className="text-foreground/70">inicial disponible</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
