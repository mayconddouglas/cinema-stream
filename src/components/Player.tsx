import { useEffect, useRef, useState } from "react";
import { X, Download, Upload, Users, Loader2, AlertCircle, Settings } from "lucide-react";
import type { LibraryItem } from "@/lib/storage";
import { update } from "@/lib/storage";

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

type SubtitleTrack = {
  id: string;
  label: string;
  srcLang: string;
  src: string;
};

type AudioTrackOption = {
  id: string;
  label: string;
  lang: string;
};

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
const PREF_AUDIO = "buffet_pref_audio_lang";
const PREF_SUBS = "buffet_pref_sub_lang";

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
  } catch {}
}

export function Player({
  item,
  onClose,
  onProgress,
}: {
  item: LibraryItem;
  onClose: () => void;
  onProgress: (id: string, patch: Partial<LibraryItem>) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const plyrRef = useRef<any>(null);
  const clientRef = useRef<any>(null);
  const torrentRef = useRef<any>(null);
  const proxyStartedRef = useRef(false);
  const objectUrlsRef = useRef<string[]>([]);
  const [phase, setPhase] = useState<Phase>("connecting");
  const [sourceMode, setSourceMode] = useState<SourceMode>("webrtc");
  const [statusMsg, setStatusMsg] = useState("Conectando à rede de peers...");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [subtitleChoice, setSubtitleChoice] = useState<string>("off");
  const [audioTracks, setAudioTracks] = useState<AudioTrackOption[]>([]);
  const [audioChoice, setAudioChoice] = useState<string>("auto");
  const [stats, setStats] = useState<Stats>({
    downloadSpeed: 0,
    uploadSpeed: 0,
    peers: 0,
    progress: 0,
    downloaded: 0,
    length: 0,
  });

  useEffect(() => {
    let destroyed = false;
    let statsTimer: ReturnType<typeof setInterval> | null = null;
    let saveTimer: ReturnType<typeof setInterval> | null = null;
    let metadataTimeout: ReturnType<typeof setTimeout> | null = null;
    let peersTimeout: ReturnType<typeof setTimeout> | null = null;

    const start = async () => {
      try {
        // Dynamic imports — must stay client-side only (Plyr/WebTorrent both touch `document`/`window`)
        const [{ default: WebTorrent }, PlyrMod] = await Promise.all([
          import("webtorrent/dist/webtorrent.min.js"),
          import("plyr"),
        ]);
        if (destroyed) return;

        const Plyr: any = (PlyrMod as any).default ?? PlyrMod;

        const initVideoUi = (video: HTMLVideoElement) => {
          try {
            if (plyrRef.current) plyrRef.current.destroy();
          } catch {}

          plyrRef.current = new Plyr(video, {
            controls: [
              "play-large",
              "play",
              "progress",
              "current-time",
              "duration",
              "mute",
              "volume",
              "captions",
              "settings",
              "fullscreen",
            ],
            settings: ["captions", "quality", "speed"],
            speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
            keyboard: { focused: true, global: true },
          });

          const onLoadedMeta = () => {
            setPhase("ready");
            setStatusMsg("");
            if (item.progress && item.progress > 5 && item.duration) {
              try {
                video.currentTime = item.progress;
              } catch {}
            }

            try {
              const at: any = (video as any).audioTracks;
              if (at && typeof at.length === "number") {
                const opts: AudioTrackOption[] = [];
                for (let i = 0; i < at.length; i++) {
                  const tr = at[i];
                  const lang = normalizeLang(String(tr?.language ?? "und"));
                  const label = String(tr?.label || tr?.language || `Áudio ${i + 1}`);
                  opts.push({ id: String(i), label, lang });
                }
                setAudioTracks(opts);

                const pref = safeGetPref(PREF_AUDIO);
                if (pref) {
                  const target = normalizeLang(pref).toLowerCase();
                  const match = opts.find(
                    (o) => o.lang.toLowerCase() === target || o.lang.toLowerCase().startsWith(`${target}-`),
                  );
                  if (match) setAudioChoice(match.id);
                }
              } else {
                setAudioTracks([]);
              }
            } catch {
              setAudioTracks([]);
            }
          };
          video.addEventListener("loadedmetadata", onLoadedMeta, { once: true });

          video.addEventListener("error", () => {
            const me = video.error;
            const codeMap: Record<number, string> = {
              1: "MEDIA_ERR_ABORTED",
              2: "MEDIA_ERR_NETWORK",
              3: "MEDIA_ERR_DECODE — formato/codec não suportado pelo navegador",
              4: "MEDIA_ERR_SRC_NOT_SUPPORTED — formato/codec não suportado pelo navegador",
            };
            const reason = me ? codeMap[me.code] ?? `código ${me.code}` : "desconhecido";
            console.error("[Video] error:", reason, me);
            setPhase("error");
            setError(`Erro de reprodução: ${reason}. Tente um torrent em MP4 (H.264 + AAC).`);
          });
        };

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
          } catch {}
          clientRef.current = null;
          torrentRef.current = null;

          const proxyBase = (import.meta as any).env?.VITE_TORRENT_PROXY_URL as string | undefined;
          const base = typeof proxyBase === "string" ? proxyBase.trim().replace(/\/+$/, "") : "";
          if (!base) {
            setPhase("error");
            setError(
              "Modo proxy não configurado. Defina a variável VITE_TORRENT_PROXY_URL apontando para o servidor Node (proxy) e faça o redeploy.",
            );
            return;
          }

          const video = videoRef.current!;
          setPhase("buffering");
          setStatusMsg("Preparando streaming via servidor...");

          video.removeAttribute("src");
          video.load();
          video.src = `${base}/stream?magnet=${encodeURIComponent(item.magnet)}`;
          video.load();

          initVideoUi(video);

          const loadProxySubs = async () => {
            try {
              try {
                objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
                objectUrlsRef.current = [];
              } catch {}
              setSubtitleTracks([]);
              setSubtitleChoice("off");

              const metaRes = await fetch(`${base}/meta?magnet=${encodeURIComponent(item.magnet)}`);
              if (!metaRes.ok) return;
              const meta = (await metaRes.json()) as any;
              const files = Array.isArray(meta?.files) ? meta.files : [];
              const subs = files.filter((f: any) => f?.kind === "subtitle" && typeof f?.index === "number");
              if (subs.length === 0) return;

              const pref = safeGetPref(PREF_SUBS);
              const prefNorm = pref ? normalizeLang(pref).toLowerCase() : "";

              const nextTracks: SubtitleTrack[] = [];
              for (const s of subs.slice(0, 10)) {
                const name = String(s.name || "");
                const idx = Number(s.index);
                const langGuess = s.lang ? String(s.lang) : guessLangFromName(name).lang;
                const label = s.label ? String(s.label) : guessLangFromName(name).label;
                const fileRes = await fetch(`${base}/file?magnet=${encodeURIComponent(item.magnet)}&index=${idx}`);
                if (!fileRes.ok) continue;
                const text = await fileRes.text();
                const vtt = name.toLowerCase().endsWith(".srt") ? srtToVtt(text) : text;
                const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
                objectUrlsRef.current.push(url);
                nextTracks.push({
                  id: `proxy-${idx}`,
                  label,
                  srcLang: langGuess || "und",
                  src: url,
                });
              }
              if (destroyed) return;
              setSubtitleTracks(nextTracks);
              if (prefNorm) {
                const match = nextTracks.find(
                  (t) =>
                    normalizeLang(t.srcLang).toLowerCase() === prefNorm ||
                    normalizeLang(t.srcLang).toLowerCase().startsWith(`${prefNorm}-`),
                );
                if (match) setSubtitleChoice(match.id);
              }
            } catch {}
          };

          loadProxySubs();

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
            const p = plyrRef.current;
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
            torrent.files.map((f: any) => `${f.name} (${formatBytes(f.length)})`),
          );

          const videoFiles = torrent.files.filter((f: any) => VIDEO_RE.test(f.name));
          if (videoFiles.length === 0) {
            setPhase("error");
            setError(
              `Este torrent não contém arquivos de vídeo reconhecidos. Arquivos: ${torrent.files
                .map((f: any) => f.name)
                .join(", ")}`,
            );
            return;
          }

          // Prefer largest natively-playable file
          const playable = videoFiles.filter((f: any) => NATIVE_PLAYABLE_RE.test(f.name));
          const file = (playable.length ? playable : videoFiles).reduce((best: any, f: any) =>
            !best || f.length > best.length ? f : best,
          );

          if (!NATIVE_PLAYABLE_RE.test(file.name)) {
            setWarning(
              `Aviso: o arquivo "${file.name}" é ${file.name.split(".").pop()?.toUpperCase()} — navegadores geralmente não conseguem reproduzir esse formato nativamente. Se a tela ficar preta, esse é o motivo. Prefira torrents em MP4 (H.264) ou WebM.`,
            );
          }

          // Deselect everything else so bandwidth focuses on the video file
          torrent.files.forEach((f: any) => {
            if (f !== file) {
              try {
                f.deselect();
              } catch {}
            }
          });
          try {
            file.select();
          } catch {}

          setPhase("buffering");
          setStatusMsg(`Buffering "${file.name}"...`);

          const video = videoRef.current!;

          // renderTo is the current API; streamTo is deprecated
          file.renderTo(video, { autoplay: false, controls: false }, (err: Error | null) => {
            if (err) {
              console.error("[WebTorrent] renderTo error:", err);
              setPhase("error");
              setError(`Falha ao preparar o vídeo: ${err.message}`);
            }
          });

          initVideoUi(video);

          const loadWebRtcSubs = async () => {
            try {
              try {
                objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
                objectUrlsRef.current = [];
              } catch {}
              setSubtitleTracks([]);
              setSubtitleChoice("off");

              const t = torrentRef.current;
              if (!t) return;
              const subs = (t.files ?? []).filter((f: any) => SUB_RE.test(f.name));
              if (subs.length === 0) return;

              const pref = safeGetPref(PREF_SUBS);
              const prefNorm = pref ? normalizeLang(pref).toLowerCase() : "";

              const nextTracks: SubtitleTrack[] = [];
              const getBuffer = (f: any) =>
                new Promise<Uint8Array>((resolve, reject) => {
                  f.getBuffer((err: any, buf: any) => {
                    if (err) reject(err);
                    else resolve(buf);
                  });
                });

              for (const s of subs.slice(0, 10)) {
                const buf = await getBuffer(s);
                const text = new TextDecoder().decode(buf);
                const vtt = s.name.toLowerCase().endsWith(".srt") ? srtToVtt(text) : text;
                const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
                objectUrlsRef.current.push(url);
                const lang = guessLangFromName(String(s.name));
                nextTracks.push({
                  id: `webrtc-${String(s.path ?? s.name)}`,
                  label: lang.label,
                  srcLang: lang.lang,
                  src: url,
                });
              }
              if (destroyed) return;
              setSubtitleTracks(nextTracks);
              if (prefNorm) {
                const match = nextTracks.find(
                  (t) =>
                    normalizeLang(t.srcLang).toLowerCase() === prefNorm ||
                    normalizeLang(t.srcLang).toLowerCase().startsWith(`${prefNorm}-`),
                );
                if (match) setSubtitleChoice(match.id);
              }
            } catch {}
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
              length: file.length,
            });
          }, 1000);

          saveTimer = setInterval(() => {
            const p = plyrRef.current;
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
      } catch (e: any) {
        console.error("[Player] init failed:", e);
        setPhase("error");
        setError(e?.message ?? "Falha ao inicializar o player.");
      }
    };

    start();

    return () => {
      destroyed = true;
      if (statsTimer) clearInterval(statsTimer);
      if (saveTimer) clearInterval(saveTimer);
      if (metadataTimeout) clearTimeout(metadataTimeout);
      if (peersTimeout) clearTimeout(peersTimeout);
      try {
        if (plyrRef.current) {
          const ct = plyrRef.current.currentTime;
          const dur = plyrRef.current.duration;
          if (ct && dur && !isNaN(dur)) {
            update(item.id, { progress: ct, duration: dur, lastPlayedAt: Date.now() });
          }
          plyrRef.current.destroy();
        }
      } catch {}
      try {
        if (clientRef.current) clientRef.current.destroy();
      } catch {}
      try {
        objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
        objectUrlsRef.current = [];
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const list: any = (video as any).textTracks;
    if (!list || typeof list.length !== "number") return;
    for (let i = 0; i < list.length; i++) {
      const tr = list[i];
      tr.mode = "disabled";
    }
    if (subtitleChoice === "off") return;
    const idx = subtitleTracks.findIndex((t) => t.id === subtitleChoice);
    if (idx >= 0 && list[idx]) {
      list[idx].mode = "showing";
      safeSetPref(PREF_SUBS, subtitleTracks[idx].srcLang);
    }
  }, [subtitleChoice, subtitleTracks]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const at: any = (video as any).audioTracks;
    if (!at || typeof at.length !== "number") return;
    if (audioChoice === "auto") return;
    const idx = Number(audioChoice);
    if (!Number.isFinite(idx) || idx < 0 || idx >= at.length) return;
    for (let i = 0; i < at.length; i++) {
      at[i].enabled = i === idx;
    }
    const opt = audioTracks.find((o) => o.id === audioChoice);
    if (opt) safeSetPref(PREF_AUDIO, opt.lang);
  }, [audioChoice, audioTracks]);

  const showOverlay = phase !== "ready";

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex items-center justify-center p-4 animate-scale-in">
      <button
        onClick={() => setSettingsOpen((v) => !v)}
        className="absolute top-4 right-16 z-10 rounded-full bg-card/80 backdrop-blur p-2.5 hover:bg-secondary hover:text-foreground transition"
        aria-label="Configurações"
      >
        <Settings className="h-5 w-5" />
      </button>
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 rounded-full bg-card/80 backdrop-blur p-2.5 hover:bg-destructive hover:text-destructive-foreground transition"
        aria-label="Fechar"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="w-full max-w-6xl space-y-3">
        <div>
          <h2 className="font-display text-3xl text-cream">{item.title}</h2>
          {item.year && <p className="text-sm text-muted-foreground">{item.year}</p>}
        </div>

        <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
          <video ref={videoRef} controls playsInline crossOrigin="anonymous" className="w-full h-full">
            {subtitleTracks.map((t) => (
              <track
                key={t.id}
                kind="subtitles"
                src={t.src}
                srcLang={t.srcLang}
                label={t.label}
              />
            ))}
          </video>

          {showOverlay && phase !== "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center">
              <Loader2 className="h-10 w-10 text-primary animate-spin" />
              <p className="text-sm text-cream font-medium">{statusMsg}</p>
              <div className="text-xs text-muted-foreground space-y-1">
                {sourceMode === "proxy" ? (
                  <p>Modo: Proxy</p>
                ) : (
                  <p>Peers: {stats.peers} · Baixado: {formatBytes(stats.downloaded)}</p>
                )}
                {stats.length > 0 && (
                  <p>
                    Buffer: {stats.progress.toFixed(1)}% de {formatBytes(stats.length)}
                  </p>
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

        {settingsOpen && (
          <div className="grid gap-3 md:grid-cols-2 bg-card/60 backdrop-blur rounded-md px-4 py-3 border border-border/40">
            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Áudio</div>
              <select
                value={audioChoice}
                onChange={(e) => setAudioChoice(e.target.value)}
                disabled={audioTracks.length === 0}
                className="w-full rounded-md bg-background/60 border border-border/40 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              >
                <option value="auto">Automático</option>
                {audioTracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              {audioTracks.length === 0 && (
                <div className="text-[11px] text-muted-foreground">
                  Troca de áudio depende do suporte do navegador/arquivo (nem todo vídeo expõe múltiplas trilhas).
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="text-xs text-muted-foreground">Legendas</div>
              <select
                value={subtitleChoice}
                onChange={(e) => setSubtitleChoice(e.target.value)}
                disabled={subtitleTracks.length === 0}
                className="w-full rounded-md bg-background/60 border border-border/40 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              >
                <option value="off">Desligado</option>
                {subtitleTracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              {subtitleTracks.length === 0 && (
                <div className="text-[11px] text-muted-foreground">
                  Nenhuma legenda encontrada no torrent (procuro arquivos .srt e .vtt).
                </div>
              )}
            </div>
          </div>
        )}

        {warning && phase !== "error" && (
          <div className="flex items-start gap-2 text-xs bg-primary/10 border border-primary/30 rounded-md px-4 py-2.5 text-cream">
            <AlertCircle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <span>{warning}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground bg-card/60 backdrop-blur rounded-md px-4 py-3 border border-border/40">
          <Stat icon={<Download className="h-3.5 w-3.5 text-primary" />} label={formatBytes(stats.downloadSpeed, true)} />
          <Stat icon={<Upload className="h-3.5 w-3.5 text-primary" />} label={formatBytes(stats.uploadSpeed, true)} />
          <Stat
            icon={<Users className="h-3.5 w-3.5 text-primary" />}
            label={sourceMode === "proxy" ? "proxy" : `${stats.peers} peers`}
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
      </div>
    </div>
  );
}

function Stat({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <span className="font-mono">{label}</span>
    </div>
  );
}
