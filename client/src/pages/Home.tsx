import { useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CookieBanner from "@/components/CookieBanner";
import ContactForm from "@/components/ContactForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Clock, Video, CheckCircle2 } from "lucide-react";
import GoogleReviews from "@/components/GoogleReviews";

export default function Home() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedSessionType, setSelectedSessionType] = useState<"individual" | "familiar">();

  const openContactDialog = (sessionType?: "individual" | "familiar") => {
    setSelectedSessionType(sessionType);
    setDialogOpen(true);
  };

  const specialties = [
    "Ansiedad",
    "Depresión",
    "Dificultades de pareja",
    "Dificultades familiares",
    "Autoestima",
    "Dolor crónico",
    "Gestión emocional",
    "Adicciones",
    "Trauma",
  ];

  const faqs = [
    {
      question: "¿Cómo sé si necesito ir al psicólogo?",
      answer:
        "A veces, esperamos encontrarnos con un poco de malestar para tomar la iniciativa de acudir a terapia, sin embargo, a veces es importante poder detectar las pequeñas señales que el cuerpo y la cabeza nos mandan para poder cuidarnos a nosotros mismos.",
    },
    {
      question: "¿En qué consiste un proceso de terapia?",
      answer:
        "Un proceso de terapia es un acompañamiento profesional, confidencial y personalizado, en el que una persona trabaja junto a un psicólogo para comprender, gestionar y transformar aspectos de su vida que le generan malestar o dificultades.",
    },
    {
      question: "¿Cómo encuentro un psicólogo adecuado para mí?",
      answer:
        "Es importante saber que la formación del profesional es fundamental, para garantizar que pueda abordar tu motivo de consulta, sin embargo, no se trata solo de eso, sino de que te sientas escuchado/a, entendido/a y seguro/a con esa persona.",
    },
    {
      question: "¿La terapia online es para todo el mundo?",
      answer:
        "De forma general, la terapia online es una opción valiosa y eficaz para las personas, sin embargo, no podemos asegurar que vayas a sentirte cómodo en este formato sin probarlo antes. Por ello, la sesión de valoración inicial está pensada para que puedas conocer el espacio terapéutico y tomar una decisión informada.",
    },
    {
      question: "¿Y si ya he ido a terapia antes y no funcionó?",
      answer:
        "Esta es una de las dudas que más me he encontrado a lo largo de mi recorrido, y es lógico dudar desde la experiencia, o incluso desde el escepticismo inicial. Cada proceso es distinto, y cada vínculo también; si algo no funcionó en el pasado, no significa que no pueda funcionar ahora, podemos hablar de lo que necesitas, de lo que no te gustó, y crear un espacio más ajustado a ti.",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <CookieBanner />

      {/* Hero Section */}
      <section
        id="inicio"
        className="pt-28 pb-20 px-4"
        style={{
          background: "linear-gradient(135deg, oklch(0.97 0.01 75) 0%, oklch(0.92 0.015 75) 100%)",
        }}
      >
        <div className="container mx-auto">
          <div className="grid md:grid-cols-2 gap-10 md:gap-16 items-center max-w-5xl mx-auto">
            {/* Left column: text content */}
            <div className="flex flex-col items-center md:items-start text-center md:text-left">
              <h1 className="font-serif text-4xl md:text-5xl font-bold text-foreground mb-5 leading-tight">
                Terapia psicológica online
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground mb-8 font-light leading-relaxed">
                Para trabajar ansiedad, autoestima y relaciones desde un enfoque terapéutico profundo y personalizado.
              </p>
              <Button
                onClick={() => openContactDialog()}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium px-10 py-6 text-lg rounded-full shadow-lg hover:shadow-xl transition-all mb-3"
              >
                Reserva tu sesión de valoración
              </Button>
              <p className="text-sm text-muted-foreground/70 mb-8">
                Sesión inicial para comprender tu situación y valorar el mejor enfoque terapéutico.
              </p>
              {/* Trust indicators */}
              <div className="flex flex-col sm:flex-row flex-wrap items-center md:items-start gap-3 sm:gap-5">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground/70">
                  <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
                  Psicóloga colegiada
                </span>
                <span className="flex items-center gap-2 text-sm font-medium text-foreground/70">
                  <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
                  Sesiones online confidenciales
                </span>
                <span className="flex items-center gap-2 text-sm font-medium text-foreground/70">
                  <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
                  Enfoque terapéutico personalizado
                </span>
              </div>
            </div>

            {/* Right column: Silvia's photo */}
            <div className="flex justify-center md:justify-end order-first md:order-last">
              <div className="w-72 h-80 md:w-80 md:h-96">
                <img
                  src="/images/silvia-lopez.jpg"
                  alt="Silvia López - Psicóloga General Sanitaria"
                  className="w-full h-full object-cover object-top rounded-3xl shadow-xl"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Conócenos Section */}
      <section className="py-20 px-4 bg-background">
        <div className="container mx-auto">
          <div className="max-w-5xl mx-auto">
            <div className="grid md:grid-cols-2 gap-12 items-center">
              <div className="flex justify-center">
                <div className="w-32 h-32 rounded-full bg-primary/10 flex items-center justify-center">
                  <svg className="w-20 h-20 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M12 6v6l4 2" strokeLinecap="round" strokeLinejoin="round"/>
                    <circle cx="12" cy="12" r="2" fill="currentColor"/>
                  </svg>
                </div>
              </div>
              <div>
                <h2 className="font-serif text-4xl font-bold mb-6 text-primary">Conócenos</h2>
                <p className="text-lg text-foreground/80 leading-relaxed mb-8">
                  En Siloz Psicología encontrarás un espacio de escucha, sin prejuicios ni
                  expectativas, donde trabajar las dificultades emocionales, superar los desafíos y
                  conseguir desde el autoconocimiento de acuerdo a tus necesidades.
                </p>
                <div className="bg-secondary/50 p-6 rounded-3xl">
                  <p className="text-lg font-medium mb-4">¿Listo para dar el primer paso?</p>
                  <Button
                    onClick={() => openContactDialog()}
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-6 text-lg rounded-full shadow-lg hover:shadow-xl transition-all"
                  >
                  Reserva tu sesión de valoración
                </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Sobre Mí Section */}
      <section
        id="sobre-mi"
        className="py-20 px-4"
        style={{
          background: "linear-gradient(180deg, oklch(0.92 0.015 75) 0%, oklch(0.97 0.01 75) 100%)",
        }}
      >
        <div className="container mx-auto">
          <div className="max-w-5xl mx-auto">
            <h2 className="font-serif text-4xl md:text-5xl font-bold text-center mb-4 text-primary">
              ¿Cómo es la terapia conmigo?
            </h2>
            <div className="max-w-2xl mt-12">
              <div>
                <p className="text-lg text-foreground/80 leading-relaxed mb-6">
                  Soy Silvia, psicóloga general sanitaria. Acompaño a personas que atraviesan momentos de ansiedad, tristeza o bloqueo emocional a comprender lo que les ocurre y encontrar nuevas formas de relacionarse con sus emociones.
                </p>
                <p className="text-lg text-foreground/80 leading-relaxed mb-8">
                  Un espacio real, sin filtros ni expectativas, donde puedas bajar la guardia. No vengo a “arreglarte”, sino a acompañarte a entender lo que hoy duele y lo que pide ser escuchado.
                </p>
                <Button
                  onClick={() => openContactDialog()}
                  variant="outline"
                  className="border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground font-medium px-8 py-6 rounded-full transition-all"
                >
                  Conoce más sobre mí
                </Button>
              </div>
            </div>

            <div className="mt-16 p-8 bg-background/80 backdrop-blur rounded-3xl shadow-lg">
              <p className="text-lg text-center text-foreground/80 leading-relaxed">
                Mi mirada terapéutica está especialmente orientada a entender más allá del síntoma:
                quiero ayudarte a identificar qué hay detrás de eso que te incomoda, angustia o
                bloquea, para que podamos trabajarlo desde la raíz y no solo desde la urgencia.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Especialidades Section */}
      <section className="py-20 px-4 bg-background">
        <div className="container mx-auto">
          <div className="max-w-5xl mx-auto text-center">
            <h2 className="font-serif text-4xl font-bold mb-12 text-primary">
              ¿En qué puedo acompañarte?
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {specialties.map((specialty, index) => (
                <div
                  key={index}
                  className="bg-card border border-border rounded-2xl p-6"
                >
                  <p className="text-base font-medium text-foreground">{specialty}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Cómo funciona Section */}
      <section
        className="py-20 px-4"
        style={{
          background: "linear-gradient(180deg, oklch(0.97 0.01 75) 0%, oklch(0.92 0.015 75) 100%)",
        }}
      >
        <div className="container mx-auto">
          <div className="max-w-4xl mx-auto">
            <h2 className="font-serif text-4xl font-bold text-center mb-16 text-primary">
              Cómo funciona el proceso terapéutico
            </h2>
            <div className="space-y-8">
              <Card className="border-2 border-primary/20 shadow-lg">
                <CardContent className="p-8">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-xl">
                      1
                    </div>
                    <div>
                      <h3 className="font-serif text-xl font-semibold mb-2">Sesión de valoración inicial</h3>
                      <p className="text-foreground/70">
                        Comprendemos tu situación, tu historia personal y los aspectos que te gustaría trabajar.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-2 border-primary/20 shadow-lg">
                <CardContent className="p-8">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-xl">
                      2
                    </div>
                    <div>
                      <h3 className="font-serif text-xl font-semibold mb-2">
                        Evaluación terapéutica
                      </h3>
                      <p className="text-foreground/70">
                        Exploramos patrones emocionales, relacionales y personales que están influyendo en tu bienestar.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-2 border-primary/20 shadow-lg">
                <CardContent className="p-8">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-12 h-12 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-xl">
                      3
                    </div>
                    <div>
                      <h3 className="font-serif text-xl font-semibold mb-2">
                        Proceso de intervención
                      </h3>
                      <p className="text-foreground/70">
                        Iniciamos el trabajo terapéutico orientado a generar cambios sostenidos en tu vida.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Preguntas Frecuentes Section */}
      <section id="preguntas-frecuentes" className="py-20 px-4 bg-background">
        <div className="container mx-auto">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-12">
              <div className="flex justify-center mb-6">
                <div className="w-20 h-20 bg-accent/20 rounded-full flex items-center justify-center">
                  <span className="text-4xl">❓</span>
                </div>
              </div>
              <h2 className="font-serif text-4xl font-bold mb-6 text-primary">
                Preguntas Frecuentes
              </h2>
              <p className="text-lg text-foreground/70 mb-8">
                Las dudas antes de iniciar un proceso de terapia son normales, estamos buscando a
                una persona adecuada pero tenemos miedo a no sentirnos cómodos o seguros en este
                espacio. Aquí respondemos algunas de las preguntas más frecuentes durante la
                búsqueda.
              </p>
              <div className="bg-secondary/50 p-6 rounded-3xl mb-8">
                <p className="text-base font-medium mb-4">
                  Si tienes más preguntas ¡no dudes en escribirnos para ponernos en contacto contigo
                  y resolverlas juntos!
                </p>
                <Button
                  onClick={() => openContactDialog()}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium px-8 py-4 rounded-full"
                >
                  Rellenar el formulario
                </Button>
              </div>
            </div>

            <Accordion type="single" collapsible className="space-y-4">
              {faqs.map((faq, index) => (
                <AccordionItem
                  key={index}
                  value={`item-${index}`}
                  className="bg-card border-2 border-border rounded-2xl px-6 overflow-hidden"
                >
                  <AccordionTrigger className="text-left font-medium text-lg hover:no-underline py-6">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-foreground/70 pb-6 leading-relaxed">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </section>

      {/* Tarifas Section */}
      <section
        id="tarifas"
        className="py-20 px-4"
        style={{
          background: "linear-gradient(180deg, oklch(0.97 0.01 75) 0%, oklch(0.92 0.015 75) 100%)",
        }}
      >
        <div className="container mx-auto">
          <div className="max-w-5xl mx-auto">
            <h2 className="font-serif text-4xl md:text-5xl font-bold text-center mb-4 text-primary">
              Tarifas de la Terapia Online
            </h2>
            <p className="text-xl text-center text-foreground/70 mb-12 italic">
              Tu bienestar también merece un espacio en tu vida
            </p>

            <div className="grid sm:grid-cols-2 gap-8 mt-8 items-stretch">
              {/* Sesión de Valoración Inicial */}
              <Card className="border-2 border-primary/20 shadow-xl hover:shadow-2xl transition-all flex flex-col">
                <CardContent className="p-8 flex flex-col flex-grow">
                  <h3 className="font-serif text-2xl font-bold text-center mb-6 text-primary min-h-[4rem] flex items-center justify-center">
                    Sesión de valoración inicial
                  </h3>
                  <div className="bg-accent/20 rounded-2xl p-6 mb-6">
                    <p className="text-4xl font-bold text-center text-foreground mb-2">
                      25 € <span className="text-xl font-normal">— 60 minutos</span>
                    </p>
                  </div>
                  <div className="space-y-4 mb-8 flex-grow">
                    <p className="text-foreground/70 leading-relaxed">
                      Primera sesión destinada a comprender tu situación, explorar tus dificultades y definir el enfoque terapéutico.
                    </p>
                  </div>
                  <Button
                    onClick={() => openContactDialog("individual")}
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-6 rounded-full"
                  >
                    Reserva tu sesión de valoración
                  </Button>
                </CardContent>
              </Card>

              {/* Sesión de Terapia Individual */}
              <Card className="border-2 border-primary/20 shadow-xl hover:shadow-2xl transition-all flex flex-col">
                <CardContent className="p-8 flex flex-col flex-grow">
                  <h3 className="font-serif text-2xl font-bold text-center mb-6 text-primary min-h-[4rem] flex items-center justify-center">
                    Sesión de terapia individual
                  </h3>
                  <div className="bg-accent/20 rounded-2xl p-6 mb-6">
                    <p className="text-4xl font-bold text-center text-foreground mb-2">
                      55 € <span className="text-xl font-normal">— 60 minutos</span>
                    </p>
                  </div>
                  <div className="space-y-4 mb-8 flex-grow">
                    <p className="text-foreground/70 leading-relaxed">
                      Espacio terapéutico orientado a trabajar en profundidad los aspectos que están afectando a tu bienestar.
                    </p>
                  </div>
                  <Button
                    onClick={() => openContactDialog("individual")}
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-6 rounded-full"
                  >
                    Reserva tu sesión de terapia
                  </Button>
                </CardContent>
              </Card>

              {/* Bono 5 sesiones */}
              <Card className="border-2 border-primary/20 shadow-xl hover:shadow-2xl transition-all flex flex-col">
                <CardContent className="p-8 flex flex-col flex-grow">
                  <h3 className="font-serif text-2xl font-bold text-center mb-6 text-primary min-h-[4rem] flex items-center justify-center">
                    Bono 5 sesiones
                  </h3>
                  <div className="bg-accent/20 rounded-2xl p-6 mb-6">
                    <p className="text-4xl font-bold text-center text-foreground mb-2">
                      250 €
                    </p>
                  </div>
                  <div className="space-y-4 mb-8 flex-grow">
                    <p className="text-foreground/70 leading-relaxed">
                      Pensado para personas que desean comprometerse con un proceso terapéutico continuado y dar seguimiento regular al trabajo terapéutico.
                    </p>
                  </div>
                  <Button
                    onClick={() => openContactDialog("individual")}
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-6 rounded-full"
                  >
                    Reserva tu sesión de valoración
                  </Button>
                </CardContent>
              </Card>

              {/* Terapia de pareja / familiar */}
              <Card className="border-2 border-primary/20 shadow-xl hover:shadow-2xl transition-all flex flex-col">
                <CardContent className="p-8 flex flex-col flex-grow">
                  <h3 className="font-serif text-2xl font-bold text-center mb-6 text-primary min-h-[4rem] flex items-center justify-center">
                    Terapia de pareja / familiar
                  </h3>
                  <div className="bg-accent/20 rounded-2xl p-6 mb-6">
                    <p className="text-4xl font-bold text-center text-foreground mb-2">
                      70 € <span className="text-xl font-normal">— 75 minutos</span>
                    </p>
                  </div>
                  <div className="space-y-4 mb-8 flex-grow">
                    <p className="text-foreground/70 leading-relaxed">
                      Sesiones orientadas a trabajar dinámicas relacionales, mejorar la comunicación y abordar conflictos dentro de la relación o el sistema familiar.
                    </p>
                  </div>
                  <Button
                    onClick={() => openContactDialog("familiar")}
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-6 rounded-full"
                  >
                    Reserva tu sesión de valoración
                  </Button>
                </CardContent>
              </Card>

            </div>
          </div>
        </div>
      </section>

      {/* Google Reviews Section */}
      <GoogleReviews />

      {/* Para quién es este espacio Section */}
      <section
        className="py-20 px-4"
        style={{
          background: "linear-gradient(180deg, oklch(0.97 0.01 75) 0%, oklch(0.92 0.015 75) 100%)",
        }}
      >
        <div className="container mx-auto">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="font-serif text-4xl font-bold mb-8 text-primary">
              ¿Para quién es este espacio terapéutico?
            </h2>
            <div className="bg-background/80 backdrop-blur rounded-3xl shadow-lg p-10">
              <p className="text-lg text-foreground/80 leading-relaxed mb-6">
                La terapia en Siloz Psicología está dirigida a personas que desean comprender sus patrones emocionales, trabajar en profundidad su bienestar psicológico y comprometerse con un proceso terapéutico.
              </p>
              <p className="text-lg text-foreground/80 leading-relaxed mb-8">
                No se trata de ofrecer consejos rápidos o soluciones inmediatas, sino de un proceso de trabajo psicológico que requiere implicación y continuidad.
              </p>
              <Button
                onClick={() => openContactDialog()}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-medium px-10 py-6 text-lg rounded-full shadow-lg hover:shadow-xl transition-all"
              >
                Reserva tu sesión de valoración
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Contacto Section */}
      <section id="contacto" className="py-20 px-4 bg-background">
        <div className="container mx-auto">
          <div className="max-w-3xl mx-auto">
            <h2 className="font-serif text-4xl font-bold text-center mb-6 text-primary">
              Solicita una sesión de valoración inicial
            </h2>
            <p className="text-lg text-center text-foreground/70 mb-12">
              Este formulario está destinado a personas interesadas en iniciar un proceso terapéutico. Te responderé lo antes posible.
            </p>
            <Card className="border-2 border-primary/20 shadow-xl">
              <CardContent className="p-8">
                <ContactForm onSuccess={() => setDialogOpen(false)} />
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <Footer />

      {/* Contact Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl text-primary">
              Solicita tu sesión de valoración inicial
            </DialogTitle>
          </DialogHeader>
          <ContactForm
            sessionType={selectedSessionType}
            onSuccess={() => setDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

