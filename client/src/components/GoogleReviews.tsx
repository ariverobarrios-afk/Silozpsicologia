import { Star } from "lucide-react";

const reviews = [
  {
    authorName: "Ana Luque Barranco",
    rating: 5,
    text: "Profesional, cercana y muy humana. Hace que te sientas escuchada y comprendida desde el primer momento. Sin duda, una psicóloga totalmente recomendable cuando necesitas acompañamiento psicológico de calidad.",
  },
  {
    authorName: "Tomás Gallardo Toro",
    rating: 5,
    text: "Muy recomendable! Me ayudó mucho y me comprendió en todo momento. Me hizo mejorar y darme cuenta de todo mi potencial.",
  },
  {
    authorName: "Alejandra Carretón Ruiz",
    rating: 5,
    text: "Llevo dos años en terapia con ella y sin duda lo mejor que he hecho. Llevaba años sin sentirme al 100% como puedo estar con ella hablando y contándole todo. Es súper cercana y da igual el día de la semana que sea o la hora que ella te va a responder y ayudar en todo. Es la mejor.",
  },
  {
    authorName: "Jose Luis Miñaca Mora",
    rating: 5,
    text: "Gran profesional y cercana. Transmite confianza y tranquilidad desde el primer momento. Se nota la vocación, la formación y el compromiso. 100% recomendable",
  },
  {
    authorName: "Alexis Tello",
    rating: 5,
    text: "Empecé terapia con Silvia hace unos meses después de una mala temporada, y fue la mejor decisión que tomé. Nunca me gustó ir a terapia, pero Silvia hace que la experiencia sea muy cómoda, aún saliendo fuera de mi zona de confort. Puedo hablar y tratar cualquier tema con ella. 100% recomendable!",
  },
  {
    authorName: "Luis Delbergue",
    rating: 5,
    text: "Me ayudó a salir adelante después de un periodo en el que no era lo mismo. Dio con las claves en todo momento, me encanta como me guía en casa sesión. Muy recomendable",
  },
];

export default function GoogleReviews() {
  const renderStars = (rating: number) => {
    return (
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`w-5 h-5 ${
              star <= rating
                ? "fill-[#7A9B7F] text-[#7A9B7F]"
                : "fill-gray-300 text-gray-300"
            }`}
          />
        ))}
      </div>
    );
  };

  // Calcular rating promedio
  const averageRating = reviews.reduce((acc, review) => acc + review.rating, 0) / reviews.length;

  return (
    <section className="py-20 bg-[#F5F1E8]">
      <div className="container">
        {/* Header */}
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-[#4A5D4F] mb-4">
            Lo que dicen nuestros pacientes
          </h2>
          <div className="flex items-center justify-center gap-3 mb-2">
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={`w-6 h-6 ${
                    star <= Math.round(averageRating)
                      ? "fill-[#7A9B7F] text-[#7A9B7F]"
                      : "fill-gray-300 text-gray-300"
                  }`}
                />
              ))}
            </div>
            <span className="text-2xl font-bold text-[#4A5D4F]">
              {averageRating.toFixed(1)}
            </span>
          </div>

        </div>

        {/* Reviews Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {reviews.map((review, index) => (
            <div
              key={index}
              className="bg-white p-6 rounded-lg shadow-sm hover:shadow-md transition-shadow"
            >
              {/* Author and Rating */}
              <div className="flex items-start justify-between mb-4">
                <h3 className="font-semibold text-[#4A5D4F]">
                  {review.authorName}
                </h3>
                {renderStars(review.rating)}
              </div>

              {/* Review Text */}
              <p className="text-[#6B7C6E] leading-relaxed">
                {review.text}
              </p>
            </div>
          ))}
        </div>

        {/* Google Link */}
        <div className="text-center">
          <a
            href="https://www.google.com/maps/place/Siloz+Psicolog%C3%ADa+-+Terapia+Psicol%C3%B3gica+ONLINE/@39.8431904,-4.0406292,13z/data=!3m1!4b1!4m12!1m5!8m4!1e1!2s115419558150289177591!3m1!1e1!3m5!1s0xd6a0d7494cde817:0x4d0f71c3ca427bc9!8m2!3d39.8431318!4d-3.99943!16s%2Fg%2F11myrgtq4k?hl=es"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-[#7A9B7F] hover:text-[#5F7D64] font-medium transition-colors"
          >
            Ver todas las reseñas en Google
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
        </div>
      </div>
    </section>
  );
}
