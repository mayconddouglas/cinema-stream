import { Heart, Play, Trash2, X } from "lucide-react";
import type { LibraryItem } from "@/lib/storage";

function getProgressPct(item: LibraryItem) {
  return item.progress && item.duration ? Math.min(100, Math.round((item.progress / item.duration) * 100)) : 0;
}

export function MovieDetailsModal({
  open,
  item,
  onClose,
  onPlay,
  onToggleFav,
  onDelete,
}: {
  open: boolean;
  item: LibraryItem | null;
  onClose: () => void;
  onPlay: (item: LibraryItem) => void;
  onToggleFav: (item: LibraryItem) => void;
  onDelete: (item: LibraryItem) => void;
}) {
  if (!open || !item) return null;

  const progressPct = getProgressPct(item);
  const backdrop = item.backdrop ?? item.poster;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/80 backdrop-blur-sm p-0 md:p-6 animate-scale-in"
      onClick={onClose}
    >
      <div
        className="relative w-full md:max-w-3xl overflow-hidden rounded-t-2xl md:rounded-2xl bg-card border border-border/60 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 rounded-full bg-black/60 backdrop-blur p-2 hover:bg-black/80 transition"
          aria-label="Fechar"
        >
          <X className="h-4 w-4 text-cream" />
        </button>

        <div className="relative h-52 md:h-72 bg-black">
          {backdrop ? (
            <>
              <img src={backdrop} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0" style={{ background: "var(--gradient-hero)" }} />
            </>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-secondary to-black" />
          )}
          <div className="absolute inset-0 flex items-end p-5 md:p-6">
            <div className="space-y-2 max-w-2xl">
              <h3 className="font-display text-4xl md:text-5xl leading-none text-cream">{item.title}</h3>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {item.year && <span>{item.year}</span>}
                {item.tmdbId && <span>TMDB {item.tmdbId}</span>}
                {progressPct > 0 && progressPct < 95 && <span>{progressPct}% assistido</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="p-5 md:p-6 space-y-4">
          {item.description ? (
            <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4">{item.description}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sem descrição ainda. Use “Buscar no TMDB” ao adicionar para preencher automaticamente.
            </p>
          )}

          {progressPct > 0 && progressPct < 95 && (
            <div className="space-y-1">
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="text-[11px] text-muted-foreground">Continuar de onde parou</div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onPlay(item)}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:brightness-110 transition shadow-glow"
            >
              <Play className="h-4 w-4 fill-current" />
              {progressPct > 0 && progressPct < 95 ? "Continuar" : "Assistir"}
            </button>

            <button
              onClick={() => onToggleFav(item)}
              className="inline-flex items-center gap-2 rounded-md bg-secondary px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary/80 transition"
            >
              <Heart className={`h-4 w-4 ${item.favorite ? "fill-primary text-primary" : ""}`} />
              {item.favorite ? "Na minha lista" : "Minha lista"}
            </button>

            <button
              onClick={() => {
                if (confirm(`Remover "${item.title}" da biblioteca?`)) onDelete(item);
              }}
              className="inline-flex items-center gap-2 rounded-md bg-destructive/15 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground transition"
            >
              <Trash2 className="h-4 w-4" />
              Remover
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

