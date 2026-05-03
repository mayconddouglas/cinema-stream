import { useState } from "react";
import { X, Copy, Check, Tv } from "lucide-react";
import { getIptvCredentials } from "@/lib/api";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      void 0;
    }
  };

  return (
    <div className="space-y-1.5">
      <label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="flex items-center gap-2">
        <div className="flex-1 rounded-lg bg-black/40 border border-border/40 px-3 py-2.5 font-mono text-sm text-foreground truncate">
          {value || <span className="text-muted-foreground italic">não configurado</span>}
        </div>
        <button
          onClick={handleCopy}
          disabled={!value}
          className="shrink-0 rounded-lg bg-secondary/60 border border-border/40 px-3 py-2.5 hover:bg-secondary transition disabled:opacity-40 min-h-[44px] min-w-[44px] flex items-center justify-center"
          title="Copiar"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-400" />
          ) : (
            <Copy className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </div>
    </div>
  );
}

export function IptvModal({ onClose }: { onClose: () => void }) {
  const creds = getIptvCredentials();
  const [activeTab, setActiveTab] = useState<"xtream" | "m3u">("xtream");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-scale-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-card border border-border shadow-card p-6 space-y-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <h2 className="font-display text-2xl text-primary flex items-center gap-2">
              <Tv className="h-5 w-5" />
              Conectar no IPTV
            </h2>
            <p className="text-xs text-muted-foreground">
              Use esses dados em qualquer app IPTV compatível
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full bg-secondary/60 p-2 hover:bg-secondary transition min-h-[40px] min-w-[40px] flex items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex rounded-lg bg-secondary/40 p-1 gap-1">
          <button
            onClick={() => setActiveTab("xtream")}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
              activeTab === "xtream"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Xtream Codes
          </button>
          <button
            onClick={() => setActiveTab("m3u")}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
              activeTab === "m3u"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Lista M3U
          </button>
        </div>

        {activeTab === "xtream" && (
          <div className="space-y-3">
            <CopyField label="Host / URL do servidor" value={creds.host} />
            <CopyField label="Usuário" value={creds.username} />
            <CopyField label="Senha" value={creds.password} />

            <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 space-y-2">
              <p className="text-xs font-medium text-foreground">
                📱 Apps compatíveis com Xtream Codes:
              </p>
              <div className="grid grid-cols-2 gap-1">
                {[
                  "XCIPTV",
                  "TiviMate",
                  "Smarters Player",
                  "GSE IPTV",
                  "OTT Navigator",
                  "IPTV Smarters Pro",
                ].map((app) => (
                  <div
                    key={app}
                    className="text-xs text-muted-foreground flex items-center gap-1.5"
                  >
                    <div className="h-1 w-1 rounded-full bg-primary shrink-0" />
                    {app}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === "m3u" && (
          <div className="space-y-3">
            <CopyField label="URL da playlist M3U" value={creds.m3uUrl} />

            <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 space-y-2">
              <p className="text-xs font-medium text-foreground">📺 Apps compatíveis com M3U:</p>
              <div className="grid grid-cols-2 gap-1">
                {["VLC", "Kodi", "MX Player", "IPTV Pro", "Perfect Player", "Stremio"].map(
                  (app) => (
                    <div
                      key={app}
                      className="text-xs text-muted-foreground flex items-center gap-1.5"
                    >
                      <div className="h-1 w-1 rounded-full bg-primary shrink-0" />
                      {app}
                    </div>
                  ),
                )}
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Cole a URL M3U no app de sua preferência. A playlist é atualizada automaticamente
              sempre que você adicionar novos filmes ou episódios.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
