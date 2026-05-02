import { Heart, Play, Trash2, Film } from "lucide-react";
import type { LibraryItem } from "@/lib/storage";

export function MovieCard({
  item,
  index,
  onPlay,
  onToggleFav,
  onDelete,
}: {
  item: LibraryItem;
  index: number;
  onPlay: (item: LibraryItem) => void;
  onToggleFav: (item: LibraryItem) => void;
  onDelete: (item: LibraryItem) => void;
}) {
  const progressPct =
    item.progress && item.duration
      ? Math.min(100, Math.round((item.progress / item.duration) * 100))
      : 0;

  return (
    <div
      className="card-hover group relative aspect-[2/3] rounded-lg overflow-hidden bg-secondary border border-border/40 animate-fade-up"
      style={{ animationDelay: `${Math.min(index * 40, 400)}ms` }}
    >
      {item.poster ? (
        <img
          src={item.poster}
          alt={item.title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => ((e.currentTarget.style.display = "none"))}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-secondary to-card">
          <Film className="h-16 w-16 text-muted-foreground/40" />
        </div>
      )}

      {/* Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/30 to-transparent opacity-90 group-hover:opacity-100 transition-opacity" />

      {/* Top-right actions */}
      <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFav(item);
          }}
          className="rounded-full bg-black/60 backdrop-blur p-2 hover:bg-primary hover:text-primary-foreground transition"
          aria-label="Favoritar"
        >
          <Heart
            className={`h-4 w-4 ${item.favorite ? "fill-primary text-primary" : ""}`}
          />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Remover "${item.title}" da biblioteca?`)) onDelete(item);
          }}
          className="rounded-full bg-black/60 backdrop-blur p-2 hover:bg-destructive hover:text-destructive-foreground transition"
          aria-label="Remover"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Bottom info */}
      <div className="absolute inset-x-0 bottom-0 p-4 space-y-2">
        <h3 className="font-display text-xl leading-tight line-clamp-2 text-cream">
          {item.title}
        </h3>
        {item.year && (
          <p className="text-xs text-muted-foreground tracking-wider">{item.year}</p>
        )}

        {progressPct > 0 && progressPct < 95 && (
          <div className="space-y-1">
            <div className="h-1 rounded-full bg-white/20 overflow-hidden">
              <div
                className="h-full bg-primary"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">Assistido {progressPct}%</p>
          </div>
        )}

        <button
          onClick={() => onPlay(item)}
          className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground hover:brightness-110 transition shadow-glow"
        >
          <Play className="h-4 w-4 fill-current" />
          {progressPct > 0 && progressPct < 95 ? "Continuar" : "Assistir"}
        </button>
      </div>
    </div>
  );
}
