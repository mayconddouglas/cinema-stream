import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Play, Plus, Pencil } from "lucide-react";
import { Header } from "@/components/Header";
import { Player } from "@/components/Player";
import { tmdbTv, tmdbTvSeason, type TmdbTvEpisode } from "@/lib/tmdb";
import {
  episodeId,
  getEpisodesForShow,
  getSeriesAll,
  parseEpisodeFromName,
  patchEpisode,
  upsertEpisodesBulk,
  upsertSeries,
  type Episode,
} from "@/lib/series";

type ProxyMetaFile = { index: number; name: string; kind: string };
type ProxyMeta = { bestVideoIndex: number | null; files: ProxyMetaFile[] };

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
  const [addingMagnetFor, setAddingMagnetFor] = useState<string | null>(null);
  const [episodeMagnet, setEpisodeMagnet] = useState("");
  const [episodeImporting, setEpisodeImporting] = useState(false);
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
    const run = async () => {
      const all = await getSeriesAll();
      const existing = all.find((s) => s.tmdbId === show.id) ?? null;
      await upsertSeries({
        tmdbId: show.id,
        title: show.title,
        originalTitle: show.originalTitle,
        overview: show.overview,
        year: show.year,
        poster: show.poster,
        backdrop: show.backdrop,
        addedAt: existing?.addedAt ?? Date.now(),
      });
    };
    void run();
  }, [show.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAddingMagnetFor(null);
        setEpisodeMagnet("");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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

  const configuredCount = useMemo(() => {
    return localEpisodes.filter((e) => e.season === season && !!e.magnet).length;
  }, [localEpisodes, season]);

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

  const importSingleEpisodeMagnet = async (
    id: string,
    seasonNum: number,
    episodeNum: number,
    tmdbEp: TmdbTvEpisode,
  ) => {
    const base = getProxyBase();
    const m = episodeMagnet.trim();
    if (!base) {
      setError("Proxy não configurado.");
      return;
    }
    if (!m.startsWith("magnet:?")) {
      setError("Magnet inválido.");
      return;
    }

    setEpisodeImporting(true);
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

      let bestFileIndex = 0;
      try {
        const metaRes = await fetch(`${base}/meta?magnet=${encodeURIComponent(m)}`);
        if (metaRes.ok) {
          const meta = (await metaRes.json()) as {
            bestVideoIndex?: number | null;
            files?: unknown[];
          };
          if (typeof meta.bestVideoIndex === "number") {
            bestFileIndex = meta.bestVideoIndex;
          }
        }
      } catch {
        bestFileIndex = 0;
      }

      const existing = localByKey.get(id);
      const entry: Episode = {
        id,
        showTmdbId: show.id,
        season: seasonNum,
        episode: episodeNum,
        name: tmdbEp.name || `S${pad2(seasonNum)}E${pad2(episodeNum)}`,
        overview: tmdbEp.overview ?? null,
        still: tmdbEp.still ?? null,
        runtime: tmdbEp.runtime ?? null,
        magnet: m,
        fileIndex: bestFileIndex,
        addedAt: existing?.addedAt ?? Date.now(),
        progress: existing?.progress ?? 0,
        duration: existing?.duration ?? 0,
        lastPlayedAt: existing?.lastPlayedAt ?? 0,
      };

      const allLocal = [...localEpisodes];
      const idx = allLocal.findIndex((x) => x.id === id);
      if (idx >= 0) allLocal[idx] = { ...allLocal[idx], ...entry };
      else allLocal.push(entry);

      const saved = await upsertEpisodesBulk(show.id, allLocal);
      setLocalEpisodes(saved);
      setAddingMagnetFor(null);
      setEpisodeMagnet("");
    } catch {
      setError("Falha ao salvar o episódio. Verifique o magnet e tente novamente.");
    } finally {
      setEpisodeImporting(false);
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
            <div className="text-xs text-muted-foreground">Importar season pack (opcional)</div>
            <div className="flex gap-2">
              <input
                value={magnet}
                onChange={(e) => setMagnet(e.target.value)}
                placeholder="Season pack (opcional) — magnet com todos os episódios da temporada"
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
          <div className="flex items-center justify-between">
            <h2 className="font-display text-3xl text-cream">Episódios</h2>
            {episodes.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {configuredCount}
                {" / "}
                {episodes.length} configurados
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Carregando episódios...
            </div>
          ) : (
            <div className="grid gap-3">
              {episodes.length > 0 && configuredCount === 0 && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground flex items-start gap-3">
                  <span className="text-primary text-base shrink-0">💡</span>
                  <span>
                    Clique em <strong className="text-foreground">"Adicionar magnet"</strong> em
                    cada episódio para configurá-lo individualmente, ou cole um season pack no campo
                    acima para importar a temporada inteira de uma vez.
                  </span>
                </div>
              )}
              {episodes.map((ep) => {
                const id = episodeId(show.id, season, ep.episode);
                const local = localByKey.get(id) ?? null;
                const canPlay = !!local?.magnet;
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
                      <div className="relative aspect-video md:aspect-auto md:h-full bg-secondary">
                        {canPlay ? (
                          <div className="absolute top-2 left-2 bg-green-500/90 text-white text-[10px] rounded-full px-2 py-0.5 font-medium">
                            ✓ Configurado
                          </div>
                        ) : (
                          <div className="absolute top-2 left-2 bg-black/60 text-white/50 text-[10px] rounded-full px-2 py-0.5">
                            Sem magnet
                          </div>
                        )}
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
                          <div className="flex items-center gap-2">
                            {canPlay && (
                              <button
                                onClick={() => {
                                  setAddingMagnetFor(id);
                                  setEpisodeMagnet(local?.magnet ?? "");
                                }}
                                className="rounded-md bg-secondary/60 px-2 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition min-h-[40px] min-w-[40px] flex items-center justify-center"
                                title="Editar magnet"
                                aria-label="Editar magnet"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => {
                                if (!canPlay || !local) return;
                                setPlaying({
                                  id: local.id,
                                  title: `${show.title} — S${pad2(local.season)}E${pad2(
                                    local.episode,
                                  )}`,
                                  magnet: local.magnet!,
                                  description: ep.overview ?? undefined,
                                  poster: ep.still ?? undefined,
                                  year: show.year ?? undefined,
                                  fileIndex: local.fileIndex ?? null,
                                });
                              }}
                              disabled={!canPlay}
                              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:brightness-110 transition disabled:opacity-40 min-h-[40px]"
                            >
                              <Play className="h-4 w-4 fill-current" />
                              {pct > 0 && pct < 95 ? "Continuar" : "Assistir"}
                            </button>
                          </div>
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
                          <button
                            onClick={() => {
                              setAddingMagnetFor(id);
                              setEpisodeMagnet("");
                            }}
                            className="inline-flex items-center gap-2 rounded-md bg-secondary/60 px-3 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition min-h-[40px]"
                          >
                            <Plus className="h-4 w-4" />
                            Adicionar magnet
                          </button>
                        )}
                      </div>
                    </div>

                    {addingMagnetFor === id && (
                      <div className="border-t border-border/40 px-4 py-3 bg-black/20 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          autoFocus
                          value={episodeMagnet}
                          onChange={(e) => setEpisodeMagnet(e.target.value)}
                          placeholder="magnet:?xt=urn:btih:... (magnet deste episódio)"
                          className="flex-1 rounded-md bg-background/60 border border-border/40 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                        />
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => {
                              setAddingMagnetFor(null);
                              setEpisodeMagnet("");
                            }}
                            className="rounded-md bg-secondary px-3 py-2 text-sm hover:bg-secondary/80 transition min-h-[40px]"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={() =>
                              importSingleEpisodeMagnet(id, ep.season ?? season, ep.episode, ep)
                            }
                            disabled={
                              episodeImporting || !episodeMagnet.trim().startsWith("magnet:?")
                            }
                            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:brightness-110 transition disabled:opacity-50 min-h-[40px]"
                          >
                            {episodeImporting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Plus className="h-4 w-4" />
                            )}
                            Salvar
                          </button>
                        </div>
                      </div>
                    )}
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
