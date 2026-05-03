import { useMemo, useState } from "react";
import { parseMagnet, upsert, type LibraryItem } from "@/lib/storage";
import { tmdbMovie, tmdbSearch, type TmdbSearchItem } from "@/lib/tmdb";

export function AddMagnetDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (items: LibraryItem[]) => void;
}) {
  const [magnet, setMagnet] = useState("");
  const [title, setTitle] = useState("");
  const [poster, setPoster] = useState("");
  const [backdrop, setBackdrop] = useState("");
  const [description, setDescription] = useState("");
  const [year, setYear] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [imdbId, setImdbId] = useState("");
  const [tmdbResults, setTmdbResults] = useState<TmdbSearchItem[]>([]);
  const [tmdbLoading, setTmdbLoading] = useState(false);
  const [tmdbSelectedId, setTmdbSelectedId] = useState<number | null>(null);

  const parsedMagnet = useMemo(() => parseMagnet(magnet), [magnet]);

  if (!open) return null;

  const handleMagnetChange = (v: string) => {
    setMagnet(v);
    const parsed = parseMagnet(v);
    if (parsed.name && !title) setTitle(parsed.name);
  };

  const searchOnTmdb = async () => {
    setError(null);
    setTmdbResults([]);
    setTmdbSelectedId(null);
    const q = title.trim() || parsedMagnet.name || "";
    if (!q) return;

    setTmdbLoading(true);
    try {
      const results = await tmdbSearch(q, year.trim() || undefined, "pt-BR");
      setTmdbResults(results);
      if (results.length === 0) setError("Nenhum resultado encontrado no TMDB.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Falha ao buscar no TMDB.";
      if (msg === "tmdb_not_configured") {
        setError("TMDB não configurado no servidor. Configure TMDB_API_KEY na Railway (proxy).");
      } else if (msg === "proxy_not_configured") {
        setError("Proxy não configurado. Verifique VITE_TORRENT_PROXY_URL na Vercel.");
      } else {
        setError("Falha ao buscar no TMDB.");
      }
    } finally {
      setTmdbLoading(false);
    }
  };

  const applyTmdb = async (id: number) => {
    setError(null);
    setTmdbSelectedId(id);
    try {
      const details = await tmdbMovie(id, "pt-BR");
      if (details.title) setTitle(details.title);
      if (details.year) setYear(details.year);
      if (details.overview) setDescription(details.overview);
      if (details.poster) setPoster(details.poster);
      if (details.backdrop) setBackdrop(details.backdrop);
      if (details.imdbId) setImdbId(details.imdbId);
    } catch {
      setError("Falha ao carregar detalhes do TMDB.");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = parseMagnet(magnet);
    if (!parsed.infoHash) {
      setError("Magnet link inválido. Cole um link no formato magnet:?xt=urn:btih:...");
      return;
    }
    const finalTitle = title.trim() || parsed.name || "Sem título";
    const item: LibraryItem = {
      id: parsed.infoHash,
      title: finalTitle,
      magnet,
      poster: poster.trim() || undefined,
      backdrop: backdrop.trim() || undefined,
      description: description.trim() || undefined,
      year: year.trim() || undefined,
      tmdbId: tmdbSelectedId ?? undefined,
      imdbId: imdbId.trim() || undefined,
      addedAt: Date.now(),
    };
    const items = await upsert(item);
    onAdded(items);
    setMagnet("");
    setTitle("");
    setPoster("");
    setBackdrop("");
    setImdbId("");
    setDescription("");
    setYear("");
    setTmdbResults([]);
    setTmdbSelectedId(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-scale-in"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-lg rounded-xl bg-card border border-border shadow-card p-6 space-y-4"
      >
        <div>
          <h2 className="font-display text-3xl text-primary">Adicionar à biblioteca</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Cole um magnet link de conteúdo do qual você tem direito (vídeos próprios, domínio
            público, Creative Commons, screeners autorizados).
          </p>
        </div>

        <Field label="Magnet link *">
          <textarea
            required
            rows={3}
            value={magnet}
            onChange={(e) => handleMagnetChange(e.target.value)}
            placeholder="magnet:?xt=urn:btih:..."
            className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Título">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
          </div>
          <Field label="Ano">
            <input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="2024"
              className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Field>
        </div>

        <div className="rounded-lg border border-border/40 bg-secondary/30 p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Buscar no TMDB
            </div>
            <button
              type="button"
              onClick={searchOnTmdb}
              disabled={tmdbLoading || !(title.trim() || parsedMagnet.name)}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:brightness-110 transition disabled:opacity-50"
            >
              {tmdbLoading ? "Buscando..." : "Buscar"}
            </button>
          </div>

          {tmdbResults.length > 0 && (
            <div className="grid gap-2 max-h-56 overflow-auto">
              {tmdbResults.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => applyTmdb(r.id)}
                  className={`flex items-start gap-3 rounded-md border px-3 py-2 text-left transition ${
                    tmdbSelectedId === r.id
                      ? "border-primary bg-primary/10"
                      : "border-border/40 bg-background/40 hover:bg-background/60"
                  }`}
                >
                  <div className="h-14 w-10 shrink-0 rounded bg-secondary overflow-hidden">
                    {r.poster ? (
                      <img src={r.poster} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full bg-secondary" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground line-clamp-1">
                      {r.title}{" "}
                      {r.year ? <span className="text-muted-foreground">({r.year})</span> : null}
                    </div>
                    {r.overview && (
                      <div className="text-xs text-muted-foreground line-clamp-2">{r.overview}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <Field label="URL do poster (opcional)">
          <input
            value={poster}
            onChange={(e) => setPoster(e.target.value)}
            placeholder="https://..."
            className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </Field>

        <Field label="Descrição (opcional)">
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </Field>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm hover:bg-secondary transition"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:brightness-110 transition"
          >
            Adicionar
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">
        {label}
      </span>
      {children}
    </label>
  );
}
