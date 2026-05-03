import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Play, Plus } from "lucide-react";
import { Header } from "@/components/Header";
import { Player } from "@/components/Player";
import { tmdbTv, tmdbTvSeason, type TmdbTvEpisode } from "@/lib/tmdb";
import {
  episodeId,
  getEpisodesForShow,
  parseEpisodeFromName,
  patchEpisode,
  upsertEpisodesBulk,
  upsertSeries,
  type Episode,
} from "@/lib/series";

type ProxyMetaFile = { index: number; name: string; kind: string };
type ProxyMeta = { files: ProxyMetaFile[] };

export const Route = createFileRoute("/serie/$tmdbId")({
  loader: async ({ params }) => {
    const id = Number(params.tmdbId);
    if (!Number.isFinite(id) || id <= 0) throw new Error("invalid_tmdb_id");
    return tmdbTv(id, "pt-BR");
  },
  component: SeriesDetailsPage,
});

function getProxyBase() {
  const env = (import.meta as unknown as { env?: { VITE_TORRENT_PROXY_URL?: string } }).env;
  const raw = env?.VITE_TORRENT_PROXY_URL;
  return typeof raw === "string" ? raw.trim().replace(/\/+$/, "") : "";
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function SeriesDetailsPage() {
  const show = Route.useLoaderData();
  const navigate = useNavigate();
  const [season, setSeason] = useState<number>(() => {
    const s = show.seasons.find((x) => x.seasonNumber > 0)?.seasonNumber ?? 1;
    return s;
  });
  const [episodes, setEpisodes] = useState<TmdbTvEpisode[]>([]);
  const [localEpisodes, setLocalEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [magnet, setMagnet] = useState("");
  const [importing, setImporting] = useState(false);
  const [playing, setPlaying] = useState<{
    id: string;
    title: string;
    magnet: string;
    description?: string;
    poster?: string;
    year?: string;
    fileIndex?: number | null;
  } | null>(null);

  useEffect(() => {
    getEpisodesForShow(show.id).then(setLocalEpisodes);
  }, [show.id]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const eps = await tmdbTvSeason(show.id, season, "pt-BR");
        if (cancelled) return;
        setEpisodes(eps);
      } catch {
        if (cancelled) return;
        setError("Não foi possível carregar os episódios.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [show.id, season]);

  const localByKey = useMemo(() => {
    const map = new Map<string, Episode>();
    for (const e of localEpisodes) map.set(e.id, e);
    return map;
  }, [localEpisodes]);

  const goBack = () => {
    navigate({ to: "/" });
  };

  const importSeasonPack = async () => {
    const base = getProxyBase();
    const m = magnet.trim();
    if (!base) {
      setError("Proxy não configurado (VITE_TORRENT_PROXY_URL).");
      return;
    }
    if (!m.startsWith("magnet:?")) {
      setError("Cole um magnet válido.");
      return;
    }

    setImporting(true);
    setError(null);
    try {
      await upsertSeries({
        tmdbId: show.id,
        title: show.title,
        originalTitle: show.originalTitle,
        overview: show.overview,
        year: show.year,
        poster: show.poster,
        backdrop: show.backdrop,
        addedAt: Date.now(),
      });

      const metaRes = await fetch(`${base}/meta?magnet=${encodeURIComponent(m)}`);
      if (!metaRes.ok) throw new Error("meta_failed");
      const meta = (await metaRes.json()) as ProxyMeta;
      const files = Array.isArray(meta?.files) ? meta.files : [];

      const matches = files
        .filter((f) => f.kind === "video" && Number.isFinite(f.index) && typeof f.name === "string")
        .map((f) => ({ index: Number(f.index), name: String(f.name) }))
        .map((f) => {
          const ep = parseEpisodeFromName(f.name);
          return ep ? { ...f, ...ep } : null;
        })
        .filter(Boolean)
        .filter((f): f is { index: number; name: string; season: number; episode: number } => !!f)
        .filter((f) => f.season === season);

      const next = [...localEpisodes];
      for (const f of matches) {
        const id = episodeId(show.id, f.season, f.episode);
        const existing = localByKey.get(id);
        const title = `S${pad2(f.season)}E${pad2(f.episode)}`;
        const metaEp = episodes.find((e) => e.episode === f.episode);

        const entry: Episode = {
          id,
          showTmdbId: show.id,
          season: f.season,
          episode: f.episode,
          name: metaEp?.name ?? title,
          overview: metaEp?.overview ?? null,
          still: metaEp?.still ?? null,
          runtime: metaEp?.runtime ?? null,
          magnet: m,
          fileIndex: f.index,
          addedAt: existing?.addedAt ?? Date.now(),
          progress: existing?.progress ?? 0,
          duration: existing?.duration ?? 0,
          lastPlayedAt: existing?.lastPlayedAt ?? 0,
        };

        const idx = next.findIndex((x) => x.id === id);
        if (idx >= 0) next[idx] = { ...next[idx], ...entry };
        else next.push(entry);
      }

      const saved = await upsertEpisodesBulk(show.id, next);
      setLocalEpisodes(saved);
      setMagnet("");
    } catch {
      setError("Falha ao importar a temporada. Verifique o magnet e tente novamente.");
    } finally {
      setImporting(false);
    }
  };

  const handleProgress = async (id: string, patch: Partial<Episode>) => {
    const updated = await patchEpisode(id, patch);
    if (!updated) return;
    setLocalEpisodes((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const backdrop = show.backdrop ?? show.poster;
  const seasons = show.seasons
    .filter((s) => s.seasonNumber > 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber);

  return (
    <div className="min-h-screen">
      <Header />

      <section className="relative overflow-hidden border-b border-border/40">
        <div className="relative h-[45vh] min-h-[360px]">
          {backdrop ? (
            <>
              <img
                src={backdrop}
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0" style={{ background: "var(--gradient-hero)" }} />
            </>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-secondary to-black" />
          )}

          <div className="container mx-auto h-full flex items-end px-6 pb-10 relative">
            <div className="max-w-3xl space-y-3">
              <button
                onClick={goBack}
                className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition"
              >
                <ArrowLeft className="h-4 w-4" />
                Voltar
              </button>
              <h1 className="font-display text-5xl md:text-6xl leading-none text-cream">
                {show.title}
              </h1>
              {show.overview && (
                <p className="text-sm text-muted-foreground line-clamp-3 max-w-2xl">
                  {show.overview}
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <main className="container mx-auto px-6 py-10 space-y-8">
        <div className="grid gap-3 md:grid-cols-3 bg-card/60 backdrop-blur rounded-lg px-4 py-4 border border-border/40">
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground">Temporada</div>
            <select
              value={season}
              onChange={(e) => setSeason(Number(e.target.value))}
              className="w-full rounded-md bg-background/60 border border-border/40 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {seasons.map((s) => (
                <option key={s.seasonNumber} value={s.seasonNumber}>
                  {s.name || `Temporada ${s.seasonNumber}`}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <div className="text-xs text-muted-foreground">Adicionar temporada (1 magnet)</div>
            <div className="flex gap-2">
              <input
                value={magnet}
                onChange={(e) => setMagnet(e.target.value)}
                placeholder="Cole o magnet da temporada completa..."
                className="flex-1 rounded-md bg-background/60 border border-border/40 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={importSeasonPack}
                disabled={importing || !magnet.trim()}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:brightness-110 transition disabled:opacity-50"
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Importar
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">
            {error}
          </div>
        )}

        <section className="space-y-3">
          <h2 className="font-display text-3xl text-cream">Episódios</h2>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Carregando episódios...
            </div>
          ) : (
            <div className="grid gap-3">
              {episodes.map((ep) => {
                const id = episodeId(show.id, season, ep.episode);
                const local = localByKey.get(id) ?? null;
                const canPlay = !!local?.magnet && typeof local?.fileIndex === "number";
                const pct =
                  local?.progress && local?.duration
                    ? Math.min(100, Math.round((local.progress / local.duration) * 100))
                    : 0;

                return (
                  <div
                    key={id}
                    className="rounded-lg bg-card/60 backdrop-blur border border-border/40 overflow-hidden"
                  >
                    <div className="grid md:grid-cols-[240px_1fr] gap-0">
                      <div className="aspect-video md:aspect-auto md:h-full bg-secondary">
                        {ep.still ? (
                          <img
                            src={ep.still}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-full w-full bg-secondary" />
                        )}
                      </div>
                      <div className="p-4 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs text-muted-foreground">{`S${pad2(season)}E${pad2(ep.episode)}`}</div>
                            <div className="text-lg text-cream font-medium line-clamp-1">
                              {ep.name || "Episódio"}
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              if (!canPlay || !local) return;
                              setPlaying({
                                id: local.id,
                                title: `${show.title} — S${pad2(local.season)}E${pad2(local.episode)}`,
                                magnet: local.magnet!,
                                description: ep.overview ?? undefined,
                                poster: ep.still ?? undefined,
                                year: show.year ?? undefined,
                                fileIndex: local.fileIndex ?? null,
                              });
                            }}
                            disabled={!canPlay}
                            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:brightness-110 transition disabled:opacity-40"
                          >
                            <Play className="h-4 w-4 fill-current" />
                            {pct > 0 && pct < 95 ? "Continuar" : "Assistir"}
                          </button>
                        </div>

                        {ep.overview && (
                          <div className="text-sm text-muted-foreground line-clamp-2">
                            {ep.overview}
                          </div>
                        )}

                        {pct > 0 && pct < 95 && (
                          <div className="h-1 rounded-full bg-secondary overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                        )}

                        {!canPlay && (
                          <div className="text-xs text-muted-foreground">
                            Magnet não configurado para este episódio. Use “Importar” com o magnet
                            da temporada completa.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {playing && (
        <Player
          item={{
            id: playing.id,
            title: playing.title,
            magnet: playing.magnet,
            poster: playing.poster,
            year: playing.year,
            description: playing.description,
            addedAt: Date.now(),
          }}
          fileIndex={typeof playing.fileIndex === "number" ? playing.fileIndex : undefined}
          onClose={() => setPlaying(null)}
          onProgress={(id, patch) => handleProgress(id, patch)}
        />
      )}
    </div>
  );
}
