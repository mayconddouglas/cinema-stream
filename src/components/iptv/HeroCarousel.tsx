import { useEffect, useMemo, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type HeroSlide = {
  key: string;
  title: string;
  subtitle?: string;
  image?: string;
  badge?: string;
  onPlay: () => void;
  onSecondary?: () => void;
  primaryLabel?: string;
  secondaryLabel?: string;
};

export function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
  const [viewportRef, api] = useEmblaCarousel({ loop: true, align: "start" });
  const [index, setIndex] = useState(0);

  const dots = useMemo(() => slides.map((_, i) => i), [slides]);

  useEffect(() => {
    if (!api) return;
    const handle = () => setIndex(api.selectedScrollSnap());
    handle();
    api.on("select", handle);
    api.on("reInit", handle);
    return () => {
      api.off("select", handle);
    };
  }, [api]);

  if (slides.length === 0) return null;

  return (
    <section className="-mx-6 overflow-hidden rounded-3xl border border-border/40 bg-card">
      <div ref={viewportRef} className="overflow-hidden">
        <div className="flex">
          {slides.map((s) => (
            <div key={s.key} className="min-w-0 shrink-0 grow-0 basis-full">
              <div className="relative h-[62vh] min-h-[440px] max-h-[640px]">
                {s.image ? (
                  <img
                    src={s.image}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 bg-secondary/40" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/10" />
                <div className="absolute inset-0 px-6 pb-10 pt-10 flex flex-col justify-end">
                  <div className="space-y-4 max-w-xl">
                    {s.badge ? (
                      <div className="inline-flex items-center gap-2 rounded-full bg-black/50 border border-border/40 px-3 py-1 text-xs text-muted-foreground w-fit">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                        {s.badge}
                      </div>
                    ) : null}
                    <h2 className="font-display text-5xl leading-[0.92] text-foreground">
                      {s.title}
                    </h2>
                    {s.subtitle ? (
                      <p className="text-sm text-muted-foreground line-clamp-2">{s.subtitle}</p>
                    ) : null}
                    <div className="flex gap-2 flex-wrap">
                      <Button onClick={s.onPlay} size="lg" className="rounded-2xl">
                        <Play className="h-4 w-4" />
                        {s.primaryLabel ?? "Play"}
                      </Button>
                      {s.onSecondary ? (
                        <Button
                          variant="secondary"
                          onClick={s.onSecondary}
                          size="lg"
                          className="rounded-2xl"
                        >
                          {s.secondaryLabel ?? "Abrir no VLC"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-6 pb-4">
        <div className="flex items-center justify-center gap-2">
          {dots.map((i) => (
            <button
              key={i}
              onClick={() => api?.scrollTo(i)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index ? "w-6 bg-primary" : "w-2 bg-white/20 hover:bg-white/30",
              )}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
