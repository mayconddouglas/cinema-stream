import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Film } from "lucide-react";
import { Header } from "@/components/Header";
import { AddMagnetDialog } from "@/components/AddMagnetDialog";
import { MovieCard } from "@/components/MovieCard";
import { HomeCarouselRow } from "@/components/HomeCarouselRow";
import { MovieDetailsModal } from "@/components/MovieDetailsModal";
import { Player } from "@/components/Player";
import { getAll, remove, update, type LibraryItem } from "@/lib/storage";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Buffet de Vídeo — Sua biblioteca pessoal de streaming" },
      {
        name: "description",
        content:
          "Streaming de vídeo via WebTorrent direto no navegador. Adicione seus magnet links, organize sua biblioteca e assista com Plyr.",
      },
      { property: "og:title", content: "Buffet de Vídeo" },
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
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [playing, setPlaying] = useState<LibraryItem | null>(null);
  const [details, setDetails] = useState<LibraryItem | null>(null);

  useEffect(() => {
    getAll().then((items) => {
      setItems(items);
      setLoading(false);
    });
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
  const favorites = useMemo(() => items.filter((i) => i.favorite).sort((a, b) => b.addedAt - a.addedAt), [items]);
  const recentlyAdded = useMemo(() => [...items].sort((a, b) => b.addedAt - a.addedAt), [items]);
  const featured = recentlyAdded[0];
  const featuredBackdrop = featured?.backdrop ?? featured?.poster;

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

  return (
    <div className="min-h-screen">
      <Header onAdd={() => setShowAdd(true)} />

      {/* Hero */}
      {featured && featuredBackdrop && (
        <section className="relative h-[55vh] min-h-[380px] overflow-hidden border-b border-border/40">
          <img
            src={featuredBackdrop}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover scale-110 blur-2xl opacity-50"
          />
          <div className="absolute inset-0" style={{ background: "var(--gradient-hero)" }} />
          <div className="container mx-auto h-full flex items-end px-6 pb-12 relative">
            <div className="max-w-2xl space-y-4 animate-fade-up">
              <span className="inline-block text-xs tracking-[0.3em] uppercase text-primary">
                Em destaque
              </span>
              <h1 className="font-display text-6xl md:text-7xl leading-none text-cream">
                {featured.title}
              </h1>
              {featured.year && (
                <p className="text-sm text-muted-foreground">{featured.year}</p>
              )}
              {featured.description && (
                <p className="text-base text-muted-foreground line-clamp-3 max-w-xl">
                  {featured.description}
                </p>
              )}
              <button
                onClick={() => handlePlay(featured)}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-glow hover:brightness-110 transition"
              >
                ▶ Assistir agora
              </button>
            </div>
          </div>
        </section>
      )}

      <main className="container mx-auto px-6 py-10 space-y-10">
        {loading ? (
          <p className="text-muted-foreground">Carregando biblioteca...</p>
        ) : items.length === 0 ? (
          <EmptyState onAdd={() => setShowAdd(true)} />
        ) : (
          <>
            <HomeCarouselRow title="Continuar assistindo" items={continueSorted} onOpen={handleOpen} onPlay={handlePlay} />
            <HomeCarouselRow title="Minha lista" items={favorites} onOpen={handleOpen} onPlay={handlePlay} />
            <HomeCarouselRow title="Adicionados recentemente" items={recentlyAdded} onOpen={handleOpen} onPlay={handlePlay} />
            {yearRows.map((row) => (
              <HomeCarouselRow
                key={row.year}
                title={`Ano ${row.year}`}
                items={row.items}
                onOpen={handleOpen}
                onPlay={handlePlay}
              />
            ))}

            <section className="space-y-3">
              <h2 className="font-display text-2xl text-cream">Biblioteca</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
                {recentlyAdded.map((item, idx) => (
                  <MovieCard
                    key={item.id}
                    item={item}
                    index={idx}
                    onPlay={handlePlay}
                    onOpen={handleOpen}
                    onToggleFav={handleToggleFav}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </section>
          </>
        )}

        <footer className="pt-12 pb-6 border-t border-border/40 text-center text-xs text-muted-foreground space-y-1">
          <p>
            Buffet de Vídeo é um player WebTorrent. Adicione apenas conteúdo do qual você
            tem direito de acesso.
          </p>
        </footer>
      </main>

      <AddMagnetDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdded={setItems}
      />
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
        <Player
          item={playing}
          onClose={() => setPlaying(null)}
          onProgress={handleProgress}
        />
      )}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="text-center py-20 space-y-6 max-w-md mx-auto animate-fade-up">
      <div className="mx-auto h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
        <Film className="h-10 w-10 text-primary" />
      </div>
      <div className="space-y-2">
        <h2 className="font-display text-4xl text-cream">Sua sala está vazia</h2>
        <p className="text-muted-foreground">
          Comece adicionando um magnet link de um vídeo do qual você tem direito — seus
          próprios arquivos, conteúdo de domínio público ou Creative Commons.
        </p>
      </div>
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-glow hover:brightness-110 transition"
      >
        + Adicionar primeiro vídeo
      </button>
    </div>
  );
}
