import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Search as SearchIcon } from "lucide-react";
import { AppBottomNav } from "@/components/AppBottomNav";
import { TmdbMovieCard } from "@/components/TmdbMovieCard";
import { TmdbShowCard } from "@/components/TmdbShowCard";
import { TmdbCarouselRow } from "@/components/TmdbCarouselRow";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { getAll, type LibraryItem } from "@/lib/storage";
import {
  tmdbPopular,
  tmdbPopularTv,
  tmdbSearch,
  tmdbSearchTv,
  tmdbTrending,
  tmdbTrendingTv,
  type TmdbSearchItem,
} from "@/lib/tmdb";

export const Route = createFileRoute("/buscar")({
  component: SearchPage,
});

function SearchPage() {
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [mode, setMode] = useState<"movie" | "tv">("movie");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<TmdbSearchItem[]>([]);
  const [trending, setTrending] = useState<TmdbSearchItem[]>([]);
  const [popular, setPopular] = useState<TmdbSearchItem[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [viewAll, setViewAll] = useState<{ title: string; items: TmdbSearchItem[] } | null>(null);

  useEffect(() => {
    getAll().then(setLibrary);
  }, []);

  const libraryIds = useMemo(
    () => new Set(library.map((i) => i.tmdbId).filter((x): x is number => typeof x === "number")),
    [library],
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setInitialLoading(true);
      try {
        const [t, p] =
          mode === "tv"
            ? await Promise.all([tmdbTrendingTv("pt-BR"), tmdbPopularTv("pt-BR")])
            : await Promise.all([tmdbTrending("pt-BR"), tmdbPopular("pt-BR")]);
        if (cancelled) return;
        setTrending(t);
        setPopular(p);
      } catch {
        if (cancelled) return;
        setError("Não foi possível carregar o catálogo do TMDB.");
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    if (!q) {
      setResults([]);
      setError(null);
      setLoading(false);
      return () => {};
    }

    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const r =
          mode === "tv"
            ? await tmdbSearchTv(q, undefined, "pt-BR")
            : await tmdbSearch(q, undefined, "pt-BR");
        if (cancelled) return;
        setResults(r);
      } catch (e: unknown) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "";
        if (msg === "tmdb_not_configured") {
          setError("TMDB não configurado no servidor (TMDB_API_KEY).");
        } else if (msg === "proxy_not_configured") {
          setError("Proxy não configurado (VITE_TORRENT_PROXY_URL).");
        } else {
          setError("Falha ao buscar no TMDB.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, mode]);

  const showCatalog = query.trim().length === 0;

  return (
    <div className="min-h-screen pb-[92px]">
      <div className="sticky top-0 z-30 border-b border-border/40 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto max-w-xl px-4 py-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Acervos de</p>
              <h1 className="font-display text-3xl leading-none tracking-wide text-foreground truncate">
                Buscar
              </h1>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setMode("movie")}
                className={
                  mode === "movie"
                    ? "shrink-0 rounded-full bg-primary/15 text-primary px-4 h-10 text-xs font-medium border border-primary/20"
                    : "shrink-0 rounded-full bg-white/5 text-muted-foreground px-4 h-10 text-xs font-medium border border-border/40 hover:text-foreground hover:bg-white/10 transition"
                }
              >
                Filmes
              </button>
              <button
                onClick={() => setMode("tv")}
                className={
                  mode === "tv"
                    ? "shrink-0 rounded-full bg-primary/15 text-primary px-4 h-10 text-xs font-medium border border-primary/20"
                    : "shrink-0 rounded-full bg-white/5 text-muted-foreground px-4 h-10 text-xs font-medium border border-border/40 hover:text-foreground hover:bg-white/10 transition"
                }
              >
                Séries
              </button>
            </div>
          </div>

          <div className="relative">
            <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={mode === "tv" ? "Buscar séries no TMDB..." : "Buscar filmes no TMDB..."}
              className="pl-11"
            />
          </div>

          {error ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      <main className="mx-auto max-w-xl px-4 py-6 space-y-10">
        {!showCatalog && (
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">Resultados</h2>
              {loading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            </div>

            {results.length === 0 && !loading ? (
              <p className="text-sm text-muted-foreground">Nenhum resultado.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {results.map((r) =>
                  mode === "tv" ? (
                    <TmdbShowCard key={r.id} item={r} />
                  ) : (
                    <TmdbMovieCard key={r.id} item={r} inLibrary={libraryIds.has(r.id)} />
                  ),
                )}
              </div>
            )}
          </section>
        )}

        {showCatalog && (
          <>
            {initialLoading ? (
              <SearchLoading />
            ) : (
              <>
                <TmdbCarouselRow
                  title="Em alta"
                  mode={mode}
                  items={trending.slice(0, 18)}
                  inLibraryIds={libraryIds}
                  onViewAll={() => setViewAll({ title: "Em alta", items: trending })}
                />
                <TmdbCarouselRow
                  title="Populares"
                  mode={mode}
                  items={popular.slice(0, 18)}
                  inLibraryIds={libraryIds}
                  onViewAll={() => setViewAll({ title: "Populares", items: popular })}
                />
              </>
            )}
          </>
        )}
      </main>

      <AppBottomNav />

      <Drawer open={!!viewAll} onOpenChange={(o) => !o && setViewAll(null)}>
        <DrawerContent className="rounded-t-3xl border-border/40 bg-background/95 backdrop-blur-xl">
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-display text-2xl tracking-wide">
              {viewAll?.title ?? ""}
            </DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6">
            <div className="grid grid-cols-3 gap-3">
              {(viewAll?.items ?? []).map((r) =>
                mode === "tv" ? (
                  <TmdbShowCard key={r.id} item={r} />
                ) : (
                  <TmdbMovieCard key={r.id} item={r} inLibrary={libraryIds.has(r.id)} />
                ),
              )}
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function SearchLoading() {
  return (
    <div className="space-y-8">
      {Array.from({ length: 2 }).map((_, idx) => (
        <div key={idx} className="space-y-3">
          <div className="h-4 w-40 rounded bg-white/10 animate-pulse" />
          <div className="-mx-4 px-4 overflow-x-hidden">
            <div className="flex gap-3">
              {Array.from({ length: 4 }).map((__, j) => (
                <div
                  key={j}
                  className="w-[118px] aspect-[2/3] rounded-2xl border border-border/40 bg-white/5 animate-pulse"
                />
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
