import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { AnalyticsEvents } from "@/lib/analytics";
import { sendContact } from "@/lib/sendContact";

const contactSchema = z.object({
  name: z.string().min(1, "El nombre es requerido"),
  email: z.string().email("Email inválido"),
  phone: z.string().optional(),
  message: z.string().min(10, "El mensaje debe tener al menos 10 caracteres"),
  sessionType: z.string().optional(),
  whatToWork: z.string().optional(),
  previousTherapy: z.string().optional(),
  wantsProcess: z.string().optional(),
  // Honeypot anti-spam: invisible para humanos; si se rellena, es un bot.
  website: z.string().optional(),
});

type ContactFormData = z.infer<typeof contactSchema>;

interface ContactFormProps {
  sessionType?: "individual" | "familiar";
  formLocation?: "home" | "ansiedad" | "depresion" | "header";
  onSuccess?: () => void;
}

export default function ContactForm({ sessionType, formLocation = "home", onSuccess }: ContactFormProps) {
  const [, setLocation] = useLocation();
  const [isPending, setIsPending] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      sessionType: sessionType || "",
      whatToWork: "",
      previousTherapy: "",
      wantsProcess: "",
    },
  });

  const onSubmit = async (data: ContactFormData) => {
    setIsPending(true);
    try {
      await sendContact(data);

      // Enviar evento de conversión a GA4 y Google Ads
      AnalyticsEvents.submitContactForm(formLocation);

      reset();
      onSuccess?.();
      setLocation("/gracias");
    } catch (error) {
      toast.error("Error al enviar el mensaje", {
        description:
          error instanceof Error ? error.message : "Inténtalo de nuevo o escríbeme directamente.",
      });
        } finally {
      setIsPending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Honeypot anti-spam: oculto para humanos, atractivo para bots. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-9999px",
          width: "1px",
          height: "1px",
          overflow: "hidden",
        }}
      >
        <label htmlFor="website">No rellenar este campo</label>
        <input
          id="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          {...register("website")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Nombre completo *</Label>
        <Input
          id="name"
          {...register("name")}
          placeholder="Tu nombre"
          className="bg-card"
        />
        {errors.name && (
          <p className="text-sm text-destructive">{errors.name.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email *</Label>
        <Input
          id="email"
          type="email"
          {...register("email")}
          placeholder="tu@email.com"
          className="bg-card"
        />
        {errors.email && (
          <p className="text-sm text-destructive">{errors.email.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone">Teléfono (opcional)</Label>
        <Input
          id="phone"
          type="tel"
          {...register("phone")}
          placeholder="+34 600 000 000"
          className="bg-card"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="whatToWork">¿Qué te gustaría trabajar en terapia?</Label>
        <Input
          id="whatToWork"
          {...register("whatToWork")}
          placeholder="Ej: ansiedad, autoestima, relaciones..."
          className="bg-card"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="previousTherapy">¿Has realizado terapia anteriormente?</Label>
        <select
          id="previousTherapy"
          {...register("previousTherapy")}
          className="w-full h-10 px-3 py-2 rounded-md border border-input bg-card text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <option value="">Selecciona una opción</option>
          <option value="Sí">Sí</option>
          <option value="No">No</option>
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="wantsProcess">¿Buscas iniciar un proceso terapéutico?</Label>
        <select
          id="wantsProcess"
          {...register("wantsProcess")}
          className="w-full h-10 px-3 py-2 rounded-md border border-input bg-card text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <option value="">Selecciona una opción</option>
          <option value="Sí">Sí</option>
          <option value="No">No</option>
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="message">Mensaje *</Label>
        <Textarea
          id="message"
          {...register("message")}
          placeholder="Cuéntame brevemente tu situación y lo que te gustaría trabajar..."
          rows={5}
          className="bg-card resize-none"
        />
        {errors.message && (
          <p className="text-sm text-destructive">{errors.message.message}</p>
        )}
      </div>

      <Button
        type="submit"
        disabled={isPending}
        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-6 text-lg rounded-full shadow-lg hover:shadow-xl transition-all"
      >
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Enviando...
          </>
        ) : (
          "Solicitar sesión de valoración"
        )}
      </Button>
    </form>
  );
}
