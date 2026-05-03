import { Play, Star } from "lucide-react";
import type { LibraryItem } from "@/lib/storage";
import { cn } from "@/lib/utils";

function getProgressPct(item: LibraryItem) {
  return item.progress && item.duration
    ? Math.min(100, Math.round((item.progress / item.duration) * 100))
    : 0;
}

export function MovieTile({
  item,
  onOpen,
  onPlay,
  onToggleFav,
}: {
  item: LibraryItem;
  onOpen: (item: LibraryItem) => void;
  onPlay: (item: LibraryItem) => void;
  onToggleFav?: (item: LibraryItem) => void;
}) {
  const progressPct = getProgressPct(item);
  const showProgress = progressPct > 0 && progressPct < 95;

  return (
    <div
      className="group relative aspect-[2/3] rounded-2xl overflow-hidden bg-white/5 border border-border/40 card-hover"
      onClick={() => onOpen(item)}
      role="button"
      tabIndex={0}
    >
      {item.poster ? (
        <img
          src={item.poster}
          alt={item.title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-secondary to-card" />
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent opacity-80 group-hover:opacity-100 transition-opacity" />

      {onToggleFav ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFav(item);
          }}
          className="absolute top-2 right-2 rounded-full bg-black/45 border border-border/40 p-2 hover:bg-black/60 transition"
          title="Salvar"
        >
          <Star className={cn("h-4 w-4", item.favorite ? "text-primary" : "text-white/60")} />
        </button>
      ) : null}

      <button
        onClick={(e) => {
          e.stopPropagation();
          onPlay(item);
        }}
        className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="Assistir"
      >
        <span className="inline-flex items-center justify-center rounded-full bg-primary/90 text-primary-foreground h-12 w-12 shadow-glow">
          <Play className="h-5 w-5 fill-current" />
        </span>
      </button>

      <div className="absolute inset-x-0 bottom-0 p-3 space-y-1">
        <div className="text-sm text-cream font-medium line-clamp-2">{item.title}</div>
        {item.year && <div className="text-[11px] text-muted-foreground">{item.year}</div>}
        {showProgress && (
          <div className="h-1 rounded-full bg-white/20 overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${progressPct}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
