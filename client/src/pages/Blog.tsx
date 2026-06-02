import { useEffect } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { blogPosts } from "@/data/content";

export default function Blog() {
  const posts = blogPosts;
  const isLoading = false;

  useEffect(() => {
    document.title = "Blog | Siloz Psicología - Artículos sobre Bienestar Emocional";
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute("content", "Artículos sobre psicología, bienestar emocional, ansiedad, depresión y autoestima. Consejos prácticos de Silvia López, Psicóloga General Sanitaria.");
    }
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="pt-24 pb-16">
        <div className="container max-w-6xl">
          {/* Encabezado */}
          <div className="text-center mb-12">
            <h1 className="font-serif text-4xl md:text-5xl font-bold text-foreground mb-4">
              Blog
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Artículos sobre psicología, bienestar emocional y herramientas para tu crecimiento personal
            </p>
          </div>

          {/* Lista de artículos */}
          {!isLoading && posts && posts.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {posts.map((post) => (
                <Link key={post.slug} href={`/blog/${post.slug}`}>
                  <article className="group bg-card rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 border border-border hover:border-primary/30 cursor-pointer h-full flex flex-col relative">
                    {/* Imagen */}
                    <div className="aspect-video overflow-hidden bg-muted">
                      {post.imageUrl ? (
                        <img
                          src={post.imageUrl}
                          alt={post.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-primary/10">
                          <span className="text-4xl">📝</span>
                        </div>
                      )}
                    </div>

                    {/* Contenido */}
                    <div className="p-6 flex flex-col flex-grow">
                      {/* Categoría */}
                      <span className="inline-block px-3 py-1 text-xs font-medium bg-primary/10 text-primary rounded-full w-fit mb-3">
                        {post.category}
                      </span>

                      {/* Título */}
                      <h2 className="font-serif text-xl font-semibold text-foreground mb-3 group-hover:text-primary transition-colors leading-tight">
                        {post.title}
                      </h2>

                      {/* Extracto - visible por defecto */}
                      <p className="text-muted-foreground text-sm mb-4 line-clamp-3 flex-grow group-hover:line-clamp-none transition-all">
                        {post.excerpt}
                      </p>

                      {/* Botón leer más */}
                      <div className="pt-4 border-t border-border">
                        <span className="text-primary font-medium flex items-center gap-1 group-hover:gap-2 transition-all text-sm">
                          Leer más
                          <ArrowRight size={14} />
                        </span>
                      </div>
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          ) : null}

          {/* Estado vacío cuando no hay artículos */}
          {!isLoading && (!posts || posts.length === 0) && (
            <div className="text-center py-16 bg-card rounded-2xl border border-border">
              <div className="text-6xl mb-4">📝</div>
              <h2 className="font-serif text-2xl font-semibold text-foreground mb-2">
                Próximamente
              </h2>
              <p className="text-muted-foreground max-w-md mx-auto mb-6">
                Estamos preparando artículos sobre bienestar emocional, ansiedad, depresión y mucho más. ¡Vuelve pronto!
              </p>
              <Link href="/">
                <button className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-full hover:bg-primary/90 transition-colors">
                  Volver al inicio
                  <ArrowRight size={16} />
                </button>
              </Link>
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
