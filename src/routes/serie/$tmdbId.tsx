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

type DetectedEpisode = {
  fileIndex: number;
  fileName: string;
  fileLength: number;
  season: number;
  episode: number;
  tmdbEp: TmdbTvEpisode | null;
  matched: boolean;
};

type PackPreview = {
  magnet: string;
  detectedEpisodes: DetectedEpisode[];
  unmatchedFiles: { fileIndex: number; fileName: string; fileLength: number }[];
  seasons: number[];
  status: "loading" | "ready" | "error";
  errorMsg: string | null;
};

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
  const [packPreview, setPackPreview] = useState<PackPreview | null>(null);
  const [packImporting, setPackImporting] = useState(false);
  const [selectedSeasonFilter, setSelectedSeasonFilter] = useState<number | "all">("all");
  const [episodeProbeLoading, setEpisodeProbeLoading] = useState(false);
  const [episodePreview, setEpisodePreview] = useState<DetectedEpisode | null>(null);
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

  useEffect(() => {
    setPackPreview(null);
    setMagnet("");
    setEpisodePreview(null);
    setAddingMagnetFor(null);
    setEpisodeMagnet("");
    setSelectedSeasonFilter("all");
  }, [season]);

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

  const probeSeasonPack = async (magnetValue: string) => {
    const base = getProxyBase();
    const m = magnetValue.trim();
    if (!base || !m.startsWith("magnet:?")) return;

    setPackPreview({
      magnet: m,
      detectedEpisodes: [],
      unmatchedFiles: [],
      seasons: [],
      status: "loading",
      errorMsg: null,
    });

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 35_000);
      const res = await fetch(`${base}/meta?magnet=${encodeURIComponent(m)}`, {
        signal: ctrl.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        let msg = `Proxy retornou ${res.status}.`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error === "metadata_timeout") {
            msg = "Torrent sem peers no momento. Tente novamente em alguns segundos.";
          }
          if (body.error === "invalid_magnet") msg = "Magnet inválido.";
        } catch {
          void 0;
        }
        setPackPreview((p) => (p ? { ...p, status: "error", errorMsg: msg } : null));
        return;
      }

      const meta = (await res.json()) as {
        files?: { index: number; name: string; length: number; kind: string }[];
      };

      const VIDEO_RE = /\.(mp4|webm|mkv|m4v|mov|avi|ts|m2ts|mpg|mpeg|wmv|flv)$/i;
      const videoFiles = (meta.files ?? []).filter(
        (f) => f.kind === "video" || VIDEO_RE.test(String(f.name ?? "")),
      );

      const detected: DetectedEpisode[] = [];
      const unmatched: { fileIndex: number; fileName: string; fileLength: number }[] = [];
      const seasonSet = new Set<number>();

      for (const f of videoFiles) {
        const parsed = parseEpisodeFromName(f.name);
        if (parsed) {
          seasonSet.add(parsed.season);
          const tmdbEp =
            episodes.find((e) => e.episode === parsed.episode && season === parsed.season) ?? null;
          detected.push({
            fileIndex: Number(f.index),
            fileName: String(f.name),
            fileLength: Number(f.length) || 0,
            season: parsed.season,
            episode: parsed.episode,
            tmdbEp,
            matched: true,
          });
        } else {
          unmatched.push({
            fileIndex: Number(f.index),
            fileName: String(f.name),
            fileLength: Number(f.length) || 0,
          });
        }
      }

      detected.sort((a, b) => a.season - b.season || a.episode - b.episode);
      const seasonsFound = Array.from(seasonSet).sort((a, b) => a - b);

      if (seasonsFound.length > 1 && seasonsFound.includes(season)) {
        setSelectedSeasonFilter(season);
      } else if (seasonsFound.length === 1) {
        setSelectedSeasonFilter(seasonsFound[0]);
      } else {
        setSelectedSeasonFilter("all");
      }

      setPackPreview({
        magnet: m,
        detectedEpisodes: detected,
        unmatchedFiles: unmatched,
        seasons: seasonsFound,
        status: "ready",
        errorMsg: null,
      });
    } catch (e) {
      const isAbort = e instanceof Error && e.name === "AbortError";
      setPackPreview((p) =>
        p
          ? {
              ...p,
              status: "error",
              errorMsg: isAbort
                ? "Análise demorou demais. Tente novamente."
                : "Falha ao analisar o torrent.",
            }
          : null,
      );
    }
  };

  const confirmImportPack = async () => {
    if (!packPreview || packPreview.status !== "ready") return;

    const toImport = packPreview.detectedEpisodes.filter((ep) =>
      selectedSeasonFilter === "all" ? true : ep.season === selectedSeasonFilter,
    );

    if (toImport.length === 0) {
      setError("Nenhum episódio selecionado para importar.");
      return;
    }

    setPackImporting(true);
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

      const next = [...localEpisodes];

      for (const det of toImport) {
        const id = episodeId(show.id, det.season, det.episode);
        const existing = localByKey.get(id);
        const tmdbEp =
          det.tmdbEp ??
          episodes.find((e) => e.episode === det.episode && det.season === season) ??
          null;

        const label = `S${pad2(det.season)}E${pad2(det.episode)}`;

        const entry: Episode = {
          id,
          showTmdbId: show.id,
          season: det.season,
          episode: det.episode,
          name: tmdbEp?.name ?? label,
          overview: tmdbEp?.overview ?? null,
          still: tmdbEp?.still ?? null,
          runtime: tmdbEp?.runtime ?? null,
          magnet: packPreview.magnet,
          fileIndex: det.fileIndex,
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
      setPackPreview(null);
      setSelectedSeasonFilter("all");
    } catch {
      setError("Falha ao importar episódios. Tente novamente.");
    } finally {
      setPackImporting(false);
    }
  };

  const probeEpisodeMagnet = async (
    magnetValue: string,
    targetEpisodeNum: number,
    targetSeason: number,
  ) => {
    const base = getProxyBase();
    if (!base || !magnetValue.trim().startsWith("magnet:?")) {
      setEpisodePreview(null);
      return;
    }

    setEpisodeProbeLoading(true);
    setEpisodePreview(null);

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 30_000);
      const res = await fetch(`${base}/meta?magnet=${encodeURIComponent(magnetValue.trim())}`, {
        signal: ctrl.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        setEpisodeProbeLoading(false);
        return;
      }

      const meta = (await res.json()) as {
        bestVideoIndex?: number | null;
        files?: { index: number; name: string; length: number; kind: string }[];
      };

      const VIDEO_RE = /\.(mp4|webm|mkv|m4v|mov|avi|ts|m2ts|mpg|mpeg|wmv|flv)$/i;
      const videoFiles = (meta.files ?? []).filter(
        (f) => f.kind === "video" || VIDEO_RE.test(String(f.name ?? "")),
      );

      if (videoFiles.length === 0) {
        setEpisodeProbeLoading(false);
        return;
      }

      let bestFile = videoFiles.find((f) => {
        const parsed = parseEpisodeFromName(f.name);
        return parsed && parsed.season === targetSeason && parsed.episode === targetEpisodeNum;
      });

      if (!bestFile) {
        const bestIdx = typeof meta.bestVideoIndex === "number" ? meta.bestVideoIndex : null;
        bestFile =
          bestIdx !== null
            ? (videoFiles.find((f) => f.index === bestIdx) ?? videoFiles[0])
            : videoFiles[0];
      }

      const parsedFromName = parseEpisodeFromName(bestFile.name);
      const tmdbEp = episodes.find((e) => e.episode === targetEpisodeNum) ?? null;

      setEpisodePreview({
        fileIndex: Number(bestFile.index),
        fileName: String(bestFile.name),
        fileLength: Number(bestFile.length) || 0,
        season: parsedFromName?.season ?? targetSeason,
        episode: parsedFromName?.episode ?? targetEpisodeNum,
        tmdbEp,
        matched: !!parsedFromName,
      });
    } catch {
      void 0;
    } finally {
      setEpisodeProbeLoading(false);
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

      if (
        episodePreview &&
        episodePreview.season === seasonNum &&
        episodePreview.episode === episodeNum
      ) {
        bestFileIndex = episodePreview.fileIndex;
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
      setEpisodePreview(null);
      setEpisodeProbeLoading(false);
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
                onChange={(e) => {
                  const v = e.target.value;
                  setMagnet(v);
                  setPackPreview(null);
                  setSelectedSeasonFilter("all");
                  setError(null);
                  if (v.trim().startsWith("magnet:?")) {
                    const w = window as { _packProbeTimer?: ReturnType<typeof setTimeout> };
                    clearTimeout(w._packProbeTimer);
                    w._packProbeTimer = setTimeout(() => {
                      void probeSeasonPack(v);
                    }, 900);
                  }
                }}
                placeholder="Season pack (opcional) — magnet com todos os episódios da temporada"
                className="flex-1 rounded-md bg-background/60 border border-border/40 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={
                  packPreview?.status === "ready"
                    ? confirmImportPack
                    : () => void probeSeasonPack(magnet)
                }
                disabled={packImporting || packPreview?.status === "loading" || !magnet.trim()}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:brightness-110 transition disabled:opacity-50"
              >
                {packPreview?.status === "loading" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Analisando...
                  </>
                ) : packPreview?.status === "ready" ? (
                  <>
                    <Plus className="h-4 w-4" />
                    Confirmar importação
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Analisar
                  </>
                )}
              </button>
            </div>

            {packPreview && packPreview.status === "loading" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2 px-1">
                <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                Analisando arquivos do torrent...
              </div>
            )}

            {packPreview && packPreview.status === "error" && (
              <div className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">
                {packPreview.errorMsg}
              </div>
            )}

            {packPreview && packPreview.status === "ready" && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3 mt-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-foreground">
                      {packPreview.detectedEpisodes.length} episódio
                      {packPreview.detectedEpisodes.length !== 1 ? "s" : ""} detectado
                      {packPreview.detectedEpisodes.length !== 1 ? "s" : ""}
                      {packPreview.unmatchedFiles.length > 0 && (
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          · {packPreview.unmatchedFiles.length} arquivo
                          {packPreview.unmatchedFiles.length !== 1 ? "s" : ""} sem padrão
                        </span>
                      )}
                    </p>
                    {packPreview.seasons.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Temporada{packPreview.seasons.length > 1 ? "s" : ""}:{" "}
                        {packPreview.seasons.map((s) => `T${pad2(s)}`).join(", ")}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPackPreview(null);
                      setMagnet("");
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground transition shrink-0"
                  >
                    Limpar
                  </button>
                </div>

                {packPreview.seasons.length > 1 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">Importar:</span>
                    <button
                      type="button"
                      onClick={() => setSelectedSeasonFilter("all")}
                      className={`rounded-full px-3 py-1 text-xs transition ${
                        selectedSeasonFilter === "all"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                      }`}
                    >
                      Todas as temporadas
                    </button>
                    {packPreview.seasons.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSelectedSeasonFilter(s)}
                        className={`rounded-full px-3 py-1 text-xs transition ${
                          selectedSeasonFilter === s
                            ? "bg-primary text-primary-foreground"
                            : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                        }`}
                      >
                        T{pad2(s)}
                      </button>
                    ))}
                  </div>
                )}

                <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                  {packPreview.detectedEpisodes
                    .filter(
                      (ep) => selectedSeasonFilter === "all" || ep.season === selectedSeasonFilter,
                    )
                    .map((ep) => (
                      <div
                        key={`${ep.season}-${ep.episode}`}
                        className="flex items-center gap-3 rounded-lg bg-background/40 border border-border/30 px-3 py-2"
                      >
                        {ep.tmdbEp?.still ? (
                          <img
                            src={ep.tmdbEp.still}
                            alt=""
                            className="h-9 w-16 object-cover rounded shrink-0"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-9 w-16 bg-secondary rounded shrink-0 flex items-center justify-center">
                            <span className="text-[10px] text-muted-foreground/50 font-mono">
                              S{pad2(ep.season)}E{pad2(ep.episode)}
                            </span>
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground line-clamp-1">
                            {ep.tmdbEp?.name ?? `S${pad2(ep.season)}E${pad2(ep.episode)}`}
                          </p>
                          <p className="text-[10px] text-muted-foreground font-mono">
                            S{pad2(ep.season)}E{pad2(ep.episode)}
                            {ep.fileLength > 0 &&
                              ` · ${(ep.fileLength / (1024 * 1024 * 1024)).toFixed(1)} GB`}
                          </p>
                        </div>
                        <div className="shrink-0">
                          {localByKey.has(episodeId(show.id, ep.season, ep.episode)) ? (
                            <span className="text-[10px] bg-secondary text-muted-foreground rounded-full px-2 py-0.5">
                              Já importado
                            </span>
                          ) : (
                            <span className="text-[10px] bg-primary/20 text-primary rounded-full px-2 py-0.5">
                              Novo
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                </div>

                {packPreview.unmatchedFiles.length > 0 && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer hover:text-foreground transition select-none">
                      {packPreview.unmatchedFiles.length} arquivo
                      {packPreview.unmatchedFiles.length !== 1 ? "s" : ""} ignorado
                      {packPreview.unmatchedFiles.length !== 1 ? "s" : ""} (sem padrão SxxExx)
                    </summary>
                    <div className="mt-1.5 space-y-1 pl-2">
                      {packPreview.unmatchedFiles.map((f) => (
                        <p
                          key={f.fileIndex}
                          className="font-mono text-[10px] text-muted-foreground/60 truncate"
                        >
                          [{f.fileIndex}] {f.fileName}
                        </p>
                      ))}
                    </div>
                  </details>
                )}

                {(() => {
                  const count = packPreview.detectedEpisodes.filter((ep) =>
                    selectedSeasonFilter === "all" ? true : ep.season === selectedSeasonFilter,
                  ).length;
                  return (
                    <button
                      type="button"
                      onClick={confirmImportPack}
                      disabled={packImporting || count === 0}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-medium text-primary-foreground hover:brightness-110 transition disabled:opacity-50 min-h-[48px]"
                    >
                      {packImporting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      {packImporting
                        ? "Importando..."
                        : `Importar ${count} episódio${count !== 1 ? "s" : ""}`}
                    </button>
                  );
                })()}
              </div>
            )}
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
                                  setEpisodePreview(null);
                                  setEpisodeProbeLoading(false);
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
                              setEpisodePreview(null);
                              setEpisodeProbeLoading(false);
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
                        <div className="flex-1 flex flex-col gap-2">
                          <input
                            autoFocus
                            value={episodeMagnet}
                            onChange={(e) => {
                              const v = e.target.value;
                              setEpisodeMagnet(v);
                              setEpisodePreview(null);
                              if (v.trim().startsWith("magnet:?")) {
                                const w = window as {
                                  _epProbeTimer?: ReturnType<typeof setTimeout>;
                                };
                                clearTimeout(w._epProbeTimer);
                                w._epProbeTimer = setTimeout(() => {
                                  void probeEpisodeMagnet(v, ep.episode, season);
                                }, 900);
                              }
                            }}
                            placeholder="magnet:?xt=urn:btih:... (magnet deste episódio)"
                            className="w-full rounded-md bg-background/60 border border-border/40 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring font-mono"
                          />

                          {episodeProbeLoading && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-1">
                              <Loader2 className="h-3 w-3 animate-spin text-primary" />
                              Analisando torrent...
                            </div>
                          )}

                          {episodePreview && !episodeProbeLoading && (
                            <div
                              className={`rounded-lg border px-3 py-2 flex items-center gap-3 ${
                                episodePreview.episode === ep.episode &&
                                episodePreview.season === season
                                  ? "border-green-500/40 bg-green-500/10"
                                  : "border-yellow-500/40 bg-yellow-500/10"
                              }`}
                            >
                              <div className="flex-1 min-w-0">
                                <p
                                  className={`text-xs font-medium ${
                                    episodePreview.episode === ep.episode &&
                                    episodePreview.season === season
                                      ? "text-green-400"
                                      : "text-yellow-400"
                                  }`}
                                >
                                  {episodePreview.episode === ep.episode &&
                                  episodePreview.season === season
                                    ? "✓ Episódio correto detectado"
                                    : `⚠ Detectado S${pad2(episodePreview.season)}E${pad2(
                                        episodePreview.episode,
                                      )} — esperado S${pad2(season)}E${pad2(ep.episode)}`}
                                </p>
                                <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                                  [{episodePreview.fileIndex}] {episodePreview.fileName}
                                  {episodePreview.fileLength > 0 &&
                                    ` · ${(
                                      episodePreview.fileLength /
                                      (1024 * 1024 * 1024)
                                    ).toFixed(1)} GB`}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => {
                              setAddingMagnetFor(null);
                              setEpisodeMagnet("");
                              setEpisodePreview(null);
                              setEpisodeProbeLoading(false);
                            }}
                            className="rounded-md bg-secondary px-3 py-2 text-sm hover:bg-secondary/80 transition min-h-[40px]"
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={() =>
                              void importSingleEpisodeMagnet(
                                id,
                                ep.season ?? season,
                                ep.episode,
                                ep,
                              )
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
