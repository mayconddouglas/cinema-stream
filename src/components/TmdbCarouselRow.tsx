import type { TmdbSearchItem } from "@/lib/tmdb";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { TmdbMovieCard } from "@/components/TmdbMovieCard";
import { TmdbShowCard } from "@/components/TmdbShowCard";

export function TmdbCarouselRow({
  title,
  mode,
  items,
  inLibraryIds,
  onViewAll,
}: {
  title: string;
  mode: "movie" | "tv";
  items: TmdbSearchItem[];
  inLibraryIds: Set<number>;
  onViewAll?: () => void;
}) {
  if (items.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {onViewAll ? (
          <button
            onClick={onViewAll}
            className="text-xs text-muted-foreground hover:text-foreground transition"
          >
            Ver tudo
          </button>
        ) : null}
      </div>

      <div className="relative">
        <Carousel opts={{ align: "start", dragFree: true }}>
          <CarouselContent className="-ml-3">
            {items.map((item) => (
              <CarouselItem
                key={item.id}
                className="pl-3 basis-[44%] sm:basis-[28%] md:basis-[20%] lg:basis-[16%] xl:basis-[14%]"
              >
                {mode === "tv" ? (
                  <TmdbShowCard item={item} />
                ) : (
                  <TmdbMovieCard item={item} inLibrary={inLibraryIds.has(item.id)} />
                )}
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="hidden md:inline-flex -left-10" />
          <CarouselNext className="hidden md:inline-flex -right-10" />
        </Carousel>
      </div>
    </section>
  );
}
