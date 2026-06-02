import { useEffect } from "react";
import { useParams, Link } from "wouter";
import { ArrowLeft, User } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { blogPosts } from "@/data/content";
import ReactMarkdown from "react-markdown";

export default function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  
  // Obtener el artículo por slug desde los datos estáticos
  const allPosts = blogPosts;
  const post = blogPosts.find((p) => p.slug === slug);
  const isLoading = false;

  useEffect(() => {
    if (post) {
      // Actualizar meta tags para SEO
      document.title = `${post.title} | Siloz Psicología`;
      
      const metaDescription = document.querySelector('meta[name="description"]');
      if (metaDescription) {
        metaDescription.setAttribute("content", post.excerpt);
      }
    }

    // Scroll to top
    window.scrollTo(0, 0);
  }, [post]);



  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="pt-24 pb-16">
          <div className="container max-w-3xl">
            <div className="animate-pulse space-y-6">
              <div className="h-4 bg-muted rounded w-32"></div>
              <div className="h-10 bg-muted rounded w-3/4"></div>
              <div className="h-4 bg-muted rounded w-1/2"></div>
              <div className="aspect-video bg-muted rounded-2xl"></div>
              <div className="space-y-3">
                <div className="h-4 bg-muted rounded w-full"></div>
                <div className="h-4 bg-muted rounded w-full"></div>
                <div className="h-4 bg-muted rounded w-3/4"></div>
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // Si no se encuentra el artículo
  if (!post) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="pt-24 pb-16">
          <div className="container max-w-3xl text-center py-16">
            <div className="text-6xl mb-4">🔍</div>
            <h1 className="font-serif text-3xl font-bold text-foreground mb-4">
              Artículo no encontrado
            </h1>
            <p className="text-muted-foreground mb-8">
              Lo sentimos, el artículo que buscas no existe o ha sido movido.
            </p>
            <Link href="/blog">
              <Button className="bg-primary hover:bg-primary/90">
                <ArrowLeft size={16} className="mr-2" />
                Volver al Blog
              </Button>
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // Artículos relacionados (misma categoría, excluyendo el actual)
  const relatedPosts = allPosts
    ?.filter((p) => p.slug !== slug && p.category === post.category)
    .slice(0, 2) || [];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="pt-24 pb-16">
        <article className="container max-w-3xl">
          {/* Navegación */}
          <Link href="/blog">
            <button className="inline-flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors mb-8">
              <ArrowLeft size={16} />
              Volver al Blog
            </button>
          </Link>

          {/* Encabezado del artículo */}
          <header className="mb-8">
            {/* Categoría */}
            <span className="inline-block px-3 py-1 text-sm font-medium bg-primary/10 text-primary rounded-full mb-4">
              {post.category}
            </span>
            
            {/* Título */}
            <h1 className="font-serif text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-6 leading-tight">
              {post.title}
            </h1>
            
            {/* Meta info */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground pb-6 border-b border-border">
              <div className="flex items-center gap-2">
                <User size={16} />
                <span>Silvia López</span>
              </div>
            </div>
          </header>

          {/* Imagen destacada */}
          {post.imageUrl && (
            <div className="aspect-video rounded-2xl overflow-hidden mb-8 bg-muted">
              <img
                src={post.imageUrl}
                alt={post.title}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Contenido del artículo en Markdown */}
          <div 
            className="prose prose-lg max-w-none
              prose-headings:font-serif prose-headings:text-foreground prose-headings:font-semibold
              prose-h1:text-3xl prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-6 prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-4
              prose-p:text-foreground/90 prose-p:leading-[2] prose-p:mb-8
              prose-a:text-primary prose-a:no-underline hover:prose-a:underline
              prose-strong:text-foreground prose-strong:font-semibold
              prose-em:text-foreground/80 prose-em:italic
              prose-ul:text-foreground/90 prose-ul:my-6 prose-ol:text-foreground/90 prose-ol:my-6 prose-li:my-3 prose-li:leading-[1.9]
              prose-blockquote:border-l-4 prose-blockquote:border-l-primary prose-blockquote:pl-4 prose-blockquote:text-foreground/70 prose-blockquote:italic prose-blockquote:my-8
              prose-img:rounded-xl prose-img:shadow-md prose-img:my-8
              prose-hr:border-border prose-hr:my-10"
          >
            <ReactMarkdown>{post.content}</ReactMarkdown>
          </div>

          {/* CTA al final del artículo */}
          <div className="mt-12 p-8 bg-primary/5 rounded-2xl border border-primary/20 text-center">
            <h3 className="font-serif text-2xl font-semibold text-foreground mb-3">
              ¿Necesitas ayuda profesional?
            </h3>
            <p className="text-muted-foreground mb-6 max-w-lg mx-auto">
              Si te identificas con lo que has leído y sientes que necesitas apoyo, estoy aquí para acompañarte en un proceso terapéutico profesional.
            </p>
            <Link href="/#contacto">
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 py-3 rounded-full">
                Solicitar sesión de valoración
              </Button>
            </Link>
          </div>

          {/* Artículos relacionados */}
          {relatedPosts.length > 0 && (
            <div className="mt-16">
              <h3 className="font-serif text-2xl font-semibold text-foreground mb-6">
                Otros artículos que te pueden interesar
              </h3>
              <div className="grid md:grid-cols-2 gap-6">
                {relatedPosts.map((relatedPost) => (
                  <Link key={relatedPost.slug} href={`/blog/${relatedPost.slug}`}>
                    <div className="group p-4 bg-card rounded-xl border border-border hover:border-primary/30 transition-all cursor-pointer">
                      <span className="text-xs font-medium text-primary">
                        {relatedPost.category}
                      </span>
                      <h4 className="font-serif text-lg font-semibold text-foreground mt-1 group-hover:text-primary transition-colors">
                        {relatedPost.title}
                      </h4>
                      <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                        {relatedPost.excerpt}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </article>
      </main>

      <Footer />
    </div>
  );
}
