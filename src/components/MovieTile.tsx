import { Play } from "lucide-react";
import type { LibraryItem } from "@/lib/storage";

function getProgressPct(item: LibraryItem) {
  return item.progress && item.duration
    ? Math.min(100, Math.round((item.progress / item.duration) * 100))
    : 0;
}

export function MovieTile({
  item,
  onOpen,
  onPlay,
}: {
  item: LibraryItem;
  onOpen: (item: LibraryItem) => void;
  onPlay: (item: LibraryItem) => void;
}) {
  const progressPct = getProgressPct(item);
  const showProgress = progressPct > 0 && progressPct < 95;

  return (
    <div
      className="group relative aspect-[2/3] rounded-lg overflow-hidden bg-secondary border border-border/40 card-hover"
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
