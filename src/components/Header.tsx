import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Film, Search, Tv } from "lucide-react";
import { IptvModal } from "@/components/IptvModal";

export function Header({ onAdd }: { onAdd?: () => void }) {
  const [iptvOpen, setIptvOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/70 border-b border-border/60">
      <div className="container mx-auto flex items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2 group">
          <Film className="h-6 w-6 text-primary transition-transform group-hover:rotate-12" />
          <span className="font-display text-2xl tracking-wide">
            <span className="text-primary">B</span>uffet de <span className="text-primary">V</span>
            ídeo
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            to="/buscar"
            className="inline-flex items-center gap-2 rounded-md bg-secondary px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary/80 transition"
          >
            <Search className="h-4 w-4" />
            Buscar
          </Link>
          <button
            onClick={() => setIptvOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-secondary/60 border border-border/40 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition min-h-[44px]"
            title="Conectar no IPTV"
          >
            <Tv className="h-4 w-4" />
            <span className="hidden sm:inline text-xs">IPTV</span>
          </button>
          {onAdd && (
            <button
              onClick={onAdd}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:brightness-110 transition"
            >
              + Adicionar magnet
            </button>
          )}
        </div>
      </div>
      {iptvOpen && <IptvModal onClose={() => setIptvOpen(false)} />}
    </header>
  );
}
