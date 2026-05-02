import { useEffect, useRef, useState } from "react";
import { X, Download, Upload, Users, Loader2, AlertCircle } from "lucide-react";
import type { Torrent, TorrentFile, WebTorrentClient } from "webtorrent/dist/webtorrent.min.js";
import type { MediaPlayerInstance } from "@vidstack/react";
import { MediaPlayer, MediaProvider } from "@vidstack/react";
import { DefaultVideoLayout, defaultLayoutIcons } from "@vidstack/react/player/layouts/default";
import type { LibraryItem } from "@/lib/storage";

type Stats = {
  downloadSpeed: number;
  uploadSpeed: number;
  peers: number;
  progress: number;
  downloaded: number;
  length: number;
};

type Phase = "connecting" | "metadata" | "buffering" | "ready" | "error";
type SourceMode = "webrtc" | "proxy";

type QualityOption = {
  id: string;
  label: string;
  resolution: number;
  index: number;
};

type ProxyMetaFile = {
  index: number;
  name: string;
  length: number;
  kind: "video" | "subtitle" | "other";
  resolution: number | null;
  lang: string | null;
  label: string | null;
  transmuxed?: boolean;
};

type ProxyMeta = {
  bestVideoIndex: number | null;
  files: ProxyMetaFile[];
};

function getInfoHashFromMagnet(magnet: string) {
  try {
    const url = new URL(magnet);
    const xt = url.searchParams.get("xt") ?? "";
    if (xt.startsWith("urn:btih:")) return xt.slice(9).toLowerCase();
    return "";
  } catch {
    return "";
  }
}

function getMagnetHash(magnet: string) {
  const infoHash = getInfoHashFromMagnet(magnet);
  return infoHash ? infoHash.slice(0, 40) : "";
}

function getCachedMeta(magnet: string) {
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

function setCachedMeta(magnet: string, data: ProxyMeta) {
  const hash = getMagnetHash(magnet);
  if (!hash) return;
  const key = `buffet_meta_${hash}`;
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    void 0;
  }
}

function getBufferedAheadSeconds(video: HTMLVideoElement) {
  const t = video.currentTime ?? 0;
  try {
    const ranges = video.buffered;
    for (let i = 0; i < ranges.length; i++) {
      const start = ranges.start(i);
      const end = ranges.end(i);
      if (t >= start && t <= end) return Math.max(0, end - t);
    }
    return 0;
  } catch {
    return 0;
  }
}

function formatBytes(bytes: number, perSecond = false) {
  const suffix = perSecond ? "/s" : "";
  if (bytes < 1024) return `${bytes.toFixed(0)} B${suffix}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB${suffix}`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB${suffix}`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB${suffix}`;
}

const VIDEO_RE = /\.(mp4|webm|mkv|m4v|mov|avi|ogv|ogg)$/i;
// Browsers can only natively play mp4/webm/ogg. mkv/avi/mov often fail silently.
const NATIVE_PLAYABLE_RE = /\.(mp4|webm|ogv|ogg|m4v)$/i;
const SUB_RE = /\.(vtt|srt)$/i;
const PREF_QUALITY = "buffet_pref_quality";

function parseResolutionFromName(name: string) {
  const lower = name.toLowerCase();
  const m = /(^|[.\-_ ])(\d{3,4})p([.\-_ ]|$)/i.exec(lower);
  if (m) {
    const n = Number(m[2]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (/(^|[.\-_ ])4k([.\-_ ]|$)/i.test(lower)) return 2160;
  return 0;
}

function normalizeLang(raw: string) {
  return raw.trim().replace("_", "-");
}

function guessLangFromName(name: string) {
  const lower = name.toLowerCase();
  const candidates = [
    { re: /(^|[.\-_ ])pt(br)?([.\-_ ]|$)/i, lang: "pt-BR", label: "Português (Brasil)" },
    { re: /(^|[.\-_ ])pt([.\-_ ]|$)/i, lang: "pt", label: "Português" },
    { re: /(^|[.\-_ ])en(g)?([.\-_ ]|$)/i, lang: "en", label: "English" },
    { re: /(^|[.\-_ ])es(p)?([.\-_ ]|$)/i, lang: "es", label: "Español" },
    { re: /(^|[.\-_ ])fr([.\-_ ]|$)/i, lang: "fr", label: "Français" },
    { re: /(^|[.\-_ ])it([.\-_ ]|$)/i, lang: "it", label: "Italiano" },
    { re: /(^|[.\-_ ])de([.\-_ ]|$)/i, lang: "de", label: "Deutsch" },
    { re: /(^|[.\-_ ])ja(p)?([.\-_ ]|$)/i, lang: "ja", label: "日本語" },
  ];
  for (const c of candidates) {
    if (c.re.test(lower)) return { lang: c.lang, label: c.label };
  }
  return { lang: "und", label: "Desconhecido" };
}

function langLabel(lang: string) {
  const l = lang.toLowerCase();
  if (l === "por" || l === "pt" || l === "pt-br") return "Português";
  if (l === "eng" || l === "en") return "English";
  if (l === "spa" || l === "es") return "Español";
  if (l === "fra" || l === "fr") return "Français";
  if (l === "ita" || l === "it") return "Italiano";
  if (l === "deu" || l === "ger" || l === "de") return "Deutsch";
  if (l === "jpn" || l === "ja") return "日本語";
  return lang;
}

function needsTransmux(filename: string) {
  const lower = String(filename).toLowerCase();
  return (
    lower.endsWith(".mkv") ||
    lower.endsWith(".avi") ||
    lower.endsWith(".mov") ||
    lower.endsWith(".wmv") ||
    lower.endsWith(".flv")
  );
}

function srtToVtt(srt: string) {
  const cleaned = srt
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/^(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2"))
    .join("\n");

  return `WEBVTT\n\n${cleaned}`;
}

function safeGetPref(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function safeSetPref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    void 0;
  }
}

export function Player({
  item,
  fileIndex,
  onClose,
  onProgress,
}: {
  item: LibraryItem;
  fileIndex?: number;
  onClose: () => void;
  onProgress: (
    id: string,
    patch: { progress?: number; duration?: number; lastPlayedAt?: number },
  ) => void;
}) {
  const playerRef = useRef<MediaPlayerInstance>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const clientRef = useRef<WebTorrentClient | null>(null);
  const torrentRef = useRef<Torrent | null>(null);
  const proxyStartedRef = useRef(false);
  const objectUrlsRef = useRef<string[]>([]);
  const qualityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const proxyBaseRef = useRef<string>("");
  const proxyQualityIndexRef = useRef<number | null>(null);
  const qualityChoiceRef = useRef<string>("auto");
  const qualityOptionsRef = useRef<QualityOption[]>([]);
  const proxySwitchRef = useRef<((index: number) => Promise<void>) | null>(null);
  const webrtcSwitchRef = useRef<((id: string) => Promise<void>) | null>(null);
  const webrtcQualityIdRef = useRef<string | null>(null);
  const forceProxyRef = useRef<(() => void) | null>(null);
  const sourceModeRef = useRef<SourceMode>("webrtc");
  const playIntentRef = useRef<"none" | "auto">("none");
  const pendingSeekRef = useRef<number | null>(null);
  const preplayCleanupRef = useRef<(() => void) | null>(null);
  const isTransmuxedRef = useRef(false);
  const ffmpegAvailableRef = useRef<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>("connecting");
  const [sourceMode, setSourceMode] = useState<SourceMode>("webrtc");
  const [statusMsg, setStatusMsg] = useState("Conectando à rede de peers...");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [qualityOptions, setQualityOptions] = useState<QualityOption[]>([]);
  const [qualityChoice, setQualityChoice] = useState<string>("auto");
  const [showForceProxy, setShowForceProxy] = useState(false);
  const [preplayActive, setPreplayActive] = useState(false);
  const [preplayBuffered, setPreplayBuffered] = useState(0);
  const [videoSrc, setVideoSrc] = useState<string>("");
  const [isTransmuxed, setIsTransmuxed] = useState(false);
  const [stats, setStats] = useState<Stats>({
    downloadSpeed: 0,
    uploadSpeed: 0,
    peers: 0,
    progress: 0,
    downloaded: 0,
    length: 0,
  });

  useEffect(() => {
    qualityChoiceRef.current = qualityChoice;
  }, [qualityChoice]);

  useEffect(() => {
    qualityOptionsRef.current = qualityOptions;
  }, [qualityOptions]);

  useEffect(() => {
    sourceModeRef.current = sourceMode;
  }, [sourceMode]);

  useEffect(() => {
    setPreplayActive(false);
    setPreplayBuffered(0);
    setIsTransmuxed(false);
    isTransmuxedRef.current = false;
  }, [item.id, sourceMode]);

  useEffect(() => {
    setShowForceProxy(false);
    if (sourceMode !== "webrtc") return;
    const t = setTimeout(() => setShowForceProxy(true), 8_000);
    return () => clearTimeout(t);
  }, [item.id, sourceMode]);

  useEffect(() => {
    let destroyed = false;
    let statsTimer: ReturnType<typeof setInterval> | null = null;
    let saveTimer: ReturnType<typeof setInterval> | null = null;
    let metadataTimeout: ReturnType<typeof setTimeout> | null = null;
    let peersTimeout: ReturnType<typeof setTimeout> | null = null;

    const start = async () => {
      try {
        const [{ default: WebTorrent }] = await Promise.all([
          import("webtorrent/dist/webtorrent.min.js") as Promise<{
            default: new (opts?: unknown) => WebTorrentClient;
          }>,
        ]);
        if (destroyed) return;

        const startProxy = (reason: string) => {
          if (destroyed) return;
          if (proxyStartedRef.current) return;
          proxyStartedRef.current = true;

          setSourceMode("proxy");
          setWarning(
            reason ||
              "WebTorrent no navegador só conecta a peers WebRTC. Usando servidor proxy para baixar via BitTorrent tradicional.",
          );

          if (metadataTimeout) clearTimeout(metadataTimeout);
          if (peersTimeout) clearTimeout(peersTimeout);

          try {
            if (clientRef.current) clientRef.current.destroy();
          } catch {
            void 0;
          }
          clientRef.current = null;
          torrentRef.current = null;

          const env = (import.meta as unknown as { env?: { VITE_TORRENT_PROXY_URL?: string } }).env;
          const proxyBase = env?.VITE_TORRENT_PROXY_URL;
          const base = typeof proxyBase === "string" ? proxyBase.trim().replace(/\/+$/, "") : "";
          if (!base) {
            setPhase("error");
            setError(
              "Modo proxy não configurado. Defina a variável VITE_TORRENT_PROXY_URL apontando para o servidor Node (proxy) e faça o redeploy.",
            );
            return;
          }
          proxyBaseRef.current = base;
          (async () => {
            try {
              const healthRes = await fetch(`${base}/health`);
              if (!healthRes.ok) return;
              const health = (await healthRes.json()) as { ffmpegAvailable?: unknown };
              ffmpegAvailableRef.current = health?.ffmpegAvailable === true;
            } catch {
              void 0;
            }
          })();

          const video = (playerRef.current?.el as HTMLVideoElement | null) ?? videoRef.current;
          if (!video) {
            setPhase("error");
            setError("Player não inicializado.");
            return;
          }
          setPhase("buffering");
          setStatusMsg("Preparando streaming via servidor...");
          playIntentRef.current = "auto";

          setVideoSrc("");
          setQualityOptions([]);
          setQualityChoice("auto");
          proxyQualityIndexRef.current = null;

          const switchProxyVideo = async (index: number) => {
            const ct = (() => {
              try {
                return playerRef.current?.currentTime ?? video.currentTime ?? 0;
              } catch {
                return 0;
              }
            })();
            const paused = (() => {
              try {
                return video.paused;
              } catch {
                return true;
              }
            })();
            pendingSeekRef.current = ct && Number.isFinite(ct) ? ct : null;
            if (playIntentRef.current !== "auto") {
              playIntentRef.current = paused ? "none" : "auto";
            }
            setVideoSrc(`${base}/stream?magnet=${encodeURIComponent(item.magnet)}&index=${index}`);
          };
          proxySwitchRef.current = switchProxyVideo;

          const loadProxySubs = async () => {
            try {
              try {
                objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
                objectUrlsRef.current = [];
              } catch {
                void 0;
              }
              pendingSeekRef.current = null;

              if (ffmpegAvailableRef.current == null) {
                try {
                  const healthRes = await fetch(`${base}/health`);
                  if (healthRes.ok) {
                    const health = (await healthRes.json()) as { ffmpegAvailable?: unknown };
                    ffmpegAvailableRef.current = health?.ffmpegAvailable === true;
                  }
                } catch {
                  void 0;
                }
              }

              const cached = getCachedMeta(item.magnet);
              const meta =
                cached ??
                (await (async () => {
                  const metaRes = await fetch(
                    `${base}/meta?magnet=${encodeURIComponent(item.magnet)}`,
                  );
                  if (!metaRes.ok) return null;
                  const meta = (await metaRes.json()) as ProxyMeta;
                  setCachedMeta(item.magnet, meta);
                  return meta;
                })());
              if (!meta) return;
              const files = Array.isArray(meta?.files) ? meta.files : [];
              const videos = files
                .filter((f) => f.kind === "video")
                .map((f) => {
                  const name = String(f.name ?? "");
                  const res =
                    typeof f.resolution === "number" ? f.resolution : parseResolutionFromName(name);
                  return {
                    id: String(f.index),
                    label: res ? `${res}p` : name || `Arquivo ${Number(f.index) + 1}`,
                    resolution: res || 0,
                    index: Number(f.index),
                    length: typeof f.length === "number" ? f.length : 0,
                  };
                })
                .sort((a, b) => {
                  if (a.resolution && b.resolution) return a.resolution - b.resolution;
                  if (a.resolution) return -1;
                  if (b.resolution) return 1;
                  return (a.length || 0) - (b.length || 0);
                });

              const opts: QualityOption[] = videos.map((v) => ({
                id: v.id,
                label: v.label,
                resolution: v.resolution,
                index: v.index,
              }));
              if (typeof fileIndex === "number" && Number.isFinite(fileIndex)) {
                const only = opts.find((o) => o.index === fileIndex);
                if (!destroyed) setQualityOptions(only ? [only] : []);
              } else {
                if (!destroyed) setQualityOptions(opts);
              }

              if (typeof fileIndex === "number" && Number.isFinite(fileIndex)) {
                const selected = files.find((f) => f.kind === "video" && f.index === fileIndex);
                const transmuxed = selected?.transmuxed === true;
                isTransmuxedRef.current = transmuxed;
                setIsTransmuxed(transmuxed);
                if (
                  selected &&
                  needsTransmux(selected.name) &&
                  !transmuxed &&
                  ffmpegAvailableRef.current === false
                ) {
                  setPhase("error");
                  setError(
                    "Este arquivo é MKV e requer o servidor proxy com ffmpeg instalado para reprodução. O servidor atual não tem ffmpeg disponível.",
                  );
                  return;
                }
                proxyQualityIndexRef.current = fileIndex;
                await switchProxyVideo(fileIndex);
              } else {
                const pref = safeGetPref(PREF_QUALITY);
                const prefRes = pref ? Number(pref) : 0;
                const initial =
                  (prefRes ? opts.find((o) => o.resolution === prefRes) : null) ??
                  (opts.length ? opts[0] : null) ??
                  null;

                if (initial) {
                  const selected = files.find(
                    (f) => f.kind === "video" && f.index === initial.index,
                  );
                  const transmuxed = selected?.transmuxed === true;
                  isTransmuxedRef.current = transmuxed;
                  setIsTransmuxed(transmuxed);
                  if (
                    selected &&
                    needsTransmux(selected.name) &&
                    !transmuxed &&
                    ffmpegAvailableRef.current === false
                  ) {
                    setPhase("error");
                    setError(
                      "Este arquivo é MKV e requer o servidor proxy com ffmpeg instalado para reprodução. O servidor atual não tem ffmpeg disponível.",
                    );
                    return;
                  }
                  proxyQualityIndexRef.current = initial.index;
                  await switchProxyVideo(initial.index);
                  if (!destroyed && prefRes) setQualityChoice(initial.id);
                }
              }

              const subs = files.filter((f) => f.kind === "subtitle");
              if (subs.length === 0) return;
              const magnetHash = getMagnetHash(item.magnet);
              for (const s of subs.slice(0, 10)) {
                const name = String(s.name || "");
                const idx = Number(s.index);
                const langGuess = s.lang ? String(s.lang) : guessLangFromName(name).lang;
                const label = s.label ? String(s.label) : guessLangFromName(name).label;
                const subKey = magnetHash ? `buffet_sub_${magnetHash}_${idx}` : "";
                const cached = (() => {
                  if (!subKey) return "";
                  try {
                    return sessionStorage.getItem(subKey) ?? "";
                  } catch {
                    return "";
                  }
                })();
                const vtt = cached
                  ? cached
                  : await (async () => {
                      const fileRes = await fetch(
                        `${base}/file?magnet=${encodeURIComponent(item.magnet)}&index=${idx}`,
                      );
                      if (!fileRes.ok) return "";
                      const text = await fileRes.text();
                      const vtt = name.toLowerCase().endsWith(".srt") ? srtToVtt(text) : text;
                      if (subKey) {
                        try {
                          sessionStorage.setItem(subKey, vtt);
                        } catch {
                          void 0;
                        }
                      }
                      return vtt;
                    })();
                if (!vtt) continue;
                const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
                objectUrlsRef.current.push(url);
                try {
                  playerRef.current?.textTracks.add(url, {
                    kind: "subtitles",
                    label,
                    language: langGuess || "und",
                  });
                } catch {
                  void 0;
                }
              }
            } catch {
              void 0;
            }
          };

          loadProxySubs();

          const loadProxyTracksViaFfmpeg = async () => {
            try {
              const healthRes = await fetch(`${base}/health`);
              if (!healthRes.ok) return;
              const health = (await healthRes.json()) as { ffmpegAvailable?: unknown };
              if (health?.ffmpegAvailable !== true) return;
              if (!isTransmuxedRef.current) return;

              const probeRes = await fetch(
                `${base}/probe?magnet=${encodeURIComponent(item.magnet)}`,
              );
              if (!probeRes.ok) return;
              const probe = (await probeRes.json()) as {
                audioTracks?: unknown;
                subtitleTracks?: unknown;
              };

              const aud = Array.isArray(probe?.audioTracks) ? probe.audioTracks : [];
              const sub = Array.isArray(probe?.subtitleTracks) ? probe.subtitleTracks : [];
              void aud;

              for (const t of sub) {
                const idx =
                  typeof (t as { index?: unknown }).index === "number"
                    ? (t as { index: number }).index
                    : NaN;
                if (!Number.isFinite(idx) || idx < 0) continue;

                const vttRes = await fetch(
                  `${base}/extract-subtitle?magnet=${encodeURIComponent(item.magnet)}&trackIndex=${idx}`,
                );
                if (!vttRes.ok) continue;
                const vtt = await vttRes.text();
                if (!vtt) continue;
                const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
                objectUrlsRef.current.push(url);

                const lang =
                  typeof (t as { lang?: unknown }).lang === "string"
                    ? (t as { lang: string }).lang
                    : "und";
                const label =
                  typeof (t as { label?: unknown }).label === "string"
                    ? (t as { label: string }).label
                    : lang;
                try {
                  playerRef.current?.textTracks.add(url, {
                    kind: "subtitles",
                    label: langLabel(String(label)),
                    language: lang || "und",
                  });
                } catch {
                  void 0;
                }
              }
            } catch {
              void 0;
            }
          };

          void loadProxyTracksViaFfmpeg();

          if (!(typeof fileIndex === "number" && Number.isFinite(fileIndex))) {
            const scheduleProxyUpgrade = () => {
              if (qualityTimerRef.current) clearTimeout(qualityTimerRef.current);
              qualityTimerRef.current = setTimeout(async () => {
                if (destroyed) return;
                if (qualityChoiceRef.current !== "auto") return;
                if (proxyQualityIndexRef.current == null) return;

                const opts = qualityOptionsRef.current;
                const idx = opts.findIndex((o) => o.index === proxyQualityIndexRef.current);
                if (idx < 0) return;
                const next = opts[idx + 1];
                if (!next) return;

                try {
                  const t = video.currentTime ?? 0;
                  const can = video.readyState >= 2 && t >= 15;
                  if (!can) {
                    scheduleProxyUpgrade();
                    return;
                  }
                } catch {
                  scheduleProxyUpgrade();
                  return;
                }

                proxyQualityIndexRef.current = next.index;
                await switchProxyVideo(next.index);
                scheduleProxyUpgrade();
              }, 45_000);
            };
            scheduleProxyUpgrade();
          }

          if (statsTimer) clearInterval(statsTimer);
          statsTimer = setInterval(() => {
            setStats({
              downloadSpeed: 0,
              uploadSpeed: 0,
              peers: 0,
              progress: 0,
              downloaded: 0,
              length: 0,
            });
          }, 1000);

          if (saveTimer) clearInterval(saveTimer);
          saveTimer = setInterval(() => {
            const p = playerRef.current;
            if (!p) return;
            const ct = p.currentTime;
            const dur = p.duration;
            if (ct && dur && !isNaN(dur)) {
              onProgress(item.id, {
                progress: ct,
                duration: dur,
                lastPlayedAt: Date.now(),
              });
            }
          }, 10_000);
        };

        forceProxyRef.current = () => {
          startProxy("Forçado pelo usuário.");
        };

        const infoHash = getInfoHashFromMagnet(item.magnet);
        const cachedMode = infoHash ? safeGetPref(`buffet_conn_mode_${infoHash}`) : "";
        if (cachedMode === "proxy") {
          startProxy("Usando modo proxy salvo para este magnet.");
          return;
        }

        const client = new WebTorrent();
        clientRef.current = client;

        client.on("error", (err: Error | string) => {
          const msg = typeof err === "string" ? err : err.message;
          console.error("[WebTorrent] client error:", msg);
          // Client-level errors are often non-fatal (tracker failures). Only show if nothing else worked.
          if (!torrentRef.current) {
            setWarning(`Aviso: ${msg}`);
          }
        });

        setStatusMsg("Buscando metadados do torrent (pode levar 10-60s)...");

        // Hard timeout: if no metadata after 90s, the magnet probably has no peers
        metadataTimeout = setTimeout(() => {
          if (destroyed) return;
          if (!torrentRef.current || !torrentRef.current.files?.length) {
            setPhase("error");
            setError(
              "Timeout: não foi possível obter os metadados do torrent em 90s. " +
                "Isso geralmente significa que o torrent não tem peers ativos, ou os trackers estão bloqueados pelo seu navegador/rede. " +
                "Tente outro magnet ou um torrent com mais seeds.",
            );
          }
        }, 90_000);

        const torrent = client.add(item.magnet, {
          announce: [
            "wss://tracker.openwebtorrent.com",
            "wss://tracker.btorrent.xyz",
            "wss://tracker.webtorrent.dev",
          ],
        });
        torrentRef.current = torrent;

        torrent.on("error", (err: Error | string) => {
          const msg = typeof err === "string" ? err : err.message;
          console.error("[WebTorrent] torrent error:", msg);
          setPhase("error");
          setError(msg);
        });

        torrent.on("warning", (w: Error | string) => {
          console.warn("[WebTorrent] warning:", typeof w === "string" ? w : w.message);
        });

        torrent.on("infoHash", () => {
          console.log("[WebTorrent] infoHash:", torrent.infoHash);
        });

        torrent.on("metadata", () => {
          console.log("[WebTorrent] metadata received");
        });

        // Watch peer count — warn if no peers after 30s
        peersTimeout = setTimeout(() => {
          if (destroyed || torrentRef.current?.files?.length) return;
          if ((torrentRef.current?.numPeers ?? 0) === 0) {
            startProxy(
              "Sem peers WebRTC conectados. Esse magnet provavelmente não tem peers WebRTC (caso comum em torrents do YTS/1337x).",
            );
          }
        }, 30_000);

        torrent.on("ready", () => {
          if (destroyed) return;
          if (metadataTimeout) clearTimeout(metadataTimeout);
          if (peersTimeout) clearTimeout(peersTimeout);

          console.log(
            "[WebTorrent] ready. Files:",
            torrent.files.map((f) => `${f.name} (${formatBytes(f.length)})`),
          );

          const videoFiles = torrent.files.filter((f) => VIDEO_RE.test(f.name));
          if (videoFiles.length === 0) {
            setPhase("error");
            setError(
              `Este torrent não contém arquivos de vídeo reconhecidos. Arquivos: ${torrent.files
                .map((f) => f.name)
                .join(", ")}`,
            );
            return;
          }

          const forcedIndex =
            typeof fileIndex === "number" && Number.isFinite(fileIndex) ? fileIndex : null;
          const forcedFile = forcedIndex != null ? torrent.files[forcedIndex] : null;
          type Candidate = { file: TorrentFile; index: number; resolution: number; length: number };
          const playable = videoFiles.filter((f) => NATIVE_PLAYABLE_RE.test(f.name));
          const selectedFiles: TorrentFile[] =
            forcedFile && VIDEO_RE.test(forcedFile.name)
              ? [forcedFile]
              : playable.length
                ? playable
                : videoFiles;

          const candidates: Candidate[] = selectedFiles.map((f) => ({
            file: f,
            index: torrent.files.indexOf(f),
            resolution: parseResolutionFromName(String(f.name)),
            length: Number(f.length) || 0,
          }));

          const sorted = candidates.sort((a, b) => {
            if (a.resolution && b.resolution) return a.resolution - b.resolution;
            if (a.resolution) return -1;
            if (b.resolution) return 1;
            return (a.length || 0) - (b.length || 0);
          });

          const opts: QualityOption[] = sorted
            .filter((c) => c.index >= 0)
            .map((c) => ({
              id: String(c.index),
              label: c.resolution ? `${c.resolution}p` : String(c.file.name),
              resolution: c.resolution || 0,
              index: c.index,
            }));

          setQualityOptions(opts);

          const pref = safeGetPref(PREF_QUALITY);
          const prefRes = forcedIndex != null ? 0 : pref ? Number(pref) : 0;
          const initial =
            (forcedIndex != null ? opts.find((o) => o.index === forcedIndex) : null) ??
            (prefRes ? opts.find((o) => o.resolution === prefRes) : null) ??
            (opts.length ? opts[0] : null) ??
            null;

          if (!initial) {
            setPhase("error");
            setError("Não foi possível selecionar um arquivo de vídeo.");
            return;
          }

          setQualityChoice(forcedIndex != null ? "auto" : prefRes ? initial.id : "auto");

          let currentFile = torrent.files[initial.index];
          webrtcQualityIdRef.current = initial.id;

          const video = (playerRef.current?.el as HTMLVideoElement | null) ?? videoRef.current;
          if (!video) {
            setPhase("error");
            setError("Player não inicializado.");
            return;
          }

          const switchWebrtcVideo = async (id: string) => {
            const target = opts.find((o) => o.id === id);
            if (!target) return;
            const targetFile = torrent.files[target.index];
            if (!targetFile) return;

            const ct = (() => {
              try {
                return playerRef.current?.currentTime ?? video.currentTime ?? 0;
              } catch {
                return 0;
              }
            })();
            const paused = (() => {
              try {
                return video.paused;
              } catch {
                return true;
              }
            })();
            pendingSeekRef.current = ct && Number.isFinite(ct) ? ct : null;
            if (playIntentRef.current !== "auto") {
              playIntentRef.current = paused ? "none" : "auto";
            }

            currentFile = targetFile;
            webrtcQualityIdRef.current = target.id;

            torrent.files.forEach((f) => {
              if (f !== targetFile) {
                try {
                  f.deselect();
                } catch {
                  void 0;
                }
              }
            });
            try {
              targetFile.select();
            } catch {
              void 0;
            }

            setPhase("buffering");
            setStatusMsg(`Buffering "${targetFile.name}"...`);

            setVideoSrc("");
            targetFile.renderTo(
              video,
              { autoplay: false, controls: false },
              (err: Error | null) => {
                if (err) {
                  console.error("[WebTorrent] renderTo error:", err);
                  setPhase("error");
                  setError(`Falha ao preparar o vídeo: ${err.message}`);
                }
              },
            );
          };

          webrtcSwitchRef.current = switchWebrtcVideo;

          if (!NATIVE_PLAYABLE_RE.test(currentFile.name)) {
            setWarning(
              `Aviso: o arquivo "${currentFile.name}" é ${currentFile.name
                .split(".")
                .pop()
                ?.toUpperCase()} — navegadores geralmente não conseguem reproduzir esse formato nativamente. Se a tela ficar preta, esse é o motivo. Prefira torrents em MP4 (H.264) ou WebM.`,
            );
          }

          torrent.files.forEach((f) => {
            if (f !== currentFile) {
              try {
                f.deselect();
              } catch {
                void 0;
              }
            }
          });
          try {
            currentFile.select();
          } catch {
            void 0;
          }

          setPhase("buffering");
          setStatusMsg(`Buffering "${currentFile.name}"...`);

          playIntentRef.current = "auto";
          setVideoSrc("");
          currentFile.renderTo(video, { autoplay: false, controls: false }, (err: Error | null) => {
            if (err) {
              console.error("[WebTorrent] renderTo error:", err);
              setPhase("error");
              setError(`Falha ao preparar o vídeo: ${err.message}`);
            }
          });

          if (forcedIndex == null) {
            const scheduleWebrtcUpgrade = () => {
              if (qualityTimerRef.current) clearTimeout(qualityTimerRef.current);
              qualityTimerRef.current = setTimeout(async () => {
                if (destroyed) return;
                if (qualityChoiceRef.current !== "auto") return;
                const id = webrtcQualityIdRef.current;
                if (!id) return;
                const idx = opts.findIndex((o) => o.id === id);
                if (idx < 0) return;
                const next = opts[idx + 1];
                if (!next) return;

                try {
                  const t = video.currentTime ?? 0;
                  const can = video.readyState >= 2 && t >= 15;
                  if (!can) {
                    scheduleWebrtcUpgrade();
                    return;
                  }
                } catch {
                  scheduleWebrtcUpgrade();
                  return;
                }

                await switchWebrtcVideo(next.id);
                scheduleWebrtcUpgrade();
              }, 45_000);
            };
            scheduleWebrtcUpgrade();
          }

          const loadWebRtcSubs = async () => {
            try {
              try {
                objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
                objectUrlsRef.current = [];
              } catch {
                void 0;
              }

              const t = torrentRef.current;
              if (!t) return;
              const subs = (t.files ?? []).filter((f) => SUB_RE.test(f.name));
              if (subs.length === 0) return;
              const magnetHash = getMagnetHash(item.magnet);
              const getBuffer = (f: TorrentFile) =>
                new Promise<Uint8Array>((resolve, reject) => {
                  f.getBuffer((err, buf) => {
                    if (err) reject(err);
                    else resolve(buf);
                  });
                });

              for (const s of subs.slice(0, 10)) {
                const idx = t.files.indexOf(s);
                const subKey = magnetHash && idx >= 0 ? `buffet_sub_${magnetHash}_${idx}` : "";
                const cached = (() => {
                  if (!subKey) return "";
                  try {
                    return sessionStorage.getItem(subKey) ?? "";
                  } catch {
                    return "";
                  }
                })();

                const vtt = cached
                  ? cached
                  : await (async () => {
                      const buf = await getBuffer(s);
                      const text = new TextDecoder().decode(buf);
                      const vtt = s.name.toLowerCase().endsWith(".srt") ? srtToVtt(text) : text;
                      if (subKey) {
                        try {
                          sessionStorage.setItem(subKey, vtt);
                        } catch {
                          void 0;
                        }
                      }
                      return vtt;
                    })();
                const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
                objectUrlsRef.current.push(url);
                const lang = guessLangFromName(String(s.name));
                try {
                  playerRef.current?.textTracks.add(url, {
                    kind: "subtitles",
                    label: lang.label,
                    language: lang.lang,
                  });
                } catch {
                  void 0;
                }
              }
            } catch {
              void 0;
            }
          };

          loadWebRtcSubs();

          statsTimer = setInterval(() => {
            const t = torrentRef.current;
            if (!t) return;
            setStats({
              downloadSpeed: t.downloadSpeed,
              uploadSpeed: t.uploadSpeed,
              peers: t.numPeers,
              progress: t.progress * 100,
              downloaded: t.downloaded,
              length: currentFile.length,
            });
          }, 1000);

          saveTimer = setInterval(() => {
            const p = playerRef.current;
            if (!p) return;
            const ct = p.currentTime;
            const dur = p.duration;
            if (ct && dur && !isNaN(dur)) {
              onProgress(item.id, {
                progress: ct,
                duration: dur,
                lastPlayedAt: Date.now(),
              });
            }
          }, 10_000);
        });
      } catch (e: unknown) {
        console.error("[Player] init failed:", e);
        setPhase("error");
        setError(e instanceof Error ? e.message : "Falha ao inicializar o player.");
      }
    };

    start();

    const playerForCleanup = playerRef.current;

    return () => {
      destroyed = true;
      if (statsTimer) clearInterval(statsTimer);
      if (saveTimer) clearInterval(saveTimer);
      if (metadataTimeout) clearTimeout(metadataTimeout);
      if (peersTimeout) clearTimeout(peersTimeout);
      if (qualityTimerRef.current) clearTimeout(qualityTimerRef.current);
      proxySwitchRef.current = null;
      webrtcSwitchRef.current = null;
      if (preplayCleanupRef.current) {
        preplayCleanupRef.current();
        preplayCleanupRef.current = null;
      }
      try {
        const ct = playerForCleanup?.currentTime ?? 0;
        const dur = playerForCleanup?.duration ?? 0;
        if (ct && dur && !isNaN(dur)) {
          onProgress(item.id, { progress: ct, duration: dur, lastPlayedAt: Date.now() });
        }
      } catch {
        void 0;
      }
      try {
        if (clientRef.current) clientRef.current.destroy();
      } catch {
        void 0;
      }
      try {
        objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
        objectUrlsRef.current = [];
      } catch {
        void 0;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, fileIndex]);

  useEffect(() => {
    if (qualityChoice === "auto") {
      safeSetPref(PREF_QUALITY, "");
      return;
    }

    const opt = qualityOptions.find((o) => o.id === qualityChoice);
    if (!opt) return;
    if (opt.resolution) safeSetPref(PREF_QUALITY, String(opt.resolution));

    if (sourceMode === "proxy" && proxySwitchRef.current) {
      if (proxyQualityIndexRef.current === opt.index) return;
      proxyQualityIndexRef.current = opt.index;
      void proxySwitchRef.current(opt.index);
    }

    if (sourceMode === "webrtc" && webrtcSwitchRef.current) {
      if (webrtcQualityIdRef.current === opt.id) return;
      webrtcQualityIdRef.current = opt.id;
      void webrtcSwitchRef.current(opt.id);
    }
  }, [qualityChoice, qualityOptions, sourceMode]);

  const getVideoEl = () => (playerRef.current?.el as HTMLVideoElement | null) ?? videoRef.current;

  const handleLoadedMetadata = () => {
    const video = getVideoEl();
    if (!video) return;

    setPhase("ready");
    setStatusMsg("");

    const infoHash = getInfoHashFromMagnet(item.magnet);
    if (infoHash) safeSetPref(`buffet_conn_mode_${infoHash}`, sourceModeRef.current);

    const seekTarget = pendingSeekRef.current;
    pendingSeekRef.current = null;
    const initialSeek =
      seekTarget != null
        ? seekTarget
        : item.progress && item.progress > 5 && item.duration
          ? item.progress
          : null;
    if (initialSeek != null) {
      try {
        video.currentTime = initialSeek;
      } catch {
        void 0;
      }
    }

    if (preplayCleanupRef.current) {
      preplayCleanupRef.current();
      preplayCleanupRef.current = null;
    }

    if (playIntentRef.current === "none") return;

    setPreplayActive(true);
    setPreplayBuffered(0);

    let done = false;
    const startedAt = Date.now();

    const cleanup = () => {
      done = true;
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("timeupdate", onProgress);
      if (timer) clearInterval(timer);
      if (bypass) clearTimeout(bypass);
    };
    preplayCleanupRef.current = cleanup;

    const check = () => {
      const bufferedAhead = getBufferedAheadSeconds(video);
      setPreplayBuffered(bufferedAhead);
      if (bufferedAhead >= 15) {
        cleanup();
        setPreplayActive(false);
        try {
          void video.play();
          playIntentRef.current = "none";
        } catch {
          void 0;
        }
        return;
      }
      if (Date.now() - startedAt >= 20_000) {
        cleanup();
        setPreplayActive(false);
        setWarning((prev) =>
          prev
            ? `${prev} · Conexão lenta — podem ocorrer pausas`
            : "Conexão lenta — podem ocorrer pausas",
        );
        try {
          void video.play();
          playIntentRef.current = "none";
        } catch {
          void 0;
        }
      }
    };

    const onProgress = () => {
      if (done) return;
      check();
    };

    const timer = setInterval(check, 500);
    const bypass = setTimeout(() => {
      if (done) return;
      check();
    }, 20_000);

    video.addEventListener("progress", onProgress);
    video.addEventListener("timeupdate", onProgress);
    check();
  };

  const handleVideoError = () => {
    const video = getVideoEl();
    const me = video?.error;
    const codeMap: Record<number, string> = {
      1: "MEDIA_ERR_ABORTED",
      2: "MEDIA_ERR_NETWORK",
      3: "MEDIA_ERR_DECODE — formato/codec não suportado pelo navegador",
      4: "MEDIA_ERR_SRC_NOT_SUPPORTED — formato/codec não suportado pelo navegador",
    };
    const reason = me ? (codeMap[me.code] ?? `código ${me.code}`) : "desconhecido";
    console.error("[Video] error:", reason, me);
    setPhase("error");
    setError(`Erro de reprodução: ${reason}. Tente um torrent em MP4 (H.264 + AAC).`);
  };

  const handleForceProxy = () => {
    forceProxyRef.current?.();
  };

  const showOverlay = phase !== "ready" || preplayActive;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col items-center justify-center p-0 md:p-4 animate-scale-in">
      <div className="w-full max-w-6xl flex items-center justify-between px-4 py-2 md:py-0 md:mb-3">
        <div>
          <h2 className="font-display text-xl md:text-3xl text-cream truncate max-w-[70vw]">
            {item.title}
          </h2>
          {item.year && <p className="text-xs text-muted-foreground">{item.year}</p>}
        </div>
        <button
          onClick={onClose}
          className="rounded-full bg-card/80 backdrop-blur p-2.5 hover:bg-destructive hover:text-destructive-foreground transition min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Fechar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="w-full max-w-6xl">
        <div className="relative">
          <MediaPlayer
            ref={playerRef}
            src={videoSrc}
            crossOrigin="anonymous"
            playsInline
            className="vds-player w-full aspect-video bg-black"
            onLoadedMetadata={handleLoadedMetadata}
            onError={handleVideoError}
          >
            <MediaProvider />
            <DefaultVideoLayout icons={defaultLayoutIcons} />
          </MediaPlayer>

          {showOverlay && phase !== "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center pointer-events-none">
              {(item.backdrop ?? item.poster) && (
                <img
                  src={item.backdrop ?? item.poster}
                  aria-hidden
                  className="absolute inset-0 w-full h-full object-cover blur-xl opacity-20 scale-110"
                />
              )}
              <div className="relative z-10 flex flex-col items-center gap-3">
                <Loader2 className="h-10 w-10 text-primary animate-spin" />
                <p className="text-sm text-cream font-medium">{statusMsg}</p>
                <div className="text-xs text-muted-foreground space-y-1">
                  {sourceMode === "proxy" ? (
                    <p>Modo: Proxy</p>
                  ) : (
                    <p>
                      Peers: {stats.peers} · Baixado: {formatBytes(stats.downloaded)}
                    </p>
                  )}
                </div>
                {showForceProxy && sourceMode === "webrtc" && (
                  <button
                    onClick={handleForceProxy}
                    className="mt-2 pointer-events-auto inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:brightness-110 transition"
                  >
                    Usar servidor proxy
                  </button>
                )}
              </div>
            </div>
          )}

          {phase === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/95 p-6 text-center">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <p className="text-destructive font-medium">Não foi possível reproduzir</p>
              <p className="text-sm text-muted-foreground max-w-md">{error}</p>
            </div>
          )}
        </div>
      </div>

      <div className="w-full max-w-6xl flex flex-wrap items-center gap-4 text-xs text-muted-foreground bg-card/60 backdrop-blur rounded-md px-4 py-3 border border-border/40 mt-2">
        <Stat
          icon={<Download className="h-3.5 w-3.5 text-primary" />}
          label={formatBytes(stats.downloadSpeed, true)}
        />
        <Stat
          icon={<Upload className="h-3.5 w-3.5 text-primary" />}
          label={formatBytes(stats.uploadSpeed, true)}
        />
        <Stat
          icon={<Users className="h-3.5 w-3.5 text-primary" />}
          label={
            sourceMode === "proxy" ? (
              <span className="inline-flex items-center gap-2">
                <span>proxy</span>
                {isTransmuxed && (
                  <span className="text-[10px] bg-primary/20 text-primary border border-primary/30 rounded-full px-2 py-0.5">
                    MKV → MP4
                  </span>
                )}
              </span>
            ) : (
              `${stats.peers} peers`
            )
          }
        />
        <div className="flex-1 min-w-[140px]">
          <div className="flex items-center justify-between mb-1">
            <span>Buffer</span>
            <span>{stats.progress.toFixed(1)}%</span>
          </div>
          <div className="h-1 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-[width] duration-500"
              style={{ width: `${stats.progress}%` }}
            />
          </div>
        </div>
      </div>

      {warning && phase !== "error" && (
        <div className="w-full max-w-6xl flex items-start gap-2 text-xs bg-primary/10 border border-primary/30 rounded-md px-4 py-2.5 text-cream mt-2">
          <AlertCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <span>{warning}</span>
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label }: { icon: React.ReactNode; label: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <span className="font-mono">{label}</span>
    </div>
  );
}
