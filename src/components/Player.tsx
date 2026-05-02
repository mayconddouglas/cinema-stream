import { useEffect, useRef, useState } from "react";
import Plyr from "plyr";
import { X, Download, Users, Loader2 } from "lucide-react";
import type { LibraryItem } from "@/lib/storage";
import { update } from "@/lib/storage";

type Stats = {
  downloadSpeed: number;
  peers: number;
  progress: number;
  ready: boolean;
};

function formatBytes(bps: number) {
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const plyrRef = useRef<Plyr | null>(null);
  const clientRef = useRef<any>(null);
  const torrentRef = useRef<any>(null);
  const [stats, setStats] = useState<Stats>({
    downloadSpeed: 0,
    peers: 0,
    progress: 0,
    ready: false,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let destroyed = false;
    let progressTimer: ReturnType<typeof setInterval> | null = null;
    let saveTimer: ReturnType<typeof setInterval> | null = null;

    const start = async () => {
      try {
        const { default: WebTorrent } = await import("webtorrent/dist/webtorrent.min.js");
        if (destroyed) return;
        const client = new WebTorrent();
        clientRef.current = client;

        client.on("error", (err: Error) => {
          console.error("WebTorrent error:", err);
          setError(err.message);
        });

        client.add(item.magnet, (torrent: any) => {
          if (destroyed) return;
          torrentRef.current = torrent;

          const file = torrent.files.reduce((best: any, f: any) => {
            const isVideo = /\.(mp4|webm|mkv|m4v|mov|avi)$/i.test(f.name);
            if (!isVideo) return best;
            return !best || f.length > best.length ? f : best;
          }, null);

          if (!file) {
            setError("Nenhum arquivo de vídeo encontrado neste torrent.");
            return;
          }

          file.streamTo(containerRef.current!.querySelector("video")!, (err: Error) => {
            if (err) console.warn("streamTo:", err);
          });

          const video = containerRef.current!.querySelector("video") as HTMLVideoElement;
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

          // Resume
          if (item.progress && item.progress > 5) {
            const onLoaded = () => {
              video.currentTime = item.progress!;
              video.removeEventListener("loadedmetadata", onLoaded);
            };
            video.addEventListener("loadedmetadata", onLoaded);
          }

          setStats((s) => ({ ...s, ready: true }));

          progressTimer = setInterval(() => {
            if (!torrentRef.current) return;
            const t = torrentRef.current;
            setStats({
              downloadSpeed: t.downloadSpeed,
              peers: t.numPeers,
              progress: t.progress * 100,
              ready: true,
            });
          }, 1000);

          saveTimer = setInterval(() => {
            if (!plyrRef.current) return;
            const ct = plyrRef.current.currentTime;
            const dur = plyrRef.current.duration;
            if (ct && dur) {
              onProgress(item.id, {
                progress: ct,
                duration: dur,
                lastPlayedAt: Date.now(),
              });
            }
          }, 10000);
        });
      } catch (e: any) {
        console.error(e);
        setError(e?.message ?? "Falha ao iniciar o torrent.");
      }
    };

    start();

    return () => {
      destroyed = true;
      if (progressTimer) clearInterval(progressTimer);
      if (saveTimer) clearInterval(saveTimer);
      try {
        if (plyrRef.current) {
          const ct = plyrRef.current.currentTime;
          const dur = plyrRef.current.duration;
          if (ct && dur) {
            update(item.id, { progress: ct, duration: dur, lastPlayedAt: Date.now() });
          }
          plyrRef.current.destroy();
        }
      } catch {}
      try {
        if (clientRef.current) clientRef.current.destroy();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  return (
    <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex items-center justify-center p-4 animate-scale-in">
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
          {item.year && (
            <p className="text-sm text-muted-foreground">{item.year}</p>
          )}
        </div>

        <div ref={containerRef} className="relative rounded-lg overflow-hidden bg-black aspect-video">
          <video controls playsInline className="w-full h-full" />
          {!stats.ready && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80">
              <Loader2 className="h-10 w-10 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Conectando ao torrent...</p>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/90 p-6 text-center">
              <p className="text-destructive font-medium">Erro</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground bg-card/60 backdrop-blur rounded-md px-4 py-3 border border-border/40">
          <Stat icon={<Download className="h-3.5 w-3.5 text-primary" />} label={formatBytes(stats.downloadSpeed)} />
          <Stat icon={<Users className="h-3.5 w-3.5 text-primary" />} label={`${stats.peers} peers`} />
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
