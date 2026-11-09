import { parseHighlightsText } from "../../../../shared/highlights";

// Cómo se ven los highlights de una sesión (paciente y vista previa de la psicóloga).
export function HighlightsView({ text }: { text: string }) {
  const blocks = parseHighlightsText(text);
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((b, i) => (
        <article key={i} className="flex flex-col gap-1">
          {b.category && <p className="text-xs font-medium uppercase tracking-wide text-primary">{b.category}</p>}
          {b.title && <h4 className="font-serif text-lg font-semibold leading-snug text-foreground">{b.title}</h4>}
          {b.body && <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{b.body}</p>}
          {b.quote && (
            <blockquote className="mt-1 border-l-2 border-primary/50 pl-3 text-sm italic text-foreground">«{b.quote}»</blockquote>
          )}
        </article>
      ))}
    </div>
  );
}
