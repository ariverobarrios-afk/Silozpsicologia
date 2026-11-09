import { Children, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

// Lista que enseña solo los primeros registros y despliega el resto a
// demanda, para que la pestaña no se llene de ruido.
const VISIBLE_ROWS = 5;

export function ShowMoreList({ className, children }: { className: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const items = Children.toArray(children);
  const hidden = items.length - VISIBLE_ROWS;
  return (
    <>
      <ul className={className}>{expanded ? items : items.slice(0, VISIBLE_ROWS)}</ul>
      {hidden > 0 && (
        <Button variant="ghost" size="sm" className="mt-2 self-center" onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          {expanded ? "Ver menos" : `Ver ${hidden} más`}
        </Button>
      )}
    </>
  );
}
