import { useEffect } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export default function AvisoLegal() {
  // Al abrir: ir a la sección del enlace (p. ej. #area-privada) o arriba del todo
  useEffect(() => {
    const target = window.location.hash ? document.getElementById(window.location.hash.slice(1)) : null;
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="pt-32 pb-20 px-4">
        <div className="container max-w-4xl mx-auto">
          <h1 className="font-serif text-4xl md:text-5xl font-bold text-foreground mb-8">
            Aviso Legal y Política de Privacidad
          </h1>
          
          <div className="prose prose-lg max-w-none space-y-8">
            {/* Identificación */}
            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">
                1. Identificación del Responsable
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                En cumplimiento del artículo 10 de la Ley 34/2002, de 11 de julio, de Servicios de la Sociedad de la Información y de Comercio Electrónico, se informa a los usuarios de los datos identificativos del responsable del sitio web:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li><strong>Denominación:</strong> Siloz Psicología</li>
                <li><strong>Responsable:</strong> Silvia López</li>
                <li><strong>Actividad:</strong> Servicios de Psicología Online</li>
                <li><strong>Sitio web:</strong> silozpsicologia.com</li>
                <li><strong>Email de contacto:</strong> silozpsicologia@gmail.com</li>
              </ul>
            </section>

            {/* Objeto */}
            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">
                2. Objeto
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                El presente Aviso Legal regula el uso y utilización del sitio web silozpsicologia.com, del que es titular Silvia López. La navegación por el sitio web atribuye la condición de usuario del mismo e implica la aceptación plena y sin reservas de todas y cada una de las disposiciones incluidas en este Aviso Legal.
              </p>
            </section>

            {/* Protección de Datos */}
            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">
                3. Protección de Datos Personales (RGPD)
              </h2>
              
              <h3 className="font-serif text-xl font-semibold text-foreground mt-6 mb-3">
                3.1. Responsable del Tratamiento
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                El responsable del tratamiento de los datos personales recogidos a través de este sitio web es Silvia López (Siloz Psicología), quien garantiza el cumplimiento del Reglamento (UE) 2016/679 del Parlamento Europeo y del Consejo, de 27 de abril de 2016, relativo a la protección de las personas físicas en lo que respecta al tratamiento de datos personales (RGPD), y la Ley Orgánica 3/2018, de 5 de diciembre, de Protección de Datos Personales y garantía de los derechos digitales (LOPDGDD).
              </p>

              <h3 className="font-serif text-xl font-semibold text-foreground mt-6 mb-3">
                3.2. Finalidad del Tratamiento
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                Los datos personales que se recogen a través del formulario de contacto y del área privada de pacientes tienen como finalidad:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>Gestionar las consultas y solicitudes de información realizadas por los usuarios</li>
                <li>Facilitar el contacto para la reserva de citas y sesiones de terapia</li>
                <li>Gestionar la agenda de citas de los pacientes en terapia y permitirles consultarlas en su área privada</li>
                <li>Llevar el control administrativo de los pagos de las sesiones y bonos</li>
                <li>Enviar información sobre los servicios de psicología ofrecidos</li>
                <li>Cumplir con las obligaciones legales aplicables</li>
              </ul>

              <h3 className="font-serif text-xl font-semibold text-foreground mt-6 mb-3">
                3.3. Legitimación
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                La base legal para el tratamiento de los datos del formulario de contacto es el consentimiento expreso del interesado, otorgado mediante el envío del formulario. El usuario puede retirar su consentimiento en cualquier momento, sin que ello afecte a la licitud del tratamiento basado en el consentimiento previo a su retirada.
              </p>
              <p className="text-muted-foreground leading-relaxed mt-4">
                Los datos del área privada de pacientes se tratan para la prestación del servicio de psicología solicitado por el paciente (art. 6.1.b RGPD) y, dado que la asistencia psicológica puede revelar información relativa a la salud, al amparo del art. 9.2.h RGPD (prestación de asistencia sanitaria), bajo el deber de secreto profesional. Los datos de facturación y pagos se conservan además para el cumplimiento de obligaciones legales (art. 6.1.c RGPD).
              </p>

              <h3 className="font-serif text-xl font-semibold text-foreground mt-6 mb-3">
                3.4. Conservación de Datos
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                Los datos personales proporcionados se conservarán mientras no se solicite su supresión por el interesado o durante el tiempo necesario para cumplir con las obligaciones legales aplicables. En el caso de iniciar un proceso terapéutico, los datos se conservarán de acuerdo con la normativa profesional y sanitaria vigente. Los datos relativos a pagos se conservarán durante los plazos exigidos por la normativa fiscal y contable.
              </p>

              <h3 id="area-privada" className="font-serif text-xl font-semibold text-foreground mt-6 mb-3 scroll-mt-28">
                3.5. Área Privada de Pacientes
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                Las personas que están en proceso terapéutico pueden disponer, por invitación de la psicóloga, de un acceso privado en este sitio web para consultar sus citas. En el área privada se tratan únicamente:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>Datos identificativos y de contacto: nombre, email y, opcionalmente, teléfono</li>
                <li>Datos de la agenda: fecha, hora, duración y estado de cada cita</li>
                <li>Datos administrativos: tipo de proceso (individual o de pareja), tarifa aplicada, bonos y estado de los pagos</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                En el área privada <strong>no se registran notas clínicas ni el contenido de las sesiones</strong>. El acceso está protegido con contraseña personal; cada paciente solo puede ver su propia información y únicamente la psicóloga puede crear o modificar citas. Las comunicaciones viajan cifradas y los datos se almacenan en servidores ubicados en la Unión Europea. El paciente puede solicitar en cualquier momento la desactivación de su acceso o la supresión de sus datos, sin perjuicio de los plazos de conservación legalmente obligatorios.
              </p>

              <h3 className="font-serif text-xl font-semibold text-foreground mt-6 mb-3">
                3.6. Destinatarios y Encargados del Tratamiento
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                Los datos personales no serán cedidos a terceros, salvo obligación legal. Para prestar el servicio se utilizan los siguientes proveedores, que actúan como encargados del tratamiento con los que se han suscrito los correspondientes contratos de encargo:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li><strong>Supabase:</strong> base de datos y autenticación del área privada (servidores en Fráncfort, Alemania, UE)</li>
                <li><strong>Resend:</strong> envío de los emails de acceso al área privada (región de envío en Irlanda, UE)</li>
                <li><strong>Vercel:</strong> alojamiento del sitio web</li>
                <li><strong>Google (Gmail y Google Sheets):</strong> recepción y registro de las solicitudes del formulario de contacto</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                Algunos de estos proveedores tienen sede en Estados Unidos. En esos casos, las posibles transferencias internacionales de datos se amparan en las garantías previstas en el RGPD, como el Marco de Privacidad de Datos UE-EE. UU. o las cláusulas contractuales tipo aprobadas por la Comisión Europea.
              </p>

              <h3 className="font-serif text-xl font-semibold text-foreground mt-6 mb-3">
                3.7. Derechos del Usuario
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                Los usuarios tienen derecho a:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li><strong>Acceso:</strong> Obtener información sobre si se están tratando datos personales y, en su caso, acceder a los mismos</li>
                <li><strong>Rectificación:</strong> Solicitar la corrección de datos inexactos o incompletos</li>
                <li><strong>Supresión:</strong> Solicitar la eliminación de los datos cuando ya no sean necesarios</li>
                <li><strong>Oposición:</strong> Oponerse al tratamiento de sus datos personales</li>
                <li><strong>Limitación:</strong> Solicitar la limitación del tratamiento de sus datos</li>
                <li><strong>Portabilidad:</strong> Recibir los datos en un formato estructurado y de uso común</li>
                <li><strong>Retirada del consentimiento:</strong> Retirar el consentimiento en cualquier momento</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                Para ejercer estos derechos, puede contactar a través del email: silozpsicologia@gmail.com. Asimismo, tiene derecho a presentar una reclamación ante la Agencia Española de Protección de Datos (www.aepd.es).
              </p>
            </section>

            {/* Política de Cookies */}
            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">
                4. Política de Cookies
              </h2>
              
              <h3 className="font-serif text-xl font-semibold text-foreground mt-6 mb-3">
                4.1. ¿Qué son las cookies?
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                Las cookies son pequeños archivos de texto que se almacenan en el dispositivo del usuario cuando visita un sitio web. Permiten al sitio web recordar información sobre la visita, como el idioma preferido y otras opciones, lo que facilita la próxima visita y hace que el sitio resulte más útil.
              </p>

              <h3 className="font-serif text-xl font-semibold text-foreground mt-6 mb-3">
                4.2. Tipos de cookies utilizadas
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                Este sitio web utiliza las siguientes cookies:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li><strong>Cookies técnicas:</strong> Necesarias para la navegación y el buen funcionamiento del sitio web. Permiten recordar la aceptación del banner de cookies y, en el área privada de pacientes, mantener la sesión iniciada (almacenamiento local del navegador).</li>
                <li><strong>Cookies analíticas:</strong> Utilizadas para analizar el uso del sitio web mediante herramientas de análisis (Umami Analytics). Estas cookies son anónimas y no identifican personalmente a los usuarios.</li>
              </ul>

              <h3 className="font-serif text-xl font-semibold text-foreground mt-6 mb-3">
                4.3. Gestión de cookies
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                El usuario puede configurar su navegador para aceptar o rechazar las cookies, o para que le notifique cuando reciba una cookie. La desactivación de cookies puede afectar al funcionamiento del sitio web. Para más información sobre cómo gestionar las cookies en los navegadores más comunes:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li><strong>Chrome:</strong> Configuración &gt; Privacidad y seguridad &gt; Cookies</li>
                <li><strong>Firefox:</strong> Opciones &gt; Privacidad y seguridad &gt; Cookies</li>
                <li><strong>Safari:</strong> Preferencias &gt; Privacidad &gt; Cookies</li>
                <li><strong>Edge:</strong> Configuración &gt; Cookies y permisos del sitio</li>
              </ul>
            </section>

            {/* Confidencialidad */}
            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">
                5. Confidencialidad Profesional
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                Como profesional de la psicología, Silvia López está sujeta al secreto profesional establecido en el Código Deontológico del Psicólogo y en la normativa sanitaria vigente. Toda la información compartida en el contexto de la relación terapéutica será tratada con la máxima confidencialidad y no será revelada a terceros sin el consentimiento expreso del paciente, salvo en los casos previstos por la ley.
              </p>
            </section>

            {/* Propiedad Intelectual */}
            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">
                6. Propiedad Intelectual e Industrial
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                Todos los contenidos del sitio web, incluyendo textos, imágenes, diseño gráfico, logotipos, iconos, y código fuente, son propiedad de Silvia López o de terceros que han autorizado su uso, y están protegidos por las leyes de propiedad intelectual e industrial. Queda prohibida la reproducción, distribución, comunicación pública o transformación de estos contenidos sin autorización expresa del titular.
              </p>
            </section>

            {/* Responsabilidad */}
            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">
                7. Limitación de Responsabilidad
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                Siloz Psicología no se hace responsable de los daños y perjuicios que pudieran derivarse de:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>Interferencias, interrupciones, fallos, omisiones, averías telefónicas, retrasos, bloqueos o desconexiones en el funcionamiento del sistema electrónico</li>
                <li>La falta de disponibilidad o accesibilidad al sitio web</li>
                <li>El uso indebido o inadecuado del sitio web por parte de los usuarios</li>
                <li>La presencia de virus o elementos lesivos en los contenidos</li>
              </ul>
            </section>

            {/* Legislación */}
            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">
                8. Legislación Aplicable y Jurisdicción
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                El presente Aviso Legal se rige por la legislación española. Para la resolución de cualquier controversia que pudiera surgir en relación con el sitio web o las actividades en él desarrolladas, serán competentes los Juzgados y Tribunales del domicilio del usuario.
              </p>
            </section>

            {/* Modificaciones */}
            <section>
              <h2 className="font-serif text-2xl font-bold text-foreground mb-4">
                9. Modificaciones
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                Siloz Psicología se reserva el derecho a modificar el presente Aviso Legal en cualquier momento. Los usuarios serán informados de cualquier cambio sustancial mediante aviso en el sitio web.
              </p>
              <p className="text-muted-foreground leading-relaxed mt-4">
                <strong>Última actualización:</strong> Octubre 2026
              </p>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
