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
}: {
  title: string;
  items: LibraryItem[];
  onOpen: (item: LibraryItem) => void;
  onPlay: (item: LibraryItem) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-2xl text-cream">{title}</h2>
      </div>

      <div className="relative">
        <Carousel opts={{ align: "start", dragFree: true }}>
          <CarouselContent className="-ml-3">
            {items.map((item) => (
              <CarouselItem
                key={item.id}
                className="pl-3 basis-[44%] sm:basis-[28%] md:basis-[20%] lg:basis-[16%] xl:basis-[14%]"
              >
                <MovieTile item={item} onOpen={onOpen} onPlay={onPlay} />
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
