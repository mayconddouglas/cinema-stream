import { useEffect, useState } from "react";
import { X, Loader2, AlertCircle, Copy, Check } from "lucide-react";
import type { LibraryItem } from "@/lib/storage";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";

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

export function Player({
  item,
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
  const [phase, setPhase] = useState<Phase>("resolving");
  const [vlcUrl, setVlcUrl] = useState("");
  const [streamUrl, setStreamUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [vlcResumeOpen, setVlcResumeOpen] = useState(false);
  const [vlcResumeMinutes, setVlcResumeMinutes] = useState("");

  useEffect(() => {
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
        const cached = getCachedMeta(item.magnet);
        const meta =
          cached ??
          (await (async () => {
            const res = await fetch(`${base}/meta?magnet=${encodeURIComponent(item.magnet)}`);
            if (!res.ok) throw new Error(`Proxy retornou ${res.status}`);
            const data = (await res.json()) as ProxyMeta;
            setCachedMeta(item.magnet, data);
            return data;
          })());
        const bestIndex = typeof meta.bestVideoIndex === "number" ? meta.bestVideoIndex : 0;
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
  }, [item.id, item.magnet, item.progress]);

  const handleClose = () => {
    if (phase === "ready" && vlcUrl) {
      setVlcResumeMinutes("");
      setVlcResumeOpen(true);
      return;
    }
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

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden">
      {(item.backdrop ?? item.poster) && (
        <img
          src={item.backdrop ?? item.poster}
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-25 pointer-events-none select-none"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/65 to-black/92 pointer-events-none" />

      <div className="relative z-10 flex items-center justify-between px-4 py-4 md:px-8 md:py-5">
        <div />
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
            <p className="text-sm text-white/50">Preparando link de streaming...</p>
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

            <a
              href={vlcUrl}
              className="w-full inline-flex items-center justify-center gap-3 rounded-2xl bg-primary px-8 py-4 text-base font-semibold text-primary-foreground shadow-glow hover:brightness-110 active:scale-95 transition min-h-[56px]"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-6 w-6 fill-current shrink-0"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden
              >
                <path d="M12 2L2 19.5h20L12 2zm0 3.5l7.5 13H4.5L12 5.5z" />
              </svg>
              Abrir no VLC
            </a>

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
                  const minutes = Number(vlcResumeMinutes);
                  if (Number.isFinite(minutes) && minutes > 0) {
                    onProgress(item.id, {
                      progress: minutes * 60,
                      lastPlayedAt: Date.now(),
                    });
                  }
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
  );
}
