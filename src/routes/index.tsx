import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Heart, Clock, Library as LibIcon, Search, Film } from "lucide-react";
import { Header } from "@/components/Header";
import { AddMagnetDialog } from "@/components/AddMagnetDialog";
import { MovieCard } from "@/components/MovieCard";
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

type Tab = "all" | "continue" | "favorites";

function HomePage() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [playing, setPlaying] = useState<LibraryItem | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");

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
  const favorites = useMemo(() => items.filter((i) => i.favorite), [items]);
  const featured = items[0];

  const visible = useMemo(() => {
    let src = items;
    if (tab === "continue") src = continueWatching;
    if (tab === "favorites") src = favorites;
    if (query.trim()) {
      const q = query.toLowerCase();
      src = src.filter((i) => i.title.toLowerCase().includes(q));
    }
    return src;
  }, [tab, items, continueWatching, favorites, query]);

  const handlePlay = (item: LibraryItem) => setPlaying(item);
  const handleToggleFav = async (item: LibraryItem) => {
    setItems(await update(item.id, { favorite: !item.favorite }));
  };
  const handleDelete = async (item: LibraryItem) => {
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
      {featured && featured.poster && (
        <section className="relative h-[55vh] min-h-[380px] overflow-hidden border-b border-border/40">
          <img
            src={featured.poster}
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

      <main className="container mx-auto px-6 py-10 space-y-8">
        {/* Tabs + search */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex gap-1 bg-card/60 backdrop-blur border border-border/40 rounded-lg p-1 w-fit">
            <TabBtn active={tab === "all"} onClick={() => setTab("all")} icon={<LibIcon className="h-4 w-4" />}>
              Biblioteca <span className="opacity-60 ml-1">{items.length}</span>
            </TabBtn>
            <TabBtn active={tab === "continue"} onClick={() => setTab("continue")} icon={<Clock className="h-4 w-4" />}>
              Continuar <span className="opacity-60 ml-1">{continueWatching.length}</span>
            </TabBtn>
            <TabBtn active={tab === "favorites"} onClick={() => setTab("favorites")} icon={<Heart className="h-4 w-4" />}>
              Favoritos <span className="opacity-60 ml-1">{favorites.length}</span>
            </TabBtn>
          </div>

          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar na biblioteca..."
              className="w-full rounded-md bg-card/60 backdrop-blur border border-border/40 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* Grid */}
        {loading ? (
          <p className="text-muted-foreground">Carregando biblioteca...</p>
        ) : visible.length === 0 ? (
          <EmptyState
            tab={tab}
            hasItems={items.length > 0}
            onAdd={() => setShowAdd(true)}
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
            {visible.map((item, idx) => (
              <MovieCard
                key={item.id}
                item={item}
                index={idx}
                onPlay={handlePlay}
                onToggleFav={handleToggleFav}
                onDelete={handleDelete}
              />
            ))}
          </div>
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

function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition ${
        active
          ? "bg-primary text-primary-foreground shadow-glow"
          : "text-muted-foreground hover:text-foreground hover:bg-secondary"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function EmptyState({
  tab,
  hasItems,
  onAdd,
}: {
  tab: Tab;
  hasItems: boolean;
  onAdd: () => void;
}) {
  if (!hasItems) {
    return (
      <div className="text-center py-20 space-y-6 max-w-md mx-auto animate-fade-up">
        <div className="mx-auto h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
          <Film className="h-10 w-10 text-primary" />
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-4xl text-cream">Sua sala está vazia</h2>
          <p className="text-muted-foreground">
            Comece adicionando um magnet link de um vídeo do qual você tem direito —
            seus próprios arquivos, conteúdo de domínio público ou Creative Commons.
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
  return (
    <div className="text-center py-16 text-muted-foreground">
      {tab === "continue"
        ? "Nada para continuar assistindo ainda."
        : tab === "favorites"
        ? "Você ainda não favoritou nenhum vídeo."
        : "Nenhum resultado para sua busca."}
    </div>
  );
}
