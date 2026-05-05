import type { LibraryItem } from "@/lib/storage";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { MovieTile } from "@/components/MovieTile";

export function HomeCarouselRow({
  title,
  items,
  onOpen,
  onPlay,
  onToggleFav,
  onViewAll,
  showRanking = false,
}: {
  title: string;
  items: LibraryItem[];
  onOpen: (item: LibraryItem) => void;
  onPlay: (item: LibraryItem) => void;
  onToggleFav?: (item: LibraryItem) => void;
  onViewAll?: () => void;
  showRanking?: boolean;
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
            {items.map((item, idx) => (
              <CarouselItem
                key={item.id}
                className="pl-3 basis-[44%] sm:basis-[28%] md:basis-[20%] lg:basis-[16%] xl:basis-[14%]"
              >
                <MovieTile
                  item={item}
                  onOpen={onOpen}
                  onPlay={onPlay}
                  onToggleFav={onToggleFav}
                  rank={showRanking ? idx + 1 : undefined}
                />
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
