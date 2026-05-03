import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Film, Copy, Check } from "lucide-react";
import { Header } from "@/components/Header";
import { AddMagnetDialog } from "@/components/AddMagnetDialog";
import { MovieCard } from "@/components/MovieCard";
import { HomeCarouselRow } from "@/components/HomeCarouselRow";
import { MovieDetailsModal } from "@/components/MovieDetailsModal";
import { Player } from "@/components/Player";
import { SeriesCard } from "@/components/SeriesCard";
import { getSeriesAll, type Series } from "@/lib/series";
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

function getProxyBase(): string {
  const env = (import.meta as unknown as { env?: { VITE_TORRENT_PROXY_URL?: string } }).env;
  const raw = env?.VITE_TORRENT_PROXY_URL;
  return typeof raw === "string" ? raw.trim().replace(/\/+$/, "") : "";
}

function getXtreamUser(): string {
  const env = (import.meta as unknown as { env?: { VITE_XTREAM_USER?: string } }).env;
  const raw = env?.VITE_XTREAM_USER;
  return typeof raw === "string" ? raw.trim() : "";
}

function getXtreamPass(): string {
  const env = (import.meta as unknown as { env?: { VITE_XTREAM_PASS?: string } }).env;
  const raw = env?.VITE_XTREAM_PASS;
  return typeof raw === "string" ? raw.trim() : "";
}

function HomePage() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [playing, setPlaying] = useState<LibraryItem | null>(null);
  const [details, setDetails] = useState<LibraryItem | null>(null);
  const [showIptv, setShowIptv] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getAll(), getSeriesAll()]).then(([items, series]) => {
      setItems(items);
      setSeries(series);
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
  const favorites = useMemo(
    () => items.filter((i) => i.favorite).sort((a, b) => b.addedAt - a.addedAt),
    [items],
  );
  const recentlyAdded = useMemo(() => [...items].sort((a, b) => b.addedAt - a.addedAt), [items]);
  const seriesAdded = useMemo(() => [...series].sort((a, b) => b.addedAt - a.addedAt), [series]);
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

  const proxyBase = getProxyBase();
  const xtUser = getXtreamUser();
  const xtPass = getXtreamPass();
  const m3uUrl =
    proxyBase && xtUser && xtPass
      ? `${proxyBase}/playlist.m3u?username=${encodeURIComponent(xtUser)}&password=${encodeURIComponent(xtPass)}`
      : "";

  const copyValue = async (key: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1500);
    } catch {
      void 0;
    }
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
              {featured.year && <p className="text-sm text-muted-foreground">{featured.year}</p>}
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
        ) : items.length === 0 && series.length === 0 ? (
          <EmptyState onAdd={() => setShowAdd(true)} />
        ) : (
          <>
            {items.length > 0 && (
              <>
                <HomeCarouselRow
                  title="Continuar assistindo"
                  items={continueSorted}
                  onOpen={handleOpen}
                  onPlay={handlePlay}
                />
                <HomeCarouselRow
                  title="Minha lista"
                  items={favorites}
                  onOpen={handleOpen}
                  onPlay={handlePlay}
                />
                <HomeCarouselRow
                  title="Adicionados recentemente"
                  items={recentlyAdded}
                  onOpen={handleOpen}
                  onPlay={handlePlay}
                />
                {yearRows.map((row) => (
                  <HomeCarouselRow
                    key={row.year}
                    title={`Ano ${row.year}`}
                    items={row.items}
                    onOpen={handleOpen}
                    onPlay={handlePlay}
                  />
                ))}
              </>
            )}

            {seriesAdded.length > 0 && (
              <section className="space-y-3">
                <h2 className="font-display text-2xl text-cream">Séries</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
                  {seriesAdded.map((s, idx) => (
                    <SeriesCard key={s.tmdbId} series={s} index={idx} />
                  ))}
                </div>
              </section>
            )}

            {items.length > 0 && (
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
            )}
          </>
        )}

        <footer className="pt-12 pb-6 border-t border-border/40 text-center text-xs text-muted-foreground space-y-1">
          <p>
            Buffet de Vídeo é um player WebTorrent. Adicione apenas conteúdo do qual você tem
            direito de acesso.
          </p>
          <button
            type="button"
            onClick={() => setShowIptv(true)}
            className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition"
          >
            <Film className="h-3.5 w-3.5" />
            Conectar IPTV
          </button>
        </footer>
      </main>

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

      {showIptv && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6"
          onClick={() => setShowIptv(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl bg-card border border-border shadow-card p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <h2 className="font-display text-2xl text-cream">Conectar IPTV</h2>
              <p className="text-sm text-muted-foreground">
                Use as credenciais abaixo em apps compatíveis com Xtream Codes ou M3U.
              </p>
            </div>

            <div className="space-y-2">
              {[
                { key: "host", label: "Host", value: proxyBase },
                { key: "user", label: "Usuário", value: xtUser },
                { key: "pass", label: "Senha", value: xtPass },
                { key: "m3u", label: "M3U", value: m3uUrl },
              ].map((row) => (
                <div
                  key={row.key}
                  className="rounded-lg border border-border/40 bg-background/40 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{row.label}</p>
                      <p className="text-sm text-foreground font-mono break-all">
                        {row.value || "-"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyValue(row.key, row.value)}
                      disabled={!row.value}
                      className="rounded-md bg-secondary px-3 py-2 text-xs hover:bg-secondary/80 transition disabled:opacity-50 inline-flex items-center gap-2 shrink-0"
                    >
                      {copiedKey === row.key ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          Copiado
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Copiar
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-border/40 bg-secondary/20 p-3">
              <p className="text-xs text-muted-foreground">
                Apps compatíveis: XCIPTV, TiviMate, GSE IPTV, Smarters Player, VLC (M3U).
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowIptv(false)}
                className="rounded-md px-4 py-2 text-sm hover:bg-secondary transition"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
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
          Comece adicionando um magnet link de um vídeo do qual você tem direito — seus próprios
          arquivos, conteúdo de domínio público ou Creative Commons.
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
