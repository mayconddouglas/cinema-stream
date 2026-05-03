import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export type RowItem = {
  key: string;
  title: string;
  image?: string | null;
  kind: "vod" | "live";
  favorite: boolean;
  onPlay: () => void;
  onToggleFavorite: () => void;
};

export function Row({
  title,
  actionLabel,
  onAction,
  items,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  items: RowItem[];
}) {
  if (items.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {actionLabel && onAction ? (
          <button
            onClick={onAction}
            className="text-xs text-muted-foreground hover:text-foreground transition"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
      <div className="-mx-6 px-6 overflow-x-auto pb-2">
        <div className="flex gap-3 snap-x snap-mandatory">
          {items.map((it) => (
            <div
              key={it.key}
              className={cn(
                "relative snap-start shrink-0 overflow-hidden rounded-2xl border border-border/40 bg-white/5",
                it.kind === "vod" ? "w-[118px] aspect-[2/3]" : "w-[240px] aspect-video",
              )}
            >
              <button onClick={it.onPlay} className="absolute inset-0">
                {it.image ? (
                  <img src={it.image} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-secondary/40" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/0 to-black/0" />
                <div className="absolute bottom-0 left-0 right-0 p-2">
                  <p className="text-xs text-foreground line-clamp-2">{it.title}</p>
                </div>
              </button>
              <button
                onClick={it.onToggleFavorite}
                className="absolute top-2 right-2 rounded-full bg-black/45 border border-border/40 p-2 hover:bg-black/60 transition"
                title="Favoritar"
              >
                <Star className={cn("h-4 w-4", it.favorite ? "text-primary" : "text-white/60")} />
              </button>
              {it.kind === "live" ? (
                <div className="absolute top-2 left-2 rounded-full bg-primary/90 px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  LIVE
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
