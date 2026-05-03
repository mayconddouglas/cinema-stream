import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Film, Plus } from "lucide-react";
import { AppBottomNav } from "@/components/AppBottomNav";
import { AddMagnetDialog } from "@/components/AddMagnetDialog";
import { MovieDetailsModal } from "@/components/MovieDetailsModal";
import { MovieTile } from "@/components/MovieTile";
import { Button } from "@/components/ui/button";
import { openVlcFromMagnet } from "@/lib/vlc";
import { getAll, remove, update, type LibraryItem } from "@/lib/storage";

export const Route = createFileRoute("/minha-lista")({
  head: () => ({
    meta: [{ title: "Minha lista — Acervos de Filmes" }],
  }),
  component: FavoritesPage,
});

function FavoritesPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [details, setDetails] = useState<LibraryItem | null>(null);

  useEffect(() => {
    getAll().then((items) => {
      setItems(items);
      setLoading(false);
    });
  }, []);

  const favorites = useMemo(
    () => items.filter((i) => i.favorite).sort((a, b) => b.addedAt - a.addedAt),
    [items],
  );

  const handleToggleFav = async (item: LibraryItem) => {
    setItems(await update(item.id, { favorite: !item.favorite }));
  };

  return (
    <div className="min-h-screen pb-[92px]">
      <div className="sticky top-0 z-30 border-b border-border/40 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto max-w-xl px-4 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Minha</p>
            <h1 className="font-display text-3xl leading-none tracking-wide text-foreground truncate">
              Lista
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

      <main className="mx-auto max-w-xl px-4 py-6 space-y-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : favorites.length === 0 ? (
          <div className="rounded-3xl border border-border/40 bg-white/5 p-6 space-y-4 text-center">
            <div className="mx-auto h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Film className="h-8 w-8 text-primary" />
            </div>
            <div className="space-y-2">
              <h2 className="font-display text-3xl text-foreground">Nada salvo ainda</h2>
              <p className="text-sm text-muted-foreground">
                Toque no ⭐ em qualquer card para adicionar aqui.
              </p>
            </div>
            <Button onClick={() => (window.location.href = "/")} size="lg" className="rounded-2xl">
              Ir para Home
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {favorites.map((item) => (
              <MovieTile
                key={item.id}
                item={item}
                onOpen={(it) => {
                  if (typeof it.tmdbId === "number" && it.tmdbId > 0) {
                    navigate({ to: "/filme/$tmdbId", params: { tmdbId: String(it.tmdbId) } });
                    return;
                  }
                  setDetails(it);
                }}
                onPlay={(it) => {
                  openVlcFromMagnet({
                    magnet: it.magnet,
                    fileIndex: it.fileIndex,
                    startSeconds: it.progress ?? 0,
                  }).catch(() => void 0);
                }}
                onToggleFav={handleToggleFav}
              />
            ))}
          </div>
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
          openVlcFromMagnet({
            magnet: item.magnet,
            fileIndex: item.fileIndex,
            startSeconds: item.progress ?? 0,
          }).catch(() => void 0);
        }}
        onToggleFav={handleToggleFav}
        onDelete={async (item) => {
          await remove(item.id);
          const next = await getAll();
          setItems(next);
          setDetails(null);
        }}
      />
    </div>
  );
}
