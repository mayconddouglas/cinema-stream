import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Loader2, Play, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PlayerItem = {
  title: string;
  subtitle?: string;
  image?: string | null;
  streamUrl: string;
  vlcUrl: string;
  favorite: boolean;
  onToggleFavorite: () => void;
  onClose: () => void;
};

export function PlayerOverlay({ item }: { item: PlayerItem | null }) {
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setStarted(false);
    setLoading(false);
    setError(false);
    setCopied(false);
  }, [item?.streamUrl]);

  const copyUrl = async () => {
    if (!item?.streamUrl) return;
    try {
      await navigator.clipboard.writeText(item.streamUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      void 0;
    }
  };

  const media = useMemo(() => {
    if (!item) return null;
    if (!started) return null;
    return (
      <div className="relative overflow-hidden rounded-3xl border border-border/40 bg-black">
        <div className="aspect-video">
          <video
            src={item.streamUrl}
            controls
            autoPlay
            playsInline
            className="h-full w-full"
            onLoadStart={() => {
              setLoading(true);
              setError(false);
            }}
            onCanPlay={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError(true);
            }}
          />
        </div>
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando...
            </div>
          </div>
        ) : null}
      </div>
    );
  }, [item, started, loading]);

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/90">
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/70 to-black" />

      <div className="relative h-full w-full overflow-auto pb-[max(env(safe-area-inset-bottom),16px)]">
        <div className="mx-auto max-w-xl px-4 pt-4 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Acervos de Filmes</p>
              <h1 className="font-display text-4xl leading-[0.92] text-foreground truncate">
                {item.title}
              </h1>
              {item.subtitle ? (
                <p className="text-sm text-muted-foreground mt-1 line-clamp-1">{item.subtitle}</p>
              ) : null}
            </div>
            <button
              onClick={item.onClose}
              className="shrink-0 rounded-full bg-white/5 border border-border/40 p-2 hover:bg-white/10 transition min-h-[44px] min-w-[44px] flex items-center justify-center"
              title="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {!started ? (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-3xl border border-border/40 bg-white/5">
                <div className="relative aspect-[16/10]">
                  {item.image ? (
                    <img
                      src={item.image}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-secondary/40" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/10" />
                  <div className="absolute bottom-4 left-4 right-4">
                    <Button
                      onClick={() => setStarted(true)}
                      size="lg"
                      className="w-full rounded-2xl h-12"
                    >
                      <Play className="h-4 w-4" />
                      Play
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  onClick={item.onToggleFavorite}
                  className="rounded-2xl h-12"
                >
                  <Star
                    className={cn(
                      "h-4 w-4",
                      item.favorite ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  {item.favorite ? "Salvo" : "Salvar"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    window.location.href = item.vlcUrl;
                  }}
                  className="rounded-2xl h-12"
                >
                  Abrir no VLC
                </Button>
              </div>
              <Button
                variant="outline"
                onClick={() => void copyUrl()}
                className="w-full rounded-2xl h-12"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-400" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                Copiar URL
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {media}

              {error ? (
                <div className="rounded-3xl border border-border/40 bg-white/5 p-5 space-y-4 text-center">
                  <p className="text-base text-foreground">
                    Não foi possível reproduzir no navegador.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Abra no VLC (recomendado) ou copie a URL do stream.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Button
                      onClick={() => {
                        window.location.href = item.vlcUrl;
                      }}
                      size="lg"
                      className="rounded-2xl h-12"
                    >
                      Abrir no VLC
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => void copyUrl()}
                      size="lg"
                      className="rounded-2xl h-12"
                    >
                      {copied ? (
                        <Check className="h-4 w-4 text-green-400" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                      Copiar URL
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  onClick={item.onToggleFavorite}
                  className="rounded-2xl h-12"
                >
                  <Star
                    className={cn(
                      "h-4 w-4",
                      item.favorite ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  {item.favorite ? "Salvo" : "Salvar"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    window.location.href = item.vlcUrl;
                  }}
                  className="rounded-2xl h-12"
                >
                  Abrir no VLC
                </Button>
              </div>
              <Button
                variant="outline"
                onClick={() => void copyUrl()}
                className="w-full rounded-2xl h-12"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-400" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                Copiar URL
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
