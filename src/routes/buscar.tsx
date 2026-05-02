import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Search as SearchIcon } from "lucide-react";
import { Header } from "@/components/Header";
import { TmdbMovieCard } from "@/components/TmdbMovieCard";
import { TmdbShowCard } from "@/components/TmdbShowCard";
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
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-6 py-10 space-y-10">
        <div className="space-y-3">
          <h1 className="font-display text-4xl text-cream">Buscar</h1>
          <div className="flex gap-1 bg-card/60 backdrop-blur border border-border/40 rounded-lg p-1 w-fit">
            <button
              onClick={() => setMode("movie")}
              className={`rounded-md px-3 py-1.5 text-sm transition ${
                mode === "movie"
                  ? "bg-primary text-primary-foreground shadow-glow"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              Filmes
            </button>
            <button
              onClick={() => setMode("tv")}
              className={`rounded-md px-3 py-1.5 text-sm transition ${
                mode === "tv"
                  ? "bg-primary text-primary-foreground shadow-glow"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              Séries
            </button>
          </div>
          <div className="relative w-full max-w-xl">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                mode === "tv"
                  ? "Busque séries no TMDB (ex.: The Office, Dark)..."
                  : "Busque filmes no TMDB (ex.: Interestelar, Matrix)..."
              }
              className="w-full rounded-md bg-card/60 backdrop-blur border border-border/40 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2 max-w-xl">
              {error}
            </p>
          )}
        </div>

        {!showCatalog && (
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-2xl text-cream">Resultados</h2>
              {loading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            </div>

            {results.length === 0 && !loading ? (
              <p className="text-sm text-muted-foreground">Nenhum resultado.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
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
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-2xl text-cream">Em alta</h2>
                {initialLoading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {trending
                  .slice(0, 18)
                  .map((r) =>
                    mode === "tv" ? (
                      <TmdbShowCard key={r.id} item={r} />
                    ) : (
                      <TmdbMovieCard key={r.id} item={r} inLibrary={libraryIds.has(r.id)} />
                    ),
                  )}
              </div>
            </section>

            <section className="space-y-4">
              <h2 className="font-display text-2xl text-cream">Populares</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {popular
                  .slice(0, 18)
                  .map((r) =>
                    mode === "tv" ? (
                      <TmdbShowCard key={r.id} item={r} />
                    ) : (
                      <TmdbMovieCard key={r.id} item={r} inLibrary={libraryIds.has(r.id)} />
                    ),
                  )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
