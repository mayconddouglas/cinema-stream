import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Film, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { AppBottomNav } from "@/components/AppBottomNav";
import { AddMagnetDialog } from "@/components/AddMagnetDialog";
import { HomeCarouselRow } from "@/components/HomeCarouselRow";
import { MovieDetailsModal } from "@/components/MovieDetailsModal";
import { Player } from "@/components/Player";
import { SeriesCard } from "@/components/SeriesCard";
import { HeroCarousel, type HeroSlide } from "@/components/iptv/HeroCarousel";
import { Button } from "@/components/ui/button";
import { getSeriesAll, type Series } from "@/lib/series";
import { getAll, remove, update, type LibraryItem } from "@/lib/storage";
import { migrateLocalStorageToServer } from "@/lib/api";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Acervos de Filmes — Sua biblioteca pessoal de streaming" },
      {
        name: "description",
        content:
          "Streaming de vídeo via WebTorrent direto no navegador. Adicione seus magnet links, organize sua biblioteca e assista com Plyr.",
      },
      { property: "og:title", content: "Acervos de Filmes" },
      {
        property: "og:description",
        content: "Sua biblioteca pessoal de streaming via WebTorrent.",
      },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [playing, setPlaying] = useState<LibraryItem | null>(null);
  const [details, setDetails] = useState<LibraryItem | null>(null);
  const [showMigrationBanner, setShowMigrationBanner] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrationDone, setMigrationDone] = useState(false);

  useEffect(() => {
    Promise.all([getAll(), getSeriesAll()]).then(([items, series]) => {
      setItems(items);
      setSeries(series);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const alreadyMigrated = localStorage.getItem("buffet_migrated_v1");
    if (alreadyMigrated) return;
    const hasLocalMovies = !!localStorage.getItem("buffet-video/library/items");
    const hasLocalSeries = !!localStorage.getItem("buffet-video/series/series");
    if (hasLocalMovies || hasLocalSeries) {
      setShowMigrationBanner(true);
    }
  }, []);

  const continueWatching = useMemo(
    () =>
      items.filter((i) => {
        if (!i.progress || !i.duration) return false;
        const pct = (i.progress / i.duration) * 100;
        return pct > 5 && pct < 95;
      }),
    [items],
  );
  const favorites = useMemo(
    () => items.filter((i) => i.favorite).sort((a, b) => b.addedAt - a.addedAt),
    [items],
  );
  const recentlyAdded = useMemo(() => [...items].sort((a, b) => b.addedAt - a.addedAt), [items]);
  const seriesAdded = useMemo(() => [...series].sort((a, b) => b.addedAt - a.addedAt), [series]);

  const continueSorted = useMemo(() => {
    return [...continueWatching].sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0));
  }, [continueWatching]);

  const yearRows = useMemo(() => {
    const map = new Map<string, LibraryItem[]>();
    for (const item of items) {
      const y = item.year?.trim();
      if (!y) continue;
      if (!map.has(y)) map.set(y, []);
      map.get(y)!.push(item);
    }

    const rows = [...map.entries()]
      .map(([year, items]) => ({
        year,
        items: items.sort((a, b) => b.addedAt - a.addedAt),
      }))
      .filter((r) => r.items.length >= 3)
      .sort((a, b) => b.items.length - a.items.length)
      .slice(0, 3);

    return rows;
  }, [items]);

  const handlePlay = (item: LibraryItem) => setPlaying(item);
  const handleOpen = (item: LibraryItem) => setDetails(item);
  const handleToggleFav = async (item: LibraryItem) => {
    setItems(await update(item.id, { favorite: !item.favorite }));
  };
  const handleDelete = async (item: LibraryItem) => {
    if (details?.id === item.id) setDetails(null);
    setItems(await remove(item.id));
  };
  const handleProgress = async (id: string, patch: Partial<LibraryItem>) => {
    const updated = await update(id, patch);
    setItems(updated);
  };

  const heroSlides = useMemo(() => {
    const picks = recentlyAdded.slice(0, 5);
    const slides: HeroSlide[] = [];
    for (const item of picks) {
      const img = item.backdrop ?? item.poster ?? "";
      slides.push({
        key: item.id,
        title: item.title,
        subtitle: item.year ? `${item.year}` : undefined,
        image: img || undefined,
        badge: "Biblioteca",
        onPlay: () => handlePlay(item),
        onSecondary: () => handleOpen(item),
        secondaryLabel: "Detalhes",
      });
    }
    return slides;
  }, [recentlyAdded]);

  const handleMigrate = async () => {
    setMigrating(true);
    try {
      const result = await migrateLocalStorageToServer();
      setMigrationDone(true);
      localStorage.setItem("buffet_migrated_v1", "1");
      setShowMigrationBanner(false);
      const updated = await getAll();
      setItems(updated);
      toast.success(
        `Migração concluída: ${result.movies} filmes e ${result.episodes} episódios transferidos para o servidor.`,
        { duration: 5000 },
      );
    } catch {
      toast.error("Falha na migração. Tente novamente.");
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="min-h-screen pb-[92px]">
      <div className="sticky top-0 z-30 border-b border-border/40 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto max-w-xl px-4 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Acervos de</p>
            <h1 className="font-display text-3xl leading-none tracking-wide text-foreground truncate">
              Filmes
            </h1>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="shrink-0 rounded-2xl border border-border/40 bg-white/5 px-4 py-2 text-left hover:bg-white/10 transition min-h-[44px] inline-flex items-center gap-2"
          >
            <Plus className="h-4 w-4 text-primary" />
            <span className="text-xs text-foreground">Adicionar</span>
          </button>
        </div>
      </div>

      {showMigrationBanner && !migrationDone && (
        <div className="border-b border-primary/20 bg-primary/5 px-4 py-3">
          <div className="mx-auto max-w-xl flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="text-primary shrink-0 mt-0.5">⚠</span>
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-foreground">Biblioteca local detectada</p>
                <p className="text-xs text-muted-foreground">
                  Seus filmes e séries estão salvos apenas neste dispositivo. Migre para o servidor
                  para acessar em qualquer lugar e nos apps IPTV.
                </p>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => {
                  localStorage.setItem("buffet_migrated_v1", "1");
                  setShowMigrationBanner(false);
                }}
                className="rounded-xl bg-secondary/60 border border-border/40 px-3 py-2 text-xs hover:bg-secondary/80 transition min-h-[40px]"
              >
                Ignorar
              </button>
              <button
                onClick={handleMigrate}
                disabled={migrating}
                className="inline-flex items-center gap-2 rounded-xl bg-primary/20 border border-primary/30 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/30 transition min-h-[40px] disabled:opacity-60"
              >
                {migrating ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Migrando...
                  </>
                ) : (
                  "Migrar agora"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-xl px-4 py-6 space-y-10">
        {loading ? (
          <p className="text-muted-foreground">Carregando biblioteca...</p>
        ) : items.length === 0 && series.length === 0 ? (
          <EmptyState onAdd={() => setShowAdd(true)} />
        ) : (
          <>
            {heroSlides.length > 0 ? <HeroCarousel slides={heroSlides} /> : null}
            {items.length > 0 && (
              <>
                <HomeCarouselRow
                  title="Continuar assistindo"
                  items={continueSorted}
                  onOpen={handleOpen}
                  onPlay={handlePlay}
                  onToggleFav={handleToggleFav}
                />
                <section id="minha-lista" className="scroll-mt-20">
                  <HomeCarouselRow
                    title="Minha lista"
                    items={favorites}
                    onOpen={handleOpen}
                    onPlay={handlePlay}
                    onToggleFav={handleToggleFav}
                  />
                </section>
                <HomeCarouselRow
                  title="Adicionados recentemente"
                  items={recentlyAdded}
                  onOpen={handleOpen}
                  onPlay={handlePlay}
                  onToggleFav={handleToggleFav}
                />
                {yearRows.map((row) => (
                  <HomeCarouselRow
                    key={row.year}
                    title={`Ano ${row.year}`}
                    items={row.items}
                    onOpen={handleOpen}
                    onPlay={handlePlay}
                    onToggleFav={handleToggleFav}
                  />
                ))}
              </>
            )}

            {seriesAdded.length > 0 && (
              <section id="series" className="space-y-3 scroll-mt-20">
                <h2 className="text-sm font-semibold text-foreground">Séries</h2>
                <div className="grid grid-cols-3 gap-3">
                  {seriesAdded.map((s, idx) => (
                    <SeriesCard key={s.tmdbId} series={s} index={idx} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      <AppBottomNav />

      <Button
        onClick={() => setShowAdd(true)}
        size="icon"
        className="fixed right-4 bottom-[96px] z-40 h-14 w-14 rounded-2xl shadow-glow"
      >
        <Plus className="h-5 w-5" />
      </Button>

      <AddMagnetDialog open={showAdd} onClose={() => setShowAdd(false)} onAdded={setItems} />
      <MovieDetailsModal
        open={!!details}
        item={details}
        onClose={() => setDetails(null)}
        onPlay={(item) => {
          setDetails(null);
          setPlaying(item);
        }}
        onToggleFav={handleToggleFav}
        onDelete={handleDelete}
      />
      {playing && (
        <Player item={playing} onClose={() => setPlaying(null)} onProgress={handleProgress} />
      )}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="text-center py-16 space-y-6 max-w-md mx-auto animate-fade-up">
      <div className="mx-auto h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
        <Film className="h-10 w-10 text-primary" />
      </div>
      <div className="space-y-2">
        <h2 className="font-display text-4xl text-foreground">Sua sala está vazia</h2>
        <p className="text-muted-foreground">
          Comece adicionando um magnet link de um vídeo do qual você tem direito — seus próprios
          arquivos, conteúdo de domínio público ou Creative Commons.
        </p>
      </div>
      <Button onClick={onAdd} size="lg" className="rounded-2xl">
        + Adicionar primeiro vídeo
      </Button>
    </div>
  );
}
