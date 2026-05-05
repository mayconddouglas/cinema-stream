import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, ChevronDown, Copy, Loader2, Pause, Play, X } from "lucide-react";
import type { LibraryItem } from "@/lib/storage";
import { fetchMetaWithRetry } from "@/lib/torrent";
import {
  addPlaybackEvent,
  patchPlaybackSession,
  startPlaybackSession,
} from "@/lib/playbackAnalytics";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Phase = "resolving" | "ready" | "error";

type ProxyMetaFile = {
  index: number;
  name: string;
  length: number;
  kind: "video" | "subtitle" | "other";
  resolution: number | null;
  lang: string | null;
  label: string | null;
};

type ProxyMeta = {
  bestVideoIndex: number | null;
  files: ProxyMetaFile[];
};

function getProxyBase(): string {
  const env = (import.meta as unknown as { env?: { VITE_TORRENT_PROXY_URL?: string } }).env;
  const proxyBase = env?.VITE_TORRENT_PROXY_URL;
  return typeof proxyBase === "string" ? proxyBase.trim().replace(/\/+$/, "") : "";
}

function getInfoHashFromMagnet(magnet: string): string {
  try {
    const url = new URL(magnet);
    const xt = url.searchParams.get("xt") ?? "";
    if (xt.startsWith("urn:btih:")) return xt.slice(9).toLowerCase();
    return "";
  } catch {
    return "";
  }
}

function getMagnetHash(magnet: string): string {
  const infoHash = getInfoHashFromMagnet(magnet);
  return infoHash ? infoHash.slice(0, 40) : "";
}

function getCachedMeta(magnet: string): ProxyMeta | null {
  const hash = getMagnetHash(magnet);
  if (!hash) return null;
  const key = `buffet_meta_${hash}`;
  const ttlMs = 24 * 60 * 60 * 1000;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts?: unknown; data?: unknown };
    const ts = typeof parsed.ts === "number" ? parsed.ts : 0;
    if (!ts || Date.now() - ts > ttlMs) return null;
    return parsed.data as ProxyMeta;
  } catch {
    return null;
  }
}

function setCachedMeta(magnet: string, data: ProxyMeta): void {
  const hash = getMagnetHash(magnet);
  if (!hash) return;
  const key = `buffet_meta_${hash}`;
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    void 0;
  }
}

function getVlcDeepLink(streamUrl: string, startSeconds?: number): string {
  const timeFragment = startSeconds && startSeconds > 10 ? `#t=${Math.floor(startSeconds)}s` : "";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isAndroid = /android/i.test(ua);
  if (isAndroid) {
    return `intent:${streamUrl}${timeFragment}#Intent;package=org.videolan.vlc;action=android.intent.action.VIEW;type=video/*;end`;
  }
  return `${streamUrl.replace(/^https?:\/\//, "vlc://")}${timeFragment}`;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

function getNetworkLabel(): string | undefined {
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number };
  };
  const type = nav.connection?.effectiveType;
  const downlink = nav.connection?.downlink;
  if (type && Number.isFinite(downlink)) return `${type} (${downlink}mbps)`;
  return type ?? undefined;
}

export function Player({
  item,
  fileIndex,
  onClose,
  onProgress,
  minimized,
  onMinimize,
  onExpand,
}: {
  item: LibraryItem;
  fileIndex?: number;
  onClose: () => void;
  onProgress: (
    id: string,
    patch: { progress?: number; duration?: number; lastPlayedAt?: number },
  ) => void;
  minimized?: boolean;
  onMinimize?: () => void;
  onExpand?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("resolving");
  const [vlcUrl, setVlcUrl] = useState("");
  const [streamUrl, setStreamUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState("Preparando link de streaming...");
  const [copied, setCopied] = useState(false);
  const [vlcResumeOpen, setVlcResumeOpen] = useState(false);
  const [vlcResumeMinutes, setVlcResumeMinutes] = useState("");
  const [view, setView] = useState<"details" | "watch">("details");
  const [browserError, setBrowserError] = useState(false);
  const [paused, setPaused] = useState(true);
  const [hasWatched, setHasWatched] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const lastSavedRef = useRef(0);
  const lastTimeRef = useRef(0);
  const lastDurationRef = useRef(0);
  const sessionIdRef = useRef<string>("");
  const watchStartedAtRef = useRef<number>(0);
  const startupStartedAtRef = useRef<number>(0);
  const bufferStartedAtRef = useRef<number>(0);
  const rebufferCountRef = useRef<number>(0);
  const rebufferMsRef = useRef<number>(0);

  useEffect(() => {
    setView("details");
    setBrowserError(false);
    setPaused(true);
    setHasWatched(false);
    const resolve = async () => {
      const base = getProxyBase();
      if (!base) {
        setError(
          "Proxy não configurado. Defina a variável VITE_TORRENT_PROXY_URL apontando para o servidor proxy e faça o redeploy.",
        );
        setPhase("error");
        return;
      }
      try {
        setStatusMsg("Preparando link de streaming...");
        const overrideIndex =
          typeof fileIndex === "number"
            ? fileIndex
            : typeof item.fileIndex === "number"
              ? item.fileIndex
              : null;

        if (overrideIndex !== null) {
          const url = `${base}/stream?magnet=${encodeURIComponent(item.magnet)}&index=${overrideIndex}`;
          setStreamUrl(url);
          setVlcUrl(getVlcDeepLink(url, item.progress ?? 0));
          setPhase("ready");
          return;
        }

        const cached = getCachedMeta(item.magnet);
        const meta = cached
          ? cached
          : await (async () => {
              const result = await fetchMetaWithRetry(base, item.magnet, {
                maxAttempts: 3,
                onAttempt: (attempt, max) => {
                  setStatusMsg(
                    attempt === 1
                      ? "Preparando link de streaming..."
                      : `Procurando peers... tentativa ${attempt}/${max}`,
                  );
                },
              });

              if (!result.ok) {
                throw new Error(result.error);
              }

              setCachedMeta(item.magnet, result.meta as ProxyMeta);
              return result.meta as ProxyMeta;
            })();

        const bestIndex =
          typeof item.fileIndex === "number"
            ? item.fileIndex
            : typeof meta.bestVideoIndex === "number"
              ? meta.bestVideoIndex
              : 0;
        const url = `${base}/stream?magnet=${encodeURIComponent(item.magnet)}&index=${bestIndex}`;
        setStreamUrl(url);
        setVlcUrl(getVlcDeepLink(url, item.progress ?? 0));
        setPhase("ready");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao resolver o stream.");
        setPhase("error");
      }
    };
    void resolve();
  }, [fileIndex, item.fileIndex, item.id, item.magnet, item.progress]);

  useEffect(() => {
    return () => {
      try {
        hlsRef.current?.destroy();
      } catch {
        void 0;
      }
      hlsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || view !== "watch" || phase !== "ready" || !streamUrl) return;

    let cancelled = false;
    const setup = async () => {
      try {
        hlsRef.current?.destroy();
      } catch {
        void 0;
      }
      hlsRef.current = null;
      video.removeAttribute("src");
      video.load();

      const isHls = /\.m3u8(\?|$)/i.test(streamUrl);
      if (!isHls) {
        video.src = streamUrl;
        return;
      }

      const canNativeHls = video.canPlayType("application/vnd.apple.mpegurl");
      if (canNativeHls) {
        video.src = streamUrl;
        return;
      }

      const mod = await import("hls.js");
      if (cancelled) return;
      const HlsClass = mod.default;
      if (!HlsClass?.isSupported?.()) {
        video.src = streamUrl;
        return;
      }

      const hls = new HlsClass({
        enableWorker: true,
        lowLatencyMode: true,
      });
      hls.attachMedia(video);
      hls.on(HlsClass.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(streamUrl);
      });
      hls.on(HlsClass.Events.ERROR, () => {
        setBrowserError(true);
      });
      hlsRef.current = hls;
    };

    void setup();
    return () => {
      cancelled = true;
    };
  }, [phase, streamUrl, view]);

  const saveProgress = (source: "browser" | "manual" = "browser") => {
    const now = Date.now();
    if (source === "browser") {
      const t = lastTimeRef.current;
      const d = lastDurationRef.current;
      if (Number.isFinite(t) && Number.isFinite(d) && d > 10 && t > 3 && t < d - 3) {
        onProgress(item.id, { progress: t, duration: d, lastPlayedAt: now });
      }
      return;
    }
    const minutes = Number(vlcResumeMinutes);
    if (Number.isFinite(minutes) && minutes > 0) {
      onProgress(item.id, { progress: minutes * 60, lastPlayedAt: now });
    }
  };

  const finishSession = (status: "ended" | "closed" | "error") => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    const now = Date.now();
    const watchSeconds = watchStartedAtRef.current
      ? Math.max(0, Math.floor((now - watchStartedAtRef.current) / 1000))
      : 0;
    void patchPlaybackSession(sessionId, {
      status,
      watch_seconds: watchSeconds,
      rebuffer_count: rebufferCountRef.current,
      rebuffer_ms: rebufferMsRef.current,
      ended_at: new Date().toISOString(),
    });
  };

  const handleClose = () => {
    if (hasWatched) {
      saveProgress("browser");
      finishSession("closed");
      onClose();
      return;
    }
    if (phase === "ready" && vlcUrl) {
      setVlcResumeMinutes("");
      setVlcResumeOpen(true);
      return;
    }
    finishSession("closed");
    onClose();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(streamUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      void 0;
    }
  };

  const progressPct =
    item.progress && item.duration ? Math.min(100, (item.progress / item.duration) * 100) : 0;

  const canPlayInBrowser = useMemo(() => phase === "ready" && !!streamUrl, [phase, streamUrl]);

  const handleOpenVlc = () => {
    const sessionId = crypto.randomUUID();
    void startPlaybackSession({
      sessionId,
      libraryItemId: item.id,
      title: item.title,
      streamMode: "vlc",
      device: navigator.userAgent,
      network: getNetworkLabel(),
    });
    void addPlaybackEvent(sessionId, "open_vlc", { streamUrl });
  };

  const startBrowserPlay = async () => {
    if (!canPlayInBrowser) return;
    if (!sessionIdRef.current) {
      sessionIdRef.current = crypto.randomUUID();
      startupStartedAtRef.current = Date.now();
      watchStartedAtRef.current = Date.now();
      rebufferCountRef.current = 0;
      rebufferMsRef.current = 0;
      void startPlaybackSession({
        sessionId: sessionIdRef.current,
        libraryItemId: item.id,
        title: item.title,
        streamMode: "browser",
        device: navigator.userAgent,
        network: getNetworkLabel(),
      });
      void addPlaybackEvent(sessionIdRef.current, "play_request", { streamUrl });
    }
    setView("watch");
    setBrowserError(false);
    setHasWatched(true);
    requestAnimationFrame(async () => {
      const v = videoRef.current;
      if (!v) return;
      try {
        if (item.progress && item.progress > 5) {
          v.currentTime = item.progress;
        }
        await v.play();
        setPaused(v.paused);
      } catch {
        void addPlaybackEvent(sessionIdRef.current, "play_error", { stage: "autoplay" });
        setBrowserError(true);
      }
    });
  };

  const togglePause = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (v.paused) {
        await v.play();
      } else {
        v.pause();
      }
      setPaused(v.paused);
    } catch {
      setBrowserError(true);
    }
  };

  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    const t = v.currentTime;
    const d = v.duration;
    if (!Number.isFinite(t) || !Number.isFinite(d)) return;
    lastTimeRef.current = t;
    lastDurationRef.current = d;
    const now = Date.now();
    if (now - lastSavedRef.current > 12000) {
      lastSavedRef.current = now;
      if (d > 10 && t > 3) {
        onProgress(item.id, { progress: t, duration: d, lastPlayedAt: now });
        const sessionId = sessionIdRef.current;
        if (sessionId && now % 24000 < 12000) {
          void patchPlaybackSession(sessionId, {
            watch_seconds: Math.max(0, Math.floor((now - watchStartedAtRef.current) / 1000)),
          });
        }
      }
    }
  };

  const onEnded = () => {
    const v = videoRef.current;
    if (!v) return;
    onProgress(item.id, { progress: v.duration, duration: v.duration, lastPlayedAt: Date.now() });
    finishSession("ended");
    void addPlaybackEvent(sessionIdRef.current, "ended", {
      duration: Number.isFinite(v.duration) ? v.duration : null,
    });
  };

  useEffect(() => {
    if (!minimized) return;
    const v = videoRef.current;
    if (!v) return;
    setPaused(v.paused);
  }, [minimized]);

  return (
    <>
      {view === "watch" && phase === "ready" && streamUrl ? (
        <div
          className={
            minimized
              ? "fixed left-6 bottom-[108px] z-50 w-20 aspect-video overflow-hidden rounded-xl border border-border/40 bg-black/60"
              : "fixed inset-0 z-50 flex items-center justify-center px-4 pt-24 pb-28 pointer-events-none"
          }
        >
          <div className={minimized ? "h-full w-full" : "w-full max-w-4xl pointer-events-auto"}>
            <div
              className={
                minimized
                  ? "h-full w-full"
                  : "overflow-hidden rounded-2xl border border-white/10 bg-black/40"
              }
            >
              <video
                ref={videoRef}
                controls={!minimized}
                autoPlay
                playsInline
                className={minimized ? "h-full w-full object-cover" : "w-full aspect-video"}
                onTimeUpdate={onTimeUpdate}
                onEnded={onEnded}
                onLoadedData={() => {
                  const sessionId = sessionIdRef.current;
                  if (!sessionId || !startupStartedAtRef.current) return;
                  const startupMs = Math.max(0, Date.now() - startupStartedAtRef.current);
                  void patchPlaybackSession(sessionId, { startup_ms: startupMs });
                  void addPlaybackEvent(sessionId, "startup_ready", { startupMs });
                  startupStartedAtRef.current = 0;
                }}
                onWaiting={() => {
                  const sessionId = sessionIdRef.current;
                  if (!sessionId || bufferStartedAtRef.current) return;
                  bufferStartedAtRef.current = Date.now();
                  void addPlaybackEvent(sessionId, "buffering_start", {
                    at: lastTimeRef.current,
                  });
                }}
                onPlaying={() => {
                  const sessionId = sessionIdRef.current;
                  if (!sessionId || !bufferStartedAtRef.current) return;
                  const delta = Math.max(0, Date.now() - bufferStartedAtRef.current);
                  bufferStartedAtRef.current = 0;
                  if (delta > 150) {
                    rebufferCountRef.current += 1;
                    rebufferMsRef.current += delta;
                    void patchPlaybackSession(sessionId, {
                      rebuffer_count: rebufferCountRef.current,
                      rebuffer_ms: rebufferMsRef.current,
                    });
                    void addPlaybackEvent(sessionId, "buffering_end", {
                      durationMs: delta,
                      at: lastTimeRef.current,
                    });
                  }
                }}
                onError={() => {
                  void addPlaybackEvent(sessionIdRef.current, "playback_error", {
                    at: lastTimeRef.current,
                  });
                  finishSession("error");
                  setBrowserError(true);
                }}
                onPlay={() => setPaused(false)}
                onPause={() => setPaused(true)}
              />
            </div>
          </div>
        </div>
      ) : null}

      {minimized ? (
        <div className="fixed left-3 right-3 bottom-[96px] z-50">
          <div className="rounded-2xl border border-border/40 bg-background/80 backdrop-blur-xl overflow-hidden">
            <div className="flex items-center gap-3 p-3">
              <div className="w-20 aspect-video rounded-xl overflow-hidden bg-black/50 border border-border/40 shrink-0">
                <div className="h-full w-full bg-primary/10" />
              </div>
              <button onClick={() => onExpand?.()} className="min-w-0 flex-1 text-left">
                <p className="text-xs text-muted-foreground leading-none">Tocando</p>
                <p className="text-sm text-foreground truncate">{item.title}</p>
              </button>
              <button
                onClick={() => void togglePause()}
                className="shrink-0 rounded-full bg-white/5 border border-border/40 p-2 hover:bg-white/10 transition min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label={paused ? "Reproduzir" : "Pausar"}
              >
                {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              </button>
              <button
                onClick={handleClose}
                className="shrink-0 rounded-full bg-white/5 border border-border/40 p-2 hover:bg-white/10 transition min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className={minimized ? "hidden" : "fixed inset-0 z-50 flex flex-col overflow-hidden"}>
        {(item.backdrop ?? item.poster) && (
          <img
            src={item.backdrop ?? item.poster}
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-25 pointer-events-none select-none"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/65 to-black/92 pointer-events-none" />

        <div className="relative z-10 flex items-center justify-between px-4 py-4 md:px-8 md:py-5">
          <div>
            <button
              onClick={() => onMinimize?.()}
              className="rounded-full bg-white/10 backdrop-blur-md p-2.5 hover:bg-white/20 active:scale-95 transition min-h-[44px] min-w-[44px] flex items-center justify-center border border-white/10"
              aria-label="Minimizar"
            >
              <ChevronDown className="h-5 w-5 text-white" />
            </button>
          </div>
          <button
            onClick={handleClose}
            className="rounded-full bg-white/10 backdrop-blur-md p-2.5 hover:bg-white/20 active:scale-95 transition min-h-[44px] min-w-[44px] flex items-center justify-center border border-white/10"
            aria-label="Fechar"
          >
            <X className="h-5 w-5 text-white" />
          </button>
        </div>

        <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 pb-8 text-center gap-8">
          {!item.backdrop && item.poster && (
            <img
              src={item.poster}
              alt={item.title}
              className="w-28 h-40 object-cover rounded-xl shadow-2xl border border-white/10"
            />
          )}

          <div className="space-y-2">
            <h1 className="font-display text-4xl md:text-6xl text-white leading-tight drop-shadow-lg max-w-2xl">
              {item.title}
            </h1>
            {item.year && (
              <p className="text-sm text-white/40 tracking-[0.25em] uppercase">{item.year}</p>
            )}
          </div>

          {phase === "resolving" && (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
              <p className="text-sm text-white/50">{statusMsg}</p>
            </div>
          )}

          {phase === "ready" && (
            <div className="flex flex-col items-center gap-4 w-full max-w-sm">
              {progressPct > 2 && progressPct < 95 && (
                <div className="w-full space-y-1.5">
                  <div className="h-1 rounded-full bg-white/15 overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-[width] duration-300"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <p className="text-xs text-white/40">Retomar em {formatTime(item.progress!)}</p>
                </div>
              )}

              {view === "watch" ? (
                <div className="w-full space-y-3">
                  {browserError ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
                      Seu navegador não conseguiu reproduzir esse formato. Use VLC.
                    </div>
                  ) : null}
                  <Button
                    onClick={() => onMinimize?.()}
                    size="lg"
                    variant="secondary"
                    className="w-full rounded-2xl h-12"
                  >
                    Minimizar
                  </Button>
                </div>
              ) : (
                <div className="w-full space-y-3">
                  <Button
                    onClick={() => void startBrowserPlay()}
                    size="lg"
                    className="w-full rounded-2xl h-14"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    Assistir aqui
                  </Button>
                  <a
                    href={vlcUrl}
                    onClick={handleOpenVlc}
                    className="w-full inline-flex items-center justify-center gap-3 rounded-2xl bg-white/10 backdrop-blur-md px-8 py-4 text-base font-semibold text-white shadow-glow hover:bg-white/18 active:scale-95 transition border border-white/10 min-h-[56px]"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-6 w-6 fill-current shrink-0"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden
                    >
                      <path d="M12 2L2 19.5h20L12 2zm0 3.5l7.5 13H4.5L12 5.5z" />
                    </svg>
                    Abrir no VLC (recomendado)
                  </a>
                </div>
              )}

              <button
                onClick={handleCopy}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-white/10 backdrop-blur-md px-6 py-3 text-sm text-white/75 hover:bg-white/18 active:scale-95 transition border border-white/10 min-h-[48px]"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-green-400 shrink-0" />
                    <span className="text-green-400">Link copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 shrink-0" />
                    Copiar link do stream
                  </>
                )}
              </button>

              <p className="text-xs text-white/25 leading-relaxed max-w-xs">
                O VLC reproduz MKV com dual áudio e legendas embutidas nativamente. Cole o link
                copiado em qualquer player externo.
              </p>
            </div>
          )}

          {phase === "error" && (
            <div className="flex flex-col items-center gap-4 max-w-sm">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <p className="text-sm text-white/60 leading-relaxed">{error}</p>
              <button
                onClick={onClose}
                className="rounded-xl bg-white/10 px-6 py-3 text-sm text-white hover:bg-white/20 active:scale-95 transition min-h-[44px]"
              >
                Fechar
              </button>
            </div>
          )}
        </div>

        <Sheet
          open={vlcResumeOpen}
          onOpenChange={(open) => {
            setVlcResumeOpen(open);
            if (!open) onClose();
          }}
        >
          <SheetContent side="bottom" className="max-w-lg mx-auto rounded-t-2xl">
            <SheetHeader>
              <SheetTitle>Onde você parou no VLC?</SheetTitle>
              <SheetDescription>Salve o progresso para retomar depois (opcional).</SheetDescription>
            </SheetHeader>
            <div className="mt-4 flex flex-col gap-3">
              <Input
                inputMode="numeric"
                type="number"
                min={0}
                placeholder="Minutos assistidos (ex: 42)"
                value={vlcResumeMinutes}
                onChange={(e) => setVlcResumeMinutes(e.target.value)}
              />
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => onClose()}
                  className="flex-1 rounded-xl bg-secondary px-4 py-3 text-sm font-medium hover:bg-secondary/80 active:scale-95 transition min-h-[48px]"
                >
                  Pular
                </button>
                <button
                  onClick={() => {
                    saveProgress("manual");
                    onClose();
                  }}
                  className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:brightness-110 active:scale-95 transition min-h-[48px]"
                >
                  Salvar progresso
                </button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
