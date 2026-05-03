import { Link } from "@tanstack/react-router";
import { Film } from "lucide-react";
import type { Series } from "@/lib/series";

export function SeriesCard({ series, index }: { series: Series; index: number }) {
  return (
    <Link
      to="/serie/$tmdbId"
      params={{ tmdbId: String(series.tmdbId) }}
      className="card-hover group relative aspect-[2/3] rounded-2xl overflow-hidden bg-white/5 border border-border/40 animate-fade-up"
      style={{ animationDelay: `${Math.min(index * 40, 400)}ms` }}
    >
      {series.poster ? (
        <img
          src={series.poster}
          alt={series.title}
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

      <div className="absolute inset-x-0 bottom-0 p-4 space-y-2">
        <h3 className="font-display text-xl leading-tight line-clamp-2 text-foreground">
          {series.title}
        </h3>
        {series.year && (
          <p className="text-xs text-muted-foreground tracking-wider">{series.year}</p>
        )}
      </div>
    </Link>
  );
}
