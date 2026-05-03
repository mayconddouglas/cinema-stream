import { Link } from "@tanstack/react-router";
import { Film, Search, Tv } from "lucide-react";

export function Header({ onAdd }: { onAdd?: () => void }) {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/70 border-b border-border/60">
      <div className="container mx-auto flex items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2 group">
          <Film className="h-6 w-6 text-primary transition-transform group-hover:rotate-12" />
          <span className="font-display text-2xl tracking-wide">
            Acervos de <span className="text-primary">Filmes</span>
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            to="/iptv"
            className="inline-flex items-center gap-2 rounded-xl bg-secondary/60 border border-border/40 px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary/80 transition min-h-[44px]"
          >
            <Tv className="h-4 w-4" />
            TV
          </Link>
          <Link
            to="/buscar"
            className="inline-flex items-center gap-2 rounded-xl bg-secondary/60 border border-border/40 px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary/80 transition min-h-[44px]"
          >
            <Search className="h-4 w-4" />
            Buscar
          </Link>
          {onAdd && (
            <button
              onClick={onAdd}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:brightness-110 transition min-h-[44px]"
            >
              + Adicionar magnet
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
