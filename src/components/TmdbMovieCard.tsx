import { Link } from "@tanstack/react-router";
import { Film } from "lucide-react";
import type { TmdbSearchItem } from "@/lib/tmdb";

export function TmdbMovieCard({ item, inLibrary }: { item: TmdbSearchItem; inLibrary: boolean }) {
  return (
    <Link
      to="/filme/$tmdbId"
      params={{ tmdbId: String(item.id) }}
      className="card-hover group relative block aspect-[2/3] rounded-2xl overflow-hidden bg-white/5 border border-border/40"
    >
      {item.poster ? (
        <img
          src={item.poster}
          alt={item.title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-secondary to-card">
          <Film className="h-16 w-16 text-muted-foreground/40" />
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/30 to-transparent opacity-90 group-hover:opacity-100 transition-opacity" />

      <div className="absolute top-2 left-2 flex gap-2">
        {inLibrary && (
          <span className="rounded-full bg-primary/90 text-primary-foreground text-[10px] px-2 py-0.5">
            Na biblioteca
          </span>
        )}
      </div>

      <div className="absolute inset-x-0 bottom-0 p-4 space-y-1">
        <h3 className="font-display text-lg leading-tight line-clamp-2 text-foreground">
          {item.title}
        </h3>
        {item.year && (
          <p className="text-[11px] text-muted-foreground tracking-wider">{item.year}</p>
        )}
      </div>
    </Link>
  );
}
